class ConfiguracionRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  getAll() {
    const rows = this.db.prepare('SELECT clave, valor FROM configuracion').all();
    const config = {};
    rows.forEach(r => { config[r.clave] = r.valor; });
    return config;
  }

  actualizar(clave, valor) {
    this.db.prepare(`
      UPDATE configuracion SET valor = ?, fecha_actualizacion = CURRENT_TIMESTAMP WHERE clave = ?
    `).run(String(valor), clave);
  }

  getMaxNumeroRecibo() {
    const row = this.db.prepare('SELECT MAX(numero_recibo) as max FROM recibos').get();
    return row.max || 0;
  }
}

module.exports = ConfiguracionRepository;
