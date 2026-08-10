// src/services/PagoService.cartera.test.js
//
// Primeros tests de PagoService (no tenía ninguno). Acotados a la integración con el motor de
// cartera nuevo -- no cubren el resto de registrarPagoSostenimiento (eso es trabajo aparte,
// fuera de este plan).
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const PagoService = require('./PagoService');
const CarteraService = require('./CarteraService');

function sembrarCuentaPagable(db, { codigo = 'T001', tarifa = 10000, fechaCategoria = '2026-01-01' } = {}) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;

  const propietarioId = db.prepare(
    `INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test')`
  ).run().lastInsertRowid;
  db.prepare(
    `INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, ?)`
  ).run(cuentaId, propietarioId, fechaCategoria);

  const categoriaId = db.prepare(
    `INSERT INTO categorias (nombre) VALUES ('Finca Test')`
  ).run().lastInsertRowid;
  db.prepare(
    `INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde) VALUES (?, ?, ?)`
  ).run(categoriaId, tarifa, fechaCategoria);
  db.prepare(
    `INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, ?)`
  ).run(cuentaId, categoriaId, fechaCategoria);

  return cuentaId;
}

test('registrarPagoSostenimiento en efectivo causa y abona los mismos meses en cartera_movimientos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000 });
    const pagoService = new PagoService(ctx.dbService);
    const carteraService = new CarteraService(ctx.dbService);

    const r = pagoService.registrarPagoSostenimiento({
      cuentaId, anioInicio: 2026, mesInicio: 1, cantidadMeses: 3,
      fechaPago: '2026-04-01', metodoPago: 'Efectivo', usarSaldoAFavor: false
    });

    assert.equal(r.total, 30000);

    const estado = carteraService.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaExigible, 0, 'los 3 meses quedan cubiertos en el motor nuevo también');
    assert.deepEqual(estado.cubiertoHasta, { anio: 2026, mes: 3 });

    const cargos = db.prepare(
      `SELECT anio, mes, monto FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'CargoMensual' ORDER BY mes`
    ).all(cuentaId);
    assert.equal(cargos.length, 3);
    assert.ok(cargos.every(c => c.monto === 10000));

    const abono = db.prepare(
      `SELECT monto, recibo_detalle_id FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'Abono'`
    ).get(cuentaId);
    assert.equal(abono.monto, -30000);
    assert.ok(abono.recibo_detalle_id, 'debe quedar atado al recibo_detalle del recibo viejo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarPagoSostenimiento no toca pago_periodos ni cuenta_creditos si el motor de cartera falla', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    // Tarifa vigente SOLO desde marzo -- construirPeriodos (el viejo) igual la usaría para
    // enero/febrero porque busca "la más reciente <= ese mes", así que esto no basta para
    // reproducir un desacuerdo real entre los dos validadores hoy; se deja como regresión de
    // atomicidad: si asegurarCausacion llegara a fallar por cualquier motivo futuro, nada del
    // recibo viejo debe quedar escrito.
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000, fechaCategoria: '2026-01-01' });
    const pagoService = new PagoService(ctx.dbService);

    // Fuerza el fallo: deja la cuenta Suspendida en cuenta_estados desde antes del período pagado
    // -- asegurarCausacion la respeta, construirPeriodos (viejo) no la conoce en absoluto.
    db.prepare(`
      INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio) VALUES (?, 'Suspendido', '2025-01-01')
    `).run(cuentaId);

    assert.throws(
      () => pagoService.registrarPagoSostenimiento({
        cuentaId, anioInicio: 2026, mesInicio: 1, cantidadMeses: 1,
        fechaPago: '2026-04-01', metodoPago: 'Efectivo', usarSaldoAFavor: false
      }),
      /motor de cartera/
    );

    assert.equal(db.prepare(`SELECT COUNT(*) n FROM recibos`).get().n, 0, 'la transacción completa debe revertir');
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM pago_periodos`).get().n, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarPagoSostenimiento con saldo a favor aplica esa porción también en cartera_movimientos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000 });
    const pagoService = new PagoService(ctx.dbService);
    const carteraService = new CarteraService(ctx.dbService);

    // Deja 15.000 de saldo a favor en cuenta_creditos -- misma tabla que usa PagoRepository.getSaldoCredito.
    db.prepare(
      `INSERT INTO cuenta_creditos (cuenta_id, tipo, monto, fecha) VALUES (?, 'Abono', 15000, '2026-01-01')`
    ).run(cuentaId);

    const r = pagoService.registrarPagoSostenimiento({
      cuentaId, anioInicio: 2026, mesInicio: 1, cantidadMeses: 2,
      fechaPago: '2026-04-01', metodoPago: 'Efectivo', usarSaldoAFavor: true
    });

    assert.equal(r.creditoAplicado, 15000);
    assert.equal(r.total, 5000, '20.000 de sostenimiento menos 15.000 de crédito');

    const estado = carteraService.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaExigible, 0, 'los 2 meses quedan cubiertos: 5.000 en efectivo + 15.000 de crédito');
    assert.equal(estado.saldoCreditoDisponible, 0);

    const abonos = db.prepare(
      `SELECT monto FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'Abono' ORDER BY id`
    ).all(cuentaId);
    assert.equal(abonos.length, 2, 'un Abono por la porción en efectivo y otro por la porción de crédito');
    assert.deepEqual(abonos.map(a => a.monto).sort((a, b) => a - b), [-15000, -5000]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
