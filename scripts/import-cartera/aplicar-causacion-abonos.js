// scripts/import-cartera/aplicar-causacion-abonos.js
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const CuentaEstadoRepository = require('../../src/repositories/CuentaEstadoRepository');
const PagoRepository = require('../../src/repositories/PagoRepository');
const CarteraService = require('../../src/services/CarteraService');
const { codificarPeriodo, decodificarPeriodo, primerDiaDelMes } = require('../../src/services/cartera/periodos');
const { redondear } = require('../../src/services/cartera/dinero');

// El texto que distingue un recibo de conexión (punto nuevo de agua) de uno de sostenimiento
// o abono a la deuda. Verificado contra los 2.429 recibos reales: 151 traen alguna de estas
// dos frases y ninguno de sostenimiento/abono las trae.
const PATRON_CONEXION = /PUNTO\s*(DE\s*)?AGUA|PUNTO\s*NUEVO/i;

// Causación histórica escribiendo DIRECTO por CarteraRepository, sin pasar por
// CarteraService.asegurarCausacion: es la excepción documentada en el spec (§6) para que la
// carga inicial pueda escribir en 2022-2025, que a partir de que existan períodos contables
// cerrados NO podría hacer la vía operativa normal.
function causarHistorico({ cuentaId, dbService, hastaAnio, hastaMes, usuarioId = null }) {
  const carteraRepo = new CarteraRepository(dbService);
  const estadoRepo = new CuentaEstadoRepository(dbService);
  const pagoRepo = new PagoRepository(dbService);

  // Piso EXPLÍCITO de la carga inicial (Global Constraint del plan): nunca se causa antes de
  // 2022-01. Antes esa protección era accidental -- dependía de que no hubiera tarifa histórica
  // anterior a esa fecha.
  //
  // Y es piso Y arranque a la vez: toda cuenta que llega hasta acá viene de una fila real del
  // Excel de cartera, o sea existía como asociado antes de 2022, así que causa desde 2022-01
  // aunque nunca haya hecho un recibo (la deuda se acumula se pague o no) o aunque su primer
  // recibo real sea posterior. Por eso ya NO se usa el mes del primer recibo como ancla: con
  // ese criterio, una cuenta cuyo primer recibo fuera de 2023-05 perdía 16 meses de deuda real,
  // y una sin ningún recibo no causaba nada.
  const FLOOR_ANIO = 2022, FLOOR_MES = 1;
  const desdeCod = codificarPeriodo(FLOOR_ANIO, FLOOR_MES);

  const hastaCod = codificarPeriodo(hastaAnio, hastaMes);
  const yaCausados = carteraRepo.getMesesCausados(cuentaId);

  let creados = 0;
  for (let cod = desdeCod; cod <= hastaCod; cod++) {
    if (yaCausados.has(cod)) continue;
    const { anio, mes } = decodificarPeriodo(cod);

    if (estadoRepo.estadoEnMes(cuentaId, anio, mes) !== 'Activo') continue;

    const tarifa = pagoRepo.getCategoriaTarifaParaMes(cuentaId, anio, mes);
    if (!tarifa) continue;

    carteraRepo.crearMovimiento({
      cuentaId, fecha: primerDiaDelMes(anio, mes), tipo: 'CargoMensual', exigible: 1,
      monto: tarifa.tarifa_sostenimiento, anio, mes,
      observaciones: 'Carga inicial cartera 2026-07', usuarioId
    });
    creados++;
  }
  return creados;
}

// Cada recibo_detalle de sostenimiento o "abono a la deuda" (todo lo que no sea conexión) se
// registra como un Abono en cartera, en orden cronológico, con imputación FIFO. El concepto del
// recibo (CUOTA DE SOSTENIMIENTO vs ABONO A LA DEUDA) es solo el hábito de redacción del cajero,
// no una categoría contable real -- no se usa para decidir qué cuenta como abono. La única
// exclusión legítima por concepto es conexión (PUNTO DE AGUA / PUNTO NUEVO), que es dinero de
// otro concepto, no cartera.
//
// Solo se consideran recibos DESDE después del 2021-12-31 (la fecha ancla de la apertura opaca
// que crea aplicar-base.js): los recibos anteriores ya están implícitos en el saldo de apertura
// opaca (el Excel de cartera lo calcula como la deuda NETA después de descontar todos los pagos
// hechos hasta esa fecha), así que volver a aplicarlos aquí los contaría dos veces.
const ANCLA_APERTURA = '2021-12-31';

