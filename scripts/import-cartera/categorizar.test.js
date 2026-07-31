// scripts/import-cartera/categorizar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { categoriaPorMensualidad } = require('./categorizar');

test('mapea las tarifas 2022-2023 (era "vieja")', () => {
  assert.equal(categoriaPorMensualidad(5000, 'vieja'), 'Finca');
  assert.equal(categoriaPorMensualidad(8000, 'vieja'), 'Finca con piscina');
  assert.equal(categoriaPorMensualidad(12000, 'vieja'), 'Tienda');
  assert.equal(categoriaPorMensualidad(20000, 'vieja'), 'Finca para alquiler');
});

test('mapea las tarifas 2024+ (era "2024")', () => {
  assert.equal(categoriaPorMensualidad(10000, '2024'), 'Finca');
  assert.equal(categoriaPorMensualidad(16000, '2024'), 'Finca con piscina');
  assert.equal(categoriaPorMensualidad(20000, '2024'), 'Tienda');
  assert.equal(categoriaPorMensualidad(50000, '2024'), 'Finca para alquiler');
});

test('$20.000 resuelve distinto según la era: Finca para alquiler en 2022-2023, Tienda en 2024+', () => {
  assert.equal(categoriaPorMensualidad(20000, 'vieja'), 'Finca para alquiler');
  assert.equal(categoriaPorMensualidad(20000, '2024'), 'Tienda');
});

test('devuelve null para una mensualidad que no corresponde a ninguna categoría conocida en esa era', () => {
  assert.equal(categoriaPorMensualidad(1, 'vieja'), null);
  assert.equal(categoriaPorMensualidad(0, 'vieja'), null);
  assert.equal(categoriaPorMensualidad(null, 'vieja'), null);
  assert.equal(categoriaPorMensualidad(undefined, 'vieja'), null);
});
