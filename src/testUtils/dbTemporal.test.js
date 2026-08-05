const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('./dbTemporal');

test('crearDbTemporal aplica todas las migraciones y siembra el plan de cuentas', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const totalCuentas = db.prepare('SELECT COUNT(*) as c FROM plan_cuentas').get().c;
    assert.ok(totalCuentas > 100, `Se esperaban >100 cuentas sembradas, hubo ${totalCuentas}`);

    const totalMigraciones = db.prepare('SELECT COUNT(*) as c FROM migrations').get().c;
    assert.equal(totalMigraciones, 41, 'Deben quedar registradas las 41 migraciones (001, 003-042)');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('cerrarDbTemporal borra el directorio temporal', () => {
  const ctx = crearDbTemporal();
  const { baseDir } = ctx;
  cerrarDbTemporal(ctx);
  const fs = require('fs');
  assert.equal(fs.existsSync(baseDir), false);
});
