const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CuentaRepository = require('./CuentaRepository');

function obtenerCategoriaId(dbService) {
  return dbService.getDb().prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;
}

test('create() guarda las coordenadas de acometida y vivienda, y findById() las devuelve', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-001',
      direccion: 'Vereda El Progreso',
      categoria_id: categoriaId,
      lat_acometida: 4.60971,
      lon_acometida: -74.08175,
      lat_vivienda: 4.60980,
      lon_vivienda: -74.08190
    });

    const cuenta = repo.findById(cuentaId);

    assert.equal(cuenta.lat_acometida, 4.60971);
    assert.equal(cuenta.lon_acometida, -74.08175);
    assert.equal(cuenta.lat_vivienda, 4.60980);
    assert.equal(cuenta.lon_vivienda, -74.08190);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() guarda NULL en las coordenadas cuando no se informan', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-002',
      direccion: 'Vereda La Esperanza',
      categoria_id: categoriaId
    });

    const cuenta = repo.findById(cuentaId);

    assert.equal(cuenta.lat_acometida, null);
    assert.equal(cuenta.lon_acometida, null);
    assert.equal(cuenta.lat_vivienda, null);
    assert.equal(cuenta.lon_vivienda, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('update() actualiza las coordenadas de una cuenta existente', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-003',
      direccion: 'Vereda San José',
      categoria_id: categoriaId
    });

    repo.update(cuentaId, {
      codigo: 'C-003',
      direccion: 'Vereda San José',
      lat_acometida: 5.0,
      lon_acometida: -75.0,
      lat_vivienda: 5.0,
      lon_vivienda: -75.0
    });

    const cuenta = repo.findById(cuentaId);
    assert.equal(cuenta.lat_acometida, 5.0);
    assert.equal(cuenta.lon_acometida, -75.0);
    assert.equal(cuenta.lat_vivienda, 5.0);
    assert.equal(cuenta.lon_vivienda, -75.0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
