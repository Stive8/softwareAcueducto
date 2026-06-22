class ReciboRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  findAll(params = {}) {
    const { page = 1, limit = 10, search = '', fechaDesde = '', fechaHasta = '' } = params;
    const offset = (page - 1) * limit;

    let query = `
      SELECT r.id, r.numero_recibo, r.fecha_recibo, r.total, r.metodo_pago,
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
