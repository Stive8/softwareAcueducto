const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const {
  ejecutarPaso9b, CUENTAS_TARIFA_CORREGIDA, PROPIETARIO_S0244,
  REASIGNACION_RECIBO_2137, CORRECCION_PERIODO_RECIBO_2384, RECALCULO_S010,
  CORRECCION_APERTURA_S044, CORRECCION_PERIODO_RECIBO_2229,
  CAUSACION_S058, SUSPENSIONES_SIN_CARTERA, INACTIVA_FUSIONADA_S063, REDENCION_R007,
  CUENTAS_SUSPENDIDAS_SIN_RECAUSAR, FRAGMENTO_AJUSTE_ERRONEO_SUSPENDIDAS,
  CREDITO_R0942, RECALCULO_R0831, reimputarAbono
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

  // --- S058: conexión nueva, sin fila en CARTERA -- quedó con categoría "Sin clasificar" ---
  ids.S058 = sembrarCuenta(db, CAUSACION_S058.codigoCuenta);
  const sinClasificarId = db.prepare(`SELECT id FROM categorias WHERE nombre='Sin clasificar'`).get().id;
  ids.categoriaS058Id = db.prepare(
    `INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2026-01-31')`
  ).run(ids.S058, sinClasificarId).lastInsertRowid;

  // --- 7 cuentas sin cartera: mismo marcador sintético que puso la migración a TODAS las
  // cuentas por igual ("Estado inicial al migrar a cartera") -- es lo que hay que reemplazar.
  for (const item of SUSPENSIONES_SIN_CARTERA) {
    ids[item.codigoCuenta] = sembrarCuenta(db, item.codigoCuenta);
    db.prepare(`
      INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo)
      VALUES (?, 'Activo', '2026-06-27', 'Estado inicial al migrar a cartera')
    `).run(ids[item.codigoCuenta]);
  }

  // --- S063: fusionada con S0365, mismo marcador sintético que las 7 anteriores -- sin
  // ningún movimiento de cartera (reproduce el caso real: categoría "Sin clasificar", cero
  // CargoMensual, solo recibos viejos de 2019 que ya no importan).
  ids.S063 = sembrarCuenta(db, INACTIVA_FUSIONADA_S063.codigoCuenta);
  db.prepare(`
    INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo)
    VALUES (?, 'Activo', '2026-06-27', 'Estado inicial al migrar a cartera')
  `).run(ids.S063);

  // --- R007: crédito de apertura ($92.000) sin tocar + diciembre 2024 con $12.000 pendientes
  // (cubierto parcial $4.000, simulando el abono de 2026 que llegó hasta ahí por FIFO) --
  // reproduce el estado real encontrado en producción antes de la corrección 13.
  ids.R007 = sembrarCuenta(db, 'R007');
  const cargoDic2024R007Id = repo.crearMovimiento({
    cuentaId: ids.R007, fecha: '2024-12-01', tipo: 'CargoMensual', exigible: 1, monto: 16000, anio: 2024, mes: 12
  });
  ids.cargoDic2024R007Id = cargoDic2024R007Id;
  const abono2026R007Id = repo.crearMovimiento({
    cuentaId: ids.R007, fecha: '2026-04-11', tipo: 'Abono', exigible: 1, monto: -4000
  });
  repo.crearImputacion({ abonoId: abono2026R007Id, cargoId: cargoDic2024R007Id, monto: 4000 });
  ids.creditoAperturaR007Id = repo.crearCredito({
    cuentaId: ids.R007, tipo: 'Abono', monto: 92000, fecha: '2023-12-31',
    observaciones: 'Apertura opaca negativa al 31/12/2023: saldo a favor anterior al corte, redimible contra deuda de 2024+ (retrofit 2026-08-04)'
  });

  // --- 7 cuentas suspendidas que NO deben recausarse (corrección 14): reproduce el estado
  // real encontrado en producción -- CargoMensual correcto a $5.000 (categoría Finca, tarifa
  // vieja preservada a propósito) más un AjusteCategoria erróneo, mismo monto, que las dobla a
  // $10.000/mes. Dos meses por cuenta alcanzan para probar la detección y el borrado; no hace
  // falta reproducir los 31/12 reales de producción.
  ids.ajustesErroneosSuspendidas = {};
  for (const codigo of CUENTAS_SUSPENDIDAS_SIN_RECAUSAR) {
    const cuentaId = sembrarCuenta(db, codigo);
    ids[codigo] = cuentaId;
    const erroneos = [];
    for (const mes of [1, 2]) {
      repo.crearMovimiento({ cuentaId, fecha: `2024-0${mes}-01`, tipo: 'CargoMensual', exigible: 1, monto: 5000, anio: 2024, mes });
      erroneos.push(repo.crearMovimiento({
        cuentaId, fecha: '2026-08-11', tipo: 'AjusteCategoria', exigible: 1, monto: 5000, anio: 2024, mes,
        observaciones: `${FRAGMENTO_AJUSTE_ERRONEO_SUSPENDIDAS} (tarifa 2018-2023) en vez de $10.000 ` +
          '(tarifa Finca vigente desde 2024-01-01). Cuenta suspendida, sin cambio de servicio.'
      }));
    }
    ids.ajustesErroneosSuspendidas[codigo] = erroneos;
  }

  // --- R0942, recibo 2246 (corrección 15): transferencia real de $180.000, cargada al sistema
  // por $176.000 (11 meses x 16.000, abr-2025 a feb-2026), sin que los $4.000 queden en
  // ninguna parte.
  ids.R0942 = sembrarCuenta(db, 'R0942');
  for (let mes = 4; mes <= 12; mes++) {
    repo.crearMovimiento({ cuentaId: ids.R0942, fecha: `2025-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 16000, anio: 2025, mes });
  }
  for (const mes of [1, 2]) {
    repo.crearMovimiento({ cuentaId: ids.R0942, fecha: `2026-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 16000, anio: 2026, mes });
  }
  const r2246 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: CREDITO_R0942.numeroRecibo, cuentaId: ids.R0942, fecha: '2025-07-26',
    valor: 176000, concepto: 'CUOTA DE SOSTENIMIENTO ABRIL 2025 A FEBRERO 2026 (TRANSFERENCIA 19/06/2025 - $180,000 - SALDO A FAVOR 4,000)',
    periodoDesde: 'Abril 2025', periodoHasta: 'Febrero 2026'
  });
  const abono2246Id = repo.crearMovimiento({
    cuentaId: ids.R0942, fecha: '2025-06-19', tipo: 'Abono', exigible: 1, monto: -176000, reciboDetalleId: r2246.detalleId
  });
  const cargosR0942 = db.prepare(`SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' ORDER BY anio, mes`).all(ids.R0942);
  for (const c of cargosR0942) repo.crearImputacion({ abonoId: abono2246Id, cargoId: c.id, monto: 16000 });
  ids.abono2246Id = abono2246Id;

  // --- R0831, recibos 2159/2311/2407 (corrección 16): reproduce el estado real de producción
  // ANTES de cualquier corrección -- apertura opaca $32.000 + 31 meses de CargoMensual a
  // $4.000 (Jan-2024 a jul-2026, mismos 31 meses que la cuenta real a $16.000, escalado ÷4
  // para que la prueba sea manejable). Recibo 2159 ($25.000, "ABONO A DEUDA", sin período)
  // queda íntegro como crédito -- reimputarAbono nunca corre FIFO sin período. Recibos 2311
  // ($103.000, período declarado = solo diciembre-2025) y 2407 ($30.000, período ene-jul 2026)
  // se imputan tal como los dejó el paso10 real: 2311 cubre su mes declarado más un sobrante
  // por FIFO que, al no estar 2159 pagado, alcanza a cubrir ene-jul 2026 también -- dejando a
  // 2407 sin nada real contra qué imputarse, íntegro como crédito.
  ids.R0831 = sembrarCuenta(db, 'R0831');
  const aperturaR0831Id = repo.crearMovimiento({ cuentaId: ids.R0831, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 32000 });
  for (let cod = 2024 * 12; cod <= 2026 * 12 + 6; cod++) {
    const anio = Math.floor(cod / 12), mes = (cod % 12) + 1;
    repo.crearMovimiento({ cuentaId: ids.R0831, fecha: `${anio}-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 4000, anio, mes });
  }

  const r2159 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 2159, cuentaId: ids.R0831, fecha: '2025-03-29', valor: 25000, concepto: 'ABONO A DEUDA'
  });
  const abono2159Id = repo.crearMovimiento({
    cuentaId: ids.R0831, fecha: '2025-03-29', tipo: 'Abono', exigible: 1, monto: 0, reciboDetalleId: r2159.detalleId
  });
  repo.crearCredito({
    cuentaId: ids.R0831, tipo: 'Abono', monto: 25000, fecha: '2025-03-29',
    reciboDetalleId: r2159.detalleId, observaciones: 'Sobrante de imputación del recibo 2159: crédito no aplicado'
  });
  ids.abono2159Id = abono2159Id;
  ids.detalle2159Id = r2159.detalleId;
  ids.aperturaR0831Id = aperturaR0831Id;

  const r2311 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 2311, cuentaId: ids.R0831, fecha: '2025-10-25', valor: 103000,
    concepto: 'CUOTA DE SOSTENIMIENTO HASTA DICIEMBRE 2025 (TRANSFERENCIA 13/10/2025)',
    periodoDesde: 'Diciembre 2025', periodoHasta: 'Diciembre 2025'
  });
  const abono2311Id = repo.crearMovimiento({
    cuentaId: ids.R0831, fecha: '2025-10-13', tipo: 'Abono', exigible: 1, monto: -103000, reciboDetalleId: r2311.detalleId
  });
  // Con 2159 sin pagar nada, el FIFO de 2311 (período dic-2025 + sobrante) alcanza a cubrir la
  // apertura, ene-2024 a nov-2025 y ene-jul 2026 -- 1 (apertura) + 23 (meses 2024/2025) + 7
  // (2026) = 31 tramos x 4.000 = 124.000... pero 2311 solo trae 103.000: cubre apertura (32.000
  // real: 8x4.000) + los primeros meses hasta agotarse. Se reproduce vía reimputarAbono real
  // (mismo mecanismo que usa la corrección) para no tener que hacer la cuenta a mano.
  reimputarAbono(db, repo, {
    abonoId: abono2311Id, cuentaId: ids.R0831, monto: 103000, periodoDesde: '2025-12', periodoHasta: '2025-12'
  });
  ids.abono2311Id = abono2311Id;
  ids.detalle2311Id = r2311.detalleId;

  const r2407 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 2407, cuentaId: ids.R0831, fecha: '2026-02-07', valor: 30000,
    concepto: 'CUOTA DE SOSTENIMIENTO ENERO A JULIO 2026 (TRANSFERENCIA 30/01/026 $30,000) - SALDO A FAVOR 2,000',
    periodoDesde: 'Enero 2026', periodoHasta: 'Julio 2026'
  });
  const abono2407Id = repo.crearMovimiento({
    cuentaId: ids.R0831, fecha: '2026-01-30', tipo: 'Abono', exigible: 1, monto: -30000, reciboDetalleId: r2407.detalleId
  });
  reimputarAbono(db, repo, {
    abonoId: abono2407Id, cuentaId: ids.R0831, monto: 30000, periodoDesde: '2026-01', periodoHasta: '2026-07'
  });
  ids.abono2407Id = abono2407Id;
  ids.detalle2407Id = r2407.detalleId;

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

test('paso9b: S058 -- causa febrero a julio 2026 a 10.000 y corrige la categoría a Finca', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.correccionS058.categoriaCorregida, true);
    assert.equal(r.correccionS058.creados, 6, 'febrero a julio son 6 meses');

    const categoria = db.prepare(`
      SELECT cat.nombre FROM cuenta_categorias cc JOIN categorias cat ON cat.id = cc.categoria_id
      WHERE cc.id = ?
    `).get(ids.categoriaS058Id);
    assert.equal(categoria.nombre, 'Finca');

    const cargos = getCargos(db, ids.S058);
    assert.equal(cargos.length, 6);
    assert.deepEqual(cargos.map(c => c.mes), [2, 3, 4, 5, 6, 7]);
    assert.ok(cargos.every(c => c.anio === 2026 && c.monto === 10000));
    assert.ok(cargos.every(c => /mes siguiente a la instalacion/i.test(c.observaciones)));

    assert.equal(
      db.prepare(`SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=2026 AND mes=1`).get(ids.S058).n,
      0, 'enero (mes de la conexión) no se causa'
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S058 -- idempotente, correr dos veces no duplica cargos ni vuelve a marcar la categoría como corregida', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.correccionS058.categoriaCorregida, false);
    assert.equal(r2.correccionS058.creados, 6);
    assert.equal(getCargos(db, ids.S058).length, 6, 'no debe duplicar los 6 cargos en la segunda corrida');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: las 7 cuentas sin cartera quedan Suspendidas desde el mes siguiente a su último recibo, sin causar nada', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.suspensionesSinCartera.length, 7);
    assert.ok(r.suspensionesSinCartera.every(s => s.corregido === true));

    for (const item of SUSPENSIONES_SIN_CARTERA) {
      const cuenta = db.prepare('SELECT estado FROM cuentas WHERE id=?').get(ids[item.codigoCuenta]);
      assert.equal(cuenta.estado, 'Suspendido', `${item.codigoCuenta} debe quedar Suspendido en cuentas.estado`);

      const vigencias = db.prepare('SELECT estado, fecha_inicio, fecha_fin, motivo FROM cuenta_estados WHERE cuenta_id=?').all(ids[item.codigoCuenta]);
      assert.equal(vigencias.length, 1, `${item.codigoCuenta} debe quedar con una sola vigencia (el marcador sintético se reemplaza, no se apila)`);
      assert.equal(vigencias[0].estado, 'Suspendido');
      assert.equal(vigencias[0].fecha_inicio, item.fechaInicio);
      assert.equal(vigencias[0].fecha_fin, null);
      assert.match(vigencias[0].motivo, /sin fila en CARTERA/i);

      assert.equal(
        db.prepare(`SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id=?`).get(ids[item.codigoCuenta]).n,
        0, `${item.codigoCuenta} no debe tener ningún movimiento de cartera`
      );
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: las 7 suspensiones son idempotentes -- correr dos veces no duplica cuenta_estados', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.ok(r2.suspensionesSinCartera.every(s => s.corregido === false));
    for (const item of SUSPENSIONES_SIN_CARTERA) {
      const vigencias = db.prepare('SELECT * FROM cuenta_estados WHERE cuenta_id=?').all(ids[item.codigoCuenta]);
      assert.equal(vigencias.length, 1, `${item.codigoCuenta}: la segunda corrida no debe agregar una vigencia más`);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S063 (fusionada con S0365) queda Inactivo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.inactivaS063.corregido, true);

    const cuenta = db.prepare('SELECT estado FROM cuentas WHERE id=?').get(ids.S063);
    assert.equal(cuenta.estado, 'Inactivo');

    const vigencias = db.prepare('SELECT estado, fecha_inicio, fecha_fin, motivo FROM cuenta_estados WHERE cuenta_id=?').all(ids.S063);
    assert.equal(vigencias.length, 1, 'el marcador sintético se reemplaza, no se apila');
    assert.equal(vigencias[0].estado, 'Inactivo');
    assert.equal(vigencias[0].fecha_inicio, INACTIVA_FUSIONADA_S063.fechaInicio);
    assert.equal(vigencias[0].fecha_fin, null);
    assert.match(vigencias[0].motivo, /[Ff]usionada con S0365/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S063 -- correr dos veces no duplica cuenta_estados', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.inactivaS063.corregido, false);
    const vigencias = db.prepare('SELECT * FROM cuenta_estados WHERE cuenta_id=?').all(ids.S063);
    assert.equal(vigencias.length, 1, 'la segunda corrida no debe agregar una vigencia más');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R007 -- redime $12.000 del crédito contra el hueco real de diciembre 2024, deja $80.000 a favor', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.redencionR007.yaCorregido, false);
    assert.equal(r.redencionR007.monto, REDENCION_R007.montoARedimir);

    // Diciembre 2024 queda totalmente cubierto: los $4.000 que ya tenía (simulados en el
    // seed) más los $12.000 que redime esta corrección.
    const cubiertoDic2024 = db.prepare(
      `SELECT COALESCE(SUM(monto),0) AS total FROM cartera_imputaciones WHERE cargo_id=?`
    ).get(ids.cargoDic2024R007Id).total;
    assert.equal(cubiertoDic2024, 16000);

    // deudaExigible de R007 queda en 0 (nada más pendiente, según el seed).
    const { deudaExigible } = repo.getSaldos(ids.R007);
    assert.equal(deudaExigible, 0);

    // El crédito de apertura ($92.000) no se toca -- se agrega una fila 'Aplicado' aparte.
    const creditos = db.prepare(
      `SELECT tipo, monto, abono_movimiento_id, fecha, observaciones FROM cuenta_creditos WHERE cuenta_id=? ORDER BY id`
    ).all(ids.R007);
    assert.equal(creditos.length, 2);
    assert.equal(creditos[0].tipo, 'Abono');
    assert.equal(creditos[0].monto, 92000);
    assert.equal(creditos[1].tipo, 'Aplicado');
    assert.equal(creditos[1].monto, 12000);
    assert.equal(creditos[1].fecha, REDENCION_R007.fecha);
    assert.match(creditos[1].observaciones, /recibo 1773/);
    assert.match(creditos[1].observaciones, /TENIA SALDO A FAVOR DE \$92\.000/);

    // Saldo a favor disponible: 92.000 - 12.000 = 80.000, como pidió el usuario.
    const saldoDisponible = repo.getSaldoCreditoDisponible(ids.R007);
    assert.equal(saldoDisponible, 80000);

    // El nuevo Abono queda trazado hasta el recibo 1773 vía la observación, fechado cuando
    // pasó en la realidad (no cuando corrió esta corrección).
    const nuevoAbono = db.prepare(
      `SELECT fecha, monto, observaciones FROM cartera_movimientos WHERE id=?`
    ).get(r.redencionR007.abonoId);
    assert.equal(nuevoAbono.fecha, '2024-03-16');
    assert.equal(nuevoAbono.monto, -12000);
    assert.match(nuevoAbono.observaciones, /recibo 1773/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R007 -- idempotente, correr dos veces no duplica la redención ni deja el saldo en negativo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.redencionR007.yaCorregido, true);

    const creditos = db.prepare(`SELECT COUNT(*) AS n FROM cuenta_creditos WHERE cuenta_id=?`).get(ids.R007).n;
    assert.equal(creditos, 2, 'la segunda corrida no debe agregar otra fila Aplicado');

    const abonos = db.prepare(
      `SELECT COUNT(*) AS n FROM cartera_movimientos WHERE cuenta_id=? AND tipo='Abono' AND fecha='2024-03-16'`
    ).get(ids.R007).n;
    assert.equal(abonos, 1, 'la segunda corrida no debe crear otro movimiento de redención');

    assert.equal(repo.getSaldoCreditoDisponible(ids.R007), 80000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R007 -- se detiene con un error si diciembre 2024 no tiene el pendiente esperado (no adivina cuánto redimir)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    // Alguien ya cubrió parte del hueco por otra vía -- el pendiente real ya no es $12.000.
    const abonoExtra = repo.crearMovimiento({ cuentaId: ids.R007, fecha: '2026-08-01', tipo: 'Abono', exigible: 1, monto: -5000 });
    repo.crearImputacion({ abonoId: abonoExtra, cargoId: ids.cargoDic2024R007Id, monto: 5000 });

    assert.throws(() => ejecutarPaso9b({ dbService: ctx.dbService }), /R007.*se esperaba/s);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: las 7 suspendidas -- borra el AjusteCategoria erróneo, deja el CargoMensual a 5.000 intacto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.limpiezaSuspendidas.length, 7);
    for (const codigo of CUENTAS_SUSPENDIDAS_SIN_RECAUSAR) {
      const entrada = r.limpiezaSuspendidas.find(l => l.codigo === codigo);
      assert.equal(entrada.borradas, 2, `${codigo}: debe borrar los 2 AjusteCategoria erróneos sembrados`);

      const cargos = getCargos(db, ids[codigo]);
      assert.equal(cargos.length, 2, `${codigo}: el CargoMensual a 5.000 no se toca`);
      assert.ok(cargos.every(c => c.monto === 5000), `${codigo}: ningún CargoMensual debe quedar en 10.000`);

      const ajustesRestantes = db.prepare(
        `SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id=? AND tipo='AjusteCategoria'`
      ).get(ids[codigo]).n;
      assert.equal(ajustesRestantes, 0, `${codigo}: no debe quedar ningún AjusteCategoria`);

      const { deudaExigible } = repo.getSaldos(ids[codigo]);
      assert.equal(deudaExigible, 10000, `${codigo}: 2 meses x 5.000, no 10.000 (el doble)`);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: las 7 suspendidas -- idempotente, correr dos veces no falla ni vuelve a borrar nada', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.ok(r2.limpiezaSuspendidas.every(l => l.borradas === 0), 'la segunda corrida no debe encontrar nada que borrar');
    for (const codigo of CUENTAS_SUSPENDIDAS_SIN_RECAUSAR) {
      assert.equal(getCargos(db, ids[codigo]).length, 2, `${codigo}: sigue con solo los 2 CargoMensual originales`);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: las 7 suspendidas -- se detiene con un error si el AjusteCategoria erróneo tiene una imputación real encima', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    // Alguien pagó (imposible en la realidad para una cuenta abandonada, pero la corrección
    // debe negarse a borrar a ciegas si pasara).
    const ajusteId = ids.ajustesErroneosSuspendidas['R002'][0];
    const abonoId = repo.crearMovimiento({ cuentaId: ids.R002, fecha: '2026-08-01', tipo: 'Abono', exigible: 1, monto: -1000 });
    repo.crearImputacion({ abonoId, cargoId: ajusteId, monto: 1000 });

    assert.throws(() => ejecutarPaso9b({ dbService: ctx.dbService }), /R002.*imputaci/s);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R0942 -- crea el saldo a favor de $4.000 que el recibo 2246 no registró', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.creditoR0942.yaCorregido, false);
    assert.equal(r.creditoR0942.monto, CREDITO_R0942.monto);
    assert.equal(repo.getSaldoCreditoDisponible(ids.R0942), 4000);

    const credito = db.prepare(`SELECT * FROM cuenta_creditos WHERE cuenta_id=?`).get(ids.R0942);
    assert.equal(credito.tipo, 'Abono');
    assert.equal(credito.monto, 4000);
    assert.equal(credito.fecha, '2025-06-19');
    assert.equal(credito.abono_movimiento_id, ids.abono2246Id);
    assert.match(credito.observaciones, /recibo 2246/);
    assert.match(credito.observaciones, /\$180\.000/);

    // el abono y sus imputaciones no se tocan -- el crédito es plata aparte, no una re-imputación
    const abono = db.prepare(`SELECT monto FROM cartera_movimientos WHERE id=?`).get(ids.abono2246Id);
    assert.equal(abono.monto, -176000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R0942 -- idempotente, correr dos veces no duplica el crédito', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.creditoR0942.yaCorregido, true);
    const creditos = db.prepare(`SELECT COUNT(*) n FROM cuenta_creditos WHERE cuenta_id=?`).get(ids.R0942).n;
    assert.equal(creditos, 1);
    assert.equal(repo.getSaldoCreditoDisponible(ids.R0942), 4000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R0831 -- recalcula 2159/2311/2407 en orden cronológico: apertura y exigible en $0, $2.000 de saldo a favor', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    const CarteraService = require('../../src/services/CarteraService');
    const service = new CarteraService(ctx.dbService);

    // precondición: reproduce el bug real -- 2159 sin ninguna imputación, íntegro en crédito.
    const imputado2159Antes = db.prepare(`SELECT COALESCE(SUM(monto),0) s FROM cartera_imputaciones WHERE abono_id=?`).get(ids.abono2159Id).s;
    assert.equal(imputado2159Antes, 0);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.recalculoR0831.yaCorregido, false);

    // 2159 ($25.000, "ABONO A DEUDA") ahora sí corre FIFO contra el pool combinado -- cierra
    // la apertura opaca completa (32.000/4.000 = 8 meses equivalentes) más lo que alcance de
    // 2024+.
    const imputado2159Despues = db.prepare(`SELECT COALESCE(SUM(monto),0) s FROM cartera_imputaciones WHERE abono_id=?`).get(ids.abono2159Id).s;
    assert.equal(imputado2159Despues, 25000, 'los 25.000 de "ABONO A DEUDA" ahora sí se imputan, no quedan en crédito');

    const estado = service.getEstadoCartera(ids.R0831);
    assert.equal(estado.deudaAntes2024, 0, 'la apertura opaca queda cerrada completa');
    assert.equal(estado.deudaExigible, 0, 'ene-2024 a jul-2026 quedan totalmente cubiertos');
    assert.deepEqual(estado.cubiertoHasta, { anio: 2026, mes: 7 });
    assert.equal(estado.saldoCreditoDisponible, 2000, 'exactamente el sobrante que declaraba el recibo 2407 (30.000 - 7x4.000), ni un peso más');

    // el crédito original de 2159 (el bug) ya no existe
    const creditoViejo2159 = db.prepare(`SELECT id FROM cuenta_creditos WHERE recibo_detalle_id=?`).get(ids.detalle2159Id);
    assert.equal(creditoViejo2159, undefined);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R0831 -- idempotente, correr dos veces no vuelve a recalcular ni duplica créditos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const CarteraService = require('../../src/services/CarteraService');
    const service = new CarteraService(ctx.dbService);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.recalculoR0831.yaCorregido, true);
    const creditos = db.prepare(`SELECT COUNT(*) n FROM cuenta_creditos WHERE cuenta_id=?`).get(ids.R0831).n;
    assert.equal(creditos, 1, 'la segunda corrida no debe duplicar ni agregar créditos');

    const estado = service.getEstadoCartera(ids.R0831);
    assert.equal(estado.deudaAntes2024, 0);
    assert.equal(estado.deudaExigible, 0);
    assert.equal(estado.saldoCreditoDisponible, 2000, 'no debe cambiar en la segunda corrida');
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
