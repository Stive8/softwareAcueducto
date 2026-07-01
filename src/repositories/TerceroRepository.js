class TerceroRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  // Sin paginación: a diferencia de Propietarios, este catálogo es pequeño (proveedores y
  // aliados ocasionales de una sola asociación), no hace falta.
  findAll(params = {}) {
    const { busqueda = '', soloActivos = false, soloProveedores = false } = params;

    let query = 'SELECT * FROM terceros WHERE 1=1';
    const queryParams = [];

    if (busqueda) {
      query += ' AND (nombre_razon_social LIKE ? OR nombre_comercial LIKE ? OR numero_identificacion LIKE ?)';
      queryParams.push(`%${busqueda}%`, `%${busqueda}%`, `%${busqueda}%`);
    }

    if (soloActivos) query += ' AND activo = 1';
    if (soloProveedores) query += ' AND es_proveedor = 1';

    query += ' ORDER BY nombre_razon_social ASC';

    return this.db.prepare(query).all(...queryParams);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM terceros WHERE id = ?').get(id);
  }

  findByIdentificacion(numeroIdentificacion) {
    return this.db.prepare('SELECT * FROM terceros WHERE numero_identificacion = ?').get(numeroIdentificacion);
  }

  create(tercero) {
    const result = this.db.prepare(`
      INSERT INTO terceros (
        tipo_identificacion, numero_identificacion, nombre_razon_social, nombre_comercial,
        telefono, email, direccion, observaciones, es_proveedor, es_otro,
        es_contratista, es_aliado, es_cliente, es_empleado, es_entidad_publica
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tercero.tipoIdentificacion,
      tercero.numeroIdentificacion ? tercero.numeroIdentificacion.trim() : null,
      tercero.nombreRazonSocial.trim(),
      tercero.nombreComercial || null,
      tercero.telefono || null,
      tercero.email || null,
      tercero.direccion || null,
      tercero.observaciones || null,
      tercero.esProveedor ? 1 : 0,
      tercero.esOtro ? 1 : 0,
      tercero.esContratista ? 1 : 0,
      tercero.esAliado ? 1 : 0,
      tercero.esCliente ? 1 : 0,
      tercero.esEmpleado ? 1 : 0,
      tercero.esEntidadPublica ? 1 : 0
    );

    return result.lastInsertRowid;
  }

  update(id, tercero) {
    this.db.prepare(`
      UPDATE terceros SET
        tipo_identificacion = ?, numero_identificacion = ?, nombre_razon_social = ?, nombre_comercial = ?,
        telefono = ?, email = ?, direccion = ?, observaciones = ?, es_proveedor = ?, es_otro = ?,
        es_contratista = ?, es_aliado = ?, es_cliente = ?, es_empleado = ?, es_entidad_publica = ?
      WHERE id = ?
    `).run(
      tercero.tipoIdentificacion,
      tercero.numeroIdentificacion ? tercero.numeroIdentificacion.trim() : null,
      tercero.nombreRazonSocial.trim(),
      tercero.nombreComercial || null,
      tercero.telefono || null,
      tercero.email || null,
      tercero.direccion || null,
      tercero.observaciones || null,
      tercero.esProveedor ? 1 : 0,
      tercero.esOtro ? 1 : 0,
      tercero.esContratista ? 1 : 0,
      tercero.esAliado ? 1 : 0,
      tercero.esCliente ? 1 : 0,
      tercero.esEmpleado ? 1 : 0,
      tercero.esEntidadPublica ? 1 : 0,
      id
    );
  }

  toggleActivo(id) {
    this.db.prepare('UPDATE terceros SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  }
}

module.exports = TerceroRepository;
