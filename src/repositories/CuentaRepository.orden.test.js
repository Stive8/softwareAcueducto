// src/repositories/CuentaRepository.orden.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CuentaRepository = require('./CuentaRepository');

test('findAll() ordena por código ascendente (C antes que R antes que S), igual que el listado de Aportes, no por orden de inserción', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = ctx.dbService.getDb().prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;

    // Se insertan a propósito en un orden que NO coincide con el orden por código esperado.
    repo.create({ codigo: 'S001', direccion: 'Vereda Test', categoria_id: categoriaId });
    repo.create({ codigo: 'C002', direccion: 'Vereda Test', categoria_id: categoriaId });
    repo.create({ codigo: 'R001', direccion: 'Vereda Test', categoria_id: categoriaId });
    repo.create({ codigo: 'C001', direccion: 'Vereda Test', categoria_id: categoriaId });

    const resultado = repo.findAll({ page: 1, limit: 10 });

    assert.deepEqual(resultado.data.map(c => c.codigo), ['C001', 'C002', 'R001', 'S001']);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
