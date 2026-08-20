// Test for formato_impresion_recibo configuration key
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ConfiguracionService = require('./ConfiguracionService');

test('actualizar() guarda un formato_impresion_recibo válido', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new ConfiguracionService(ctx.dbService);
    service.actualizar({ formato_impresion_recibo: 'termico_80mm' });

    const config = service.getAll();
    assert.equal(config.formato_impresion_recibo, 'termico_80mm');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizar() rechaza un formato_impresion_recibo inválido', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new ConfiguracionService(ctx.dbService);
    assert.throws(
      () => service.actualizar({ formato_impresion_recibo: 'termico_58mm' }),
      /Formato de impresión de recibo inválido/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
