// src/services/CajaService.registrarRetiro.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CajaService = require('./CajaService');
const AsientoContableService = require('./AsientoContableService');
const ConfiguracionService = require('./ConfiguracionService');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

function seedSaldoBanco(dbService, monto) {
  new ConfiguracionRepository(dbService).actualizar('saldo_banco_inicial', String(monto));
}

// A diferencia de seedSaldoBanco() (que solo alimenta el libro simple vía un UPDATE crudo a
// `configuracion`), este helper sincroniza TAMBIÉN la doble partida, igual que el camino real de
// producción (Configuración -> ConfiguracionService.actualizar -> AsientoContableService.
// sincronizarAperturaSaldoInicial). Es obligatorio para cualquier test que vaya a verificar
// verificarConciliacionCajaBanco(): si el saldo inicial se siembra solo con seedSaldoBanco(), la
// doble partida arranca en 0 mientras el libro simple arranca en el monto sembrado, y los dos
// libros ya están desconciliados ANTES de que el test haga nada (mismo hallazgo que en
// CajaService.regularizarSaldos.test.js, ver commit 69016e9 en la rama de esa feature).
function seedSaldoBancoConciliado(dbService, monto) {
  const asientoContableService = new AsientoContableService(dbService);
  new ConfiguracionService(dbService, asientoContableService).actualizar({ saldo_banco_inicial: monto }, 1);
}

test('registrarRetiro() rechaza un monto de cero o negativo', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.registrarRetiro({ monto: 0, fecha: '2026-01-01', observaciones: '' }),
      /El monto a retirar debe ser mayor a cero/
    );
    assert.throws(
      () => service.registrarRetiro({ monto: -500, fecha: '2026-01-01', observaciones: '' }),
      /El monto a retirar debe ser mayor a cero/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarRetiro() exige una fecha', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBanco(ctx.dbService, 1000000);
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.registrarRetiro({ monto: 100000, fecha: '', observaciones: '' }),
      /La fecha es obligatoria/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarRetiro() rechaza un monto mayor al saldo disponible en Banco', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBanco(ctx.dbService, 500000);
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.registrarRetiro({ monto: 600000, fecha: '2026-01-01', observaciones: '' }),
      /supera el saldo disponible en banco/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarRetiro() aumenta el saldo de Caja y disminuye el saldo de Banco por el mismo monto', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBanco(ctx.dbService, 5000000);
    const service = new CajaService(ctx.dbService);

    const saldoCajaAntes = service.repository.getSaldoCaja();
    const saldoBancoAntes = service.repository.getSaldoBanco();

    service.registrarRetiro({ monto: 800000, fecha: '2026-01-15', observaciones: 'Retiro para pago de mantenimiento' });

    assert.equal(service.repository.getSaldoCaja(), saldoCajaAntes + 800000);
    assert.equal(service.repository.getSaldoBanco(), saldoBancoAntes - 800000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarRetiro() genera el asiento contable correcto: débito Caja (110505), crédito Banco (111005)', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBanco(ctx.dbService, 5000000);
    const service = new CajaService(ctx.dbService);
    const asientoContableService = new AsientoContableService(ctx.dbService);

    const movimientoId = service.registrarRetiro({ monto: 800000, fecha: '2026-01-15', observaciones: '' }, 1);
    assert.ok(movimientoId, 'Debe devolver el id del movimiento creado');

    const db = ctx.dbService.getDb();
    const movimiento = db.prepare('SELECT * FROM movimientos WHERE id = ?').get(movimientoId);
    assert.equal(movimiento.tipo, 'Traslado');
    assert.equal(movimiento.origen, 'Banco');
    assert.equal(movimiento.destino, 'Caja');
    assert.equal(movimiento.monto, 800000);

    const asiento = db.prepare(`
      SELECT a.id FROM asientos_contables a WHERE a.referencia_tipo = 'Movimiento' AND a.referencia_id = ?
    `).get(movimientoId);
    assert.ok(asiento, 'Debe existir un asiento contable vinculado al movimiento');

    const lineas = asientoContableService.getById(asiento.id).lineas;
    const lineaCaja = lineas.find(l => l.cuenta_codigo === '110505');
    const lineaBanco = lineas.find(l => l.cuenta_codigo === '111005');
    assert.ok(lineaCaja && lineaBanco, 'El asiento debe tener una línea contra Caja (110505) y otra contra Banco (111005)');
    assert.equal(lineaCaja.debito, 800000, 'Caja recibe: débito');
    assert.equal(lineaCaja.credito, 0);
    assert.equal(lineaBanco.credito, 800000, 'Banco entrega: crédito');
    assert.equal(lineaBanco.debito, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarRetiro() deja el libro simple y la doble partida conciliados después del retiro', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBancoConciliado(ctx.dbService, 5000000);
    const service = new CajaService(ctx.dbService);
    const asientoContableService = new AsientoContableService(ctx.dbService);

    service.registrarRetiro({ monto: 800000, fecha: '2026-01-15', observaciones: '' });

    const conciliacion = asientoContableService.verificarConciliacionCajaBanco();
    for (const fila of conciliacion) {
      assert.equal(fila.conciliado, true, `${fila.cuenta} debía estar conciliado`);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});
