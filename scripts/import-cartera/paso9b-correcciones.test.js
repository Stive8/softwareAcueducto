const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const {
  ejecutarPaso9b, CUENTAS_TARIFA_CORREGIDA, PROPIETARIO_S0244,
  REASIGNACION_RECIBO_2137, CORRECCION_PERIODO_RECIBO_2384, RECALCULO_S010,
  CORRECCION_APERTURA_S044, CORRECCION_PERIODO_RECIBO_2229,
  SUSPENSIONES_SIN_CARTERA, INACTIVA_FUSIONADA_S063, REDENCION_R007,
  REDENCION_R007_2026, REDENCIONES_REAJUSTE_2024, REDENCION_S023, REDENCIONES_HUECO_TEXTUAL_2026,
  CUENTAS_SUSPENDIDAS_SIN_RECAUSAR, FRAGMENTO_AJUSTE_ERRONEO_SUSPENDIDAS,
  CREDITO_R0942, RECALCULO_R0831, reimputarAbono, MERGE_R0081_S058, SUSPENSION_INCOBRABLES,
  APERTURA_INCOBRABLES, CUENTAS_NUEVAS_2026, VALOR_PUNTO_NUEVO_2026,
  inferirPeriodoDeTexto, derivarPeriodoCorrecto, formatearPeriodoTexto
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

  // S0244 necesita una apertura opaca real (como en producción, $595.000) para que la corrección
  // 28 (recibo faltante 1284) tenga contra qué aplicarse -- si no, su FIFO de respaldo cae sobre
  // el CargoMensual de 2024 en vez de la apertura, y choca con el borrado/recreado incondicional
  // de la corrección 2 en la segunda corrida.
  repo.crearMovimiento({ cuentaId: ids.S0244, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 100000 });

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

  // --- R0081/S058: cuenta duplicada -- S058 (importación histórica) y R0081 (cuenta real, con
  // recibo del punto y CargoMensual propio, idénticos por casualidad a los de S058 porque ambas
  // cobran la misma deuda real dos veces). ---
  ids.S058 = sembrarCuenta(db, MERGE_R0081_S058.codigoOrigen);
  ids.R0081 = sembrarCuenta(db, MERGE_R0081_S058.codigoDestino);
  const financaCategoriaId = db.prepare(`SELECT id FROM categorias WHERE nombre='Sin clasificar'`).get().id;
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2026-01-31')`).run(ids.S058, financaCategoriaId);
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2023-12-31')`).run(ids.R0081, financaCategoriaId);
  db.prepare(`INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo) VALUES (?, 'Activo', '2026-06-27', 'Estado inicial al migrar a cartera')`).run(ids.S058);
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2026-01-31')`).run(ids.S058, propietarioId);
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2023-12-31')`).run(ids.R0081, propietarioId);
  const rPunto = sembrarRecibo(db, propietarioId, {
    numeroRecibo: MERGE_R0081_S058.numeroReciboPunto, cuentaId: ids.S058, fecha: '2026-01-31',
    valor: 500000, concepto: 'PAGO DE PUNTO NUEVO'
  });
  ids.reciboPuntoId = rPunto.reciboId;
  db.prepare(`
    INSERT INTO nuevos_puntos (cuenta_id, valor_total, saldo_pendiente, fecha_registro, estado)
    VALUES (?, 500000, 0, '2026-01-31', 'Pagado')
  `).run(ids.S058);
  for (const cuentaId of [ids.S058, ids.R0081]) {
    for (const mes of [2, 3]) {
      repo.crearMovimiento({ cuentaId, fecha: `2026-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes });
    }
  }

  // --- S0312: recibos 2191 y 2362, sembrados en el estado erróneo real (ya imputados contra
  // meses equivocados, como quedaron cuando el paso 10 corrió con el recibo 2137 todavía asignado
  // a esta cuenta) -- para que la corrección 24 tenga algo real que deshacer y reaplicar. Reusa
  // la cuenta S0312 que ya sembró el bloque del recibo 2137, más arriba.
  repo.crearMovimiento({ cuentaId: ids.S0312, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 40000 });
  for (const mes of [1, 2, 4, 5, 6]) {
    repo.crearMovimiento({ cuentaId: ids.S0312, fecha: `2025-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2025, mes });
  }
  const aperturaS0312 = db.prepare(`SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND tipo='AperturaOpaca'`).get(ids.S0312);
  const cargoS0312 = mes => db.prepare(`SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND anio=2025 AND mes=?`).get(ids.S0312, mes).id;

  const r2191 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 2191, cuentaId: ids.S0312, fecha: '2025-05-03', valor: 30000,
    concepto: 'CUOTA DE SOSTENIMIENTO ENERO A MARZO 2025', periodoDesde: 'Enero 2025', periodoHasta: 'Marzo 2025'
  });
  const abono2191Id = repo.crearMovimiento({
    cuentaId: ids.S0312, fecha: '2025-05-03', tipo: 'Abono', exigible: 1, monto: -30000, reciboDetalleId: r2191.detalleId
  });
  // Estado erróneo real: el período (enero-marzo) no tenía nada pendiente contra qué aplicarse
  // (el 2137 ya lo había cubierto), así que el FIFO de respaldo lo desvió a mayo-junio + apertura.
  repo.crearImputacion({ abonoId: abono2191Id, cargoId: cargoS0312(5), monto: 10000 });
  repo.crearImputacion({ abonoId: abono2191Id, cargoId: cargoS0312(6), monto: 10000 });
  repo.crearImputacion({ abonoId: abono2191Id, cargoId: aperturaS0312.id, monto: 10000 });
  ids.abono2191Id = abono2191Id;

  const r2362 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 2362, cuentaId: ids.S0312, fecha: '2026-01-03', valor: 50000,
    concepto: 'CUOTA DE SOSTENIMIENTO ABRIL 2025 A DICIEMBRE 2026', periodoDesde: 'Abril 2025', periodoHasta: 'Diciembre 2026'
  });
  const abono2362Id = repo.crearMovimiento({
    cuentaId: ids.S0312, fecha: '2026-01-03', tipo: 'Abono', exigible: 1, monto: 0, reciboDetalleId: r2362.detalleId
  });
  repo.crearCredito({ cuentaId: ids.S0312, tipo: 'Abono', monto: 50000, fecha: '2026-01-03', reciboDetalleId: r2362.detalleId, observaciones: 'Sobrante de imputación: crédito no aplicado' });
  ids.abono2362Id = abono2362Id;
  ids.aperturaS0312Id = aperturaS0312.id;

  // --- R049: hueco real enero-mayo 2025, con $100.000 de crédito disponible para redimir ---
  ids.R049 = sembrarCuenta(db, 'R049');
  for (const mes of [1, 2, 3, 4, 5]) {
    repo.crearMovimiento({ cuentaId: ids.R049, fecha: `2025-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2025, mes });
  }
  repo.crearCredito({ cuentaId: ids.R049, tipo: 'Abono', monto: 100000, fecha: '2024-02-06', observaciones: 'Sobrante de imputación: crédito no aplicado' });

  // --- Recibo 458: S0331 -> S03311 (S03311 ya existe, sembrada arriba para la corrección 1) ---
  ids.S0331 = sembrarCuenta(db, 'S0331');
  const r458 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 458, cuentaId: ids.S0331, fecha: '2019-02-18', valor: 300000, concepto: 'PAGO PUNTO DE AGUA'
  });
  ids.recibo458Id = r458.reciboId;
  db.prepare(`
    INSERT INTO nuevos_puntos (cuenta_id, valor_total, saldo_pendiente, fecha_registro, estado)
    VALUES (?, 300000, 0, '2023-12-31', 'Pagado')
  `).run(ids.S03311);
  ids.puntoS03311Id = db.prepare('SELECT id FROM nuevos_puntos WHERE cuenta_id=?').get(ids.S03311).id;

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
  // reproduce el estado real encontrado en producción antes de la corrección 13. Además, todos
  // los demás meses de enero 2024 a julio 2026 vienen causados y pagados (categoría "Finca con
  // piscina", $16.000, la real) para reproducir el estado real ANTES de la corrección 18:
  // agosto-diciembre 2026 nunca se causaron, y son justo los 5 meses (5 x $16.000 = $80.000)
  // que la corrección 18 debe causar y cubrir con el resto del crédito.
  const categoriaPiscinaId = db.prepare(`SELECT id FROM categorias WHERE nombre='Finca con piscina'`).get().id;
  ids.R007 = sembrarCuenta(db, 'R007');
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2024-01-01')`)
    .run(ids.R007, categoriaPiscinaId);

  const abonoPagosR007Id = repo.crearMovimiento({
    cuentaId: ids.R007, fecha: '2024-03-16', tipo: 'Abono', exigible: 1, monto: -480000
  });
  let cargoDic2024R007Id = null;
  for (let cod = 2024 * 12; cod <= 2026 * 12 + 6; cod++) {
    const anio = Math.floor(cod / 12), mes = (cod % 12) + 1;
    const cargoId = repo.crearMovimiento({
      cuentaId: ids.R007, fecha: `${anio}-${String(mes).padStart(2, '0')}-01`,
      tipo: 'CargoMensual', exigible: 1, monto: 16000, anio, mes
    });
    if (anio === 2024 && mes === 12) {
      cargoDic2024R007Id = cargoId; // se deja parcialmente pendiente, ver más abajo
    } else {
      repo.crearImputacion({ abonoId: abonoPagosR007Id, cargoId, monto: 16000 });
    }
  }
  ids.cargoDic2024R007Id = cargoDic2024R007Id;

  const abono2026R007Id = repo.crearMovimiento({
    cuentaId: ids.R007, fecha: '2026-04-11', tipo: 'Abono', exigible: 1, monto: -4000
  });
  repo.crearImputacion({ abonoId: abono2026R007Id, cargoId: cargoDic2024R007Id, monto: 4000 });
  ids.creditoAperturaR007Id = repo.crearCredito({
    cuentaId: ids.R007, tipo: 'Abono', monto: 92000, fecha: '2023-12-31',
    observaciones: 'Apertura opaca negativa al 31/12/2023: saldo a favor anterior al corte, redimible contra deuda de 2024+ (retrofit 2026-08-04)'
  });

  // --- S0334 y S039 (corrección 19): patrón "reajuste 2024 sin período" -- pagaron 12 meses
  // a la tarifa vieja y llevaron un segundo recibo, sin período declarado, a completar la
  // diferencia. Se reproduce solo el tramo relevante (los meses del hueco, sin pagar) más el
  // crédito suelto -- igual de minimalista que el seed de R007 para la corrección 13.
  ids.S0334 = sembrarCuenta(db, 'S0334');
  for (let mes = 7; mes <= 12; mes++) {
    repo.crearMovimiento({ cuentaId: ids.S0334, fecha: `2024-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes });
  }
  const r2067 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 2067, cuentaId: ids.S0334, fecha: '2025-02-01', valor: 60000, concepto: 'PAGO REAJUSTE 2024'
  });
  repo.crearMovimiento({ cuentaId: ids.S0334, fecha: '2025-02-01', tipo: 'Abono', exigible: 1, monto: 0, reciboDetalleId: r2067.detalleId });
  ids.creditoS0334Id = repo.crearCredito({
    cuentaId: ids.S0334, tipo: 'Abono', monto: 60000, fecha: '2025-02-01', reciboDetalleId: r2067.detalleId,
    observaciones: 'Sobrante de imputación del recibo 2067: crédito no aplicado'
  });

  // S039: junio 2024 queda con $1.000 pendiente (a diferencia de S0334, donde el mes anterior
  // al hueco cierra en $0) y tiene, aparte, un crédito de apertura de $1.000 sin relación con
  // el reajuste -- los dos créditos juntos ($60.000 + $1.000) calzan contra el hueco real de
  // $61.000 (junio parcial + julio-diciembre completo).
  ids.S039 = sembrarCuenta(db, 'S039');
  const cargoJunioS039Id = repo.crearMovimiento({ cuentaId: ids.S039, fecha: '2024-06-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 6 });
  const abonoParcialJunioS039Id = repo.crearMovimiento({ cuentaId: ids.S039, fecha: '2024-01-27', tipo: 'Abono', exigible: 1, monto: -9000 });
  repo.crearImputacion({ abonoId: abonoParcialJunioS039Id, cargoId: cargoJunioS039Id, monto: 9000 });
  for (let mes = 7; mes <= 12; mes++) {
    repo.crearMovimiento({ cuentaId: ids.S039, fecha: `2024-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes });
  }
  ids.creditoAperturaS039Id = repo.crearCredito({
    cuentaId: ids.S039, tipo: 'Abono', monto: 1000, fecha: '2023-12-31',
    observaciones: 'Apertura opaca negativa al 31/12/2023: saldo a favor anterior al corte, redimible contra deuda de 2024+ (retrofit 2026-08-04)'
  });
  const r2068 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 2068, cuentaId: ids.S039, fecha: '2025-02-01', valor: 60000, concepto: 'PAGO REAJUSTE 2024'
  });
  repo.crearMovimiento({ cuentaId: ids.S039, fecha: '2025-02-01', tipo: 'Abono', exigible: 1, monto: 0, reciboDetalleId: r2068.detalleId });
  ids.creditoS039Id = repo.crearCredito({
    cuentaId: ids.S039, tipo: 'Abono', monto: 60000, fecha: '2025-02-01', reciboDetalleId: r2068.detalleId,
    observaciones: 'Sobrante de imputación del recibo 2068: crédito no aplicado'
  });

  // --- S0271 (corrección 19, caso parcial): el recibo de reajuste trae $60.000 pero solo
  // $20.000 calzan contra un hueco real (noviembre-diciembre 2024) -- los otros $40.000 no
  // tienen destino claro y deben quedar sin tocar.
  ids.S0271 = sembrarCuenta(db, 'S0271');
  for (const mes of [11, 12]) {
    repo.crearMovimiento({ cuentaId: ids.S0271, fecha: `2024-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes });
  }
  const r2021 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 2021, cuentaId: ids.S0271, fecha: '2024-12-28', valor: 60000, concepto: 'PAGO REAJUSTE 2024'
  });
  repo.crearMovimiento({ cuentaId: ids.S0271, fecha: '2024-12-28', tipo: 'Abono', exigible: 1, monto: 0, reciboDetalleId: r2021.detalleId });
  ids.creditoS0271Id = repo.crearCredito({
    cuentaId: ids.S0271, tipo: 'Abono', monto: 60000, fecha: '2024-12-28', reciboDetalleId: r2021.detalleId,
    observaciones: 'Sobrante de imputación del recibo 2021: crédito no aplicado'
  });

  // --- S023 (corrección 20): el recibo 1627 ("PAGA DEUDA PENDIENTE", sin período) declaraba
  // pagar la deuda opaca de apertura pero quedó como crédito sin aplicar; el siguiente recibo
  // barrió esa misma deuda por FIFO y dejó julio 2024 con $15.000 sin cubrir -- mismo monto
  // exacto que el crédito varado. Se reproduce solo el mes del hueco más el crédito.
  ids.S023 = sembrarCuenta(db, 'S023');
  repo.crearMovimiento({ cuentaId: ids.S023, fecha: '2024-07-01', tipo: 'CargoMensual', exigible: 1, monto: 15000, anio: 2024, mes: 7 });
  const r1627 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 1627, cuentaId: ids.S023, fecha: '2024-01-18', valor: 15000, concepto: 'PAGA DEUDA PENDIENTE'
  });
  repo.crearMovimiento({ cuentaId: ids.S023, fecha: '2024-01-18', tipo: 'Abono', exigible: 1, monto: 0, reciboDetalleId: r1627.detalleId });
  ids.creditoS023Id = repo.crearCredito({
    cuentaId: ids.S023, tipo: 'Abono', monto: 15000, fecha: '2024-01-18', reciboDetalleId: r1627.detalleId,
    observaciones: 'Sobrante de imputación del recibo 1627: crédito no aplicado'
  });

  // --- S0501 (corrección 21): el recibo 1793 declara "MARZO Y ABRIL" ($20.000, 2 meses) pero el
  // período se guardó como un solo mes -- el recibo entero cayó a crédito sin aplicar. Solo se
  // redime la mitad (abril, el hueco real); marzo ya está cubierto por otra vía en producción,
  // aquí simplemente no se reproduce porque no hace falta para probar la corrección.
  ids.S0501 = sembrarCuenta(db, 'S0501');
  repo.crearMovimiento({ cuentaId: ids.S0501, fecha: '2024-04-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 4 });
  const r1793 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 1793, cuentaId: ids.S0501, fecha: '2024-04-06', valor: 20000, concepto: 'CU0TA DE SOSTENIMIENTO MARZO Y ABRIL'
  });
  repo.crearMovimiento({ cuentaId: ids.S0501, fecha: '2024-04-06', tipo: 'Abono', exigible: 1, monto: 0, reciboDetalleId: r1793.detalleId });
  ids.creditoS0501Id = repo.crearCredito({
    cuentaId: ids.S0501, tipo: 'Abono', monto: 20000, fecha: '2024-04-06', reciboDetalleId: r1793.detalleId,
    observaciones: 'Sobrante de imputación del recibo 1793: crédito no aplicado'
  });

  // --- S022 (corrección 22): el recibo 2394 declara "...Y ENERO A FEBRERO 2026" pero el período
  // guardado no capturó esa cláusula -- el FIFO de respaldo desvió esos 2 meses hacia una deuda
  // vieja real, dejando enero-febrero 2026 sin cubrir. Se redime contra el crédito varado de dos
  // recibos "ABONO A LA DEUDA" sin período (mismo par que en producción).
  ids.S022 = sembrarCuenta(db, 'S022');
  for (const mes of [1, 2]) {
    repo.crearMovimiento({ cuentaId: ids.S022, fecha: `2026-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes });
  }
  const r1692 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 1692, cuentaId: ids.S022, fecha: '2024-02-10', valor: 50000, concepto: 'ABONO A LA DEUDA A TRAVES DE CONSIGNACIÒN No. 666096'
  });
  repo.crearMovimiento({ cuentaId: ids.S022, fecha: '2024-02-10', tipo: 'Abono', exigible: 1, monto: 0, reciboDetalleId: r1692.detalleId });
  ids.creditoS022aId = repo.crearCredito({
    cuentaId: ids.S022, tipo: 'Abono', monto: 50000, fecha: '2024-02-10', reciboDetalleId: r1692.detalleId,
    observaciones: 'Sobrante de imputación del recibo 1692: crédito no aplicado'
  });
  const r1813 = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 1813, cuentaId: ids.S022, fecha: '2024-04-20', valor: 50000, concepto: 'ABONO A DEUDA'
  });
  repo.crearMovimiento({ cuentaId: ids.S022, fecha: '2024-04-20', tipo: 'Abono', exigible: 1, monto: 0, reciboDetalleId: r1813.detalleId });
  ids.creditoS022bId = repo.crearCredito({
    cuentaId: ids.S022, tipo: 'Abono', monto: 50000, fecha: '2024-04-20', reciboDetalleId: r1813.detalleId,
    observaciones: 'Sobrante de imputación del recibo 1813: crédito no aplicado'
  });

  // --- 7 cuentas suspendidas que NO deben recausarse (corrección 14): reproduce el estado
  // real encontrado en producción -- CargoMensual correcto a $5.000 (categoría Finca, tarifa
  // vieja preservada a propósito) más un AjusteCategoria erróneo, mismo monto, que las dobla a
  // $10.000/mes. Dos meses por cuenta alcanzan para probar la detección y el borrado; no hace
  // falta reproducir los 31/12 reales de producción.
  // Apertura opaca real de las 4 que nunca pagaron nada (corrección 29): la corrección 27 solo
  // toca el tramo 2024+; esta fixture le da a la 29 algo real que poner en 0.
  const APERTURA_OPACA_INCOBRABLES_FIXTURE = { R002: 600000, R0501: 600000, S009: 600000, R0971: 345000 };
  ids.ajustesErroneosSuspendidas = {};
  for (const codigo of CUENTAS_SUSPENDIDAS_SIN_RECAUSAR) {
    const cuentaId = sembrarCuenta(db, codigo);
    ids[codigo] = cuentaId;
    if (APERTURA_OPACA_INCOBRABLES_FIXTURE[codigo]) {
      ids[`apertura${codigo}Id`] = repo.crearMovimiento({
        cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0,
        monto: APERTURA_OPACA_INCOBRABLES_FIXTURE[codigo]
      });
    }
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

    // Estas mismas 7 cuentas son las "probablemente incobrables" de la corrección 27: ya
    // Suspendidas desde 2026-08-01 (no retroactiva, decisión original de la carga inicial), con
    // un CargoMensual más tardío (2025-12) sin pagar -- la corrección 27 mueve la fecha más
    // atrás y borra lo que queda dentro del nuevo rango suspendido (incluye los de 2024 de arriba).
    db.prepare(`
      INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, fecha_fin, motivo)
      VALUES (?, 'Activo', '2026-06-27', '2026-07-30', 'Estado inicial al migrar a cartera')
    `).run(cuentaId);
    db.prepare(`
      INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo)
      VALUES (?, 'Suspendido', '2026-08-01', 'Carga inicial de cartera: suspendida desde 2026-07-31, no retroactiva')
    `).run(cuentaId);
    repo.crearMovimiento({ cuentaId, fecha: '2025-12-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2025, mes: 12 });
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

  // --- R100 (corrección 17): pago adelantado -- recibo "Enero a Diciembre 2026" por 120.000,
  // pero al momento del paso10 solo existían cargos causados hasta julio (70.000 = 7x10.000):
  // el abono quedó recortado a lo imputado y los 50.000 de agosto-diciembre como crédito
  // genérico, reproduciendo el estado real de las cuentas con este patrón.
  const categoriaFincaId = db.prepare(`SELECT id FROM categorias WHERE nombre='Finca'`).get().id;
  ids.R100 = sembrarCuenta(db, 'R100');
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2024-01-01')`)
    .run(ids.R100, categoriaFincaId);
  for (let mes = 1; mes <= 7; mes++) {
    repo.crearMovimiento({ cuentaId: ids.R100, fecha: `2026-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes });
  }
  const r100Recibo = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 9100, cuentaId: ids.R100, fecha: '2026-02-21', valor: 120000,
    concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026',
    periodoDesde: 'Enero 2026', periodoHasta: 'Diciembre 2026'
  });
  const abonoR100Id = repo.crearMovimiento({
    cuentaId: ids.R100, fecha: '2026-02-21', tipo: 'Abono', exigible: 1, monto: -70000, reciboDetalleId: r100Recibo.detalleId
  });
  const cargosR100 = db.prepare(`SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' ORDER BY mes`).all(ids.R100);
  for (const c of cargosR100) repo.crearImputacion({ abonoId: abonoR100Id, cargoId: c.id, monto: 10000 });
  ids.creditoR100Id = repo.crearCredito({
    cuentaId: ids.R100, tipo: 'Abono', monto: 50000, fecha: '2026-02-21',
    reciboDetalleId: r100Recibo.detalleId, observaciones: 'Sobrante de imputación: crédito no aplicado'
  });
  ids.abonoR100Id = abonoR100Id;
  ids.detalleR100Id = r100Recibo.detalleId;

  // --- S0312 con un SEGUNDO recibo de pago adelantado (además del 2137 de la corrección 4),
  // para probar que EXCLUSIONES_PAGO_ADELANTADO lo descarta -- mismo patrón que R100 pero en
  // una cuenta que candidatosPagoAdelantado debe saltar explícitamente.
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2024-01-01')`)
    .run(ids.S0312, categoriaFincaId);
  const rS0312Adelantado = sembrarRecibo(db, propietarioId, {
    numeroRecibo: 9312, cuentaId: ids.S0312, fecha: '2026-02-21', valor: 50000,
    concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026',
    periodoDesde: 'Enero 2026', periodoHasta: 'Diciembre 2026'
  });
  const abonoS0312AdelantadoId = repo.crearMovimiento({
    cuentaId: ids.S0312, fecha: '2026-02-21', tipo: 'Abono', exigible: 1, monto: 0, reciboDetalleId: rS0312Adelantado.detalleId
  });
  ids.creditoS0312AdelantadoId = repo.crearCredito({
    cuentaId: ids.S0312, tipo: 'Abono', monto: 50000, fecha: '2026-02-21',
    reciboDetalleId: rS0312Adelantado.detalleId, observaciones: 'Sobrante de imputación: crédito no aplicado'
  });
  ids.abonoS0312AdelantadoId = abonoS0312AdelantadoId;

  // --- Corrección 32: 15 recibos históricos faltantes (ver comentario junto a
  // RECIBOS_FALTANTES_2026 en paso9b-correcciones.js). Se pre-siembra directamente el
  // CargoMensual de cada rango -- mismo patrón que el resto de este archivo -- para no depender
  // de categoria_tarifas: asegurarCausacion salta de largo cualquier mes que ya exista, así que
  // no hace falta una tarifa real para que la corrección corra limpia en la prueba.
  const sembrarRangoCargos = (cuentaId, anioDesde, mesDesde, anioHasta, mesHasta, monto) => {
    for (let c = anioDesde * 12 + mesDesde; c <= anioHasta * 12 + mesHasta; c++) {
      const anio = Math.floor((c - 1) / 12);
      const mes = ((c - 1) % 12) + 1;
      repo.crearMovimiento({ cuentaId, fecha: `${anio}-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto, anio, mes });
    }
  };
  const sembrarPropietarioDeCuenta = (cuentaId) => db.prepare(
    `INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2020-01-01')`
  ).run(cuentaId, propietarioId);

  // 2548 S010 (ya sembrada arriba, corrección "recalculoS010")
  sembrarPropietarioDeCuenta(ids.S010);
  sembrarRangoCargos(ids.S010, 2026, 1, 2026, 12, 20000);

  // 2552/2553 C004/C0041
  ids.C004 = sembrarCuenta(db, 'C004');
  sembrarPropietarioDeCuenta(ids.C004);
  sembrarRangoCargos(ids.C004, 2026, 1, 2026, 12, 20000);

  ids.C0041 = sembrarCuenta(db, 'C0041');
  sembrarPropietarioDeCuenta(ids.C0041);
  sembrarRangoCargos(ids.C0041, 2026, 1, 2026, 12, 10000);

  // 2554/2555 R0131/R013
  ids.R0131 = sembrarCuenta(db, 'R0131');
  sembrarPropietarioDeCuenta(ids.R0131);
  sembrarRangoCargos(ids.R0131, 2026, 6, 2026, 9, 10000);

  ids.R013 = sembrarCuenta(db, 'R013');
  sembrarPropietarioDeCuenta(ids.R013);
  sembrarRangoCargos(ids.R013, 2026, 4, 2026, 9, 10000);

  // 2556 C016
  ids.C016 = sembrarCuenta(db, 'C016');
  sembrarPropietarioDeCuenta(ids.C016);
  sembrarRangoCargos(ids.C016, 2026, 7, 2026, 12, 10000);

  // 2557/2558 S0334/S039 (ya sembradas arriba, corrección 19) -- su ancla de facturación real
  // (MIN(fecha) de su CargoMensual más viejo) es anterior a 2026, así que asegurarCausacion
  // intenta causar TODO el hueco desde ahí. Se rellena ese hueco (2025 completo y, para S039,
  // también enero-mayo 2024) YA PAGADO -- no hay ninguna evidencia real de deuda sin resolver
  // ahí, así que dejarlo sin pagar sería inventar un hueco que no existe y rompería la prueba de
  // la corrección 19 ("deudaExigible queda en 0"), que sigue siendo cierta hoy.
  const pagarRangoCargos = (cuentaId, fecha, anioDesde, mesDesde, anioHasta, mesHasta) => {
    const cargos = db.prepare(`
      SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual'
        AND (anio*12+mes) BETWEEN ? AND ? ORDER BY anio, mes
    `).all(cuentaId, anioDesde * 12 + mesDesde, anioHasta * 12 + mesHasta);
    const total = cargos.reduce((s, c) => s + c.monto, 0);
    const abonoId = repo.crearMovimiento({ cuentaId, fecha, tipo: 'Abono', exigible: 1, monto: -total });
    for (const c of cargos) repo.crearImputacion({ abonoId, cargoId: c.id, monto: c.monto });
  };

  sembrarPropietarioDeCuenta(ids.S0334);
  sembrarRangoCargos(ids.S0334, 2025, 1, 2025, 12, 10000);
  pagarRangoCargos(ids.S0334, '2025-12-15', 2025, 1, 2025, 12);
  sembrarRangoCargos(ids.S0334, 2026, 1, 2026, 12, 10000);

  sembrarPropietarioDeCuenta(ids.S039);
  sembrarRangoCargos(ids.S039, 2024, 1, 2024, 5, 10000);
  pagarRangoCargos(ids.S039, '2024-06-01', 2024, 1, 2024, 5);
  sembrarRangoCargos(ids.S039, 2025, 1, 2025, 12, 10000);
  pagarRangoCargos(ids.S039, '2025-12-15', 2025, 1, 2025, 12);
  sembrarRangoCargos(ids.S039, 2026, 1, 2026, 12, 10000);

  // 2559 S0338
  ids.S0338 = sembrarCuenta(db, 'S0338');
  sembrarPropietarioDeCuenta(ids.S0338);
  sembrarRangoCargos(ids.S0338, 2026, 1, 2026, 6, 16000);

  // 2561 S042
  ids.S042 = sembrarCuenta(db, 'S042');
  sembrarPropietarioDeCuenta(ids.S042);
  sembrarRangoCargos(ids.S042, 2026, 1, 2026, 12, 10000);

  // 2564 R047
  ids.R047 = sembrarCuenta(db, 'R047');
  sembrarPropietarioDeCuenta(ids.R047);
  sembrarRangoCargos(ids.R047, 2024, 10, 2025, 12, 10000);

  // 2549 S015: enero-julio 2026 ya pagados (simula el sobrante-por-FIFO real de otro recibo,
  // ver corrección 31), agosto-diciembre genuinamente pendiente.
  ids.S015 = sembrarCuenta(db, 'S015');
  sembrarPropietarioDeCuenta(ids.S015);
  sembrarRangoCargos(ids.S015, 2026, 1, 2026, 12, 10000);
  const cargosPagadosS015 = db.prepare(
    `SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=2026 AND mes BETWEEN 1 AND 7 ORDER BY mes`
  ).all(ids.S015);
  const abonoPreviaS015Id = repo.crearMovimiento({ cuentaId: ids.S015, fecha: '2025-10-11', tipo: 'Abono', exigible: 1, monto: -70000 });
  for (const c of cargosPagadosS015) repo.crearImputacion({ abonoId: abonoPreviaS015Id, cargoId: c.id, monto: 10000 });

  // 2551 S0292: abono a un punto de conexión ya existente, no sostenimiento.
  ids.S0292 = sembrarCuenta(db, 'S0292');
  sembrarPropietarioDeCuenta(ids.S0292);
  ids.nuevoPuntoS0292Id = db.prepare(
    `INSERT INTO nuevos_puntos (cuenta_id, valor_total, saldo_pendiente, fecha_registro, estado) VALUES (?, 500000, 300000, '2025-04-19', 'Pendiente')`
  ).run(ids.S0292).lastInsertRowid;

  // 2563 R0942 (ya sembrada arriba, corrección 14 -- ese mismo fixture deja el crédito de
  // $4.000 listo para que esta corrección lo consuma).
  sembrarPropietarioDeCuenta(ids.R0942);
  sembrarRangoCargos(ids.R0942, 2026, 3, 2026, 12, 16000);

  // 2550 S0383 (código real de la cuenta -- el talonario tenía "S038" por error de
  // transcripción, ver comentario de la corrección 32 en paso9b-correcciones.js).
  ids.S0383 = sembrarCuenta(db, 'S0383');
  sembrarPropietarioDeCuenta(ids.S0383);
  sembrarRangoCargos(ids.S0383, 2026, 7, 2026, 12, 10000);

  // 1167 no necesita fixture propio -- recibos_anulados_fisicos empieza vacío.

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
    // 24 de 2024-2025 (este test) + 12 de 2026 a $20.000 que agrega la corrección 32 (recibo
    // 2548) -- ambos tramos quedan totalmente cubiertos, cada uno por su propio mecanismo.
    assert.equal(cargos.length, 36);
    assert.ok(cargos.every(c => c.cubierto === c.monto), 'todos los cargos (2024-2025 de este test + 2026 de la corrección 32) deben quedar totalmente cubiertos');
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

test('paso9b: R0081/S058 -- mueve el recibo del punto a R0081, borra los CargoMensual duplicados de S058 y elimina S058', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.mergeR0081S058.yaAplicado, false);
    assert.equal(r.mergeR0081S058.reciboMovido, ids.reciboPuntoId);
    assert.equal(r.mergeR0081S058.puntoMovido, true);
    assert.equal(r.mergeR0081S058.movimientosDuplicadosBorrados, 2, 'los 2 CargoMensual de S058 se borran, no se mueven');

    assert.equal(db.prepare(`SELECT COUNT(*) n FROM cuentas WHERE id=?`).get(ids.S058).n, 0, 'S058 queda eliminada');
    const recibo = db.prepare(`SELECT cuenta_id FROM recibos WHERE id=?`).get(ids.reciboPuntoId);
    assert.equal(recibo.cuenta_id, ids.R0081);
    const punto = db.prepare(`SELECT cuenta_id FROM nuevos_puntos WHERE valor_total=500000`).get();
    assert.equal(punto.cuenta_id, ids.R0081);

    const cargosR0081 = getCargos(db, ids.R0081);
    assert.equal(cargosR0081.length, 2);
    assert.deepEqual(cargosR0081.map(c => c.mes), [2, 3]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R0081/S058 -- idempotente, correr dos veces no falla aunque S058 ya no exista', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.mergeR0081S058.yaAplicado, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S0312 -- reimputa 2191 y 2362 en orden cronológico tras liberarse los meses que ocupaba el 2137', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    const resultados = r.reimputacionS0312.resultados;
    assert.equal(resultados.find(x => x.numeroRecibo === 2191).reimputado, true);
    assert.equal(resultados.find(x => x.numeroRecibo === 2362).reimputado, true);

    for (const mes of [1, 2, 3]) {
      const cargo = db.prepare(`SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND anio=2025 AND mes=?`).get(ids.S0312, mes);
      const cubierto = db.prepare(`SELECT COALESCE(SUM(monto),0) s FROM cartera_imputaciones WHERE cargo_id=?`).get(cargo.id).s;
      assert.equal(cubierto, cargo.monto, `mes ${mes} de 2025 debe quedar cubierto`);
    }
    assert.equal(db.prepare(`SELECT monto FROM cartera_movimientos WHERE id=?`).get(ids.abono2191Id).monto, -30000);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM cuenta_creditos WHERE recibo_detalle_id IN (SELECT id FROM recibo_detalles WHERE recibo_id IN (SELECT id FROM recibos WHERE numero_recibo=2191))`).get().n, 0);

    // 2362: abril-junio 2025 cubiertos. El sobrante (para ago-dic 2026, que aún no existen) NO
    // debe tocar la apertura -- el recibo nunca la menciona -- se deja como crédito reservado.
    for (const mes of [4, 5, 6]) {
      const cargo = db.prepare(`SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND anio=2025 AND mes=?`).get(ids.S0312, mes);
      const cubierto = db.prepare(`SELECT COALESCE(SUM(monto),0) s FROM cartera_imputaciones WHERE cargo_id=?`).get(cargo.id).s;
      assert.equal(cubierto, cargo.monto, `mes ${mes} de 2025 debe quedar cubierto`);
    }
    const apertura = db.prepare(`SELECT monto FROM cartera_movimientos WHERE id=?`).get(ids.aperturaS0312Id);
    const aperturaCubierta = db.prepare(`SELECT COALESCE(SUM(monto),0) s FROM cartera_imputaciones WHERE cargo_id=?`).get(ids.aperturaS0312Id).s;
    assert.equal(apertura.monto - aperturaCubierta, 40000, 'apertura no se toca -- el recibo 2362 nunca la menciona');

    const creditos2362 = db.prepare(`SELECT monto, observaciones FROM cuenta_creditos WHERE recibo_detalle_id IN (SELECT id FROM recibo_detalles WHERE recibo_id IN (SELECT id FROM recibos WHERE numero_recibo=2362))`).all();
    assert.equal(creditos2362.length, 1, 'el sobrante queda como crédito explícito, no absorbido por el FIFO');
    assert.equal(creditos2362[0].monto, 20000);
    assert.match(creditos2362[0].observaciones, /agosto-diciembre 2026/i);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S0312 -- idempotente, correr dos veces no vuelve a deshacer/rehacer la reimputación', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const impAntes = db.prepare(`SELECT COUNT(*) n FROM cartera_imputaciones WHERE abono_id IN (?, ?)`).get(ids.abono2191Id, ids.abono2362Id).n;
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });
    const impDespues = db.prepare(`SELECT COUNT(*) n FROM cartera_imputaciones WHERE abono_id IN (?, ?)`).get(ids.abono2191Id, ids.abono2362Id).n;

    assert.equal(r2.reimputacionS0312.resultados.every(x => x.reimputado === false), true);
    assert.equal(impDespues, impAntes, 'no debe duplicar imputaciones en la segunda corrida');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R049 -- redime $50.000 contra enero-mayo 2025', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.redencionR049.yaCorregido, false);
    assert.equal(r.redencionR049.aplicado, 50000);
    for (const mes of [1, 2, 3, 4, 5]) {
      const cargo = db.prepare(`SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND anio=2025 AND mes=?`).get(ids.R049, mes);
      const cubierto = db.prepare(`SELECT COALESCE(SUM(monto),0) s FROM cartera_imputaciones WHERE cargo_id=?`).get(cargo.id).s;
      assert.equal(cubierto, cargo.monto, `mes ${mes} de 2025 debe quedar cubierto`);
    }
    const CarteraRepositoryLocal = require('../../src/repositories/CarteraRepository');
    const repoLocal = new CarteraRepositoryLocal(ctx.dbService);
    assert.equal(repoLocal.getSaldoCreditoDisponible(ids.R049), 50000, 'quedan 50.000 de los 100.000 originales');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R049 -- idempotente, correr dos veces no duplica la redención', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.redencionR049.yaCorregido, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: recibo 458 -- reasigna de S0331 a S03311 y le da respaldo documental al punto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.reasignacion458.yaAplicado, false);
    const recibo = db.prepare(`SELECT cuenta_id FROM recibos WHERE id=?`).get(ids.recibo458Id);
    assert.equal(recibo.cuenta_id, ids.S03311);
    const punto = db.prepare(`SELECT fecha_registro, observaciones FROM nuevos_puntos WHERE id=?`).get(ids.puntoS03311Id);
    assert.equal(punto.fecha_registro, '2019-02-18');
    assert.match(punto.observaciones, /respaldo documental/i);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: recibo 458 -- idempotente, correr dos veces no lo vuelve a mover', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.reasignacion458.yaAplicado, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: 7 cuentas incobrables -- mueve la suspensión al mes siguiente al último pago real y borra lo que quedó causado de más', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    for (const item of SUSPENSION_INCOBRABLES) {
      const res = r.suspensionIncobrables.find(x => x.codigo === item.codigoCuenta);
      assert.equal(res.yaCorregido, false, item.codigoCuenta);
      assert.ok(res.borrados > 0, `${item.codigoCuenta}: debe borrar al menos un CargoMensual`);
      const vigente = db.prepare(`SELECT estado, fecha_inicio FROM cuenta_estados WHERE cuenta_id=? AND fecha_fin IS NULL`).get(ids[item.codigoCuenta]);
      assert.equal(vigente.estado, 'Suspendido');
      assert.equal(vigente.fecha_inicio, item.fechaInicio);
      assert.equal(
        db.prepare(`SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual'`).get(ids[item.codigoCuenta]).n,
        0, `${item.codigoCuenta}: no debe quedar ningún CargoMensual dentro del rango suspendido`
      );
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: 7 cuentas incobrables -- idempotente, correr dos veces no falla ni vuelve a borrar nada', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.suspensionIncobrables.every(x => x.yaCorregido === true), true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: recibo faltante S0244 (1284, $60.000) -- se crea y su FIFO cae contra la apertura opaca', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.reciboFaltanteS0244.yaAplicado, false);
    const recibo = db.prepare(`SELECT cuenta_id, total FROM recibos WHERE numero_recibo=1284`).get();
    assert.equal(recibo.cuenta_id, ids.S0244);
    assert.equal(recibo.total, 60000);

    const apertura = db.prepare(`SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='AperturaOpaca'`).get(ids.S0244);
    const cubierta = db.prepare(`SELECT COALESCE(SUM(monto),0) s FROM cartera_imputaciones WHERE cargo_id=?`).get(apertura.id).s;
    assert.equal(cubierta, 60000, 'los 60.000 del recibo 1284 (2021) caen contra la apertura opaca');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: recibo faltante S0244 -- idempotente, correr dos veces no lo vuelve a crear', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.reciboFaltanteS0244.yaAplicado, true);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM recibos WHERE numero_recibo=1284`).get().n, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: las 4 incobrables que nunca pagaron nada -- pone su apertura opaca en 0', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    for (const codigo of APERTURA_INCOBRABLES) {
      const res = r.aperturaIncobrables.find(x => x.codigo === codigo);
      assert.equal(res.yaCorregido, false, codigo);
      assert.ok(res.montoAnterior > 0, `${codigo}: debe reportar el monto anterior`);
      const apertura = db.prepare(`SELECT monto FROM cartera_movimientos WHERE id=?`).get(ids[`apertura${codigo}Id`]);
      assert.equal(apertura.monto, 0, `${codigo}: la apertura opaca debe quedar en 0`);
    }
    // Las otras 3 (S004, S0441, S0141) sí pagaron algo real -- correccion 27 no les crea apertura
    // opaca en esta fixture y la 29 no las toca.
    assert.equal(r.aperturaIncobrables.length, APERTURA_INCOBRABLES.length);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: las 4 incobrables -- idempotente, correr dos veces no falla ni cambia nada', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.aperturaIncobrables.every(x => x.yaCorregido === true), true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R0948/R0949 -- crea las cuentas nuevas de 2026 mínimas, con su punto en Pendiente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    for (const item of CUENTAS_NUEVAS_2026) {
      const res = r.cuentasNuevas2026.find(x => x.codigo === item.codigo);
      assert.equal(res.yaAplicado, false, item.codigo);
      assert.equal(res.estado, 'Pendiente');
      assert.equal(res.saldoPendiente, VALOR_PUNTO_NUEVO_2026 - 100000);

      const cuenta = db.prepare(`SELECT direccion, estado FROM cuentas WHERE codigo=?`).get(item.codigo);
      assert.equal(cuenta.estado, 'Activo');
      assert.ok(cuenta.direccion, `${item.codigo}: debe tener alguna dirección (aunque sea placeholder)`);

      const propietario = db.prepare(`
        SELECT p.nombre_completo FROM cuenta_propietarios cp
        JOIN propietarios p ON p.id = cp.propietario_id
        WHERE cp.cuenta_id = (SELECT id FROM cuentas WHERE codigo = ?) AND cp.fecha_fin IS NULL
      `).get(item.codigo);
      assert.equal(propietario.nombre_completo, item.nombre);

      const recibo = db.prepare(`SELECT total FROM recibos WHERE numero_recibo=?`).get(item.numeroRecibo);
      assert.equal(recibo.total, 100000);

      const punto = db.prepare(`
        SELECT valor_total, saldo_pendiente, estado FROM nuevos_puntos WHERE cuenta_id = (SELECT id FROM cuentas WHERE codigo = ?)
      `).get(item.codigo);
      assert.equal(punto.valor_total, VALOR_PUNTO_NUEVO_2026);
      assert.equal(punto.saldo_pendiente, VALOR_PUNTO_NUEVO_2026 - 100000);
      assert.equal(punto.estado, 'Pendiente');

      assert.equal(
        db.prepare(`SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id=(SELECT id FROM cuentas WHERE codigo=?)`).get(item.codigo).n,
        0, `${item.codigo}: no debe tener ningún movimiento de cartera (sin apertura ni causación anticipada)`
      );
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R0948/R0949 -- idempotente, correr dos veces no las vuelve a crear', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.cuentasNuevas2026.every(x => x.yaAplicado === true), true);
    for (const item of CUENTAS_NUEVAS_2026) {
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM cuentas WHERE codigo=?`).get(item.codigo).n, 1);
    }
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

    // deudaExigible de R007 queda en 0 (todo el resto del seed -- enero 2024 a julio 2026 --
    // ya estaba pagado; esta corrección cierra el único hueco real, diciembre 2024).
    const { deudaExigible } = repo.getSaldos(ids.R007);
    assert.equal(deudaExigible, 0);

    // El crédito de apertura ($92.000) no se toca -- se agrega una fila 'Aplicado' aparte.
    // Se filtra por fecha para aislar las filas de ESTA corrección: la 18 corre justo después,
    // en la misma llamada a ejecutarPaso9b, y agrega su propia fila 'Aplicado' fechada distinto
    // (ver su propio test, más abajo).
    const creditos = db.prepare(
      `SELECT tipo, monto, abono_movimiento_id, fecha, observaciones FROM cuenta_creditos
       WHERE cuenta_id=? AND fecha != ? ORDER BY id`
    ).all(ids.R007, REDENCION_R007_2026.fecha);
    assert.equal(creditos.length, 2);
    assert.equal(creditos[0].tipo, 'Abono');
    assert.equal(creditos[0].monto, 92000);
    assert.equal(creditos[1].tipo, 'Aplicado');
    assert.equal(creditos[1].monto, 12000);
    assert.equal(creditos[1].fecha, REDENCION_R007.fecha);
    assert.match(creditos[1].observaciones, /recibo 1773/);
    assert.match(creditos[1].observaciones, /TENIA SALDO A FAVOR DE \$92\.000/);

    // El saldo a favor disponible YA NO queda en 80.000 al final de ejecutarPaso9b: la
    // corrección 18 corre justo después, en la misma llamada, y redime el resto contra
    // agosto-diciembre 2026 -- verificado en su propio test más abajo.

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
    assert.equal(r2.redencionR007Adelantado.yaCorregido, true);

    // 1 apertura + 1 'Aplicado' de la corrección 13 + 1 'Aplicado' de la corrección 18.
    const creditos = db.prepare(`SELECT COUNT(*) AS n FROM cuenta_creditos WHERE cuenta_id=?`).get(ids.R007).n;
    assert.equal(creditos, 3, 'la segunda corrida no debe agregar más filas de crédito');

    const abonos13 = db.prepare(
      `SELECT COUNT(*) AS n FROM cartera_movimientos WHERE cuenta_id=? AND tipo='Abono' AND monto=-12000`
    ).get(ids.R007).n;
    assert.equal(abonos13, 1, 'la segunda corrida no debe crear otro movimiento de la corrección 13');

    const abonos18 = db.prepare(
      `SELECT COUNT(*) AS n FROM cartera_movimientos WHERE cuenta_id=? AND tipo='Abono' AND monto=-80000`
    ).get(ids.R007).n;
    assert.equal(abonos18, 1, 'la segunda corrida no debe crear otro movimiento de la corrección 18');

    // Con ambas correcciones aplicadas, ya no queda nada del crédito de apertura sin redimir.
    assert.equal(repo.getSaldoCreditoDisponible(ids.R007), 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R007 -- corrección 18 causa agosto-diciembre 2026 y redime los $80.000 restantes, deja pagado hasta diciembre 2026', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    const CarteraService = require('../../src/services/CarteraService');
    const service = new CarteraService(ctx.dbService);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.redencionR007Adelantado.yaCorregido, false);
    assert.equal(r.redencionR007Adelantado.creados, 5, 'agosto a diciembre 2026 son 5 meses nuevos');
    assert.equal(r.redencionR007Adelantado.aplicado, 80000);
    assert.equal(r.redencionR007Adelantado.saldoRestante, 0);

    // Agosto-diciembre 2026 quedan causados a $16.000 (tarifa real de R007, "Finca con
    // piscina") y totalmente cubiertos.
    const cargosNuevos = db.prepare(`
      SELECT mes, monto, (SELECT COALESCE(SUM(monto),0) FROM cartera_imputaciones WHERE cargo_id=cm.id) AS cubierto
      FROM cartera_movimientos cm WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=2026 AND mes>=8
      ORDER BY mes
    `).all(ids.R007);
    assert.equal(cargosNuevos.length, 5);
    assert.deepEqual(cargosNuevos.map(c => c.mes), [8, 9, 10, 11, 12]);
    assert.ok(cargosNuevos.every(c => c.monto === 16000 && c.cubierto === 16000));

    // Ya no queda ni deuda exigible ni saldo a favor -- exactamente lo que pidió el usuario.
    assert.equal(repo.getSaldoCreditoDisponible(ids.R007), 0);
    const { deudaExigible } = repo.getSaldos(ids.R007);
    assert.equal(deudaExigible, 0);

    // Verificación de punta a punta contra lo que ve el operador en pantalla.
    const estado = service.getEstadoCartera(ids.R007);
    assert.deepEqual(estado.ultimoMesCubierto, { anio: 2026, mes: 12 });
    assert.equal(estado.aPagar, 0);
    assert.equal(estado.saldoAFavor, 0);

    const nuevoAbono = db.prepare(
      `SELECT fecha, monto, observaciones FROM cartera_movimientos WHERE id IN (
        SELECT abono_movimiento_id FROM cuenta_creditos WHERE cuenta_id=? AND monto=80000
      )`
    ).get(ids.R007);
    assert.equal(nuevoAbono.fecha, '2026-04-11');
    assert.equal(nuevoAbono.monto, -80000);
    assert.match(nuevoAbono.observaciones, /recibo 2470/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R007 -- corrección 18 se detiene con un error si el crédito disponible no es el esperado (no adivina cuánto redimir)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    // Simula que parte del crédito ya se usó por otra vía, inesperada, antes de esta corrección
    // -- no debe adivinar cuánto redimir con lo que sobra, debe detenerse y avisar.
    repo.crearCredito({ cuentaId: ids.R007, tipo: 'Aplicado', monto: 10000, fecha: '2026-01-01' });

    assert.throws(
      () => ejecutarPaso9b({ dbService: ctx.dbService }),
      /R007.*se esperaba \$80000 de credito disponible/s
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: reajuste 2024 -- S0334 y S039 redimen $60.000 exacto contra su hueco real, S0271 solo $20.000 de los $60.000', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    const porCodigo = Object.fromEntries(r.redencionesReajuste2024.map(x => [x.codigo, x]));
    assert.equal(porCodigo.S0334.yaCorregido, false);
    assert.equal(porCodigo.S0334.aplicado, 60000);
    assert.equal(porCodigo.S0334.saldoRestante, 0);
    assert.equal(porCodigo.S039.yaCorregido, false);
    assert.equal(porCodigo.S039.aplicado, 61000);
    assert.equal(porCodigo.S039.saldoRestante, 0);
    assert.equal(porCodigo.S0271.yaCorregido, false);
    assert.equal(porCodigo.S0271.aplicado, 20000);
    assert.equal(porCodigo.S0271.saldoRestante, 40000, 'S0271 deja $40.000 sin tocar -- no hay evidencia de a qué corresponden');

    // S0334 y S039 quedan con julio/junio-diciembre 2024 totalmente cubiertos y sin crédito.
    for (const codigo of ['S0334', 'S039']) {
      assert.equal(repo.getSaldoCreditoDisponible(ids[codigo]), 0);
      const { deudaExigible } = repo.getSaldos(ids[codigo]);
      assert.equal(deudaExigible, 0);
    }

    // S0271: noviembre-diciembre 2024 quedan cubiertos, pero sigue con $40.000 de crédito.
    const cargosS0271 = db.prepare(`
      SELECT mes, monto, (SELECT COALESCE(SUM(monto),0) FROM cartera_imputaciones WHERE cargo_id=cm.id) AS cubierto
      FROM cartera_movimientos cm WHERE cuenta_id=? AND tipo='CargoMensual' ORDER BY mes
    `).all(ids.S0271);
    assert.ok(cargosS0271.every(c => c.monto === c.cubierto));
    assert.equal(repo.getSaldoCreditoDisponible(ids.S0271), 40000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: reajuste 2024 -- idempotente, correr dos veces no duplica ninguna de las 3 redenciones', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    const porCodigo = Object.fromEntries(r2.redencionesReajuste2024.map(x => [x.codigo, x]));
    assert.equal(porCodigo.S0334.yaCorregido, true);
    assert.equal(porCodigo.S039.yaCorregido, true);
    assert.equal(porCodigo.S0271.yaCorregido, true);

    for (const codigo of ['S0334', 'S039']) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM cuenta_creditos WHERE cuenta_id=? AND tipo='Aplicado'`).get(ids[codigo]).n;
      assert.equal(n, 1, `${codigo}: la segunda corrida no debe duplicar la redención`);
    }
    assert.equal(repo.getSaldoCreditoDisponible(ids.S0271), 40000, 'sigue en 40.000, no en 20.000 ni 0');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: reajuste 2024 -- se detiene con un error si el crédito disponible no alcanza el monto esperado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    // Alguien ya gastó parte del crédito de S0334 por otra vía, inesperada.
    repo.crearCredito({ cuentaId: ids.S0334, tipo: 'Aplicado', monto: 50000, fecha: '2026-01-01' });

    assert.throws(
      () => ejecutarPaso9b({ dbService: ctx.dbService }),
      /S0334.*se esperaba al menos \$60000 de credito disponible/s
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S023 -- redime $15.000 exacto contra el hueco de julio 2024', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.redencionS023.yaCorregido, false);
    assert.equal(r.redencionS023.aplicado, 15000);
    assert.equal(r.redencionS023.saldoRestante, 0);

    assert.equal(repo.getSaldoCreditoDisponible(ids.S023), 0);
    const { deudaExigible } = repo.getSaldos(ids.S023);
    assert.equal(deudaExigible, 0);

    const cargoJulioS023 = db.prepare(`
      SELECT monto, (SELECT COALESCE(SUM(monto),0) FROM cartera_imputaciones WHERE cargo_id=cm.id) AS cubierto
      FROM cartera_movimientos cm WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=2024 AND mes=7
    `).get(ids.S023);
    assert.equal(cargoJulioS023.monto, cargoJulioS023.cubierto);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S023 -- idempotente, correr dos veces no duplica la redención', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r2.redencionS023.yaCorregido, true);
    const n = db.prepare(`SELECT COUNT(*) AS n FROM cuenta_creditos WHERE cuenta_id=? AND tipo='Aplicado'`).get(ids.S023).n;
    assert.equal(n, 1, 'la segunda corrida no debe duplicar la redención');
    assert.equal(repo.getSaldoCreditoDisponible(ids.S023), 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S023 -- se detiene con un error si el crédito disponible no coincide con el monto esperado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    // Alguien ya gastó parte del crédito de S023 por otra vía, inesperada.
    repo.crearCredito({ cuentaId: ids.S023, tipo: 'Aplicado', monto: 5000, fecha: '2026-01-01' });

    assert.throws(
      () => ejecutarPaso9b({ dbService: ctx.dbService }),
      /S023.*se esperaba \$15000 de credito disponible/s
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: hueco textual 2026 -- S0501 redime $10.000 de los $20.000, S022 redime $20.000 de los $100.000', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    const porCodigo = Object.fromEntries(r.redencionesHuecoTextual2026.map(x => [x.codigo, x]));
    assert.equal(porCodigo.S0501.yaCorregido, false);
    assert.equal(porCodigo.S0501.aplicado, 10000);
    assert.equal(porCodigo.S0501.saldoRestante, 10000, 'saldoRestante es el crédito de la cuenta que queda tras esta redención, no el sobrante de los $10.000 pedidos');
    assert.equal(porCodigo.S022.yaCorregido, false);
    assert.equal(porCodigo.S022.aplicado, 20000);
    assert.equal(porCodigo.S022.saldoRestante, 80000, 'saldoRestante es el crédito de la cuenta que queda tras esta redención, no el sobrante de los $20.000 pedidos');

    assert.equal(repo.getSaldoCreditoDisponible(ids.S0501), 10000, 'S0501 deja $10.000 sin tocar -- no hay evidencia de a qué corresponden');
    const cargoAbrilS0501 = db.prepare(`
      SELECT monto, (SELECT COALESCE(SUM(monto),0) FROM cartera_imputaciones WHERE cargo_id=cm.id) AS cubierto
      FROM cartera_movimientos cm WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=2024 AND mes=4
    `).get(ids.S0501);
    assert.equal(cargoAbrilS0501.monto, cargoAbrilS0501.cubierto);

    assert.equal(repo.getSaldoCreditoDisponible(ids.S022), 80000, 'S022 deja $80.000 sin tocar -- no hay evidencia de a qué corresponden');
    const cargosS022 = db.prepare(`
      SELECT mes, monto, (SELECT COALESCE(SUM(monto),0) FROM cartera_imputaciones WHERE cargo_id=cm.id) AS cubierto
      FROM cartera_movimientos cm WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=2026 ORDER BY mes
    `).all(ids.S022);
    assert.ok(cargosS022.every(c => c.monto === c.cubierto));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: hueco textual 2026 -- idempotente, correr dos veces no duplica ninguna de las 2 redenciones', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    const porCodigo = Object.fromEntries(r2.redencionesHuecoTextual2026.map(x => [x.codigo, x]));
    assert.equal(porCodigo.S0501.yaCorregido, true);
    assert.equal(porCodigo.S022.yaCorregido, true);

    for (const codigo of ['S0501', 'S022']) {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM cuenta_creditos WHERE cuenta_id=? AND tipo='Aplicado'`).get(ids[codigo]).n;
      assert.equal(n, 1, `${codigo}: la segunda corrida no debe duplicar la redención`);
    }
    assert.equal(repo.getSaldoCreditoDisponible(ids.S0501), 10000);
    assert.equal(repo.getSaldoCreditoDisponible(ids.S022), 80000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: hueco textual 2026 -- se detiene con un error si el crédito disponible no alcanza el monto esperado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    // Alguien ya gastó parte del crédito de S0501 por otra vía, inesperada.
    repo.crearCredito({ cuentaId: ids.S0501, tipo: 'Aplicado', monto: 15000, fecha: '2026-01-01' });

    assert.throws(
      () => ejecutarPaso9b({ dbService: ctx.dbService }),
      /S0501.*se esperaba al menos \$10000 de credito disponible/s
    );
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

test('paso9b: las 7 suspendidas -- borra el AjusteCategoria erróneo (corrección 14); la corrección 27 borra también el CargoMensual, al mover la suspensión antes de 2024', () => {
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

      const ajustesRestantes = db.prepare(
        `SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id=? AND tipo='AjusteCategoria'`
      ).get(ids[codigo]).n;
      assert.equal(ajustesRestantes, 0, `${codigo}: no debe quedar ningún AjusteCategoria`);

      // La corrección 27 (7 "probablemente incobrables", mismas 7 cuentas) mueve la suspensión a
      // antes de 2024 -- el CargoMensual a 5.000 de enero-febrero 2024 queda dentro del nuevo
      // rango suspendido y se borra también, no "intacto" como antes de que existiera esa corrección.
      const cargos = getCargos(db, ids[codigo]);
      assert.equal(cargos.length, 0, `${codigo}: sin ningún CargoMensual, la suspensión ya cubre 2024`);

      const { deudaExigible } = repo.getSaldos(ids[codigo]);
      assert.equal(deudaExigible, 0, `${codigo}: sin deuda exigible, todo el rango quedó suspendido`);
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
      assert.equal(getCargos(db, ids[codigo]).length, 0, `${codigo}: sigue sin ningún CargoMensual`);
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
    // La corrección 32 (recibo 2563, "TENIA $4.000 A FAVOR") consume este mismo crédito en la
    // misma corrida -- el saldo disponible al final de ejecutarPaso9b ya no es 4.000, es 0. La
    // fila 'Abono' de abajo sigue existiendo tal cual (nunca se reescribe), solo queda
    // compensada por la fila 'Aplicado' que crea la corrección 32.
    assert.equal(repo.getSaldoCreditoDisponible(ids.R0942), 0);

    const credito = db.prepare(`SELECT * FROM cuenta_creditos WHERE cuenta_id=? AND tipo='Abono'`).get(ids.R0942);
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
    // 2 filas -- el 'Abono' original de esta corrección y el 'Aplicado' que deja la corrección
    // 32 al consumirlo contra el recibo 2563 (ver comentario en el test anterior) -- y ninguna
    // de las dos se duplica al correr por segunda vez.
    const creditos = db.prepare(`SELECT COUNT(*) n FROM cuenta_creditos WHERE cuenta_id=?`).get(ids.R0942).n;
    assert.equal(creditos, 2);
    assert.equal(repo.getSaldoCreditoDisponible(ids.R0942), 0);
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

test('paso9b: R100 (pago adelantado) -- causa agosto-diciembre 2026 y reimputa el recibo completo, sin dejar crédito', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const CarteraService = require('../../src/services/CarteraService');
    const service = new CarteraService(ctx.dbService);

    const antes = service.getEstadoCartera(ids.R100);
    assert.deepEqual(antes.cubiertoHasta, { anio: 2026, mes: 7 });
    assert.equal(antes.saldoCreditoDisponible, 50000);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    const pagoR100 = r.pagosAdelantados.find(p => p.codigo === 'R100');
    assert.ok(pagoR100, 'R100 debe aparecer en pagosAdelantados');
    assert.equal(pagoR100.yaCorregido, false);
    assert.equal(pagoR100.creados, 5, 'agosto a diciembre 2026');
    assert.equal(pagoR100.saldoRestante, 0, 'los 120.000 alcanzan exacto para los 12 meses, sin sobrante');

    const cargos = getCargos(db, ids.R100);
    assert.equal(cargos.length, 12);
    assert.equal(cargos.filter(c => c.anio === 2026).length, 12);

    const despues = service.getEstadoCartera(ids.R100);
    assert.deepEqual(despues.cubiertoHasta, { anio: 2026, mes: 12 }, 'pagado hasta diciembre, no julio');
    assert.equal(despues.saldoCreditoDisponible, 0, 'sin crédito genérico -- todo quedó imputado a un mes real');
    assert.equal(despues.deudaExigible, 0);

    // El crédito original (tipo='Abono') nunca se borra -- redimirCredito agrega una fila
    // 'Aplicado' aparte que lo neta a 0 (ya verificado arriba vía saldoCreditoDisponible).
    const creditoViejo = db.prepare(`SELECT * FROM cuenta_creditos WHERE id=?`).get(ids.creditoR100Id);
    assert.equal(creditoViejo.monto, 50000, 'la fila original queda intacta, sin mutar');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: R100 -- idempotente, correr dos veces no vuelve a causar ni duplica nada', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const CarteraService = require('../../src/services/CarteraService');
    const service = new CarteraService(ctx.dbService);

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    // Con sobrante 0, la primera corrida no dejó ningún crédito -- R100 ya no es "candidato"
    // (candidatosPagoAdelantado solo mira cuenta_creditos), así que ni siquiera vuelve a
    // aparecer en pagosAdelantados. Eso es correcto: lo que importa es que la segunda corrida
    // no duplique ni revierta nada, no que lo reporte de nuevo.
    assert.equal(r2.pagosAdelantados.some(p => p.codigo === 'R100'), false);

    const cargos = getCargos(db, ids.R100);
    assert.equal(cargos.length, 12, 'la segunda corrida no debe duplicar cargos');
    const estado = service.getEstadoCartera(ids.R100);
    assert.equal(estado.saldoCreditoDisponible, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: S0312 -- EXCLUSIONES_PAGO_ADELANTADO lo descarta pese a calzar el patrón (pago mal anotado, no adelantado real)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const ids = sembrarTodas(db);
    const CarteraService = require('../../src/services/CarteraService');
    const service = new CarteraService(ctx.dbService);

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.pagosAdelantados.some(p => p.codigo === 'S0312'), false, 'S0312 nunca debe aparecer en pagosAdelantados');

    // El crédito de $50.000 sembrado para esta prueba sigue intacto, sin tocar.
    const credito = db.prepare(`SELECT monto FROM cuenta_creditos WHERE id=?`).get(ids.creditoS0312AdelantadoId);
    assert.equal(credito.monto, 50000);
    const cargos2026 = db.prepare(`SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=2026`).get(ids.S0312).n;
    assert.equal(cargos2026, 0, 'no debe causar nada en S0312 -- está excluida');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: pago adelantado con sobrante real -- deja un crédito menor (no cero) y la segunda corrida no lo duplica', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);
    const repo = new CarteraRepository({ getDb: () => db });
    const propietarioId = sembrarPropietario(db);
    const categoriaFincaId = db.prepare(`SELECT id FROM categorias WHERE nombre='Finca'`).get().id;

    const cuentaId = sembrarCuenta(db, 'R101');
    db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2024-01-01')`)
      .run(cuentaId, categoriaFincaId);
    for (let mes = 1; mes <= 7; mes++) {
      repo.crearMovimiento({ cuentaId, fecha: `2026-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes });
    }
    // Recibo de 122.000 para "Enero a Diciembre 2026": los 12 meses cuestan 120.000, sobran 2.000.
    const recibo = sembrarRecibo(db, propietarioId, {
      numeroRecibo: 9101, cuentaId, fecha: '2026-02-21', valor: 122000,
      concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026 (SALDO A FAVOR 2.000)',
      periodoDesde: 'Enero 2026', periodoHasta: 'Diciembre 2026'
    });
    const abonoId = repo.crearMovimiento({
      cuentaId, fecha: '2026-02-21', tipo: 'Abono', exigible: 1, monto: -70000, reciboDetalleId: recibo.detalleId
    });
    const cargos = db.prepare(`SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' ORDER BY mes`).all(cuentaId);
    for (const c of cargos) repo.crearImputacion({ abonoId, cargoId: c.id, monto: 10000 });
    repo.crearCredito({
      cuentaId, tipo: 'Abono', monto: 52000, fecha: '2026-02-21',
      reciboDetalleId: recibo.detalleId, observaciones: 'Sobrante de imputación: crédito no aplicado'
    });

    const r1 = ejecutarPaso9b({ dbService: ctx.dbService });
    const pago1 = r1.pagosAdelantados.find(p => p.codigo === 'R101');
    assert.equal(pago1.yaCorregido, false);
    assert.equal(pago1.saldoRestante, 2000, 'los 122.000 cubren los 12 meses (120.000) y sobran 2.000 reales');

    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });
    // maxCausado de la cuenta ahora es exactamente diciembre-2026 (el mismo hasta declarado),
    // así que candidatosPagoAdelantado ya no la trae -- no hace falta llegar al chequeo interno
    // de "¿ya existe el CargoMensual de diciembre?" para que la segunda corrida sea inofensiva.
    assert.equal(r2.pagosAdelantados.some(p => p.codigo === 'R101'), false);

    // redimirCredito nunca borra la fila 'Abono' original -- agrega una fila 'Aplicado' aparte
    // (mismo mecanismo que usa el operador desde la pantalla). Lo que importa es el saldo neto,
    // no la cantidad de filas.
    const repoVerif = new CarteraRepository({ getDb: () => db });
    assert.equal(repoVerif.getSaldoCreditoDisponible(cuentaId), 2000, 'la segunda corrida no debe duplicar ni volver a redimir nada');

    const cargosFinal = getCargos(db, cuentaId);
    assert.equal(cargosFinal.length, 12, 'la segunda corrida no debe duplicar cargos');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: pago adelantado -- si el crédito no alcanza para cubrir el período (parte ya pagó deuda vieja real), no toca nada y lo deja en pendientesManuales', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);
    const repo = new CarteraRepository({ getDb: () => db });
    const propietarioId = sembrarPropietario(db);
    const categoriaFincaId = db.prepare(`SELECT id FROM categorias WHERE nombre='Finca'`).get().id;

    // Reproduce el patrón real encontrado en producción (R027 y 9 más, 2026-08-14): una
    // apertura opaca real de 8.000 que YA está paga (por otro abono, sin relación con el
    // recibo de pago adelantado), más el recibo "Enero a Diciembre 2026" cuyo sobrante, en
    // vez de cubrir agosto-diciembre completo, sólo alcanza para una parte -- porque el resto
    // ya se había ido a esa apertura antes de que existiera esta corrección.
    const cuentaId = sembrarCuenta(db, 'R102');
    db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2024-01-01')`)
      .run(cuentaId, categoriaFincaId);
    const aperturaId = repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 8000 });
    const abonoAperturaId = repo.crearMovimiento({ cuentaId, fecha: '2024-01-15', tipo: 'Abono', exigible: 0, monto: -8000 });
    repo.crearImputacion({ abonoId: abonoAperturaId, cargoId: aperturaId, monto: 8000 });
    for (let mes = 1; mes <= 7; mes++) {
      repo.crearMovimiento({ cuentaId, fecha: `2026-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes });
    }
    const recibo = sembrarRecibo(db, propietarioId, {
      numeroRecibo: 9102, cuentaId, fecha: '2026-02-21', valor: 82000,
      concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026',
      periodoDesde: 'Enero 2026', periodoHasta: 'Diciembre 2026'
    });
    const abonoId = repo.crearMovimiento({
      cuentaId, fecha: '2026-02-21', tipo: 'Abono', exigible: 1, monto: -70000, reciboDetalleId: recibo.detalleId
    });
    const cargos = db.prepare(`SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' ORDER BY mes`).all(cuentaId);
    for (const c of cargos) repo.crearImputacion({ abonoId, cargoId: c.id, monto: 10000 });
    repo.crearCredito({
      cuentaId, tipo: 'Abono', monto: 12000, fecha: '2026-02-21',
      reciboDetalleId: recibo.detalleId, observaciones: 'Sobrante de imputación: crédito no aplicado'
    });

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.pagosAdelantados.some(p => p.codigo === 'R102'), false, 'no debe aparecer como corregida');
    const pendiente = r.pendientesManuales.find(p => p.codigo === 'R102');
    assert.ok(pendiente, 'debe quedar en pendientesManuales');
    assert.equal(pendiente.disponible, 12000);
    assert.equal(pendiente.necesario, 50000, 'agosto a diciembre, 5 x 10.000');
    assert.equal(pendiente.faltante, 38000);

    // Nada se tocó: ni se causaron meses nuevos, ni se movió el crédito, ni la apertura.
    const cargosFinal = getCargos(db, cuentaId);
    assert.equal(cargosFinal.length, 7, 'no debe causar agosto-diciembre si el crédito no alcanza');
    const credito = db.prepare(`SELECT monto FROM cuenta_creditos WHERE cuenta_id=?`).get(cuentaId);
    assert.equal(credito.monto, 12000, 'el crédito queda intacto');
    const CarteraService = require('../../src/services/CarteraService');
    const service = new CarteraService(ctx.dbService);
    const estado = service.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaAntes2024, 0, 'la apertura, ya paga desde antes, sigue paga');
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

test('inferirPeriodoDeTexto: conector " A " con año compartido, entiende que el año aplica a ambos meses', () => {
  const r = inferirPeriodoDeTexto('CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2017');
  assert.deepEqual(r, { desde: { anio: 2017, mes: 1 }, hasta: { anio: 2017, mes: 12 } });
});

test('inferirPeriodoDeTexto: conector "Y" con año compartido', () => {
  const r = inferirPeriodoDeTexto('CUOTA DE SOSTENIMIENTO ENERO Y FEBRERO 2024');
  assert.deepEqual(r, { desde: { anio: 2024, mes: 1 }, hasta: { anio: 2024, mes: 2 } });
});

test('inferirPeriodoDeTexto: conector "Y" que retrocede el calendario resta 1 al año del primer mes', () => {
  const r = inferirPeriodoDeTexto('CUOTA DE SOSTENIMIENTO DICIEMBRE Y ENERO 2024');
  assert.deepEqual(r, { desde: { anio: 2023, mes: 12 }, hasta: { anio: 2024, mes: 1 } });
});

test('inferirPeriodoDeTexto: conector "HASTA"', () => {
  const r = inferirPeriodoDeTexto('CUOTA DE SOSTENIMIENTO AGOSTO HASTA DICIEMBRE 2022');
  assert.deepEqual(r, { desde: { anio: 2022, mes: 8 }, hasta: { anio: 2022, mes: 12 } });
});

test('inferirPeriodoDeTexto: dos años explícitos, cada mención con el suyo', () => {
  const r = inferirPeriodoDeTexto('CUOTA DE SOSTENIMIENTO SEPTIEMBRE A DICIEMBRE 2023 Y ENERO A ABRIL 2024');
  assert.deepEqual(r, { desde: { anio: 2023, mes: 9 }, hasta: { anio: 2024, mes: 4 } });
});

test('inferirPeriodoDeTexto: sin ningún año en el texto, no adivina (null)', () => {
  assert.equal(inferirPeriodoDeTexto('CUOTA DE SOSTENIMIENTO MAYO A DICIEMBRE'), null);
});

test('inferirPeriodoDeTexto: sin ningún mes reconocible, no adivina (null)', () => {
  assert.equal(inferirPeriodoDeTexto('ABONO A LA DEUDA'), null);
});

test('paso9b: período de texto (corrección 31) -- con Abono real y texto con año, usa el texto (coincide con el ledger en el caso común)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = sembrarCuenta(db, 'T900');
    const propietarioId = sembrarPropietario(db);

    const cargoEne = repo.crearMovimiento({ cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1 });
    const cargoFeb = repo.crearMovimiento({ cuentaId, fecha: '2024-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 2 });

    // Estado real encontrado en producción: el parser viejo colapsó "Enero Y Febrero 2024" a
    // "Enero 2024" en los dos campos, pero la plata (ledger) ya está bien: cubre los dos meses.
    const { detalleId } = sembrarRecibo(db, propietarioId, {
      numeroRecibo: 9001, cuentaId, fecha: '2024-02-17', valor: 20000,
      concepto: 'CUOTA DE SOSTENIMIENTO ENERO Y FEBRERO 2024',
      periodoDesde: 'Enero 2024', periodoHasta: 'Enero 2024'
    });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2024-02-17', tipo: 'Abono', exigible: 1, monto: -20000, reciboDetalleId: detalleId });
    repo.crearImputacion({ abonoId, cargoId: cargoEne, monto: 10000 });
    repo.crearImputacion({ abonoId, cargoId: cargoFeb, monto: 10000 });

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    const resultado = r.periodosTextoCorregidos.find(p => p.numeroRecibo === 9001);
    assert.equal(resultado.corregido, true);
    assert.deepEqual(resultado.despues, ['Enero 2024', 'Febrero 2024']);

    const detalle = db.prepare('SELECT periodo_desde, periodo_hasta FROM recibo_detalles WHERE id=?').get(detalleId);
    assert.equal(detalle.periodo_desde, 'Enero 2024');
    assert.equal(detalle.periodo_hasta, 'Febrero 2024');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: período de texto -- el sobrante desviado por FIFO hacia deuda vieja NO ensancha el período mostrado (caso real: recibo 2470 de R007)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = sembrarCuenta(db, 'T906');
    const propietarioId = sembrarPropietario(db);

    // Cargo de un mes SIN relación con lo que este recibo declara (simula el hueco viejo real
    // que el sobrante de R007/recibo 2470 terminó pagando por FIFO, jul-dic 2024).
    const cargoViejo = repo.crearMovimiento({ cuentaId, fecha: '2024-07-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 7 });
    const cargoEne = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });

    const { detalleId } = sembrarRecibo(db, propietarioId, {
      numeroRecibo: 9006, cuentaId, fecha: '2026-04-11', valor: 20000,
      concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026',
      periodoDesde: 'Enero 2026', periodoHasta: 'Enero 2026'
    });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2026-04-11', tipo: 'Abono', exigible: 1, monto: -20000, reciboDetalleId: detalleId });
    // El ledger real de este abono toca julio 2024 (deuda vieja, ajena) y enero 2026 (lo que sí
    // declara) -- si se usara el ledger, el "hasta" mostrado sería julio 2024 (el más viejo), muy
    // por debajo de lo que el recibo dice cubrir. El texto (con año explícito) debe ganar.
    repo.crearImputacion({ abonoId, cargoId: cargoViejo, monto: 10000 });
    repo.crearImputacion({ abonoId, cargoId: cargoEne, monto: 10000 });

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    const resultado = r.periodosTextoCorregidos.find(p => p.numeroRecibo === 9006);
    assert.equal(resultado.corregido, true);
    assert.deepEqual(resultado.despues, ['Enero 2026', 'Diciembre 2026'], 'debe usar el texto declarado, no el rango disperso del ledger');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: período de texto -- sin Abono real (deuda pre-2024, absorbida en apertura), usa el texto del concepto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);
    const cuentaId = sembrarCuenta(db, 'T901');
    const propietarioId = sembrarPropietario(db);

    // Estado real: el desde quedó con el año del propio recibo (2018, cuándo se escribió) en
    // vez del año que el concepto realmente declara (2017, un solo año para todo el rango).
    sembrarRecibo(db, propietarioId, {
      numeroRecibo: 9002, cuentaId, fecha: '2018-01-06', valor: 36000,
      concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2017',
      periodoDesde: 'Enero 2018', periodoHasta: 'Diciembre 2017'
    });

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    const resultado = r.periodosTextoCorregidos.find(p => p.numeroRecibo === 9002);
    assert.equal(resultado.corregido, true);
    assert.deepEqual(resultado.despues, ['Enero 2017', 'Diciembre 2017']);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: período de texto -- con crédito sin aplicar, extiende el "hasta" con lo que el texto declara', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = sembrarCuenta(db, 'T902');
    const propietarioId = sembrarPropietario(db);

    const cargoJun = repo.crearMovimiento({ cuentaId, fecha: '2026-06-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 6 });
    const cargoJul = repo.crearMovimiento({ cuentaId, fecha: '2026-07-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 7 });

    // Declara junio-octubre (5 meses), pero agosto-octubre todavía no existen como CargoMensual
    // -- el sobrante quedó como crédito, sin aplicar. El ledger solo confirma junio-julio; el
    // texto es la única fuente para el "hasta" real que el recibo declara.
    const { detalleId } = sembrarRecibo(db, propietarioId, {
      numeroRecibo: 9003, cuentaId, fecha: '2026-05-09', valor: 50000,
      concepto: 'CUOTA DE SOSTENIMIENTO JUNIO A OCTUBRE 2026',
      periodoDesde: 'Junio 2026', periodoHasta: 'Junio 2026'
    });
    const abonoId = repo.crearMovimiento({ cuentaId, fecha: '2026-05-09', tipo: 'Abono', exigible: 1, monto: -20000, reciboDetalleId: detalleId });
    repo.crearImputacion({ abonoId, cargoId: cargoJun, monto: 10000 });
    repo.crearImputacion({ abonoId, cargoId: cargoJul, monto: 10000 });
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 30000, fecha: '2026-05-09', reciboDetalleId: detalleId, observaciones: 'Sobrante de imputación: crédito no aplicado' });

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    const resultado = r.periodosTextoCorregidos.find(p => p.numeroRecibo === 9003);
    assert.equal(resultado.corregido, true);
    assert.deepEqual(resultado.despues, ['Junio 2026', 'Octubre 2026']);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: período de texto -- idempotente, correr dos veces no lo vuelve a tocar', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);
    const cuentaId = sembrarCuenta(db, 'T903');
    const propietarioId = sembrarPropietario(db);
    sembrarRecibo(db, propietarioId, {
      numeroRecibo: 9004, cuentaId, fecha: '2022-08-13', valor: 60000,
      concepto: 'Cuota de sostenimiento Enero hasta Diciembre del 2022',
      periodoDesde: 'Enero 2022', periodoHasta: 'Enero 2022'
    });

    ejecutarPaso9b({ dbService: ctx.dbService });
    const r2 = ejecutarPaso9b({ dbService: ctx.dbService });

    const resultado = r2.periodosTextoCorregidos.find(p => p.numeroRecibo === 9004);
    assert.equal(resultado.corregido, false);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: período de texto -- sin año en el texto, deja el valor guardado tal cual (no adivina)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);
    const cuentaId = sembrarCuenta(db, 'T904');
    const propietarioId = sembrarPropietario(db);
    sembrarRecibo(db, propietarioId, {
      numeroRecibo: 9005, cuentaId, fecha: '2018-11-24', valor: 40000,
      concepto: 'CUOTA DE SOSTENIMIENTO MAYO A DICIEMBRE',
      periodoDesde: 'Mayo 2018', periodoHasta: 'Diciembre 2018'
    });

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    assert.equal(r.periodosTextoCorregidos.find(p => p.numeroRecibo === 9005), undefined);
    const detalle = db.prepare(`
      SELECT periodo_desde, periodo_hasta FROM recibo_detalles WHERE recibo_id = (SELECT id FROM recibos WHERE numero_recibo=9005)
    `).get();
    assert.equal(detalle.periodo_desde, 'Mayo 2018');
    assert.equal(detalle.periodo_hasta, 'Diciembre 2018');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso9b: período de texto -- override manual del recibo 171 (único mes abreviado de toda la base)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarTodas(db);
    const cuentaId = sembrarCuenta(db, 'T905');
    const propietarioId = sembrarPropietario(db);
    sembrarRecibo(db, propietarioId, {
      numeroRecibo: 171, cuentaId, fecha: '2018-11-01', valor: 49000,
      concepto: 'CUOTA DE SOSTENIMIENTO ENERO A NOV 2010',
      periodoDesde: 'Enero 2018', periodoHasta: 'Enero 2018'
    });

    const r = ejecutarPaso9b({ dbService: ctx.dbService });

    const resultado = r.periodosTextoCorregidos.find(p => p.numeroRecibo === 171);
    assert.deepEqual(resultado.despues, ['Enero 2010', 'Noviembre 2010']);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
