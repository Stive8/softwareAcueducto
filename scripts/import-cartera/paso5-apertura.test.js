const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const CarteraService = require('../../src/services/CarteraService');
const { ejecutarPaso5, FECHA_APERTURA } = require('./paso5-apertura');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

test('paso5: apertura positiva, negativa, cero y sin dato -- cada una a su bucket', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'R001'); sembrarCuenta(db, 'R002');
    sembrarCuenta(db, 'R003'); sembrarCuenta(db, 'R004');

    const r = ejecutarPaso5({
      dbService: ctx.dbService,
      cuentasJson: [
        { codigo: 'R001', apertura_opaca_2023_12_31: 150000 },
        { codigo: 'R002', apertura_opaca_2023_12_31: -50000 },
        { codigo: 'R003', apertura_opaca_2023_12_31: 0 },
        { codigo: 'R004', apertura_opaca_2023_12_31: null }
      ]
    });

    assert.equal(r.positivas.length, 1); assert.equal(r.totalPositivas, 150000);
    assert.equal(r.negativas.length, 1); assert.equal(r.totalNegativas, -50000);
    assert.equal(r.cero.length, 1);
    assert.equal(r.sinDato.length, 1);

    const service = new CarteraService(ctx.dbService);
    const cuentaR004 = db.prepare(`SELECT id FROM cuentas WHERE codigo='R004'`).get().id;
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id=?').get(cuentaR004).n,
      0, 'sin dato no inserta ningún movimiento'
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso5: la apertura positiva alimenta deudaAntes2024 (saldoOpaco) vía exigible=0', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'R001');
    ejecutarPaso5({ dbService: ctx.dbService, cuentasJson: [{ codigo: 'R001', apertura_opaca_2023_12_31: 150000 }] });

    const service = new CarteraService(ctx.dbService);
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo='R001'`).get().id;
    const estado = service.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaAntes2024, 150000);
    assert.equal(estado.deudaMesesDesde2024, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso5: la apertura negativa (saldo a favor) va a cuenta_creditos, no queda como AperturaOpaca negativa', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'R002');
    ejecutarPaso5({ dbService: ctx.dbService, cuentasJson: [{ codigo: 'R002', apertura_opaca_2023_12_31: -50000 }] });

    const service = new CarteraService(ctx.dbService);
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo='R002'`).get().id;
    const estado = service.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaAntes2024, 0, 'ya no hay deuda opaca: era saldo a favor, no deuda');
    assert.equal(estado.saldoCreditoDisponible, 50000, 'el crédito vive aparte, sin aplicarse solo');

    const movimiento = db.prepare(`SELECT tipo, exigible, monto, fecha FROM cartera_movimientos WHERE cuenta_id=?`).get(cuentaId);
    assert.equal(movimiento.tipo, 'AperturaOpaca');
    assert.equal(movimiento.exigible, 0);
    assert.equal(movimiento.monto, 0, 'verificado en 0: no es "sin dato"');
    assert.equal(movimiento.fecha, FECHA_APERTURA);

    const [credito] = db.prepare(`SELECT tipo, monto, fecha FROM cuenta_creditos WHERE cuenta_id=?`).all(cuentaId);
    assert.equal(credito.tipo, 'Abono');
    assert.equal(credito.monto, 50000);
    assert.equal(credito.fecha, FECHA_APERTURA);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso5: el crédito de una apertura negativa se puede redimir contra deuda de 2024+', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'R002');
    ejecutarPaso5({ dbService: ctx.dbService, cuentasJson: [{ codigo: 'R002', apertura_opaca_2023_12_31: -50000 }] });

    const service = new CarteraService(ctx.dbService);
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo='R002'`).get().id;
    service.repository.crearMovimiento({
      cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 20000, anio: 2026, mes: 1
    });

    const r = service.redimirCredito({ cuentaId, fecha: '2026-06-01', monto: 20000 });
    assert.equal(r.aplicado, 20000);
    assert.equal(service.repository.getSaldoCreditoDisponible(cuentaId), 30000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso5: falla si una cuenta del JSON todavía no existe en la base', () => {
  const ctx = crearDbTemporal();
  try {
    assert.throws(
      () => ejecutarPaso5({ dbService: ctx.dbService, cuentasJson: [{ codigo: 'X404', apertura_opaca_2023_12_31: 1000 }] }),
      /no existe en la base/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso5: S0332S0382 se ignora, no participa', () => {
  const ctx = crearDbTemporal();
  try {
    const r = ejecutarPaso5({ dbService: ctx.dbService, cuentasJson: [{ codigo: 'S0332S0382', apertura_opaca_2023_12_31: null }] });
    assert.equal(r.positivas.length + r.negativas.length + r.cero.length + r.sinDato.length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
