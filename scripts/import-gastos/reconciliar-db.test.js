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
