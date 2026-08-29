const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const { calcularConciliacion } = require('./paso11-conciliacion');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

function sembrarPunto(db, cuentaId, { valorTotal, saldoPendiente }) {
  db.prepare(`
    INSERT INTO nuevos_puntos (cuenta_id, valor_total, saldo_pendiente, fecha_registro, estado, observaciones)
    VALUES (?, ?, ?, '2024-01-01', ?, 'Carga inicial de cartera')
  `).run(cuentaId, valorTotal, saldoPendiente, saldoPendiente === 0 ? 'Pagado' : 'Pendiente');
}

// snapshotCaptura: por defecto sin crédito ni punto pendiente -- los tests que necesitan un
// valor real lo pasan explícito. Reproduce lo que capturar-snapshot-conciliacion.js hubiera
// escrito en cuenta.conciliacion.snapshot_captura a partir del estado sembrado en la base.
function cuenta(overrides = {}, snapshotCaptura = { saldo_credito_disponible: 0, saldo_pendiente_punto: 0 }) {
  return {
    codigo: 'R001',
    apertura_opaca_2023_12_31: null,
    plan_causacion: { '2026': { tarifa: 10000 } },
    conciliacion: {
      saldo_cartera_excel_2026: 100000, abonos_punto_desde_2024: 0,
      saldo_sostenimiento_esperado: 100000, cuadra_exacto: true, motivo_diferencia: null,
      snapshot_captura: { fecha: '2026-08-14', nota: 'test', ...snapshotCaptura }
    },
    ...overrides
  };
}

