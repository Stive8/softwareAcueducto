// scripts/import-cartera/leer-cartera.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { leerCartera } = require('./leer-cartera');

// Fixture con las columnas reales (1-indexed): 4=CODIGO, 5=NOMBRE, 7=MENSUALIDAD,
// 8=SALDO A 31 12 2020, 15=SALDO PAGOS 31/12/2021 (el VLOOKUP), 26=MENSUALIDAD 2024,
// 33=SALDO A 31/12/2025, 40=OBSERVACIONES, 41=CUANDO EMPEZÓ.
// "estado cta con movimiento": 1=código, 4=Saldo Mes Ant., 5=Débito, 6=Crédito, 7=Saldo Mes.
async function crearFixture() {
  const wb = new ExcelJS.Workbook();

  const mov = wb.addWorksheet('estado cta con movimiento');
  mov.addRow([]);                                            // fila 1: encabezado (no se usa por índice)
  mov.addRow([]);                                             // fila 2: título/subtotal
  mov.getRow(3).getCell(1).value = 'R034';
  mov.getRow(3).getCell(4).value = 190000;   // Saldo Mes Ant.
  mov.getRow(3).getCell(5).value = 60000;    // Debito
  mov.getRow(3).getCell(6).value = 10000;    // Credito
  mov.getRow(3).getCell(7).value = 240000;   // Saldo Mes  <- lo que resuelve el VLOOKUP

  const est = wb.addWorksheet('ESTADO DE CUENTA ASOCIADOS');
  const fila = (r, valores) => { for (const [c, v] of Object.entries(valores)) est.getRow(r).getCell(Number(c)).value = v; };

  // R034: la celda 15 (VLOOKUP) no tiene resultado guardado -> se resuelve por la hoja fuente
  fila(2, { 4: 'R034', 5: 'RUIZ ESCOBAR ANSELMO', 7: 5000, 8: 180000, 26: 10000, 33: 250000 });
  est.getRow(2).getCell(15).value = { formula: 'VLOOKUP(D2,...)' };   // sin result

  // R037: la celda 15 SÍ tiene resultado directo -> se usa tal cual, no hace falta la hoja fuente
  fila(3, { 4: 'R037', 5: 'ALVAREZ CLARA ISABEL', 7: 5000, 8: 270000, 15: 330000, 26: 10000, 33: 420000 });

  // S058 (ejemplo): nació en 2022+, sin SALDO A 31 12 2020, sin VLOOKUP -> apertura 'ninguna'
  fila(4, { 4: 'S058', 5: 'ARIAS MARTHA LUCIA', 7: 5000, 26: 10000, 33: 0 });

  // R069: trae override de fecha en "CUANDO EMPEZÓ"
  fila(5, { 4: 'R069', 5: 'ALGUIEN', 7: 5000, 15: 0, 26: 10000, 33: 0, 40: null, 41: 'DESDE ENERO 2026' });

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-cartera-')), 'c.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

test('resuelve la apertura vía la hoja fuente del VLOOKUP cuando la celda no tiene resultado guardado', async () => {
  const file = await crearFixture();
  const registros = await leerCartera(file);
  const r034 = registros.find((r) => r.codigo === 'R034');
  assert.deepEqual(r034.aperturaOpaca, { monto: 240000, fuente: 'vlookup' });
});

test('usa el valor directo de la celda 15 cuando SÍ está guardado, sin tocar la hoja fuente', async () => {
  const file = await crearFixture();
  const registros = await leerCartera(file);
  const r037 = registros.find((r) => r.codigo === 'R037');
  assert.deepEqual(r037.aperturaOpaca, { monto: 330000, fuente: 'vlookup' });
});

test('cae a SALDO A 31 12 2020 cuando la cuenta no está en la hoja fuente y la celda 15 está vacía', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('estado cta con movimiento').addRow([]);
  const est = wb.addWorksheet('ESTADO DE CUENTA ASOCIADOS');
  est.getRow(2).getCell(4).value = 'X001';
  est.getRow(2).getCell(7).value = 5000;
  est.getRow(2).getCell(8).value = 95000;   // sin dato en col 15 ni en la hoja fuente
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-fallback-')), 'f.xlsx');
  await wb.xlsx.writeFile(file);

  const registros = await leerCartera(file);
  assert.deepEqual(registros[0].aperturaOpaca, { monto: 95000, fuente: 'saldo2020' });
});

