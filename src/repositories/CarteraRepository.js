const { codificarPeriodo } = require('../services/cartera/periodos');
const { redondear } = require('../services/cartera/dinero');

// Acceso a cartera_movimientos y cartera_imputaciones.
//
// Regla central: el SALDO sale de la suma de montos de los movimientos, nunca de las
// imputaciones. Las imputaciones solo explican qué abono cubrió qué cargo. Gracias a esa
// separación, un movimiento de contrapartida (AjusteCategoria negativo) corrige el saldo sin
// que haya que deshacer ninguna imputación existente.
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
  actualizarMontoMovimiento(id, monto) {
    this.db.prepare(`UPDATE cartera_movimientos SET monto = ? WHERE id = ?`).run(redondear(monto), id);
  }

  crearImputacion({ abonoId, cargoId, monto }) {
    const r = this.db.prepare(`
      INSERT INTO cartera_imputaciones (abono_id, cargo_id, monto) VALUES (?, ?, ?)
    `).run(abonoId, cargoId, redondear(monto));
    return r.lastInsertRowid;
  }

  getSaldos(cuentaId) {
    const fila = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN exigible = 1 THEN monto ELSE 0 END), 0) AS deuda_exigible,
        COALESCE(SUM(CASE WHEN exigible = 0 THEN monto ELSE 0 END), 0) AS saldo_opaco
      FROM cartera_movimientos WHERE cuenta_id = ?
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

  // Tipos que representan algo cobrable. Los abonos y los castigos no se imputan.
  static get TIPOS_CARGO() {
    return ['CargoMensual', 'AjusteCategoria', 'AperturaOpaca', 'AjusteAsamblea'];
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
}

module.exports = CarteraRepository;
