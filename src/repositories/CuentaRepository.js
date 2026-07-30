class CuentaRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  findAll(params = {}) {
    const { page = 1, limit = 10, search = '', estado = '', categoria = '' } = params;
    const offset = (page - 1) * limit;

    let query = `
      SELECT
        c.id,
        c.codigo,
        c.direccion,
        c.nombre_predio,
        c.estado,
        c.observaciones,
        c.fecha_creacion,
        c.fecha_actualizacion,
        cat.nombre as categoria_actual,
        p.nombre_completo as propietario_actual
      FROM cuentas c
      LEFT JOIN cuenta_categorias cc ON cc.cuenta_id = c.id AND cc.fecha_fin IS NULL
      LEFT JOIN categorias cat ON cat.id = cc.categoria_id
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      WHERE 1=1
    `;
    const queryParams = [];

    // La búsqueda cubre código, dirección, nombre de predio, y el nombre/identificación de
    // CUALQUIER propietario que haya tenido la cuenta (actual o histórico): en la práctica la
    // gente rara vez recuerda su código, a veces no sabe si la cuenta sigue a nombre del
    // propietario anterior, y a veces solo tiene la cédula a mano.
    const condicionBusqueda = `(
      c.codigo LIKE ? OR c.direccion LIKE ? OR c.nombre_predio LIKE ? OR EXISTS (
        SELECT 1 FROM cuenta_propietarios cp2
        INNER JOIN propietarios p2 ON p2.id = cp2.propietario_id
        WHERE cp2.cuenta_id = c.id
          AND (p2.nombre_completo LIKE ? OR p2.numero_identificacion LIKE ?)
      )
    )`;

    if (search) {
      query += ` AND ${condicionBusqueda}`;
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (estado) {
      query += ' AND c.estado = ?';
      queryParams.push(estado);
    }

    if (categoria) {
      query += ' AND cat.nombre = ?';
      queryParams.push(categoria);
    }

    const countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM cuentas c
      LEFT JOIN cuenta_categorias cc ON cc.cuenta_id = c.id AND cc.fecha_fin IS NULL
      LEFT JOIN categorias cat ON cat.id = cc.categoria_id
      WHERE 1=1
      ${search ? ` AND ${condicionBusqueda}` : ''}
      ${estado ? ' AND c.estado = ?' : ''}
      ${categoria ? ' AND cat.nombre = ?' : ''}
    `;
    const total = this.db.prepare(countQuery).get(...queryParams).total;

    query += ' ORDER BY c.id DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const cuentas = this.db.prepare(query).all(...queryParams);

    return {
      data: cuentas,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  findById(id) {
    const query = `
      SELECT 
        c.*,
        cat.nombre as categoria_actual,
        p.nombre_completo as propietario_actual,
        p.numero_identificacion as propietario_identificacion
      FROM cuentas c
      LEFT JOIN cuenta_categorias cc ON cc.cuenta_id = c.id AND cc.fecha_fin IS NULL
      LEFT JOIN categorias cat ON cat.id = cc.categoria_id
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      WHERE c.id = ?
    `;
    return this.db.prepare(query).get(id);
  }

  findByCodigo(codigo) {
    return this.db.prepare('SELECT * FROM cuentas WHERE codigo = ?').get(codigo);
  }

  create(cuenta) {
    const ejecutar = this.db.transaction(() => {
      const result = this.db.prepare(`
        INSERT INTO cuentas (codigo, direccion, nombre_predio, estado, observaciones, lat_acometida, lon_acometida, lat_vivienda, lon_vivienda)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cuenta.codigo,
        cuenta.direccion,
        cuenta.nombre_predio || null,
        cuenta.estado || 'Activo',
        cuenta.observaciones || null,
        cuenta.lat_acometida ?? null,
        cuenta.lon_acometida ?? null,
        cuenta.lat_vivienda ?? null,
        cuenta.lon_vivienda ?? null
      );

      const cuentaId = result.lastInsertRowid;

      // Toda cuenta nueva inicia con un historial de categoría. Por defecto desde hoy, pero
      // puede indicarse una fecha pasada (ej. cuenta que ya existía antes de usar el sistema)
      // para poder cobrar retroactivamente meses anteriores a la fecha de registro en el sistema.
      this.db.prepare(`
        INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
        VALUES (?, ?, ?)
      `).run(cuentaId, cuenta.categoria_id, cuenta.categoria_fecha_inicio || new Date().toISOString().split('T')[0]);

      return cuentaId;
    });

    return ejecutar();
  }

  update(id, cuenta) {
    const stmt = this.db.prepare(`
      UPDATE cuentas
      SET codigo = ?, direccion = ?, nombre_predio = ?, observaciones = ?,
          lat_acometida = ?, lon_acometida = ?, lat_vivienda = ?, lon_vivienda = ?,
          fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(
      cuenta.codigo,
      cuenta.direccion,
      cuenta.nombre_predio || null,
      cuenta.observaciones || null,
      cuenta.lat_acometida ?? null,
      cuenta.lon_acometida ?? null,
      cuenta.lat_vivienda ?? null,
      cuenta.lon_vivienda ?? null,
      id
    );
  }

  changeStatus(id, estado) {
    const stmt = this.db.prepare(`
      UPDATE cuentas 
      SET estado = ?, fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    stmt.run(estado, id);
  }

  getStats() {
    // COALESCE es necesario porque SUM() sobre una tabla vacía devuelve NULL (no 0),
    // sin importar que el CASE siempre evalúe a 0: simplemente no hay filas que sumar.
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN estado = 'Activo' THEN 1 ELSE 0 END), 0) as activas,
        COALESCE(SUM(CASE WHEN estado = 'Inactivo' THEN 1 ELSE 0 END), 0) as inactivas,
        COALESCE(SUM(CASE WHEN estado = 'Suspendido' THEN 1 ELSE 0 END), 0) as suspendidas
      FROM cuentas
    `).get();

    return stats;
  }

  getCategorias() {
    return this.db.prepare('SELECT * FROM categorias WHERE activo = 1 ORDER BY nombre').all();
  }
}

module.exports = CuentaRepository;