test('cuenta nacida en 2022+ sin ningún dato de apertura queda en fuente "ninguna", monto 0', async () => {
  const file = await crearFixture();
  const registros = await leerCartera(file);
  const s058 = registros.find((r) => r.codigo === 'S058');
  assert.deepEqual(s058.aperturaOpaca, { monto: 0, fuente: 'ninguna' });
});

test('extrae mensualidad vieja, mensualidad 2024, saldo de referencia y el override de fecha', async () => {
  const file = await crearFixture();
  const registros = await leerCartera(file);
  const r034 = registros.find((r) => r.codigo === 'R034');
  assert.equal(r034.mensualidadVieja, 5000);
  assert.equal(r034.mensualidad2024, 10000);
  assert.equal(r034.saldoReferencia2025, 250000);

  const r069 = registros.find((r) => r.codigo === 'R069');
  assert.equal(r069.cuandoEmpezo, 'DESDE ENERO 2026');
});

test('ignora filas sin código', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('estado cta con movimiento').addRow([]);
  const est = wb.addWorksheet('ESTADO DE CUENTA ASOCIADOS');
  est.getRow(2).getCell(5).value = 'SIN CODIGO';   // solo nombre, sin código
  est.getRow(3).getCell(4).value = 'X002';
  est.getRow(3).getCell(7).value = 5000;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-sincodigo-')), 'f.xlsx');
  await wb.xlsx.writeFile(file);

  const registros = await leerCartera(file);
  assert.equal(registros.length, 1);
  assert.equal(registros[0].codigo, 'X002');
});

test('celda15 guardada gana sobre mapa de movimiento cuando ambos existen con valores distintos', async () => {
  const wb = new ExcelJS.Workbook();

  const mov = wb.addWorksheet('estado cta con movimiento');
  mov.addRow([]);
  mov.addRow([]);
  mov.getRow(3).getCell(1).value = 'R050';
  mov.getRow(3).getCell(7).value = 999000;   // valor en mapa

  const est = wb.addWorksheet('ESTADO DE CUENTA ASOCIADOS');
  est.getRow(2).getCell(4).value = 'R050';
  est.getRow(2).getCell(7).value = 5000;
  est.getRow(2).getCell(15).value = 330000;  // celda15 guardada (distinta del mapa)

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-precedencia-')), 'f.xlsx');
  await wb.xlsx.writeFile(file);

  const registros = await leerCartera(file);
  const r050 = registros.find((r) => r.codigo === 'R050');
  assert.deepEqual(r050.aperturaOpaca, { monto: 330000, fuente: 'vlookup' }, 'celda15 guardada debe ganar sobre mapa');
});

test('duplicados en hoja fuente usan la PRIMERA fila, nunca la última', async () => {
  const wb = new ExcelJS.Workbook();

  const mov = wb.addWorksheet('estado cta con movimiento');
  mov.addRow([]);
  mov.addRow([]);
  mov.getRow(3).getCell(1).value = 'R055';
  mov.getRow(3).getCell(7).value = 100000;   // PRIMERA fila con R055
  mov.getRow(4).getCell(1).value = 'R055';
  mov.getRow(4).getCell(7).value = 500000;   // SEGUNDA fila con R055 (debe ignorarse)

  const est = wb.addWorksheet('ESTADO DE CUENTA ASOCIADOS');
  est.getRow(2).getCell(4).value = 'R055';
  est.getRow(2).getCell(7).value = 5000;
  // celda15 vacía para forzar resolución vía mapa

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-duplicados-')), 'f.xlsx');
  await wb.xlsx.writeFile(file);

  const registros = await leerCartera(file);
  const r055 = registros.find((r) => r.codigo === 'R055');
  assert.deepEqual(r055.aperturaOpaca, { monto: 100000, fuente: 'vlookup' }, 'debe usar la PRIMERA fila del código duplicado en hoja fuente');
});

test('mensualidad2024 fallback a mensualidadVieja cuando columna 26 falta', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('estado cta con movimiento').addRow([]);

  const est = wb.addWorksheet('ESTADO DE CUENTA ASOCIADOS');
  est.getRow(2).getCell(4).value = 'X003';
  est.getRow(2).getCell(7).value = 7500;  // mensualidadVieja
  // SIN columna 26 (mensualidad2024)

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-fallback-mens-')), 'f.xlsx');
  await wb.xlsx.writeFile(file);

  const registros = await leerCartera(file);
  assert.equal(registros[0].mensualidadVieja, 7500);
  assert.equal(registros[0].mensualidad2024, 7500, 'mensualidad2024 debe caer a mensualidadVieja cuando falta columna 26');
});
