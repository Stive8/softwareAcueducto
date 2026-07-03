// src/services/PeriodoContableService.bloqueo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');

test('validarFechaPermitida() rechaza una fecha anterior al límite configurado, aunque nunca haya existido un período para ese mes', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`UPDATE configuracion SET valor = '2024-01-01' WHERE clave = 'periodo_bloqueo_anterior_a'`).run();

    const service = new PeriodoContableService(new PeriodoContableRepository(ctx.dbService), ctx.dbService);

    // 2020-03 nunca tuvo actividad: sin el fix, se auto-crearía como Abierto y se permitiría.
    assert.throws(() => service.validarFechaPermitida('2020-03-15'), /bloqueado|no se permite contabilizar/i);

    const periodoCreado = db.prepare(`SELECT * FROM periodos_contables WHERE anio = 2020 AND mes = 3`).get();
    assert.equal(periodoCreado, undefined, 'No debe crearse un período para una fecha rechazada por el límite');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('validarFechaPermitida() sigue permitiendo fechas posteriores al límite, creando el período si hace falta', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`UPDATE configuracion SET valor = '2024-01-01' WHERE clave = 'periodo_bloqueo_anterior_a'`).run();

    const service = new PeriodoContableService(new PeriodoContableRepository(ctx.dbService), ctx.dbService);
    const periodo = service.validarFechaPermitida('2026-07-03');
    assert.equal(periodo.estado, 'Abierto');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('validarFechaPermitida() no restringe nada si periodo_bloqueo_anterior_a está vacío (comportamiento por defecto, compatible con lo actual)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new PeriodoContableService(new PeriodoContableRepository(ctx.dbService), ctx.dbService);
    const periodo = service.validarFechaPermitida('2018-01-01');
    assert.equal(periodo.estado, 'Abierto');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
