const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const DatabaseService = require('./DatabaseService');

function crearMigrationsDirTemporal(archivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-migrations-'));
  for (const [nombre, sql] of Object.entries(archivos)) {
    fs.writeFileSync(path.join(dir, nombre), sql, 'utf8');
  }
  return dir;
}

test('una migración que falla a mitad de camino no deja rastro (todo o nada)', () => {
  const migrationsDir = crearMigrationsDirTemporal({
    '001_ok.sql': `CREATE TABLE previa (id INTEGER PRIMARY KEY);`,
    '002_rota.sql': `
      CREATE TABLE tabla_parcial (id INTEGER PRIMARY KEY);
      INSERT INTO tabla_inexistente (id) VALUES (1);
    `
  });
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-test-db-'));

  const dbService = new DatabaseService(baseDir, migrationsDir);
  dbService.createMigrationsTable();

  assert.throws(() => dbService.runMigrations(), /no such table: tabla_inexistente/);

  const db = dbService.getDb();

  // La primera migración (buena) sí debe haber quedado aplicada y registrada.
  const previaExiste = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='previa'`).get();
  assert.ok(previaExiste, 'La migración 001_ok.sql debía quedar aplicada');
  const registro001 = db.prepare(`SELECT name FROM migrations WHERE name = '001_ok.sql'`).get();
  assert.ok(registro001, '001_ok.sql debía quedar registrada como ejecutada');

  // La segunda migración (rota) NO debe haber dejado la tabla a medias, ni haberse marcado como ejecutada.
  const tablaParcialExiste = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tabla_parcial'`).get();
  assert.equal(tablaParcialExiste, undefined, 'tabla_parcial no debía existir: la migración rota debió revertirse por completo');
  const registro002 = db.prepare(`SELECT name FROM migrations WHERE name = '002_rota.sql'`).get();
  assert.equal(registro002, undefined, '002_rota.sql no debía quedar marcada como ejecutada');

  dbService.close();
  fs.rmSync(baseDir, { recursive: true, force: true });
  fs.rmSync(migrationsDir, { recursive: true, force: true });
});
