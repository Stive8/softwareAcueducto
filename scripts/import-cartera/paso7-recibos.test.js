const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { ejecutarPaso7, inferirMetodoPago, NUMERO_SINCODIFICAR_OMITIDO, OBSERVACION_CREADO } = require('./paso7-recibos');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

function sembrarPropietarioVigente(db, cuentaId, nombre = 'Propietario Test') {
  const propietarioId = db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES (?)`).run(nombre).lastInsertRowid;
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2020-01-01')`)
    .run(cuentaId, propietarioId);
  return propietarioId;
}

function sembrarRecibo(db, { numeroRecibo, cuentaId, propietarioId, fechaRecibo, fechaPagoReal, total = 10000, concepto = 'Concepto histórico', valor = 10000 }) {
  const reciboId = db.prepare(`
    INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago, fecha_pago_real)
    VALUES (?, ?, ?, ?, ?, 'Efectivo', ?)
  `).run(numeroRecibo, cuentaId, propietarioId, fechaRecibo, total, fechaPagoReal).lastInsertRowid;
  db.prepare(`INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, ?, ?)`).run(reciboId, concepto, valor);
  return reciboId;
}

function registro(overrides = {}) {
  return {
    numero_recibo: 100, codigo_cuenta: 'R001', fecha_recibo: '2024-01-15', fecha_pago_real: '2024-01-15',
    valor: 10000, concepto_original: 'CUOTA DE SOSTENIMIENTO ENERO 2024', clasificacion: 'sostenimiento',
    periodo_desde: '2024-01', periodo_hasta: '2024-01', genera_movimiento_cartera: true, es_split: false, nota: null,
    ...overrides
  };
}

test('paso7: recibo ya existente con fecha_pago_real distinta se actualiza sin tocar numero/fecha/valor/concepto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const propietarioId = sembrarPropietarioVigente(db, cuentaId);
    const reciboId = sembrarRecibo(db, {
      numeroRecibo: 100, cuentaId, propietarioId, fechaRecibo: '2024-01-15', fechaPagoReal: '2024-01-15',
      total: 10000, concepto: 'Concepto histórico intacto', valor: 10000
    });

    const r = ejecutarPaso7({
      dbService: ctx.dbService,
      recibosJson: [registro({ fecha_pago_real: '2024-01-20' })]
    });

    assert.equal(r.fechaPagoRealActualizada.length, 1);
    assert.equal(r.creados.length, 0);

    const recibo = db.prepare('SELECT * FROM recibos WHERE id = ?').get(reciboId);
    assert.equal(recibo.fecha_pago_real, '2024-01-20');
    assert.equal(recibo.fecha_recibo, '2024-01-15', 'fecha_recibo nunca se toca');
    assert.equal(recibo.total, 10000, 'total nunca se toca');
    const detalle = db.prepare('SELECT * FROM recibo_detalles WHERE recibo_id = ?').get(reciboId);
    assert.equal(detalle.concepto, 'Concepto histórico intacto', 'concepto nunca se toca');
    assert.equal(detalle.valor, 10000, 'valor del detalle nunca se toca');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso7: recibo ya existente con fecha_pago_real igual no genera ningún UPDATE (queda en yaCorrecta)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R001');
    const propietarioId = sembrarPropietarioVigente(db, cuentaId);
    sembrarRecibo(db, { numeroRecibo: 100, cuentaId, propietarioId, fechaRecibo: '2024-01-15', fechaPagoReal: '2024-01-15' });

    const r = ejecutarPaso7({
      dbService: ctx.dbService,
      recibosJson: [registro({ fecha_pago_real: '2024-01-15' })]
    });

    assert.equal(r.fechaPagoRealActualizada.length, 0);
    assert.deepEqual(r.yaCorrecta, [100]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso7: recibo que no existe (PENDIENTE DE CARGA) se crea completo con su detalle', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R064');
    sembrarPropietarioVigente(db, cuentaId);

    const r = ejecutarPaso7({
      dbService: ctx.dbService,
      recibosJson: [registro({
        numero_recibo: 2516, codigo_cuenta: 'R064', fecha_recibo: '2026-06-20', fecha_pago_real: '2026-06-20',
        valor: 60000, concepto_original: 'CUOTA DE SOSTENIMIENTO JULIO A DICIEMBRE 2026',
        periodo_desde: '2026-07', periodo_hasta: '2026-12',
        nota: 'PENDIENTE DE CARGA: existe en el talonario pero no en historial-aportes'
      })]
    });

    assert.equal(r.creados.length, 1);
    assert.equal(r.totalCreados, 60000);

    const recibo = db.prepare('SELECT * FROM recibos WHERE numero_recibo = 2516').get();
    assert.equal(recibo.cuenta_id, cuentaId);
    assert.equal(recibo.total, 60000);
    assert.equal(recibo.fecha_recibo, '2026-06-20');
    assert.equal(recibo.fecha_pago_real, '2026-06-20');
    assert.equal(recibo.observaciones, OBSERVACION_CREADO);

    const detalle = db.prepare('SELECT * FROM recibo_detalles WHERE recibo_id = ?').get(recibo.id);
    assert.equal(detalle.concepto, 'CUOTA DE SOSTENIMIENTO JULIO A DICIEMBRE 2026');
    assert.equal(detalle.periodo_desde, '2026-07');
    assert.equal(detalle.periodo_hasta, '2026-12');
    assert.equal(detalle.valor, 60000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso7: recibo partido (2 registros, mismo numero_recibo) crea 1 recibo con 2 detalles y total sumado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'R0945');
    sembrarPropietarioVigente(db, cuentaId);

    const r = ejecutarPaso7({
      dbService: ctx.dbService,
      recibosJson: [
        registro({
          numero_recibo: 2376, codigo_cuenta: 'R0945', fecha_recibo: '2026-01-10', fecha_pago_real: '2026-01-10',
          valor: 50000, concepto_original: 'CUOTA SOSTENIMIENTO', clasificacion: 'sostenimiento', es_split: true
        }),
        registro({
          numero_recibo: 2376, codigo_cuenta: 'R0945', fecha_recibo: '2026-01-10', fecha_pago_real: '2026-01-10',
          valor: 100000, concepto_original: 'ABONO PUNTO', clasificacion: 'punto', periodo_desde: null, periodo_hasta: null, es_split: true
        })
      ]
    });

    assert.equal(r.creados.length, 1);
    assert.equal(r.totalCreados, 150000);

    const recibo = db.prepare('SELECT * FROM recibos WHERE numero_recibo = 2376').get();
    assert.equal(recibo.total, 150000);
    const detalles = db.prepare('SELECT * FROM recibo_detalles WHERE recibo_id = ? ORDER BY id').all(recibo.id);
    assert.equal(detalles.length, 2);
    assert.equal(detalles[0].valor, 50000);
    assert.equal(detalles[1].valor, 100000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso7: metodo_pago se infiere del texto solo cuando lo dice explícitamente', () => {
  assert.equal(inferirMetodoPago('CUOTA MARZO (TRANSFERENCIA 26/06/26)'), 'Transferencia');
  assert.equal(inferirMetodoPago('CUOTA (TRANSFERENCA 02/07/26)'), 'Transferencia');
  assert.equal(inferirMetodoPago('PAGO EN EFECTIVO'), 'Efectivo');
  assert.equal(inferirMetodoPago('CONSIGNACION BANCOLOMBIA'), 'Consignacion');
  assert.equal(inferirMetodoPago('CUOTA DE SOSTENIMIENTO JUNIO 2026'), null);
});

