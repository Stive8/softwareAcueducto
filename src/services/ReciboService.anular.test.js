// src/services/ReciboService.anular.test.js
//
// Cubre el hallazgo 5 de la auditoría de entrega: si el recibo generó saldo a favor y parte de
// ese saldo ya fue redimido contra deuda (CarteraService.redimirCredito), anular el recibo sin
// más borraría el crédito 'Abono' de cuenta_creditos pero dejaría intacta la fila 'Aplicado' que
// ya lo consumió -- el saldo de la cuenta queda negativo, corrupción silenciosa. Se bloquea la
// anulación con un mensaje claro en ese caso, en vez de intentar revertir la redención (que no
// tiene una respuesta correcta única: cuenta_creditos es un pool por cuenta, no hay forma de
// saber con certeza qué redención vino de qué crédito puntual si hubo más de uno).
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ReciboService = require('./ReciboService');
const CarteraService = require('./CarteraService');
const { MODOS } = require('./cartera/imputacion');

function sembrarCuentaConRecibo(db, { numeroRecibo = 5001, valorRecibo = 92000 } = {}) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Vereda Test')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;
  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test')`).run();
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Propietario Test'`).get().id;

  const reciboId = db.prepare(`
    INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
    VALUES (?, ?, ?, '2024-01-15', ?, 'Efectivo')
  `).run(numeroRecibo, cuentaId, propietarioId, valorRecibo).lastInsertRowid;
  const detalleId = db.prepare(`
    INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, 'Sostenimiento enero 2024 (con sobrante)', ?)
  `).run(reciboId, valorRecibo).lastInsertRowid;

  return { cuentaId, propietarioId, reciboId, detalleId };
}

test('anular: bloquea con mensaje claro si el saldo a favor del recibo ya fue redimido contra deuda (caso R007)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, reciboId, detalleId } = sembrarCuentaConRecibo(db, { valorRecibo: 92000 });
    const carteraService = new CarteraService(ctx.dbService);
    const reciboService = new ReciboService(ctx.dbService);

    // El recibo entero queda como saldo a favor (ANTICIPO: sin cargos contra qué imputar todavía).
    carteraService.registrarAbono({
      cuentaId, fecha: '2024-01-15', monto: 92000, modo: MODOS.ANTICIPO, reciboDetalleId: detalleId
    });

    // Aparece deuda real después, y se redime parte del crédito contra ella.
    carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2024-02-01', tipo: 'CargoMensual', exigible: 1, monto: 50000, anio: 2024, mes: 2
    });
    carteraService.redimirCredito({ cuentaId, fecha: '2024-02-10', monto: 50000, modo: MODOS.ABONO_DEUDA_FIFO });

    assert.throws(
      () => reciboService.anular(reciboId, 'Recibo duplicado por error de digitación'),
      /saldo a favor.*negativo/s
    );

    // Nada debe haber cambiado: ni el recibo, ni los créditos.
    const recibo = db.prepare(`SELECT estado FROM recibos WHERE id = ?`).get(reciboId);
    assert.equal(recibo.estado, 'Activo', 'el recibo no debe quedar anulado si el guard lo bloqueó');
    const creditos = db.prepare(`SELECT COUNT(*) n FROM cuenta_creditos WHERE cuenta_id = ?`).get(cuentaId).n;
    assert.equal(creditos, 2, 'las 2 filas (Abono original + Aplicado de la redención) siguen intactas');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('anular: permite anular normalmente si el saldo a favor del recibo nunca se redimió', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, reciboId, detalleId } = sembrarCuentaConRecibo(db, { valorRecibo: 92000 });
    const carteraService = new CarteraService(ctx.dbService);
    const reciboService = new ReciboService(ctx.dbService);

    carteraService.registrarAbono({
      cuentaId, fecha: '2024-01-15', monto: 92000, modo: MODOS.ANTICIPO, reciboDetalleId: detalleId
    });

    reciboService.anular(reciboId, 'Recibo duplicado por error de digitación');

    const recibo = db.prepare(`SELECT estado FROM recibos WHERE id = ?`).get(reciboId);
    assert.equal(recibo.estado, 'Anulado');
    const creditoRestante = db.prepare(`SELECT COUNT(*) n FROM cuenta_creditos WHERE cuenta_id = ?`).get(cuentaId).n;
    assert.equal(creditoRestante, 0, 'el crédito nunca redimido se borra sin dejar rastro, como antes');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('anular: permite anular si la redención vino de OTRO crédito de la misma cuenta, no del de este recibo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, reciboId, detalleId } = sembrarCuentaConRecibo(db, { numeroRecibo: 5001, valorRecibo: 30000 });
    const carteraService = new CarteraService(ctx.dbService);
    const reciboService = new ReciboService(ctx.dbService);

    // Crédito del recibo que se va a anular: 30.000, nunca se toca.
    carteraService.registrarAbono({
      cuentaId, fecha: '2024-01-15', monto: 30000, modo: MODOS.ANTICIPO, reciboDetalleId: detalleId
    });

    // Segundo recibo, otro crédito de 92.000 en la MISMA cuenta -- este es el que se redime.
    const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Propietario Test'`).get().id;
    const recibo2Id = db.prepare(`
      INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
      VALUES (5002, ?, ?, '2024-01-20', 92000, 'Efectivo')
    `).run(cuentaId, propietarioId).lastInsertRowid;
    const detalle2Id = db.prepare(`
      INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, 'Otro sobrante', 92000)
    `).run(recibo2Id).lastInsertRowid;
    carteraService.registrarAbono({
      cuentaId, fecha: '2024-01-20', monto: 92000, modo: MODOS.ANTICIPO, reciboDetalleId: detalle2Id
    });

    carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2024-02-01', tipo: 'CargoMensual', exigible: 1, monto: 50000, anio: 2024, mes: 2
    });
    carteraService.redimirCredito({ cuentaId, fecha: '2024-02-10', monto: 50000, modo: MODOS.ABONO_DEUDA_FIFO });

    // Saldo total tras la redención: 30.000 + 92.000 - 50.000 = 72.000. Anular el primer recibo
    // (30.000) deja 42.000, todavía no negativo -- debe permitirse.
    reciboService.anular(reciboId, 'Recibo duplicado por error de digitación');

    const recibo = db.prepare(`SELECT estado FROM recibos WHERE id = ?`).get(reciboId);
    assert.equal(recibo.estado, 'Anulado');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