function cargarAbonos({ cuentaId, dbService, usuarioId }) {
  const db = dbService.getDb();
  const carteraService = new CarteraService(dbService);
  const carteraRepo = new CarteraRepository(dbService);

  // better-sqlite3 no trae REGEXP registrado por defecto: se filtra con dos LIKE, equivalentes
  // en la práctica al patrón PATRON_CONEXION (verificado contra los 2.429 recibos reales).
  const detalles = db.prepare(`
    SELECT rd.id AS recibo_detalle_id, rd.concepto, rd.valor, r.fecha_recibo
    FROM recibo_detalles rd
    INNER JOIN recibos r ON r.id = rd.recibo_id
    WHERE r.cuenta_id = ? AND r.estado != 'Anulado' AND rd.valor > 0
      AND r.fecha_recibo > ?
      AND rd.concepto NOT LIKE '%PUNTO%AGUA%' AND rd.concepto NOT LIKE '%PUNTO NUEVO%'
    ORDER BY r.fecha_recibo ASC, r.numero_recibo ASC, rd.id ASC
  `).all(cuentaId, ANCLA_APERTURA);

  let creados = 0, total = 0, aplicadoAOpaco = 0, sobranteFinal = 0;
  for (const d of detalles) {
    const yaExiste = db.prepare(`SELECT 1 FROM cartera_movimientos WHERE recibo_detalle_id = ?`).get(d.recibo_detalle_id);
    if (yaExiste) continue;

    const fecha = String(d.fecha_recibo).split(' ')[0];
    creados++;
    total += d.valor;

    // Guarda de datos corruptos: SQLite no impone de verdad el tipo REAL de la columna, así que
    // un valor no numérico (texto) pasa el filtro `rd.valor > 0` del SQL de arriba (SQLite
    // ordena TEXT por encima de cualquier número). Sin esto, Math.min más abajo lo convertiría
    // en NaN y el problema quedaría enmascarado en silencio (0 movimientos, sin error) en vez de
    // fallar con un mensaje claro -- se deja que registrarAbono dispare su propia validación
    // ('El monto del abono debe ser mayor a cero'), igual que hacía este código antes del fix.
    if (!(Number(d.valor) > 0)) {
      carteraService.registrarAbono({
        cuentaId, fecha, monto: d.valor, modo: CarteraService.MODOS.ABONO_DEUDA_FIFO,
        reciboDetalleId: d.recibo_detalle_id, observaciones: 'Carga inicial cartera 2026-07', usuarioId
      });
      continue;
    }

    // El abono FIFO nunca se registra por más de lo que hay pendiente exigible en este momento:
    // así el mismo dinero nunca paga dos deudas (exigible Y opaca) a la vez. Lo que sobra se
    // aplica aparte, directo contra el saldo opaco.
    const pendienteExigible = redondear(
      carteraRepo.getCargosPendientes(cuentaId, 1).reduce((s, c) => s + c.pendiente, 0)
    );
    const montoFifo = Math.min(d.valor, pendienteExigible);
    let sobrante = redondear(d.valor - montoFifo);

    if (montoFifo > 0) {
      carteraService.registrarAbono({
        cuentaId, fecha, monto: montoFifo, modo: CarteraService.MODOS.ABONO_DEUDA_FIFO,
        reciboDetalleId: d.recibo_detalle_id, observaciones: 'Carga inicial cartera 2026-07', usuarioId
      });
    }

    // Lo que el FIFO no alcanzó a cubrir de la deuda exigible del momento (un pago más grande
    // que la deuda exigible que había cuando se hizo) se aplica contra el saldo histórico
    // opaco, hasta agotarlo -- es el mismo dinero real, un abono grande destinado a saldar
    // deuda vieja. Si sobra después de eso, es saldo a favor genuino: se reporta, no se inventa
    // un destino (eso es ANTICIPO, un modo operativo aparte, fuera de alcance de esta carga).
    //
    // Caso límite conocido y aceptado: si montoFifo es 0 y además no hay saldoOpaco disponible,
    // este recibo_detalle no genera ningún movimiento (todo es sobranteFinal). Si el importador
    // se vuelve a correr, ese recibo se re-detecta como pendiente (no hay movimiento con su id)
    // y sobranteFinal se reporta de nuevo -- no duplica datos (no crea movimientos), solo se
    // recuenta en el reporte de una segunda corrida.
    if (sobrante > 0) {
      const { saldoOpaco } = carteraRepo.getSaldos(cuentaId);
      if (saldoOpaco > 0) {
        const montoOpaco = Math.min(sobrante, saldoOpaco);
        carteraService.registrarAbono({
          cuentaId, fecha, monto: montoOpaco, modo: CarteraService.MODOS.ABONO_SALDO_OPACO,
          reciboDetalleId: d.recibo_detalle_id,
          observaciones: 'Carga inicial cartera 2026-07: excedente de un abono aplicado al saldo histórico',
          usuarioId
        });
        aplicadoAOpaco += montoOpaco;
        if (montoOpaco < sobrante) sobranteFinal += sobrante - montoOpaco;
      } else {
        sobranteFinal += sobrante;
      }
    }
  }
  return { creados, total, aplicadoAOpaco, sobranteFinal };
}

function causarYAbonar({ cuentaId, dbService, usuarioId, hastaAnio, hastaMes }) {
  const db = dbService.getDb();
  return db.transaction(() => {
    const cargosCreados = causarHistorico({ cuentaId, dbService, hastaAnio, hastaMes, usuarioId });
    const { creados: abonosCreados, total: totalAbonado, aplicadoAOpaco, sobranteFinal } = cargarAbonos({ cuentaId, dbService, usuarioId });
    return { cargosCreados, abonosCreados, totalAbonado, aplicadoAOpaco, sobranteFinal };
  })();
}

module.exports = { causarYAbonar, PATRON_CONEXION };
