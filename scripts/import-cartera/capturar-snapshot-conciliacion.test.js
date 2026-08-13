const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const { capturarSnapshot } = require('./capturar-snapshot-conciliacion');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

function cuenta(codigo, overrides = {}) {
  return {
    codigo,
    conciliacion: {
      saldo_cartera_excel_2026: 100000, abonos_punto_desde_2024: 0,
      saldo_sostenimiento_esperado: 100000, cuadra_exacto: true, motivo_diferencia: null
    },
    ...overrides
  };
}

test('capturarSnapshot: escribe saldo_credito_disponible y saldo_pendiente_punto tal como están en la base', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 90000 });
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 40000, fecha: '2026-01-01' });
    db.prepare(`
      INSERT INTO nuevos_puntos (cuenta_id, valor_total, saldo_pendiente, fecha_registro, estado)
      VALUES (?, 500000, 300000, '2024-01-01', 'Pendiente')
    `).run(cuentaId);

    const cuentasJson = [cuenta('R001')];
    const r = capturarSnapshot({ dbService: ctx.dbService, cuentasJson });

    assert.equal(r.capturadas, 1);
    assert.deepEqual(cuentasJson[0].conciliacion.snapshot_captura, {
      fecha: r.fecha,
      nota: cuentasJson[0].conciliacion.snapshot_captura.nota,
      saldo_credito_disponible: 40000,
      saldo_pendiente_punto: 300000
    });
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('capturarSnapshot: cuenta sin crédito ni punto queda en 0, no se omite', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'R002');
    const cuentasJson = [cuenta('R002')];

    capturarSnapshot({ dbService: ctx.dbService, cuentasJson });

    assert.equal(cuentasJson[0].conciliacion.snapshot_captura.saldo_credito_disponible, 0);
    assert.equal(cuentasJson[0].conciliacion.snapshot_captura.saldo_pendiente_punto, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('capturarSnapshot: cuenta del JSON que no existe en la base se omite sin fallar', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentasJson = [cuenta('FANTASMA')];
    const r = capturarSnapshot({ dbService: ctx.dbService, cuentasJson });

    assert.equal(r.capturadas, 0);
    assert.equal(cuentasJson[0].conciliacion.snapshot_captura, undefined);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('capturarSnapshot: se niega a correr de nuevo si ya hay snapshot_captura, sin --forzar', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'R001');
    const cuentasJson = [cuenta('R001', {
      conciliacion: {
        saldo_cartera_excel_2026: 100000, abonos_punto_desde_2024: 0,
        saldo_sostenimiento_esperado: 100000, cuadra_exacto: true, motivo_diferencia: null,
        snapshot_captura: { fecha: '2026-08-14', nota: 'ya capturado', saldo_credito_disponible: 0, saldo_pendiente_punto: 0 }
      }
    })];

    assert.throws(() => capturarSnapshot({ dbService: ctx.dbService, cuentasJson }), /ya tienen snapshot_captura/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('capturarSnapshot: con --forzar sobreescribe el snapshot existente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 15000, fecha: '2026-01-01' });

    const cuentasJson = [cuenta('R001', {
      conciliacion: {
        saldo_cartera_excel_2026: 100000, abonos_punto_desde_2024: 0,
        saldo_sostenimiento_esperado: 100000, cuadra_exacto: true, motivo_diferencia: null,
        snapshot_captura: { fecha: '2026-08-01', nota: 'viejo', saldo_credito_disponible: 999, saldo_pendiente_punto: 999 }
      }
    })];

    const r = capturarSnapshot({ dbService: ctx.dbService, cuentasJson, forzar: true });

    assert.equal(r.capturadas, 1);
    assert.equal(cuentasJson[0].conciliacion.snapshot_captura.saldo_credito_disponible, 15000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
