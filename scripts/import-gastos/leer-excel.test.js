// scripts/import-gastos/leer-excel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { leerHoja } = require('./leer-excel');
const { CONFIG_HOJAS } = require('./config-hojas');

async function crearFixture() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GASTOS GENERALES 2025');
  for (let i = 1; i <= 6; i++) ws.addRow([]); // filas 1-6 de título/vacías
  ws.addRow(['FECHA', 'N RECIBO', 'CEDULA / NIT', 'CONCEPTO', 'VALOR']); // fila 7 header
  ws.addRow([new Date('2025-02-14T00:00:00.000Z'), 'EDWARD HERRERA', 93412203, 'APOYO A CAMBIO DE TUBERIA', 300000]); // 8
  ws.addRow([new Date('2025-02-15T00:00:00.000Z'), 'FERRETERIA', null, 'UNION DE 1/2', 8000]); // 9 sin id
  ws.addRow([null, null, null, 'TOTAL GASTOS 2025', 999999]); // 10 excluida
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-')), 'f.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

test('leerHoja devuelve filas de datos y excluye la de TOTAL', async () => {
  const file = await crearFixture();
  const { filas, excluidas } = await leerHoja(file, 'GASTOS GENERALES 2025', CONFIG_HOJAS['2025']);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].concepto, 'APOYO A CAMBIO DE TUBERIA');
  assert.equal(filas[0].fecha, '2025-02-14');
  assert.equal(filas[1].identificacion, null);
  assert.equal(excluidas.length, 1);
  assert.equal(excluidas[0].motivo, 'fila de total');
});

test('leerHoja excluye una fila con celda de error de fórmula (nunca la adivina)', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GASTOS GENERALES 2025');
  for (let i = 1; i <= 6; i++) ws.addRow([]);
  ws.addRow(['FECHA', 'N RECIBO', 'CEDULA / NIT', 'CONCEPTO', 'VALOR']); // fila 7
  const fila8 = ws.addRow([new Date('2025-03-01T00:00:00.000Z'), 'X', 1, null, 7000]); // 8: concepto con error
  fila8.getCell(4).value = { formula: 'A1/0', result: { error: '#DIV/0!' } };
  ws.addRow([new Date('2025-03-02T00:00:00.000Z'), 'DGV', 80765236, 'UNION DE 1/2', 8000]); // 9 válida

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-err-')), 'e.xlsx');
  await wb.xlsx.writeFile(file);

  const { filas, excluidas } = await leerHoja(file, 'GASTOS GENERALES 2025', CONFIG_HOJAS['2025']);
  assert.equal(filas.length, 1); // solo la fila 9 válida
  assert.ok(excluidas.some((e) => /error de fórmula/i.test(e.motivo)));
});

test('leerHoja resuelve una celda de concepto en rich-text a su texto', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GASTOS GENERALES 2025');
  for (let i = 1; i <= 6; i++) ws.addRow([]);
  ws.addRow(['FECHA', 'N RECIBO', 'CEDULA / NIT', 'CONCEPTO', 'VALOR']);
  const f = ws.addRow([new Date('2025-04-01T00:00:00.000Z'), 'X', 1, null, 5000]);
  f.getCell(4).value = { richText: [{ text: 'UNION ' }, { text: 'DE 1/2' }] };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-rt-')), 'r.xlsx');
  await wb.xlsx.writeFile(file);
  const { filas } = await leerHoja(file, 'GASTOS GENERALES 2025', CONFIG_HOJAS['2025']);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].concepto, 'UNION DE 1/2');
});
