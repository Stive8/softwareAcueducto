const CarteraService = require('../services/CarteraService');
const { codificarPeriodo } = require('../services/cartera/periodos');

class DashboardRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
    this.carteraService = new CarteraService(dbService);
  }

  getIngresosMes() {
    const result = this.db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM recibos
      WHERE strftime('%Y-%m', fecha_recibo) = strftime('%Y-%m', 'now')
      AND estado != 'Anulado'
    `).get();

    return result.total;
  }

  // Excluye gastos anulados: un gasto anulado no debe seguir contando como egreso real,
  // su reversión ya queda reflejada en los movimientos de caja/banco.
  getGastosMes() {
    const result = this.db.prepare(`
      SELECT COALESCE(SUM(valor), 0) as total
      FROM gastos
      WHERE strftime('%Y-%m', fecha_gasto) = strftime('%Y-%m', 'now')
      AND estado != 'Anulado'
    `).get();

    return result.total;
  }

  // Código de período comparable: año*12 + (mes-1), igual a la codificación usada en PagoService
  getPeriodoActualCodigo() {
    const ahora = new Date();
    return ahora.getFullYear() * 12 + ahora.getMonth();
  }

  // Ids de todas las cuentas activas -- también la usa DashboardService para calcular
  // carteraPendiente sobre todas las cuentas, no solo las "en mora" (una cuenta puede estar al
  // día en deuda y aun así tener un punto de conexión pendiente).
  getIdsActivas() {
    return this.db.prepare(`SELECT id FROM cuentas WHERE estado = 'Activo'`).all().map(r => r.id);
  }

  // "En mora" = debe algo en 2024+ (cubiertoHasta no llega al mes actual) O tiene deuda
  // anterior al corte pendiente, aunque esté al día en lo corriente -- mismo criterio que
  // ReporteService.procesarEstadoCuentas (ver
  // docs/superpowers/specs/2026-08-10-fase2-reportes-dashboard-design.md). El punto de conexión
  // NO cuenta para esto a propósito -- es otra naturaleza de deuda. Antes se leía de
  // pago_periodos (MAX de mes pagado, sin importar huecos); ahora de cubiertoHasta.
  _idsEnMora() {
    const periodoActual = this.getPeriodoActualCodigo();
    return this.carteraService.getIndicadoresMoraTodas(this.getIdsActivas())
      .filter(ind => {
        const cubiertoCod = ind.cubiertoHasta ? codificarPeriodo(ind.cubiertoHasta.anio, ind.cubiertoHasta.mes) : -1;
        return cubiertoCod < periodoActual || ind.deudaAntes2024 > 0;
      })
      .map(ind => ind.cuentaId);
  }

  // Cuentas activas sin ninguna deuda 2024+ ni anterior al corte.
  getCuentasAlDia() {
    const idsEnMora = new Set(this._idsEnMora());
    return this.getIdsActivas().filter(id => !idsEnMora.has(id)).length;
  }

  // Cuentas activas cuyo último mes pagado es anterior al mes actual (o que nunca han pagado)
  getCuentasEnMora() {
    return this.getCuentasEnMoraIds().length;
  }

  // Mismo criterio que getCuentasEnMora(), pero devuelve los ids: lo usa DashboardService
  // para sumar la deuda pendiente de cada una.
  getCuentasEnMoraIds() {
    return this._idsEnMora();
  }

  // Cuentas con saldo a favor: abonos registrados que aún no se han aplicado a meses de sostenimiento
  getCuentasConSaldoAFavor() {
    const result = this.db.prepare(`
      SELECT COUNT(*) as total FROM (
        SELECT cuenta_id, SUM(CASE WHEN tipo = 'Abono' THEN monto ELSE -monto END) as saldo
        FROM cuenta_creditos
        GROUP BY cuenta_id
        HAVING saldo > 0
      )
    `).get();

    return result.total;
  }

  getIngresosVsGastosUltimos6Meses() {
    const meses = [];
    const ingresos = [];
    const gastos = [];

    for (let i = 5; i >= 0; i--) {
      const fecha = new Date();
      fecha.setMonth(fecha.getMonth() - i);
      const mes = fecha.toLocaleString('es-CO', { month: 'short' });
      const anio = fecha.getFullYear();
      const mesAnio = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;

      meses.push(`${mes} ${anio}`);

      const ingreso = this.db.prepare(`
        SELECT COALESCE(SUM(total), 0) as total
        FROM recibos
        WHERE strftime('%Y-%m', fecha_recibo) = ?
        AND estado != 'Anulado'
      `).get(mesAnio);

      const gasto = this.db.prepare(`
        SELECT COALESCE(SUM(valor), 0) as total
        FROM gastos
        WHERE strftime('%Y-%m', fecha_gasto) = ?
        AND estado != 'Anulado'
      `).get(mesAnio);

      ingresos.push(ingreso.total);
      gastos.push(gasto.total);
    }

    return { meses, ingresos, gastos };
  }

  getUltimosPagos(limite = 5) {
    return this.db.prepare(`
      SELECT r.id, r.numero_recibo, r.fecha_recibo, r.total,
        c.codigo as cuenta_codigo, p.nombre_completo as propietario_nombre
      FROM recibos r
      INNER JOIN cuentas c ON c.id = r.cuenta_id
      INNER JOIN propietarios p ON p.id = r.propietario_id
      WHERE r.estado != 'Anulado'
      ORDER BY r.fecha_recibo DESC, r.id DESC
      LIMIT ?
    `).all(limite);
  }

  getUltimosGastos(limite = 5) {
    return this.db.prepare(`
      SELECT g.id, g.fecha_gasto, g.concepto,
        COALESCE(t.nombre_razon_social, g.proveedor) as proveedor, g.valor
      FROM gastos g
      LEFT JOIN terceros t ON t.id = g.tercero_id
      WHERE g.estado != 'Anulado'
      ORDER BY g.fecha_gasto DESC, g.id DESC
      LIMIT ?
    `).all(limite);
  }

  getUltimosMovimientosCaja(limite = 5) {
    return this.db.prepare(`
      SELECT id, tipo, origen, destino, monto, concepto, fecha_movimiento
      FROM movimientos
      ORDER BY fecha_movimiento DESC, id DESC
      LIMIT ?
    `).all(limite);
  }
}

module.exports = DashboardRepository;
