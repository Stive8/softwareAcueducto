// scripts/import-cartera/categorizar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { categoriaPorMensualidad } = require('./categorizar');

test('mapea las 4 mensualidades vigentes 2022-2023 y 2024-2026', () => {
  assert.equal(categoriaPorMensualidad(5000), 'Finca');
  assert.equal(categoriaPorMensualidad(10000), 'Finca');
  assert.equal(categoriaPorMensualidad(8000), 'Finca con piscina');
  assert.equal(categoriaPorMensualidad(16000), 'Finca con piscina');
  assert.equal(categoriaPorMensualidad(12000), 'Tienda');
  assert.equal(categoriaPorMensualidad(20000), 'Tienda');
  assert.equal(categoriaPorMensualidad(50000), 'Finca para alquiler');
});

test('devuelve null para una mensualidad que no corresponde a ninguna categoría conocida', () => {
  assert.equal(categoriaPorMensualidad(1), null);
  assert.equal(categoriaPorMensualidad(0), null);
  assert.equal(categoriaPorMensualidad(null), null);
  assert.equal(categoriaPorMensualidad(undefined), null);
});
