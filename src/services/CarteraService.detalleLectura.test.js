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
