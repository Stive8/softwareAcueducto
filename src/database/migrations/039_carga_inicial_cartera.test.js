// src/database/migrations/039_carga_inicial_cartera.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

function columnas(db, tabla) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().map(c => c.name);
}

test('039: agrega recibos.fecha_pago_real, nullable', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    assert.ok(columnas(db, 'recibos').includes('fecha_pago_real'));

    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;
    db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Test')`).run();
    const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Test'`).get().id;

    // sin fecha_pago_real: debe insertarse igual (NULL = coincide con fecha_recibo)
    db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
                VALUES (9001, ?, ?, '2019-05-10', 5000, 'Efectivo')`).run(cuentaId, propietarioId);
    const r1 = db.prepare(`SELECT fecha_pago_real FROM recibos WHERE numero_recibo = 9001`).get();
    assert.equal(r1.fecha_pago_real, null);

    // con fecha_pago_real distinta de fecha_recibo: recibo escrito semanas después del pago real
    db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, fecha_pago_real, total, metodo_pago)
                VALUES (9002, ?, ?, '2022-08-13', '2022-07-01', 50000, 'Transferencia')`).run(cuentaId, propietarioId);
    const r2 = db.prepare(`SELECT fecha_pago_real FROM recibos WHERE numero_recibo = 9002`).get();
    assert.equal(r2.fecha_pago_real, '2022-07-01');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('039: cartera_movimientos admite el tipo AjusteCargaInicial y sigue rechazando tipos inventados', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T002', 'Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T002'`).get().id;

    db.prepare(`INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto, observaciones)
                VALUES (?, '2023-12-31', 'AjusteCargaInicial', 1, -3000, 'Ajuste de conciliación carga inicial — descuadre en hoja CARTERA')`)
      .run(cuentaId);
    const fila = db.prepare(`SELECT * FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'AjusteCargaInicial'`).get(cuentaId);
    assert.equal(fila.monto, -3000);

    assert.throws(
      () => db.prepare(`INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto)
                        VALUES (?, '2023-12-31', 'TipoInventado', 1, 1000)`).run(cuentaId),
      /CHECK constraint failed/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('039: cartera_movimientos preserva ids, índices y FKs tras la recreación de tabla', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T003', 'Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T003'`).get().id;

    const cargoId = db.prepare(
      `INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto, anio, mes)
       VALUES (?, '2024-01-01', 'CargoMensual', 1, 10000, 2024, 1)`
    ).run(cuentaId).lastInsertRowid;

    // el índice único parcial sigue vigente: no se puede causar dos veces el mismo mes
    assert.throws(
      () => db.prepare(
        `INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto, anio, mes)
         VALUES (?, '2024-01-02', 'CargoMensual', 1, 10000, 2024, 1)`
      ).run(cuentaId),
      /UNIQUE constraint failed/
    );

    // cartera_imputaciones sigue pudiendo referenciar el id preservado (la FK no quedó rota)
    const abonoId = db.prepare(
      `INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto)
       VALUES (?, '2024-01-05', 'Abono', 1, -10000)`
    ).run(cuentaId).lastInsertRowid;
    db.prepare(`INSERT INTO cartera_imputaciones (abono_id, cargo_id, monto) VALUES (?, ?, 10000)`).run(abonoId, cargoId);
    const imputacion = db.prepare(`SELECT * FROM cartera_imputaciones WHERE cargo_id = ?`).get(cargoId);
    assert.equal(imputacion.monto, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
