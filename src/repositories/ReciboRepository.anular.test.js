// src/repositories/ReciboRepository.anular.test.js
// Cubre la extensión que hace que anular un recibo también revierta el lado de cartera
// (cartera_movimientos/cartera_imputaciones), que hasta ahora quedaba intacto.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ReciboRepository = require('./ReciboRepository');
const CarteraService = require('../services/CarteraService');

function sembrarReciboConAbono(db, dbService) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Vereda Test')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;
  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test')`).run();
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Propietario Test'`).get().id;

  const service = new CarteraService(dbService);
  service.repository.crearMovimiento({
    cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1
  });

  const reciboId = db.prepare(`
    INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
    VALUES (5001, ?, ?, '2024-01-15', 10000, 'Efectivo')
  `).run(cuentaId, propietarioId).lastInsertRowid;
  const detalleId = db.prepare(`
    INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, 'Cuota enero 2024', 10000)
  `).run(reciboId).lastInsertRowid;

  service.registrarAbono({
    cuentaId, fecha: '2024-01-15', monto: 10000, modo: CarteraService.MODOS.ABONO_DEUDA_FIFO,
    reciboDetalleId: detalleId
  });

  return { cuentaId, reciboId, detalleId, service };
}

test('anular: revierte el abono de cartera (deuda vuelve a aparecer) y libera sus imputaciones', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, reciboId, service } = sembrarReciboConAbono(db, ctx.dbService);
    assert.equal(service.getEstadoCartera(cuentaId).deudaMesesDesde2024, 0, 'precondición: cargo cubierto');

    const repo = new ReciboRepository(ctx.dbService);
    repo.anular(reciboId, 'Recibo duplicado por error de digitación');

    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaMesesDesde2024, 10000, 'el cargo vuelve a estar pendiente tras anular');

    const movimientos = db.prepare(`SELECT tipo, monto FROM cartera_movimientos WHERE cuenta_id = ? ORDER BY id`).all(cuentaId);
    assert.equal(movimientos.length, 3, 'CargoMensual + Abono original + reversión');
    assert.equal(movimientos[1].tipo, 'Abono');
    assert.equal(movimientos[1].monto, -10000, 'el abono original queda intacto, no se muta');
    assert.equal(movimientos[2].monto, 10000, 'la reversión cancela el abono original');

    const imputaciones = db.prepare(`SELECT COUNT(*) n FROM cartera_imputaciones`).get().n;
    assert.equal(imputaciones, 0, 'la imputación del abono anulado se liberó');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('anular: un recibo sin abono de cartera asociado se anula igual, sin tocar cartera_movimientos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T002', 'Vereda Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T002'`).get().id;
    db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test 2')`).run();
    const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Propietario Test 2'`).get().id;

    const reciboId = db.prepare(`
      INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
      VALUES (5002, ?, ?, '2019-01-15', 5000, 'Efectivo')
    `).run(cuentaId, propietarioId).lastInsertRowid;
    db.prepare(`INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, 'Histórico previo a 2024', 5000)`).run(reciboId);

    const repo = new ReciboRepository(ctx.dbService);
    repo.anular(reciboId, 'Prueba');

    const recibo = db.prepare(`SELECT estado FROM recibos WHERE id = ?`).get(reciboId);
    assert.equal(recibo.estado, 'Anulado');
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id = ?`).get(cuentaId).n, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
