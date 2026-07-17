const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

test('la migración 034 agrega las columnas de coordenadas a cuentas, todas opcionales', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const columnas = db.prepare(`PRAGMA table_info(cuentas)`).all().map(c => c.name);

    assert.ok(columnas.includes('lat_acometida'), 'falta lat_acometida');
    assert.ok(columnas.includes('lon_acometida'), 'falta lon_acometida');
    assert.ok(columnas.includes('lat_vivienda'), 'falta lat_vivienda');
    assert.ok(columnas.includes('lon_vivienda'), 'falta lon_vivienda');

    // Un INSERT sin las columnas nuevas no debe fallar por NOT NULL: deben admitir NULL.
    const result = db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('C-TEST-034', 'Dirección de prueba')`).run();
    const fila = db.prepare(`SELECT * FROM cuentas WHERE id = ?`).get(result.lastInsertRowid);

    assert.equal(fila.lat_acometida, null);
    assert.equal(fila.lon_acometida, null);
    assert.equal(fila.lat_vivienda, null);
    assert.equal(fila.lon_vivienda, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
