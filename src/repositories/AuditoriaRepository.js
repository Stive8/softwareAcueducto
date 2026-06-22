class AuditoriaRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  registrar({ usuarioId, accion, tabla, registroId, datosNuevos }) {
    this.db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, tabla, registro_id, datos_nuevos)
      VALUES (?, ?, ?, ?, ?)
    `).run(usuarioId, accion, tabla, registroId ?? null, datosNuevos ?? null);
  }

  findAll(params = {}) {
    const { page = 1, limit = 50, usuarioId = '', tabla = '', fechaDesde = '', fechaHasta = '' } = params;
    const offset = (page - 1) * limit;

    let query = `
      SELECT a.id, a.accion, a.tabla, a.registro_id, a.datos_nuevos, a.fecha_accion,
             u.usuario, u.nombre_completo
      FROM auditoria a
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE 1=1
    `;
    const queryParams = [];

    if (usuarioId) { query += ' AND a.usuario_id = ?'; queryParams.push(usuarioId); }
    if (tabla) { query += ' AND a.tabla = ?'; queryParams.push(tabla); }
    if (fechaDesde) { query += " AND date(a.fecha_accion) >= ?"; queryParams.push(fechaDesde); }
    if (fechaHasta) { query += " AND date(a.fecha_accion) <= ?"; queryParams.push(fechaHasta); }

    const countQuery = `SELECT COUNT(*) as total FROM auditoria a WHERE 1=1
      ${usuarioId ? ' AND a.usuario_id = ?' : ''}
      ${tabla ? ' AND a.tabla = ?' : ''}
      ${fechaDesde ? ' AND date(a.fecha_accion) >= ?' : ''}
      ${fechaHasta ? ' AND date(a.fecha_accion) <= ?' : ''}
    `;
    const total = this.db.prepare(countQuery).get(...queryParams).total;

    query += ' ORDER BY a.id DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const data = this.db.prepare(query).all(...queryParams);
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  // Cantidad de acciones por usuario en un período: para el Informe de Empalme, da una idea de
  // quién operó el sistema mientras estuvo a cargo, sin tener que revisar el detalle fila por fila.
  getResumenPorUsuario(fechaDesde = '', fechaHasta = '') {
    let query = `
      SELECT COALESCE(u.nombre_completo, 'Usuario eliminado') as nombre_completo, COUNT(*) as cantidad
      FROM auditoria a
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE 1=1
    `;
    const params = [];
    if (fechaDesde) { query += ' AND date(a.fecha_accion) >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND date(a.fecha_accion) <= ?'; params.push(fechaHasta); }
    query += ' GROUP BY a.usuario_id ORDER BY cantidad DESC';
    return this.db.prepare(query).all(...params);
  }
}

module.exports = AuditoriaRepository;
