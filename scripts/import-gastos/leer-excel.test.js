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