test('calcularConciliacion: omite R031 (cuenta fantasma fusionada con R0301 en la corrección 34) en vez de lanzar error porque ya no existe en la base', () => {
  // Regresión: cuando se fusionó S058 con R0081 (corrección 23) se agregó el salto explícito
  // "if (cuenta.codigo === 'S058') continue" para que la conciliación (que compara contra
  // data/carga_inicial_cartera.json, con las cuentas originales) no reventara al no encontrar
  // esa cuenta. La fusión de R031 con R0301 (corrección 34, commit 7c67d6d) no agregó el mismo
  // salto: `npm run conciliacion` quedó rota (Error: "R031: no existe en la base") desde ese
  // commit -- nadie la corrió después para notarlo.
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'R0301');

    const r = calcularConciliacion({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({ codigo: 'R0301' }), cuenta({ codigo: 'R031' })],
      recibosJson: []
    });

    assert.equal(r.filas.length, 1, 'solo R0301 debe evaluarse; R031 se omite');
    assert.equal(r.filas[0].codigo, 'R0301');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: diferencia cero cuando el saldo del sistema calza exacto con el objetivo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const repo = new CarteraRepository(ctx.dbService);
    // saldo_objetivo = 100000 - 5*10000 = 50000
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 50000 });

    const r = calcularConciliacion({ dbService: ctx.dbService, cuentasJson: [cuenta()], recibosJson: [] });

    assert.equal(r.filas.length, 1);
    assert.equal(r.filas[0].diferencia, 0);
    assert.equal(r.cero.length, 1);
    assert.equal(r.bajo.length, 0);
    assert.equal(r.alto.length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: cuadra_exacto:false CON apertura opaca -> se suma abonos_punto_desde_2024', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'C0171');
    const repo = new CarteraRepository(ctx.dbService);
    sembrarPunto(db, cuentaId, { valorTotal: 500000, saldoPendiente: 0 }); // punto ya saldado
    // objetivo bruto = 360000-50000=310000; +300000 (abono punto) = 610000
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 610000 });

    const r = calcularConciliacion({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({
        codigo: 'C0171', apertura_opaca_2023_12_31: 300000,
        conciliacion: {
          saldo_cartera_excel_2026: 360000, abonos_punto_desde_2024: 300000,
          saldo_sostenimiento_esperado: 660000, cuadra_exacto: false,
          motivo_diferencia: 'CARTERA aplico los abonos al punto contra el sostenimiento sin causar el cargo del punto',
          snapshot_captura: { saldo_credito_disponible: 0, saldo_pendiente_punto: 0 }
        }
      })],
      recibosJson: []
    });

    assert.equal(r.filas[0].diferencia, 0);
    assert.equal(r.cero.length, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: el saldo a favor disponible se suma al target, igual que el término de punto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const repo = new CarteraRepository(ctx.dbService);
    // saldo_objetivo bruto = 100000 - 5*10000 = 50000. Si el sistema muestra 90000 de deuda
    // (por haber recortado un abono con 40000 de sobrante a crédito), sin el término de crédito
    // la diferencia sería 40000 -- exactamente el crédito, sin ninguna causa real.
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 90000 });
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 40000, fecha: '2026-01-01' });

    // El crédito vive en la base (para que otras lecturas lo vean), pero el target lee el
    // snapshot, no la base -- se pasa el mismo valor a mano porque acá es lo que
    // capturar-snapshot-conciliacion.js hubiera fotografiado en ese momento.
    const r = calcularConciliacion({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({}, { saldo_credito_disponible: 40000, saldo_pendiente_punto: 0 })],
      recibosJson: []
    });

    assert.equal(r.filas[0].saldoCreditoDisponible, 40000);
    assert.equal(r.filas[0].target, 90000, '50000 del objetivo bruto + 40000 del crédito disponible');
    assert.equal(r.filas[0].diferencia, 0, 'el crédito no aplicado no debe aparecer como diferencia sin explicar');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: cuadra_exacto:false SIN apertura opaca -> se resta el saldo pendiente del punto, no el abono', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R0946');
    const repo = new CarteraRepository(ctx.dbService);
    sembrarPunto(db, cuentaId, { valorTotal: 500000, saldoPendiente: 300000 }); // 200000 abonados, 300000 pendientes
    // objetivo bruto = 460000-50000=410000; -300000 (saldo pendiente punto) = 110000
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 110000 });

    const r = calcularConciliacion({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({
        codigo: 'R0946', apertura_opaca_2023_12_31: null,
        conciliacion: {
          saldo_cartera_excel_2026: 460000, abonos_punto_desde_2024: 200000,
          saldo_sostenimiento_esperado: 660000, cuadra_exacto: false,
          motivo_diferencia: 'CARTERA aplico los abonos al punto contra el sostenimiento sin causar el cargo del punto',
          snapshot_captura: { saldo_credito_disponible: 0, saldo_pendiente_punto: 300000 }
        }
      })],
      recibosJson: []
    });

    assert.equal(r.filas[0].diferencia, 0);
    assert.equal(r.cero.length, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: cuadra_exacto:true CON cargo_punto_incluido y saldo de punto aun pendiente (R0944) -> se resta ese pendiente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R0944');
    const repo = new CarteraRepository(ctx.dbService);
    sembrarPunto(db, cuentaId, { valorTotal: 500000, saldoPendiente: 300000 });
    // objetivo bruto = 470000-50000=420000; -300000 (saldo pendiente punto) = 120000
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 120000 });

    const r = calcularConciliacion({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({
        codigo: 'R0944',
        plan_causacion: { '2025': { tarifa: 10000, cargo_punto_incluido: 500000 }, '2026': { tarifa: 10000 } },
        conciliacion: {
          saldo_cartera_excel_2026: 470000, abonos_punto_desde_2024: 200000,
          saldo_sostenimiento_esperado: 670000, cuadra_exacto: true, motivo_diferencia: null,
          snapshot_captura: { saldo_credito_disponible: 0, saldo_pendiente_punto: 300000 }
        }
      })],
      recibosJson: []
    });

    assert.equal(r.filas[0].diferencia, 0, 'cuadra_exacto:true con cargo_punto_incluido SI lleva la correccion cuando aun hay saldo de punto pendiente');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: cuadra_exacto:true SIN cargo_punto_incluido no se toca aunque tenga un punto con saldo pendiente propio', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R068');
    const repo = new CarteraRepository(ctx.dbService);
    sembrarPunto(db, cuentaId, { valorTotal: 300000, saldoPendiente: 300000 }); // punto sin relacion con esta diferencia
    // objetivo bruto = 120000-50000=70000, SIN correccion de punto (no tiene cargo_punto_incluido)
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 70000 });

    const r = calcularConciliacion({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({
        codigo: 'R068',
        plan_causacion: { '2024': { tarifa: 10000, cargo_punto_incluido: null }, '2026': { tarifa: 10000 } },
        conciliacion: {
          saldo_cartera_excel_2026: 120000, abonos_punto_desde_2024: 0,
          saldo_sostenimiento_esperado: 120000, cuadra_exacto: true, motivo_diferencia: null,
          snapshot_captura: { saldo_credito_disponible: 0, saldo_pendiente_punto: 300000 }
        }
      })],
      recibosJson: []
    });

    assert.equal(r.filas[0].diferencia, 0, 'restar el saldo pendiente de un punto no relacionado rompe una cuenta que ya cuadraba');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: cuadra_exacto:true con abonos_punto_desde_2024 informativo (punto ya saldado) -> no se resta nada', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'C0041');
    const repo = new CarteraRepository(ctx.dbService);
    sembrarPunto(db, cuentaId, { valorTotal: 500000, saldoPendiente: 0 });
    // objetivo bruto = 120000-50000=70000, sin correccion de punto (saldo pendiente 0)
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 70000 });

    const r = calcularConciliacion({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({
        codigo: 'C0041',
        conciliacion: {
          saldo_cartera_excel_2026: 120000, abonos_punto_desde_2024: 500000,
          saldo_sostenimiento_esperado: 620000, cuadra_exacto: true, motivo_diferencia: null,
          snapshot_captura: { saldo_credito_disponible: 0, saldo_pendiente_punto: 0 }
        }
      })],
      recibosJson: []
    });

    assert.equal(r.filas[0].diferencia, 0, 'cuadra_exacto:true nunca suma abonos_punto_desde_2024, aunque venga poblado');
    assert.equal(r.alto.length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: recibos "pendientes de carga" se restan del objetivo, agrupados por cuenta', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'S034');
    const repo = new CarteraRepository(ctx.dbService);
    // objetivo bruto = 100000-50000=50000; -100000 (2 recibos pendientes de carga de 50000 c/u) = -50000
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: -50000 });

    const r = calcularConciliacion({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({ codigo: 'S034' })],
      recibosJson: [
        { codigo_cuenta: 'S034', valor: 50000, nota: 'PENDIENTE DE CARGA: existe en el talonario pero no en historial-aportes' },
        { codigo_cuenta: 'S034', valor: 50000, nota: 'PENDIENTE DE CARGA: existe en el talonario pero no en historial-aportes' },
        { codigo_cuenta: 'OTRA', valor: 999999, nota: 'PENDIENTE DE CARGA: existe en el talonario pero no en historial-aportes' }
      ]
    });

    assert.equal(r.filas[0].pendienteDeCarga, 100000);
    assert.equal(r.filas[0].diferencia, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: falla explícito si a la cuenta le falta snapshot_captura, no cae a leer en vivo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const repo = new CarteraRepository(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 50000 });

    const cuentaSinSnapshot = cuenta();
    delete cuentaSinSnapshot.conciliacion.snapshot_captura;

    assert.throws(
      () => calcularConciliacion({ dbService: ctx.dbService, cuentasJson: [cuentaSinSnapshot], recibosJson: [] }),
      /snapshot_captura/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: redimir un crédito después de la captura NO mueve la diferencia (la garantía que motivó el snapshot)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const repo = new CarteraRepository(ctx.dbService);
    const CarteraService = require('../../src/services/CarteraService');
    const { MODOS } = require('../../src/services/cartera/imputacion');
    const service = new CarteraService(ctx.dbService);

    // Crédito de $40.000 sin redimir todavía, y SIN ningún cargo pendiente ya causado contra
    // el cual imputarlo (mismo patrón que R005: pago adelantado de meses que la carga no
    // llegó a causar) -- capturado tal cual en el snapshot.
    repo.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 90000 });
    repo.crearCredito({ cuentaId, tipo: 'Abono', monto: 40000, fecha: '2026-01-01' });

    const cuentaJson = cuenta({}, { saldo_credito_disponible: 40000, saldo_pendiente_punto: 0 });

    const antes = calcularConciliacion({ dbService: ctx.dbService, cuentasJson: [cuentaJson], recibosJson: [] });
    assert.equal(antes.filas[0].diferencia, 0);

    // Operación normal, posterior a la captura: se causa el mes futuro que el crédito estaba
    // esperando y se redime ahí mismo -- igual que asegurarCausacion + redimirCredito sobre R005.
    repo.crearMovimiento({ cuentaId, fecha: '2026-08-01', tipo: 'CargoMensual', exigible: 1, monto: 40000, anio: 2026, mes: 8 });
    service.redimirCredito({ cuentaId, fecha: '2026-08-01', monto: 40000, modo: MODOS.ABONO_DEUDA_FIFO });

    const despues = calcularConciliacion({ dbService: ctx.dbService, cuentasJson: [cuentaJson], recibosJson: [] });
    assert.equal(despues.filas[0].diferencia, 0, 'la redención es una reclasificación de plata que ya existía -- no debe descuadrar nada');
    assert.equal(despues.filas[0].saldoCreditoDisponible, 40000, 'el término sigue siendo el de la foto, no el saldo en vivo (que ahora es 0)');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: cuenta sin saldo_sostenimiento_esperado (null) queda en sinTarget, no en filas', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'O401');

    const r = calcularConciliacion({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({
        codigo: 'O401',
        conciliacion: { saldo_cartera_excel_2026: null, abonos_punto_desde_2024: 0, saldo_sostenimiento_esperado: null, cuadra_exacto: true, motivo_diferencia: null }
      })],
      recibosJson: []
    });

    assert.equal(r.filas.length, 0);
    assert.equal(r.sinTarget.length, 1);
    assert.equal(r.sinTarget[0].codigo, 'O401');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularConciliacion: clasifica bajo (<1000) y alto (>=1000) correctamente, alto ordenado por magnitud', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaBaja = sembrarCuenta(db, 'R001');
    const cuentaAlta1 = sembrarCuenta(db, 'R002');
    const cuentaAlta2 = sembrarCuenta(db, 'R003');
    const repo = new CarteraRepository(ctx.dbService);
    // objetivo = 100000 - 50000 = 50000 en los tres casos
    repo.crearMovimiento({ cuentaId: cuentaBaja, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 50500 }); // dif 500
    repo.crearMovimiento({ cuentaId: cuentaAlta1, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 55000 }); // dif 5000
    repo.crearMovimiento({ cuentaId: cuentaAlta2, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 60000 }); // dif 10000

    const r = calcularConciliacion({
      dbService: ctx.dbService,
      cuentasJson: [cuenta({ codigo: 'R001' }), cuenta({ codigo: 'R002' }), cuenta({ codigo: 'R003' })],
      recibosJson: []
    });

    assert.equal(r.bajo.length, 1);
    assert.equal(r.bajo[0].codigo, 'R001');
    assert.equal(r.alto.length, 2);
    assert.deepEqual(r.alto.map(f => f.codigo), ['R003', 'R002'], 'ordenado de mayor a menor magnitud');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
