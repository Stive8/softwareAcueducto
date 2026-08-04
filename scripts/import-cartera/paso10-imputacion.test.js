const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const CarteraService = require('../../src/services/CarteraService');
const NuevoPuntoRepository = require('../../src/repositories/NuevoPuntoRepository');
const { ejecutarPaso10 } = require('./paso10-imputacion');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

function sembrarReciboConDetalle(db, { numeroRecibo, cuentaId, valor, fechaRecibo = '2024-05-10', fechaPagoReal = '2024-05-10' }) {
  const propietarioId = db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('P Test')`).run().lastInsertRowid;
  const reciboId = db.prepare(`
    INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, fecha_pago_real)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(numeroRecibo, cuentaId, propietarioId, fechaRecibo, valor, fechaPagoReal).lastInsertRowid;
  const detalleId = db.prepare(`INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, 'Concepto', ?)`)
    .run(reciboId, valor).lastInsertRowid;
  return { reciboId, detalleId };
}

function sembrarAbono(db, { cuentaId, detalleId, valor, fecha }) {
  const carteraRepo = new CarteraRepository({ getDb: () => db });
  return carteraRepo.crearMovimiento({
    cuentaId, fecha, tipo: 'Abono', exigible: 1, monto: -valor, reciboDetalleId: detalleId
  });
}

function registro(overrides = {}) {
  return {
    numero_recibo: 100, codigo_cuenta: 'R001', clasificacion: 'sostenimiento',
    genera_movimiento_cartera: true, periodo_desde: null, periodo_hasta: null,
    ...overrides
  };
}

