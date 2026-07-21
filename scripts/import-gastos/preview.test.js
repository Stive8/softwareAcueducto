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

test('generarPreview: el match por nombre ignora un tercero desactivado (duplicado ya fusionado)', async () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    // Simula el caso real: un duplicado por typo de identificación ya fusionado y desactivado,
    // y el tercero canónico activo con el mismo nombre.
    db.prepare(`INSERT INTO terceros (tipo_identificacion, numero_identificacion, nombre_razon_social, es_proveedor, activo)
                VALUES ('NIT', '142365013', 'FERRETERIA JUANJO', 1, 0)`).run();
    db.prepare(`INSERT INTO terceros (tipo_identificacion, numero_identificacion, nombre_razon_social, es_proveedor, activo)
                VALUES ('Cédula de Ciudadanía', '14236501', 'FERRETERIA JUANJO', 1, 1)`).run();
    const canonicoId = db.prepare(`SELECT id FROM terceros WHERE numero_identificacion = '14236501'`).get().id;

    const wb = new (require('exceljs').Workbook)();
    const ws = wb.addWorksheet('GASTOS GENERALES 2026');
    for (let i = 1; i <= 6; i++) ws.addRow([]);
    ws.addRow(['FECHA', 'N RECIBO', 'CEDULA / NIT', 'CONCEPTO', 'VALOR']);
    // Sin identificación (columna vacía): fuerza el camino de match por nombre.
    ws.addRow([new Date('2026-02-01T00:00:00.000Z'), 'FERRETERIA JUANJO', null, 'TAPON PVC', 15000]);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-')), 'h.xlsx');
    await wb.xlsx.writeFile(file);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const { csvPath } = await generarPreview({ filePath: file, hoja: '2026', dbService: ctx.dbService, outDir });
    const filas = parseCsv(fs.readFileSync(csvPath, 'utf8'));

    assert.equal(filas.length, 1);
    assert.equal(filas[0].tercero_modo, 'revisar_nombre');
    assert.equal(Number(filas[0].tercero_id), canonicoId); // el activo (14236501), nunca el desactivado (142365013)
  } finally {
    cerrarDbTemporal(ctx);
  }
});
