// src/repositories/DashboardRepository.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const DashboardRepository = require('./DashboardRepository');
const CarteraRepository = require('./CarteraRepository');
const NuevoPuntoRepository = require('./NuevoPuntoRepository');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

function pagarMesActual(repo, cuentaId) {
  const hoy = new Date();
  const cargo = repo.crearMovimiento({
    cuentaId, fecha: hoy.toISOString().split('T')[0], tipo: 'CargoMensual', exigible: 1, monto: 10000,
    anio: hoy.getFullYear(), mes: hoy.getMonth() + 1
  });
  const abonoId = repo.crearMovimiento({ cuentaId, fecha: hoy.toISOString().split('T')[0], tipo: 'Abono', exigible: 1, monto: -10000 });
  repo.crearImputacion({ abonoId, cargoId: cargo, monto: 10000 });
}

test('getCuentasAlDia/getCuentasEnMoraIds: usan cubiertoHasta, no pago_periodos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const idAlDia = sembrarCuenta(db, 'T200');
    const idEnMora = sembrarCuenta(db, 'T201');
    const repo = new CarteraRepository(ctx.dbService);
    pagarMesActual(repo, idAlDia);
    // idEnMora: sin ningún movimiento -- nunca ha pagado.

    const dashRepo = new DashboardRepository(ctx.dbService);
    assert.equal(dashRepo.getCuentasAlDia(), 1);
    assert.ok(dashRepo.getCuentasEnMoraIds().includes(idEnMora));
    assert.ok(!dashRepo.getCuentasEnMoraIds().includes(idAlDia));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCuentasEnMoraIds: incluye una cuenta al día en 2024+ pero con deuda anterior al corte', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T202');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 60000 });
    pagarMesActual(repo, cuentaId);

    const dashRepo = new DashboardRepository(ctx.dbService);
    assert.ok(dashRepo.getCuentasEnMoraIds().includes(cuentaId), 'la apertura opaca sola ya cuenta como mora');
    assert.equal(dashRepo.getCuentasAlDia(), 0, 'no debe contar como al día');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCuentasEnMoraIds: el punto de conexión pendiente NO cuenta como mora', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T203');
    const repo = new CarteraRepository(ctx.dbService);
    pagarMesActual(repo, cuentaId);
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);
    puntoRepo.create({ cuentaId, valorTotal: 500000, fechaRegistro: '2026-01-01' });

    const dashRepo = new DashboardRepository(ctx.dbService);
    assert.ok(!dashRepo.getCuentasEnMoraIds().includes(cuentaId), 'solo tiene punto pendiente -- no es mora corriente');
    assert.equal(dashRepo.getCuentasAlDia(), 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getIdsActivas: solo cuentas con estado Activo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const idActiva = sembrarCuenta(db, 'T204');
    db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES ('T205', 'Vereda Test', 'Suspendido')`).run();

    const dashRepo = new DashboardRepository(ctx.dbService);
    const ids = dashRepo.getIdsActivas();

    assert.ok(ids.includes(idActiva));
    assert.equal(ids.length, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