test('paso10: abono con período declarado cubre exactamente esos meses (Prioridad 1)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const carteraRepo = new CarteraRepository(ctx.dbService);
    const cargoEne = carteraRepo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const cargoFeb = carteraRepo.crearMovimiento({ cuentaId, fecha: '2024-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 2 });
    const { detalleId } = sembrarReciboConDetalle(db, { numeroRecibo: 100, cuentaId, valor: 10000 });
    sembrarAbono(db, { cuentaId, detalleId, valor: 10000, fecha: '2024-02-15' });

    const r = ejecutarPaso10({
      dbService: ctx.dbService,
      recibosJson: [registro({ periodo_desde: '2024-02', periodo_hasta: '2024-02' })]
    });

    assert.equal(r.conPeriodo.length, 1);
    assert.equal(r.conFifo.length, 0, 'no debe caer a FIFO: el período ya lo cubrió todo');

    const cubiertoEne = db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(cargoEne).c;
    const cubiertoFeb = db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(cargoFeb).c;
    assert.equal(cubiertoEne, 0, 'enero queda descubierto -- el pago declaró específicamente febrero');
    assert.equal(cubiertoFeb, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso10: sin período declarado usa FIFO puro sobre el pool combinado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const carteraRepo = new CarteraRepository(ctx.dbService);
    const cargoEne = carteraRepo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const cargoFeb = carteraRepo.crearMovimiento({ cuentaId, fecha: '2024-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 2 });
    const { detalleId } = sembrarReciboConDetalle(db, { numeroRecibo: 100, cuentaId, valor: 10000 });
    sembrarAbono(db, { cuentaId, detalleId, valor: 10000, fecha: '2024-03-01' });

    const r = ejecutarPaso10({ dbService: ctx.dbService, recibosJson: [registro()] });

    assert.equal(r.conFifo.length, 1);
    assert.equal(r.conPeriodo.length, 0);
    const cubiertoEne = db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(cargoEne).c;
    assert.equal(cubiertoEne, 10000, 'FIFO cubre el más antiguo primero');
    const cubiertoFeb = db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(cargoFeb).c;
    assert.equal(cubiertoFeb, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

// --- Punto 2 del usuario: orden de la apertura opaca ---

test('paso10: el FIFO consume AperturaOpaca antes que un CargoMensual de 2024 (quien paga salda primero lo viejo)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const carteraRepo = new CarteraRepository(ctx.dbService);
    const apertura = carteraRepo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 60000 });
    const cargoEne = carteraRepo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const { detalleId } = sembrarReciboConDetalle(db, { numeroRecibo: 100, cuentaId, valor: 10000 });
    sembrarAbono(db, { cuentaId, detalleId, valor: 10000, fecha: '2024-01-15' });

    ejecutarPaso10({ dbService: ctx.dbService, recibosJson: [registro()] });

    const cubiertoApertura = db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(apertura).c;
    const cubiertoEne = db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(cargoEne).c;
    assert.equal(cubiertoApertura, 10000, 'la apertura opaca (más vieja) se cubre primero');
    assert.equal(cubiertoEne, 0, 'el cargo mensual de 2024 queda sin cubrir -- no alcanzó');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso10: una apertura opaca NEGATIVA (saldo a favor) nunca aparece como cargo imputable', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const carteraRepo = new CarteraRepository(ctx.dbService);
    const aperturaNegativa = carteraRepo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: -50000 });
    const cargoEne = carteraRepo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const { detalleId } = sembrarReciboConDetalle(db, { numeroRecibo: 100, cuentaId, valor: 10000 });
    sembrarAbono(db, { cuentaId, detalleId, valor: 10000, fecha: '2024-01-15' });

    ejecutarPaso10({ dbService: ctx.dbService, recibosJson: [registro()] });

    const impsSobreNegativa = db.prepare('SELECT COUNT(*) n FROM cartera_imputaciones WHERE cargo_id=?').get(aperturaNegativa).n;
    assert.equal(impsSobreNegativa, 0, 'una apertura negativa jamás recibe imputaciones');
    const cubiertoEne = db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(cargoEne).c;
    assert.equal(cubiertoEne, 10000, 'el pago sí cubre el único cargo real (el mensual), saltando la apertura negativa');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

// --- Punto 1 del usuario: separación de pozos punto/sostenimiento ---

test('paso10: nunca toca nuevos_puntos ni nuevo_punto_abonos -- un abono de punto no recibe ninguna imputación', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'S0700');
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);
    const nuevoPuntoId = puntoRepo.create({ cuentaId, valorTotal: 300000, fechaRegistro: '2024-01-01' });
    const { detalleId } = sembrarReciboConDetalle(db, { numeroRecibo: 200, cuentaId, valor: 100000 });
    puntoRepo.crearAbono({ nuevoPuntoId, monto: 100000, fechaAbono: '2024-02-01', reciboDetalleId: detalleId });
    puntoRepo.actualizarSaldoYEstado(nuevoPuntoId);

    const antesAbonos = db.prepare('SELECT COUNT(*) n FROM nuevo_punto_abonos').get().n;
    const antesPuntos = JSON.stringify(puntoRepo.findById(nuevoPuntoId));

    ejecutarPaso10({
      dbService: ctx.dbService,
      recibosJson: [registro({ numero_recibo: 200, codigo_cuenta: 'S0700', clasificacion: 'punto' })]
    });

    assert.equal(db.prepare('SELECT COUNT(*) n FROM nuevo_punto_abonos').get().n, antesAbonos, 'nuevo_punto_abonos no cambia');
    assert.equal(JSON.stringify(puntoRepo.findById(nuevoPuntoId)), antesPuntos, 'nuevos_puntos no cambia');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cartera_imputaciones').get().n, 0, 'no se creó ninguna imputación');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

// --- Punto 4 del usuario: período que excede lo causado ---

test('paso10: período con meses no causados (ej. ago-dic 2026, tope de julio) cae a sobrante, no se inventa el cargo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    // Solo existe el cargo de julio 2026 (el tope de causación); agosto-diciembre nunca se causaron.
    const carteraRepo = new CarteraRepository(ctx.dbService);
    const cargoJul = carteraRepo.crearMovimiento({ cuentaId, fecha: '2026-07-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 7 });
    const { detalleId } = sembrarReciboConDetalle(db, { numeroRecibo: 100, cuentaId, valor: 60000, fechaRecibo: '2026-08-10', fechaPagoReal: '2026-08-10' });
    sembrarAbono(db, { cuentaId, detalleId, valor: 60000, fecha: '2026-08-10' });

    const r = ejecutarPaso10({
      dbService: ctx.dbService,
      recibosJson: [registro({ periodo_desde: '2026-08', periodo_hasta: '2026-12', fecha_pago_real: '2026-08-10' })]
    });

    // Ningún mes ago-dic existe como cargo, así que la pasada de período no cubre nada de ellos.
    // El sobrante cae al FIFO general -- que sí encuentra julio, todavía pendiente.
    const cubiertoJul = db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(cargoJul).c;
    assert.equal(cubiertoJul, 10000, 'julio (el único cargo real) se cubre vía el FIFO de respaldo');
    assert.equal(r.conFifo.length, 1);

    // Los 50.000 restantes (60.000 - 10.000 de julio) no tienen ningún cargo real que cubrir:
    // quedan sin imputar -- saldo a favor implícito, no se inventa un cargo para ago-dic.
    assert.equal(r.conSobrante.length, 1);
    assert.equal(r.conSobrante[0].sobrante, 50000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cartera_movimientos WHERE anio=2026 AND mes > 7').get().n, 0, 'no se inventó ningún cargo para ago-dic');

    const service = new CarteraService(ctx.dbService);
    const estado = service.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaMesesDesde2024, -50000, 'el sobrante se ve como saldo a favor en el balance general, sin tabla aparte');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso10: período parcialmente causado cubre lo que existe y el resto cae a sobrante', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const carteraRepo = new CarteraRepository(ctx.dbService);
    const cargoJun = carteraRepo.crearMovimiento({ cuentaId, fecha: '2026-06-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 6 });
    const cargoJul = carteraRepo.crearMovimiento({ cuentaId, fecha: '2026-07-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 7 });
    const { detalleId } = sembrarReciboConDetalle(db, { numeroRecibo: 100, cuentaId, valor: 30000, fechaRecibo: '2026-08-01', fechaPagoReal: '2026-08-01' });
    sembrarAbono(db, { cuentaId, detalleId, valor: 30000, fecha: '2026-08-01' });

    ejecutarPaso10({
      dbService: ctx.dbService,
      recibosJson: [registro({ periodo_desde: '2026-06', periodo_hasta: '2026-08' })]
    });

    assert.equal(db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(cargoJun).c, 10000);
    assert.equal(db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(cargoJul).c, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

// --- Orden cronológico e idempotencia ---

test('paso10: procesa los abonos de una cuenta en orden cronológico -- el primero cubre el cargo más antiguo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const carteraRepo = new CarteraRepository(ctx.dbService);
    const cargoEne = carteraRepo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const cargoFeb = carteraRepo.crearMovimiento({ cuentaId, fecha: '2024-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 2 });

    // Se insertan en orden inverso al JSON para probar que el paso ordena por fecha, no por
    // el orden de aparición en recibosJson.
    const { detalleId: detalleFeb } = sembrarReciboConDetalle(db, { numeroRecibo: 200, cuentaId, valor: 10000, fechaRecibo: '2024-03-01', fechaPagoReal: '2024-03-01' });
    sembrarAbono(db, { cuentaId, detalleId: detalleFeb, valor: 10000, fecha: '2024-03-01' });
    const { detalleId: detalleEne } = sembrarReciboConDetalle(db, { numeroRecibo: 100, cuentaId, valor: 10000, fechaRecibo: '2024-01-20', fechaPagoReal: '2024-01-20' });
    sembrarAbono(db, { cuentaId, detalleId: detalleEne, valor: 10000, fecha: '2024-01-20' });

    ejecutarPaso10({
      dbService: ctx.dbService,
      recibosJson: [
        registro({ numero_recibo: 200 }), // aparece primero en el JSON, pero es el pago más nuevo
        registro({ numero_recibo: 100 })
      ]
    });

    assert.equal(db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(cargoEne).c, 10000);
    assert.equal(db.prepare('SELECT COALESCE(SUM(monto),0) c FROM cartera_imputaciones WHERE cargo_id=?').get(cargoFeb).c, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso10: es idempotente -- correrlo dos veces no duplica imputaciones', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const carteraRepo = new CarteraRepository(ctx.dbService);
    carteraRepo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const { detalleId } = sembrarReciboConDetalle(db, { numeroRecibo: 100, cuentaId, valor: 10000 });
    sembrarAbono(db, { cuentaId, detalleId, valor: 10000, fecha: '2024-01-15' });

    const recibosJson = [registro()];
    ejecutarPaso10({ dbService: ctx.dbService, recibosJson });
    const r2 = ejecutarPaso10({ dbService: ctx.dbService, recibosJson });

    assert.equal(r2.procesados, 0);
    assert.equal(r2.saltados.length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cartera_imputaciones').get().n, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso10: reporta el desglose por pozo (AperturaOpaca vs cargos desde 2024)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const carteraRepo = new CarteraRepository(ctx.dbService);
    carteraRepo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 15000 });
    carteraRepo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const { detalleId } = sembrarReciboConDetalle(db, { numeroRecibo: 100, cuentaId, valor: 20000 });
    sembrarAbono(db, { cuentaId, detalleId, valor: 20000, fecha: '2024-01-15' });

    const r = ejecutarPaso10({ dbService: ctx.dbService, recibosJson: [registro()] });

    assert.equal(r.porPozo.apertura, 15000);
    assert.equal(r.porPozo.cargosDesde2024, 5000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
