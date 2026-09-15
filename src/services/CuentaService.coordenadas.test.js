const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CuentaService = require('./CuentaService');

function obtenerCategoriaId(dbService) {
  return dbService.getDb().prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;
}

function datosBase(categoriaId, codigo) {
  return { codigo, direccion: 'Vereda El Salitre', categoria_id: categoriaId };
}

test('create() permite una cuenta sin ninguna coordenada', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const id = service.create(datosBase(categoriaId, 'C-100'));
    assert.ok(id > 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() permite una cuenta con ambos puntos completos y válidos', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const id = service.create({
      ...datosBase(categoriaId, 'C-101'),
      lat_acometida: 4.60971, lon_acometida: -74.08175,
      lat_vivienda: 4.60980, lon_vivienda: -74.08190
    });
    assert.ok(id > 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() rechaza cuando solo se informa la latitud de un punto (falta la longitud)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    assert.throws(
      () => service.create({ ...datosBase(categoriaId, 'C-102'), lat_acometida: 4.60971 }),
      /tanto la latitud como la longitud/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() rechaza coordenadas no numéricas', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    assert.throws(
      () => service.create({ ...datosBase(categoriaId, 'C-103'), lat_acometida: 'abc', lon_acometida: -74.0 }),
      /deben ser números/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() rechaza coordenadas fuera del rango genérico de latitud/longitud', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    assert.throws(
      () => service.create({ ...datosBase(categoriaId, 'C-104'), lat_acometida: 200, lon_acometida: -74.0 }),
      /rango válido/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() rechaza coordenadas fuera de Colombia (probable lat/lon invertidos)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    assert.throws(
      () => service.create({ ...datosBase(categoriaId, 'C-105'), lat_acometida: 40.0, lon_acometida: -74.0 }),
      /fuera de Colombia/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('update() valida las coordenadas igual que create()', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);
    const id = service.create(datosBase(categoriaId, 'C-106'));

    assert.throws(
      () => service.update(id, { codigo: 'C-106', direccion: 'Vereda El Salitre', lat_vivienda: 4.6 }),
      /tanto la latitud como la longitud/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
