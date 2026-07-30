const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CuentaRepository = require('./CuentaRepository');

function obtenerCategoriaId(dbService) {
  return dbService.getDb().prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;
}

test('create() guarda nombre_predio y findById() lo devuelve', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-300',
      direccion: 'Vereda El Progreso',
      categoria_id: categoriaId,
      nombre_predio: 'Finca La Esperanza'
    });

    const cuenta = repo.findById(cuentaId);
    assert.equal(cuenta.nombre_predio, 'Finca La Esperanza');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() guarda NULL en nombre_predio cuando no se informa', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-301',
      direccion: 'Vereda La Esperanza',
      categoria_id: categoriaId
    });

    const cuenta = repo.findById(cuentaId);
    assert.equal(cuenta.nombre_predio, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('update() actualiza el nombre_predio de una cuenta existente', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-302',
      direccion: 'Vereda San José',
      categoria_id: categoriaId
    });

    repo.update(cuentaId, {
      codigo: 'C-302',
      direccion: 'Vereda San José',
      nombre_predio: 'Finca San José'
    });

    const cuenta = repo.findById(cuentaId);
    assert.equal(cuenta.nombre_predio, 'Finca San José');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('findAll() incluye nombre_predio en cada fila y permite buscar por él', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    repo.create({
      codigo: 'C-303',
      direccion: 'Vereda El Roble',
      categoria_id: categoriaId,
      nombre_predio: 'Finca El Roble'
    });
    repo.create({
      codigo: 'C-304',
      direccion: 'Vereda El Guayabo',
      categoria_id: categoriaId,
      nombre_predio: 'Finca El Guayabo'
    });

    const resultado = repo.findAll({ search: 'Roble' });

    assert.equal(resultado.data.length, 1);
    assert.equal(resultado.data[0].codigo, 'C-303');
    assert.equal(resultado.data[0].nombre_predio, 'Finca El Roble');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
