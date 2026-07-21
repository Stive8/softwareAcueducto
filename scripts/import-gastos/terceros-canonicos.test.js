// scripts/import-gastos/terceros-canonicos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizarIdentificacion, CORRECCIONES_DB } = require('./terceros-canonicos');

test('canonicaliza las variantes con typo de Vicencio a 93328699', () => {
  assert.equal(canonicalizarIdentificacion('93238699'), '93328699');
  assert.equal(canonicalizarIdentificacion('933228699'), '93328699');
  assert.equal(canonicalizarIdentificacion('93328699'), '93328699');
});

test('canonicaliza el NIT alterno de INGECOM (sin DV) a 900351740', () => {
  assert.equal(canonicalizarIdentificacion('900531740'), '900351740');
});

test('canonicaliza el typo de Ferretería Juanjo (142365013) a 14236501', () => {
  assert.equal(canonicalizarIdentificacion('142365013'), '14236501');
});

test('una identificación desconocida se devuelve igual', () => {
  assert.equal(canonicalizarIdentificacion('1007831935'), '1007831935');
});

test('CORRECCIONES_DB incluye la corrección de Vicencio en la BD', () => {
  assert.ok(CORRECCIONES_DB.some((c) => c.de === '93238699' && c.a === '93328699'));
});
