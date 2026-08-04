const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { ejecutarPaso2, aplicarCasosEspeciales, resolverDireccion } = require('./paso2-cuentas');

test('resolverDireccion: mapea por prefijo, con placeholder para el resto', () => {
  assert.equal(resolverDireccion('C021'), 'Vereda El Cural');
  assert.equal(resolverDireccion('R002'), 'Vereda El Rodeo');
  assert.equal(resolverDireccion('S009'), 'Vereda El Salitre');
  assert.equal(resolverDireccion('O401'), 'Dirección no registrada - verificar');
});

test('paso2: crea una cuenta nueva con categoría mapeada, dirección por vereda y propietario del paso 1', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('CASTRO DIEGO')`).run();
    const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'CASTRO DIEGO'`).get().id;

    const r = ejecutarPaso2({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'C021', categoria: 'Finca', mensualidad_2026: 10000, lat_acometida: 4.367, lon_acometida: -75.187, nombre_predio: null }],
      propietariosCreados: [{ codigo: 'C021', propietarioId, nombre: 'CASTRO DIEGO' }]
    });

    assert.equal(r.creadas.length, 1);
    const cuenta = db.prepare('SELECT * FROM cuentas WHERE codigo = ?').get('C021');
    assert.equal(cuenta.direccion, 'Vereda El Cural');
    assert.equal(cuenta.estado, 'Activo');
    assert.equal(cuenta.lat_acometida, 4.367);

    const cat = db.prepare(`
      SELECT c.nombre FROM cuenta_categorias cc JOIN categorias c ON c.id = cc.categoria_id
      WHERE cc.cuenta_id = ?
    `).get(cuenta.id);
    assert.equal(cat.nombre, 'Finca');

    const prop = db.prepare('SELECT propietario_id FROM cuenta_propietarios WHERE cuenta_id = ?').get(cuenta.id);
    assert.equal(prop.propietario_id, propietarioId);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso2: mapea Comercial->Tienda y Alquiler->Finca para alquiler', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    ejecutarPaso2({
      dbService: ctx.dbService,
      cuentasJson: [
        { codigo: 'R0211', categoria: 'Comercial', lat_acometida: null, lon_acometida: null, nombre_predio: null },
        { codigo: 'R999', categoria: 'Alquiler', lat_acometida: null, lon_acometida: null, nombre_predio: null }
      ],
      propietariosCreados: []
    });
    const catR0211 = db.prepare(`
      SELECT c.nombre FROM cuenta_categorias cc JOIN categorias c ON c.id=cc.categoria_id
      JOIN cuentas cu ON cu.id=cc.cuenta_id WHERE cu.codigo='R0211'
    `).get();
    assert.equal(catR0211.nombre, 'Tienda');
    const catR999 = db.prepare(`
      SELECT c.nombre FROM cuenta_categorias cc JOIN categorias c ON c.id=cc.categoria_id
      JOIN cuentas cu ON cu.id=cc.cuenta_id WHERE cu.codigo='R999'
    `).get();
    assert.equal(catR999.nombre, 'Finca para alquiler');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso2: categoría null cae a "Sin clasificar" y se reporta como placeholder a revisar', () => {
  const ctx = crearDbTemporal();
  try {
    const r = ejecutarPaso2({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'R044', categoria: null, lat_acometida: null, lon_acometida: null, nombre_predio: null }],
      propietariosCreados: []
    });
    assert.equal(r.categoriaPlaceholder.length, 1);
    assert.equal(r.categoriaPlaceholder[0].codigo, 'R044');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso2: omite cuentas que ya existen en la base (no son parte de las 14)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('R001', 'Vereda El Rodeo')`).run();

    const r = ejecutarPaso2({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'R001', categoria: 'Finca', lat_acometida: null, lon_acometida: null, nombre_predio: null }],
      propietariosCreados: []
    });
    assert.equal(r.creadas.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cuentas').get().n, 1, 'no duplica la cuenta existente');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('casos especiales: desactiva S0332 - S0382 con observación y cuenta_estados, sin borrar el propietario', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('MACHADO CARRETERO MARGARITA MARIA')`).run();
    const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo LIKE 'MACHADO%'`).get().id;
    db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES ('S0332 - S0382', 'Vereda El Salitre', 'Activo')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'S0332 - S0382'`).get().id;
    db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2022-07-30')`).run(cuentaId, propietarioId);
    db.prepare(`INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio) VALUES (?, 'Activo', '2026-06-27')`).run(cuentaId);

    const r = aplicarCasosEspeciales({ dbService: ctx.dbService, fechaHoy: '2026-07-31' });

    const cuenta = db.prepare('SELECT estado, observaciones FROM cuentas WHERE id = ?').get(cuentaId);
    assert.equal(cuenta.estado, 'Inactivo');
    assert.equal(cuenta.observaciones, 'Código corrupto, repartida entre S0332 y S0382');

    const vigencia = db.prepare('SELECT estado, fecha_fin FROM cuenta_estados WHERE cuenta_id = ? ORDER BY id DESC').all(cuentaId);
    assert.equal(vigencia[0].estado, 'Inactivo');

    const propietarioIntacto = db.prepare('SELECT COUNT(*) n FROM propietarios WHERE id = ?').get(propietarioId);
    assert.equal(propietarioIntacto.n, 1, 'el propietario huérfano no se borra');
    assert.equal(r.s0332s0382.accion, 'desactivada');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('casos especiales: S063 solo recibe la observación, sin cambio de estado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES ('S063', 'Vereda El Salitre', 'Activo')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'S063'`).get().id;

    const r = aplicarCasosEspeciales({ dbService: ctx.dbService, fechaHoy: '2026-07-31' });

    const cuenta = db.prepare('SELECT estado, observaciones FROM cuentas WHERE id = ?').get(cuentaId);
    assert.equal(cuenta.estado, 'Activo', 'no se toca el estado');
    assert.equal(cuenta.observaciones, 'Fusionada con S0365, ver esa cuenta');
    assert.equal(r.s063.accion, 'observación agregada');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
