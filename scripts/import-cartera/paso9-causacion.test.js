const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { ejecutarPaso9, OBSERVACION_RESIDUAL } = require('./paso9-causacion');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

function getCargos(db, cuentaId) {
  return db.prepare(`
    SELECT anio, mes, monto, tipo FROM cartera_movimientos
    WHERE cuenta_id = ? AND tipo IN ('CargoMensual','AjusteCategoria')
    ORDER BY anio, mes IS NOT NULL, mes
  `).all(cuentaId);
}

function cuenta(overrides = {}) {
  return {
    codigo: 'R001',
    inicio_causacion_estimado: null,
    plan_causacion: {
      '2024': { meses: 12, tarifa: 10000, causacion_sostenimiento: 120000 },
      '2025': { meses: 12, tarifa: 10000, causacion_sostenimiento: 120000 },
      '2026': { meses: 12, tarifa: 10000, causacion_sostenimiento: 120000 }
    },
    ...overrides
  };
}

test('paso9: año completo (meses=12, sin inicio) genera 12 CargoMensual enero-diciembre', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');

    const r = ejecutarPaso9({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({ plan_causacion: { '2024': { meses: 12, tarifa: 10000, causacion_sostenimiento: 120000 } } })]
    });

    const cargos2024 = getCargos(db, cuentaId).filter(c => c.anio === 2024);
    assert.equal(cargos2024.length, 12);
    assert.deepEqual(cargos2024.map(c => c.mes), Array.from({ length: 12 }, (_, i) => i + 1));
    assert.ok(cargos2024.every(c => c.monto === 10000));
    assert.equal(r.totalCreado, 120000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: meses=null ese año no causa nada', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');

    ejecutarPaso9({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({ plan_causacion: { '2024': { meses: null, tarifa: 10000, causacion_excel: null } } })]
    });

    assert.equal(getCargos(db, cuentaId).length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: plan_causacion vacío ({}) no causa nada, no revienta', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'O401');

    const r = ejecutarPaso9({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'O401', inicio_causacion_estimado: null, plan_causacion: {} }]
    });

    assert.equal(getCargos(db, cuentaId).length, 0);
    assert.equal(r.creados.length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: meses parcial entero con inicio_causacion_estimado en ese año arranca en ese mes (caso C0041: abr-dic 2024)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'C0041');

    ejecutarPaso9({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({
        codigo: 'C0041', inicio_causacion_estimado: '2024-04',
        plan_causacion: {
          '2024': { meses: 9, tarifa: 10000, causacion_sostenimiento: 90000, cargo_punto_incluido: 500000 },
          '2025': { meses: 12, tarifa: 10000, causacion_sostenimiento: 120000 }
        }
      })]
    });

    const cargos2024 = getCargos(db, cuentaId).filter(c => c.anio === 2024);
    assert.deepEqual(cargos2024.map(c => c.mes), [4, 5, 6, 7, 8, 9, 10, 11, 12]);

    const cargos2025 = getCargos(db, cuentaId).filter(c => c.anio === 2025);
    assert.equal(cargos2025.length, 12, '2025 arranca en enero porque inicio_causacion_estimado es de 2024, no de 2025');
    assert.equal(cargos2025[0].mes, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: meses fraccionario genera floor(meses) CargoMensual + 1 AjusteCategoria residual (caso R097: 8.4, may-dic)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R097');

    const r = ejecutarPaso9({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({
        codigo: 'R097', inicio_causacion_estimado: '2024-05',
        plan_causacion: { '2024': { meses: 8.4, tarifa: 10000, causacion_sostenimiento: 84000 } }
      })]
    });

    const movs = getCargos(db, cuentaId);
    const cargos = movs.filter(m => m.tipo === 'CargoMensual');
    const residuales = movs.filter(m => m.tipo === 'AjusteCategoria');
    assert.equal(cargos.length, 8);
    assert.deepEqual(cargos.map(c => c.mes), [5, 6, 7, 8, 9, 10, 11, 12]);
    assert.equal(residuales.length, 1);
    assert.equal(residuales[0].mes, null);
    assert.equal(residuales[0].monto, 4000, '84000 - 8*10000');
    assert.equal(r.totalCreado, 84000);

    const residualRow = db.prepare(`SELECT observaciones, fecha FROM cartera_movimientos WHERE cuenta_id=? AND tipo='AjusteCategoria'`).get(cuentaId);
    assert.equal(residualRow.observaciones, OBSERVACION_RESIDUAL);
    assert.equal(residualRow.fecha, '2024-01-01');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: meses fraccionario que excede 12 se topa en 12 (caso S0222: 13.2 meses)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'S0222');

    ejecutarPaso9({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({
        codigo: 'S0222', inicio_causacion_estimado: null,
        plan_causacion: { '2024': { meses: 13.2, tarifa: 10000, causacion_sostenimiento: 132000 } }
      })]
    });

    const movs = getCargos(db, cuentaId);
    const cargos = movs.filter(m => m.tipo === 'CargoMensual');
    const residuales = movs.filter(m => m.tipo === 'AjusteCategoria');
    assert.equal(cargos.length, 12, 'tope en 12 meses, nunca 13');
    assert.equal(residuales[0].monto, 12000, '132000 - 12*10000');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: 2026 se topa en julio -- meses=12 causa solo enero-julio (7 meses)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');

    ejecutarPaso9({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({ plan_causacion: { '2026': { meses: 12, tarifa: 10000, causacion_sostenimiento: 120000 } } })]
    });

    const cargos2026 = getCargos(db, cuentaId).filter(c => c.anio === 2026);
    assert.deepEqual(cargos2026.map(c => c.mes), [1, 2, 3, 4, 5, 6, 7]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: 2026 con meses=11 arranca en febrero (13-11), causa 6 meses hasta julio (caso R0081)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R0081');

    ejecutarPaso9({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({
        codigo: 'R0081', plan_causacion: { '2026': { meses: 11, tarifa: 10000, causacion_sostenimiento: 110000 } }
      })]
    });

    const cargos2026 = getCargos(db, cuentaId).filter(c => c.anio === 2026);
    assert.deepEqual(cargos2026.map(c => c.mes), [2, 3, 4, 5, 6, 7]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: 2026 con meses=6 causa solo julio, aunque inicio_causacion_estimado diga febrero (caso R0972)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R0972');

    ejecutarPaso9({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({
        codigo: 'R0972', inicio_causacion_estimado: '2026-02',
        plan_causacion: { '2026': { meses: 6, tarifa: 10000, causacion_sostenimiento: 60000 } }
      })]
    });

    const cargos2026 = getCargos(db, cuentaId).filter(c => c.anio === 2026);
    assert.deepEqual(cargos2026.map(c => c.mes), [7], 'la fórmula 13-meses manda, no inicio_causacion_estimado');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: 2026 con meses=5 o menos no causa nada (arrancaría después de julio)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');

    ejecutarPaso9({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({ plan_causacion: { '2026': { meses: 5, tarifa: 10000, causacion_sostenimiento: 50000 } } })]
    });

    assert.equal(getCargos(db, cuentaId).filter(c => c.anio === 2026).length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: 2026 con meses fraccionario falla ruidosamente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'R001');

    assert.throws(
      () => ejecutarPaso9({
        dbService: ctx.dbService,
        cuentasJson: [cuenta({ plan_causacion: { '2026': { meses: 6.5, tarifa: 10000, causacion_sostenimiento: 65000 } } })]
      }),
      /2026: meses fraccionario \(6\.5\)/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: es idempotente -- correrlo dos veces no duplica CargoMensual ni el residual', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R097');
    const recibosJson = [cuenta({
      codigo: 'R097', inicio_causacion_estimado: '2024-05',
      plan_causacion: { '2024': { meses: 8.4, tarifa: 10000, causacion_sostenimiento: 84000 } }
    })];

    ejecutarPaso9({ dbService: ctx.dbService, cuentasJson: recibosJson });
    const r2 = ejecutarPaso9({ dbService: ctx.dbService, cuentasJson: recibosJson });

    assert.equal(r2.creados.length, 0);
    assert.equal(r2.yaExistian.length, 9, '8 CargoMensual + 1 residual');
    assert.equal(getCargos(db, cuentaId).length, 9);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: falla ruidosamente y sin insertar nada si mesInicio + meses excede diciembre', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');

    assert.throws(
      () => ejecutarPaso9({
        dbService: ctx.dbService,
        cuentasJson: [cuenta({
          inicio_causacion_estimado: '2024-06',
          plan_causacion: { '2024': { meses: 12, tarifa: 10000, causacion_sostenimiento: 120000 } }
        })]
      }),
      /excede diciembre/
    );
    assert.equal(getCargos(db, cuentaId).length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: falla si una cuenta del JSON no existe en la base', () => {
  const ctx = crearDbTemporal();
  try {
    assert.throws(
      () => ejecutarPaso9({ dbService: ctx.dbService, cuentasJson: [cuenta({ codigo: 'X404' })] }),
      /no existe en la base/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9: S0332S0382 se ignora siempre', () => {
  const ctx = crearDbTemporal();
  try {
    const r = ejecutarPaso9({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({ codigo: 'S0332S0382' })]
    });
    assert.equal(r.creados.length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
