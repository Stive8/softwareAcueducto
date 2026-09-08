// src/services/CarteraService.declararDeudaApertura.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');

function crearCuenta(dbService, codigo = 'T001') {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

test('declararDeudaApertura crea un movimiento AperturaOpaca no exigible con fecha fija 2023-12-31', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CarteraService(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);

    service.declararDeudaApertura({ cuentaId, monto: 240000, observaciones: 'Deuda 2022-2023', usuarioId: 1 });

    const estado = service.getEstadoCartera(cuentaId);
    assert.equal(estado.saldoOpaco, 240000);

    const movimiento = ctx.dbService.getDb()
      .prepare(`SELECT fecha, tipo, exigible, monto, observaciones FROM cartera_movimientos WHERE cuenta_id = ?`)
      .get(cuentaId);
    assert.equal(movimiento.fecha, '2023-12-31');
    assert.equal(movimiento.tipo, 'AperturaOpaca');
    assert.equal(movimiento.exigible, 0);
    assert.equal(movimiento.monto, 240000);
    assert.equal(movimiento.observaciones, 'Deuda 2022-2023');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('declararDeudaApertura rechaza si la cuenta ya tiene una deuda de apertura registrada', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CarteraService(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    service.declararDeudaApertura({ cuentaId, monto: 100000, usuarioId: 1 });

    assert.throws(
      () => service.declararDeudaApertura({ cuentaId, monto: 50000, usuarioId: 1 }),
      /ya tiene una deuda anterior al corte registrada/
    );

    const estado = service.getEstadoCartera(cuentaId);
    assert.equal(estado.saldoOpaco, 100000, 'no debe agregarse una segunda apertura');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('declararDeudaApertura rechaza monto cero o negativo', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CarteraService(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);

    assert.throws(() => service.declararDeudaApertura({ cuentaId, monto: 0, usuarioId: 1 }),
      /El monto debe ser mayor a cero/);
    assert.throws(() => service.declararDeudaApertura({ cuentaId, monto: -1000, usuarioId: 1 }),
      /El monto debe ser mayor a cero/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('declararDeudaApertura exige cuentaId', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CarteraService(ctx.dbService);
    assert.throws(() => service.declararDeudaApertura({ cuentaId: null, monto: 1000, usuarioId: 1 }),
      /La cuenta es obligatoria/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
