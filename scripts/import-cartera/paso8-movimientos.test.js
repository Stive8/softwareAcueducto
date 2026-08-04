const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const NuevoPuntoRepository = require('../../src/repositories/NuevoPuntoRepository');
const { ejecutarPaso8, NUMERO_SINCODIFICAR_OMITIDO } = require('./paso8-movimientos');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

function sembrarRecibo(db, { numeroRecibo, cuentaId, valor, fechaRecibo = '2024-05-10', fechaPagoReal = '2024-05-10' }) {
  const propietarioId = db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('P Test')`).run().lastInsertRowid;
  const reciboId = db.prepare(`
    INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, fecha_pago_real)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(numeroRecibo, cuentaId, propietarioId, fechaRecibo, valor, fechaPagoReal).lastInsertRowid;
  const detalleId = db.prepare(`INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, 'Concepto', ?)`)
    .run(reciboId, valor).lastInsertRowid;
  return { reciboId, detalleId };
}

function sembrarPunto(dbService, cuentaId, valorTotal = 300000) {
  const repo = new NuevoPuntoRepository(dbService);
  return repo.create({ cuentaId, valorTotal, fechaRegistro: '2020-01-01', observaciones: null });
}

function registro(overrides = {}) {
  return {
    numero_recibo: 100, codigo_cuenta: 'R001', fecha_recibo: '2024-05-10', fecha_pago_real: '2024-05-10',
    valor: 10000, concepto_original: 'CUOTA MAYO 2024', clasificacion: 'sostenimiento',
    periodo_desde: '2024-05', periodo_hasta: '2024-05', genera_movimiento_cartera: true, es_split: false, nota: null,
    ...overrides
  };
}

