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

test('HUERFANOS_A_CREAR describe las 13 cuentas que de verdad faltan (confirmado 2026-07-31 contra la base real)', () => {
  assert.equal(HUERFANOS_A_CREAR.length, 13);
  assert.equal(HUERFANOS_A_CREAR[0].codigo, 'C021');
  assert.equal(HUERFANOS_A_CREAR[0].motivoSuspension, 'no encontrado');
  assert.equal(HUERFANOS_A_CREAR[1].codigo, 'S03321');
  assert.equal(HUERFANOS_A_CREAR[1].nombre, 'MARIN HERRERA ORFILIA');
  assert.equal(HUERFANOS_A_CREAR[1].motivoSuspension, null, 'tiene teléfono propio en Datos.xlsx, se crea Activa');

  for (const h of HUERFANOS_A_CREAR) {
    assert.ok(h.categoriaNombre, `${h.codigo} debe traer categoriaNombre`);
  }

  const r0211 = HUERFANOS_A_CREAR.find((h) => h.codigo === 'R0211');
  assert.equal(r0211.categoriaNombre, 'Tienda', 'R0211 cobraba 12.000, tarifa de Tienda');

  const r044 = HUERFANOS_A_CREAR.find((h) => h.codigo === 'R044');
  assert.equal(r044.categoriaNombre, 'Tienda', 'R044 no tiene mensualidad, se usa el TIPO=COML de Datos.xlsx');

  const s0244 = HUERFANOS_A_CREAR.find((h) => h.codigo === 'S0244');
  assert.equal(s0244.motivoSuspension, null, 'tiene cédula, teléfono y correo reales en Datos.xlsx, se crea Activa');

  const suspendidos = HUERFANOS_A_CREAR.filter((h) => h.motivoSuspension !== null);
  assert.equal(suspendidos.length, 9, 'C021, R002, R0211, R044, R0501, R085, R0971, S009, S025');
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
