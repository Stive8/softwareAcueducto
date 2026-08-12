// src/services/DashboardService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const DashboardService = require('./DashboardService');
const DashboardRepository = require('../repositories/DashboardRepository');
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

// Auditoría de entrega 2026-08-11: getStats() calculaba getIndicadoresMoraTodas tres veces
// completas (vía getCuentasAlDia(), getCuentasEnMoraIds() y su propio cálculo de
// carteraPendiente). Se unificó en una sola pasada, reutilizada para las tres cifras --
// reordenamiento puro, sin cambiar ningún criterio. Este test verifica que cuentasAlDia y
// cuentasEnMora sigan coincidiendo exactamente con lo que devuelven, por separado,
// DashboardRepository.getCuentasAlDia() / getCuentasEnMoraIds() -- las mismas funciones que
// otras pantallas (ej. CuentaService) siguen usando de forma independiente.
test('getStats: cuentasAlDia y cuentasEnMora coinciden con DashboardRepository.getCuentasAlDia()/getCuentasEnMoraIds() calculados por separado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const idAlDia = sembrarCuenta(db, 'T304');
    const idEnMora = sembrarCuenta(db, 'T305');
    const idConAperturaOpaca = sembrarCuenta(db, 'T306');

    // idEnMora necesita categoría/tarifa vigente: calcularAPagar solo proyecta un mes como
    // impago si puede fijarle una tarifa (ver hallazgo 6 de la auditoría de entrega -- sin
    // categoría, ese mes cae en mesesSinTarifa, no en mesesAPagar, y la cuenta se vería "al
    // día" por error de la propia prueba, no del código).
    db.prepare(`INSERT INTO categorias (nombre) VALUES ('Cat-T305')`).run();
    const categoriaId = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Cat-T305'`).get().id;
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde) VALUES (?, 10000, '2024-01-01')`).run(categoriaId);
    db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2024-01-01')`).run(idEnMora, categoriaId);

    const repo = new CarteraRepository(ctx.dbService);
    const hoy = new Date();
    const cargoAlDia = repo.crearMovimiento({
      cuentaId: idAlDia, fecha: hoy.toISOString().split('T')[0], tipo: 'CargoMensual',
      exigible: 1, monto: 10000, anio: hoy.getFullYear(), mes: hoy.getMonth() + 1
    });
    const abonoAlDia = repo.crearMovimiento({
      cuentaId: idAlDia, fecha: hoy.toISOString().split('T')[0], tipo: 'Abono', exigible: 1, monto: -10000
    });
    repo.crearImputacion({ abonoId: abonoAlDia, cargoId: cargoAlDia, monto: 10000 });
    // idEnMora: un CargoMensual real de enero-2024, nunca pagado -- ya vencido, cae en mora por
    // mesesImpagos. No basta con "nunca pagó y no tiene movimientos": sin ningún CargoMensual
    // previo, el ancla de facturación sería la fecha de creación de la cuenta (hoy), y el único
    // mes que calcularAPagar proyectaría sería el mes en curso -- que el criterio "en mora"
    // (2026-08-13) excluye a propósito por no estar vencido, dejando la cuenta "al día" por
    // error de la prueba, no del código.
    repo.crearMovimiento({ cuentaId: idEnMora, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    repo.crearMovimiento({ cuentaId: idConAperturaOpaca, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 50000 });

    const dashboardService = new DashboardService(ctx.dbService);
    const dashboardRepo = new DashboardRepository(ctx.dbService);

    const stats = dashboardService.getStats();
    const idsActivas = dashboardRepo.getIdsActivas();

    assert.equal(stats.cuentasAlDia, dashboardRepo.getCuentasAlDia());
    assert.equal(stats.cuentasEnMora, dashboardRepo.getCuentasEnMoraIds().length);
    assert.equal(stats.cuentasAlDia + stats.cuentasEnMora, idsActivas.length, 'toda cuenta activa cae en uno de los dos baldes, sin solapar');

    assert.ok(dashboardRepo.getCuentasEnMoraIds().includes(idEnMora));
    assert.ok(dashboardRepo.getCuentasEnMoraIds().includes(idConAperturaOpaca));
    assert.ok(!dashboardRepo.getCuentasEnMoraIds().includes(idAlDia));
  } finally {
    cerrarDbTemporal(ctx);
  }
});
