// src/database/migrations/042_tarifas_historicas.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');
const PagoRepository = require('../../repositories/PagoRepository');

function tarifaEn(pagoRepo, cuentaId, anio, mes) {
  const fila = pagoRepo.getCategoriaTarifaParaMes(cuentaId, anio, mes);
  return fila ? fila.tarifa_sostenimiento : undefined;
}

function crearCuentaConCategoria(dbService, categoriaNombre, desde = '1990-01-01') {
  const db = dbService.getDb();
  const codigo = `T-${categoriaNombre}-${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
  const categoriaId = db.prepare(`SELECT id FROM categorias WHERE nombre = ?`).get(categoriaNombre).id;
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, ?)`)
    .run(cuentaId, categoriaId, desde);
  return cuentaId;
}

test('042: borra las tarifas "Modo de Pruebas" sembradas en desarrollo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const restantes = db.prepare(
      `SELECT COUNT(*) c FROM categoria_tarifas WHERE observaciones = 'Tarifa de ejemplo (Modo de Pruebas)'`
    ).get().c;
    assert.equal(restantes, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('042: Finca tiene tarifa continua sin huecos desde 1900 hasta hoy', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = crearCuentaConCategoria(ctx.dbService, 'Finca');
    const pagoRepo = new PagoRepository(ctx.dbService);

    assert.equal(tarifaEn(pagoRepo, cuentaId, 1990, 6), 1500);
    assert.equal(tarifaEn(pagoRepo, cuentaId, 2016, 12), 1500);
    assert.equal(tarifaEn(pagoRepo, cuentaId, 2017, 1), 3000);
    assert.equal(tarifaEn(pagoRepo, cuentaId, 2017, 12), 3000);
    assert.equal(tarifaEn(pagoRepo, cuentaId, 2018, 1), 5000);
    assert.equal(tarifaEn(pagoRepo, cuentaId, 2023, 12), 5000);
    assert.equal(tarifaEn(pagoRepo, cuentaId, 2024, 1), 10000);
    assert.equal(tarifaEn(pagoRepo, cuentaId, 2026, 8), 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('042: Finca con piscina y Tienda solo tienen vigencia validada desde 2018 (hueco documentado antes)', () => {
  const ctx = crearDbTemporal();
  try {
    const pagoRepo = new PagoRepository(ctx.dbService);

    const piscina = crearCuentaConCategoria(ctx.dbService, 'Finca con piscina');
    assert.equal(tarifaEn(pagoRepo, piscina, 2017, 12), undefined);
    assert.equal(tarifaEn(pagoRepo, piscina, 2018, 1), 8000);
    assert.equal(tarifaEn(pagoRepo, piscina, 2023, 12), 8000);
    assert.equal(tarifaEn(pagoRepo, piscina, 2024, 1), 16000);

    const tienda = crearCuentaConCategoria(ctx.dbService, 'Tienda');
    assert.equal(tarifaEn(pagoRepo, tienda, 2017, 12), undefined);
    assert.equal(tarifaEn(pagoRepo, tienda, 2018, 1), 12000);
    assert.equal(tarifaEn(pagoRepo, tienda, 2023, 12), 12000);
    assert.equal(tarifaEn(pagoRepo, tienda, 2024, 1), 20000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('042: Finca para alquiler suma el tramo histórico 2018-2023 (20.000) al 2024+ (50.000) ya existente', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = crearCuentaConCategoria(ctx.dbService, 'Finca para alquiler');
    const pagoRepo = new PagoRepository(ctx.dbService);

    assert.equal(tarifaEn(pagoRepo, cuentaId, 2018, 1), 20000);
    assert.equal(tarifaEn(pagoRepo, cuentaId, 2023, 12), 20000);
    assert.equal(tarifaEn(pagoRepo, cuentaId, 2024, 1), 50000);
    assert.equal(tarifaEn(pagoRepo, cuentaId, 2026, 8), 50000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('042: Finca para alquiler no queda con filas duplicadas para el tramo 2024+ (guarda NOT EXISTS)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const categoriaId = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca para alquiler'`).get().id;
    const filas = db.prepare(
      `SELECT COUNT(*) c FROM categoria_tarifas WHERE categoria_id = ? AND fecha_vigencia_desde = '2024-01-01' AND tarifa_sostenimiento = 50000`
    ).get(categoriaId).c;
    assert.equal(filas, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
