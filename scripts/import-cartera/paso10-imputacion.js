// Paso 10 de la carga inicial (sección 14 del MD): imputar los abonos de sostenimiento --
// primero por período declarado, luego FIFO -- reutilizando `distribuir()` (la función pura ya
// existente y testeada en src/services/cartera/imputacion.js), no reinventándola.
//
// SEPARACIÓN DE POZOS (punto vs sostenimiento): este paso NUNCA toca `nuevos_puntos` ni
// `nuevo_punto_abonos`. El "cargo" de punto vive solo en `nuevos_puntos.valor_total`, sin fila en
// cartera_movimientos (no existe tipo DerechoPuntoAgua); sus abonos viven solo en
// nuevo_punto_abonos, con saldo recalculado directo, sin pasar por cartera_imputaciones. El paso 8
// solo crea `Abono` en cartera_movimientos para registros clasificacion:'sostenimiento' -- nunca
// para 'punto'. No hay pozo común que mezclar: son dos sistemas de tablas distintos.
//
// POOL COMBINADO (AperturaOpaca + CargoMensual/AjusteCategoria/AjusteAsamblea): se arma una
// consulta propia (no se reutiliza CarteraRepository.getCargosPendientes, que filtra por UN solo
// exigible) que junta ambos exigibles y ordena por fecha real, no por exigible. Como AperturaOpaca
// está fechada 2023-12-31, el FIFO la agota primero -- "quien paga, salda primero lo viejo".
// `monto > 0` excluye las 14 aperturas negativas (saldo a favor): nunca son cargo imputable.
//
// PERÍODO QUE EXCEDE LO CAUSADO: se intenta cubrir los meses declarados (modo MesesEspecificos);
// lo que sobra cae al FIFO general de la cuenta; lo que sobra de eso queda sin imputar -- saldo a
// favor implícito vía el monto crudo del Abono en getSaldos(), sin tabla aparte (cuenta_creditos
// está confirmada como muerta, nada la lee).
//
// ORDEN: los abonos de una cuenta se procesan en orden cronológico (fecha_pago_real ascendente),
// nunca por número de recibo ni por orden del JSON -- quien pagó primero cubre primero.
//
// Idempotente: un abono con al menos una fila en cartera_imputaciones ya fue procesado, se salta.
const { normalizarCodigo } = require('./normalizar');
const { distribuir, MODOS } = require('../../src/services/cartera/imputacion');
const { redondear, esMayor } = require('../../src/services/cartera/dinero');
const { codificarPeriodo, rangoDeMeses } = require('../../src/services/cartera/periodos');

const TIPOS_CARGO_COMBINADOS = ['CargoMensual', 'AjusteCategoria', 'AperturaOpaca', 'AjusteAsamblea'];

function parsearPeriodo(str) {
  if (!str) return null;
  const [anio, mes] = str.split('-').map(Number);
  return { anio, mes };
}

function mesesDelPeriodo(periodoDesde, periodoHasta) {
  const desde = parsearPeriodo(periodoDesde);
  const hasta = parsearPeriodo(periodoHasta);
  if (!desde || !hasta) return [];
  return rangoDeMeses(codificarPeriodo(desde.anio, desde.mes), codificarPeriodo(hasta.anio, hasta.mes));
}

function construirCandidatos(recibosJson, idPorCodigo, getDetalle, getAbono) {
  const candidatos = [];
  for (const r of recibosJson) {
    if (r.clasificacion !== 'sostenimiento' || !r.genera_movimiento_cartera) continue;
    const cuentaId = idPorCodigo.get(normalizarCodigo(r.codigo_cuenta));
    if (cuentaId === undefined) continue; // ya reportado en pasos previos (ej. recibo SINCODIFICAR)
    const detalle = getDetalle.get(r.numero_recibo);
    if (!detalle) continue;
    const abono = getAbono.get(detalle.id, cuentaId);
    if (!abono) continue; // no debería faltar si el paso 8 corrió limpio

    candidatos.push({
      abonoId: abono.id, cuentaId, fecha: abono.fecha, monto: redondear(-abono.monto),
      periodoDesde: r.periodo_desde, periodoHasta: r.periodo_hasta,
      codigo: r.codigo_cuenta, numeroRecibo: r.numero_recibo
    });
  }
  candidatos.sort((a, b) =>
    a.cuentaId - b.cuentaId || a.fecha.localeCompare(b.fecha) || a.abonoId - b.abonoId
  );
  return candidatos;
}

