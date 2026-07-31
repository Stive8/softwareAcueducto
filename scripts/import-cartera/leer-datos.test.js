// scripts/import-cartera/leer-datos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { leerDatosMaestros } = require('./leer-datos');

// Datos.xlsx, Hoja1: 1=COD, 2=NOMBRE, 10=TIPO, 12=OBSERVACION.
async function crearFixture() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.addRow(['COD', 'NOMBRE', 'CEDULA', 'TELEFONO', 'CORREO', 'lat', 'lon', 'lat2', 'lon2', 'TIPO', 'ANTIGUO', 'OBSERVACION', 'NOMBRE FINCA']);
  ws.getRow(2).getCell(1).value = 'R034';
  ws.getRow(2).getCell(2).value = 'RUIZ ESCOBAR ANSELMO';
  ws.getRow(2).getCell(10).value = 'CASA';

  ws.getRow(3).getCell(1).value = 'R002';
  ws.getRow(3).getCell(2).value = 'ALGUIEN';
  ws.getRow(3).getCell(12).value = 'SUSPENDIDO (NO EXISTE)';

  ws.getRow(4).getCell(1).value = 'S004';
  ws.getRow(4).getCell(12).value = 'CASA ABANDONADA';

  // Fila 302: punto "pirata" sin código -- debe ignorarse por completo (fuera de rango 2-300).
  ws.getRow(302).getCell(2).value = 'PUNTO SIN CODIGO';

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-datos-')), 'd.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

test('lee codigo, tipo y observacion por fila', async () => {
  const file = await crearFixture();
  const registros = await leerDatosMaestros(file);
  const r034 = registros.find((r) => r.codigo === 'R034');
  assert.equal(r034.tipo, 'CASA');
  assert.equal(r034.observacion, null);
  assert.equal(r034.candidatoSuspension, false);
});

test('marca candidatoSuspension cuando la observacion matchea el patron de suspension', async () => {
  const file = await crearFixture();
  const registros = await leerDatosMaestros(file);
  assert.equal(registros.find((r) => r.codigo === 'R002').candidatoSuspension, true);
  assert.equal(registros.find((r) => r.codigo === 'S004').candidatoSuspension, true, 'CASA ABANDONADA tambien cuenta');
});

test('ignora las filas desde la 302 en adelante (puntos piratas sin código)', async () => {
  const file = await crearFixture();
  const registros = await leerDatosMaestros(file);
  assert.ok(!registros.some((r) => r.codigo === null || r.codigo === undefined));
  assert.equal(registros.length, 3);
});
