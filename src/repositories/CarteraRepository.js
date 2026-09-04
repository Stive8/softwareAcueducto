const { codificarPeriodo } = require('../services/cartera/periodos');
const { redondear } = require('../services/cartera/dinero');

// Acceso a cartera_movimientos y cartera_imputaciones.
//
// Regla central: el saldo TOTAL sale de la suma de montos de los movimientos, nunca de las
// imputaciones -- un movimiento de contrapartida (AjusteCategoria negativo) corrige el saldo
// sin que haya que deshacer ninguna imputación existente. Las imputaciones solo explican qué
// abono cubrió qué cargo -- EXCEPTO para el reparto entre exigible y opaco de getSaldos, que sí
// necesita mirarlas: un abono puede pagar cargos de los dos buckets a la vez y su propia
// etiqueta `exigible` no alcanza para saber cuánto fue a cada uno (ver comentario de getSaldos).
class CarteraRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  transaccion(fn) {
    return this.db.transaction(fn)();
  }

  crearMovimiento({ cuentaId, fecha, tipo, exigible = 1, monto, anio = null, mes = null,
    reciboDetalleId = null, documento = null, observaciones = null, usuarioId = null }) {
    const r = this.db.prepare(`
      INSERT INTO cartera_movimientos
        (cuenta_id, fecha, tipo, exigible, monto, anio, mes, recibo_detalle_id, documento, observaciones, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cuentaId, fecha, tipo, exigible, redondear(monto), anio, mes,
      reciboDetalleId, documento, observaciones, usuarioId);
    return r.lastInsertRowid;
  }

  // Recorta el monto de un movimiento ya creado a lo que realmente terminó imputado (ver
  // paso10-imputacion.js y CarteraService.registrarAbono): el sobrante no se queda ahí como
  // saldo a favor implícito, se mueve a cuenta_creditos aparte.
  // observaciones es opcional: si se pasa, reemplaza el texto existente (útil para dejar
  // constancia de por qué un movimiento quedó en $0 -- ver paso10-imputacion.js/paso9b).
  actualizarMontoMovimiento(id, monto, observaciones = undefined) {
    if (observaciones === undefined) {
      this.db.prepare(`UPDATE cartera_movimientos SET monto = ? WHERE id = ?`).run(redondear(monto), id);
    } else {
      this.db.prepare(`UPDATE cartera_movimientos SET monto = ?, observaciones = ? WHERE id = ?`)
        .run(redondear(monto), observaciones, id);
    }
  }

  crearImputacion({ abonoId, cargoId, monto }) {
    const r = this.db.prepare(`
      INSERT INTO cartera_imputaciones (abono_id, cargo_id, monto) VALUES (?, ?, ?)
    `).run(abonoId, cargoId, redondear(monto));
    return r.lastInsertRowid;
  }

  // El saldo TOTAL (deudaExigible + saldoOpaco) sigue siendo la suma de los montos de los
  // movimientos -- eso no cambió. Lo que cambió (2026-08-07) es el REPARTO entre los dos
  // buckets: se decide por el cargo que efectivamente recibió cada imputación, no por la
  // etiqueta `exigible` del abono que pagó. Un abono queda marcado exigible=1 si la mayoría de
  // su imputación fue contra deuda exigible, pero cargosPendientesCombinados no separa los dos
  // pools en el FIFO de respaldo: por sobrante, ese mismo abono puede terminar cubriendo parte
  // de la apertura opaca (exigible=0). Sumar por la etiqueta del abono (como antes) dejaba la
  // apertura opaca sin descontar -- se cobraba dos veces -- y deudaExigible subestimada por el
  // mismo monto. La corrección: cada CARGO (no cada movimiento) se muestra por
  // monto - cubierto, igual que ya hace getCargosConCobertura, y cada bucket es la suma de sus
  // propios cargos netos. No se toca el abono ni se parte en dos -- cartera_imputaciones ya
  // tiene el dato de a qué cargo fue cada peso.
  getSaldos(cuentaId) {
    const tipos = CarteraRepository.TIPOS_CARGO.map(t => `'${t}'`).join(', ');
    const fila = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN m.exigible = 1 THEN m.monto - COALESCE(imp.cubierto, 0) ELSE 0 END), 0) AS deuda_exigible,
        COALESCE(SUM(CASE WHEN m.exigible = 0 THEN m.monto - COALESCE(imp.cubierto, 0) ELSE 0 END), 0) AS saldo_opaco
      FROM cartera_movimientos m
      LEFT JOIN (
        SELECT cargo_id, SUM(monto) AS cubierto FROM cartera_imputaciones GROUP BY cargo_id
      ) imp ON imp.cargo_id = m.id
      WHERE m.cuenta_id = ? AND m.tipo IN (${tipos})
    `).get(cuentaId);
    return {
      deudaExigible: redondear(fila.deuda_exigible),
      saldoOpaco: redondear(fila.saldo_opaco)
    };
  }

  getCargoMensual(cuentaId, anio, mes) {
    return this.db.prepare(`
      SELECT * FROM cartera_movimientos
      WHERE cuenta_id = ? AND tipo = 'CargoMensual' AND anio = ? AND mes = ?
    `).get(cuentaId, anio, mes);
  }

  // Tipos que representan algo cobrable (incluye ajustes que pueden ser negativos, como una
  // recategorización hacia abajo o el residuo de conciliación de la carga inicial). Los abonos
  // y los castigos (CastigoCartera) no se imputan, así que quedan fuera.
  static get TIPOS_CARGO() {
    return ['CargoMensual', 'AjusteCategoria', 'AperturaOpaca', 'AjusteAsamblea', 'AjusteCargaInicial'];
  }

  // Cargos con saldo sin cubrir, del más antiguo al más nuevo. Los que no tienen mes
  // (la apertura opaca) van primero, porque son la deuda más vieja.
  // Excluye los montos negativos: un ajuste negativo reduce el saldo, no es algo que cobrar.
  getCargosPendientes(cuentaId, exigible) {
    const tipos = CarteraRepository.TIPOS_CARGO.map(t => `'${t}'`).join(', ');
    const filas = this.db.prepare(`
      SELECT m.id, m.anio, m.mes, m.monto,
        COALESCE((SELECT SUM(i.monto) FROM cartera_imputaciones i WHERE i.cargo_id = m.id), 0) AS cubierto
      FROM cartera_movimientos m
      WHERE m.cuenta_id = ? AND m.exigible = ? AND m.tipo IN (${tipos}) AND m.monto > 0
      ORDER BY (m.anio IS NULL) DESC, m.anio ASC, m.mes ASC, m.id ASC
    `).all(cuentaId, exigible);

    return filas
      .map(f => ({ ...f, monto: redondear(f.monto), cubierto: redondear(f.cubierto), pendiente: redondear(f.monto - f.cubierto) }))
      .filter(f => f.pendiente > 0);
  }

  // Todos los cargos con mes, cubiertos o no, para calcular "cubierto hasta". Agrupa por mes
  // sumando cargo + ajustes, porque un mes puede tener varias filas.
  //
  // AND m.mes IS NOT NULL es a propósito, no un descuido: un AjusteCategoria sin mes asignado
  // (ej. cuenta R096, +3.000) es un caso legítimo del modelo -- un ajuste que no corresponde a
  // un mes concreto -- y por eso mismo no puede aparecer en "último mes cubierto" ni en "a
  // pagar" (que son, por diseño, listas de MESES). Sigue contando en deudaExigible vía
  // getSaldos, que sí lo ve (no filtra por mes). No "arreglar" agregándolo aquí: rompería el
  // contrato de esta función, que es estrictamente por mes.
  getCargosConCobertura(cuentaId, exigible) {
    const tipos = CarteraRepository.TIPOS_CARGO.map(t => `'${t}'`).join(', ');
    const filas = this.db.prepare(`
      SELECT m.anio, m.mes,
        SUM(m.monto) AS monto,
        COALESCE(SUM((SELECT SUM(i.monto) FROM cartera_imputaciones i WHERE i.cargo_id = m.id)), 0) AS cubierto
      FROM cartera_movimientos m
      WHERE m.cuenta_id = ? AND m.exigible = ? AND m.tipo IN (${tipos})
        AND m.anio IS NOT NULL AND m.mes IS NOT NULL
      GROUP BY m.anio, m.mes
      ORDER BY m.anio ASC, m.mes ASC
    `).all(cuentaId, exigible);

    return filas.map(f => ({
      anio: f.anio, mes: f.mes,
      monto: redondear(f.monto), cubierto: redondear(f.cubierto)
    }));
  }

  getMovimientos(cuentaId) {
    return this.db.prepare(`
      SELECT * FROM cartera_movimientos WHERE cuenta_id = ?
      ORDER BY fecha ASC, id ASC
    `).all(cuentaId);
  }

  getTotalImputadoDeAbono(abonoId) {
    const fila = this.db.prepare(`
      SELECT COALESCE(SUM(monto), 0) AS total FROM cartera_imputaciones WHERE abono_id = ?
    `).get(abonoId);
    return redondear(fila.total);
  }

  // Meses que cubrió un abono, vía cartera_imputaciones -- el abono en sí no guarda anio/mes
  // (puede cubrir varios meses o una parte de uno), así que su "período" solo existe a través
  // de a qué cargos quedó imputado. Excluye cargos sin mes (ej. AperturaOpaca): no tienen
  // período que mostrar.
  getPeriodosDeAbono(abonoId) {
    const filas = this.db.prepare(`
      SELECT DISTINCT c.anio, c.mes
      FROM cartera_imputaciones i
      JOIN cartera_movimientos c ON c.id = i.cargo_id
      WHERE i.abono_id = ? AND c.anio IS NOT NULL AND c.mes IS NOT NULL
      ORDER BY c.anio ASC, c.mes ASC
    `).all(abonoId);
    return filas;
  }

  getMesesCausados(cuentaId) {
    const filas = this.db.prepare(`
      SELECT anio, mes FROM cartera_movimientos
      WHERE cuenta_id = ? AND tipo = 'CargoMensual'
    `).all(cuentaId);
    return new Set(filas.map(f => codificarPeriodo(f.anio, f.mes)));
  }

  getAbonoPorReciboDetalle(reciboDetalleId) {
    return this.db.prepare(`
      SELECT * FROM cartera_movimientos WHERE recibo_detalle_id = ? AND tipo = 'Abono'
    `).get(reciboDetalleId);
  }

  // Libera las imputaciones de un abono sin tocar el movimiento en sí. Se usa al reclasificar
  // un abono hacia otro destino (ver CarteraService.reclasificarAbono): los cargos que ese
  // abono cubría vuelven a quedar pendientes, y el abono original se cancela con un movimiento
  // de contrapartida en vez de reescribirse.
  eliminarImputacionesDeAbono(abonoId) {
    this.db.prepare(`DELETE FROM cartera_imputaciones WHERE abono_id = ?`).run(abonoId);
  }

  // Saldo a favor de una cuenta: no es un bucket de cartera_movimientos, es su propio libro
  // (cuenta_creditos) para que tener plata a favor y aplicarla sean dos hechos separados en el
  // tiempo -- 'Abono' es lo que entra, 'Aplicado' lo que ya se redimió contra deuda real.
  crearCredito({ cuentaId, tipo, monto, fecha, reciboDetalleId = null, abonoMovimientoId = null,
    observaciones = null }) {
    const r = this.db.prepare(`
      INSERT INTO cuenta_creditos (cuenta_id, tipo, monto, fecha, recibo_detalle_id, abono_movimiento_id, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(cuentaId, tipo, redondear(monto), fecha, reciboDetalleId, abonoMovimientoId, observaciones);
    return r.lastInsertRowid;
  }

  getSaldoCreditoDisponible(cuentaId) {
    const fila = this.db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN tipo = 'Abono' THEN monto ELSE -monto END), 0) AS saldo
      FROM cuenta_creditos WHERE cuenta_id = ?
    `).get(cuentaId);
    return redondear(fila.saldo);
  }

  getCreditos(cuentaId) {
    return this.db.prepare(`
      SELECT * FROM cuenta_creditos WHERE cuenta_id = ? ORDER BY fecha ASC, id ASC
    `).all(cuentaId);
  }

  // --- Versiones "por lotes" de getSaldos/getCargosConCobertura/getSaldoCreditoDisponible ---
  //
  // Para listar cuentas con su estado de mora (cuentas:getStats, pagos:getCuentasConEstado) hacía
  // falta el mismo dato que estos tres métodos ya calculan, pero UNA VEZ POR CUENTA -- con ~300
  // cuentas activas eso eran ~900 consultas solo para esta parte. Las versiones _Bulk hacen
  // exactamente la misma cuenta (misma agregación, mismo SQL) pero agrupada por cuenta_id en un
  // puñado de consultas, para que CarteraService.getIndicadoresMoraTodas se las reparta después en
  // memoria. Se parte en bloques de ${CarteraRepository.TAMANO_LOTE} ids porque SQLite tiene un
  // límite de variables por consulta (SQLITE_LIMIT_VARIABLE_NUMBER, 999 por defecto).
  static get TAMANO_LOTE() {
    return 500;
  }

  static _enLotes(cuentaIds) {
    const lotes = [];
    for (let i = 0; i < cuentaIds.length; i += CarteraRepository.TAMANO_LOTE) {
      lotes.push(cuentaIds.slice(i, i + CarteraRepository.TAMANO_LOTE));
    }
    return lotes;
  }

  getSaldosBulk(cuentaIds) {
    const mapa = new Map();
    if (cuentaIds.length === 0) return mapa;

    const tipos = CarteraRepository.TIPOS_CARGO.map(t => `'${t}'`).join(', ');
    for (const lote of CarteraRepository._enLotes(cuentaIds)) {
      const placeholders = lote.map(() => '?').join(', ');
      const filas = this.db.prepare(`
        SELECT
          m.cuenta_id AS cuenta_id,
          COALESCE(SUM(CASE WHEN m.exigible = 1 THEN m.monto - COALESCE(imp.cubierto, 0) ELSE 0 END), 0) AS deuda_exigible,
          COALESCE(SUM(CASE WHEN m.exigible = 0 THEN m.monto - COALESCE(imp.cubierto, 0) ELSE 0 END), 0) AS saldo_opaco
        FROM cartera_movimientos m
        LEFT JOIN (
          SELECT cargo_id, SUM(monto) AS cubierto FROM cartera_imputaciones GROUP BY cargo_id
        ) imp ON imp.cargo_id = m.id
        WHERE m.cuenta_id IN (${placeholders}) AND m.tipo IN (${tipos})
        GROUP BY m.cuenta_id
      `).all(...lote);

      for (const f of filas) {
        mapa.set(f.cuenta_id, { deudaExigible: redondear(f.deuda_exigible), saldoOpaco: redondear(f.saldo_opaco) });
      }
    }
    return mapa;
  }

  getCargosConCoberturaBulk(cuentaIds, exigible) {
    const mapa = new Map();
    if (cuentaIds.length === 0) return mapa;

    const tipos = CarteraRepository.TIPOS_CARGO.map(t => `'${t}'`).join(', ');
    for (const lote of CarteraRepository._enLotes(cuentaIds)) {
      const placeholders = lote.map(() => '?').join(', ');
      const filas = this.db.prepare(`
        SELECT m.cuenta_id AS cuenta_id, m.anio, m.mes,
          SUM(m.monto) AS monto,
          COALESCE(SUM((SELECT SUM(i.monto) FROM cartera_imputaciones i WHERE i.cargo_id = m.id)), 0) AS cubierto
        FROM cartera_movimientos m
        WHERE m.cuenta_id IN (${placeholders}) AND m.exigible = ? AND m.tipo IN (${tipos})
          AND m.anio IS NOT NULL AND m.mes IS NOT NULL
        GROUP BY m.cuenta_id, m.anio, m.mes
        ORDER BY m.cuenta_id ASC, m.anio ASC, m.mes ASC
      `).all(...lote, exigible);

      for (const f of filas) {
        if (!mapa.has(f.cuenta_id)) mapa.set(f.cuenta_id, []);
        mapa.get(f.cuenta_id).push({ anio: f.anio, mes: f.mes, monto: redondear(f.monto), cubierto: redondear(f.cubierto) });
      }
    }
    return mapa;
  }

  getSaldoCreditoDisponibleBulk(cuentaIds) {
    const mapa = new Map();
    if (cuentaIds.length === 0) return mapa;

    for (const lote of CarteraRepository._enLotes(cuentaIds)) {
      const placeholders = lote.map(() => '?').join(', ');
      const filas = this.db.prepare(`
        SELECT cuenta_id,
          COALESCE(SUM(CASE WHEN tipo = 'Abono' THEN monto ELSE -monto END), 0) AS saldo
        FROM cuenta_creditos
        WHERE cuenta_id IN (${placeholders})
        GROUP BY cuenta_id
      `).all(...lote);

      for (const f of filas) {
        mapa.set(f.cuenta_id, redondear(f.saldo));
      }
    }
    return mapa;
  }
}

module.exports = CarteraRepository;
