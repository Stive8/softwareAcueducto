// src/repositories/ReciboRepository.orden.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ReciboRepository = require('./ReciboRepository');

function sembrarCuentaYPropietario(db) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Vereda Test')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;
  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test')`).run();
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Propietario Test'`).get().id;
  return { cuentaId, propietarioId };
}

function crearRecibo(db, { numeroRecibo, cuentaId, propietarioId, fecha }) {
  db.prepare(`
    INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
    VALUES (?, ?, ?, ?, 10000, 'Efectivo')
  `).run(numeroRecibo, cuentaId, propietarioId, fecha);
}

test('findAll() ordena por fecha del recibo, no por número -- un recibo duplicado del talonario físico reconstruido con numeración 9xxxx (para no chocar con la numeración real) no debe taparle el primer lugar a los recibos recientes', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, propietarioId } = sembrarCuentaYPropietario(db);

    // El "duplicado" es un recibo viejo (2018) al que se le asignó un número alto a propósito
    // para no colisionar con la numeración real -- no es, ni debe verse, como el más reciente.
    crearRecibo(db, { numeroRecibo: 90014, cuentaId, propietarioId, fecha: '2018-01-06' });
    crearRecibo(db, { numeroRecibo: 2564, cuentaId, propietarioId, fecha: '2026-06-27' });
    crearRecibo(db, { numeroRecibo: 2565, cuentaId, propietarioId, fecha: '2026-08-20' });

    const repo = new ReciboRepository(ctx.dbService);
    const resultado = repo.findAll({ page: 1, limit: 10 });

    assert.deepEqual(resultado.data.map(r => r.numero_recibo), [2565, 2564, 90014]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
