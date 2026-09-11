// src/services/CajaService.resumenPeriodo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CajaService = require('./CajaService');

test('getResumenPeriodo() sin cuenta combina Caja y Banco', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    service.repository.crearMovimiento({ tipo: 'Ingreso', origen: 'Caja', monto: 100000, concepto: 'Recibo efectivo', fechaMovimiento: '2026-01-05' });
    service.repository.crearMovimiento({ tipo: 'Ingreso', origen: 'Banco', monto: 300000, concepto: 'Recibo transferencia', fechaMovimiento: '2026-01-06' });
    service.repository.crearMovimiento({ tipo: 'Egreso', origen: 'Caja', monto: 40000, concepto: 'Gasto efectivo', fechaMovimiento: '2026-01-07' });
    service.repository.crearMovimiento({ tipo: 'Egreso', origen: 'Banco', monto: 90000, concepto: 'Gasto banco', fechaMovimiento: '2026-01-08' });

    const resumen = service.getResumenPeriodo('2026-01-01', '2026-01-31');

    assert.equal(resumen.ingresos, 400000);
    assert.equal(resumen.gastos, 130000);
    assert.equal(resumen.flujoNeto, 270000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getResumenPeriodo() con cuenta "Caja" solo suma movimientos en efectivo', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    service.repository.crearMovimiento({ tipo: 'Ingreso', origen: 'Caja', monto: 100000, concepto: 'Recibo efectivo', fechaMovimiento: '2026-01-05' });
    service.repository.crearMovimiento({ tipo: 'Ingreso', origen: 'Banco', monto: 300000, concepto: 'Recibo transferencia', fechaMovimiento: '2026-01-06' });
    service.repository.crearMovimiento({ tipo: 'Egreso', origen: 'Caja', monto: 40000, concepto: 'Gasto efectivo', fechaMovimiento: '2026-01-07' });
    service.repository.crearMovimiento({ tipo: 'Egreso', origen: 'Banco', monto: 90000, concepto: 'Gasto banco', fechaMovimiento: '2026-01-08' });

    const resumen = service.getResumenPeriodo('2026-01-01', '2026-01-31', 'Caja');

    assert.equal(resumen.ingresos, 100000);
    assert.equal(resumen.gastos, 40000);
    assert.equal(resumen.flujoNeto, 60000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getResumenPeriodo() con cuenta "Banco" solo suma movimientos bancarios', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    service.repository.crearMovimiento({ tipo: 'Ingreso', origen: 'Caja', monto: 100000, concepto: 'Recibo efectivo', fechaMovimiento: '2026-01-05' });
    service.repository.crearMovimiento({ tipo: 'Ingreso', origen: 'Banco', monto: 300000, concepto: 'Recibo transferencia', fechaMovimiento: '2026-01-06' });
    service.repository.crearMovimiento({ tipo: 'Egreso', origen: 'Caja', monto: 40000, concepto: 'Gasto efectivo', fechaMovimiento: '2026-01-07' });
    service.repository.crearMovimiento({ tipo: 'Egreso', origen: 'Banco', monto: 90000, concepto: 'Gasto banco', fechaMovimiento: '2026-01-08' });

    const resumen = service.getResumenPeriodo('2026-01-01', '2026-01-31', 'Banco');

    assert.equal(resumen.ingresos, 300000);
    assert.equal(resumen.gastos, 90000);
    assert.equal(resumen.flujoNeto, 210000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getResumenPeriodo() con cuenta filtrada ignora los Traslados entre Caja y Banco', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    service.repository.crearMovimiento({ tipo: 'Ingreso', origen: 'Caja', monto: 100000, concepto: 'Recibo efectivo', fechaMovimiento: '2026-01-05' });
    service.repository.crearMovimiento({ tipo: 'Traslado', origen: 'Caja', destino: 'Banco', monto: 50000, concepto: 'Consignación', fechaMovimiento: '2026-01-06' });

    const resumenCaja = service.getResumenPeriodo('2026-01-01', '2026-01-31', 'Caja');
    const resumenBanco = service.getResumenPeriodo('2026-01-01', '2026-01-31', 'Banco');

    assert.equal(resumenCaja.ingresos, 100000);
    assert.equal(resumenCaja.gastos, 0);
    assert.equal(resumenBanco.ingresos, 0);
    assert.equal(resumenBanco.gastos, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
