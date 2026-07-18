// scripts/import-gastos/csv.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { stringifyCsv, parseCsv } = require('./csv');

test('stringify + parse recupera los datos, incluso con comas y comillas', () => {
  const headers = ['a', 'b', 'c'];
  const rows = [
    { a: '1', b: 'texto con, coma', c: 'dijo "hola"' },
    { a: '2', b: 'simple', c: '' },
  ];
  const csv = stringifyCsv(headers, rows);
  const back = parseCsv(csv);
  assert.deepEqual(back, rows);
});

test('parseCsv respeta campos vacíos y espacios', () => {
  const csv = 'x,y\n"",  hola  \n1,2';
  const back = parseCsv(csv);
  assert.deepEqual(back, [{ x: '', y: '  hola  ' }, { x: '1', y: '2' }]);
});