test('paso8: registro sostenimiento >=2024 crea un Abono exigible=1 en cartera_movimientos, fechado en fecha_pago_real', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const { detalleId } = sembrarRecibo(db, { numeroRecibo: 100, cuentaId, valor: 10000, fechaRecibo: '2024-05-10', fechaPagoReal: '2024-05-12' });

    const r = ejecutarPaso8({
      dbService: ctx.dbService,
      recibosJson: [registro({ fecha_pago_real: '2024-05-12' })]
    });

    assert.equal(r.movimientosCartera.length, 1);
    assert.equal(r.totalSostenimiento, 10000);

    const mov = db.prepare('SELECT * FROM cartera_movimientos WHERE recibo_detalle_id = ?').get(detalleId);
    assert.equal(mov.cuenta_id, cuentaId);
    assert.equal(mov.tipo, 'Abono');
    assert.equal(mov.exigible, 1);
    assert.equal(mov.monto, -10000, 'el abono se guarda en negativo');
    assert.equal(mov.fecha, '2024-05-12', 'usa fecha_pago_real, no fecha_recibo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso8: registro pre-2024 (genera_movimiento_cartera=false) no genera ningún movimiento', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    sembrarRecibo(db, { numeroRecibo: 50, cuentaId, valor: 10000, fechaRecibo: '2022-01-10', fechaPagoReal: '2022-01-10' });

    const r = ejecutarPaso8({
      dbService: ctx.dbService,
      recibosJson: [registro({ numero_recibo: 50, fecha_recibo: '2022-01-10', fecha_pago_real: '2022-01-10', genera_movimiento_cartera: false })]
    });

    assert.equal(r.movimientosCartera.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cartera_movimientos').get().n, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso8: registro punto >=2024 crea un abono en nuevo_punto_abonos con recibo_detalle_id real y actualiza saldo_pendiente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'S0700');
    const { detalleId } = sembrarRecibo(db, { numeroRecibo: 200, cuentaId, valor: 100000 });
    const nuevoPuntoId = sembrarPunto(ctx.dbService, cuentaId, 300000);

    const r = ejecutarPaso8({
      dbService: ctx.dbService,
      recibosJson: [registro({ numero_recibo: 200, codigo_cuenta: 'S0700', valor: 100000, clasificacion: 'punto', periodo_desde: null, periodo_hasta: null })]
    });

    assert.equal(r.abonosPunto.length, 1);
    assert.equal(r.totalPunto, 100000);

    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);
    const abono = db.prepare('SELECT * FROM nuevo_punto_abonos WHERE recibo_detalle_id = ?').get(detalleId);
    assert.equal(abono.nuevo_punto_id, nuevoPuntoId);
    assert.equal(abono.monto, 100000);

    const punto = puntoRepo.findById(nuevoPuntoId);
    assert.equal(punto.saldo_pendiente, 200000, '300.000 - 100.000');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso8: split cruzado entre 2 cuentas (mismo recibo_detalle_id) genera 2 movimientos distintos por cuenta_id', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaA = sembrarCuenta(db, 'S0332');
    const cuentaB = sembrarCuenta(db, 'S0382');
    const { detalleId } = sembrarRecibo(db, { numeroRecibo: 1157, cuentaId: cuentaA, valor: 240000 });

    const r = ejecutarPaso8({
      dbService: ctx.dbService,
      recibosJson: [
        registro({ numero_recibo: 1157, codigo_cuenta: 'S0332', valor: 120000 }),
        registro({ numero_recibo: 1157, codigo_cuenta: 'S0382', valor: 120000 })
      ]
    });

    assert.equal(r.movimientosCartera.length, 2);
    const movs = db.prepare('SELECT * FROM cartera_movimientos WHERE recibo_detalle_id = ? ORDER BY cuenta_id').all(detalleId);
    assert.equal(movs.length, 2);
    assert.deepEqual(movs.map(m => m.cuenta_id).sort(), [cuentaA, cuentaB].sort());
    assert.ok(movs.every(m => m.monto === -120000));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso8: split mixto sostenimiento+punto (misma cuenta, mismo recibo_detalle_id) crea 1 en cada tabla', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R0945');
    const { detalleId } = sembrarRecibo(db, { numeroRecibo: 2376, cuentaId, valor: 120000 });
    sembrarPunto(ctx.dbService, cuentaId, 300000);

    const r = ejecutarPaso8({
      dbService: ctx.dbService,
      recibosJson: [
        registro({ numero_recibo: 2376, codigo_cuenta: 'R0945', valor: 100000, clasificacion: 'punto', periodo_desde: null, periodo_hasta: null }),
        registro({ numero_recibo: 2376, codigo_cuenta: 'R0945', valor: 20000, clasificacion: 'sostenimiento' })
      ]
    });

    assert.equal(r.movimientosCartera.length, 1);
    assert.equal(r.abonosPunto.length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cartera_movimientos WHERE recibo_detalle_id = ?').get(detalleId).n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM nuevo_punto_abonos WHERE recibo_detalle_id = ?').get(detalleId).n, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso8: es idempotente -- correrlo dos veces no duplica movimientos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    sembrarRecibo(db, { numeroRecibo: 100, cuentaId, valor: 10000 });

    const recibosJson = [registro()];
    ejecutarPaso8({ dbService: ctx.dbService, recibosJson });
    const r2 = ejecutarPaso8({ dbService: ctx.dbService, recibosJson });

    assert.equal(r2.movimientosCartera.length, 0);
    assert.equal(r2.yaExistian.length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cartera_movimientos').get().n, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso8: falla ruidosamente y sin insertar nada si la suma de un grupo no calza con el recibo_detalle', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R0945');
    sembrarRecibo(db, { numeroRecibo: 2376, cuentaId, valor: 120000 });
    sembrarPunto(ctx.dbService, cuentaId, 300000);
    sembrarCuenta(db, 'R002');

    assert.throws(
      () => ejecutarPaso8({
        dbService: ctx.dbService,
        recibosJson: [
          registro({ numero_recibo: 2376, codigo_cuenta: 'R0945', valor: 100000, clasificacion: 'punto', periodo_desde: null, periodo_hasta: null }),
          registro({ numero_recibo: 2376, codigo_cuenta: 'R0945', valor: 999, clasificacion: 'sostenimiento' })
        ]
      }),
      /suma de registros \(100999\) != valor del recibo_detalle \(120000\)/
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cartera_movimientos').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM nuevo_punto_abonos').get().n, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso8: falla ruidosamente si la clasificación no es sostenimiento ni punto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    sembrarRecibo(db, { numeroRecibo: 100, cuentaId, valor: 10000 });

    assert.throws(
      () => ejecutarPaso8({
        dbService: ctx.dbService,
        recibosJson: [registro({ clasificacion: 'otro' })]
      }),
      /clasificación desconocida "otro"/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso8: registro punto sin nuevos_puntos creado para esa cuenta queda en omitidosSinPunto, no revienta', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'S0700');
    sembrarRecibo(db, { numeroRecibo: 200, cuentaId, valor: 100000 });

    const r = ejecutarPaso8({
      dbService: ctx.dbService,
      recibosJson: [registro({ numero_recibo: 200, codigo_cuenta: 'S0700', valor: 100000, clasificacion: 'punto', periodo_desde: null, periodo_hasta: null })]
    });

    assert.equal(r.abonosPunto.length, 0);
    assert.equal(r.omitidosSinPunto.length, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso8: el recibo #1284 (SINCODIFICAR) se omite siempre aunque venga con genera_movimiento_cartera=true', () => {
  const ctx = crearDbTemporal();
  try {
    const r = ejecutarPaso8({
      dbService: ctx.dbService,
      recibosJson: [registro({ numero_recibo: NUMERO_SINCODIFICAR_OMITIDO, codigo_cuenta: 'SINCODIFICAR', genera_movimiento_cartera: true })]
    });
    assert.equal(r.movimientosCartera.length, 0);
    assert.equal(r.abonosPunto.length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso8: el saldo de la cuenta refleja el abono (deudaMesesDesde2024 baja con el Abono)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    sembrarRecibo(db, { numeroRecibo: 100, cuentaId, valor: 10000 });
    const carteraRepo = new CarteraRepository(ctx.dbService);
    carteraRepo.crearMovimiento({ cuentaId, fecha: '2024-05-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 5 });

    ejecutarPaso8({ dbService: ctx.dbService, recibosJson: [registro()] });

    const { deudaExigible } = carteraRepo.getSaldos(cuentaId);
    assert.equal(deudaExigible, 0, '10.000 de cargo - 10.000 de abono');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
