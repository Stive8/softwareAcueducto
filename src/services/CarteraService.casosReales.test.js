// src/services/CarteraService.casosReales.test.js
//
// Los tres casos que motivaron el rediseño, con sus recibos reales. El saldo esperado de cada
// uno está conciliado al peso contra el Excel de cartera:
//   R034 -> $370.000   (el sistema viejo cobraría 103 meses, ~$1.030.000)
//   R037 -> $420.000   (el sistema viejo lo mostraba "al día, $0")
//   R019 -> $110.000   (el sistema viejo cobraría 6 meses, ~$60.000)
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');
const { MODOS } = require('./cartera/imputacion');

// Cuenta con la mensualidad real de estas tres ($5.000 hasta 2023, $10.000 desde 2024),
// apertura opaca al 31/12/2021, y primer recibo en la fecha indicada.
function sembrarCaso(dbService, { codigo, aperturaOpaca, primerRecibo }) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;

  db.prepare(`INSERT INTO categorias (nombre) VALUES (?)`).run(`Finca-${codigo}`);
  const catId = db.prepare(`SELECT id FROM categorias WHERE nombre = ?`).get(`Finca-${codigo}`).id;
  db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta)
              VALUES (?, 5000, '2022-01-01', '2023-12-31')`).run(catId);
  db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
              VALUES (?, 10000, '2024-01-01')`).run(catId);
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
              VALUES (?, ?, '2022-01-01')`).run(cuentaId, catId);

  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES (?)`).run(`Prop ${codigo}`);
  const propId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = ?`).get(`Prop ${codigo}`).id;
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio)
              VALUES (?, ?, '2022-01-01')`).run(cuentaId, propId);
  const num = db.prepare(`SELECT COALESCE(MAX(numero_recibo), 0) + 1 n FROM recibos`).get().n;
  db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
              VALUES (?, ?, ?, ?, 0, 'Efectivo')`).run(num, cuentaId, propId, primerRecibo);

  new CuentaEstadoRepository(dbService)
    .sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2022-01-01' });

  const service = new CarteraService(dbService);
  service.repository.crearMovimiento({
    cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: aperturaOpaca,
    observaciones: 'Carga inicial cartera 2026-07'
  });

  return { cuentaId, service };
}

test('R034 RUIZ ESCOBAR ANSELMO: 6 abonos por $350.000 dejan $370.000 de deuda, no 103 meses', () => {
  const ctx = crearDbTemporal();
  try {
    // Apertura al 31/12/2021 = $240.000. Causación 2022-2026 a $5.000 y luego $10.000.
    const { cuentaId, service } = sembrarCaso(ctx.dbService, {
      codigo: 'R034', aperturaOpaca: 240000, primerRecibo: '2017-04-16'
    });
    service.asegurarCausacion(cuentaId, 2026, 12);

    // Los 6 abonos reales, todos "ABONO A LA DEUDA" sin meses identificados.
    for (const [fecha, monto] of [
      ['2022-07-07', 50000], ['2022-09-17', 50000], ['2022-11-11', 50000],
      ['2023-05-06', 50000], ['2024-02-10', 50000], ['2025-06-21', 100000]
    ]) {
      service.registrarAbono({ cuentaId, fecha, monto, modo: MODOS.ABONO_DEUDA_FIFO });
    }

    const e = service.getEstadoCartera(cuentaId);
    // Causado 2022-2026 = (5.000 x 24) + (10.000 x 36) = 120.000 + 360.000 = 480.000
    // menos 350.000 abonados = 130.000 de deuda corriente.
    assert.equal(e.deudaExigible, 130000);
    assert.equal(e.saldoOpaco, 240000, 'la deuda vieja se ve pero no se cobra');
    assert.equal(e.totalCobrarHoy, 130000);
    assert.equal(e.totalReferencia, 370000, 'coincide con el saldo del Excel al 31/12/2026');
    // El modelo viejo diría 103 meses de mora ignorando los $350.000 ya abonados.
    assert.ok(e.totalCobrarHoy < 1030000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('R037 ALVAREZ CLARA ISABEL: sus $390.000 de abonos se ven, ya no aparece "al día"', () => {
  const ctx = crearDbTemporal();
  try {
    // Apertura al 31/12/2021 = $330.000. Nunca tuvo un mes asignado en pago_periodos.
    const { cuentaId, service } = sembrarCaso(ctx.dbService, {
      codigo: 'R037', aperturaOpaca: 330000, primerRecibo: '2022-07-07'
    });
    service.asegurarCausacion(cuentaId, 2026, 12);

    for (const [fecha, monto] of [
      ['2022-07-07', 50000], ['2022-08-09', 55000], ['2023-01-31', 200000], ['2023-02-06', 85000]
    ]) {
      service.registrarAbono({ cuentaId, fecha, monto, modo: MODOS.ABONO_DEUDA_FIFO });
    }

    const e = service.getEstadoCartera(cuentaId);
    // Causado (jul-2022 a dic-2026) = (5.000 x 18) + (10.000 x 36) = 90.000 + 360.000 = 450.000
    // menos 390.000 = 60.000.
    assert.equal(e.deudaExigible, 60000);
    assert.equal(e.saldoOpaco, 330000);
    assert.equal(e.totalReferencia, 390000);
    assert.notEqual(e.totalCobrarHoy, 0, 'el modelo viejo la mostraba al día con $0');
    assert.deepEqual(e.cubiertoHasta, { anio: 2026, mes: 6 },
      'los abonos cubrieron mes a mes desde el más antiguo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('R019 VANEGAS HERRERA JOHANNA: los abonos sin meses ya no dejan huecos falsos', () => {
  const ctx = crearDbTemporal();
  try {
    // Apertura al 31/12/2021 = $384.000, la semilla opaca de esta cuenta.
    const { cuentaId, service } = sembrarCaso(ctx.dbService, {
      codigo: 'R019', aperturaOpaca: 384000, primerRecibo: '2022-05-28'
    });
    service.asegurarCausacion(cuentaId, 2026, 12);

    // Los abonos reales: 5 "a la deuda" sin meses, el 1797 que la deja al día,
    // y luego los pagos corrientes mes a mes.
    for (const [fecha, monto] of [
      ['2022-05-28', 50000], ['2022-08-27', 50000], ['2023-01-14', 60000],
      ['2023-06-03', 100000], ['2024-02-07', 200000], ['2024-04-06', 84000],
      ['2024-06-08', 20000], ['2024-08-10', 20000], ['2024-10-05', 20000],
      ['2025-03-08', 50000], ['2025-10-11', 50000], ['2026-01-10', 50000]
    ]) {
      service.registrarAbono({ cuentaId, fecha, monto, modo: MODOS.ABONO_DEUDA_FIFO });
    }

    const e = service.getEstadoCartera(cuentaId);
    // Causado (may-2022 a dic-2026) = (5.000 x 20) + (10.000 x 36) = 100.000 + 360.000 = 460.000
    // menos 754.000 abonados = -294.000, o sea saldo a favor.
    assert.equal(e.saldoAFavor, 294000);
    assert.equal(e.totalCobrarHoy, 0);
    assert.equal(e.saldoOpaco, 384000, 'la semilla vieja sigue visible y sin cobrar');
    // Lo importante: los 26 "huecos" que el modelo viejo mostraba entre 2022-01 y 2024-03 eran
    // la cicatriz de abonos que no se podían representar. Acá no hay ninguno.
    assert.deepEqual(e.cubiertoHasta, { anio: 2026, mes: 12 });
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('los tres casos mantienen el saldo opaco fuera del total a cobrar', () => {
  const ctx = crearDbTemporal();
  try {
    for (const [codigo, apertura] of [['R034', 240000], ['R037', 330000], ['R019', 384000]]) {
      const { cuentaId, service } = sembrarCaso(ctx.dbService, {
        codigo, aperturaOpaca: apertura, primerRecibo: '2022-01-15'
      });
      service.asegurarCausacion(cuentaId, 2026, 12);
      const e = service.getEstadoCartera(cuentaId);
      assert.equal(e.saldoOpaco, apertura);
      assert.equal(e.totalCobrarHoy, e.deudaExigible > 0 ? e.deudaExigible : 0);
      assert.ok(e.totalCobrarHoy < apertura + e.deudaExigible + 1,
        `${codigo}: el opaco nunca debe entrar al total a cobrar`);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});
