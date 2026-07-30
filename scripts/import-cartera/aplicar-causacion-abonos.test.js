// scripts/import-cartera/aplicar-causacion-abonos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { causarYAbonar } = require('./aplicar-causacion-abonos');
const CarteraService = require('../../src/services/CarteraService');
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const CuentaEstadoRepository = require('../../src/repositories/CuentaEstadoRepository');

function crearAperturaOpaca(dbService, cuentaId, monto) {
  new CarteraRepository(dbService).crearMovimiento({
    cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto,
    observaciones: 'Carga inicial cartera 2026-07 (fixture)'
  });
}

function sembrarCuentaConCategoria(dbService, codigo, { tarifa = 5000, tarifa2024 = 10000 } = {}) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;

  db.prepare(`DELETE FROM cuenta_categorias WHERE cuenta_id = ?`).run(cuentaId);
  const fincaId = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;
  db.prepare(`DELETE FROM categoria_tarifas WHERE categoria_id = ?`).run(fincaId);
  db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta)
              VALUES (?, ?, '2022-01-01', '2023-12-31')`).run(fincaId, tarifa);
  db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
              VALUES (?, ?, '2024-01-01')`).run(fincaId, tarifa2024);
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2000-01-01')`).run(cuentaId, fincaId);

  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES (?)`).run(`Prop ${codigo}`);
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = ?`).get(`Prop ${codigo}`).id;
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2000-01-01')`).run(cuentaId, propietarioId);

  new CuentaEstadoRepository(dbService).sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2000-01-01' });

  return { cuentaId, propietarioId };
}

