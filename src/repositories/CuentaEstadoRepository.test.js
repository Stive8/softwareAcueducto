// src/repositories/CuentaEstadoRepository.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CuentaEstadoRepository = require('./CuentaEstadoRepository');

function crearCuenta(dbService, codigo = 'T001') {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

test('estadoEnMes devuelve Activo cuando la cuenta no tiene ninguna vigencia registrada', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    assert.equal(repo.estadoEnMes(cuentaId, 2026, 7), 'Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('cambiarEstado cierra la vigencia anterior el día anterior y abre la nueva', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2020-01-01' });

    repo.cambiarEstado({
      cuentaId, estado: 'Suspendido', fechaInicio: '2022-07-01', motivo: 'no encontrado'
    });

    const vigencias = repo.getVigencias(cuentaId);
    assert.equal(vigencias.length, 2);
    assert.equal(vigencias[0].estado, 'Activo');
    assert.equal(vigencias[0].fecha_fin, '2022-06-30', 'debe cerrar el día anterior');
    assert.equal(vigencias[1].estado, 'Suspendido');
    assert.equal(vigencias[1].fecha_inicio, '2022-07-01');
    assert.equal(vigencias[1].fecha_fin, null);
    assert.equal(vigencias[1].motivo, 'no encontrado');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('estadoEnMes respeta las fechas: Activo antes de la suspensión, Suspendido después', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2020-01-01' });
    repo.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2022-07-01' });

    assert.equal(repo.estadoEnMes(cuentaId, 2022, 6), 'Activo');
    assert.equal(repo.estadoEnMes(cuentaId, 2022, 7), 'Suspendido');
    assert.equal(repo.estadoEnMes(cuentaId, 2026, 1), 'Suspendido');
    assert.equal(repo.estadoEnMes(cuentaId, 2019, 12), 'Activo', 'antes de toda vigencia asume Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reactivar deja tres vigencias y estadoEnMes las distingue mes a mes', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2020-01-01' });
    repo.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2022-07-01' });
    repo.cambiarEstado({ cuentaId, estado: 'Activo', fechaInicio: '2026-03-01', motivo: 'reapareció' });

    assert.equal(repo.getVigencias(cuentaId).length, 3);
    assert.equal(repo.estadoEnMes(cuentaId, 2022, 6), 'Activo');
    assert.equal(repo.estadoEnMes(cuentaId, 2024, 5), 'Suspendido');
    assert.equal(repo.estadoEnMes(cuentaId, 2026, 3), 'Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('cambiarEstado sincroniza cuentas.estado con la vigencia abierta', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2020-01-01' });

    repo.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2022-07-01' });
    assert.equal(db.prepare(`SELECT estado FROM cuentas WHERE id = ?`).get(cuentaId).estado, 'Suspendido');

    repo.cambiarEstado({ cuentaId, estado: 'Activo', fechaInicio: '2026-03-01' });
    assert.equal(db.prepare(`SELECT estado FROM cuentas WHERE id = ?`).get(cuentaId).estado, 'Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('cambiarEstado rechaza una fecha anterior al inicio de la vigencia abierta', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2022-01-01' });

    assert.throws(
      () => repo.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2021-06-01' }),
      /anterior al inicio de la vigencia actual/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('cambiarEstado rechaza un estado que no existe', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    assert.throws(
      () => repo.cambiarEstado({ cuentaId, estado: 'Congelado', fechaInicio: '2026-01-01' }),
      /Estado inválido/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
