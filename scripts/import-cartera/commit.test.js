// scripts/import-cartera/commit.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { ejecutarCommit } = require('./commit');
const CarteraService = require('../../src/services/CarteraService');

async function crearFixtures() {
  const wbCartera = new ExcelJS.Workbook();
  const mov = wbCartera.addWorksheet('estado cta con movimiento');
  mov.addRow([]); mov.addRow([]);
  mov.getRow(3).getCell(1).value = 'R034';
  mov.getRow(3).getCell(7).value = 240000;   // Saldo Mes -> apertura opaca resuelta vía VLOOKUP

  const est = wbCartera.addWorksheet('ESTADO DE CUENTA ASOCIADOS');
  const fila = (r, valores) => { for (const [c, v] of Object.entries(valores)) est.getRow(r).getCell(Number(c)).value = v; };
  fila(2, { 4: 'R034', 5: 'RUIZ ESCOBAR ANSELMO', 7: 5000, 26: 10000, 33: 370000 });
  est.getRow(2).getCell(15).value = { formula: 'VLOOKUP(...)' };   // sin resultado -> cae a la hoja fuente
  fila(3, { 4: 'R002', 5: 'ALGUIEN', 7: 5000, 26: 5000 });   // se suspende por Datos.xlsx

  const filePathCartera = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-cartera-')), 'c.xlsx');
  await wbCartera.xlsx.writeFile(filePathCartera);

  const wbDatos = new ExcelJS.Workbook();
  const hoja1 = wbDatos.addWorksheet('Hoja1');
  hoja1.getRow(2).getCell(1).value = 'R034';
  hoja1.getRow(2).getCell(10).value = 'CASA';
  hoja1.getRow(3).getCell(1).value = 'R002';
  hoja1.getRow(3).getCell(12).value = 'SUSPENDIDO (NO EXISTE)';

  const filePathDatos = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-datos-')), 'd.xlsx');
  await wbDatos.xlsx.writeFile(filePathDatos);

  return { filePathCartera, filePathDatos };
}

