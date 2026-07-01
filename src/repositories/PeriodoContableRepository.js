class PeriodoContableRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  getAll() {
    return this.db.prepare(`
      SELECT p.*, u.nombre AS usuario_cierre_nombre
      FROM periodos_contables p
      LEFT JOIN usuarios u ON u.id = p.usuario_cierre_id
      ORDER BY p.anio DESC, p.mes DESC
    `).all();
  }

  getByAnioMes(anio, mes) {
    return this.db.prepare(`
      SELECT * FROM periodos_contables WHERE anio = ? AND mes = ?
    `).get(anio, mes);
  }

  getById(id) {
    return this.db.prepare(`
      SELECT p.*, u.nombre AS usuario_cierre_nombre
      FROM periodos_contables p
      LEFT JOIN usuarios u ON u.id = p.usuario_cierre_id
      WHERE p.id = ?
    `).get(id);
  }

  getPeriodosAbiertos() {
    return this.db.prepare(`
      SELECT * FROM periodos_contables WHERE estado = 'Abierto'
      ORDER BY anio DESC, mes DESC
    `).all();
  }

  // Crea un período nuevo en estado Abierto si no existe para ese mes/año.
  // Llamado automáticamente al registrar el primer movimiento del período.
  crearSiNoExiste(anio, mes) {
    const existente = this.getByAnioMes(anio, mes);
    if (existente) return existente;

    const info = this.db.prepare(`
      INSERT INTO periodos_contables (anio, mes, estado) VALUES (?, ?, 'Abierto')
    `).run(anio, mes);
    return this.getById(info.lastInsertRowid);
  }

  cerrar(id, usuarioCierreId, motivoCierre) {
    this.db.prepare(`
      UPDATE periodos_contables
      SET estado = 'Cerrado',
          fecha_cierre = CURRENT_TIMESTAMP,
          usuario_cierre_id = ?,
          motivo_cierre = ?
      WHERE id = ? AND estado = 'Abierto'
    `).run(usuarioCierreId, motivoCierre || null, id);
  }

  bloquear(id, usuarioCierreId, motivoCierre) {
    this.db.prepare(`
      UPDATE periodos_contables
      SET estado = 'Bloqueado',
          fecha_cierre = COALESCE(fecha_cierre, CURRENT_TIMESTAMP),
          usuario_cierre_id = COALESCE(usuario_cierre_id, ?),
          motivo_cierre = COALESCE(motivo_cierre, ?)
      WHERE id = ? AND estado IN ('Abierto', 'Cerrado')
    `).run(usuarioCierreId, motivoCierre || null, id);
  }

  reabrir(id) {
    // Solo permite reabrir un período Cerrado; los Bloqueados son definitivos.
    this.db.prepare(`
      UPDATE periodos_contables
      SET estado = 'Abierto',
          fecha_cierre = NULL,
          usuario_cierre_id = NULL,
          motivo_cierre = NULL
      WHERE id = ? AND estado = 'Cerrado'
    `).run(id);
  }

  actualizarNotas(id, notas) {
    this.db.prepare(`
      UPDATE periodos_contables SET notas = ? WHERE id = ?
    `).run(notas || null, id);
  }
}

module.exports = PeriodoContableRepository;
