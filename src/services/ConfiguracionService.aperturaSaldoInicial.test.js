const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ConfiguracionService = require('./ConfiguracionService');
const AsientoContableService = require('./AsientoContableService');

test('actualizar() siembra un asiento de apertura cuando se configura un saldo inicial de Caja distinto de cero', () => {
  const ctx = crearDbTemporal();
  try {
    const asientoContableService = new AsientoContableService(ctx.dbService);
    const service = new ConfiguracionService(ctx.dbService, asientoContableService);

    service.actualizar({ saldo_caja_inicial: 500000 }, 1);

    const conciliacion = asientoContableService.verificarConciliacionCajaBanco();
    const caja = conciliacion.find(f => f.cuenta === 'Caja');
    assert.equal(caja.saldoLedgerSimple, 500000, 'El libro simple debe reflejar el saldo inicial configurado');
    assert.equal(caja.saldoDoblePartida, 500000, 'La doble partida debe tener ahora la misma contrapartida');
    assert.equal(caja.conciliado, true, 'Ya no debe reportar una diferencia falsa por el saldo inicial');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizar() reemplaza (revierte el anterior y crea uno nuevo) si el saldo inicial de Banco cambia otra vez', () => {
  const ctx = crearDbTemporal();
  try {
    const asientoContableService = new AsientoContableService(ctx.dbService);
    const service = new ConfiguracionService(ctx.dbService, asientoContableService);

    service.actualizar({ saldo_banco_inicial: 200000 }, 1);
    service.actualizar({ saldo_banco_inicial: 750000 }, 1);

    const conciliacion = asientoContableService.verificarConciliacionCajaBanco();
    const banco = conciliacion.find(f => f.cuenta === 'Banco');
    assert.equal(banco.saldoLedgerSimple, 750000);
    assert.equal(banco.saldoDoblePartida, 750000, 'Debe reflejar el valor NUEVO, no la suma de ambos');
    assert.equal(banco.conciliado, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizar() no crea ningún asiento si saldo_caja_inicial no viene en los datos, o si es 0', () => {
  const ctx = crearDbTemporal();
  try {
    const asientoContableService = new AsientoContableService(ctx.dbService);
    const service = new ConfiguracionService(ctx.dbService, asientoContableService);

    service.actualizar({ nombre_asociacion: 'Acueducto de Prueba' }, 1);
    service.actualizar({ saldo_caja_inicial: 0 }, 1);

    const conciliacion = asientoContableService.verificarConciliacionCajaBanco();
    for (const fila of conciliacion) {
      assert.equal(fila.saldoDoblePartida, 0);
      assert.equal(fila.conciliado, true);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizar() sin asientoContableService inyectado se comporta exactamente igual que antes de este task (retrocompatible)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new ConfiguracionService(ctx.dbService); // sin segundo argumento
    assert.doesNotThrow(() => service.actualizar({ saldo_caja_inicial: 999000 }, 1));
  } finally {
    cerrarDbTemporal(ctx);
  }
});
