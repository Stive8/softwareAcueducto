// src/database/migrations/041_credito_trazabilidad.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

test('041: cuenta_creditos admite abono_movimiento_id para trazar a qué Abono se aplicó', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;

    const abonoId = db.prepare(`
      INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto)
      VALUES (?, '2026-01-01', 'Abono', 1, -90000)
    `).run(cuentaId).lastInsertRowid;

    db.prepare(`
      INSERT INTO cuenta_creditos (cuenta_id, tipo, monto, fecha, abono_movimiento_id)
      VALUES (?, 'Aplicado', 90000, '2026-01-01', ?)
    `).run(cuentaId, abonoId);

    const fila = db.prepare('SELECT abono_movimiento_id FROM cuenta_creditos WHERE cuenta_id = ?').get(cuentaId);
    assert.equal(fila.abono_movimiento_id, abonoId);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('041: una fila "Abono" (crédito sin aplicar todavía) no requiere abono_movimiento_id', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T002', 'Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T002'`).get().id;

    db.prepare(`
      INSERT INTO cuenta_creditos (cuenta_id, tipo, monto, fecha)
      VALUES (?, 'Abono', 90000, '2024-05-04')
    `).run(cuentaId);

    const fila = db.prepare('SELECT abono_movimiento_id FROM cuenta_creditos WHERE cuenta_id = ?').get(cuentaId);
    assert.equal(fila.abono_movimiento_id, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
