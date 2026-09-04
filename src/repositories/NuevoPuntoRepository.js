class NuevoPuntoRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  transaccion(fn) {
    return this.db.transaction(fn)();
  }

  findAll(params = {}) {
    const { page = 1, limit = 10, estado = '', search = '' } = params;
    const offset = (page - 1) * limit;

    let query = `
      SELECT np.*, c.codigo as cuenta_codigo, c.direccion as cuenta_direccion,
        (SELECT COALESCE(SUM(monto), 0) FROM nuevo_punto_abonos WHERE nuevo_punto_id = np.id) as total_abonado
      FROM nuevos_puntos np
      INNER JOIN cuentas c ON c.id = np.cuenta_id
      WHERE 1=1
    `;
    const queryParams = [];

    if (estado) {
      query += ' AND np.estado = ?';
      queryParams.push(estado);
    }

    if (search) {
      query += ' AND (c.codigo LIKE ? OR c.direccion LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    const countQuery = `
      SELECT COUNT(*) as total FROM nuevos_puntos np
      INNER JOIN cuentas c ON c.id = np.cuenta_id
      WHERE 1=1
      ${estado ? ' AND np.estado = ?' : ''}
      ${search ? ' AND (c.codigo LIKE ? OR c.direccion LIKE ?)' : ''}
    `;
    const total = this.db.prepare(countQuery).get(...queryParams).total;

    query += ' ORDER BY np.fecha_registro DESC, np.id DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const data = this.db.prepare(query).all(...queryParams);

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  findById(id) {
    return this.db.prepare(`
      SELECT np.*, c.codigo as cuenta_codigo, c.direccion as cuenta_direccion
      FROM nuevos_puntos np
      INNER JOIN cuentas c ON c.id = np.cuenta_id
      WHERE np.id = ?
    `).get(id);
  }

  findByCuentaId(cuentaId) {
    return this.db.prepare(`
      SELECT * FROM nuevos_puntos WHERE cuenta_id = ? ORDER BY fecha_registro DESC, id DESC
    `).all(cuentaId);
  }

  // Misma consulta que findByCuentaId, pero para varias cuentas de una sola vez -- lo usa
  // CarteraService.getIndicadoresMoraTodas para no disparar un findByCuentaId por cuenta al
  // listar el estado de mora de todas las cuentas (ver CarteraRepository, sección "por lotes").
  findByCuentaIdsBulk(cuentaIds) {
    const mapa = new Map();
    if (cuentaIds.length === 0) return mapa;

    const TAMANO_LOTE = 500;
    for (let i = 0; i < cuentaIds.length; i += TAMANO_LOTE) {
      const lote = cuentaIds.slice(i, i + TAMANO_LOTE);
      const placeholders = lote.map(() => '?').join(', ');
      const filas = this.db.prepare(`
        SELECT * FROM nuevos_puntos
        WHERE cuenta_id IN (${placeholders})
        ORDER BY cuenta_id ASC, fecha_registro DESC, id DESC
      `).all(...lote);

      for (const f of filas) {
        if (!mapa.has(f.cuenta_id)) mapa.set(f.cuenta_id, []);
        mapa.get(f.cuenta_id).push(f);
      }
    }
    return mapa;
  }

  getAbonos(nuevoPuntoId) {
    return this.db.prepare(`
      SELECT npa.*, r.numero_recibo
      FROM nuevo_punto_abonos npa
      LEFT JOIN recibo_detalles rd ON rd.id = npa.recibo_detalle_id
      LEFT JOIN recibos r ON r.id = rd.recibo_id
      WHERE npa.nuevo_punto_id = ?
      ORDER BY npa.fecha_abono DESC, npa.id DESC
    `).all(nuevoPuntoId);
  }

  create({ cuentaId, valorTotal, fechaRegistro, observaciones }) {
    const result = this.db.prepare(`
      INSERT INTO nuevos_puntos (cuenta_id, valor_total, saldo_pendiente, fecha_registro, observaciones)
      VALUES (?, ?, ?, ?, ?)
    `).run(cuentaId, valorTotal, valorTotal, fechaRegistro, observaciones || null);
    return result.lastInsertRowid;
  }

  crearAbono({ nuevoPuntoId, monto, fechaAbono, reciboDetalleId, observaciones }) {
    const result = this.db.prepare(`
      INSERT INTO nuevo_punto_abonos (nuevo_punto_id, recibo_detalle_id, monto, fecha_abono, observaciones)
      VALUES (?, ?, ?, ?, ?)
    `).run(nuevoPuntoId, reciboDetalleId, monto, fechaAbono, observaciones || null);
    return result.lastInsertRowid;
  }

  actualizarSaldoYEstado(nuevoPuntoId) {
    const punto = this.findById(nuevoPuntoId);
    const totalAbonado = this.db.prepare(
      'SELECT COALESCE(SUM(monto), 0) as total FROM nuevo_punto_abonos WHERE nuevo_punto_id = ?'
    ).get(nuevoPuntoId).total;

    const saldoPendiente = punto.valor_total - totalAbonado;
    const nuevoEstado = saldoPendiente <= 0 ? 'Pagado' : 'Pendiente';

    this.db.prepare(`
      UPDATE nuevos_puntos SET saldo_pendiente = ?, estado = ? WHERE id = ?
    `).run(Math.max(saldoPendiente, 0), nuevoEstado, nuevoPuntoId);

    return { saldoPendiente: Math.max(saldoPendiente, 0), estado: nuevoEstado };
  }

  cancelar(id, motivo) {
    this.db.prepare(`
      UPDATE nuevos_puntos SET estado = 'Cancelado', observaciones = ? WHERE id = ?
    `).run(motivo, id);
  }

  getConsecutivoRecibo() {
    const row = this.db.prepare("SELECT valor FROM configuracion WHERE clave = 'consecutivo_recibos'").get();
    return parseInt(row?.valor || '1', 10);
  }

  incrementarConsecutivoRecibo(siguiente) {
    this.db.prepare(`
      UPDATE configuracion SET valor = ?, fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE clave = 'consecutivo_recibos'
    `).run(String(siguiente));
  }

  crearRecibo({ numeroRecibo, cuentaId, propietarioId, fechaRecibo, total, metodoPago, observaciones }) {
    const result = this.db.prepare(`
      INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(numeroRecibo, cuentaId, propietarioId, fechaRecibo, total, metodoPago, observaciones || null);
    return result.lastInsertRowid;
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

  crearReciboDetalle({ reciboId, concepto, valor, observaciones = null }) {
    const cuentaContableId = this.resolverCuentaContable('RecibosDetalle', 'AbonoPuntoNuevo');
    const result = this.db.prepare(`
      INSERT INTO recibo_detalles (recibo_id, concepto, valor, observaciones, cuenta_contable_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(reciboId, concepto, valor, observaciones, cuentaContableId);
    return result.lastInsertRowid;
  }

  crearMovimiento({ tipo, origen, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento }) {
    const cuentaContableId = this.resolverCuentaContable('Movimiento', origen);
    const result = this.db.prepare(`
      INSERT INTO movimientos (tipo, origen, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento, cuenta_contable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, origen, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, cuentaContableId);
    return result.lastInsertRowid;
  }
}

module.exports = NuevoPuntoRepository;
