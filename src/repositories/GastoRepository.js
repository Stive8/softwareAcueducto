class GastoRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  findAll(params = {}) {
    const { page = 1, limit = 10, search = '', tipoGasto = '', proveedor = '', fechaDesde = '', fechaHasta = '', estado = '' } = params;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM gastos WHERE 1=1';
    const queryParams = [];

    if (search) {
      query += ' AND (concepto LIKE ? OR proveedor LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (tipoGasto) {
      query += ' AND tipo_gasto = ?';
      queryParams.push(tipoGasto);
    }

    if (proveedor) {
      query += ' AND proveedor LIKE ?';
      queryParams.push(`%${proveedor}%`);
    }

    if (fechaDesde) {
      query += ' AND fecha_gasto >= ?';
      queryParams.push(fechaDesde);
    }

    if (fechaHasta) {
      query += ' AND fecha_gasto <= ?';
      queryParams.push(fechaHasta);
    }

    if (estado) {
      query += ' AND estado = ?';
      queryParams.push(estado);
    }

    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const total = this.db.prepare(countQuery).get(...queryParams).total;

    query += ' ORDER BY fecha_gasto DESC, id DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const data = this.db.prepare(query).all(...queryParams);

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM gastos WHERE id = ?').get(id);
  }

  getTiposGasto() {
    return this.db.prepare(`
      SELECT DISTINCT tipo_gasto FROM gastos WHERE tipo_gasto IS NOT NULL AND tipo_gasto != '' ORDER BY tipo_gasto ASC
    `).all().map(r => r.tipo_gasto);
  }

  create(gasto) {
    const result = this.db.prepare(`
      INSERT INTO gastos (fecha_gasto, concepto, tipo_gasto, proveedor, nit_cedula, valor, metodo_pago, observaciones, ruta_soporte)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      gasto.fechaGasto,
      gasto.concepto,
      gasto.tipoGasto || null,
      gasto.proveedor || null,
      gasto.nitCedula || null,
      gasto.valor,
      gasto.metodoPago,
      gasto.observaciones || null,
      gasto.rutaSoporte || null
    );

    return result.lastInsertRowid;
  }

  anular(id, motivoAnulacion) {
    this.db.prepare(`
      UPDATE gastos
      SET estado = 'Anulado', fecha_anulacion = CURRENT_TIMESTAMP, motivo_anulacion = ?
      WHERE id = ?
    `).run(motivoAnulacion, id);
  }

  crearMovimiento({ tipo, origen, destino = null, monto, concepto, referenciaId = null, referenciaTipo = null, fechaMovimiento, observaciones = null }) {
    const result = this.db.prepare(`
      INSERT INTO movimientos (tipo, origen, destino, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, origen, destino, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, observaciones);
    return result.lastInsertRowid;
  }

  transaccion(fn) {
    return this.db.transaction(fn)();
  }
}

module.exports = GastoRepository;
