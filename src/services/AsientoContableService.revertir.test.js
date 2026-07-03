const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const AsientoContableService = require('./AsientoContableService');

test('revertirManual() rechaza un asiento automático (tipo_origen=Gasto): debe anularse el documento origen', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    const cuentaGasto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();
    const cuentaCaja = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();

    const asientoId = service.crear({
      fecha: '2026-07-03',
      concepto: 'Gasto simulado',
      tipoOrigen: 'Gasto',
      referenciaId: 999,
      referenciaTipo: 'Gasto',
      lineas: [
        { cuentaContableId: cuentaGasto.id, debito: 20000 },
        { cuentaContableId: cuentaCaja.id, credito: 20000 }
      ]
    });

    assert.throws(
      () => service.revertirManual(asientoId, 'Intento de reversión directa'),
      /debe anularse desde el módulo|no se puede revertir directamente/i
    );

    const asiento = service.getById(asientoId);
    assert.equal(asiento.estado, 'Activo', 'El asiento automático no debe quedar Anulado por una reversión directa rechazada');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('revertirManual() sigue permitiendo revertir un asiento Manual', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    const cuentaGasto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();
    const cuentaCaja = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();

    const asientoId = service.crearManual({
      fecha: '2026-07-03',
      concepto: 'Nota manual',
      lineas: [
        { cuentaContableId: cuentaGasto.id, debito: 8000 },
        { cuentaContableId: cuentaCaja.id, credito: 8000 }
      ]
    });

    const reversionId = service.revertirManual(asientoId, 'Corrección de prueba');
    assert.ok(reversionId > 0);

    const original = service.getById(asientoId);
    assert.equal(original.estado, 'Anulado');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('revertirPorReferencia() (usado por GastoService.anular/ReciboService.anular) sigue revirtiendo un asiento automático SIN restricción de tipo_origen', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    const cuentaGasto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();
    const cuentaCaja = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();

    service.crear({
      fecha: '2026-07-03',
      concepto: 'Gasto simulado',
      tipoOrigen: 'Gasto',
      referenciaId: 777,
      referenciaTipo: 'Gasto',
      lineas: [
        { cuentaContableId: cuentaGasto.id, debito: 12000 },
        { cuentaContableId: cuentaCaja.id, credito: 12000 }
      ]
    });

    // Este es exactamente el camino interno que usan GastoService.anular()/ReciboService.anular()
    // (y sus corregirMetodoPago()): NO debe verse afectado por la restricción de
    // revertirManual(), o la anulación de gastos/recibos quedaría completamente rota.
    const reversionId = service.revertirPorReferencia('Gasto', 777, 'Anulación de gasto de prueba');
    assert.ok(reversionId > 0, 'revertirPorReferencia debe seguir funcionando para asientos automáticos, sin restricción');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
