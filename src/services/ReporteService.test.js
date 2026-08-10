// src/services/ReporteService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ReporteService = require('./ReporteService');
const CarteraRepository = require('../repositories/CarteraRepository');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

test('reporteBalanceGeneral: cuentas por cobrar se desglosa en tres líneas (apertura, 2024+, punto)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T100');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 20000 });
    repo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });

    const service = new ReporteService(ctx.dbService);
    const r = service.reporteBalanceGeneral({});
    const seccionCartera = r.secciones.find(s => s.titulo.startsWith('Cartera Pendiente'));

    assert.ok(seccionCartera, 'debe existir la sección de cartera pendiente');
    assert.deepEqual(seccionCartera.items.map(i => i.valor), [20000, 10000, 0]);
    assert.equal(seccionCartera.total, 30000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reporteBalanceGeneral: el saldo a favor aparece en su propia sección, sin restar de cuentas por cobrar', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T101');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 15000, fecha: '2026-01-01' });

    const service = new ReporteService(ctx.dbService);
    const r = service.reporteBalanceGeneral({});

    const seccionCartera = r.secciones.find(s => s.titulo.startsWith('Cartera Pendiente'));
    assert.equal(seccionCartera.total, 10000, 'el crédito no descuenta la deuda 2024+ en este reporte');

    const seccionCredito = r.secciones.find(s => s.titulo.startsWith('Saldo a Favor'));
    assert.ok(seccionCredito, 'debe existir la sección de saldo a favor');
    assert.equal(seccionCredito.total, 15000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reporteBalanceGeneral: las secciones informativas no alteran Activo=Pasivo+Patrimonio', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T102');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 999000 });
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 888000, fecha: '2026-01-01' });

    const service = new ReporteService(ctx.dbService);
    const r = service.reporteBalanceGeneral({});

    const activos = r.secciones.find(s => s.titulo === 'Activos');
    const pasivos = r.secciones.find(s => s.titulo === 'Pasivos');
    const patrimonio = r.secciones.find(s => s.titulo === 'Patrimonio');

    assert.equal(activos.total, 0, 'sin asientos contables reales, el balance real sigue en 0');
    assert.equal(pasivos.total, 0);
    assert.equal(patrimonio.total, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('procesarEstadoCuentas: motivo_mora distingue meses corrientes de deuda anterior al corte', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const idSoloApertura = sembrarCuenta(db, 'T103');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId: idSoloApertura, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 40000 });
    const hoy = new Date();
    const cargo = repo.crearMovimiento({
      cuentaId: idSoloApertura, fecha: hoy.toISOString().split('T')[0], tipo: 'CargoMensual', exigible: 1, monto: 10000,
      anio: hoy.getFullYear(), mes: hoy.getMonth() + 1
    });
    const abonoId = repo.crearMovimiento({ cuentaId: idSoloApertura, fecha: hoy.toISOString().split('T')[0], tipo: 'Abono', exigible: 1, monto: -10000 });
    repo.crearImputacion({ abonoId, cargoId: cargo, monto: 10000 });

    const service = new ReporteService(ctx.dbService);
    const fila = service.procesarEstadoCuentas().find(f => f.codigo === 'T103');

    assert.equal(fila.en_mora, true, 'al día en 2024+ pero con apertura opaca -- igual cuenta como en mora');
    assert.deepEqual(fila.motivo_mora, ['deuda_anterior_2024']);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reporteCuentasEnMora: incluye la columna de motivo legible', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T104');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 15000 });
    const hoy = new Date();
    const cargo = repo.crearMovimiento({
      cuentaId, fecha: hoy.toISOString().split('T')[0], tipo: 'CargoMensual', exigible: 1, monto: 10000,
      anio: hoy.getFullYear(), mes: hoy.getMonth() + 1
    });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: hoy.toISOString().split('T')[0], tipo: 'Abono', exigible: 1, monto: -10000 });
    repo.crearImputacion({ abonoId, cargoId: cargo, monto: 10000 });

    const service = new ReporteService(ctx.dbService);
    const r = service.reporteCuentasEnMora();
    const fila = r.filas.find(f => f.codigo === 'T104');

    assert.ok(fila, 'debe aparecer en el reporte de cuentas en mora');
    assert.equal(fila.motivo_mora_label, 'Deuda anterior al corte');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
