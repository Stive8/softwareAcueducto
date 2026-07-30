const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

test('la migración 037 agrega la columna nombre_predio a cuentas, opcional', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const columnas = db.prepare(`PRAGMA table_info(cuentas)`).all().map(c => c.name);

    assert.ok(columnas.includes('nombre_predio'), 'falta nombre_predio');

    // Un INSERT sin la columna nueva no debe fallar por NOT NULL: debe admitir NULL.
    const result = db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('C-TEST-036', 'Dirección de prueba')`).run();
    const fila = db.prepare(`SELECT * FROM cuentas WHERE id = ?`).get(result.lastInsertRowid);

    assert.equal(fila.nombre_predio, null);

    // Un INSERT con la columna nueva debe funcionar correctamente.
    const result2 = db.prepare(`INSERT INTO cuentas (codigo, direccion, nombre_predio) VALUES ('C-TEST-036-2', 'Dirección 2', 'Predio del Test')`).run();
    const fila2 = db.prepare(`SELECT * FROM cuentas WHERE id = ?`).get(result2.lastInsertRowid);

    assert.equal(fila2.nombre_predio, 'Predio del Test');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
