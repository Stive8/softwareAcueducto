// src/services/CarteraService.causacion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');

// Crea una cuenta con categoría y tarifa vigentes, un propietario y un primer recibo,
// que es lo mínimo que la causación necesita: sin tarifa no hay monto que causar y sin
// recibo no hay ancla de inicio de facturación.
function sembrarCuenta(dbService, { codigo = 'T001', tarifa = 10000, desde = '2022-01-01',
  fechaPrimerRecibo = '2022-01-15' } = {}) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;

  db.prepare(`INSERT INTO categorias (nombre) VALUES (?)`).run(`Cat-${codigo}`);
  const categoriaId = db.prepare(`SELECT id FROM categorias WHERE nombre = ?`).get(`Cat-${codigo}`).id;
  db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
              VALUES (?, ?, ?)`).run(categoriaId, tarifa, desde);
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
              VALUES (?, ?, ?)`).run(cuentaId, categoriaId, desde);

  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES (?)`).run(`Prop ${codigo}`);
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = ?`).get(`Prop ${codigo}`).id;
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio)
              VALUES (?, ?, ?)`).run(cuentaId, propietarioId, desde);

  if (fechaPrimerRecibo) {
    const num = db.prepare(`SELECT COALESCE(MAX(numero_recibo), 0) + 1 n FROM recibos`).get().n;
    db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
                VALUES (?, ?, ?, ?, 0, 'Efectivo')`).run(num, cuentaId, propietarioId, fechaPrimerRecibo);
  }

  new CuentaEstadoRepository(dbService)
    .sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: desde });

  return cuentaId;
}

