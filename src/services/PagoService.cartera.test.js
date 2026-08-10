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
const { MODOS } = require('./cartera/imputacion');

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

test('registrarPagoSostenimiento lanza si la porción de crédito no puede imputarse completa contra los cargos elegidos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000 });
    const carteraService = new CarteraService(ctx.dbService);
    const pagoService = new PagoService(ctx.dbService);

    // Siembra directo en el motor nuevo los 2 cargos que este recibo va a pedir (mismo patrón
    // que CarteraService.aplicarCredito.test.js) y deja el primero ya parcialmente pagado
    // (3.000) por fuera de este recibo -- así cargosDeEstePago tiene menos pendiente real
    // (17.000) que lo que el modelo viejo va a creer que vale el subtotal (20.000).
    const cargo1 = carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1
    });
    carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2026-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 2
    });
    carteraService.registrarAbono({
      cuentaId, fecha: '2026-02-15', monto: 3000,
      modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargo1]
    });

    // 15.000 de saldo a favor: junto con los 5.000 en efectivo (20.000 subtotal del modelo
    // viejo - 15.000 crédito) suman el subtotal completo. La porción en efectivo (5.000) se
    // imputa completa contra los 17.000 reales pendientes, dejando 12.000 -- el crédito
    // (15.000) sobra 3.000 sin poder aplicarse.
    db.prepare(
      `INSERT INTO cuenta_creditos (cuenta_id, tipo, monto, fecha) VALUES (?, 'Abono', 15000, '2026-01-01')`
    ).run(cuentaId);

    assert.throws(
      () => pagoService.registrarPagoSostenimiento({
        cuentaId, anioInicio: 2026, mesInicio: 1, cantidadMeses: 2,
        fechaPago: '2026-04-01', metodoPago: 'Efectivo', usarSaldoAFavor: true
      }),
      /porción de saldo a favor/
    );

    assert.equal(db.prepare(`SELECT COUNT(*) n FROM recibos`).get().n, 0, 'la transacción completa debe revertir, igual que con el sobrante en efectivo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarPagoSostenimiento NO aplica el saldo a favor por defecto (usarSaldoAFavor sin especificar)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000 });
    const pagoService = new PagoService(ctx.dbService);

    db.prepare(
      `INSERT INTO cuenta_creditos (cuenta_id, tipo, monto, fecha) VALUES (?, 'Abono', 15000, '2026-01-01')`
    ).run(cuentaId);

    // Sin usarSaldoAFavor: el default (2026-08-09) es false -- nadie pidió aplicar el crédito.
    const r = pagoService.registrarPagoSostenimiento({
      cuentaId, anioInicio: 2026, mesInicio: 1, cantidadMeses: 2,
      fechaPago: '2026-04-01', metodoPago: 'Efectivo'
    });

    assert.equal(r.creditoAplicado, 0, 'el crédito no se toca si nadie lo pidió explícitamente');
    assert.equal(r.total, 20000, 'se cobra el subtotal completo, no se descuenta el saldo a favor solo');
    assert.equal(
      db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='Abono' THEN monto ELSE -monto END),0) s FROM cuenta_creditos WHERE cuenta_id=?`).get(cuentaId).s,
      15000,
      'el saldo a favor queda intacto'
    );

    const abonosCartera = db.prepare(`SELECT monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='Abono'`).all(cuentaId);
    assert.equal(abonosCartera.length, 1, 'solo el abono en efectivo, ninguno por crédito');
    assert.equal(abonosCartera[0].monto, -20000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('simularPago no cuenta el saldo a favor en el total por defecto, pero lo informa aparte', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000 });
    const pagoService = new PagoService(ctx.dbService);

    db.prepare(
      `INSERT INTO cuenta_creditos (cuenta_id, tipo, monto, fecha) VALUES (?, 'Abono', 15000, '2026-01-01')`
    ).run(cuentaId);

    const sinUsar = pagoService.simularPago(cuentaId, 2026, 1, 2);
    assert.equal(sinUsar.creditoAplicado, 0);
    assert.equal(sinUsar.totalACobrar, 20000);
    assert.equal(sinUsar.saldoAFavorDisponible, 15000, 'se informa aunque no se use');

    const conUsar = pagoService.simularPago(cuentaId, 2026, 1, 2, true);
    assert.equal(conUsar.creditoAplicado, 15000);
    assert.equal(conUsar.totalACobrar, 5000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCuenta calcula siguientePeriodo desde cartera_movimientos, no desde pago_periodos (reproduce el caso real de R001)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000 });
    const carteraService = new CarteraService(ctx.dbService);
    const pagoService = new PagoService(ctx.dbService);

    // Simula un recibo de carga inicial causado directo en cartera, SIN fila en pago_periodos
    // (el hueco real que dejó a R001 y otras 57 cuentas con "próximo período" desactualizado).
    const c1 = carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1
    });
    const c2 = carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2026-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 2
    });
    const c3 = carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2026-03-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 3
    });
    carteraService.registrarAbono({
      cuentaId, fecha: '2026-03-15', monto: 30000,
      modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [c1, c2, c3]
    });
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM pago_periodos`).get().n, 0, 'precondición: sin filas en el modelo viejo');

    const estado = pagoService.getEstadoCuenta(cuentaId);
    assert.deepEqual(estado.pagadoHasta, { anio: 2026, mes: 3, label: 'Marzo 2026' });
    assert.deepEqual(estado.siguientePeriodo, { anio: 2026, mes: 4, label: 'Abril 2026' });

    // El guardián de registrarPagoSostenimiento ya no rechaza abril: cartera lo ve pendiente,
    // igual que el modelo viejo ahora que siguientePeriodo dejó de estar desfasado.
    const r = pagoService.registrarPagoSostenimiento({
      cuentaId, anioInicio: 2026, mesInicio: 4, cantidadMeses: 1,
      fechaPago: '2026-04-20', metodoPago: 'Efectivo', usarSaldoAFavor: false
    });
    assert.equal(r.total, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCuenta sigue reportando el período correcto para un pago registrado normalmente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000 });
    const pagoService = new PagoService(ctx.dbService);

    pagoService.registrarPagoSostenimiento({
      cuentaId, anioInicio: 2026, mesInicio: 1, cantidadMeses: 2,
      fechaPago: '2026-04-01', metodoPago: 'Efectivo', usarSaldoAFavor: false
    });

    const estado = pagoService.getEstadoCuenta(cuentaId);
    assert.deepEqual(estado.pagadoHasta, { anio: 2026, mes: 2, label: 'Febrero 2026' });
    assert.deepEqual(estado.siguientePeriodo, { anio: 2026, mes: 3, label: 'Marzo 2026' });
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCuenta usa la cadena de CarteraService.getFechaInicioFacturacion en el fallback, no la de PagoRepository (regresión del bug de S050)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    // fechaCategoria muy vieja (como S050 real): si el fallback usara por error
    // PagoRepository.getFechaInicioFacturacion (MIN fecha_inicio de cuenta_categorias), daría
    // un resultado bien distinto al de CarteraService.getFechaInicioFacturacion, que sin
    // CargoMensual ni pago_periodos cae al primer recibo no anulado.
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000, fechaCategoria: '2018-01-01' });
    const propietarioId = db.prepare(`SELECT propietario_id FROM cuenta_propietarios WHERE cuenta_id = ?`).get(cuentaId).propietario_id;
    db.prepare(`
      INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago, estado)
      VALUES (9001, ?, ?, '2024-05-01', 0, 'Efectivo', 'Activo')
    `).run(cuentaId, propietarioId);
    const pagoService = new PagoService(ctx.dbService);

    const estado = pagoService.getEstadoCuenta(cuentaId);
    assert.deepEqual(estado.siguientePeriodo, { anio: 2024, mes: 5, label: 'Mayo 2024' },
      'debe caer al primer recibo (cadena de CarteraService), no a cuenta_categorias.fecha_inicio (cadena de PagoRepository)');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCuenta ignora un hueco histórico ya superado (reproduce el caso real de S050)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000, fechaCategoria: '2024-01-01' });
    const carteraService = new CarteraService(ctx.dbService);
    const pagoService = new PagoService(ctx.dbService);

    // Dos huecos reales en 2024 (nunca se les imputó nada) y todo lo demás pagado sin huecos
    // hasta julio de 2026 -- mismo patrón que el caso real de S050.
    const cargoId = {};
    for (const [anio, mes] of [[2024, 1], [2024, 2], [2024, 3], [2024, 4], [2026, 7]]) {
      cargoId[`${anio}-${mes}`] = carteraService.repository.crearMovimiento({
        cuentaId, fecha: `${anio}-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual',
        exigible: 1, monto: 10000, anio, mes
      });
    }
    carteraService.registrarAbono({ cuentaId, fecha: '2024-02-15', monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargoId['2024-2']] });
    carteraService.registrarAbono({ cuentaId, fecha: '2024-04-15', monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargoId['2024-4']] });
    carteraService.registrarAbono({ cuentaId, fecha: '2026-07-15', monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargoId['2026-7']] });
    // 2024-1 y 2024-3 quedan sin cubrir a propósito.

    const estado = pagoService.getEstadoCuenta(cuentaId);
    assert.deepEqual(estado.pagadoHasta, { anio: 2026, mes: 7, label: 'Julio 2026' }, 'no se frena en el hueco de 2024');
    assert.deepEqual(estado.siguientePeriodo, { anio: 2026, mes: 8, label: 'Agosto 2026' });

    // Los huecos de 2024 siguen contando como deuda real en el modelo nuevo -- sin cambios.
    assert.equal(carteraService.getEstadoCartera(cuentaId).deudaExigible, 20000, 'los 20.000 de 2024 (enero+marzo) siguen debiéndose');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCuenta sugiere el próximo mes real cuando hay un pago anticipado que la causación todavía no alcanzó (reproduce el caso real de R103)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000, fechaCategoria: '2026-01-01' });
    const carteraService = new CarteraService(ctx.dbService);
    const pagoService = new PagoService(ctx.dbService);

    for (let mes = 1; mes <= 7; mes++) {
      const cargoId = carteraService.repository.crearMovimiento({
        cuentaId, fecha: `2026-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual',
        exigible: 1, monto: 10000, anio: 2026, mes
      });
      carteraService.registrarAbono({
        cuentaId, fecha: `2026-${String(mes).padStart(2, '0')}-15`, monto: 10000,
        modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargoId]
      });
    }
    // Pago anticipado real (agosto-diciembre) que la carga inicial dejó como saldo a favor
    // porque esos meses todavía no estaban causados -- mismo patrón verificado en R103.
    db.prepare(
      `INSERT INTO cuenta_creditos (cuenta_id, tipo, monto, fecha, observaciones) VALUES (?, 'Abono', 50000, '2026-01-31', 'Sobrante de imputación: crédito no aplicado')`
    ).run(cuentaId);

    const estado = pagoService.getEstadoCuenta(cuentaId);
    assert.deepEqual(estado.siguientePeriodo, { anio: 2026, mes: 8, label: 'Agosto 2026' });
    assert.equal(estado.saldoAFavor, 50000, 'el pago anticipado sigue disponible como crédito, no se pierde');

    // asegurarCausacion crea agosto al registrar -- no debe lanzar.
    const r = pagoService.registrarPagoSostenimiento({
      cuentaId, anioInicio: 2026, mesInicio: 8, cantidadMeses: 1,
      fechaPago: '2026-08-20', metodoPago: 'Efectivo', usarSaldoAFavor: false
    });
    assert.equal(r.total, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCuenta sugiere un mes futuro sin marcar mora cuando la cuenta ya pagó por adelantado y esos meses están causados', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000, fechaCategoria: '2026-01-01' });
    const carteraService = new CarteraService(ctx.dbService);
    const pagoService = new PagoService(ctx.dbService);

    for (let mes = 1; mes <= 12; mes++) {
      const cargoId = carteraService.repository.crearMovimiento({
        cuentaId, fecha: `2026-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual',
        exigible: 1, monto: 10000, anio: 2026, mes
      });
      carteraService.registrarAbono({
        cuentaId, fecha: '2026-01-05', monto: 10000,
        modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargoId]
      });
    }

    const estado = pagoService.getEstadoCuenta(cuentaId);
    assert.deepEqual(estado.pagadoHasta, { anio: 2026, mes: 12, label: 'Diciembre 2026' });
    assert.deepEqual(estado.siguientePeriodo, { anio: 2027, mes: 1, label: 'Enero 2027' });
    assert.equal(estado.mesesMora, 0, 'una cuenta pagada por adelantado no está en mora');
    assert.equal(estado.estadoMora, 'Al día');

    // asegurarCausacion crea enero-2027 al registrar -- no debe lanzar.
    const r = pagoService.registrarPagoSostenimiento({
      cuentaId, anioInicio: 2027, mesInicio: 1, cantidadMeses: 1,
      fechaPago: '2026-08-20', metodoPago: 'Efectivo', usarSaldoAFavor: false
    });
    assert.equal(r.total, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCuenta: mesesMora cuenta los meses realmente pendientes, no el rango completo desde el hueco (reproduce el caso real de R007)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000, fechaCategoria: '2024-01-01' });
    const carteraService = new CarteraService(ctx.dbService);
    const pagoService = new PagoService(ctx.dbService);

    // Enero-2024 cubierto completo -- cubiertoHasta arranca ahí.
    const cEne = carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1
    });
    carteraService.registrarAbono({ cuentaId, fecha: '2024-01-05', monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cEne] });

    // Febrero-2024 solo parcialmente cubierto ($2.000 de $10.000) -- el único hueco real.
    const cFeb = carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2024-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 2
    });
    carteraService.registrarAbono({ cuentaId, fecha: '2024-02-10', monto: 2000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cFeb] });

    // Marzo-2024 hasta el mes anterior al actual: todos cubiertos completos -- se puso al día
    // después del hueco, como R007 real.
    const hoy = new Date();
    const mesActualCod = hoy.getFullYear() * 12 + hoy.getMonth();
    for (let cod = 2024 * 12 + 2; cod < mesActualCod; cod++) {
      const anio = Math.floor(cod / 12);
      const mes = (cod % 12) + 1;
      const mm = String(mes).padStart(2, '0');
      const c = carteraService.repository.crearMovimiento({
        cuentaId, fecha: `${anio}-${mm}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio, mes
      });
      carteraService.registrarAbono({ cuentaId, fecha: `${anio}-${mm}-05`, monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [c] });
    }
    // El mes actual queda sin causar a propósito -- también debe contar, igual que R007 real.

    const estado = pagoService.getEstadoCuenta(cuentaId);
    assert.equal(estado.mesesMora, 2, 'solo febrero-2024 (el hueco de $8.000) + el mes actual sin causar -- no el rango completo desde enero-2024');
    assert.equal(estado.estadoMora, 'En mora');
    assert.deepEqual(estado.motivoMora, ['meses_corrientes']);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCuenta: deuda anterior al corte cuenta como mora aunque 2024+ esté al día, con motivoMora', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000, fechaCategoria: '2020-01-01' });
    const carteraService = new CarteraService(ctx.dbService);
    const pagoService = new PagoService(ctx.dbService);

    carteraService.repository.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 90000 });
    const hoy = new Date();
    const cargo = carteraService.repository.crearMovimiento({
      cuentaId, fecha: hoy.toISOString().split('T')[0], tipo: 'CargoMensual', exigible: 1, monto: 10000,
      anio: hoy.getFullYear(), mes: hoy.getMonth() + 1
    });
    carteraService.registrarAbono({ cuentaId, fecha: hoy.toISOString().split('T')[0], monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargo] });

    const estado = pagoService.getEstadoCuenta(cuentaId);
    assert.equal(estado.mesesMora, 0, 'al día en meses corrientes');
    assert.equal(estado.deudaAntes2024, 90000);
    assert.equal(estado.estadoMora, 'En mora', 'la apertura opaca pendiente ya cuenta como mora, aunque 2024+ esté al día');
    assert.deepEqual(estado.motivoMora, ['deuda_anterior_2024']);
    assert.equal(estado.saldoPendienteEstimado, 90000, 'la deuda real, no meses x tarifa actual');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
