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

// Las 3 fechaGasto de este archivo deben ser la fecha real de hoy (no una fija en el pasado):
// GASTO_EFECTIVO v2 -- la única versión de la plantilla cuya línea 2 lee caja_efectivo_id, que es
// justo lo que el hallazgo A4 necesita ejercitar -- solo está vigente desde la fecha en que
// crearDbTemporal() corrió las migraciones (fecha_desde = date('now') en la migración 029), y
// PlantillaContabilizacionRepository.findVigente() elige la versión según la fecha del GASTO, no
// la fecha de hoy. Una fechaGasto fija en el pasado (p. ej. '2026-01-15') cae siempre en el rango
// de v1 -- que resuelve su línea 2 vía cuenta_automatica_clave='CAJA' y nunca toca
// caja_efectivo_id -- y por lo tanto nunca reproduciría el crash de plantilla que describe A4.
const hoy = new Date().toISOString().split('T')[0];

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
      fechaGasto: hoy, concepto: 'Gasto por transferencia', tipoGasto: 'Gastos Diversos',
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
      fechaGasto: hoy, concepto: 'Gasto por transferencia', tipoGasto: 'Gastos Diversos',
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
      fechaGasto: hoy, concepto: 'Gasto en efectivo', tipoGasto: 'Gastos Diversos',
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
