const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

test('la migración 038 no falla si la categoría "Sin clasificar" ya existe (caso real: la base de producción ya la tenía antes de esta migración)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const antes = db.prepare(`SELECT COUNT(*) AS n FROM categorias WHERE nombre = 'Sin clasificar'`).get().n;
    assert.equal(antes, 1);

    const sql = fs.readFileSync(path.join(__dirname, '038_categoria_sin_clasificar.sql'), 'utf8');
    assert.doesNotThrow(() => db.exec(sql));

    const despues = db.prepare(`SELECT COUNT(*) AS n FROM categorias WHERE nombre = 'Sin clasificar'`).get().n;
    assert.equal(despues, 1, 'no debe duplicar la categoría');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
