// scripts/import-gastos/normalizar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarFecha, normalizarTexto, clasificarFila } = require('./normalizar');
const { CONFIG_HOJAS } = require('./config-hojas');

test('normalizarFecha convierte Date UTC-midnight a YYYY-MM-DD sin corrimiento', () => {
  assert.equal(normalizarFecha(new Date('2025-01-31T00:00:00.000Z')), '2025-01-31');
});

test('normalizarFecha acepta string ISO y string YYYY-MM-DD', () => {
  assert.equal(normalizarFecha('2022-02-08T00:00:00.000Z'), '2022-02-08');
  assert.equal(normalizarFecha('2024-06-15'), '2024-06-15');
});

test('normalizarFecha devuelve null para basura', () => {
  assert.equal(normalizarFecha(''), null);
  assert.equal(normalizarFecha(null), null);
  assert.equal(normalizarFecha('no es fecha'), null);
});

test('normalizarFecha rechaza fechas calendario inválidas en el fast-path YYYY-MM-DD', () => {
  assert.equal(normalizarFecha('2024-13-40'), null);
  assert.equal(normalizarFecha('2023-02-30'), null); // Feb 30 no existe
  assert.equal(normalizarFecha('2024-06-15'), '2024-06-15');
});

test('normalizarTexto colapsa saltos de línea y espacios', () => {
  assert.equal(normalizarTexto('SERVICIO\n  HONORARIOS   CONTADOR'), 'SERVICIO HONORARIOS CONTADOR');
});

test('clasificarFila marca dato válido de 2025', () => {
  const cfg = CONFIG_HOJAS['2025'];
  const raw = [new Date('2025-02-14T00:00:00.000Z'), 'EDWARD HERRERA', 93412203, 'APOYO A CAMBIO DE TUBERIA', 300000];
  const r = clasificarFila(raw, cfg, 12);
  assert.equal(r.tipo, 'dato');
  assert.equal(r.fila.fecha, '2025-02-14');
  assert.equal(r.fila.valor, 300000);
  assert.equal(r.fila.identificacion, '93412203');
  assert.equal(r.fila.filaExcel, 12);
});

test('clasificarFila excluye filas TOTAL, sin valor y sin fecha', () => {
  const cfg = CONFIG_HOJAS['2024'];
  assert.equal(clasificarFila([null, null, null, 'TOTAL GASTOS 2024', 27060081], cfg, 80).tipo, 'excluida');
  assert.equal(clasificarFila([new Date('2024-01-01T00:00:00Z'), 'X', 1, 'CONCEPTO', null], cfg, 5).tipo, 'excluida');
  assert.equal(clasificarFila(['no-fecha', 'X', 1, 'CONCEPTO', 5000], cfg, 6).motivo, 'fecha inválida');
});

test('clasificarFila corta en RETIROS DE LA CUENTA (2023)', () => {
  const cfg = CONFIG_HOJAS['2023'];
  const raw = [null, 'RETIROS DE LA CUENTA', null, 'RETIROS - RECAUDOS', 5777000];
  assert.equal(clasificarFila(raw, cfg, 315).tipo, 'truncar');
});

test('clasificarFila excluye valor 0 (límite de la exclusión valor <= 0)', () => {
  const cfg = CONFIG_HOJAS['2025'];
  const raw = [new Date('2025-01-10T00:00:00Z'), 'X', 1, 'CONCEPTO', 0];
  assert.equal(clasificarFila(raw, cfg, 9).tipo, 'excluida');
});

test('clasificarFila en 2022 (sin columna id) deja identificacion null', () => {
  const cfg = CONFIG_HOJAS['2022'];
  const raw = [new Date('2022-03-01T00:00:00Z'), 'VICENCIO HERRERA', 3 /*cantidad, se ignora*/, 'PAGO FONTANERO', 617000];
  const r = clasificarFila(raw, cfg, 31);
  assert.equal(r.tipo, 'dato');
  assert.equal(r.fila.identificacion, null);
  assert.equal(r.fila.nombre, 'VICENCIO HERRERA');
});
