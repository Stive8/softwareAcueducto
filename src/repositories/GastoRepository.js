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

  create(gasto) {
    const cuentaContableId = this.resolverCuentaContable('Gasto', gasto.tipoGasto || '__default__');

    const result = this.db.prepare(`
      INSERT INTO gastos (fecha_gasto, concepto, tipo_gasto, proveedor, nit_cedula, valor, metodo_pago, observaciones, ruta_soporte, cuenta_contable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      gasto.fechaGasto,
      gasto.concepto,
      gasto.tipoGasto || null,
      gasto.proveedor || null,
      gasto.nitCedula || null,
      gasto.valor,
      gasto.metodoPago,
      gasto.observaciones || null,
      gasto.rutaSoporte || null,
      cuentaContableId
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
    const cuentaContableId = this.resolverCuentaContable('Movimiento', origen);
    const result = this.db.prepare(`
      INSERT INTO movimientos (tipo, origen, destino, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento, observaciones, cuenta_contable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, origen, destino, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, observaciones, cuentaContableId);
    return result.lastInsertRowid;
  }

  transaccion(fn) {
    return this.db.transaction(fn)();
  }
}

module.exports = GastoRepository;
