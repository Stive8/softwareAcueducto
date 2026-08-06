const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const {
  ejecutarPaso9b, CUENTAS_TARIFA_CORREGIDA, PROPIETARIO_S0244,
  REASIGNACION_RECIBO_2137, CORRECCION_PERIODO_RECIBO_2384, RECALCULO_S010,
  CORRECCION_APERTURA_S044, CORRECCION_PERIODO_RECIBO_2229
} = require('./paso9b-correcciones');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

function sembrarPropietario(db) {
  return db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Prop Test')`).run().lastInsertRowid;
}

// Crea recibos + recibo_detalles (uno por recibo, caso simple) para las pruebas de las
// correcciones 4 a 7. Devuelve { reciboId, detalleId }.
function sembrarRecibo(db, propietarioId, { numeroRecibo, cuentaId, fecha, valor, concepto, periodoDesde = null, periodoHasta = null }) {
  const reciboId = db.prepare(`
    INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
    VALUES (?, ?, ?, ?, ?, 'Efectivo')
  `).run(numeroRecibo, cuentaId, propietarioId, fecha, valor).lastInsertRowid;
  const detalleId = db.prepare(`
    INSERT INTO recibo_detalles (recibo_id, concepto, periodo_desde, periodo_hasta, valor)
    VALUES (?, ?, ?, ?, ?)
  `).run(reciboId, concepto, periodoDesde, periodoHasta, valor).lastInsertRowid;
  return { reciboId, detalleId };
}

