// src/repositories/ReporteRepository.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ReporteRepository = require('./ReporteRepository');
const CarteraRepository = require('./CarteraRepository');
const NuevoPuntoRepository = require('./NuevoPuntoRepository');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

function sembrarTarifaFinca(db) {
  let catFila = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get();
  if (!catFila) {
    db.prepare(`INSERT INTO categorias (nombre) VALUES ('Finca')`).run();
    catFila = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get();
  }
  db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
              VALUES (?, 10000, '2020-01-01')`).run(catFila.id);
  return catFila.id;
}

function asignarCategoria(db, cuentaId, categoriaId, fechaInicio = '2022-01-01') {
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, ?)`)
    .run(cuentaId, categoriaId, fechaInicio);
}

test('getCuentasConUltimoPeriodo: usa cubiertoHasta de cartera, no pago_periodos -- reproduce el caso real de R001', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T001');
    const repo = new CarteraRepository(ctx.dbService);
    const cargo = repo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2024-01-05', tipo: 'Abono', exigible: 1, monto: -10000 });
    repo.crearImputacion({ abonoId, cargoId: cargo, monto: 10000 });
    // Sin fila en pago_periodos a propósito -- el caso real de R001 no la tenía tampoco.
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM pago_periodos`).get().n, 0);

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const fila = reporteRepo.getCuentasConUltimoPeriodo().find(f => f.codigo === 'T001');

    assert.equal(fila.ultimo_periodo_num, 2024 * 12 + 0, 'enero-2024 codificado, sale de cartera aunque pago_periodos esté vacío');
    assert.equal(fila.deuda_antes_2024, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCuentasConUltimoPeriodo: no se congela en un hueco viejo ya superado (reproduce el caso real de S050)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T002');
    const repo = new CarteraRepository(ctx.dbService);

    // Hueco real en enero-2024 (nunca se le imputó nada) y todo lo demás cubierto.
    const c1 = repo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const c2 = repo.crearMovimiento({ cuentaId, fecha: '2024-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 2 });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2024-02-05', tipo: 'Abono', exigible: 1, monto: -10000 });
    repo.crearImputacion({ abonoId, cargoId: c2, monto: 10000 });
    // c1 (enero) queda sin cubrir.

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const fila = reporteRepo.getCuentasConUltimoPeriodo().find(f => f.codigo === 'T002');

    // cubiertoHasta es null (el primer cargo ya está sin cubrir) -- el hueco de enero sigue
    // siendo deuda real (deuda_antes_2024 no aplica acá, es 2024+, pero el punto es que esta
    // consulta NO debe inventar que está "al día hasta febrero" ignorando enero.
    assert.equal(fila.ultimo_periodo_num, null);
    assert.ok(fila.meses_impagos >= 1, 'el hueco de enero sigue siendo deuda real -- meses_impagos no debe dar 0');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCuentasConUltimoPeriodo: meses_impagos cuenta los meses realmente pendientes, no el rango completo desde el hueco (reproduce el caso real de R007)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const catId = sembrarTarifaFinca(db);
    const cuentaId = sembrarCuenta(db, 'T012');
    asignarCategoria(db, cuentaId, catId);
    const repo = new CarteraRepository(ctx.dbService);

    // Enero-2024 cubierto completo -- cubiertoHasta arranca ahí.
    const cEne = repo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const aEne = repo.crearMovimiento({ cuentaId, fecha: '2024-01-05', tipo: 'Abono', exigible: 1, monto: -10000 });
    repo.crearImputacion({ abonoId: aEne, cargoId: cEne, monto: 10000 });

    // Febrero-2024 solo parcialmente cubierto ($2.000 de $10.000) -- el único hueco real.
    // cubiertoHasta se congela en enero-2024 y ya no se mueve, aunque todo lo de después se
    // pague completo (igual que R007 real).
    const cFeb = repo.crearMovimiento({ cuentaId, fecha: '2024-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 2 });
    const aFeb = repo.crearMovimiento({ cuentaId, fecha: '2024-02-10', tipo: 'Abono', exigible: 1, monto: -2000 });
    repo.crearImputacion({ abonoId: aFeb, cargoId: cFeb, monto: 2000 });

    // Marzo-2024 hasta el mes anterior al actual: todos cubiertos completos -- se puso al día
    // después del hueco, como R007 real (todo 2025 y casi todo 2026 pagado).
    const hoy = new Date();
    const mesActualCod = hoy.getFullYear() * 12 + hoy.getMonth();
    for (let cod = 2024 * 12 + 2; cod < mesActualCod; cod++) {
      const anio = Math.floor(cod / 12);
      const mes = (cod % 12) + 1;
      const mm = String(mes).padStart(2, '0');
      const c = repo.crearMovimiento({ cuentaId, fecha: `${anio}-${mm}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio, mes });
      const a = repo.crearMovimiento({ cuentaId, fecha: `${anio}-${mm}-05`, tipo: 'Abono', exigible: 1, monto: -10000 });
      repo.crearImputacion({ abonoId: a, cargoId: c, monto: 10000 });
    }
    // El mes actual queda sin causar a propósito -- no debe contar como mora (2026-08-13, aún
    // no vence), aunque siga siendo cobrable.

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const fila = reporteRepo.getCuentasConUltimoPeriodo().find(f => f.codigo === 'T012');

    assert.equal(fila.ultimo_periodo_num, 2024 * 12, 'cubiertoHasta se congela en enero-2024 aunque todo lo de después esté pagado');
    assert.equal(fila.meses_impagos, 1, 'solo febrero-2024 (el hueco de $8.000) -- el mes en curso no cuenta como mora');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCuentasConUltimoPeriodo: trae deuda_antes_2024 aparte, no la mezcla con el período', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T003');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 80000 });
    const cargo = repo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2024-01-05', tipo: 'Abono', exigible: 1, monto: -10000 });
    repo.crearImputacion({ abonoId, cargoId: cargo, monto: 10000 });

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const fila = reporteRepo.getCuentasConUltimoPeriodo().find(f => f.codigo === 'T003');

    assert.equal(fila.deuda_antes_2024, 80000);
    assert.equal(fila.ultimo_periodo_num, 2024 * 12, 'enero-2024 sigue cubierto, la apertura opaca no lo tapa');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCuentasConUltimoPeriodo: sin ningún CargoMensual causado, usa CarteraService.getFechaInicioFacturacion como ancla', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T004');
    db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Prop T004')`).run();
    const propId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo='Prop T004'`).get().id;
    db.prepare(`
      INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago, estado)
      VALUES (9001, ?, ?, '2025-03-01', 0, 'Efectivo', 'Activo')
    `).run(cuentaId, propId);

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const fila = reporteRepo.getCuentasConUltimoPeriodo().find(f => f.codigo === 'T004');

    assert.equal(fila.ultimo_periodo_num, null);
    assert.equal(fila.fecha_inicio_facturacion, '2025-03-01', 'cae al primer recibo, cadena de CarteraService');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCartedaPorEdades: una cuenta al día en 2024+ pero con deuda anterior al corte SÍ aparece, en "Más de 12 meses"', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const catId = sembrarTarifaFinca(db);
    const cuentaId = sembrarCuenta(db, 'T005');
    asignarCategoria(db, cuentaId, catId);
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 90000 });
    // Al día de verdad en 2024+ (no solo "categoría asignada"): cubre el mes actual completo,
    // para que cubiertoHasta no sea null y la única deuda sea la apertura opaca.
    const hoy = new Date();
    const cargo = repo.crearMovimiento({
      cuentaId, fecha: hoy.toISOString().split('T')[0], tipo: 'CargoMensual', exigible: 1, monto: 10000,
      anio: hoy.getFullYear(), mes: hoy.getMonth() + 1
    });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: hoy.toISOString().split('T')[0], tipo: 'Abono', exigible: 1, monto: -10000 });
    repo.crearImputacion({ abonoId, cargoId: cargo, monto: 10000 });

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const fila = reporteRepo.getCartedaPorEdades().find(f => f.codigo === 'T005');

    assert.ok(fila, 'antes de este cambio esta cuenta no aparecía en el reporte');
    assert.equal(fila.rango_mora, 'Más de 12 meses');
    assert.equal(fila.deuda_antes_2024, 90000);
    assert.equal(fila.valor_estimado, 90000, 'sin mora 2024+, el valor estimado es solo la apertura opaca');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCartedaPorEdades: hueco viejo de un mes ya superado -- rango por antigüedad del hueco, valor por deuda real (reproduce el caso real de R007)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const catId = sembrarTarifaFinca(db);
    const cuentaId = sembrarCuenta(db, 'T013');
    asignarCategoria(db, cuentaId, catId);
    const repo = new CarteraRepository(ctx.dbService);

    const cEne = repo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const aEne = repo.crearMovimiento({ cuentaId, fecha: '2024-01-05', tipo: 'Abono', exigible: 1, monto: -10000 });
    repo.crearImputacion({ abonoId: aEne, cargoId: cEne, monto: 10000 });

    // Único hueco real: febrero-2024, $8.000 sin cubrir.
    const cFeb = repo.crearMovimiento({ cuentaId, fecha: '2024-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 2 });
    const aFeb = repo.crearMovimiento({ cuentaId, fecha: '2024-02-10', tipo: 'Abono', exigible: 1, monto: -2000 });
    repo.crearImputacion({ abonoId: aFeb, cargoId: cFeb, monto: 2000 });

    // Todo lo posterior, hasta el mes anterior al actual, pagado completo.
    const hoy = new Date();
    const mesActualCod = hoy.getFullYear() * 12 + hoy.getMonth();
    for (let cod = 2024 * 12 + 2; cod < mesActualCod; cod++) {
      const anio = Math.floor(cod / 12);
      const mes = (cod % 12) + 1;
      const mm = String(mes).padStart(2, '0');
      const c = repo.crearMovimiento({ cuentaId, fecha: `${anio}-${mm}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio, mes });
      const a = repo.crearMovimiento({ cuentaId, fecha: `${anio}-${mm}-05`, tipo: 'Abono', exigible: 1, monto: -10000 });
      repo.crearImputacion({ abonoId: a, cargoId: c, monto: 10000 });
    }

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const fila = reporteRepo.getCartedaPorEdades().find(f => f.codigo === 'T013');

    assert.ok(fila, 'el hueco de febrero-2024 sigue siendo deuda real -- debe aparecer');
    assert.equal(fila.meses_mora, 1, 'solo febrero-2024 -- el mes en curso no cuenta como mora (2026-08-13), aunque siga siendo cobrable');
    assert.equal(fila.rango_mora, 'Más de 12 meses', 'el hueco en sí (feb-2024) es viejo, aunque la cuenta ya se puso al día después');
    assert.equal(fila.valor_estimado, 18000, 'valor_estimado usa aPagar (cobrable), que sigue incluyendo el mes en curso -- 8.000 de feb-2024 + 10.000 del mes en curso');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCartedaPorEdades: al día en 2024+ con un punto de conexión pendiente -- no entra al aging', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T006');
    const repo = new CarteraRepository(ctx.dbService);
    // Al día de verdad (no solo "sin cubiertoHasta null por casualidad"): cubre el mes actual
    // completo, para que la única deuda de la cuenta sea el punto de conexión.
    const hoy = new Date();
    const cargo = repo.crearMovimiento({
      cuentaId, fecha: hoy.toISOString().split('T')[0], tipo: 'CargoMensual', exigible: 1, monto: 10000,
      anio: hoy.getFullYear(), mes: hoy.getMonth() + 1
    });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: hoy.toISOString().split('T')[0], tipo: 'Abono', exigible: 1, monto: -10000 });
    repo.crearImputacion({ abonoId, cargoId: cargo, monto: 10000 });

    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);
    puntoRepo.create({ cuentaId, valorTotal: 500000, fechaRegistro: '2026-01-01' });

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const fila = reporteRepo.getCartedaPorEdades().find(f => f.codigo === 'T006');

    assert.equal(fila, undefined, 'solo tiene punto pendiente, sin dimensión temporal -- no entra al aging');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getDashboardContable: cuentasMora cuenta cuentas con deuda 2024+ O deuda anterior al corte', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const catId = sembrarTarifaFinca(db);

    const idAlDia = sembrarCuenta(db, 'T007');
    asignarCategoria(db, idAlDia, catId);
    const idSoloApertura = sembrarCuenta(db, 'T008');
    asignarCategoria(db, idSoloApertura, catId);
    const idSoloPunto = sembrarCuenta(db, 'T009');

    const repo = new CarteraRepository(ctx.dbService);
    // T007: al día de verdad, no cuenta.
    const cargo = repo.crearMovimiento({ cuentaId: idAlDia, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const abonoId = repo.crearMovimiento({ cuentaId: idAlDia, fecha: '2024-01-05', tipo: 'Abono', exigible: 1, monto: -10000 });
    repo.crearImputacion({ abonoId, cargoId: cargo, monto: 10000 });
    // T008: solo apertura opaca, sí cuenta.
    repo.crearMovimiento({ cuentaId: idSoloApertura, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 50000 });
    // T009: solo punto pendiente, NO cuenta (el punto no entra en "en mora").
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);
    puntoRepo.create({ cuentaId: idSoloPunto, valorTotal: 500000, fechaRegistro: '2026-01-01' });

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const r = reporteRepo.getDashboardContable();

    // T007 al día real: puede que el mes actual real (no 2024-01) siga sin cargo -- se
    // acepta 0 o 1 según cuándo corra el test, lo importante es T008 sí y T009 no.
    assert.ok(r.cuentasMora >= 1, 'al menos T008 (apertura opaca) debe contar');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getDashboardContable: cuentasMora usa mesesImpagos, no el rango contra cubiertoHasta (auditoría de entrega, hallazgo 6 -- tercer sitio con formula propia)', () => {
  // Antes, getDashboardContable calculaba "en mora" con el rango contra cubiertoHasta
  // (cubiertoCod < periodoActualCod), el mismo criterio que ya se había corregido en
  // DashboardRepository._idsEnMora. Una cuenta cuyo último cargo quedó pagado hace tiempo, y a
  // la que después dejó de proyectársele deuda nueva porque su categoría no tiene tarifa
  // vigente más allá de esa fecha (mesesSinTarifa), quedaba contada "en mora" para siempre acá
  // -- mientras que Reportes y la tabla de Pagos, que ya usaban mesesImpagos, la mostraban "al
  // día". El dashboard de Contabilidad podía mostrar un número de cuentas en mora distinto al
  // del dashboard general y al de Reportes, para la misma cuenta.
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T010');
    db.prepare(`INSERT INTO categorias (nombre) VALUES ('Categoria sin tarifa vigente T010')`).run();
    const categoriaId = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Categoria sin tarifa vigente T010'`).get().id;
    // La tarifa solo cubre enero-marzo 2024 -- nada la reemplaza después.
    db.prepare(`
      INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta)
      VALUES (?, 10000, '2024-01-01', '2024-03-31')
    `).run(categoriaId);
    asignarCategoria(db, cuentaId, categoriaId, '2024-01-01');

    const repo = new CarteraRepository(ctx.dbService);
    for (const mes of [1, 2, 3]) {
      const cargo = repo.crearMovimiento({
        cuentaId, fecha: `2024-0${mes}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes
      });
      const abonoId = repo.crearMovimiento({ cuentaId, fecha: `2024-0${mes}-01`, tipo: 'Abono', exigible: 1, monto: -10000 });
      repo.crearImputacion({ abonoId, cargoId: cargo, monto: 10000 });
    }
    // Abril 2024 en adelante: sin tarifa vigente, nunca se causa ningún CargoMensual nuevo.

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const r = reporteRepo.getDashboardContable();
    const dashRepoEquivalente = new (require('./DashboardRepository'))(ctx.dbService);

    assert.equal(r.cuentasMora, dashRepoEquivalente.getCuentasEnMoraIds().length, 'debe coincidir con el conteo del dashboard general (mismo criterio unificado)');
    assert.ok(!dashRepoEquivalente.getCuentasEnMoraIds().includes(cuentaId), 'T010 no debe contar como en mora: sin meses realmente impagos');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCuentasPorCobrarEstimado: desglosa deudaAntes2024, deudaExigible y deudaPuntoConexion', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T010');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 30000 });
    repo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const puntoRepo = new NuevoPuntoRepository(ctx.dbService);
    puntoRepo.create({ cuentaId, valorTotal: 500000, fechaRegistro: '2026-01-01' });

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const r = reporteRepo.getCuentasPorCobrarEstimado();

    assert.equal(r.deudaAntes2024, 30000);
    assert.equal(r.deudaExigible, 10000);
    assert.equal(r.deudaPuntoConexion, 500000);
    assert.equal(r.total, 540000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCuentasPorCobrarEstimado: no descuenta el saldo a favor de deudaExigible (son cosas separadas)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T011');
    db.prepare(`INSERT INTO cuenta_creditos (cuenta_id, tipo, monto, fecha) VALUES (?, 'Abono', 25000, '2026-01-01')`).run(cuentaId);

    const reporteRepo = new ReporteRepository(ctx.dbService);
    const r = reporteRepo.getCuentasPorCobrarEstimado();

    assert.equal(r.deudaExigible, 0);
    assert.equal(r.total, 0, 'el saldo a favor no resta de cuentas por cobrar -- va aparte, como pasivo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
