// src/services/CarteraService.estados.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');

function sembrar(dbService) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES ('T001', 'Vereda Test', 'Activo')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;

  // La migración 001 ya siembra 'Finca' como categoría por defecto (sin tarifa) y
  // categorias.nombre es UNIQUE. Reusar la categoría si ya existe en vez de crearla de cero
  // (mismo ajuste que se hizo en CarteraService.recategorizar.test.js).
  let catFila = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get();
  if (!catFila) {
    db.prepare(`INSERT INTO categorias (nombre) VALUES ('Finca')`).run();
    catFila = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get();
  }
  const catId = catFila.id;
  db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
              VALUES (?, 10000, '2020-01-01')`).run(catId);
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
              VALUES (?, ?, '2022-01-01')`).run(cuentaId, catId);

  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Prop T001')`).run();
  const propId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Prop T001'`).get().id;
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio)
              VALUES (?, ?, '2022-01-01')`).run(cuentaId, propId);
  db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
              VALUES (7001, ?, ?, '2022-01-10', 0, 'Efectivo')`).run(cuentaId, propId);

  new CuentaEstadoRepository(dbService)
    .sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2022-01-01' });

  return { cuentaId, service: new CarteraService(dbService) };
}

test('suspender con fecha retroactiva anula los cargos ya causados desde esa fecha', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2022, 12);   // 12 meses x $10.000 = $120.000
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 120000);

    // El último pago fue en marzo y desde entonces nadie sabe nada del punto.
    const r = service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: 'no encontrado' });

    assert.equal(r.cargosAnulados, 9, 'abril a diciembre');
    assert.equal(r.totalAnulado, -90000);
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 30000, 'solo ene-mar');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('suspender anula con contrapartida: no borra ningún CargoMensual', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2022, 6);
    const cargosAntes = db.prepare(
      `SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'CargoMensual'`
    ).get(cuentaId).n;

    service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: 'no encontrado' });

    assert.equal(
      db.prepare(`SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'CargoMensual'`).get(cuentaId).n,
      cargosAntes, 'los cargos originales siguen ahí'
    );
    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 4));
    const contrapartidas = db.prepare(`
      SELECT COUNT(*) n FROM cartera_movimientos
      WHERE cuenta_id = ? AND tipo = 'AjusteCategoria' AND monto < 0
    `).get(cuentaId).n;
    assert.equal(contrapartidas, 3, 'abril, mayo y junio');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('después de suspender, asegurarCausacion no vuelve a causar el lapso suspendido', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2022, 6);
    service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: 'no encontrado' });
    const deudaTrasSuspender = service.getEstadoCartera(cuentaId).deudaExigible;

    service.asegurarCausacion(cuentaId, 2022, 12);

    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, deudaTrasSuspender,
      'ni recausó los anulados ni causó los meses nuevos');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reactivar reanuda la causación desde su fecha y NO recausa el lapso suspendido', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2022, 6);
    service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: 'no encontrado' });

    service.reactivar({ cuentaId, fechaDesde: '2022-10-01', motivo: 'reapareció' });
    service.asegurarCausacion(cuentaId, 2022, 12);

    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 7), undefined, 'julio: suspendido');
    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 10), 'octubre: reactivado');
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 60000,
      'ene-mar ($30.000) + oct-dic ($30.000)');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('suspender sincroniza cuentas.estado y reactivar lo devuelve a Activo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, service } = sembrar(ctx.dbService);
    const estadoActual = () => db.prepare(`SELECT estado FROM cuentas WHERE id = ?`).get(cuentaId).estado;

    service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: 'no encontrado' });
    assert.equal(estadoActual(), 'Suspendido');

    service.reactivar({ cuentaId, fechaDesde: '2026-01-01', motivo: 'reapareció' });
    assert.equal(estadoActual(), 'Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('suspender no anula cargos anteriores a la fecha de suspensión', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2022, 6);

    const r = service.suspender({ cuentaId, fechaDesde: '2022-06-01', motivo: 'no encontrado' });

    assert.equal(r.cargosAnulados, 1, 'solo junio');
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 50000, 'ene a mayo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('suspender y reactivar validan sus parámetros', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrar(ctx.dbService);
    assert.throws(() => service.suspender({ cuentaId, fechaDesde: null, motivo: 'x' }),
      /fecha .* es obligatoria/i);
    assert.throws(() => service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: '' }),
      /motivo/i);
    assert.throws(() => service.reactivar({ cuentaId, fechaDesde: null }),
      /fecha .* es obligatoria/i);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