function crearRecibo(dbService, { cuentaId, propietarioId, numero, fecha, valor, concepto = 'CUOTA DE SOSTENIMIENTO' }) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
              VALUES (?, ?, ?, ?, ?, 'Efectivo')`).run(numero, cuentaId, propietarioId, fecha, valor);
  const reciboId = db.prepare(`SELECT id FROM recibos WHERE numero_recibo = ?`).get(numero).id;
  db.prepare(`INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, ?, ?)`).run(reciboId, concepto, valor);
}

test('causa desde 2022-01 hasta el mes indicado, con la tarifa histórica correcta', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, propietarioId } = sembrarCuentaConCategoria(ctx.dbService, 'T001');
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 1, fecha: '2022-01-15', valor: 5000 });

    const r = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2024, hastaMes: 1 });

    assert.equal(r.cargosCreados, 25, 'ene-2022 a ene-2024');
    const carteraService = new CarteraService(ctx.dbService);
    assert.equal(carteraService.repository.getCargoMensual(cuentaId, 2022, 1).monto, 5000);
    assert.equal(carteraService.repository.getCargoMensual(cuentaId, 2024, 1).monto, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('causa incluso en meses de período contable Cerrado (bypass intencional de la carga inicial)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, propietarioId } = sembrarCuentaConCategoria(ctx.dbService, 'T002');
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 1, fecha: '2022-01-15', valor: 5000 });
    db.prepare(`INSERT INTO periodos_contables (anio, mes, estado) VALUES (2022, 3, 'Cerrado')`).run();

    const r = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2022, hastaMes: 4 });

    assert.equal(r.cargosCreados, 4, 'los 4 meses se causan, el bloqueo de período NO aplica aquí');
    const carteraService = new CarteraService(ctx.dbService);
    assert.ok(carteraService.repository.getCargoMensual(cuentaId, 2022, 3));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('no causa en los meses en que la cuenta estaba Suspendida', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, propietarioId } = sembrarCuentaConCategoria(ctx.dbService, 'T003');
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 1, fecha: '2022-01-15', valor: 5000 });
    new CuentaEstadoRepository(ctx.dbService).cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2022-04-01' });

    const r = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2022, hastaMes: 6 });

    assert.equal(r.cargosCreados, 3, 'ene, feb, mar');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('es idempotente: correr dos veces no duplica cargos', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, propietarioId } = sembrarCuentaConCategoria(ctx.dbService, 'T004');
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 1, fecha: '2022-01-15', valor: 5000 });

    causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2022, hastaMes: 6 });
    const r2 = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2022, hastaMes: 6 });

    assert.equal(r2.cargosCreados, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('carga como abono cada recibo de sostenimiento/deuda existente, en orden cronológico (FIFO)', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, propietarioId } = sembrarCuentaConCategoria(ctx.dbService, 'T005');
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 1, fecha: '2022-01-15', valor: 5000 });
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 2, fecha: '2022-07-07', valor: 50000, concepto: 'ABONO A LA DEUDA' });

    const r = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2022, hastaMes: 12 });

    assert.equal(r.abonosCreados, 2, 'el concepto del recibo no filtra nada, salvo conexión');
    assert.equal(r.totalAbonado, 55000);
    const carteraService = new CarteraService(ctx.dbService);
    // Causado ene-dic 2022 = 12 x 5.000 = 60.000, menos 55.000 abonados = 5.000.
    assert.equal(carteraService.getEstadoCartera(cuentaId).deudaExigible, 5000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('excluye los recibos de "PAGO PUNTO DE AGUA" / conexión: no son abonos de cartera', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, propietarioId } = sembrarCuentaConCategoria(ctx.dbService, 'T006');
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 1, fecha: '2022-01-15', valor: 5000 });
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 2, fecha: '2022-02-10', valor: 300000, concepto: 'PAGO PUNTO DE AGUA' });

    const r = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2022, hastaMes: 3 });

    assert.equal(r.abonosCreados, 1, 'solo el recibo de enero, el de punto de agua se excluye');
    const carteraService = new CarteraService(ctx.dbService);
    assert.equal(carteraService.getEstadoCartera(cuentaId).saldoOpaco, 0);
    assert.equal(carteraService.getEstadoCartera(cuentaId).deudaExigible, 10000, '15.000 causados - 5.000 abonados');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('excluye recibos anulados', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, propietarioId } = sembrarCuentaConCategoria(ctx.dbService, 'T007');
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 1, fecha: '2022-01-15', valor: 5000 });
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 2, fecha: '2022-02-10', valor: 5000 });
    db.prepare(`UPDATE recibos SET estado = 'Anulado' WHERE numero_recibo = 2`).run();

    const r = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2022, hastaMes: 3 });
    assert.equal(r.abonosCreados, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('excluye recibos anteriores al 2022-01-01: ya están implícitos en la apertura opaca, no se cuentan dos veces', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, propietarioId } = sembrarCuentaConCategoria(ctx.dbService, 'T008');
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 1, fecha: '2019-06-01', valor: 20000 });
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 2, fecha: '2022-01-15', valor: 5000 });

    const r = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2022, hastaMes: 1 });

    assert.equal(r.abonosCreados, 1, 'solo el recibo de 2022; el de 2019 ya está implícito en la apertura opaca');
    assert.equal(r.totalAbonado, 5000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('el excedente de un abono FIFO se aplica contra el saldo histórico opaco, no se pierde', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, propietarioId } = sembrarCuentaConCategoria(ctx.dbService, 'T009');
    crearAperturaOpaca(ctx.dbService, cuentaId, 300000);
    // Causado ene-mar 2022 = 3 x 5.000 = 15.000 exigible; el pago de 65.000 sobra 50.000.
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 1, fecha: '2022-01-15', valor: 65000, concepto: 'ABONO A LA DEUDA' });

    const r = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2022, hastaMes: 3 });

    assert.equal(r.cargosCreados, 3);
    assert.equal(r.aplicadoAOpaco, 50000, 'el excedente sobre la deuda exigible va contra el saldo opaco');
    assert.equal(r.sobranteFinal, 0, 'el saldo opaco alcanzaba a absorberlo entero');

    const estado = new CarteraService(ctx.dbService).getEstadoCartera(cuentaId);
    assert.equal(estado.saldoOpaco, 250000, '300.000 - 50.000');
    // Nota: el abono FIFO se registra por su monto completo en el bucket exigible, así que el
    // excedente queda además como saldo a favor exigible (-50.000) al mismo tiempo que baja el
    // opaco. totalReferencia (lo que se cobra) sigue siendo correcto porque el exigible negativo
    // se clampea a 0, pero la cuenta muestra un "saldo a favor" que ya se aplicó al histórico.
    // Punto abierto reportado en la revisión final; no se decide acá.
    assert.equal(estado.totalReferencia, 250000, 'lo cobrable + histórico queda bien pese a lo anterior');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('un excedente que supera la deuda exigible Y el saldo opaco deja el opaco en 0 y reporta el sobrante, sin inventarle destino', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, propietarioId } = sembrarCuentaConCategoria(ctx.dbService, 'T010');
    crearAperturaOpaca(ctx.dbService, cuentaId, 10000);
    // Exigible ene-mar 2022 = 15.000, opaco = 10.000; el pago de 100.000 deja 75.000 a favor.
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 1, fecha: '2022-01-15', valor: 100000, concepto: 'ABONO A LA DEUDA' });

    const r = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2022, hastaMes: 3 });

    assert.equal(r.aplicadoAOpaco, 10000, 'solo se aplica hasta agotar el saldo opaco, nunca más');
    assert.equal(r.sobranteFinal, 75000, '100.000 - 15.000 exigible - 10.000 opaco');

    const estado = new CarteraService(ctx.dbService).getEstadoCartera(cuentaId);
    assert.equal(estado.saldoOpaco, 0, 'el saldo opaco llega a cero, no queda negativo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('causa desde el piso 2022-01 aunque la cuenta no tenga ningún recibo (la deuda se acumula se pague o no)', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId } = sembrarCuentaConCategoria(ctx.dbService, 'T011');   // sin recibos

    const r = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2022, hastaMes: 3 });

    assert.equal(r.cargosCreados, 3, 'ene, feb, mar 2022: sin ancla de recibo se usa el piso 2022-01');
    assert.equal(r.abonosCreados, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('causa desde 2022-01 aunque el primer recibo de la cuenta sea muy posterior', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, propietarioId } = sembrarCuentaConCategoria(ctx.dbService, 'T012');
    crearRecibo(ctx.dbService, { cuentaId, propietarioId, numero: 1, fecha: '2023-05-10', valor: 5000 });

    const r = causarYAbonar({ cuentaId, dbService: ctx.dbService, usuarioId: 1, hastaAnio: 2023, hastaMes: 5 });

    assert.equal(r.cargosCreados, 17, 'ene-2022 a may-2023, no solo desde el mes del primer recibo');
    const carteraService = new CarteraService(ctx.dbService);
    assert.ok(carteraService.repository.getCargoMensual(cuentaId, 2022, 1), 'el mes de piso también se causa');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