function sembrarTodas(db) {
  const ids = {};
  ids.S03311 = sembrarCuenta(db, 'S03311');
  for (const codigo of CUENTAS_TARIFA_CORREGIDA) ids[codigo] = sembrarCuenta(db, codigo);

  const repo = new CarteraRepository({ getDb: () => db });
  const propietarioId = sembrarPropietario(db);

  // --- Recibo 2137: S0312 -> S0393 ---
  ids.S0312 = sembrarCuenta(db, 'S0312');
  ids.S0393 = sembrarCuenta(db, 'S0393');
  repo.crearMovimiento({ cuentaId: ids.S0312, fecha: '2025-03-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2025, mes: 3 });
  repo.crearMovimiento({ cuentaId: ids.S0393, fecha: '2025-03-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2025, mes: 3 });
  repo.crearMovimiento({ cuentaId: ids.S0393, fecha: '2025-04-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2025, mes: 4 });
  const r2137 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: REASIGNACION_RECIBO_2137.numeroRecibo, cuentaId: ids.S0312, fecha: '2025-03-22',
    valor: 15000, concepto: 'DEUDA HASTA MARZO 2025 (TRANSFERENCIAS)'
  });
  const abono2137Id = repo.crearMovimiento({
    cuentaId: ids.S0312, fecha: '2025-03-22', tipo: 'Abono', exigible: 1, monto: -15000, reciboDetalleId: r2137.detalleId
  });
  // simula que el paso 10 ya corrió: el abono quedó imputado contra el cargo de marzo de S0312
  const cargoMarzoS0312 = db.prepare(`SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND anio=2025 AND mes=3`).get(ids.S0312);
  repo.crearImputacion({ abonoId: abono2137Id, cargoId: cargoMarzoS0312.id, monto: 10000 });
  ids.abono2137Id = abono2137Id;

  // --- Recibo 2384: S048, corregir período. Se simula el estado real encontrado en
  // producción: el paso 10 ya corrió con el período ORIGINAL (2026, tal como decía el recibo)
  // -- 7 meses de 2026 (los únicos que existían) + el sobrante como FIFO contra la apertura
  // opaca -- para que la re-imputación de la corrección tenga algo real que deshacer.
  ids.S048 = sembrarCuenta(db, 'S048');
  repo.crearMovimiento({ cuentaId: ids.S048, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 102000 });
  for (let mes = 1; mes <= 12; mes++) {
    repo.crearMovimiento({ cuentaId: ids.S048, fecha: `2025-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 16000, anio: 2025, mes });
  }
  for (let mes = 1; mes <= 7; mes++) {
    repo.crearMovimiento({ cuentaId: ids.S048, fecha: `2026-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 16000, anio: 2026, mes });
  }
  const r2384 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: CORRECCION_PERIODO_RECIBO_2384.numeroRecibo, cuentaId: ids.S048, fecha: '2026-01-17',
    valor: 192000, concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026',
    periodoDesde: 'Enero 2026', periodoHasta: 'Diciembre 2026'
  });
  ids.detalle2384Id = r2384.detalleId;
  const abono2384Id = repo.crearMovimiento({
    cuentaId: ids.S048, fecha: '2026-01-17', tipo: 'Abono', exigible: 1, monto: -192000, reciboDetalleId: r2384.detalleId
  });
  const cargos2026S048 = db.prepare(`SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND anio=2026 ORDER BY mes`).all(ids.S048);
  for (const c of cargos2026S048) repo.crearImputacion({ abonoId: abono2384Id, cargoId: c.id, monto: 16000 });
  const aperturaS048 = db.prepare(`SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND tipo='AperturaOpaca'`).get(ids.S048);
  repo.crearImputacion({ abonoId: abono2384Id, cargoId: aperturaS048.id, monto: 80000 });
  ids.abono2384Id = abono2384Id;

  // --- S010: recibos 1659, 1825, 2151, 2302 -- 24 meses de causación (2024+2025) a 10.000 ---
  ids.S010 = sembrarCuenta(db, 'S010');
  for (const [anio, hasta] of [[2024, 12], [2025, 12]]) {
    for (let mes = 1; mes <= hasta; mes++) {
      repo.crearMovimiento({ cuentaId: ids.S010, fecha: `${anio}-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio, mes });
    }
  }
  const r1659 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: RECALCULO_S010.numeroReciboEliminado, cuentaId: ids.S010, fecha: '2024-01-27',
    valor: 30000, concepto: 'CUOTA DE SOSTENIMIENTO JULIO 2022 A DICIEMBRE 2023',
    periodoDesde: 'Julio 2022', periodoHasta: 'Diciembre 2023'
  });
  const abono1659Id = repo.crearMovimiento({ cuentaId: ids.S010, fecha: '2024-01-27', tipo: 'Abono', exigible: 1, monto: -30000, reciboDetalleId: r1659.detalleId });
  const cargosEneMar2024 = db.prepare(`SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND anio=2024 AND mes IN (1,2,3) ORDER BY mes`).all(ids.S010);
  for (const c of cargosEneMar2024) repo.crearImputacion({ abonoId: abono1659Id, cargoId: c.id, monto: 10000 });
  ids.abono1659Id = abono1659Id;

  const r1825 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: RECALCULO_S010.numeroReciboLibre, cuentaId: ids.S010, fecha: '2024-05-04',
    valor: 30000, concepto: 'CUOTA DE SOSTENIMIENTO JULIO 2022 A DICIEMBRE 2023',
    periodoDesde: 'Julio 2022', periodoHasta: 'Diciembre 2023'
  });
  const abono1825Id = repo.crearMovimiento({ cuentaId: ids.S010, fecha: '2024-05-04', tipo: 'Abono', exigible: 1, monto: -30000, reciboDetalleId: r1825.detalleId });
  const cargosAbrJun2024 = db.prepare(`SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND anio=2024 AND mes IN (4,5,6) ORDER BY mes`).all(ids.S010);
  for (const c of cargosAbrJun2024) repo.crearImputacion({ abonoId: abono1825Id, cargoId: c.id, monto: 10000 });
  ids.detalle1825Id = r1825.detalleId;

  const r2151 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 2151, cuentaId: ids.S010, fecha: '2025-03-28',
    valor: 120000, concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2024',
    periodoDesde: 'Enero 2024', periodoHasta: 'Diciembre 2024'
  });
  repo.crearMovimiento({ cuentaId: ids.S010, fecha: '2025-03-28', tipo: 'Abono', exigible: 1, monto: -120000, reciboDetalleId: r2151.detalleId });

  const r2302 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 2302, cuentaId: ids.S010, fecha: '2025-10-11',
    valor: 120000, concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2025',
    periodoDesde: 'Enero 2025', periodoHasta: 'Diciembre 2025'
  });
  repo.crearMovimiento({ cuentaId: ids.S010, fecha: '2025-10-11', tipo: 'Abono', exigible: 1, monto: -120000, reciboDetalleId: r2302.detalleId });

  // --- S044: apertura opaca duplicaba el pendiente del punto de agua (corrección 8) + recibo
  // 2229 con período mal cargado (corrección 9). Se simula el estado real encontrado en
  // producción: el paso 10 ya corrió con el período roto (solo junio matcheó) y el sobrante de
  // $250.000 fue a FIFO -- $156.000 a la apertura opaca (entonces "válida") + $50.000 a enero +
  // $44.000 a febrero (parcial), dejando marzo-mayo sin cubrir.
  ids.S044 = sembrarCuenta(db, 'S044');
  const aperturaS044Id = repo.crearMovimiento({ cuentaId: ids.S044, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 156000 });
  ids.aperturaS044Id = aperturaS044Id;
  for (let mes = 1; mes <= 6; mes++) {
    repo.crearMovimiento({ cuentaId: ids.S044, fecha: `2025-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 50000, anio: 2025, mes });
  }
  const r2229 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: CORRECCION_PERIODO_RECIBO_2229.numeroRecibo, cuentaId: ids.S044, fecha: '2025-06-28',
    valor: 300000, concepto: 'CUOTA DE SOSTENIMIENTO ENERIO A JUNIO 2025',
    periodoDesde: 'Junio 2025', periodoHasta: 'Junio 2025'
  });
  ids.detalle2229Id = r2229.detalleId;
  const abono2229Id = repo.crearMovimiento({
    cuentaId: ids.S044, fecha: '2025-06-28', tipo: 'Abono', exigible: 1, monto: -300000, reciboDetalleId: r2229.detalleId
  });
  ids.abono2229Id = abono2229Id;
  const cargosS044 = db.prepare(`SELECT id, mes FROM cartera_movimientos WHERE cuenta_id=? AND anio=2025 ORDER BY mes`).all(ids.S044);
  const cargoS044 = mes => cargosS044.find(c => c.mes === mes).id;
  repo.crearImputacion({ abonoId: abono2229Id, cargoId: cargoS044(6), monto: 50000 });
  repo.crearImputacion({ abonoId: abono2229Id, cargoId: aperturaS044Id, monto: 156000 });
  repo.crearImputacion({ abonoId: abono2229Id, cargoId: cargoS044(1), monto: 50000 });
  repo.crearImputacion({ abonoId: abono2229Id, cargoId: cargoS044(2), monto: 44000 });

  return ids;
}

function getCargos(db, cuentaId) {
  return db.prepare(`
    SELECT anio, mes, monto, observaciones FROM cartera_movimientos
    WHERE cuenta_id = ? AND tipo = 'CargoMensual' ORDER BY anio, mes
  `).all(cuentaId);
}

test('paso9b: S03311 -- causa 2024 completo a 10.000, 12 meses', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.s03311Creados.length, 12);
    const cargos = getCargos(db, ids.S03311);
    assert.equal(cargos.length, 12);
    assert.ok(cargos.every(c => c.anio === 2024 && c.monto === 10000));
    assert.deepEqual(cargos.map(c => c.mes), [1,2,3,4,5,6,7,8,9,10,11,12]);
    assert.match(cargos[0].observaciones, /celda vacia en CARTERA/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: las 4 cuentas de tarifa derogada quedan recausadas a 10.000, 31 meses (12+12+7)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    // simula la causacion vieja a 5.000 que dejo el paso 9 original
    for (const codigo of CUENTAS_TARIFA_CORREGIDA) {
      for (const [anio, hasta] of [[2024, 12], [2025, 12], [2026, 7]]) {
        for (let mes = 1; mes <= hasta; mes++) {
          repo.crearMovimiento({ cuentaId: ids[codigo], fecha: `${anio}-01-01`, tipo: 'CargoMensual', exigible: 1, monto: 5000, anio, mes });
        }
      }
    }

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.tarifaCorregida.length, 4);
    for (const codigo of CUENTAS_TARIFA_CORREGIDA) {
      const cargos = getCargos(db, ids[codigo]);
      assert.equal(cargos.length, 31, `${codigo}: deben quedar 31 cargos, no los 5.000 viejos duplicados`);
      assert.ok(cargos.every(c => c.monto === 10000), `${codigo}: ningun cargo debe quedar en 5.000`);
      const suma = cargos.reduce((s, c) => s + c.monto, 0);
      assert.equal(suma, 310000);
      const porAnio = { 2024: cargos.filter(c => c.anio === 2024).length, 2025: cargos.filter(c => c.anio === 2025).length, 2026: cargos.filter(c => c.anio === 2026).length };
      assert.deepEqual(porAnio, { 2024: 12, 2025: 12, 2026: 7 });
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: idempotente -- correr dos veces da el mismo resultado, sin duplicar', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    ejecutarPaso9b({ dbService: ctx.dbService });

    const cargosS03311 = getCargos(db, ids.S03311);
    assert.equal(cargosS03311.length, 12);

    for (const codigo of CUENTAS_TARIFA_CORREGIDA) {
      const cargos = getCargos(db, ids[codigo]);
      assert.equal(cargos.length, 31);
      assert.ok(cargos.every(c => c.monto === 10000));
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S0244 -- asigna propietario ZAPATO MACHADO PEDRO NEL cuando no tiene ninguno activo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.propietarioS0244.creado, true);
    const activo = db.prepare(`
      SELECT p.nombre_completo, p.numero_identificacion, cp.fecha_inicio
      FROM cuenta_propietarios cp INNER JOIN propietarios p ON p.id = cp.propietario_id
      WHERE cp.cuenta_id = ? AND cp.fecha_fin IS NULL
    `).get(ids.S0244);
    assert.equal(activo.nombre_completo, PROPIETARIO_S0244.nombre_completo);
    assert.equal(activo.numero_identificacion, PROPIETARIO_S0244.numero_identificacion);
    assert.equal(activo.fecha_inicio, PROPIETARIO_S0244.fechaInicio);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S0244 -- no toca un propietario ya asignado (no duplica, no lo cierra)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const propietarioExistenteId = db.prepare(
      `INSERT INTO propietarios (nombre_completo) VALUES ('OTRO PROPIETARIO')`
    ).run().lastInsertRowid;
    db.prepare(`
      INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2020-01-01')
    `).run(ids.S0244, propietarioExistenteId);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.propietarioS0244.creado, false);
    const activos = db.prepare(
      `SELECT * FROM cuenta_propietarios WHERE cuenta_id = ? AND fecha_fin IS NULL`
    ).all(ids.S0244);
    assert.equal(activos.length, 1);
    assert.equal(activos[0].propietario_id, propietarioExistenteId);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: idempotente en S0244 -- correr dos veces no duplica propietario ni asignación', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    ejecutarPaso9b({ dbService: ctx.dbService });

    const propietarios = db.prepare(
      `SELECT COUNT(*) AS n FROM propietarios WHERE numero_identificacion = ?`
    ).get(PROPIETARIO_S0244.numero_identificacion);
    assert.equal(propietarios.n, 1);

    const activos = db.prepare(
      `SELECT * FROM cuenta_propietarios WHERE cuenta_id = ? AND fecha_fin IS NULL`
    ).all(ids.S0244);
    assert.equal(activos.length, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: recibo 2137 -- reasigna el abono de S0312 a S0393 y lo reimputa (período + FIFO)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.reasignacion2137.reasignado, true);
    const abono = db.prepare(`SELECT cuenta_id FROM cartera_movimientos WHERE id=?`).get(ids.abono2137Id);
    assert.equal(abono.cuenta_id, ids.S0393, 'el movimiento debe quedar en S0393');

    // S0312 ya no debe tener ninguna imputación del abono movido -- su cargo de marzo vuelve a estar pendiente
    const impsViejas = db.prepare(`SELECT * FROM cartera_imputaciones WHERE abono_id=?`).all(ids.abono2137Id)
      .filter(i => db.prepare('SELECT cuenta_id FROM cartera_movimientos WHERE id=?').get(i.cargo_id).cuenta_id === ids.S0312);
    assert.equal(impsViejas.length, 0);

    // S0393: 15.000 imputados -- 10.000 al cargo de marzo (período declarado) + 5.000 FIFO al de abril
    const impsNuevas = db.prepare(`SELECT ci.monto, cm.mes FROM cartera_imputaciones ci INNER JOIN cartera_movimientos cm ON cm.id=ci.cargo_id WHERE ci.abono_id=? ORDER BY cm.mes`).all(ids.abono2137Id);
    assert.deepEqual(impsNuevas.map(i => [i.mes, i.monto]), [[3, 10000], [4, 5000]]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: recibo 2137 -- idempotente, correr dos veces no lo vuelve a mover ni duplica imputaciones', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.reasignacion2137.reasignado, false);
    const imps = db.prepare(`SELECT * FROM cartera_imputaciones WHERE abono_id=?`).all(ids.abono2137Id);
    assert.equal(imps.length, 2, 'no debe duplicar las imputaciones en la segunda corrida');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: recibo 2384 -- corrige el período a 2025 sin tocar el concepto ni la diferencia', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.correccion2384.corregido, true);
    const detalle = db.prepare(`SELECT concepto, periodo_desde, periodo_hasta FROM recibo_detalles WHERE id=?`).get(ids.detalle2384Id);
    assert.equal(detalle.periodo_desde, 'Enero 2025');
    assert.equal(detalle.periodo_hasta, 'Diciembre 2025');
    assert.equal(detalle.concepto, 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026', 'el concepto original no se toca');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: recibo 2384 -- re-imputa el abono contra 2025 (modelo nuevo), no solo el texto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.reimputacion2384.reimputado, true);
    assert.equal(r.reimputacion2384.periodoImputados, 12, 'los 12 meses de 2025 quedan cubiertos');
    assert.equal(r.reimputacion2384.fifoImputados, 0, '192.000 alcanza exacto para 2025, sin sobrante FIFO');
    assert.equal(r.reimputacion2384.creditoId, null, 'sin sobrante, no genera crédito');

    const imps = db.prepare(`
      SELECT cg.anio, cg.mes, cg.tipo, i.monto FROM cartera_imputaciones i
      JOIN cartera_movimientos cg ON cg.id = i.cargo_id WHERE i.abono_id = ? ORDER BY cg.anio, cg.mes
    `).all(ids.abono2384Id);
    assert.equal(imps.length, 12);
    assert.ok(imps.every(i => i.tipo === 'CargoMensual' && i.anio === 2025 && i.monto === 16000),
      'ya no debe tocar ni los meses de 2026 ni la apertura opaca');

    const abono = db.prepare(`SELECT monto FROM cartera_movimientos WHERE id=?`).get(ids.abono2384Id);
    assert.equal(abono.monto, -192000, 'el monto del movimiento no cambia, solo a qué cargo queda atado');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: recibo 2384 -- idempotente (texto y re-imputación)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.correccion2384.corregido, false);
    assert.equal(r2.reimputacion2384.reimputado, false);
    const imps = db.prepare(`SELECT * FROM cartera_imputaciones WHERE abono_id=?`).all(ids.abono2384Id);
    assert.equal(imps.length, 12, 'no debe duplicar ni volver a re-imputar en la segunda corrida');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S010 -- elimina el abono del recibo 1659 y libera el período del 1825', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.recalculoS010.yaCorregido, false);
    const abono1659 = db.prepare(`SELECT * FROM cartera_movimientos WHERE id=?`).get(ids.abono1659Id);
    assert.equal(abono1659, undefined, 'el movimiento del recibo 1659 debe quedar eliminado');

    const detalle1825 = db.prepare(`SELECT periodo_desde, periodo_hasta FROM recibo_detalles WHERE id=?`).get(ids.detalle1825Id);
    assert.equal(detalle1825.periodo_desde, null);
    assert.equal(detalle1825.periodo_hasta, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S010 -- recalcula los 3 abonos restantes en orden cronológico (1825, 2151, 2302)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    // 24 meses x 10.000 = 240.000 causados. 1825 no tiene período declarado ("abono libre"):
    // desde el cambio de diseño 2026-08-04 NUNCA entra al FIFO, sus 30.000 van completos a
    // cuenta_creditos. 2151 (2024 completo) y 2302 (2025 completo) sí declaran período, cubren
    // sus propios 12 meses cada uno exacto (120.000 = 12x10.000), sin que 1825 les robe ningún
    // mes por delante -- por eso los 24 cargos quedan cubiertos con cero sobrante real.
    const repoCartera = new CarteraRepository(ctx.dbService);
    const { deudaExigible } = repoCartera.getSaldos(ids.S010);
    assert.equal(deudaExigible, 0, '240.000 causados quedan en 0: los 30.000 de más no bajan la deuda por su cuenta');
    assert.equal(repoCartera.getSaldoCreditoDisponible(ids.S010), 30000, 'los 30.000 del recibo 1825 quedan disponibles como crédito');

    const abono1825 = r.recalculoS010.abonos.find(a => a.numeroRecibo === RECALCULO_S010.numeroReciboLibre);
    assert.equal(abono1825.periodoImputados, 0, '1825 no tiene período: la pasada de MesesEspecificos ni corre');
    assert.equal(abono1825.fifoImputados, 0, '1825 sin período nunca entra al FIFO');
    assert.ok(abono1825.creditoId, 'el monto completo de 1825 generó un crédito');
    const movimiento1825 = db.prepare('SELECT monto, observaciones FROM cartera_movimientos WHERE id=?').get(abono1825.abonoId);
    assert.equal(movimiento1825.monto, 0, 'el Abono de 1825 queda en 0: nada se le imputó');
    assert.match(movimiento1825.observaciones, /convertido íntegro a saldo a favor/i,
      'un Abono en $0 debe explicar por qué en vez de quedar vacío');

    // Los otros dos SÍ generaron su crédito o cobertura vía período declarado, sin FIFO de por medio.
    for (const numeroRecibo of [2151, 2302]) {
      const abono = r.recalculoS010.abonos.find(a => a.numeroRecibo === numeroRecibo);
      assert.ok(abono.periodoImputados > 0, `${numeroRecibo} se cubre por período declarado`);
      assert.equal(abono.fifoImputados, 0, `${numeroRecibo} no necesitó FIFO: su período alcanzó exacto`);
    }

    const cargos = db.prepare(`
      SELECT m.id, m.anio, m.mes, m.monto, COALESCE((SELECT SUM(i.monto) FROM cartera_imputaciones i WHERE i.cargo_id=m.id),0) AS cubierto
      FROM cartera_movimientos m WHERE m.cuenta_id=? AND m.tipo='CargoMensual'
    `).all(ids.S010);
    assert.equal(cargos.length, 24);
    assert.ok(cargos.every(c => c.cubierto === c.monto), 'los 24 cargos deben quedar totalmente cubiertos');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S010 -- idempotente, correr dos veces no reintroduce el abono de 1659 ni duplica imputaciones', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.recalculoS010.yaCorregido, true);
    const repoCartera = new CarteraRepository(ctx.dbService);
    assert.equal(repoCartera.getSaldos(ids.S010).deudaExigible, 0);
    assert.equal(repoCartera.getSaldoCreditoDisponible(ids.S010), 30000, 'correr dos veces no duplica el crédito');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S044 -- corrige la apertura opaca a 0 y deja nota de por qué', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.correccionAperturaS044.corregido, true);
    const apertura = db.prepare(`SELECT monto, observaciones FROM cartera_movimientos WHERE id=?`).get(ids.aperturaS044Id);
    assert.equal(apertura.monto, 0);
    assert.match(apertura.observaciones, /pendiente del punto de agua/i);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: recibo 2229 -- corrige el período a enero-junio 2025 sin tocar el concepto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.correccionPeriodo2229.corregido, true);
    const detalle = db.prepare(`SELECT concepto, periodo_desde, periodo_hasta FROM recibo_detalles WHERE id=?`).get(ids.detalle2229Id);
    assert.equal(detalle.periodo_desde, 'Enero 2025');
    assert.equal(detalle.periodo_hasta, 'Junio 2025');
    assert.equal(detalle.concepto, 'CUOTA DE SOSTENIMIENTO ENERIO A JUNIO 2025', 'el concepto original (con el typo) no se toca');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: recibo 2229 -- reimputa contra enero-junio 2025 (con la apertura ya en 0, sin sobrante)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.reimputacion2229.reimputado, true);
    assert.equal(r.reimputacion2229.periodoImputados, 6, 'los 6 meses de enero-junio 2025 quedan cubiertos');
    assert.equal(r.reimputacion2229.fifoImputados, 0, '300.000 alcanza exacto para los 6 meses, sin sobrante FIFO');
    assert.equal(r.reimputacion2229.creditoId, null, 'sin sobrante, no genera crédito');

    const imps = db.prepare(`
      SELECT cg.anio, cg.mes, cg.tipo, i.monto FROM cartera_imputaciones i
      JOIN cartera_movimientos cg ON cg.id = i.cargo_id WHERE i.abono_id = ? ORDER BY cg.mes
    `).all(ids.abono2229Id);
    assert.equal(imps.length, 6);
    assert.ok(imps.every(i => i.tipo === 'CargoMensual' && i.anio === 2025 && i.monto === 50000),
      'ya no debe tocar la apertura opaca');
    assert.deepEqual(imps.map(i => i.mes), [1, 2, 3, 4, 5, 6]);

    const repoCartera = new CarteraRepository(ctx.dbService);
    const saldos = repoCartera.getSaldos(ids.S044);
    assert.equal(saldos.deudaExigible, 0, 'los 6 cargos de 2025 quedan totalmente cubiertos');
    assert.equal(saldos.saldoOpaco, 0, 'la apertura corregida a 0 ya no aporta saldo opaco');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S044/2229 -- idempotente (apertura, texto y re-imputación)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.correccionAperturaS044.corregido, false);
    assert.equal(r2.correccionPeriodo2229.corregido, false);
    assert.equal(r2.reimputacion2229.reimputado, false);

    const apertura = db.prepare(`SELECT monto FROM cartera_movimientos WHERE id=?`).get(ids.aperturaS044Id);
    assert.equal(apertura.monto, 0);
    const imps = db.prepare(`SELECT * FROM cartera_imputaciones WHERE abono_id=?`).all(ids.abono2229Id);
    assert.equal(imps.length, 6, 'no debe duplicar ni volver a re-imputar en la segunda corrida');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: falla ruidosamente si alguna de las 5 cuentas no existe en la base', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'S03311');
    // faltan C021, R080, R091, S0244

    assert.throws(() => ejecutarPaso9b({ dbService: ctx.dbService }), /no existe en la base/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
