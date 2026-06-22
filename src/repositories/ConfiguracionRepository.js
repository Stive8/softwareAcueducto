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
    // Incluye tanto recibos reales como anulados del talonario físico: comparten la misma
    // numeración consecutiva, así que ninguno de los dos puede quedar por delante del contador.
    const row = this.db.prepare(`
      SELECT MAX(numero) as max FROM (
        SELECT MAX(numero_recibo) as numero FROM recibos
        UNION ALL
        SELECT MAX(numero_recibo) as numero FROM recibos_anulados_fisicos
      )
    `).get();
    return row.max || 0;
  }
}

module.exports = ConfiguracionRepository;
