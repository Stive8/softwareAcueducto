const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const DatabaseService = require('../DatabaseService');

// Aplica, en orden, todas las migraciones de este directorio cuyo nombre sea anterior a
// `limiteExcluido` (p.ej. '017_...') — replica el loop de DatabaseService.runMigrations() pero
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

test('la migración 017 no falla por FOREIGN KEY cuando ya existen gastos ligados a un tercero', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-test-017-'));
  const dbService = new DatabaseService(baseDir);
  try {
    // Reproduce el escenario real: una base de datos que ya tiene historial (un tercero con un
    // gasto referenciándolo por FK) llega a la migración 017 - no una base vacía, que es la
    // única forma en que 017 se había ejercitado hasta ahora (crearDbTemporal() la corre sobre
    // una BD nueva, donde nunca hay filas que puedan violar la FK al recrear `terceros`).
    migrarHasta(dbService, '017_terceros_no_informado_y_roles.sql');

    const db = dbService.getDb();
    const terceroId = db.prepare(`
      INSERT INTO terceros (tipo_identificacion, numero_identificacion, nombre_razon_social)
      VALUES ('NIT', '900123456', 'Proveedor de Prueba')
    `).run().lastInsertRowid;

    const gastoId = db.prepare(`
      INSERT INTO gastos (fecha_gasto, concepto, valor, tercero_id)
      VALUES ('2026-01-15', 'Compra de prueba', 50000, ?)
    `).run(terceroId).lastInsertRowid;

    // Sigue con el resto de la cadena real (017 en adelante) usando el mismo runMigrations()
    // que corre la app al arrancar - no una réplica manual - así prueba el camino real que
    // falló con "FOREIGN KEY constraint failed" antes del fix en DatabaseService.runMigrations().
    assert.doesNotThrow(() => dbService.runMigrations());

    // El tercero y el gasto preexistentes deben sobrevivir intactos (mismo id, misma relación).
    const tercero = db.prepare('SELECT * FROM terceros WHERE id = ?').get(terceroId);
    assert.equal(tercero.nombre_razon_social, 'Proveedor de Prueba');

    const gasto = db.prepare('SELECT tercero_id FROM gastos WHERE id = ?').get(gastoId);
    assert.equal(gasto.tercero_id, terceroId);

    // El tercero permanente del sistema debe haberse creado.
    const sistema = db.prepare('SELECT * FROM terceros WHERE es_sistema = 1').get();
    assert.ok(sistema, 'falta el tercero "No informado" del sistema');
    assert.equal(sistema.numero_identificacion, null);

    // numero_identificacion ya no debe ser NOT NULL (columna nullable tras la migración).
    const columnas = db.prepare(`PRAGMA table_info(terceros)`).all();
    const colNumero = columnas.find(c => c.name === 'numero_identificacion');
    assert.equal(colNumero.notnull, 0, 'numero_identificacion debería admitir NULL tras 017');
  } finally {
    dbService.close();
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
