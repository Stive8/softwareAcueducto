class CajaRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
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

  crearMovimiento({ tipo, origen, destino = null, monto, concepto, referenciaId = null, referenciaTipo = null, fechaMovimiento, observaciones = null }) {
    const result = this.db.prepare(`
      INSERT INTO movimientos (tipo, origen, destino, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, origen, destino, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, observaciones);
    return result.lastInsertRowid;
  }
}

module.exports = CajaRepository;
