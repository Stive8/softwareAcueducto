// scripts/import-gastos/preview.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { parseCsv } = require('./csv');
const { generarPreview } = require('./preview');

async function fixtureXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GASTOS GENERALES 2026');
  for (let i = 1; i <= 6; i++) ws.addRow([]);
  ws.addRow(['FECHA', 'N RECIBO', 'CEDULA / NIT', 'CONCEPTO', 'VALOR']);
  ws.addRow([new Date('2026-01-31T00:00:00.000Z'), 'VICENCIO HERRERA', 93328699, 'PAGO SERVICIO FONTANERO MES DE ENERO 2026', 875000]);
  ws.addRow([new Date('2026-01-15T00:00:00.000Z'), 'DGV SUMINISTROS', 80765236, 'SILLA SANI 4*3 - BUJE SOLDADO PRESION 3*2', 48000]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-')), 'g.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

test('generarPreview escribe un CSV con acción y clasificación por fila', async () => {
  const ctx = crearDbTemporal();
  try {
    const filePath = await fixtureXlsx();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const { csvPath, resumen } = await generarPreview({ filePath, hoja: '2026', dbService: ctx.dbService, outDir });

    const filas = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    assert.equal(filas.length, 2);

    const fontanero = filas.find((f) => f.concepto.includes('FONTANERO'));
    assert.equal(fontanero.tipo_gasto, 'Honorarios');
    assert.equal(fontanero.tercero_modo, 'nuevo'); // no existe aún en la BD temporal
    assert.equal(fontanero.accion, 'IMPORTAR');

    const silla = filas.find((f) => f.concepto.includes('SILLA'));
    assert.equal(silla.tipo_gasto, 'Mobiliario y Equipo de Oficina');
    assert.equal(resumen.total, 2);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
