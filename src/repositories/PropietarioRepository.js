class PropietarioRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  findAll(params = {}) {
    const { page = 1, limit = 10, search = '' } = params;
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM propietarios WHERE 1=1';
    const queryParams = [];

    if (search) {
      query += ' AND (nombre_completo LIKE ? OR numero_identificacion LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const total = this.db.prepare(countQuery).get(...queryParams).total;

    query += ' ORDER BY nombre_completo ASC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const propietarios = this.db.prepare(query).all(...queryParams);

    return {
      data: propietarios,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM propietarios WHERE id = ?').get(id);
  }

  findByIdentificacion(numero_identificacion) {
    return this.db.prepare('SELECT * FROM propietarios WHERE numero_identificacion = ?').get(numero_identificacion);
  }

  create(propietario) {
    const stmt = this.db.prepare(`
      INSERT INTO propietarios (nombre_completo, numero_identificacion, telefono, email, observaciones)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      propietario.nombre_completo,
      propietario.numero_identificacion || null,
      propietario.telefono || null,
      propietario.email || null,
      propietario.observaciones || null
    );
    
    return result.lastInsertRowid;
  }

  update(id, propietario) {
    const stmt = this.db.prepare(`
      UPDATE propietarios 
      SET nombre_completo = ?, numero_identificacion = ?, telefono = ?, 
          email = ?, observaciones = ?
      WHERE id = ?
    `);
    
    stmt.run(
      propietario.nombre_completo,
      propietario.numero_identificacion || null,
      propietario.telefono || null,
      propietario.email || null,
      propietario.observaciones || null,
      id
    );
  }

  getCuentasActuales(propietarioId) {
    return this.db.prepare(`
      SELECT c.id, c.codigo, c.direccion, c.estado, cp.fecha_inicio
      FROM cuentas c
      INNER JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id
      WHERE cp.propietario_id = ? AND cp.fecha_fin IS NULL
      ORDER BY c.codigo ASC
    `).all(propietarioId);
  }

  getHistorialCuentas(propietarioId) {
    return this.db.prepare(`
      SELECT c.codigo, c.direccion, cp.fecha_inicio, cp.fecha_fin, cp.observaciones
      FROM cuenta_propietarios cp
      INNER JOIN cuentas c ON c.id = cp.cuenta_id
      WHERE cp.propietario_id = ?
      ORDER BY cp.fecha_inicio DESC
    `).all(propietarioId);
  }

  asignarACuenta(cuentaId, propietarioId, fechaInicio, observaciones = null) {
    const ejecutar = this.db.transaction(() => {
      // Finalizar propietario actual si existe (un día antes del nuevo inicio, sin solapamiento)
      this.db.prepare(`
        UPDATE cuenta_propietarios
        SET fecha_fin = date(?, '-1 day')
        WHERE cuenta_id = ? AND fecha_fin IS NULL
      `).run(fechaInicio, cuentaId);

      // Asignar nuevo propietario
      const result = this.db.prepare(`
        INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio, observaciones)
        VALUES (?, ?, ?, ?)
      `).run(cuentaId, propietarioId, fechaInicio, observaciones);

      return result.lastInsertRowid;
    });

    return ejecutar();
  }

  getPropietarioActualCuenta(cuentaId) {
    return this.db.prepare(`
      SELECT p.*, cp.fecha_inicio
      FROM propietarios p
      INNER JOIN cuenta_propietarios cp ON cp.propietario_id = p.id
      WHERE cp.cuenta_id = ? AND cp.fecha_fin IS NULL
    `).get(cuentaId);
  }

  getHistorialPropietariosCuenta(cuentaId) {
    return this.db.prepare(`
      SELECT p.nombre_completo, p.numero_identificacion, 
             cp.fecha_inicio, cp.fecha_fin, cp.observaciones
      FROM cuenta_propietarios cp
      INNER JOIN propietarios p ON p.id = cp.propietario_id
      WHERE cp.cuenta_id = ?
      ORDER BY cp.fecha_inicio DESC
    `).all(cuentaId);
  }
}

module.exports = PropietarioRepository;
