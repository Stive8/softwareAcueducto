// Utilidad mínima usada al iniciar la app (ver app.js) para decidir si mostrar la pantalla de
// configuración inicial (PC nuevo, sin datos) o el login directamente.
class DevToolsService {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  tieneDatosOperativos() {
    const { c } = this.db.prepare('SELECT COUNT(*) as c FROM cuentas').get();
    return c > 0;
  }
}

module.exports = DevToolsService;
