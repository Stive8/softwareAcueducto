class UsuarioRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  findByUsuario(usuario) {
    return this.db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  }

  findAll() {
    return this.db.prepare(`
      SELECT id, usuario, nombre_completo, rol, activo, fecha_creacion, fecha_ultimo_acceso
      FROM usuarios ORDER BY id ASC
    `).all();
  }

  create({ usuario, passwordHasheado, nombreCompleto, rol }) {
    const result = this.db.prepare(`
      INSERT INTO usuarios (usuario, password, nombre_completo, rol) VALUES (?, ?, ?, ?)
    `).run(usuario, passwordHasheado, nombreCompleto, rol);
    return result.lastInsertRowid;
  }

  toggleActivo(id, activo) {
    this.db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(activo ? 1 : 0, id);
  }

  updatePassword(id, passwordHasheado) {
    this.db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(passwordHasheado, id);
  }

  updateUltimoAcceso(id) {
    this.db.prepare('UPDATE usuarios SET fecha_ultimo_acceso = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  }
}

module.exports = UsuarioRepository;
