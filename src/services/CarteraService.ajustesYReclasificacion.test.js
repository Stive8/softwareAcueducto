// src/services/CarteraService.ajustesYReclasificacion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const NuevoPuntoRepository = require('../repositories/NuevoPuntoRepository');

function sembrarCuenta(db, codigo = 'T001') {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

// Crea un recibo real con un solo recibo_detalle, para poder referenciarlo desde
// cartera_movimientos.recibo_detalle_id o nuevo_punto_abonos.recibo_detalle_id.
function sembrarReciboDetalle(db, { cuentaId, numeroRecibo, valor, fechaRecibo, concepto = 'Test' }) {
  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test ${numeroRecibo}')`).run();
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = ?`)
    .get(`Propietario Test ${numeroRecibo}`).id;
  const reciboId = db.prepare(`
    INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
    VALUES (?, ?, ?, ?, ?, 'Efectivo')
  `).run(numeroRecibo, cuentaId, propietarioId, fechaRecibo, valor).lastInsertRowid;
  return db.prepare(`
    INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, ?, ?)
  `).run(reciboId, concepto, valor).lastInsertRowid;
}

test('getEstadoCartera: expone los 4 buckets, incluido el saldo pendiente del punto de conexión', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db);
    const service = new CarteraService(ctx.dbService);
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);

    service.repository.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 300000 });
    service.repository.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const nuevoPuntoId = puntoRepo.create({ cuentaId, valorTotal: 500000, fechaRegistro: '2024-02-01' });
    puntoRepo.crearAbono({ nuevoPuntoId, monto: 200000, fechaAbono: '2024-02-07' });
    puntoRepo.actualizarSaldoYEstado(nuevoPuntoId);

    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaAntes2024, 300000);
    assert.equal(e.deudaMesesDesde2024, 10000);
    assert.equal(e.deudaPuntoConexion, 300000, 'faltan 300.000 de los 500.000 del punto');
    assert.equal(e.deudaTotal, 300000 + 10000 + 300000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCartera: un punto Cancelado no cuenta como deuda de conexión', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db);
    const service = new CarteraService(ctx.dbService);
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);

    const nuevoPuntoId = puntoRepo.create({ cuentaId, valorTotal: 500000, fechaRegistro: '2024-02-01' });
    puntoRepo.cancelar(nuevoPuntoId, 'Nunca se conectó');

    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaPuntoConexion, 0);
    assert.equal(e.deudaTotal, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('ajustarDeuda: crea el movimiento con los datos dados y exige motivo documentado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db);
    const service = new CarteraService(ctx.dbService);

    assert.throws(
      () => service.ajustarDeuda({ cuentaId, tipo: 'AjusteAsamblea', monto: 1000, fecha: '2026-01-01', observaciones: '' }),
      /motivo/
    );
    assert.throws(
      () => service.ajustarDeuda({ cuentaId, tipo: 'TipoRaro', monto: 1000, fecha: '2026-01-01', observaciones: 'x' }),
      /Tipo de ajuste inválido/
    );

    const r = service.ajustarDeuda({
      cuentaId, tipo: 'AjusteCargaInicial', monto: -3000, fecha: '2023-12-31',
      observaciones: 'Ajuste de conciliación carga inicial — descuadre en hoja CARTERA'
    });
    assert.ok(r.movimientoId);
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaMesesDesde2024, -3000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reclasificarAbono: mueve un abono de sostenimiento a punto sin tocar el recibo original', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db);
    const service = new CarteraService(ctx.dbService);
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);

    service.repository.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const nuevoPuntoId = puntoRepo.create({ cuentaId, valorTotal: 500000, fechaRegistro: '2019-01-01' });

    const detalleId = sembrarReciboDetalle(db, {
      cuentaId, numeroRecibo: 1347, valor: 10000, fechaRecibo: '2019-05-10',
      concepto: 'TERMINA DE PAGAR EL PUNTO DE AGUA'
    });
    service.registrarAbono({
      cuentaId, fecha: '2019-05-10', monto: 10000, modo: CarteraService.MODOS.ABONO_DEUDA_FIFO,
      reciboDetalleId: detalleId
    });
    assert.equal(service.getEstadoCartera(cuentaId).deudaMesesDesde2024, 0, 'el abono cubrió el cargo de enero');

    const r = service.reclasificarAbono({
      reciboDetalleId: detalleId, destino: 'punto', motivo: 'El punto ya estaba saldado desde 2019', nuevoPuntoId
    });
    assert.equal(r.origen, 'sostenimiento');
    assert.equal(r.destino, 'punto');

    const eDespues = service.getEstadoCartera(cuentaId);
    assert.equal(eDespues.deudaMesesDesde2024, 10000, 'el cargo de enero vuelve a estar pendiente');
    assert.equal(eDespues.deudaPuntoConexion, 500000 - 10000);

    // el recibo original sigue intacto, literal
    const original = db.prepare(`SELECT concepto, valor FROM recibo_detalles WHERE id = ?`).get(detalleId);
    assert.equal(original.concepto, 'TERMINA DE PAGAR EL PUNTO DE AGUA');
    assert.equal(original.valor, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reclasificarAbono: mueve un abono de punto a sostenimiento', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db);
    const service = new CarteraService(ctx.dbService);
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);

    service.repository.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const nuevoPuntoId = puntoRepo.create({ cuentaId, valorTotal: 500000, fechaRegistro: '2024-01-01' });

    const detalleId = sembrarReciboDetalle(db, {
      cuentaId, numeroRecibo: 2001, valor: 10000, fechaRecibo: '2024-01-15',
      concepto: 'Punto por codificar'
    });
    puntoRepo.crearAbono({ nuevoPuntoId, monto: 10000, fechaAbono: '2024-01-15', reciboDetalleId: detalleId });
    puntoRepo.actualizarSaldoYEstado(nuevoPuntoId);
    assert.equal(service.getEstadoCartera(cuentaId).deudaPuntoConexion, 490000);

    const r = service.reclasificarAbono({
      reciboDetalleId: detalleId, destino: 'sostenimiento',
      motivo: '"Punto por codificar" solo indica que el predio no tenía código, es sostenimiento puro'
    });
    assert.equal(r.origen, 'punto');
    assert.equal(r.destino, 'sostenimiento');

    const eDespues = service.getEstadoCartera(cuentaId);
    assert.equal(eDespues.deudaPuntoConexion, 500000, 'el punto vuelve a estar completo');
    assert.equal(eDespues.deudaMesesDesde2024, 0, 'el cargo de enero quedó cubierto');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reclasificarAbono: rechaza reclasificar al mismo destino donde ya está', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db);
    const service = new CarteraService(ctx.dbService);

    service.repository.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const detalleId = sembrarReciboDetalle(db, { cuentaId, numeroRecibo: 3001, valor: 10000, fechaRecibo: '2024-01-15' });
    service.registrarAbono({
      cuentaId, fecha: '2024-01-15', monto: 10000, modo: CarteraService.MODOS.ABONO_DEUDA_FIFO,
      reciboDetalleId: detalleId
    });

    assert.throws(
      () => service.reclasificarAbono({ reciboDetalleId: detalleId, destino: 'sostenimiento', motivo: 'x' }),
      /ya está clasificado como sostenimiento/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reclasificarAbono: rechaza un recibo_detalle sin ningún abono cargado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db);
    const service = new CarteraService(ctx.dbService);
    const detalleId = sembrarReciboDetalle(db, { cuentaId, numeroRecibo: 4001, valor: 10000, fechaRecibo: '2024-01-15' });

    assert.throws(
      () => service.reclasificarAbono({ reciboDetalleId: detalleId, destino: 'punto', motivo: 'x' }),
      /no tiene ningún abono cargado/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
