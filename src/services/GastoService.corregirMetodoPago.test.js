const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const GastoService = require('./GastoService');
const TerceroRepository = require('../repositories/TerceroRepository');

function crearTerceroDePrueba(dbService) {
  const repo = new TerceroRepository(dbService);
  return repo.create({
    tipoIdentificacion: 'Cédula de Ciudadanía', numeroIdentificacion: '123456', nombreRazonSocial: 'Proveedor de prueba',
    esProveedor: true
  });
}

function sembrarSaldoCaja(dbService, monto, codigoCuenta = '110505') {
  const db = dbService.getDb();
  const cuentaCaja = db.prepare('SELECT id FROM plan_cuentas WHERE codigo = ?').get(codigoCuenta);
  const cuentaCapital = db.prepare('SELECT id FROM plan_cuentas WHERE codigo = ?').get('3105');
  const asientoId = db.prepare(`
    INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen) VALUES (9001, '2026-01-01', 'Saldo inicial', 'Manual')
  `).run().lastInsertRowid;
  db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2026-01-01', ?, ?, 0, 'Saldo inicial', ?)`).run(cuentaCaja.id, monto, asientoId);
  db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2026-01-01', ?, 0, ?, 'Saldo inicial', ?)`).run(cuentaCapital.id, monto, asientoId);
}

test('corregirMetodoPago() de Transferencia a Efectivo genera el asiento correctamente (hallazgo Alto A4, auditoría 2026-09-11)', () => {
  const ctx = crearDbTemporal();
  try {
    sembrarSaldoCaja(ctx.dbService, 200000);
    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    const gastoId = service.create({
      fechaGasto: '2026-01-15', concepto: 'Gasto por transferencia', tipoGasto: 'Gastos Diversos',
      valor: 30000, metodoPago: 'Transferencia', terceroId
    }, null);

    assert.doesNotThrow(() => service.corregirMetodoPago(gastoId, 'Efectivo', 'Se pagó en efectivo, no por transferencia', 1));

    const gasto = service.getById(gastoId);
    assert.equal(gasto.metodo_pago, 'Efectivo');

    const db = ctx.dbService.getDb();
    const cajaEfectivoId = db.prepare('SELECT caja_efectivo_id FROM gastos WHERE id = ?').get(gastoId).caja_efectivo_id;
    const cuentaCajaGeneral = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();
    assert.equal(cajaEfectivoId, cuentaCajaGeneral.id, 'caja_efectivo_id debe quedar resuelto a Caja General');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('corregirMetodoPago() de Transferencia a Efectivo rechaza si no hay saldo suficiente en Caja General', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    const gastoId = service.create({
      fechaGasto: '2026-01-15', concepto: 'Gasto por transferencia', tipoGasto: 'Gastos Diversos',
      valor: 30000, metodoPago: 'Transferencia', terceroId
    }, null);

    // Caja General arranca en 0: corregir a Efectivo debe rechazarse igual que create().
    assert.throws(
      () => service.corregirMetodoPago(gastoId, 'Efectivo', 'Se pagó en efectivo', 1),
      /saldo insuficiente/i
    );

    const gasto = service.getById(gastoId);
    assert.equal(gasto.metodo_pago, 'Transferencia', 'No debe haber cambiado nada si la corrección se rechaza');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('corregirMetodoPago() de Efectivo a Transferencia limpia caja_efectivo_id', () => {
  const ctx = crearDbTemporal();
  try {
    sembrarSaldoCaja(ctx.dbService, 200000);
    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    const gastoId = service.create({
      fechaGasto: '2026-01-15', concepto: 'Gasto en efectivo', tipoGasto: 'Gastos Diversos',
      valor: 30000, metodoPago: 'Efectivo', terceroId
    }, null);

    service.corregirMetodoPago(gastoId, 'Transferencia', 'Se pagó por transferencia, no en efectivo', 1);

    const db = ctx.dbService.getDb();
    const cajaEfectivoId = db.prepare('SELECT caja_efectivo_id FROM gastos WHERE id = ?').get(gastoId).caja_efectivo_id;
    assert.equal(cajaEfectivoId, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
