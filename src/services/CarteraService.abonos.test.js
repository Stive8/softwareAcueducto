// src/services/CarteraService.abonos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const { MODOS } = require('./cartera/imputacion');

// Cuenta con 3 cargos exigibles de $10.000 (ene/feb/mar 2026) y una apertura opaca de
// $180.000. Se insertan por repositorio para no depender de la causación.
function sembrarCartera(dbService) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Vereda Test')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;

  const service = new CarteraService(dbService);
  service.repository.crearMovimiento({
    cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 180000
  });
  const cargos = [1, 2, 3].map(mes => service.repository.crearMovimiento({
    cuentaId, fecha: `2026-0${mes}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000,
    anio: 2026, mes
  }));
  return { cuentaId, service, cargos };
}

test('AbonoDeudaFIFO cubre del cargo más antiguo hacia adelante y baja la deuda exigible', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const r = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 25000, modo: MODOS.ABONO_DEUDA_FIFO
    });

    assert.equal(r.imputado, 25000);
    assert.equal(r.sobrante, 0);
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, 5000);
    assert.equal(e.saldoOpaco, 180000, 'el opaco no se toca');
    assert.deepEqual(e.cubiertoHasta, { anio: 2026, mes: 2 });
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('AbonoDeudaFIFO nunca toca el bucket no exigible, ni cuando sobra plata', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const r = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 50000, modo: MODOS.ABONO_DEUDA_FIFO
    });

    assert.equal(r.imputado, 30000);
    assert.equal(r.sobrante, 20000, 'el excedente va a cuenta_creditos, no baja el opaco ni la deuda');
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.saldoOpaco, 180000);
    assert.equal(e.deudaExigible, 0, 'el Abono se recorta a lo imputado: no queda negativo');
    assert.equal(e.saldoAFavor, 20000, 'el sobrante vive en cuenta_creditos, no como exigible negativo');
    assert.equal(e.saldoCreditoDisponible, 20000);
    assert.equal(e.totalCobrarHoy, 0, 'con saldo a favor no hay nada que cobrar');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('MesesEspecificos cubre los meses elegidos y deja descubiertos los anteriores', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service, cargos } = sembrarCartera(ctx.dbService);
    service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 20000, modo: MODOS.MESES_ESPECIFICOS,
      cargosElegidos: [cargos[1], cargos[2]]   // febrero y marzo
    });

    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, 10000, 'queda enero');
    assert.equal(e.cubiertoHasta, null, 'enero descubierto: no está cubierto hasta ningún mes');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('AbonoSaldoOpaco baja el saldo opaco y no toca la deuda exigible', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const r = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 50000, modo: MODOS.ABONO_SALDO_OPACO
    });

    assert.equal(r.imputado, 50000);
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.saldoOpaco, 130000);
    assert.equal(e.deudaExigible, 30000, 'la deuda corriente sigue intacta');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('AbonoSaldoOpaco no puede exceder el saldo opaco', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    assert.throws(
      () => service.registrarAbono({
        cuentaId, fecha: '2026-04-01', monto: 200000, modo: MODOS.ABONO_SALDO_OPACO
      }),
      /no puede exceder el saldo histórico/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('Anticipo no crea ningún movimiento: todo el monto queda como crédito sin aplicar', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const r = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 15000, modo: MODOS.ANTICIPO
    });

    assert.equal(r.imputado, 0);
    assert.equal(r.sobrante, 15000);
    assert.equal(r.abonoId, null, 'nada que imputar: no se crea Abono en cartera_movimientos');
    assert.ok(r.creditoId, 'el monto entero queda registrado en cuenta_creditos');

    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, 30000, 'los 30.000 de cargos no se tocan: el crédito no se aplicó solo');
    assert.equal(e.saldoCreditoDisponible, 15000);
    assert.equal(e.saldoAFavor, 15000);
    assert.equal(e.cubiertoHasta, null, 'no imputó, así que no cubrió ningún mes');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('un abono nuevo no altera las imputaciones de uno anterior', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const primero = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 10000, modo: MODOS.ABONO_DEUDA_FIFO
    });
    const antes = ctx.dbService.getDb()
      .prepare(`SELECT cargo_id, monto FROM cartera_imputaciones WHERE abono_id = ? ORDER BY id`)
      .all(primero.abonoId);

    service.registrarAbono({ cuentaId, fecha: '2026-05-01', monto: 10000, modo: MODOS.ABONO_DEUDA_FIFO });

    const despues = ctx.dbService.getDb()
      .prepare(`SELECT cargo_id, monto FROM cartera_imputaciones WHERE abono_id = ? ORDER BY id`)
      .all(primero.abonoId);
    assert.deepEqual(despues, antes);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('invariante: lo imputado de un abono nunca excede su monto', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const r = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 12000, modo: MODOS.ABONO_DEUDA_FIFO
    });
    assert.ok(service.repository.getTotalImputadoDeAbono(r.abonoId) <= 12000);
    assert.equal(service.repository.getTotalImputadoDeAbono(r.abonoId), r.imputado);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('invariante: ningún cargo queda sobrecubierto', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    service.registrarAbono({ cuentaId, fecha: '2026-04-01', monto: 15000, modo: MODOS.ABONO_DEUDA_FIFO });
    service.registrarAbono({ cuentaId, fecha: '2026-05-01', monto: 15000, modo: MODOS.ABONO_DEUDA_FIFO });

    const sobrecubiertos = ctx.dbService.getDb().prepare(`
      SELECT m.id, m.monto, SUM(i.monto) cub
      FROM cartera_movimientos m JOIN cartera_imputaciones i ON i.cargo_id = m.id
      GROUP BY m.id HAVING SUM(i.monto) > m.monto + 0.01
    `).all();
    assert.deepEqual(sobrecubiertos, []);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarAbono valida monto, modo y elegidos', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    assert.throws(() => service.registrarAbono({ cuentaId, fecha: '2026-04-01', monto: 0, modo: MODOS.ABONO_DEUDA_FIFO }),
      /mayor a cero/);
    assert.throws(() => service.registrarAbono({ cuentaId, fecha: null, monto: 1000, modo: MODOS.ABONO_DEUDA_FIFO }),
      /fecha del abono es obligatoria/);
    assert.throws(() => service.registrarAbono({ cuentaId, fecha: '2026-04-01', monto: 1000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [] }),
      /al menos un mes/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCartera reporta el total a cobrar sin el saldo opaco, y el de referencia con él', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, 30000);
    assert.equal(e.saldoOpaco, 180000);
    assert.equal(e.totalCobrarHoy, 30000, 'nunca incluye el opaco');
    assert.equal(e.totalReferencia, 210000);
    assert.equal(e.saldoAFavor, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
