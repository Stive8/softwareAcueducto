// src/services/DashboardService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const DashboardService = require('./DashboardService');
const CarteraRepository = require('../repositories/CarteraRepository');
const NuevoPuntoRepository = require('../repositories/NuevoPuntoRepository');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

test('DashboardService no depende de PagoService en absoluto', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new DashboardService(ctx.dbService);
    assert.equal(service.pagoService, undefined, 'carteraPendiente ya no debe pasar por PagoService.getEstadoCuenta');
    assert.ok(service.carteraService, 'debe calcular directo desde CarteraService');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getStats: carteraPendiente suma deudaAntes2024 + deudaExigible + deudaPuntoConexion, sobre todas las cuentas activas', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const idApertura = sembrarCuenta(db, 'T300');
    const idExigible = sembrarCuenta(db, 'T301');
    const idPunto = sembrarCuenta(db, 'T302');

    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId: idApertura, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 20000 });
    repo.crearMovimiento({ cuentaId: idExigible, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);
    puntoRepo.create({ cuentaId: idPunto, valorTotal: 500000, fechaRegistro: '2026-01-01' });

    const service = new DashboardService(ctx.dbService);
    const stats = service.getStats();

    assert.equal(stats.carteraPendiente, 20000 + 10000 + 500000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getStats: carteraPendiente no descuenta el saldo a favor', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T303');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 5000, fecha: '2026-01-01' });

    const service = new DashboardService(ctx.dbService);
    const stats = service.getStats();

    assert.equal(stats.carteraPendiente, 10000, 'el crédito no resta -- va aparte, como pasivo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