test('paso7: recibo #1284 (SINCODIFICAR) se omite siempre, sin importar qué codigo_cuenta traiga', () => {
  const ctx = crearDbTemporal();
  try {
    const r = ejecutarPaso7({
      dbService: ctx.dbService,
      recibosJson: [registro({
        numero_recibo: NUMERO_SINCODIFICAR_OMITIDO, codigo_cuenta: 'SINCODIFICAR',
        nota: 'CUENTA SIN IDENTIFICAR en el talonario: asignar manualmente antes de generar movimientos'
      })]
    });
    assert.equal(r.creados.length, 0);
    assert.equal(r.omitidosSinCuenta.length, 0, 'no debe intentarse siquiera -- se filtra antes de agrupar');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso7: recibo nuevo cuya cuenta no existe en la base queda en omitidosSinCuenta, no revienta', () => {
  const ctx = crearDbTemporal();
  try {
    const r = ejecutarPaso7({
      dbService: ctx.dbService,
      recibosJson: [registro({ numero_recibo: 999, codigo_cuenta: 'X404' })]
    });
    assert.equal(r.creados.length, 0);
    assert.equal(r.omitidosSinCuenta.length, 1);
    assert.equal(r.omitidosSinCuenta[0].motivo, 'cuenta no existe en la base');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso7: recibo nuevo cuya cuenta existe pero no tiene propietario vigente queda en omitidosSinCuenta', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'R002');

    const r = ejecutarPaso7({
      dbService: ctx.dbService,
      recibosJson: [registro({ numero_recibo: 999, codigo_cuenta: 'R002' })]
    });
    assert.equal(r.creados.length, 0);
    assert.equal(r.omitidosSinCuenta.length, 1);
    assert.equal(r.omitidosSinCuenta[0].motivo, 'sin propietario vigente');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
