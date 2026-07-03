// src/database/migrations/031_reconciliar_movimientos_caja_agrupacion.test.js
//
// Reproduce exactamente el escenario del hallazgo C-1: un movimiento contable quedó posteado
// contra una cuenta ('1105', Caja) que luego se convirtió en cuenta de agrupación al insertar
// '110505' Caja General como hija suya — el mismo mecanismo que produjo el defecto real
// (ver migración 029). La migración 031 debe reasignar ese movimiento a la hoja correcta.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

test('031 reasigna a Caja General los movimientos que quedaron contra la cuenta padre 1105', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();

    const cuenta1105 = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '1105'`).get();
    const cuenta110505 = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();
    assert.ok(cuenta1105 && cuenta110505, 'El plan de cuentas sembrado debe traer 1105 y 110505');

    // Simula el defecto histórico: un movimiento contable directo contra el padre.
    const asientoId = db.prepare(`
      INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen, referencia_tipo, referencia_id)
      VALUES (9001, '2020-01-01', 'Movimiento de prueba pre-fix', 'Gasto', 'Gasto', 1)
    `).run().lastInsertRowid;
    db.prepare(`
      INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id)
      VALUES ('2020-01-01', ?, 0, 50000, 'Salida de caja (defecto simulado)', ?)
    `).run(cuenta1105.id, asientoId);

    assert.equal(
      db.prepare(`SELECT COUNT(*) as c FROM movimientos_contables WHERE cuenta_id = ?`).get(cuenta1105.id).c,
      1,
      'Precondición: el movimiento simulado debe existir contra 1105 antes de la migración'
    );

    // Aplica solo la migración 031 (ya se aplicaron todas las demás en crearDbTemporal()).
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(
      path.join(__dirname, '031_reconciliar_movimientos_caja_agrupacion.sql'), 'utf8'
    );
    db.exec(sql);

    const enPadreDespues = db.prepare(`SELECT COUNT(*) as c FROM movimientos_contables WHERE cuenta_id = ?`).get(cuenta1105.id).c;
    assert.equal(enPadreDespues, 0, 'Tras la migración, 1105 no debe tener ningún movimiento directo');

    const enHojaDespues = db.prepare(`SELECT COUNT(*) as c, SUM(credito) as total FROM movimientos_contables WHERE cuenta_id = ?`).get(cuenta110505.id);
    assert.equal(enHojaDespues.c, 1, 'El movimiento debe haberse reasignado a 110505 Caja General');
    assert.equal(enHojaDespues.total, 50000, 'El monto debe preservarse exactamente');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('031 es segura de re-ejecutar si ya no hay movimientos contra cuentas con hijos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(
      path.join(__dirname, '031_reconciliar_movimientos_caja_agrupacion.sql'), 'utf8'
    );
    // No debe lanzar ni cambiar nada al ejecutarse sobre una BD que ya está limpia.
    assert.doesNotThrow(() => db.exec(sql));
  } finally {
    cerrarDbTemporal(ctx);
  }
});
