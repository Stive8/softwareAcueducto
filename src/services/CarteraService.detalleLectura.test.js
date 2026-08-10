// src/services/CarteraService.detalleLectura.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const CarteraRepository = require('../repositories/CarteraRepository');
const NuevoPuntoRepository = require('../repositories/NuevoPuntoRepository');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

function asignarTarifaFinca(db, cuentaId, fechaInicio = '2020-01-01') {
  let catFila = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get();
  if (!catFila) {
    db.prepare(`INSERT INTO categorias (nombre) VALUES ('Finca')`).run();
    catFila = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get();
  }
  if (!db.prepare(`SELECT id FROM categoria_tarifas WHERE categoria_id = ?`).get(catFila.id)) {
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde) VALUES (?, 10000, '2020-01-01')`).run(catFila.id);
  }
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, ?)`).run(cuentaId, catFila.id, fechaInicio);
}

test('getDetalleCartera: trae los movimientos con su observación', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService.getDb(), 'T900');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({
      cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000,
      anio: 2024, mes: 1, observaciones: 'Tarifa corregida a la vigente 2024'
    });
    repo.crearMovimiento({
      cuentaId, fecha: '2024-02-01', tipo: 'Abono', exigible: 1, monto: -10000
    });

    const service = new CarteraService(ctx.dbService);
    const { movimientos } = service.getDetalleCartera(cuentaId);

    assert.equal(movimientos.length, 2);
    assert.equal(movimientos[0].observaciones, 'Tarifa corregida a la vigente 2024');
    assert.equal(movimientos[1].observaciones, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getDetalleCartera: trae los puntos de conexión con sus abonos', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService.getDb(), 'T901');
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);
    const puntoId = puntoRepo.create({ cuentaId, valorTotal: 200000, fechaRegistro: '2023-01-01' });
    puntoRepo.crearAbono({ nuevoPuntoId: puntoId, monto: 50000, fechaAbono: '2023-06-01' });
    puntoRepo.actualizarSaldoYEstado(puntoId);

    const service = new CarteraService(ctx.dbService);
    const { puntosConexion } = service.getDetalleCartera(cuentaId);

    assert.equal(puntosConexion.length, 1);
    assert.equal(puntosConexion[0].saldo_pendiente, 150000);
    assert.equal(puntosConexion[0].abonos.length, 1);
    assert.equal(puntosConexion[0].abonos[0].monto, 50000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getIndicadoresBulk: marca solo las cuentas con algún aviso pendiente, con 3 consultas fijas', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const idOpaca = sembrarCuenta(db, 'T910');
    const idCredito = sembrarCuenta(db, 'T911');
    const idPunto = sembrarCuenta(db, 'T912');
    const idSinAvisos = sembrarCuenta(db, 'T913');

    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId: idOpaca, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 100000 });
    repo.crearCredito({ cuentaId: idCredito, tipo: 'Abono', monto: 50000, fecha: '2024-05-04' });
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);
    puntoRepo.create({ cuentaId: idPunto, valorTotal: 200000, fechaRegistro: '2023-01-01' });

    const service = new CarteraService(ctx.dbService);
    const indicadores = service.getIndicadoresBulk();

    assert.equal(indicadores[idOpaca].deudaAntes2024, true);
    assert.equal(indicadores[idOpaca].saldoCreditoDisponible, false, 'no tiene aviso de crédito');
    assert.equal(indicadores[idCredito].saldoCreditoDisponible, true);
    assert.equal(indicadores[idPunto].puntoConexion, true);
    assert.equal(indicadores[idSinAvisos], undefined, 'sin avisos, ni siquiera aparece');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getIndicadoresBulk: una apertura opaca ya redimida a crédito (negativa) no marca deuda anterior', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T914');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 0 });
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 50000, fecha: '2023-12-31' });

    const service = new CarteraService(ctx.dbService);
    const indicadores = service.getIndicadoresBulk();

    assert.equal(indicadores[cuentaId].deudaAntes2024, false);
    assert.equal(indicadores[cuentaId].saldoCreditoDisponible, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getIndicadoresMoraTodas: trae cubiertoHasta, deudaExigible, deudaAntes2024 y deudaPuntoConexion por cada cuenta pedida', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const idConTodo = sembrarCuenta(db, 'T920');
    const idSinNada = sembrarCuenta(db, 'T921');

    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId: idConTodo, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 80000 });
    const cargo = repo.crearMovimiento({ cuentaId: idConTodo, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    const abonoId = repo.crearMovimiento({ cuentaId: idConTodo, fecha: '2026-01-05', tipo: 'Abono', exigible: 1, monto: -4000 });
    repo.crearImputacion({ abonoId, cargoId: cargo, monto: 4000 });
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);
    puntoRepo.create({ cuentaId: idConTodo, valorTotal: 500000, fechaRegistro: '2026-01-01' });

    const service = new CarteraService(ctx.dbService);
    const indicadores = service.getIndicadoresMoraTodas([idConTodo, idSinNada]);

    const deConTodo = indicadores.find(i => i.cuentaId === idConTodo);
    assert.equal(deConTodo.cubiertoHasta, null, 'el cargo de enero quedó parcial, no cubierto');
    assert.equal(deConTodo.deudaExigible, 6000, '10.000 - 4.000');
    assert.equal(deConTodo.deudaAntes2024, 80000);
    assert.equal(deConTodo.deudaPuntoConexion, 500000);

    const deSinNada = indicadores.find(i => i.cuentaId === idSinNada);
    assert.equal(deSinNada.cubiertoHasta, null);
    assert.equal(deSinNada.deudaExigible, 0);
    assert.equal(deSinNada.deudaAntes2024, 0);
    assert.equal(deSinNada.deudaPuntoConexion, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCartera: mesesAPagar distingue causado=true (cargo ya facturado con saldo pendiente) de causado=false (mes futuro/actual proyectado, reproduce el caso real de R007)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T901');
    asignarTarifaFinca(db, cuentaId, '2024-01-01');
    const repo = new CarteraRepository(ctx.dbService);

    // Noviembre-2024 cubierto completo -- cubiertoHasta arranca ahí, así calcularAPagar empieza
    // en diciembre en vez de arrastrar meses de años anteriores.
    const cargoNov = repo.crearMovimiento({ cuentaId, fecha: '2024-11-01', tipo: 'CargoMensual', exigible: 1, monto: 16000, anio: 2024, mes: 11 });
    const abonoNov = repo.crearMovimiento({ cuentaId, fecha: '2024-11-05', tipo: 'Abono', exigible: 1, monto: -16000 });
    repo.crearImputacion({ abonoId: abonoNov, cargoId: cargoNov, monto: 16000 });

    // Diciembre-2024: CargoMensual real, solo $4.000 de $16.000 cubiertos -- deuda ya facturada.
    const cargoDic = repo.crearMovimiento({ cuentaId, fecha: '2024-12-01', tipo: 'CargoMensual', exigible: 1, monto: 16000, anio: 2024, mes: 12 });
    const abonoDic = repo.crearMovimiento({ cuentaId, fecha: '2024-12-05', tipo: 'Abono', exigible: 1, monto: -4000 });
    repo.crearImputacion({ abonoId: abonoDic, cargoId: cargoDic, monto: 4000 });

    const service = new CarteraService(ctx.dbService);
    const estado = service.getEstadoCartera(cuentaId);

    const dic2024 = estado.mesesAPagar.find(m => m.anio === 2024 && m.mes === 12);
    assert.ok(dic2024, 'diciembre-2024 debe aparecer en mesesAPagar');
    assert.equal(dic2024.causado, true, 'ya tiene un CargoMensual real facturado, con saldo pendiente');
    assert.equal(dic2024.valor, 12000);

    const hoy = new Date();
    const mesActual = estado.mesesAPagar.find(m => m.anio === hoy.getFullYear() && m.mes === hoy.getMonth() + 1);
    assert.ok(mesActual, 'el mes actual debe aparecer proyectado en mesesAPagar');
    assert.equal(mesActual.causado, false, 'todavía no tiene CargoMensual -- es una proyección, no una deuda ya facturada');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getMotivoDiferencia: devuelve el texto fijo para una cuenta documentada, null para las demás', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const idC021 = sembrarCuenta(db, 'C021');
    const idT900 = sembrarCuenta(db, 'T900');

    const service = new CarteraService(ctx.dbService);
    assert.match(service.getMotivoDiferencia(idC021), /error aritmético/);
    assert.equal(service.getMotivoDiferencia(idT900), null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
