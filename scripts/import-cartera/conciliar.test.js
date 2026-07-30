// scripts/import-cartera/conciliar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { conciliar } = require('./conciliar');
const CarteraRepository = require('../../src/repositories/CarteraRepository');

function sembrarCuenta(dbService, codigo) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

test('conciliar compara el saldo calculado contra el de referencia del Excel, dentro de tolerancia', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, 'R034');
    const carteraRepo = new CarteraRepository(ctx.dbService);
    carteraRepo.crearMovimiento({ cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 240000 });
    carteraRepo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 130000, anio: 2026, mes: 1 });

    const plan = { cuentas: [{ codigo: 'R034', cuentaId, saldoReferencia2025: 370000 }] };
    const r = conciliar({ plan, dbService: ctx.dbService });

    assert.equal(r.comparadas, 1);
    assert.equal(r.coinciden, 1);
    assert.equal(r.difieren.length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reporta las cuentas cuyo saldo calculado difiere del de referencia', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, 'X001');
    const carteraRepo = new CarteraRepository(ctx.dbService);
    carteraRepo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 50000, anio: 2026, mes: 1 });

    const plan = { cuentas: [{ codigo: 'X001', cuentaId, saldoReferencia2025: 999000 }] };
    const r = conciliar({ plan, dbService: ctx.dbService });

    assert.equal(r.coinciden, 0);
    assert.equal(r.difieren.length, 1);
    assert.equal(r.difieren[0].codigo, 'X001');
    assert.equal(r.difieren[0].esperado, 999000);
    assert.equal(r.difieren[0].calculado, 50000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('ignora cuentas sin saldoReferencia2025 (no comparable)', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, 'X002');
    const plan = { cuentas: [{ codigo: 'X002', cuentaId, saldoReferencia2025: null }] };
    const r = conciliar({ plan, dbService: ctx.dbService });
    assert.equal(r.comparadas, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
