// src/services/PagoService.abonoDeudaAnterior.test.js
//
// "Abonar deuda anterior al corte (2024)": hasta ahora el aviso en pantalla (ver
// renderCarteraDetalle en pagos.js) mostraba el monto de la apertura opaca pero no tenía ningún
// botón de acción -- documentado como funcionalidad pendiente en README.md. El motor de cartera
// ya sabía imputar contra ese bucket (CarteraService.registrarAbono con modo AbonoSaldoOpaco),
// solo faltaba el flujo de cobro completo (recibo + movimiento de caja/banco + asiento contable),
// igual que ya existe para sostenimiento (registrarPagoSostenimiento) y para conexión
// (NuevoPuntoService.registrarAbono).
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const PagoService = require('./PagoService');
const CarteraService = require('./CarteraService');

function sembrarCuentaConDeudaOpaca(db, dbService, { codigo = 'T001', saldoOpaco = 50000 } = {}) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;

  const propietarioId = db.prepare(
    `INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test')`
  ).run().lastInsertRowid;
  db.prepare(
    `INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2020-01-01')`
  ).run(cuentaId, propietarioId);

  const carteraService = new CarteraService(dbService);
  carteraService.repository.crearMovimiento({
    cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: saldoOpaco
  });

  return cuentaId;
}

test('registrarAbonoDeudaAnterior genera un recibo y reduce la deuda anterior al corte (2024) en el motor de cartera', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaConDeudaOpaca(db, ctx.dbService, { saldoOpaco: 50000 });
    const pagoService = new PagoService(ctx.dbService);
    const carteraService = new CarteraService(ctx.dbService);

    const r = pagoService.registrarAbonoDeudaAnterior({
      cuentaId, monto: 20000, fecha: '2026-04-01', metodoPago: 'Efectivo'
    });

    assert.equal(r.total, 20000);
    assert.ok(r.numeroRecibo);
    assert.ok(r.reciboId);

    const recibo = db.prepare(`SELECT total, metodo_pago FROM recibos WHERE id = ?`).get(r.reciboId);
    assert.equal(recibo.total, 20000);
    assert.equal(recibo.metodo_pago, 'Efectivo');

    assert.equal(carteraService.getEstadoCartera(cuentaId).deudaAntes2024, 30000);

    const movimientoCaja = db.prepare(
      `SELECT monto, tipo, origen FROM movimientos WHERE referencia_id = ? AND referencia_tipo = 'Recibo'`
    ).get(r.reciboId);
    assert.equal(movimientoCaja.monto, 20000);
    assert.equal(movimientoCaja.tipo, 'Ingreso');
    assert.equal(movimientoCaja.origen, 'Caja');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarAbonoDeudaAnterior rechaza un monto mayor a la deuda anterior al corte disponible', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaConDeudaOpaca(db, ctx.dbService, { saldoOpaco: 10000 });
    const pagoService = new PagoService(ctx.dbService);

    assert.throws(
      () => pagoService.registrarAbonoDeudaAnterior({
        cuentaId, monto: 15000, fecha: '2026-04-01', metodoPago: 'Efectivo'
      }),
      /no puede exceder/
    );

    const { total: recibos } = db.prepare(`SELECT COUNT(*) AS total FROM recibos WHERE cuenta_id = ?`).get(cuentaId);
    assert.equal(recibos, 0, 'no debe quedar ningún recibo si la validación falla');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarAbonoDeudaAnterior rechaza una cuenta sin deuda anterior al corte', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T002', 'Vereda Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T002'`).get().id;
    const propietarioId = db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test')`).run().lastInsertRowid;
    db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2020-01-01')`).run(cuentaId, propietarioId);

    const pagoService = new PagoService(ctx.dbService);

    assert.throws(
      () => pagoService.registrarAbonoDeudaAnterior({
        cuentaId, monto: 5000, fecha: '2026-04-01', metodoPago: 'Efectivo'
      }),
      /no tiene deuda anterior al corte/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
