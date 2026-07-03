const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const AsientoContableService = require('./AsientoContableService');

test('un asiento manual contra Caja Menor (110510) se refleja en el ledger simple `movimientos`', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    const cajaMenor = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110510'`).get();
    const gastosDiversos = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();
    assert.ok(cajaMenor && gastosDiversos, 'El plan de cuentas sembrado debe traer 110510 y 519599');

    service.crearManual({
      fecha: '2026-07-03',
      concepto: 'Ajuste manual de Caja Menor (prueba)',
      lineas: [
        { cuentaContableId: gastosDiversos.id, debito: 15000 },
        { cuentaContableId: cajaMenor.id, credito: 15000 }
      ]
    });

    const enLedgerSimple = db.prepare(`
      SELECT COUNT(*) as c FROM movimientos WHERE origen = 'Caja' AND concepto LIKE '%Ajuste manual de Caja Menor%'
    `).get().c;
    assert.equal(enLedgerSimple, 1, 'El movimiento contra Caja Menor debía replicarse en la tabla `movimientos`');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('un asiento manual contra Cuenta de Ahorros (111005) se sigue reflejando en `movimientos` como Banco', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    const cuentaAhorros = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '111005'`).get();
    const gastosDiversos = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();

    service.crearManual({
      fecha: '2026-07-03',
      concepto: 'Comisión bancaria (prueba)',
      lineas: [
        { cuentaContableId: gastosDiversos.id, debito: 5000 },
        { cuentaContableId: cuentaAhorros.id, credito: 5000 }
      ]
    });

    const enLedgerSimple = db.prepare(`
      SELECT COUNT(*) as c FROM movimientos WHERE origen = 'Banco' AND concepto LIKE '%Comisión bancaria%'
    `).get().c;
    assert.equal(enLedgerSimple, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