test('asegurarCausacion crea un cargo por mes desde el primer recibo hasta el mes pedido', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: '2022-01-15' });
    const service = new CarteraService(ctx.dbService);

    const r = service.asegurarCausacion(cuentaId, 2022, 4);

    assert.equal(r.creados, 4, 'enero a abril de 2022');
    assert.equal(service.repository.getSaldos(cuentaId).deudaExigible, 40000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 1).monto, 10000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 4).monto, 10000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 5), undefined);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion es idempotente: llamarla dos veces no duplica cargos', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService);
    const service = new CarteraService(ctx.dbService);

    const primera = service.asegurarCausacion(cuentaId, 2022, 6);
    const segunda = service.asegurarCausacion(cuentaId, 2022, 6);

    assert.equal(primera.creados, 6);
    assert.equal(segunda.creados, 0, 'la segunda no crea nada');
    assert.equal(service.repository.getSaldos(cuentaId).deudaExigible, 60000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion no causa meses anteriores al primer recibo', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { desde: '2020-01-01', fechaPrimerRecibo: '2024-03-10' });
    const service = new CarteraService(ctx.dbService);

    const r = service.asegurarCausacion(cuentaId, 2024, 5);

    assert.equal(r.creados, 3, 'marzo, abril y mayo de 2024');
    assert.equal(service.repository.getCargoMensual(cuentaId, 2024, 2), undefined);
    assert.ok(service.repository.getCargoMensual(cuentaId, 2024, 3));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion, sin recibos ni cargos previos, usa fecha_creacion de la cuenta como ancla', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { desde: '2020-01-01', fechaPrimerRecibo: null });
    const db = ctx.dbService.getDb();
    const fechaCreacion = db.prepare(`SELECT fecha_creacion FROM cuentas WHERE id = ?`).get(cuentaId).fecha_creacion;
    const { anio, mes } = { anio: Number(fechaCreacion.slice(0, 4)), mes: Number(fechaCreacion.slice(5, 7)) };
    const service = new CarteraService(ctx.dbService);

    const r = service.asegurarCausacion(cuentaId, anio, mes);

    assert.equal(r.creados, 1, 'solo el mes de fecha_creacion, no hay recibo ni cargo anteriores que la anclen antes');
    assert.ok(service.repository.getCargoMensual(cuentaId, anio, mes));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getFechaInicioFacturacion cae a fecha_creacion si la cuenta no tiene ni cargos ni recibos', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: null });
    const db = ctx.dbService.getDb();
    const fechaCreacion = db.prepare(`SELECT fecha_creacion FROM cuentas WHERE id = ?`).get(cuentaId).fecha_creacion;
    const service = new CarteraService(ctx.dbService);

    assert.equal(service.getFechaInicioFacturacion(cuentaId), fechaCreacion.split(' ')[0]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion NO causa los meses en que la cuenta estuvo suspendida', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: '2022-01-15' });
    new CuentaEstadoRepository(ctx.dbService)
      .cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2022-04-01', motivo: 'no encontrado' });
    const service = new CarteraService(ctx.dbService);

    const r = service.asegurarCausacion(cuentaId, 2022, 8);

    assert.equal(r.creados, 3, 'solo enero, febrero y marzo');
    assert.equal(service.repository.getSaldos(cuentaId).deudaExigible, 30000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 4), undefined);
    assert.ok(r.omitidos.some(o => o.anio === 2022 && o.mes === 4 && /Suspendido/.test(o.motivo)));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion reanuda después de una reactivación y deja el hueco sin causar', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: '2022-01-15' });
    const estados = new CuentaEstadoRepository(ctx.dbService);
    estados.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2022-03-01' });
    estados.cambiarEstado({ cuentaId, estado: 'Activo', fechaInicio: '2022-06-01' });
    const service = new CarteraService(ctx.dbService);

    service.asegurarCausacion(cuentaId, 2022, 7);

    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 2), 'febrero: activo');
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 3), undefined, 'marzo: suspendido');
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 5), undefined, 'mayo: suspendido');
    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 6), 'junio: reactivado');
    assert.equal(service.repository.getSaldos(cuentaId).deudaExigible, 40000, 'ene, feb, jun, jul');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion usa la tarifa histórica de cada mes, no la de hoy', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(ctx.dbService, { tarifa: 5000, desde: '2022-01-01', fechaPrimerRecibo: '2022-01-15' });
    // La tarifa se dobla a partir de 2024: se cierra la vigencia vieja y se abre la nueva.
    const categoriaId = db.prepare(`SELECT categoria_id FROM cuenta_categorias WHERE cuenta_id = ?`).get(cuentaId).categoria_id;
    db.prepare(`UPDATE categoria_tarifas SET fecha_vigencia_hasta = '2023-12-31' WHERE categoria_id = ?`).run(categoriaId);
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
                VALUES (?, 10000, '2024-01-01')`).run(categoriaId);

    const service = new CarteraService(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2024, 2);

    assert.equal(service.repository.getCargoMensual(cuentaId, 2023, 12).monto, 5000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2024, 1).monto, 10000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2024, 2).monto, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion omite los meses sin tarifa configurada, sin abortar el resto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(ctx.dbService, { tarifa: 10000, desde: '2022-01-01', fechaPrimerRecibo: '2022-01-15' });
    // La tarifa termina en marzo y no hay ninguna después.
    const categoriaId = db.prepare(`SELECT categoria_id FROM cuenta_categorias WHERE cuenta_id = ?`).get(cuentaId).categoria_id;
    db.prepare(`UPDATE categoria_tarifas SET fecha_vigencia_hasta = '2022-03-31' WHERE categoria_id = ?`).run(categoriaId);

    const service = new CarteraService(ctx.dbService);
    const r = service.asegurarCausacion(cuentaId, 2022, 6);

    assert.equal(r.creados, 3);
    assert.equal(r.omitidos.filter(o => /tarifa/.test(o.motivo)).length, 3);
    assert.equal(service.repository.getSaldos(cuentaId).deudaExigible, 30000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion no escribe en un período contable cerrado y no hay forma de forzarlo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: '2022-01-15' });
    db.prepare(`INSERT INTO periodos_contables (anio, mes, estado) VALUES (2022, 2, 'Cerrado')`).run();

    const service = new CarteraService(ctx.dbService);
    const r = service.asegurarCausacion(cuentaId, 2022, 3);

    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 1));
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 2), undefined);
    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 3));
    assert.ok(r.omitidos.some(o => o.mes === 2 && /Cerrado/.test(o.motivo)));
    assert.equal(typeof service.asegurarCausacion, 'function');
    assert.equal(service.asegurarCausacion.length, 3, 'sin parámetro para saltar el bloqueo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getFechaInicioFacturacion devuelve la fecha del primer recibo e ignora los anulados', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: '2023-05-10' });
    const propietarioId = db.prepare(`SELECT propietario_id FROM cuenta_propietarios WHERE cuenta_id = ?`).get(cuentaId).propietario_id;
    db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago, estado)
                VALUES (9001, ?, ?, '2022-01-01', 0, 'Efectivo', 'Anulado')`).run(cuentaId, propietarioId);

    const service = new CarteraService(ctx.dbService);
    assert.equal(service.getFechaInicioFacturacion(cuentaId), '2023-05-10');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getFechaInicioFacturacion prefiere el primer CargoMensual sobre el primer recibo: la causación es la causa, el pago es la consecuencia', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { desde: '2022-01-01', fechaPrimerRecibo: '2024-03-10' });
    const service = new CarteraService(ctx.dbService);
    service.repository.crearMovimiento({
      cuentaId, fecha: '2022-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2022, mes: 1
    });

    assert.equal(service.getFechaInicioFacturacion(cuentaId), '2022-01-01',
      'el cargo causado en 2022 ancla antes que el recibo de 2024, aunque el recibo sea anterior en la tabla de recibos');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
