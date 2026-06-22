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

  updatePassword(id, passwordHasheado) {
    this.db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(passwordHasheado, id);
  }

  updateUltimoAcceso(id) {
    this.db.prepare('UPDATE usuarios SET fecha_ultimo_acceso = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  }
}

module.exports = UsuarioRepository;
