class ReciboRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  findAll(params = {}) {
    const { page = 1, limit = 10, search = '', fechaDesde = '', fechaHasta = '' } = params;
    const offset = (page - 1) * limit;

    let query = `
      SELECT r.id, r.numero_recibo, r.fecha_recibo, r.total, r.metodo_pago, r.estado,
             c.codigo as cuenta_codigo, c.direccion as cuenta_direccion,
             p.nombre_completo as propietario_nombre
      FROM recibos r
      INNER JOIN cuentas c ON c.id = r.cuenta_id
      INNER JOIN propietarios p ON p.id = r.propietario_id
      WHERE 1=1
    `;
    const queryParams = [];

    if (search) {
      query += ' AND (CAST(r.numero_recibo AS TEXT) LIKE ? OR c.codigo LIKE ? OR c.direccion LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (fechaDesde) {
      query += ' AND r.fecha_recibo >= ?';
      queryParams.push(fechaDesde);
    }

    if (fechaHasta) {
      query += ' AND r.fecha_recibo <= ?';
      queryParams.push(fechaHasta);
    }

    const countQuery = `
      SELECT COUNT(*) as total
      FROM recibos r
      INNER JOIN cuentas c ON c.id = r.cuenta_id
      WHERE 1=1
      ${search ? ' AND (CAST(r.numero_recibo AS TEXT) LIKE ? OR c.codigo LIKE ? OR c.direccion LIKE ?)' : ''}
      ${fechaDesde ? ' AND r.fecha_recibo >= ?' : ''}
      ${fechaHasta ? ' AND r.fecha_recibo <= ?' : ''}
    `;
    const total = this.db.prepare(countQuery).get(...queryParams).total;

    query += ' ORDER BY r.numero_recibo DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const data = this.db.prepare(query).all(...queryParams);

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  findById(id) {
    return this.db.prepare(`
      SELECT r.*, c.codigo as cuenta_codigo, c.direccion as cuenta_direccion,
             p.nombre_completo as propietario_nombre, p.numero_identificacion as propietario_identificacion
      FROM recibos r
      INNER JOIN cuentas c ON c.id = r.cuenta_id
      INNER JOIN propietarios p ON p.id = r.propietario_id
      WHERE r.id = ?
    `).get(id);
  }

  getDetalles(reciboId) {
    return this.db.prepare(`
      SELECT * FROM recibo_detalles WHERE recibo_id = ? ORDER BY id ASC
    `).all(reciboId);
  }

  transaccion(fn) {
    return this.db.transaction(fn)();
  }

  crearMovimiento({ tipo, origen, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, observaciones }) {
    return this.db.prepare(`
      INSERT INTO movimientos (tipo, origen, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, origen, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, observaciones || null).lastInsertRowid;
  }

  // Anular un recibo libera los meses/abonos/conexión que cubría, para que se puedan volver
  // a cobrar, pero conserva el recibo y su detalle como constancia de que existió y se anuló.
  anular(id, motivo) {
    const detalleIds = this.db.prepare('SELECT id FROM recibo_detalles WHERE recibo_id = ?').all(id).map(d => d.id);

    if (detalleIds.length > 0) {
      const placeholders = detalleIds.map(() => '?').join(',');

      this.db.prepare(`DELETE FROM pago_periodos WHERE recibo_detalle_id IN (${placeholders})`).run(...detalleIds);
      this.db.prepare(`DELETE FROM cuenta_creditos WHERE recibo_detalle_id IN (${placeholders})`).run(...detalleIds);

      const puntosAfectados = this.db.prepare(
        `SELECT DISTINCT nuevo_punto_id FROM nuevo_punto_abonos WHERE recibo_detalle_id IN (${placeholders})`
      ).all(...detalleIds);

      this.db.prepare(`DELETE FROM nuevo_punto_abonos WHERE recibo_detalle_id IN (${placeholders})`).run(...detalleIds);

      for (const { nuevo_punto_id } of puntosAfectados) {
        const punto = this.db.prepare('SELECT valor_total FROM nuevos_puntos WHERE id = ?').get(nuevo_punto_id);
        const totalAbonado = this.db.prepare(
          'SELECT COALESCE(SUM(monto), 0) as total FROM nuevo_punto_abonos WHERE nuevo_punto_id = ?'
        ).get(nuevo_punto_id).total;
        const saldoPendiente = Math.max(punto.valor_total - totalAbonado, 0);
        const nuevoEstado = saldoPendiente <= 0 ? 'Pagado' : 'Pendiente';
        this.db.prepare('UPDATE nuevos_puntos SET saldo_pendiente = ?, estado = ? WHERE id = ?')
          .run(saldoPendiente, nuevoEstado, nuevo_punto_id);
      }
    }

    this.db.prepare(`
      UPDATE recibos SET estado = 'Anulado', fecha_anulacion = CURRENT_TIMESTAMP, motivo_anulacion = ?
      WHERE id = ?
    `).run(motivo, id);
  }

  // Recibos del talonario físico anulados ANTES de representar un cobro real (no tienen
  // cuenta, valor ni movimiento de caja asociado): solo una constancia de número y motivo.
  numeroRecibioExiste(numeroRecibo) {
    const enRecibos = this.db.prepare('SELECT 1 FROM recibos WHERE numero_recibo = ?').get(numeroRecibo);
    if (enRecibos) return true;
    const enAnulados = this.db.prepare('SELECT 1 FROM recibos_anulados_fisicos WHERE numero_recibo = ?').get(numeroRecibo);
    return !!enAnulados;
  }

  getConsecutivoRecibo() {
    const row = this.db.prepare("SELECT valor FROM configuracion WHERE clave = 'consecutivo_recibos'").get();
    return parseInt(row?.valor || '1', 10);
  }

  // El número de un recibo anulado del talonario físico ocupa un puesto en la MISMA secuencia
  // consecutiva que los recibos reales (es el mismo talonario). Si se anula un número que está en
  // o por delante del próximo a emitir, hay que correr el contador para que no se vuelva a usar.
  crearAnuladoFisico({ numeroRecibo, fecha, motivo }) {
    return this.transaccion(() => {
      const id = this.db.prepare(`
        INSERT INTO recibos_anulados_fisicos (numero_recibo, fecha, motivo)
        VALUES (?, ?, ?)
      `).run(numeroRecibo, fecha || null, motivo).lastInsertRowid;

      const consecutivoActual = this.getConsecutivoRecibo();
      if (numeroRecibo >= consecutivoActual) {
        this.db.prepare(`
          UPDATE configuracion SET valor = ?, fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE clave = 'consecutivo_recibos'
        `).run(String(numeroRecibo + 1));
      }

      return id;
    });
  }

  getAnuladosFisicos() {
    return this.db.prepare(`
      SELECT * FROM recibos_anulados_fisicos ORDER BY numero_recibo DESC
    `).all();
  }

  getConfiguracionAsociacion() {
    const rows = this.db.prepare(`
      SELECT clave, valor FROM configuracion
      WHERE clave IN ('nombre_asociacion', 'nit', 'direccion', 'telefono', 'email')
    `).all();

    const config = {};
    rows.forEach(r => { config[r.clave] = r.valor; });
    return config;
  }
}

module.exports = ReciboRepository;
