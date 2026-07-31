// scripts/import-cartera/leer-excel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { valorCelda, abrirLibro, hoja } = require('./leer-excel');

async function crearFixture() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.addRow(['CODIGO', 'VALOR']);
  ws.addRow(['C001', 12345]);
  const r3 = ws.addRow(['C002', null]);
  r3.getCell(2).value = { formula: 'A1/B1', result: { error: '#DIV/0!' } };
  const r4 = ws.addRow(['C003', null]);
  r4.getCell(2).value = { formula: 'VLOOKUP(A4,X,1,0)' };   // sin result: la fórmula no se guardó calculada
  const r5 = ws.addRow(['C004', null]);
  r5.getCell(2).value = { richText: [{ text: 'texto ' }, { text: 'compuesto' }] };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-cartera-')), 'f.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

test('valorCelda extrae numeros y texto plano', async () => {
  const file = await crearFixture();
  const wb = await abrirLibro(file);
  const ws = hoja(wb, 'Hoja1');
  assert.equal(valorCelda(ws.getRow(2).getCell(1)), 'C001');
  assert.equal(valorCelda(ws.getRow(2).getCell(2)), 12345);
});

test('valorCelda marca con __error una celda con error de fórmula', async () => {
  const file = await crearFixture();
  const wb = await abrirLibro(file);
  const ws = hoja(wb, 'Hoja1');
  const v = valorCelda(ws.getRow(3).getCell(2));
  assert.equal(typeof v, 'object');
  assert.equal(v.__error, '#DIV/0!');
});

test('valorCelda devuelve null en una fórmula sin resultado guardado (el caso del VLOOKUP roto)', async () => {
  const file = await crearFixture();
  const wb = await abrirLibro(file);
  const ws = hoja(wb, 'Hoja1');
  assert.equal(valorCelda(ws.getRow(4).getCell(2)), null);
});

test('valorCelda resuelve richText concatenando sus fragmentos', async () => {
  const file = await crearFixture();
  const wb = await abrirLibro(file);
  const ws = hoja(wb, 'Hoja1');
  assert.equal(valorCelda(ws.getRow(5).getCell(2)), 'texto compuesto');
});

test('hoja lanza un error legible si la hoja no existe', async () => {
  const file = await crearFixture();
  const wb = await abrirLibro(file);
  assert.throws(() => hoja(wb, 'NoExiste'), /No se encontró la hoja "NoExiste"/);
});
