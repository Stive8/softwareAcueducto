// src/database/migrations/040_recibo_correcciones.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

test('040: crea recibo_correcciones con el CHECK de campo y FKs a recibos/recibo_detalles', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;
    db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Test')`).run();
    const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Test'`).get().id;
    const reciboId = db.prepare(`
      INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
      VALUES (7001, ?, ?, '2024-01-01', 10000, 'Efectivo')
    `).run(cuentaId, propietarioId).lastInsertRowid;

    db.prepare(`
      INSERT INTO recibo_correcciones (recibo_id, campo, valor_anterior, valor_nuevo, motivo)
      VALUES (?, 'fecha_recibo', '2024-01-01', '2024-01-02', 'Error de digitación')
    `).run(reciboId);

    assert.throws(
      () => db.prepare(`
        INSERT INTO recibo_correcciones (recibo_id, campo, valor_nuevo, motivo) VALUES (?, 'total', '5000', 'x')
      `).run(reciboId),
      /CHECK constraint failed/,
      '"total" no es un campo editable declarado en el CHECK'
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
