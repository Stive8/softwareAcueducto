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

test('create() rechaza un gasto en efectivo mayor al saldo disponible de Caja General', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    // Caja General arranca en 0 (sin saldo inicial configurado ni movimientos previos):
    // cualquier gasto en efectivo mayor a 0 debe rechazarse.
    assert.throws(
      () => service.create({
        fechaGasto: '2026-07-03', concepto: 'Gasto sin saldo', tipoGasto: 'Gastos Diversos',
        valor: 50000, metodoPago: 'Efectivo', terceroId
      }, null),
      /saldo insuficiente/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() permite un gasto en efectivo cuando SÍ hay saldo suficiente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();

    // Crear un asiento inicial para establecer un saldo de 100000 en Caja General (110505)
    const cuentaCaja = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();
    const cuentaCapital = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '3105'`).get();
    const asientoId = db.prepare(`
      INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen)
      VALUES (9001, '2026-07-03', 'Saldo inicial de Caja', 'Manual')
    `).run().lastInsertRowid;
    db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2026-07-03', ?, 100000, 0, 'Saldo inicial', ?)`).run(cuentaCaja.id, asientoId);
    db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2026-07-03', ?, 0, 100000, 'Saldo inicial', ?)`).run(cuentaCapital.id, asientoId);

    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    const gastoId = service.create({
      fechaGasto: '2026-07-03', concepto: 'Gasto con saldo', tipoGasto: 'Gastos Diversos',
      valor: 50000, metodoPago: 'Efectivo', terceroId
    }, null);

    assert.ok(gastoId > 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() NO valida saldo para gastos por Transferencia (no salen de una caja de efectivo)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    const gastoId = service.create({
      fechaGasto: '2026-07-03', concepto: 'Gasto por transferencia', tipoGasto: 'Gastos Diversos',
      valor: 500000, metodoPago: 'Transferencia', terceroId
    }, null);

    assert.ok(gastoId > 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
