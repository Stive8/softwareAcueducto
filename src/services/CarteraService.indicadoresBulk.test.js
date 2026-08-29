// src/services/CarteraService.indicadoresBulk.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const CarteraRepository = require('../repositories/CarteraRepository');

function crearCuenta(dbService, codigo) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

test('getIndicadoresBulk no marca "Deuda 2024" cuando un abono combinado (etiquetado exigible=1) cubrió la apertura opaca por imputación, sin que el abono en sí sea exigible=0', () => {
  // Caso real de las correcciones de carga histórica (cargosPendientesCombinados en
  // paso9b-correcciones.js/paso10-imputacion.js, ver comentario de CarteraRepository.getSaldos):
  // un solo abono de la carga inicial se repartió por FIFO combinado contra deuda exigible Y
  // contra la apertura opaca a la vez, pero quedó etiquetado exigible=1 porque la mayoría de su
  // imputación fue contra deuda exigible. getSaldos ya lo resuelve mirando cartera_imputaciones
  // por cargo (fix 2026-08-07); getIndicadoresBulk todavía sumaba el monto crudo agrupado por la
  // etiqueta del movimiento, así que nunca veía ese abono al filtrar por exigible=0.
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService, 'T912');

    const opaca = repo.crearMovimiento({ cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 6000 });
    const cargoExigible = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2026-01-05', tipo: 'Abono', exigible: 1, monto: -16000 });
    repo.crearImputacion({ abonoId, cargoId: cargoExigible, monto: 10000 });
    repo.crearImputacion({ abonoId, cargoId: opaca, monto: 6000 });

    assert.equal(repo.getSaldos(cuentaId).saldoOpaco, 0, 'precondición: getSaldos ya ve la apertura opaca cubierta');

    const service = new CarteraService(ctx.dbService);
    const indicadores = service.getIndicadoresBulk();

    assert.equal(indicadores[cuentaId], undefined, 'no debería quedar ningún aviso pendiente para esta cuenta');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
