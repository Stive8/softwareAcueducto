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

test('generarHTML(id, "carta") usa la plantilla carta', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId } = sembrarRecibo(db);
    const service = new ReciboService(ctx.dbService);

    const html = service.generarHTML(reciboId, 'carta');
    assert.match(html, /Recibo No\. 6001/);
    assert.match(html, /info-grid/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('generarHTML(id, "termico_80mm") usa la plantilla térmica', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId } = sembrarRecibo(db);
    const service = new ReciboService(ctx.dbService);

    const html = service.generarHTML(reciboId, 'termico_80mm');
    assert.match(html, /RECIBO No\. 6001/);
    assert.match(html, /80mm/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('generarHTML(id) sin formato usa el predeterminado de configuración', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId } = sembrarRecibo(db);
    db.prepare(`
      INSERT INTO configuracion (clave, valor) VALUES ('formato_impresion_recibo', 'termico_80mm')
      ON CONFLICT(clave) DO UPDATE SET valor = 'termico_80mm'
    `).run();
    const service = new ReciboService(ctx.dbService);

    const html = service.generarHTML(reciboId);
    assert.match(html, /80mm/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('generarHTML refleja el valor VIGENTE (post-corrección), no el original', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId, detalleId } = sembrarRecibo(db);
    const service = new ReciboService(ctx.dbService);

    service.corregirCampo({
      reciboId, reciboDetalleId: detalleId, campo: 'concepto',
      valorNuevo: 'Cuota enero 2024 (corregido: era febrero)', motivo: 'Mes mal escrito'
    });

    const html = service.generarHTML(reciboId, 'carta');
    assert.match(html, /Cuota enero 2024 \(corregido: era febrero\)/);
    assert.doesNotMatch(html, />Cuota enero 2024</);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('obtenerDatosParaImprimir lanza si el recibo no existe', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new ReciboService(ctx.dbService);
    assert.throws(() => service.obtenerDatosParaImprimir(999999), /Recibo no encontrado/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
