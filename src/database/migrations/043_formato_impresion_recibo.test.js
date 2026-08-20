// src/database/migrations/043_formato_impresion_recibo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

test('043: siembra formato_impresion_recibo = carta por defecto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const fila = db.prepare(`SELECT valor FROM configuracion WHERE clave = 'formato_impresion_recibo'`).get();
    assert.ok(fila, 'la fila debe existir tras correr las migraciones');
    assert.equal(fila.valor, 'carta');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
