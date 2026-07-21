// src/services/CajaService.regularizarSaldos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CajaService = require('./CajaService');
const AsientoContableService = require('./AsientoContableService');
const ConfiguracionService = require('./ConfiguracionService');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

function seedSaldoCaja(dbService, monto) {
  new ConfiguracionRepository(dbService).actualizar('saldo_caja_inicial', String(monto));
}

function seedSaldoBanco(dbService, monto) {
  new ConfiguracionRepository(dbService).actualizar('saldo_banco_inicial', String(monto));
}

test('regularizarSaldos() reduce el saldo de Caja cuando el saldo real es menor al calculado (egresos históricos no registrados)', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    const service = new CajaService(ctx.dbService);
    assert.equal(service.repository.getSaldoCaja(), 129000000);

    const resultado = service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Regularización de arranque: arqueo físico de caja'
    });

    assert.equal(resultado.saldoFinalCaja, 3000000);
    assert.ok(resultado.ajusteCaja, 'Debe haber creado un asiento de ajuste para Caja');
    assert.equal(resultado.ajusteBanco, null, 'No debe tocar Banco si no hay diferencia');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() aumenta el saldo de Banco cuando el saldo real es mayor al calculado', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBanco(ctx.dbService, 10000000);
    const service = new CajaService(ctx.dbService);

    const resultado = service.regularizarSaldos({
      fecha: '2026-01-15',
      saldoRealCaja: service.repository.getSaldoCaja(),
      saldoRealBanco: 15000000,
      motivo: 'Se encontró un rendimiento financiero no registrado'
    });

    assert.equal(resultado.saldoFinalBanco, 15000000);
    assert.ok(resultado.ajusteBanco);
    assert.equal(resultado.ajusteCaja, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() ajusta Caja y Banco a la vez, en dos asientos separados, cuando ambos difieren', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    seedSaldoBanco(ctx.dbService, 0);
    const service = new CajaService(ctx.dbService);

    const resultado = service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: 50000000,
      motivo: 'Regularización de arranque al 31/12/2025 (arqueo + extracto)'
    });

    assert.equal(resultado.saldoFinalCaja, 3000000);
    assert.equal(resultado.saldoFinalBanco, 50000000);
    assert.ok(resultado.ajusteCaja);
    assert.ok(resultado.ajusteBanco);
    assert.notEqual(resultado.ajusteCaja, resultado.ajusteBanco, 'Deben ser dos asientos separados');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() deja el libro simple y la doble partida conciliados después del ajuste', () => {
  const ctx = crearDbTemporal();
  try {
    // A diferencia de las demás pruebas de este archivo, acá no alcanza con sembrar el saldo
    // inicial vía ConfiguracionRepository (eso solo alimenta el libro simple). Este caso valida
    // conciliación con la doble partida, así que el saldo inicial debe sembrarse por el mismo
    // camino que usa producción (ConfiguracionService -> AsientoContableService.
    // sincronizarAperturaSaldoInicial, ver ConfiguracionService.aperturaSaldoInicial.test.js),
    // que sí deja ambos libros sincronizados desde el arranque.
    const asientoContableService = new AsientoContableService(ctx.dbService);
    const configuracionService = new ConfiguracionService(ctx.dbService, asientoContableService);
    configuracionService.actualizar({ saldo_caja_inicial: 129000000 }, 1);
    const service = new CajaService(ctx.dbService);

    service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Regularización de arranque'
    });

    const conciliacion = asientoContableService.verificarConciliacionCajaBanco();
    const caja = conciliacion.find(f => f.cuenta === 'Caja');
    assert.equal(caja.saldoLedgerSimple, 3000000);
    assert.equal(caja.saldoDoblePartida, 3000000);
    assert.equal(caja.conciliado, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() registra el asiento con la cuenta y el sentido débito/crédito correctos (auditable)', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    seedSaldoBanco(ctx.dbService, 10000000);
    const service = new CajaService(ctx.dbService);
    const asientoContableService = new AsientoContableService(ctx.dbService);

    const resultado = service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000, // diferencia negativa: -126.000.000
      saldoRealBanco: 15000000, // diferencia positiva: +5.000.000
      motivo: 'Prueba de auditabilidad del asiento',
      usuarioId: 1
    });

    const asientoCaja = asientoContableService.getById(resultado.ajusteCaja);
    assert.equal(asientoCaja.usuario_id, 1, 'El asiento debe quedar atribuido al usuario que hizo el ajuste');
    const lineaCaja = asientoCaja.lineas.find(l => l.cuenta_codigo === '110505');
    const lineaPatrimonioCaja = asientoCaja.lineas.find(l => l.cuenta_codigo === '3105');
    assert.ok(lineaCaja && lineaPatrimonioCaja, 'El asiento de Caja debe tener una línea contra 110505 (Caja) y otra contra 3105 (Patrimonio)');
    assert.equal(lineaCaja.credito, 126000000, 'Diferencia negativa: se acredita Caja');
    assert.equal(lineaCaja.debito, 0);
    assert.equal(lineaPatrimonioCaja.debito, 126000000, 'y se debita Patrimonio por el mismo monto');
    assert.equal(lineaPatrimonioCaja.credito, 0);

    const asientoBanco = asientoContableService.getById(resultado.ajusteBanco);
    assert.equal(asientoBanco.usuario_id, 1);
    const lineaBanco = asientoBanco.lineas.find(l => l.cuenta_codigo === '111005');
    const lineaPatrimonioBanco = asientoBanco.lineas.find(l => l.cuenta_codigo === '3105');
    assert.ok(lineaBanco && lineaPatrimonioBanco, 'El asiento de Banco debe tener una línea contra 111005 (Banco) y otra contra 3105 (Patrimonio)');
    assert.equal(lineaBanco.debito, 5000000, 'Diferencia positiva: se debita Banco');
    assert.equal(lineaBanco.credito, 0);
    assert.equal(lineaPatrimonioBanco.credito, 5000000, 'y se acredita Patrimonio por el mismo monto');
    assert.equal(lineaPatrimonioBanco.debito, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() rechaza el ajuste si los saldos reales ya coinciden con los calculados', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.regularizarSaldos({ fecha: '2026-01-01', saldoRealCaja: 0, saldoRealBanco: 0, motivo: 'No debería crear nada' }),
      /No hay ninguna diferencia/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() exige un motivo no vacío', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.regularizarSaldos({ fecha: '2026-01-01', saldoRealCaja: 5000, saldoRealBanco: 0, motivo: '   ' }),
      /motivo/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() rechaza saldos negativos', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.regularizarSaldos({ fecha: '2026-01-01', saldoRealCaja: -100, saldoRealBanco: 0, motivo: 'x' }),
      /mayor o igual a cero/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() es reutilizable: un segundo ajuste posterior no se acumula con el anterior', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    const service = new CajaService(ctx.dbService);

    service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Ajuste de arranque'
    });

    const resultado = service.regularizarSaldos({
      fecha: '2026-03-31',
      saldoRealCaja: 2500000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Diferencia por comisión bancaria no registrada'
    });

    assert.equal(resultado.saldoFinalCaja, 2500000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
