// src/repositories/DashboardRepository.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const DashboardRepository = require('./DashboardRepository');
const CarteraRepository = require('./CarteraRepository');
const NuevoPuntoRepository = require('./NuevoPuntoRepository');
const CarteraService = require('../services/CarteraService');

function sembrarCuenta(db, codigo, { conCategoria = false } = {}) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;

  // mesesImpagos (a diferencia del viejo criterio por cubiertoHasta) necesita poder proyectar
  // una tarifa para el mes en curso -- sin categoría, calcularAPagar no tiene con qué proyectar
  // y el mes queda en mesesSinTarifa, no en mesesAPagar (ver hallazgo 6 de la auditoría).
  if (conCategoria) {
    db.prepare(`INSERT INTO categorias (nombre) VALUES (?)`).run(`Cat-${codigo}`);
    const categoriaId = db.prepare(`SELECT id FROM categorias WHERE nombre = ?`).get(`Cat-${codigo}`).id;
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
                VALUES (?, 10000, '2024-01-01')`).run(categoriaId);
    db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
                VALUES (?, ?, '2024-01-01')`).run(cuentaId, categoriaId);
  }

  return cuentaId;
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

test('getCuentasAlDia/getCuentasEnMoraIds: usan mesesImpagos (cartera), no pago_periodos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const idAlDia = sembrarCuenta(db, 'T200');
    const idEnMora = sembrarCuenta(db, 'T201', { conCategoria: true });
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

test('getCuentasEnMoraIds: una cuenta sin tarifa vigente después de su último cargo ya no cuenta como en mora (antes divergía de Reportes/Pagos)', () => {
  // Antes (auditoría de entrega, hallazgo 12) este archivo usaba el rango contra cubiertoHasta
  // (codificarPeriodo(cubiertoHasta) < periodoActual): una cuenta cuyo último CargoMensual
  // quedó pagado hace tiempo, y a la que después dejó de proyectársele deuda nueva porque su
  // categoría no tiene tarifa vigente más allá de esa fecha (mesesSinTarifa, hallazgo 6),
  // quedaba marcada "en mora" para siempre en Dashboard/Cuentas -- mientras que Reportes y la
  // tabla de Pagos, que ya usaban mesesImpagos, la mostraban "al día" (mesesAPagar vacío, esos
  // meses no proyectables ni siquiera entran a la cuenta). Dashboard/Cuentas decían "en mora"
  // exactamente donde el resto de la aplicación decía "al día", para la misma cuenta.
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T206');
    db.prepare(`INSERT INTO categorias (nombre) VALUES ('Categoria sin tarifa vigente')`).run();
    const categoriaId = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Categoria sin tarifa vigente'`).get().id;
    // La tarifa solo cubre enero-marzo 2024 -- nada la reemplaza después.
    db.prepare(`
      INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta)
      VALUES (?, 10000, '2024-01-01', '2024-03-31')
    `).run(categoriaId);
    db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2024-01-01')`)
      .run(cuentaId, categoriaId);

    const repo = new CarteraRepository(ctx.dbService);
    for (const mes of [1, 2, 3]) {
      const cargo = repo.crearMovimiento({
        cuentaId, fecha: `2024-0${mes}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes
      });
      const abonoId = repo.crearMovimiento({ cuentaId, fecha: `2024-0${mes}-01`, tipo: 'Abono', exigible: 1, monto: -10000 });
      repo.crearImputacion({ abonoId, cargoId: cargo, monto: 10000 });
    }
    // Abril 2024 en adelante: sin tarifa vigente, nunca se causa ningún CargoMensual nuevo.

    const dashRepo = new DashboardRepository(ctx.dbService);
    assert.ok(
      !dashRepo.getCuentasEnMoraIds().includes(cuentaId),
      'sin meses realmente impagos (los posteriores a marzo 2024 no son proyectables), no debe marcarse en mora'
    );

    // Los 3 meses causados sí quedaron completamente cubiertos -- no hay deuda exigible real.
    const carteraService = new CarteraService(ctx.dbService);
    assert.equal(carteraService.getEstadoCartera(cuentaId).deudaExigible, 0);
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
