// src/database/migrations/044_mapeo_abono_deuda_anterior.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');
const MapeoContableRepository = require('../../repositories/MapeoContableRepository');

test('044: AbonoDeudaAnterior se mapea a 413505 (Sostenimiento Mensual), no al __default__ de RecibosDetalle', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new MapeoContableRepository(ctx.dbService);
    const cuentaId = repo.resolverCuentaContableId('RecibosDetalle', 'AbonoDeudaAnterior');

    const db = ctx.dbService.getDb();
    const cuenta = db.prepare('SELECT codigo, nombre FROM plan_cuentas WHERE id = ?').get(cuentaId);
    const cuentaSostenimiento = db.prepare('SELECT id FROM plan_cuentas WHERE codigo = ?').get('413505');

    assert.equal(cuenta.codigo, '413505');
    assert.equal(cuentaId, cuentaSostenimiento.id);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('044: AbonoDeudaAnterior aparece como fila propia en el Mapeo Contable (no solo resuelto vía __default__)', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new MapeoContableRepository(ctx.dbService);
    const filas = repo.findAll('RecibosDetalle');
    const fila = filas.find(f => f.concepto === 'AbonoDeudaAnterior');

    assert.ok(fila, 'Debe existir una fila explícita para AbonoDeudaAnterior, visible en la pantalla de Mapeo Contable');
    assert.equal(fila.cuenta_codigo, '413505');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
