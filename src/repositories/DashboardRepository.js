class DashboardRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
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

  // Cuentas activas cuyo último mes de sostenimiento pagado cubre el mes actual (o más adelante)
  getCuentasAlDia() {
    const periodoActual = this.getPeriodoActualCodigo();

    const result = this.db.prepare(`
      SELECT COUNT(*) as total
      FROM cuentas c
      WHERE c.estado = 'Activo'
      AND (
        SELECT MAX(anio * 12 + (mes - 1)) FROM pago_periodos WHERE cuenta_id = c.id
      ) >= ?
    `).get(periodoActual);

    return result.total;
  }

  // Cuentas activas cuyo último mes pagado es anterior al mes actual (o que nunca han pagado)
  getCuentasEnMora() {
    const periodoActual = this.getPeriodoActualCodigo();

    const result = this.db.prepare(`
      SELECT COUNT(*) as total
      FROM cuentas c
      WHERE c.estado = 'Activo'
      AND COALESCE((
        SELECT MAX(anio * 12 + (mes - 1)) FROM pago_periodos WHERE cuenta_id = c.id
      ), -1) < ?
    `).get(periodoActual);

    return result.total;
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
}

module.exports = DashboardRepository;
