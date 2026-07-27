// src/database/migrations/035_admin_recuperacion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const DatabaseService = require('../DatabaseService');

// Aplica, en orden, todas las migraciones de este directorio cuyo nombre sea anterior a
// `limiteExcluido` (p.ej. '035_...') — replica el loop de DatabaseService.runMigrations() pero
// detenido justo antes de la migración bajo prueba, para poder sembrar datos intermedios.
function migrarHasta(dbService, limiteExcluido) {
  const db = dbService.getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (file >= limiteExcluido) break;
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    })();
  }
}

test('la migración 035 agrega la cuenta de recuperación sin afectar usuarios existentes', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-test-035-'));
  const dbService = new DatabaseService(baseDir);
  try {
    migrarHasta(dbService, '035_admin_recuperacion.sql');

    const db = dbService.getDb();
    // Reproduce una base de datos de cliente real: ya tiene un usuario operativo propio (además
    // del `admin` sembrado por 001) antes de llegar a esta migración.
    db.prepare(`
      INSERT INTO usuarios (usuario, password, nombre_completo, rol)
      VALUES ('operador1', 'hashPlaceholder', 'Operador de Prueba', 'Usuario')
    `).run();

    assert.doesNotThrow(() => dbService.runMigrations());

    const columnas = db.prepare(`PRAGMA table_info(usuarios)`).all();
    const colRecuperacion = columnas.find(c => c.name === 'es_recuperacion');
    assert.ok(colRecuperacion, 'falta la columna es_recuperacion en usuarios');
    assert.equal(colRecuperacion.notnull, 1);

    const recuperacion = db.prepare(`SELECT * FROM usuarios WHERE usuario = 'recuperacion'`).get();
    assert.ok(recuperacion, 'falta la fila de la cuenta de recuperación');
    assert.equal(recuperacion.rol, 'Administrador');
    assert.equal(recuperacion.es_recuperacion, 1);
    assert.equal(recuperacion.password, '__PENDIENTE_GENERAR__');
    assert.equal(recuperacion.activo, 1);

    // El usuario preexistente y el admin sembrado por 001 deben sobrevivir intactos.
    const operador = db.prepare(`SELECT * FROM usuarios WHERE usuario = 'operador1'`).get();
    assert.ok(operador);
    assert.equal(operador.es_recuperacion, 0);
    const admin = db.prepare(`SELECT * FROM usuarios WHERE usuario = 'admin'`).get();
    assert.ok(admin);
    assert.equal(admin.es_recuperacion, 0);
  } finally {
    dbService.close();
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
