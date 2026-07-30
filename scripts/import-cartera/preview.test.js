// scripts/import-cartera/preview.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { generarPlan } = require('./preview');

async function crearExcelCartera(filas) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('estado cta con movimiento').addRow([]);
  const est = wb.addWorksheet('ESTADO DE CUENTA ASOCIADOS');
  let r = 2;
  for (const f of filas) {
    const row = est.getRow(r++);
    row.getCell(4).value = f.codigo;
    row.getCell(7).value = f.mensualidadVieja;
    if (f.saldo2020 !== undefined) row.getCell(8).value = f.saldo2020;
    if (f.saldoPagos2021 !== undefined) row.getCell(15).value = f.saldoPagos2021;
    row.getCell(26).value = f.mensualidad2024 ?? f.mensualidadVieja;
    if (f.saldo2025 !== undefined) row.getCell(33).value = f.saldo2025;
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-cartera-')), 'c.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

async function crearExcelDatos(filas) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  let r = 2;
  for (const f of filas) {
    const row = ws.getRow(r++);
    row.getCell(1).value = f.codigo;
    if (f.tipo) row.getCell(10).value = f.tipo;
    if (f.observacion) row.getCell(12).value = f.observacion;
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-datos-')), 'd.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

function sembrarCuenta(dbService, codigo) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

test('arma un registro por cuenta con categoría, apertura y saldo de referencia', async () => {
  const ctx = crearDbTemporal();
  try {
    sembrarCuenta(ctx.dbService, 'R034');
    const filePathCartera = await crearExcelCartera([
      { codigo: 'R034', mensualidadVieja: 5000, saldoPagos2021: 240000, mensualidad2024: 10000, saldo2025: 250000 }
    ]);
    const filePathDatos = await crearExcelDatos([{ codigo: 'R034', tipo: 'CASA' }]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });

    assert.equal(plan.cuentas.length, 1);
    const r034 = plan.cuentas[0];
    assert.equal(r034.codigo, 'R034');
    assert.equal(r034.categoriaNombre, 'Finca');
    assert.equal(r034.categoriaNombre2024, null, 'misma categoría en 2024, no hay segunda vigencia');
    assert.deepEqual(r034.aperturaOpaca, { monto: 240000, fuente: 'vlookup' });
    assert.equal(r034.saldoReferencia2025, 250000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('detecta el cambio de categoría entre mensualidadVieja y mensualidad2024', async () => {
  const ctx = crearDbTemporal();
  try {
    sembrarCuenta(ctx.dbService, 'X001');
    const filePathCartera = await crearExcelCartera([
      { codigo: 'X001', mensualidadVieja: 8000, mensualidad2024: 16000 }
    ]);
    const filePathDatos = await crearExcelDatos([]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.cuentas[0].categoriaNombre, 'Finca con piscina');
    assert.equal(plan.cuentas[0].categoriaNombre2024, null, '8000->16000 es la MISMA categoría, no cambia');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reporta como discrepancia cuando el TIPO de Datos.xlsx no corresponde a la categoría cargada', async () => {
  const ctx = crearDbTemporal();
  try {
    sembrarCuenta(ctx.dbService, 'X002');
    const filePathCartera = await crearExcelCartera([{ codigo: 'X002', mensualidadVieja: 5000, mensualidad2024: 10000 }]);
    const filePathDatos = await crearExcelDatos([{ codigo: 'X002', tipo: 'PISC' }]);   // dice piscina, cobra Finca

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.discrepanciasTipo.length, 1);
    assert.equal(plan.discrepanciasTipo[0].codigo, 'X002');
    assert.equal(plan.discrepanciasTipo[0].tipoDatosXlsx, 'PISC');
    assert.equal(plan.discrepanciasTipo[0].categoriaNombre, 'Finca');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('marca candidatoSuspension desde Datos.xlsx aunque la cartera no diga nada', async () => {
  const ctx = crearDbTemporal();
  try {
    sembrarCuenta(ctx.dbService, 'R002');
    const filePathCartera = await crearExcelCartera([{ codigo: 'R002', mensualidadVieja: 5000, mensualidad2024: 5000 }]);
    const filePathDatos = await crearExcelDatos([{ codigo: 'R002', observacion: 'SUSPENDIDO (NO EXISTE)' }]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.cuentas[0].candidatoSuspension, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('resuelve R0081 a la cuenta real S058 vía la tabla de equivalencias', async () => {
  const ctx = crearDbTemporal();
  try {
    sembrarCuenta(ctx.dbService, 'S058');
    const filePathCartera = await crearExcelCartera([{ codigo: 'R0081', mensualidadVieja: 5000, mensualidad2024: 5000 }]);
    const filePathDatos = await crearExcelDatos([]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.cuentas.length, 1);
    assert.equal(plan.cuentas[0].codigo, 'S058', 'R0081 se resolvió a S058, no se duplicó');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reporta C021 y S03321 como huérfanos a crear, sin incluirlos en cuentas ni en pendientes', async () => {
  const ctx = crearDbTemporal();
  try {
    const filePathCartera = await crearExcelCartera([
      { codigo: 'C021', mensualidadVieja: 5000, mensualidad2024: 5000 },
      { codigo: 'S03321', mensualidadVieja: 5000, mensualidad2024: 5000 }
    ]);
    const filePathDatos = await crearExcelDatos([]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.cuentas.length, 0);
    assert.equal(plan.huerfanosACrear.length, 2);
    assert.equal(plan.huerfanosACrear[0].codigo, 'C021');
    assert.equal(plan.huerfanosACrear[0].categoriaNombre, 'Finca');
    assert.equal(plan.huerfanosACrear[1].codigo, 'S03321');
    assert.equal(plan.huerfanosACrear[1].motivoSuspension, null);
    assert.deepEqual(plan.codigosPendientes, []);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('marca aperturasSinDato cuando la fuente es "ninguna" y la cuenta no aparece en candidatoSuspension', async () => {
  const ctx = crearDbTemporal();
  try {
    sembrarCuenta(ctx.dbService, 'X003');
    const filePathCartera = await crearExcelCartera([{ codigo: 'X003', mensualidadVieja: 5000, mensualidad2024: 10000 }]);   // sin saldo2020 ni saldoPagos2021
    const filePathDatos = await crearExcelDatos([]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.aperturasSinDato.length, 1);
    assert.equal(plan.aperturasSinDato[0].codigo, 'X003');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('categoriaNombre2024 SÍ cambia cuando mensualidadVieja y mensualidad2024 caen en categorías distintas', async () => {
  const ctx = crearDbTemporal();
  try {
    sembrarCuenta(ctx.dbService, 'X004');
    const filePathCartera = await crearExcelCartera([
      { codigo: 'X004', mensualidadVieja: 5000, mensualidad2024: 16000 }   // Finca -> Finca con piscina
    ]);
    const filePathDatos = await crearExcelDatos([]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.cuentas[0].categoriaNombre, 'Finca');
    assert.equal(plan.cuentas[0].categoriaNombre2024, 'Finca con piscina');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('un código que no está en la base, ni en equivalencias, ni en pendientes, ni en huérfanos conocidos se reporta sin romper nada', async () => {
  const ctx = crearDbTemporal();
  try {
    const filePathCartera = await crearExcelCartera([
      { codigo: 'Z999', mensualidadVieja: 5000, mensualidad2024: 5000 }
    ]);
    const filePathDatos = await crearExcelDatos([]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.cuentas.length, 0);
    assert.equal(plan.huerfanosACrear.length, 0);
    assert.deepEqual(plan.codigosPendientes, []);
    assert.equal(plan.aperturasSinDato.length, 1);
    assert.equal(plan.aperturasSinDato[0].codigo, 'Z999');
    assert.match(plan.aperturasSinDato[0].motivo, /no reconocido/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('si el Excel trae fila para R0081 Y para S058, la segunda no duplica la cuenta ni la apertura', async () => {
  const ctx = crearDbTemporal();
  try {
    sembrarCuenta(ctx.dbService, 'S058');
    const filePathCartera = await crearExcelCartera([
      { codigo: 'R0081', mensualidadVieja: 5000, mensualidad2024: 5000, saldoPagos2021: 500000 },
      { codigo: 'S058', mensualidadVieja: 5000, mensualidad2024: 5000, saldoPagos2021: 999000 }
    ]);
    const filePathDatos = await crearExcelDatos([]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.cuentas.length, 1, 'solo una entrada para S058, no dos');
    assert.equal(plan.cuentas[0].aperturaOpaca.monto, 500000, 'se queda con la primera fila resuelta, no la duplica');
    assert.equal(plan.aperturasSinDato.length, 1);
    assert.match(plan.aperturasSinDato[0].motivo, /duplicada/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('si el código de equivalencia no existe en la base, se reporta en vez de guardar cuentaId undefined', async () => {
  const ctx = crearDbTemporal();
  try {
    // No se siembra S058: el objetivo de la equivalencia no existe en la base.
    const filePathCartera = await crearExcelCartera([
      { codigo: 'R0081', mensualidadVieja: 5000, mensualidad2024: 5000 }
    ]);
    const filePathDatos = await crearExcelDatos([]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.cuentas.length, 0);
    assert.equal(plan.aperturasSinDato.length, 1);
    assert.equal(plan.aperturasSinDato[0].codigo, 'S058');
    assert.match(plan.aperturasSinDato[0].motivo, /no existe en la base/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('una mensualidad que no corresponde a ninguna categoría conocida se reporta, no rompe el plan', async () => {
  const ctx = crearDbTemporal();
  try {
    sembrarCuenta(ctx.dbService, 'X005');
    const filePathCartera = await crearExcelCartera([
      { codigo: 'X005', mensualidadVieja: 1, mensualidad2024: 1 }
    ]);
    const filePathDatos = await crearExcelDatos([]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.cuentas.length, 0);
    assert.equal(plan.aperturasSinDato.length, 1);
    assert.equal(plan.aperturasSinDato[0].codigo, 'X005');
    assert.match(plan.aperturasSinDato[0].motivo, /no corresponde a ninguna categoría/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('el TIPO/observación de Datos.xlsx se toma de la fila de la cuenta real, no del código crudo (alias) del Excel de cartera', async () => {
  const ctx = crearDbTemporal();
  try {
    sembrarCuenta(ctx.dbService, 'S058');
    const filePathCartera = await crearExcelCartera([{ codigo: 'R0081', mensualidadVieja: 5000, mensualidad2024: 5000 }]);
    // Datos.xlsx trae filas separadas para el alias (R0081) y la cuenta real (S058), con TIPO distinto.
    const filePathDatos = await crearExcelDatos([
      { codigo: 'R0081', tipo: 'COML' },
      { codigo: 'S058', tipo: 'CASA' }
    ]);

    const plan = await generarPlan({ filePathCartera, filePathDatos, dbService: ctx.dbService });
    assert.equal(plan.cuentas[0].codigo, 'S058');
    assert.equal(plan.cuentas[0].tipoDatosXlsx, 'CASA', 'debe tomar el TIPO de la fila de S058 (la cuenta real), no el de R0081');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
