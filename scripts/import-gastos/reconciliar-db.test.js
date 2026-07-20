// scripts/import-gastos/reconciliar-db.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { reconciliarIdentificaciones } = require('./reconciliar-db');

test('corrige la cédula de Vicencio 93238699 → 93328699', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO terceros (tipo_identificacion, numero_identificacion, nombre_razon_social, es_proveedor)
                VALUES ('Cédula de Ciudadanía', '93238699', 'Vicencio Herrera', 1)`).run();

    const r = reconciliarIdentificaciones(ctx.dbService);
    assert.equal(r.corregidos, 1);

    const t = db.prepare(`SELECT numero_identificacion FROM terceros WHERE nombre_razon_social = 'Vicencio Herrera'`).get();
    assert.equal(t.numero_identificacion, '93328699');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('es idempotente: correr dos veces no falla ni duplica', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO terceros (tipo_identificacion, numero_identificacion, nombre_razon_social, es_proveedor)
                VALUES ('Cédula de Ciudadanía', '93238699', 'Vicencio Herrera', 1)`).run();
    reconciliarIdentificaciones(ctx.dbService);
    const r2 = reconciliarIdentificaciones(ctx.dbService);
    assert.equal(r2.corregidos, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('no modifica nada cuando ya existe un tercero con la identificación canónica (conflicto)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    // Sembramos AMBOS: uno con la identificación vieja (de) y otro que ya tiene la canónica (a).
    db.prepare(`INSERT INTO terceros (tipo_identificacion, numero_identificacion, nombre_razon_social, es_proveedor)
                VALUES ('Cédula de Ciudadanía', '93238699', 'Vicencio Herrera (viejo)', 1)`).run();
    db.prepare(`INSERT INTO terceros (tipo_identificacion, numero_identificacion, nombre_razon_social, es_proveedor)
                VALUES ('Cédula de Ciudadanía', '93328699', 'Vicencio Herrera (canónico)', 1)`).run();

    const r = reconciliarIdentificaciones(ctx.dbService);

    assert.equal(r.corregidos, 0);
    assert.ok(r.detalles.some((d) => /conflicto/i.test(d)));

    // Ambos registros quedan intactos.
    const viejo = db.prepare(`SELECT numero_identificacion FROM terceros WHERE nombre_razon_social = 'Vicencio Herrera (viejo)'`).get();
    const canonico = db.prepare(`SELECT numero_identificacion FROM terceros WHERE nombre_razon_social = 'Vicencio Herrera (canónico)'`).get();
    assert.equal(viejo.numero_identificacion, '93238699');
    assert.equal(canonico.numero_identificacion, '93328699');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
