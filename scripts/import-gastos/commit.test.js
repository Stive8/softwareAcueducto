// scripts/import-gastos/commit.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { stringifyCsv } = require('./csv');
const { COLUMNAS } = require('./preview');
const { ejecutarCommit } = require('./commit');

// Semilla: da saldo a Caja General para que los gastos en efectivo pasen la validación de saldo.
function darSaldoCaja(dbService, monto) {
  const db = dbService.getDb();
  const caja = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo='110505'`).get();
  const cap = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo='3105'`).get();
  const asiento = db.prepare(`INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen) VALUES (9500,'2025-12-31','Saldo inicial','Manual')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2025-12-31', ?, ?, 0, 'ini', ?)`).run(caja.id, monto, asiento);
  db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2025-12-31', ?, 0, ?, 'ini', ?)`).run(cap.id, monto, asiento);
}

function csvConUnaFila(outDir, hoja) {
  const fila = {
    fila_excel: 8, hoja, accion: 'IMPORTAR', fecha: '2026-01-15', tercero_modo: 'nuevo',
    tercero_id: '', tercero_tipo_id: 'NIT', tercero_numero_id: '80765236', tercero_nombre: 'DGV SUMINISTROS',
    tipo_gasto: 'Accesorios y Materiales', confianza: 'media', valor: 48000,
    concepto: 'SILLA SANI 4*3', observaciones: '',
  };
  const csvPath = path.join(outDir, `${hoja}-preview.csv`);
  fs.writeFileSync(csvPath, stringifyCsv(COLUMNAS, [fila]), 'utf8');
  return csvPath;
}

test('ejecutarCommit crea el gasto, su tercero y su asiento contable', () => {
  const ctx = crearDbTemporal();
  try {
    darSaldoCaja(ctx.dbService, 1000000);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const csvPath = csvConUnaFila(outDir, '2026');

    const r = ejecutarCommit({ csvPath, dbService: ctx.dbService });
    assert.equal(r.insertadas, 1);

    const db = ctx.dbService.getDb();
    const gasto = db.prepare(`SELECT * FROM gastos WHERE concepto = 'SILLA SANI 4*3'`).get();
    assert.ok(gasto);
    assert.match(gasto.observaciones, /\[import:2026#8\]/);
    const tercero = db.prepare(`SELECT * FROM terceros WHERE numero_identificacion = '80765236'`).get();
    assert.ok(tercero);
    const asiento = db.prepare(`SELECT COUNT(*) n FROM asientos_contables WHERE referencia_tipo='Gasto' AND referencia_id=?`).get(gasto.id);
    assert.equal(asiento.n, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('re-ejecutar el mismo CSV es idempotente (no duplica)', () => {
  const ctx = crearDbTemporal();
  try {
    darSaldoCaja(ctx.dbService, 1000000);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const csvPath = csvConUnaFila(outDir, '2026');

    ejecutarCommit({ csvPath, dbService: ctx.dbService });
    const r2 = ejecutarCommit({ csvPath, dbService: ctx.dbService });
    assert.equal(r2.insertadas, 0);
    assert.equal(r2.yaImportadas, 1);

    const n = ctx.dbService.getDb().prepare(`SELECT COUNT(*) n FROM gastos WHERE concepto='SILLA SANI 4*3'`).get().n;
    assert.equal(n, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('ejecutarCommit registra la auditoría del gasto insertado', () => {
  const ctx = crearDbTemporal();
  try {
    darSaldoCaja(ctx.dbService, 1000000);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const csvPath = csvConUnaFila(outDir, '2026');

    const r = ejecutarCommit({ csvPath, dbService: ctx.dbService });
    assert.equal(r.insertadas, 1);

    const auditorias = ctx.dbService.getDb().prepare(`SELECT * FROM auditoria WHERE tabla = 'gastos'`).all();
    assert.ok(auditorias.length >= 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('una fila inválida no aborta el lote: se aísla como error y las demás se insertan', () => {
  const ctx = crearDbTemporal();
  try {
    darSaldoCaja(ctx.dbService, 1000000);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const filaValida = {
      fila_excel: 8, hoja: '2026', accion: 'IMPORTAR', fecha: '2026-01-15', tercero_modo: 'nuevo',
      tercero_id: '', tercero_tipo_id: 'NIT', tercero_numero_id: '80765236', tercero_nombre: 'DGV SUMINISTROS',
      tipo_gasto: 'Accesorios y Materiales', confianza: 'media', valor: 48000,
      concepto: 'SILLA SANI 4*3', observaciones: '',
    };
    const filaInvalida = {
      fila_excel: 9, hoja: '2026', accion: 'IMPORTAR', fecha: '2026-01-16', tercero_modo: 'nuevo',
      tercero_id: '', tercero_tipo_id: 'NIT', tercero_numero_id: '80765237', tercero_nombre: 'OTRO PROVEEDOR',
      tipo_gasto: 'TipoInexistente', confianza: 'media', valor: 30000,
      concepto: 'GASTO CON TIPO INVALIDO', observaciones: '',
    };
    const csvPath = path.join(outDir, `2026-preview.csv`);
    fs.writeFileSync(csvPath, stringifyCsv(COLUMNAS, [filaValida, filaInvalida]), 'utf8');

    const r = ejecutarCommit({ csvPath, dbService: ctx.dbService });
    assert.equal(r.insertadas, 1);
    assert.equal(r.errores, 1);

    const n = ctx.dbService.getDb().prepare(`SELECT COUNT(*) n FROM gastos`).get().n;
    assert.equal(n, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('preflight aborta ANTES de escribir cuando la suma supera el saldo de Caja General', () => {
  const ctx = crearDbTemporal();
  try {
    darSaldoCaja(ctx.dbService, 10000);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const fila = {
      fila_excel: 8, hoja: '2026', accion: 'IMPORTAR', fecha: '2026-01-15', tercero_modo: 'nuevo',
      tercero_id: '', tercero_tipo_id: 'NIT', tercero_numero_id: '80765236', tercero_nombre: 'DGV SUMINISTROS',
      tipo_gasto: 'Accesorios y Materiales', confianza: 'media', valor: 50000,
      concepto: 'SILLA SANI 4*3', observaciones: '',
    };
    const csvPath = path.join(outDir, `2026-preview.csv`);
    fs.writeFileSync(csvPath, stringifyCsv(COLUMNAS, [fila]), 'utf8');

    assert.throws(() => ejecutarCommit({ csvPath, dbService: ctx.dbService }));

    const n = ctx.dbService.getDb().prepare(`SELECT COUNT(*) n FROM gastos`).get().n;
    assert.equal(n, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
