// Crea una base de datos SQLite temporal y desechable con las migraciones ya aplicadas
// (incluye todo el plan de cuentas, cuentas automáticas, plantillas y mapeo que las propias
// migraciones siembran), para que un test ejercite servicios reales sin tocar
// data/acueducto.db. El llamador SIEMPRE debe cerrar con cerrarDbTemporal() al terminar
// (ideal: en un try/finally o en el hook `after` del test).
const os = require('os');
const fs = require('fs');
const path = require('path');
const DatabaseService = require('../database/DatabaseService');

function crearDbTemporal() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-test-'));
  const dbService = new DatabaseService(baseDir);
  dbService.initialize();
  return { dbService, baseDir };
}

function cerrarDbTemporal({ dbService, baseDir }) {
  dbService.close();
  fs.rmSync(baseDir, { recursive: true, force: true });
}

module.exports = { crearDbTemporal, cerrarDbTemporal };
