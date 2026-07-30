// scripts/import-cartera/codigos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarCodigo, EQUIVALENCIAS, HUERFANO_A_CREAR, CODIGOS_PENDIENTES, resolverCodigo } = require('./codigos');

test('normalizarCodigo quita espacios, guiones y pasa a mayúsculas', () => {
  assert.equal(normalizarCodigo('r019'), 'R019');
  assert.equal(normalizarCodigo('S033-2'), 'S0332');
  assert.equal(normalizarCodigo(' c001 '), 'C001');
});

test('EQUIVALENCIAS mapea R0081 a S058, la cuenta real (mismo teléfono, mismo pago)', () => {
  assert.equal(EQUIVALENCIAS.get('R0081'), 'S058');
  assert.equal(EQUIVALENCIAS.size, 1, 'solo esa equivalencia está resuelta; S03321 queda pendiente');
});

test('HUERFANO_A_CREAR describe a C021, la única cuenta que de verdad falta', () => {
  assert.equal(HUERFANO_A_CREAR.codigo, 'C021');
  assert.equal(HUERFANO_A_CREAR.categoriaNombre, 'Finca');
  assert.equal(HUERFANO_A_CREAR.motivoSuspension, 'no encontrado');
});

test('CODIGOS_PENDIENTES contiene S03321, sin resolver hasta que el usuario decida', () => {
  assert.deepEqual(CODIGOS_PENDIENTES, ['S03321']);
});

test('resolverCodigo mapea un código Excel a su equivalente real cuando existe equivalencia', () => {
  const enBase = new Set(['S058', 'R034']);
  const r = resolverCodigo('R0081', enBase);
  assert.equal(r.codigoBase, 'S058');
});

test('resolverCodigo encuentra directo cuando el código normalizado ya existe en la base', () => {
  const enBase = new Set(['R034']);
  const r = resolverCodigo('r034', enBase);
  assert.equal(r.codigoBase, 'R034');
});

test('resolverCodigo marca pendiente cuando el código está en CODIGOS_PENDIENTES', () => {
  const enBase = new Set([]);
  const r = resolverCodigo('S03321', enBase);
  assert.equal(r.esPendiente, true);
  assert.equal(r.codigoBase, undefined);
});

test('resolverCodigo marca huérfano cuando no está en la base, no tiene equivalencia y no está pendiente', () => {
  const enBase = new Set(['R034']);
  const r = resolverCodigo('C021', enBase);
  assert.equal(r.esHuerfano, true);
  assert.equal(r.esPendiente, false);
});
