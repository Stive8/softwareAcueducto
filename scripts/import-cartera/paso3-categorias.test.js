const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { ejecutarPaso3 } = require('./paso3-categorias');

function sembrarCuentaSinClasificar(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
  const sinClasificarId = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Sin clasificar'`).get().id;
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2023-12-31')`).run(cuentaId, sinClasificarId);
  return cuentaId;
}

test('paso3: corrige las 6 excepciones sin dato en el JSON usando la decisión de negocio', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    for (const cod of ['R002', 'R0501', 'R0971', 'S009', 'R044', 'S03321']) sembrarCuentaSinClasificar(db, cod);

    const cuentasJson = [
      { codigo: 'R002', categoria: null }, { codigo: 'R0501', categoria: null },
      { codigo: 'R0971', categoria: null }, { codigo: 'S009', categoria: null },
      { codigo: 'R044', categoria: null }, { codigo: 'S03321', categoria: null }
    ];
    const r = ejecutarPaso3({ dbService: ctx.dbService, cuentasJson });

    assert.equal(r.corregidas.length, 6);
    assert.equal(r.sinClasificar.length, 0);

    const catR044 = db.prepare(`
      SELECT c.nombre FROM cuenta_categorias cc JOIN categorias c ON c.id=cc.categoria_id
      JOIN cuentas cu ON cu.id=cc.cuenta_id WHERE cu.codigo='R044'
    `).get();
    assert.equal(catR044.nombre, 'Tienda');
    assert.equal(db.prepare(`SELECT observaciones FROM cuentas WHERE codigo='R044'`).get().observaciones, 'Punto exento de cobro - escuela');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso3: corrige cuentas existentes en "Sin clasificar" usando la categoría ya resuelta en el JSON', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuentaSinClasificar(db, 'R034');
    sembrarCuentaSinClasificar(db, 'R101');

    const r = ejecutarPaso3({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'R034', categoria: 'Finca' }, { codigo: 'R101', categoria: 'Alquiler' }]
    });

    assert.equal(r.corregidas.length, 2);
    const catR034 = db.prepare(`
      SELECT c.nombre FROM cuenta_categorias cc JOIN categorias c ON c.id=cc.categoria_id
      JOIN cuentas cu ON cu.id=cc.cuenta_id WHERE cu.codigo='R034'
    `).get();
    assert.equal(catR034.nombre, 'Finca');
    const catR101 = db.prepare(`
      SELECT c.nombre FROM cuenta_categorias cc JOIN categorias c ON c.id=cc.categoria_id
      JOIN cuentas cu ON cu.id=cc.cuenta_id WHERE cu.codigo='R101'
    `).get();
    assert.equal(catR101.nombre, 'Finca para alquiler');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso3: cuenta sin categoría en el JSON y sin excepción se deja intacta', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuentaSinClasificar(db, 'O401');

    const r = ejecutarPaso3({ dbService: ctx.dbService, cuentasJson: [{ codigo: 'O401', categoria: null }] });

    assert.equal(r.corregidas.length, 0);
    assert.deepEqual(r.sinResolver.map(s => s.codigo), ['O401']);
    assert.deepEqual(r.sinClasificar, ['O401']);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso3: una cuenta que ya tiene la categoría correcta no se reescribe', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('R200', 'Vereda Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo='R200'`).get().id;
    const fincaId = db.prepare(`SELECT id FROM categorias WHERE nombre='Finca'`).get().id;
    db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, '2020-01-01')`).run(cuentaId, fincaId);

    const r = ejecutarPaso3({ dbService: ctx.dbService, cuentasJson: [{ codigo: 'R200', categoria: 'Finca' }] });

    assert.equal(r.corregidas.length, 0);
    assert.equal(r.yaCorrectas.length, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso3: S0332S0382 (desactivada en el paso 2) se ignora, no participa', () => {
  const ctx = crearDbTemporal();
  try {
    const r = ejecutarPaso3({ dbService: ctx.dbService, cuentasJson: [{ codigo: 'S0332S0382', categoria: null }] });
    assert.equal(r.corregidas.length, 0);
    assert.equal(r.sinResolver.length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
