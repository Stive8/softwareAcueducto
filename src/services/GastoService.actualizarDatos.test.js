// src/services/GastoService.actualizarDatos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const GastoService = require('./GastoService');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');
const TerceroRepository = require('../repositories/TerceroRepository');

function crearTerceroDePrueba(dbService) {
  const repo = new TerceroRepository(dbService);
  return repo.create({
    tipoIdentificacion: 'Cédula de Ciudadanía', numeroIdentificacion: '123456', nombreRazonSocial: 'Proveedor de prueba',
    esProveedor: true
  });
}

// Gasto por Transferencia (no requiere saldo de efectivo previo, ver GastoService.saldo.test.js).
function crearGastoDePrueba(dbService, overrides = {}) {
  const service = new GastoService(dbService);
  const terceroId = crearTerceroDePrueba(dbService);
  const gastoId = service.create({
    fechaGasto: '2026-01-15', concepto: 'Concepto original', tipoGasto: 'Gastos Diversos',
    valor: 100000, metodoPago: 'Transferencia', terceroId, observaciones: 'Obs original',
    ...overrides
  }, null);
  return { service, gastoId };
}

test('actualizarDatos() rechaza un gasto inexistente', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new GastoService(ctx.dbService);
    assert.throws(() => service.actualizarDatos(9999, { concepto: 'x', observaciones: '' }), /no encontrado/i);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() rechaza editar un gasto anulado', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);
    service.anular(gastoId, 'Anulado para la prueba', null);

    assert.throws(
      () => service.actualizarDatos(gastoId, { concepto: 'Nuevo concepto', observaciones: '' }),
      /anulado/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() rechaza un concepto vacío o solo espacios', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);
    assert.throws(() => service.actualizarDatos(gastoId, { concepto: '   ', observaciones: '' }), /concepto es obligatorio/i);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() actualiza concepto y observaciones', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);

    service.actualizarDatos(gastoId, { concepto: 'Concepto corregido', observaciones: 'Observación nueva' });

    const gasto = service.getById(gastoId);
    assert.equal(gasto.concepto, 'Concepto corregido');
    assert.equal(gasto.observaciones, 'Observación nueva');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() permite dejar observaciones vacías (se guarda como NULL)', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);

    service.actualizarDatos(gastoId, { concepto: 'Concepto corregido', observaciones: '' });

    const gasto = service.getById(gastoId);
    assert.equal(gasto.observaciones, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() no toca el asiento contable del gasto (no crea reversión ni asiento nuevo)', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);
    const db = ctx.dbService.getDb();

    const asientoAntes = db.prepare(`SELECT id, estado FROM asientos_contables WHERE referencia_tipo = 'Gasto' AND referencia_id = ?`).get(gastoId);
    assert.ok(asientoAntes, 'Debe existir un asiento vinculado al gasto');
    assert.equal(asientoAntes.estado, 'Activo');

    service.actualizarDatos(gastoId, { concepto: 'Concepto corregido', observaciones: '' });

    const asientosDespues = db.prepare(`SELECT id, estado FROM asientos_contables WHERE referencia_tipo = 'Gasto' AND referencia_id = ?`).all(gastoId);
    assert.equal(asientosDespues.length, 1, 'No debe crearse ningún asiento nuevo (ni de reversión)');
    assert.equal(asientosDespues[0].id, asientoAntes.id);
    assert.equal(asientosDespues[0].estado, 'Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() funciona aunque el período contable de la fecha del gasto ya esté Cerrado', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);

    const periodoContableService = new PeriodoContableService(new PeriodoContableRepository(ctx.dbService), ctx.dbService);
    const periodo = periodoContableService.validarFechaPermitida('2026-01-15');
    periodoContableService.cerrar(periodo.id, 1, 'Cierre de prueba');

    assert.doesNotThrow(() => service.actualizarDatos(gastoId, { concepto: 'Editado con período cerrado', observaciones: '' }));

    const gasto = service.getById(gastoId);
    assert.equal(gasto.concepto, 'Editado con período cerrado');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
