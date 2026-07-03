const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const AsientoContableService = require('./AsientoContableService');

test('verificarConciliacionCajaBanco() reporta conciliado=true en una BD recién sembrada (sin movimientos)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AsientoContableService(ctx.dbService);
    const resultado = service.verificarConciliacionCajaBanco();

    assert.equal(resultado.length, 2, 'Debe reportar Caja y Banco');
    for (const fila of resultado) {
      assert.equal(fila.saldoLedgerSimple, 0);
      assert.equal(fila.saldoDoblePartida, 0);
      assert.equal(fila.conciliado, true, `${fila.cuenta} debía estar conciliado`);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('verificarConciliacionCajaBanco() detecta una diferencia real entre los dos libros', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    // Inserta un movimiento SOLO en la doble partida, simulando una desincronización
    // (algo que, tras Task 4, ya no debería ocurrir para asientos manuales, pero esta prueba
    // verifica que la propia verificación de conciliación sabe detectarlo si volviera a pasar).
    const cuentaCaja = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();
    const cuentaGasto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();
    const asientoId = db.prepare(`
      INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen)
      VALUES (9003, '2026-07-03', 'Desincronizado a propósito', 'Manual')
    `).run().lastInsertRowid;
    db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2026-07-03', ?, 30000, 0, 'x', ?)`).run(cuentaGasto.id, asientoId);
    db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2026-07-03', ?, 0, 30000, 'x', ?)`).run(cuentaCaja.id, asientoId);

    const resultado = service.verificarConciliacionCajaBanco();
    const caja = resultado.find(f => f.cuenta === 'Caja');
    assert.equal(caja.conciliado, false);
    assert.equal(caja.diferencia, 30000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
