// src/database/migrations/036_cartera_movimientos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

function columnas(db, tabla) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().map(c => c.name);
}

test('036: crea cartera_movimientos con las columnas y los CHECK esperados', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cols = columnas(db, 'cartera_movimientos');
    for (const c of ['id', 'cuenta_id', 'fecha', 'tipo', 'exigible', 'monto', 'anio', 'mes',
      'recibo_detalle_id', 'documento', 'observaciones', 'usuario_id', 'fecha_creacion']) {
      assert.ok(cols.includes(c), `falta la columna ${c}`);
    }

    // el CHECK de tipo rechaza un tipo desconocido
    assert.throws(
      () => db.prepare(`INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto)
                        VALUES (1, '2026-01-01', 'TipoInventado', 1, 1000)`).run(),
      /CHECK constraint failed/
    );

    // el CHECK de exigible solo admite 0 y 1
    assert.throws(
      () => db.prepare(`INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto)
                        VALUES (1, '2026-01-01', 'CargoMensual', 7, 1000)`).run(),
      /CHECK constraint failed/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('036: el índice único impide causar dos veces el mismo mes, pero permite ajustes sobre ese mes', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;

    const insertar = (tipo, monto) => db.prepare(
      `INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto, anio, mes)
       VALUES (?, '2026-01-01', ?, 1, ?, 2026, 1)`
    ).run(cuentaId, tipo, monto);

    insertar('CargoMensual', 10000);
    assert.throws(() => insertar('CargoMensual', 10000), /UNIQUE constraint failed/);

    // un AjusteCategoria sobre el mismo mes SÍ debe poder insertarse (el índice es parcial)
    insertar('AjusteCategoria', 6000);
    insertar('AjusteCategoria', -2000);
    const total = db.prepare(
      `SELECT SUM(monto) s FROM cartera_movimientos WHERE cuenta_id = ? AND anio = 2026 AND mes = 1`
    ).get(cuentaId).s;
    assert.equal(total, 14000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('036: crea cartera_imputaciones con UNIQUE(abono_id, cargo_id) y monto > 0', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cols = columnas(db, 'cartera_imputaciones');
    for (const c of ['id', 'abono_id', 'cargo_id', 'monto', 'fecha_creacion']) {
      assert.ok(cols.includes(c), `falta la columna ${c}`);
    }

    // cartera_imputaciones tiene FK hacia cartera_movimientos (foreign_keys = ON en todo el
    // proyecto), así que hacen falta un abono y un cargo reales para probar sus constraints.
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T002', 'Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T002'`).get().id;
    const abonoId = db.prepare(
      `INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto) VALUES (?, '2026-01-01', 'Abono', 1, -500)`
    ).run(cuentaId).lastInsertRowid;
    const cargoId = db.prepare(
      `INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto, anio, mes) VALUES (?, '2026-01-01', 'CargoMensual', 1, 10000, 2026, 1)`
    ).run(cuentaId).lastInsertRowid;

    assert.throws(
      () => db.prepare(`INSERT INTO cartera_imputaciones (abono_id, cargo_id, monto) VALUES (?, ?, 0)`).run(abonoId, cargoId),
      /CHECK constraint failed/
    );
    db.prepare(`INSERT INTO cartera_imputaciones (abono_id, cargo_id, monto) VALUES (?, ?, 500)`).run(abonoId, cargoId);
    assert.throws(
      () => db.prepare(`INSERT INTO cartera_imputaciones (abono_id, cargo_id, monto) VALUES (?, ?, 300)`).run(abonoId, cargoId),
      /UNIQUE constraint failed/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('036: crea cuenta_estados y siembra una vigencia Activo por cada cuenta existente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cols = columnas(db, 'cuenta_estados');
    for (const c of ['id', 'cuenta_id', 'estado', 'fecha_inicio', 'fecha_fin', 'motivo',
      'usuario_id', 'fecha_creacion']) {
      assert.ok(cols.includes(c), `falta la columna ${c}`);
    }
    // en una base recién migrada no hay cuentas, así que el backfill no crea nada
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM cuenta_estados`).get().n, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
