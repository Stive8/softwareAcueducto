// src/services/PagoService.abonoDeudaAnteriorEnAporte.test.js
//
// "Registrar Aporte" ya sabía combinar sostenimiento + abono a conexión en un mismo recibo
// (abonoConexion). Esto agrega un tercer concepto opcional al mismo mecanismo: abonar la deuda
// anterior al corte (2024) en el MISMO recibo que los meses corrientes -- caso real: alguien
// paga una sola colilla que cubre deuda vieja y meses nuevos de una vez, y antes de esto había
// que partirla en dos recibos (uno por registrarAbonoDeudaAnterior, otro por
// registrarPagoSostenimiento) para reflejar lo mismo que la colilja física paga junta.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const PagoService = require('./PagoService');
const CarteraService = require('./CarteraService');

function sembrarCuentaConDeudaAnteriorYMesesPagables(db, dbService, { codigo = 'T001', tarifa = 10000, saldoOpaco = 50000 } = {}) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;

  const propietarioId = db.prepare(
    `INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test')`
  ).run().lastInsertRowid;
  db.prepare(
    `INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2022-01-01')`
  ).run(cuentaId, propietarioId);

  const categoriaId = db.prepare(`INSERT INTO categorias (nombre) VALUES ('Finca Test')`).run().lastInsertRowid;
  db.prepare(
    `INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde) VALUES (?, ?, '2022-01-01')`
  ).run(categoriaId, tarifa);
  db.prepare(
    `INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2022-01-01')`
  ).run(cuentaId, categoriaId);

  const carteraService = new CarteraService(dbService);
  carteraService.repository.crearMovimiento({
    cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: saldoOpaco
  });

  return cuentaId;
}

test('registrarPagoSostenimiento con abonoDeudaAnterior genera UN solo recibo que cubre meses corrientes y deuda anterior', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaConDeudaAnteriorYMesesPagables(db, ctx.dbService, { tarifa: 10000, saldoOpaco: 50000 });
    const pagoService = new PagoService(ctx.dbService);
    const carteraService = new CarteraService(ctx.dbService);

    const r = pagoService.registrarPagoSostenimiento({
      cuentaId, anioInicio: 2024, mesInicio: 1, cantidadMeses: 3,
      fechaPago: '2026-04-01', metodoPago: 'Efectivo', abonoDeudaAnterior: 20000
    });

    assert.equal(r.total, 50000, '30.000 de 3 meses + 20.000 de abono a deuda anterior');
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM recibos WHERE cuenta_id = ?`).get(cuentaId).n, 1,
      'debe quedar un solo recibo, no dos');

    const estado = carteraService.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaAntes2024, 30000, '50.000 - 20.000 abonados');
    assert.equal(estado.deudaExigible, 0, 'los 3 meses quedan cubiertos');

    const detalles = db.prepare(
      `SELECT concepto, valor FROM recibo_detalles WHERE recibo_id = ? ORDER BY id`
    ).all(r.reciboId);
    const detalleDeudaAnterior = detalles.find(d => d.concepto === 'Abono a deuda anterior al corte (2024)');
    assert.ok(detalleDeudaAnterior, 'debe existir una línea de detalle para el abono a deuda anterior');
    assert.equal(detalleDeudaAnterior.valor, 20000);

    const movimientoCaja = db.prepare(
      `SELECT monto FROM movimientos WHERE referencia_id = ? AND referencia_tipo = 'Recibo'`
    ).get(r.reciboId);
    assert.equal(movimientoCaja.monto, 50000, 'un solo movimiento de caja por el total combinado');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarPagoSostenimiento rechaza un abonoDeudaAnterior mayor a la deuda anterior disponible', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaConDeudaAnteriorYMesesPagables(db, ctx.dbService, { tarifa: 10000, saldoOpaco: 10000 });
    const pagoService = new PagoService(ctx.dbService);

    assert.throws(
      () => pagoService.registrarPagoSostenimiento({
        cuentaId, anioInicio: 2024, mesInicio: 1, cantidadMeses: 1,
        fechaPago: '2026-04-01', metodoPago: 'Efectivo', abonoDeudaAnterior: 15000
      }),
      /no puede exceder/
    );

    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM recibos WHERE cuenta_id = ?`).get(cuentaId).n, 0,
      'no debe quedar ningún recibo si la validación falla');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarPagoSostenimiento rechaza abonoDeudaAnterior si la cuenta no tiene deuda anterior al corte', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaConDeudaAnteriorYMesesPagables(db, ctx.dbService, { tarifa: 10000, saldoOpaco: 0 });
    const pagoService = new PagoService(ctx.dbService);

    assert.throws(
      () => pagoService.registrarPagoSostenimiento({
        cuentaId, anioInicio: 2024, mesInicio: 1, cantidadMeses: 1,
        fechaPago: '2026-04-01', metodoPago: 'Efectivo', abonoDeudaAnterior: 5000
      }),
      /no tiene deuda anterior al corte/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
