class CajaRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  transaccion(fn) {
    return this.db.transaction(fn)();
  }

  getSaldoInicial(clave) {
    const config = this.db.prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave);
    return parseFloat(config?.valor || 0);
  }

  // Saldo = inicial + ingresos directos - egresos/traslados que salen - + traslados que entran.
  // Un 'Traslado' siempre tiene origen y destino (ej. Consignación: origen=Caja, destino=Banco),
  // por eso se evalúa tanto cuando el origen de un movimiento es esta cuenta (sale dinero)
  // como cuando es el destino (entra dinero), a diferencia de Ingreso/Egreso que solo afectan al origen.
  getSaldo(cuentaContable) {
    const inicialClave = cuentaContable === 'Caja' ? 'saldo_caja_inicial' : 'saldo_banco_inicial';
    const inicial = this.getSaldoInicial(inicialClave);

    const row = this.db.prepare(`
      SELECT COALESCE(SUM(
        CASE
          WHEN origen = ? AND tipo = 'Ingreso' THEN monto
          WHEN origen = ? AND tipo IN ('Egreso', 'Traslado') THEN -monto
          WHEN destino = ? AND tipo = 'Traslado' THEN monto
          ELSE 0
        END
      ), 0) as total
      FROM movimientos
    `).get(cuentaContable, cuentaContable, cuentaContable);

    return inicial + row.total;
  }

  getSaldoCaja() {
    return this.getSaldo('Caja');
  }

  getSaldoBanco() {
    return this.getSaldo('Banco');
  }

  findAllMovimientos(params = {}) {
    const { page = 1, limit = 15, cuenta = '', tipo = '', fechaDesde = '', fechaHasta = '' } = params;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM movimientos WHERE 1=1';
    const queryParams = [];

    if (cuenta) {
      query += ' AND (origen = ? OR destino = ?)';
      queryParams.push(cuenta, cuenta);
    }

    if (tipo) {
      query += ' AND tipo = ?';
      queryParams.push(tipo);
    }

    if (fechaDesde) {
      query += ' AND fecha_movimiento >= ?';
      queryParams.push(fechaDesde);
    }

    if (fechaHasta) {
      query += ' AND fecha_movimiento <= ?';
      queryParams.push(fechaHasta);
    }

    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const total = this.db.prepare(countQuery).get(...queryParams).total;

    query += ' ORDER BY fecha_movimiento DESC, id DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const data = this.db.prepare(query).all(...queryParams);

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  // Resumen de Ingresos/Gastos/Flujo neto en un rango de fechas. Los 'Traslado' (ej.
  // consignación de caja a banco) se excluyen a propósito: son movimientos internos entre
  // cuentas propias, no ingresos ni gastos reales.
  getResumenPeriodo(fechaDesde = '', fechaHasta = '') {
    let query = `SELECT tipo, COALESCE(SUM(monto), 0) as total FROM movimientos WHERE tipo IN ('Ingreso', 'Egreso')`;
    const params = [];

    if (fechaDesde) { query += ' AND fecha_movimiento >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND fecha_movimiento <= ?'; params.push(fechaHasta); }
    query += ' GROUP BY tipo';

    const rows = this.db.prepare(query).all(...params);
    const ingresos = rows.find(r => r.tipo === 'Ingreso')?.total || 0;
    const gastos = rows.find(r => r.tipo === 'Egreso')?.total || 0;

    return { ingresos, gastos, flujoNeto: ingresos - gastos };
  }

  // Flujo de caja (Caja+Banco combinados): saldo inicial al comenzar el período, entradas y
  // salidas de dinero dentro del período, y el saldo final resultante. Los 'Traslado' (caja a
  // banco) se excluyen porque son movimientos internos entre cuentas propias: no son entradas
  // ni salidas reales de dinero del acueducto, y al combinar Caja+Banco se cancelan entre sí.
  getResumenFlujoCaja(fechaDesde = '', fechaHasta = '') {
    const saldoInicialConfigurado = this.getSaldoInicial('saldo_caja_inicial') + this.getSaldoInicial('saldo_banco_inicial');

    let saldoInicial = saldoInicialConfigurado;
    if (fechaDesde) {
      const antes = this.db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN tipo = 'Ingreso' THEN monto WHEN tipo = 'Egreso' THEN -monto ELSE 0 END), 0) as total
        FROM movimientos
        WHERE fecha_movimiento < ?
      `).get(fechaDesde);
      saldoInicial += antes.total;
    }

    const { ingresos: entradas, gastos: salidas } = this.getResumenPeriodo(fechaDesde, fechaHasta);

    return { saldoInicial, entradas, salidas, saldoFinal: saldoInicial + entradas - salidas };
  }

  // Resuelve a qué cuenta contable corresponde un concepto, según el mapeo configurable
  // (mapeo_conceptos_contables). Si no hay un mapeo específico, usa el "__default__" del módulo.
  // Preparación para una futura contabilidad de doble partida: por ahora solo se guarda el dato,
  // no se generan asientos.
  resolverCuentaContable(modulo, concepto) {
    const exacto = this.db.prepare(`
      SELECT cuenta_contable_id FROM mapeo_conceptos_contables WHERE modulo = ? AND concepto = ?
    `).get(modulo, concepto);
    if (exacto) return exacto.cuenta_contable_id;

    const porDefecto = this.db.prepare(`
      SELECT cuenta_contable_id FROM mapeo_conceptos_contables WHERE modulo = ? AND concepto = '__default__'
    `).get(modulo);
    return porDefecto ? porDefecto.cuenta_contable_id : null;
  }

  crearMovimiento({ tipo, origen, destino = null, monto, concepto, referenciaId = null, referenciaTipo = null, fechaMovimiento, observaciones = null }) {
    const cuentaContableId = this.resolverCuentaContable('Movimiento', origen);
    const result = this.db.prepare(`
      INSERT INTO movimientos (tipo, origen, destino, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento, observaciones, cuenta_contable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, origen, destino, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, observaciones, cuentaContableId);
    return result.lastInsertRowid;
  }
}

module.exports = CajaRepository;
