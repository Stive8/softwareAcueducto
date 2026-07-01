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
    // Excluye el rango sintético (90000+) usado para corregir el histórico importado de
    // 2017-2026 (recibos cuyo número de talonario real chocaba con la numeración en curso y se
    // reasignaron a 90000+original — ver log_correccion_rango_sintetico): esos números nunca
    // fueron emitidos en el papel y no deben impedir configurar el consecutivo real más abajo.
    const row = this.db.prepare(`
      SELECT MAX(numero) as max FROM (
        SELECT MAX(numero_recibo) as numero FROM recibos WHERE numero_recibo < 90000
        UNION ALL
        SELECT MAX(numero_recibo) as numero FROM recibos_anulados_fisicos WHERE numero_recibo < 90000
      )
    `).get();
    return row.max || 0;
  }
}

module.exports = ConfiguracionRepository;
