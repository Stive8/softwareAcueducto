// src/repositories/CarteraRepository.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraRepository = require('./CarteraRepository');
const { codificarPeriodo } = require('../services/cartera/periodos');

function crearCuenta(dbService, codigo = 'T001') {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

test('getSaldos separa la deuda exigible del saldo opaco', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);

    repo.crearMovimiento({ cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 180000 });
    const cargoEne = repo.crearMovimiento({ cuentaId, fecha: '2022-01-01', tipo: 'CargoMensual', exigible: 1, monto: 5000, anio: 2022, mes: 1 });
    repo.crearMovimiento({ cuentaId, fecha: '2022-02-01', tipo: 'CargoMensual', exigible: 1, monto: 5000, anio: 2022, mes: 2 });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2022-03-15', tipo: 'Abono', exigible: 1, monto: -3000 });
    // getSaldos reparte por lo que dice cartera_imputaciones, no por la etiqueta del abono --
    // simula que el paso de imputación ya corrió.
    repo.crearImputacion({ abonoId, cargoId: cargoEne, monto: 3000 });

    const s = repo.getSaldos(cuentaId);
    assert.equal(s.deudaExigible, 7000);
    assert.equal(s.saldoOpaco, 180000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getSaldos devuelve deuda exigible negativa cuando una recategorización hacia abajo deja un mes ya pagado por encima de lo que ahora debe', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    const cargoId = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2026-01-05', tipo: 'Abono', exigible: 1, monto: -10000 });
    repo.crearImputacion({ abonoId, cargoId, monto: 10000 });
    // Recategorización hacia abajo sobre un mes ya pagado del todo: el AjusteCategoria negativo
    // deja ese mes en -20.000 neto (no hay con qué imputar un ajuste negativo, es la fuente de
    // saldo a favor implícito que describe CarteraService.getEstadoCartera).
    repo.crearMovimiento({ cuentaId, fecha: '2026-01-06', tipo: 'AjusteCategoria', exigible: 1, monto: -20000, anio: 2026, mes: 1 });
    assert.equal(repo.getSaldos(cuentaId).deudaExigible, -20000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getSaldos de una cuenta sin movimientos devuelve ceros', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    assert.deepEqual(repo.getSaldos(cuentaId), { deudaExigible: 0, saldoOpaco: 0 });
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getPeriodosDeAbono devuelve los meses cubiertos por un abono que pagó varios meses', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);

    const c1 = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 20000, anio: 2026, mes: 1 });
    const c2 = repo.crearMovimiento({ cuentaId, fecha: '2026-02-01', tipo: 'CargoMensual', exigible: 1, monto: 20000, anio: 2026, mes: 2 });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2026-03-01', tipo: 'Abono', exigible: 1, monto: -40000 });
    repo.crearImputacion({ abonoId, cargoId: c1, monto: 20000 });
    repo.crearImputacion({ abonoId, cargoId: c2, monto: 20000 });

    const periodos = repo.getPeriodosDeAbono(abonoId);
    assert.deepEqual(periodos, [{ anio: 2026, mes: 1 }, { anio: 2026, mes: 2 }]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getPeriodosDeAbono no cuenta cargos sin mes (ej. AperturaOpaca) como período', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);

    const opaca = repo.crearMovimiento({ cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 50000 });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'Abono', exigible: 0, monto: -50000 });
    repo.crearImputacion({ abonoId, cargoId: opaca, monto: 50000 });

    assert.deepEqual(repo.getPeriodosDeAbono(abonoId), []);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCargosPendientes descuenta lo imputado, ordena por período y omite los cubiertos', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);

    const c1 = repo.crearMovimiento({ cuentaId, fecha: '2026-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 2 });
    const c2 = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    const c3 = repo.crearMovimiento({ cuentaId, fecha: '2026-03-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 3 });
    const abono = repo.crearMovimiento({ cuentaId, fecha: '2026-04-01', tipo: 'Abono', exigible: 1, monto: -14000 });

    repo.crearImputacion({ abonoId: abono, cargoId: c2, monto: 10000 });  // enero: cubierto
    repo.crearImputacion({ abonoId: abono, cargoId: c1, monto: 4000 });   // febrero: parcial

    const pend = repo.getCargosPendientes(cuentaId, 1);
    assert.equal(pend.length, 2, 'enero queda cubierto y no aparece');
    assert.deepEqual(pend.map(c => `${c.anio}-${c.mes}`), ['2026-2', '2026-3'], 'orden por período');
    assert.equal(pend[0].id, c1);
    assert.equal(pend[0].pendiente, 6000);
    assert.equal(pend[1].id, c3);
    assert.equal(pend[1].pendiente, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCargosPendientes incluye los AjusteCategoria positivos y excluye los negativos', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2025-11-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2025, mes: 11 });
    const ajuste = repo.crearMovimiento({ cuentaId, fecha: '2026-07-29', tipo: 'AjusteCategoria', exigible: 1, monto: 6000, anio: 2025, mes: 11 });
    repo.crearMovimiento({ cuentaId, fecha: '2026-07-29', tipo: 'AjusteCategoria', exigible: 1, monto: -2000, anio: 2025, mes: 12 });

    const pend = repo.getCargosPendientes(cuentaId, 1);
    assert.equal(pend.length, 2, 'el cargo y el ajuste positivo; el negativo no es cobrable');
    assert.ok(pend.some(c => c.id === ajuste && c.pendiente === 6000));
    assert.ok(!pend.some(c => c.monto < 0));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCargosPendientes filtra por exigible: los opacos no se mezclan con los cobrables', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    const opaco = repo.crearMovimiento({ cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 180000 });
    repo.crearMovimiento({ cuentaId, fecha: '2022-01-01', tipo: 'CargoMensual', exigible: 1, monto: 5000, anio: 2022, mes: 1 });

    const exigibles = repo.getCargosPendientes(cuentaId, 1);
    const opacos = repo.getCargosPendientes(cuentaId, 0);
    assert.equal(exigibles.length, 1);
    assert.equal(exigibles[0].monto, 5000);
    assert.equal(opacos.length, 1);
    assert.equal(opacos[0].id, opaco);
    assert.equal(opacos[0].anio, null, 'la apertura no tiene mes');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getMesesCausados devuelve los códigos de período ya causados', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    repo.crearMovimiento({ cuentaId, fecha: '2026-03-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 3 });

    const causados = repo.getMesesCausados(cuentaId);
    assert.ok(causados.has(codificarPeriodo(2026, 1)));
    assert.ok(!causados.has(codificarPeriodo(2026, 2)));
    assert.ok(causados.has(codificarPeriodo(2026, 3)));
    assert.equal(causados.size, 2);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getTotalImputadoDeAbono suma lo que un abono cubrió', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    const c1 = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    const abono = repo.crearMovimiento({ cuentaId, fecha: '2026-01-05', tipo: 'Abono', exigible: 1, monto: -30000 });
    repo.crearImputacion({ abonoId: abono, cargoId: c1, monto: 10000 });

    assert.equal(repo.getTotalImputadoDeAbono(abono), 10000);
    assert.equal(repo.getTotalImputadoDeAbono(c1), 0, 'un cargo no imputa a nada');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCargoMensual encuentra el cargo de un mes concreto', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    assert.equal(repo.getCargoMensual(cuentaId, 2026, 1).monto, 10000);
    assert.equal(repo.getCargoMensual(cuentaId, 2026, 2), undefined);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarMontoMovimiento recorta el monto de un movimiento ya creado', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'Abono', exigible: 1, monto: -60000 });

    repo.actualizarMontoMovimiento(abonoId, -10000);

    const fila = ctx.dbService.getDb().prepare('SELECT monto FROM cartera_movimientos WHERE id = ?').get(abonoId);
    assert.equal(fila.monto, -10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarMontoMovimiento sin tercer parámetro no toca observaciones', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'Abono', exigible: 1, monto: -60000, observaciones: 'original' });

    repo.actualizarMontoMovimiento(abonoId, -10000);

    const fila = ctx.dbService.getDb().prepare('SELECT monto, observaciones FROM cartera_movimientos WHERE id = ?').get(abonoId);
    assert.equal(fila.monto, -10000);
    assert.equal(fila.observaciones, 'original');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarMontoMovimiento con tercer parámetro reemplaza observaciones', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'Abono', exigible: 1, monto: -60000 });

    repo.actualizarMontoMovimiento(abonoId, 0, 'Convertido íntegro a saldo a favor (sin imputación)');

    const fila = ctx.dbService.getDb().prepare('SELECT monto, observaciones FROM cartera_movimientos WHERE id = ?').get(abonoId);
    assert.equal(fila.monto, 0);
    assert.equal(fila.observaciones, 'Convertido íntegro a saldo a favor (sin imputación)');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getSaldoCreditoDisponible: un Abono sin Aplicado queda disponible entero', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 90000, fecha: '2024-05-04' });
    assert.equal(repo.getSaldoCreditoDisponible(cuentaId), 90000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getSaldoCreditoDisponible descuenta lo ya Aplicado, aunque sea parcial', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 90000, fecha: '2024-05-04' });
    repo.crearCredito({ cuentaId, tipo: 'Aplicado', monto: 30000, fecha: '2026-01-01' });
    assert.equal(repo.getSaldoCreditoDisponible(cuentaId), 60000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getSaldoCreditoDisponible de una cuenta sin créditos es 0', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    assert.equal(repo.getSaldoCreditoDisponible(cuentaId), 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('crearCredito guarda abono_movimiento_id para trazar a qué Abono se aplicó', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'Abono', exigible: 1, monto: -30000 });
    repo.crearCredito({ cuentaId, tipo: 'Aplicado', monto: 30000, fecha: '2026-01-01', abonoMovimientoId: abonoId });

    const [fila] = repo.getCreditos(cuentaId);
    assert.equal(fila.abono_movimiento_id, abonoId);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCreditos devuelve el historial ordenado por fecha', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 50000, fecha: '2026-02-01' });
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 90000, fecha: '2024-05-04' });

    const historial = repo.getCreditos(cuentaId);
    assert.equal(historial.length, 2);
    assert.equal(historial[0].monto, 90000, 'la más vieja primero');
    assert.equal(historial[1].monto, 50000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
