const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const PlanCuentaService = require('./PlanCuentaService');

test('create() rechaza crear una subcuenta bajo un padre que ya tiene movimientos contables', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new PlanCuentaService(ctx.dbService);

    // Cuenta hoja de nivel 4 con un movimiento contable real (simula el escenario de C-1: una
    // cuenta que hoy es hoja y en uso, antes de que alguien intente partirla en subcuentas).
    const padreId = service.create({
      codigo: '999901', nombre: 'Cuenta de prueba con movimiento', tipo: 'Activo', naturaleza: 'Debito'
    });
    const asientoId = db.prepare(`
      INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen)
      VALUES (9002, '2026-01-01', 'Asiento de prueba', 'Manual')
    `).run().lastInsertRowid;
    db.prepare(`
      INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id)
      VALUES ('2026-01-01', ?, 10000, 0, 'Movimiento de prueba', ?)
    `).run(padreId, asientoId);

    assert.throws(
      () => service.create({ codigo: '99990101', nombre: 'Subcuenta', tipo: 'Activo', naturaleza: 'Debito', padreId }),
      /ya tiene movimientos/i
    );

    // La cuenta padre no debe haber quedado con hijas a medio crear.
    const hijos = db.prepare('SELECT COUNT(*) as c FROM plan_cuentas WHERE padre_id = ?').get(padreId).c;
    assert.equal(hijos, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() sigue permitiendo crear una subcuenta bajo un padre SIN movimientos (caso normal)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new PlanCuentaService(ctx.dbService);
    const padreId = service.create({
      codigo: '999902', nombre: 'Cuenta de prueba sin movimiento', tipo: 'Activo', naturaleza: 'Debito'
    });
    const hijoId = service.create({
      codigo: '99990201', nombre: 'Subcuenta válida', tipo: 'Activo', naturaleza: 'Debito', padreId
    });
    assert.ok(hijoId > 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