function ejecutarPaso10({ dbService, recibosJson }) {
  const CarteraRepository = require('../../src/repositories/CarteraRepository');
  const db = dbService.getDb();
  const repo = new CarteraRepository(dbService);

  const idPorCodigo = new Map(
    db.prepare('SELECT id, codigo FROM cuentas').all().map(c => [normalizarCodigo(c.codigo), c.id])
  );
  const getDetalle = db.prepare(`
    SELECT rd.id FROM recibo_detalles rd JOIN recibos r ON r.id = rd.recibo_id WHERE r.numero_recibo = ?
  `);
  const getAbono = db.prepare(`
    SELECT id, fecha, monto FROM cartera_movimientos WHERE recibo_detalle_id = ? AND cuenta_id = ? AND tipo = 'Abono'
  `);
  const yaImputado = db.prepare(`SELECT 1 FROM cartera_imputaciones WHERE abono_id = ? LIMIT 1`);

  const tiposSQL = TIPOS_CARGO_COMBINADOS.map(t => `'${t}'`).join(', ');
  const getCargosCombinados = db.prepare(`
    SELECT m.id, m.anio, m.mes, m.monto,
      COALESCE((SELECT SUM(i.monto) FROM cartera_imputaciones i WHERE i.cargo_id = m.id), 0) AS cubierto
    FROM cartera_movimientos m
    WHERE m.cuenta_id = ? AND m.tipo IN (${tiposSQL}) AND m.monto > 0
    ORDER BY m.fecha ASC, m.id ASC
  `);
  function cargosPendientesCombinados(cuentaId) {
    return getCargosCombinados.all(cuentaId)
      .map(f => ({ ...f, pendiente: redondear(f.monto - f.cubierto) }))
      .filter(f => esMayor(f.pendiente, 0));
  }

  const candidatos = construirCandidatos(recibosJson, idPorCodigo, getDetalle, getAbono);

  const conPeriodo = [];
  const conFifo = [];
  const conSobrante = [];
  const saltados = [];

  const transaccion = db.transaction(() => {
    for (const c of candidatos) {
      if (yaImputado.get(c.abonoId)) { saltados.push(c); continue; }

      let restante = c.monto;
      let usoPeriodo = false;
      let usoFifo = false;

      const meses = mesesDelPeriodo(c.periodoDesde, c.periodoHasta);
      if (meses.length > 0) {
        const cargos = cargosPendientesCombinados(c.cuentaId);
        const idsElegidos = cargos
          .filter(cg => meses.some(m => m.anio === cg.anio && m.mes === cg.mes))
          .map(cg => cg.id);

        const { imputaciones, sobrante } = distribuir({
          modo: MODOS.MESES_ESPECIFICOS, cargos, monto: restante, cargosElegidos: idsElegidos
        });
        for (const imp of imputaciones) repo.crearImputacion({ abonoId: c.abonoId, cargoId: imp.cargoId, monto: imp.monto });
        if (imputaciones.length > 0) usoPeriodo = true;
        restante = sobrante;
      }

      if (esMayor(restante, 0)) {
        const cargos = cargosPendientesCombinados(c.cuentaId); // recomputa: la pasada de período pudo cubrir algo
        const { imputaciones, sobrante } = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos, monto: restante });
        for (const imp of imputaciones) repo.crearImputacion({ abonoId: c.abonoId, cargoId: imp.cargoId, monto: imp.monto });
        if (imputaciones.length > 0) usoFifo = true;
        restante = sobrante;
      }

      if (usoPeriodo) conPeriodo.push(c);
      if (usoFifo) conFifo.push(c);
      if (esMayor(restante, 0)) conSobrante.push({ ...c, sobrante: restante });
    }
  });
  transaccion();

  // "Los dos pozos" del pool combinado: cuánto de lo imputado fue a saldar deuda vieja
  // (AperturaOpaca) contra cuánto fue a deuda 2024+ (CargoMensual/AjusteCategoria/AjusteAsamblea).
  const abonoIds = candidatos.map(c => c.abonoId);
  let porPozo = { apertura: 0, cargosDesde2024: 0 };
  if (abonoIds.length > 0) {
    const placeholders = abonoIds.map(() => '?').join(', ');
    const filas = db.prepare(`
      SELECT cm.tipo, SUM(ci.monto) AS total
      FROM cartera_imputaciones ci
      JOIN cartera_movimientos cm ON cm.id = ci.cargo_id
      WHERE ci.abono_id IN (${placeholders})
      GROUP BY cm.tipo
    `).all(...abonoIds);
    for (const f of filas) {
      if (f.tipo === 'AperturaOpaca') porPozo.apertura = redondear(f.total);
      else porPozo.cargosDesde2024 = redondear(porPozo.cargosDesde2024 + f.total);
    }
  }

  return {
    procesados: candidatos.length - saltados.length,
    conPeriodo, conFifo, conSobrante, saltados, porPozo,
    totalImputadoPeriodo: redondear(conPeriodo.reduce((s, c) => s + c.monto, 0)),
    totalSobrante: redondear(conSobrante.reduce((s, c) => s + c.sobrante, 0))
  };
}

module.exports = { ejecutarPaso10, construirCandidatos, mesesDelPeriodo, TIPOS_CARGO_COMBINADOS };
