// scripts/import-gastos/config-hojas.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG_HOJAS, ORDEN_PROCESAMIENTO } = require('./config-hojas');

test('CONFIG_HOJAS tiene las 5 hojas con mapeo de columnas', () => {
  assert.deepEqual(Object.keys(CONFIG_HOJAS).sort(), ['2022', '2023', '2024', '2025', '2026']);
  for (const anio of Object.keys(CONFIG_HOJAS)) {
    const c = CONFIG_HOJAS[anio];
    assert.equal(typeof c.headerRow, 'number');
    assert.equal(typeof c.cols.fecha, 'number');
    assert.equal(typeof c.cols.concepto, 'number');
    assert.equal(typeof c.cols.valor, 'number');
  }
});

test('2022 no tiene columna de identificación (id = null)', () => {
  assert.equal(CONFIG_HOJAS['2022'].cols.id, null);
});

test('2023 define truncado en "RETIROS DE LA CUENTA"', () => {
  assert.match('RETIROS DE LA CUENTA'.toUpperCase(), CONFIG_HOJAS['2023'].truncarTodoDespuesDe.patron);
});

test('ORDEN_PROCESAMIENTO va de la hoja más nueva a la más vieja', () => {
  assert.deepEqual(ORDEN_PROCESAMIENTO, ['2026', '2025', '2024', '2023', '2022']);
});
