// src/services/ReciboService.correcciones.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ReciboService = require('./ReciboService');

function sembrarRecibo(db) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Vereda Test')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;
  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test')`).run();
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Propietario Test'`).get().id;

  const reciboId = db.prepare(`
    INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
    VALUES (6001, ?, ?, '2024-01-15', 10000, 'Efectivo')
  `).run(cuentaId, propietarioId).lastInsertRowid;
  const detalleId = db.prepare(`
    INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, 'Cuota enero 2024', 10000)
  `).run(reciboId).lastInsertRowid;

  return { reciboId, detalleId };
}

test('corregirCampo: corrige fecha_recibo sin sobrescribir la columna original', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId } = sembrarRecibo(db);
    const service = new ReciboService(ctx.dbService);

    service.corregirCampo({ reciboId, campo: 'fecha_recibo', valorNuevo: '2024-01-16', motivo: 'Error de digitación' });

    const original = db.prepare(`SELECT fecha_recibo FROM recibos WHERE id = ?`).get(reciboId);
    assert.equal(original.fecha_recibo, '2024-01-15', 'la columna original nunca se toca');
    assert.equal(service.getValorVigente(reciboId, 'fecha_recibo'), '2024-01-16');

    const historial = service.getHistorialCorrecciones(reciboId);
    assert.equal(historial.length, 1);
    assert.equal(historial[0].valor_anterior, '2024-01-15');
    assert.equal(historial[0].valor_nuevo, '2024-01-16');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('corregirCampo: corrige concepto de un recibo_detalle puntual', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId, detalleId } = sembrarRecibo(db);
    const service = new ReciboService(ctx.dbService);

    service.corregirCampo({
      reciboId, reciboDetalleId: detalleId, campo: 'concepto',
      valorNuevo: 'Cuota enero 2024 (corregido: era febrero)', motivo: 'Mes mal escrito en la colilla'
    });

    const original = db.prepare(`SELECT concepto FROM recibo_detalles WHERE id = ?`).get(detalleId);
    assert.equal(original.concepto, 'Cuota enero 2024', 'el concepto original queda intacto');
    assert.equal(service.getValorVigente(reciboId, 'concepto', detalleId), 'Cuota enero 2024 (corregido: era febrero)');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('corregirCampo: una segunda corrección se apoya en la vigente, no en la original', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId } = sembrarRecibo(db);
    const service = new ReciboService(ctx.dbService);

    service.corregirCampo({ reciboId, campo: 'numero_recibo', valorNuevo: '6002', motivo: 'Primera corrección' });
    service.corregirCampo({ reciboId, campo: 'numero_recibo', valorNuevo: '6003', motivo: 'Segunda corrección' });

    const historial = service.getHistorialCorrecciones(reciboId);
    assert.equal(historial.length, 2);
    assert.equal(historial[1].valor_anterior, '6002', 'la segunda corrección parte del valor vigente, no del original 6001');
    assert.equal(service.getValorVigente(reciboId, 'numero_recibo'), '6003');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('corregirCampo: rechaza campos no editables, recibos anulados, motivo vacío y valores sin cambio', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId, detalleId } = sembrarRecibo(db);
    const service = new ReciboService(ctx.dbService);

    assert.throws(
      () => service.corregirCampo({ reciboId, campo: 'total', valorNuevo: '5000', motivo: 'x' }),
      /Campo no editable/
    );
    assert.throws(
      () => service.corregirCampo({ reciboId, campo: 'concepto', valorNuevo: 'x', motivo: 'x' }),
      /requiere indicar el recibo_detalle/
    );
    assert.throws(
      () => service.corregirCampo({ reciboId, reciboDetalleId: detalleId, campo: 'fecha_recibo', valorNuevo: '2024-01-16', motivo: 'x' }),
      /pertenece al recibo, no a un detalle/
    );
    assert.throws(
      () => service.corregirCampo({ reciboId, campo: 'fecha_recibo', valorNuevo: '2024-01-15', motivo: 'x' }),
      /igual al valor vigente/
    );
    assert.throws(
      () => service.corregirCampo({ reciboId, campo: 'fecha_recibo', valorNuevo: '2024-01-16', motivo: '' }),
      /motivo/
    );

    service.anular(reciboId, 'Prueba de anulación');
    assert.throws(
      () => service.corregirCampo({ reciboId, campo: 'fecha_recibo', valorNuevo: '2024-01-16', motivo: 'x' }),
      /No se puede corregir un recibo anulado/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