function sembrarCuentaConRecibos(dbService, codigo, recibos) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES (?)`).run(`Prop ${codigo}`);
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = ?`).get(`Prop ${codigo}`).id;
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2022-01-01')`).run(cuentaId, propietarioId);

  for (const r of recibos) {
    db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
                VALUES (?, ?, ?, ?, ?, 'Efectivo')`).run(r.numero, cuentaId, propietarioId, r.fecha, r.valor);
    const reciboId = db.prepare(`SELECT id FROM recibos WHERE numero_recibo = ?`).get(r.numero).id;
    db.prepare(`INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, ?, ?)`).run(reciboId, r.concepto || 'CUOTA DE SOSTENIMIENTO', r.valor);
  }
  return cuentaId;
}

test('el pipeline completo carga categoría, apertura, causación y abonos, y concilia contra el Excel', async () => {
  const ctx = crearDbTemporal();
  try {
    const { filePathCartera, filePathDatos } = await crearFixtures();
    const cuentaId = sembrarCuentaConRecibos(ctx.dbService, 'R034', [
      { numero: 1, fecha: '2022-01-15', valor: 5000 },
      { numero: 2, fecha: '2022-07-07', valor: 50000, concepto: 'ABONO A LA DEUDA' },
      { numero: 3, fecha: '2022-09-17', valor: 50000, concepto: 'ABONO A LA DEUDA' },
      { numero: 4, fecha: '2022-11-11', valor: 50000, concepto: 'ABONO A LA DEUDA' },
      { numero: 5, fecha: '2023-05-06', valor: 50000, concepto: 'ABONO A LA DEUDA' },
      { numero: 6, fecha: '2024-02-10', valor: 50000, concepto: 'ABONO A LA DEUDA' },
      { numero: 7, fecha: '2025-06-21', valor: 100000, concepto: 'ABONO A DEUDA PENDIENTE' }
    ]);
    // R002: se siembra para ejercitar la suspensión y verificar que no se compara (sin saldoReferencia2025).
    // El recibo antiguo (2018) no participa en este test; la cobertura de piso de fecha vive en aplicar-causacion-abonos.test.js.
    const cuentaIdR002 = sembrarCuentaConRecibos(ctx.dbService, 'R002', [{ numero: 8, fecha: '2018-06-10', valor: 5000 }]);

    const r = await ejecutarCommit({
      filePathCartera, filePathDatos, dbService: ctx.dbService, usuarioId: 1,
      hastaAnio: 2025, hastaMes: 12
    });

    assert.equal(r.aplicarBase.categoriasAsignadas, 2);
    assert.equal(r.aplicarBase.cuentasSuspendidas, 1, 'R002');

    const carteraService = new CarteraService(ctx.dbService);
    const estado = carteraService.getEstadoCartera(cuentaId);
    assert.equal(estado.saldoOpaco, 240000);
    // Causado ene-2022 a dic-2025 = (5.000 x 24) + (10.000 x 24) = 360.000, menos 355.000 abonados = 5.000.
    assert.equal(estado.deudaExigible, 5000);
    assert.equal(estado.totalReferencia, 245000);

    assert.equal(r.conciliacion.comparadas, 1, 'solo R034 trae saldoReferencia2025 comparable (370.000, ver nota abajo)');
    // Nota: el fixture puso 370.000 como referencia pero el cálculo real hasta dic-2025 da
    // 250.000 -- la referencia del Excel real es "a 31/12/2026", no 31/12/2025; este test
    // fija la expectativa en 370.000 para ejercitar conciliar() reportando la diferencia,
    // no para afirmar que coincide. Ver el assert siguiente.
    assert.equal(r.conciliacion.difieren.length, 1);
    assert.equal(r.conciliacion.difieren[0].codigo, 'R034');

    // Verificar que R002 suspendida no causa cargos.
    const estadoR002 = carteraService.getEstadoCartera(cuentaIdR002);
    assert.equal(estadoR002.deudaExigible, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('una cuenta que falla no aborta el resto del pipeline: se reporta en fallos y las demás se procesan igual', async () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();

    const wbCartera = new ExcelJS.Workbook();
    wbCartera.addWorksheet('estado cta con movimiento').addRow([]);
    const est = wbCartera.addWorksheet('ESTADO DE CUENTA ASOCIADOS');
    const fila = (r, valores) => { for (const [c, v] of Object.entries(valores)) est.getRow(r).getCell(Number(c)).value = v; };
    fila(2, { 4: 'R034', 7: 5000, 26: 10000 });
    fila(3, { 4: 'R037', 7: 5000, 26: 10000 });
    const filePathCartera = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-cartera-fallo-')), 'c.xlsx');
    await wbCartera.xlsx.writeFile(filePathCartera);

    const wbDatos = new ExcelJS.Workbook();
    wbDatos.addWorksheet('Hoja1').addRow([]);
    const filePathDatos = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-datos-fallo-')), 'd.xlsx');
    await wbDatos.xlsx.writeFile(filePathDatos);

    const cuentaIdOk = sembrarCuentaConRecibos(ctx.dbService, 'R034', [{ numero: 1, fecha: '2022-01-15', valor: 5000 }]);
    const cuentaIdFalla = sembrarCuentaConRecibos(ctx.dbService, 'R037', [{ numero: 2, fecha: '2022-01-20', valor: 5000 }]);

    // Corrompe el valor del detalle de R037: la columna es REAL pero SQLite guarda el texto tal
    // cual, y `valor > 0` da true para texto -- así que el detalle pasa el filtro de cargarAbonos
    // y revienta recién en registrarAbono ("El monto del abono debe ser mayor a cero").
    db.prepare(`UPDATE recibo_detalles SET valor = 'CORRUPTO'
                WHERE recibo_id = (SELECT id FROM recibos WHERE numero_recibo = 2)`).run();

    const r = await ejecutarCommit({
      filePathCartera, filePathDatos, dbService: ctx.dbService, usuarioId: 1,
      hastaAnio: 2022, hastaMes: 3
    });

    assert.equal(r.causacion.fallos.length, 1);
    assert.equal(r.causacion.fallos[0].codigo, 'R037');
    assert.equal(r.causacion.fallos[0].cuentaId, cuentaIdFalla);
    assert.match(r.causacion.fallos[0].error, /monto del abono/);

    assert.equal(r.causacion.cuentasProcesadas, 1, 'solo R034; R037 falló y no cuenta como procesada');
    assert.equal(r.causacion.cargosCreados, 3, 'los 3 cargos de R034: el fallo de R037 no cortó el loop');

    const carteraService = new CarteraService(ctx.dbService);
    assert.equal(carteraService.getEstadoCartera(cuentaIdOk).deudaExigible, 10000, '15.000 causados - 5.000 abonados');
    // La transacción por cuenta hizo rollback de lo suyo: R037 no quedó a medio causar.
    const movimientosFalla = db.prepare(`SELECT COUNT(*) AS n FROM cartera_movimientos WHERE cuenta_id = ? AND tipo != 'AperturaOpaca'`).get(cuentaIdFalla).n;
    assert.equal(movimientosFalla, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
