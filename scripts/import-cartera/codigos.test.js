// scripts/import-cartera/codigos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarCodigo, EQUIVALENCIAS, HUERFANOS_A_CREAR, CODIGOS_PENDIENTES, resolverCodigo } = require('./codigos');

test('normalizarCodigo quita espacios, guiones y pasa a mayúsculas', () => {
  assert.equal(normalizarCodigo('r019'), 'R019');
  assert.equal(normalizarCodigo('S033-2'), 'S0332');
  assert.equal(normalizarCodigo(' c001 '), 'C001');
});

test('EQUIVALENCIAS mapea R0081 a S058, la cuenta real (mismo teléfono, mismo pago)', () => {
  assert.equal(EQUIVALENCIAS.get('R0081'), 'S058');
  assert.equal(EQUIVALENCIAS.size, 1, 'solo esa equivalencia; C021 y S03321 se crean, no se mapean');
});

test('HUERFANOS_A_CREAR describe a C021 y S03321, las dos cuentas que de verdad faltan', () => {
  assert.equal(HUERFANOS_A_CREAR.length, 2);
  assert.equal(HUERFANOS_A_CREAR[0].codigo, 'C021');
  assert.equal(HUERFANOS_A_CREAR[0].motivoSuspension, 'no encontrado');
  assert.equal(HUERFANOS_A_CREAR[1].codigo, 'S03321');
  assert.equal(HUERFANOS_A_CREAR[1].nombre, 'MARIN HERRERA ORFILIA');
  assert.equal(HUERFANOS_A_CREAR[1].motivoSuspension, null, 'tiene teléfono propio en Datos.xlsx, se crea Activa');
});

test('CODIGOS_PENDIENTES queda vacío: ya no hay códigos sin resolver', () => {
  assert.deepEqual(CODIGOS_PENDIENTES, []);
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

test('resolverCodigo marca huérfano para S03321: ya no está pendiente, se crea', () => {
  const enBase = new Set([]);
  const r = resolverCodigo('S03321', enBase);
  assert.equal(r.esHuerfano, true);
  assert.equal(r.esPendiente, false);
});

test('resolverCodigo marca huérfano cuando no está en la base, no tiene equivalencia y no está pendiente', () => {
  const enBase = new Set(['R034']);
  const r = resolverCodigo('C021', enBase);
  assert.equal(r.esHuerfano, true);
  assert.equal(r.esPendiente, false);
});
