// scripts/import-cartera/aplicar-base.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { aplicarBase } = require('./aplicar-base');
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const CuentaEstadoRepository = require('../../src/repositories/CuentaEstadoRepository');

function sembrarCuenta(dbService, codigo, estado = 'Activo') {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', ?)`).run(codigo, estado);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
  // Toda cuenta real ya trae una fila "Sin clasificar" en cuenta_categorias (dato de producción).
  const sinClasificar = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Sin clasificar'`).get().id;
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2000-01-01')`).run(cuentaId, sinClasificar);
  return cuentaId;
}

function planBase(cuentas, extra = {}) {
  return { cuentas, huerfanosACrear: [], codigosPendientes: [], discrepanciasTipo: [], aperturasSinDato: [], ...extra };
}

test('limpia las tarifas inválidas y carga el histórico limpio de las 4 categorías', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    // Reproduce el desorden real: filas invertidas (vigencia_desde 2026-01-01, hasta 2025-12-31).
    const fincaId = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;
    db.prepare(`DELETE FROM categoria_tarifas WHERE categoria_id = ?`).run(fincaId);
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta)
                VALUES (?, 10000, '2026-01-01', '2025-12-31')`).run(fincaId);

    aplicarBase({ plan: planBase([]), dbService: ctx.dbService, usuarioId: 1 });

    const tarifas = db.prepare(`SELECT tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta FROM categoria_tarifas
                                WHERE categoria_id = ? ORDER BY fecha_vigencia_desde`).all(fincaId);
    assert.equal(tarifas.length, 2, 'un tramo 2022-2023 y uno 2024 en adelante');
    assert.equal(tarifas[0].tarifa_sostenimiento, 5000);
    assert.equal(tarifas[0].fecha_vigencia_desde, '2022-01-01');
    assert.equal(tarifas[0].fecha_vigencia_hasta, '2023-12-31');
    assert.equal(tarifas[1].tarifa_sostenimiento, 10000);
    assert.equal(tarifas[1].fecha_vigencia_desde, '2024-01-01');
    assert.equal(tarifas[1].fecha_vigencia_hasta, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asigna la categoría de la cuenta, reemplazando "Sin clasificar"', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, 'R034');
    const plan = planBase([{ codigo: 'R034', cuentaId, categoriaNombre: 'Finca', categoriaNombre2024: null,
      aperturaOpaca: { monto: 0, fuente: 'ninguna' }, candidatoSuspension: false, cuandoEmpezo: null, saldoReferencia2025: null, tipoDatosXlsx: null }]);

    aplicarBase({ plan, dbService: ctx.dbService, usuarioId: 1 });

    const db = ctx.dbService.getDb();
    const vigentes = db.prepare(`SELECT cat.nombre, cc.fecha_fin FROM cuenta_categorias cc
                                 JOIN categorias cat ON cat.id = cc.categoria_id
                                 WHERE cc.cuenta_id = ? ORDER BY cc.fecha_inicio`).all(cuentaId);
    assert.equal(vigentes.length, 2, 'la Sin clasificar queda cerrada, se abre Finca');
    assert.equal(vigentes[0].nombre, 'Sin clasificar');
    assert.ok(vigentes[0].fecha_fin);
    assert.equal(vigentes[1].nombre, 'Finca');
    assert.equal(vigentes[1].fecha_fin, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('abre una segunda vigencia de categoría en 2024-01-01 cuando categoriaNombre2024 difiere', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, 'X001');
    const plan = planBase([{ codigo: 'X001', cuentaId, categoriaNombre: 'Finca', categoriaNombre2024: 'Finca con piscina',
      aperturaOpaca: { monto: 0, fuente: 'ninguna' }, candidatoSuspension: false, cuandoEmpezo: null, saldoReferencia2025: null, tipoDatosXlsx: null }]);

    aplicarBase({ plan, dbService: ctx.dbService, usuarioId: 1 });

    const db = ctx.dbService.getDb();
    const vigentes = db.prepare(`SELECT cat.nombre, cc.fecha_inicio FROM cuenta_categorias cc
                                 JOIN categorias cat ON cat.id = cc.categoria_id
                                 WHERE cc.cuenta_id = ? ORDER BY cc.fecha_inicio`).all(cuentaId);
    assert.equal(vigentes.length, 3);
    assert.equal(vigentes[1].nombre, 'Finca');
    assert.equal(vigentes[2].nombre, 'Finca con piscina');
    assert.equal(vigentes[2].fecha_inicio, '2024-01-01');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('siembra cuenta_estados Activo para cada cuenta, y Suspendido cuando candidatoSuspension es true', () => {
  const ctx = crearDbTemporal();
  try {
    const activaId = sembrarCuenta(ctx.dbService, 'R034');
    const suspendidaId = sembrarCuenta(ctx.dbService, 'R002');
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO propietarios (id, nombre_completo) VALUES (1, 'Test')`).run();
    db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
                VALUES (1, ?, 1, '2018-06-10', 0, 'Efectivo')`).run(suspendidaId);

    const plan = planBase([
      { codigo: 'R034', cuentaId: activaId, categoriaNombre: 'Finca', categoriaNombre2024: null, aperturaOpaca: { monto: 0, fuente: 'ninguna' }, candidatoSuspension: false, cuandoEmpezo: null, saldoReferencia2025: null, tipoDatosXlsx: null },
      { codigo: 'R002', cuentaId: suspendidaId, categoriaNombre: 'Finca', categoriaNombre2024: null, aperturaOpaca: { monto: 0, fuente: 'ninguna' }, candidatoSuspension: true, cuandoEmpezo: null, saldoReferencia2025: null, tipoDatosXlsx: null }
    ]);

    const r = aplicarBase({ plan, dbService: ctx.dbService, usuarioId: 1 });

    const estadoRepo = new CuentaEstadoRepository(ctx.dbService);
    assert.equal(estadoRepo.getVigenciaAbierta(activaId).estado, 'Activo');
    assert.equal(estadoRepo.getVigenciaAbierta(suspendidaId).estado, 'Suspendido');
    assert.equal(estadoRepo.getVigenciaAbierta(suspendidaId).fecha_inicio, '2018-07-01', 'mes siguiente al último recibo');
    assert.equal(r.cuentasSuspendidas, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('crea AperturaOpaca con exigible=0 solo cuando el monto es mayor a cero', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, 'R034');
    const plan = planBase([{ codigo: 'R034', cuentaId, categoriaNombre: 'Finca', categoriaNombre2024: null,
      aperturaOpaca: { monto: 240000, fuente: 'vlookup' }, candidatoSuspension: false, cuandoEmpezo: null, saldoReferencia2025: null, tipoDatosXlsx: null }]);

    const r = aplicarBase({ plan, dbService: ctx.dbService, usuarioId: 1 });

    const carteraRepo = new CarteraRepository(ctx.dbService);
    assert.equal(carteraRepo.getSaldos(cuentaId).saldoOpaco, 240000);
    assert.equal(r.aperturasCreadas, 1);
    assert.equal(r.totalApertura, 240000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('crea C021 y S03321 como cuentas nuevas, con su apertura cada una', () => {
  const ctx = crearDbTemporal();
  try {
    const plan = planBase([], {
      huerfanosACrear: [
        { codigo: 'C021', nombre: 'CASTRO DIEGO', categoriaNombre: 'Finca', motivoSuspension: 'no encontrado', aperturaOpaca: { monto: 0, fuente: 'ninguna' } },
        { codigo: 'S03321', nombre: 'MARIN HERRERA ORFILIA', categoriaNombre: 'Finca', motivoSuspension: null, aperturaOpaca: { monto: 180000, fuente: 'saldo2020' } }
      ]
    });

    const r = aplicarBase({ plan, dbService: ctx.dbService, usuarioId: 1 });

    const db = ctx.dbService.getDb();
    const c021 = db.prepare(`SELECT id, estado FROM cuentas WHERE codigo = 'C021'`).get();
    assert.ok(c021, 'C021 se creó');
    assert.equal(c021.estado, 'Suspendido');

    const s03321 = db.prepare(`SELECT id, estado FROM cuentas WHERE codigo = 'S03321'`).get();
    assert.ok(s03321, 'S03321 se creó');
    assert.equal(s03321.estado, 'Activo', 'motivoSuspension null: se crea Activa, no Suspendida');

    assert.equal(r.huerfanosCreados, 2);

    const estadoRepo = new CuentaEstadoRepository(ctx.dbService);
    assert.equal(estadoRepo.getVigenciaAbierta(c021.id).motivo, 'no encontrado');

    const carteraRepo = new CarteraRepository(ctx.dbService);
    assert.equal(carteraRepo.getSaldos(s03321.id).saldoOpaco, 180000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('es idempotente: correr aplicarBase dos veces no duplica apertura ni vigencias', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, 'R034');
    const plan = planBase([{ codigo: 'R034', cuentaId, categoriaNombre: 'Finca', categoriaNombre2024: null,
      aperturaOpaca: { monto: 240000, fuente: 'vlookup' }, candidatoSuspension: false, cuandoEmpezo: null, saldoReferencia2025: null, tipoDatosXlsx: null }]);

    aplicarBase({ plan, dbService: ctx.dbService, usuarioId: 1 });
    aplicarBase({ plan, dbService: ctx.dbService, usuarioId: 1 });

    const carteraRepo = new CarteraRepository(ctx.dbService);
    assert.equal(carteraRepo.getSaldos(cuentaId).saldoOpaco, 240000, 'no se duplicó la apertura');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
