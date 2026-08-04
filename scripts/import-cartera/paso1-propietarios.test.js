const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { ejecutarPaso1, limpiarNombreDeCartera } = require('./paso1-propietarios');

function sembrarCuentaExistente(db, codigo, { conPropietario = true } = {}) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
  if (conPropietario) {
    db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES (?)`).run(`Propietario de ${codigo}`);
    const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = ?`).get(`Propietario de ${codigo}`).id;
    db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, '2020-01-01')`).run(cuentaId, propietarioId);
    return { cuentaId, propietarioId };
  }
  return { cuentaId };
}

test('paso1: reutiliza el propietario vigente de una cuenta que ya existe', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, propietarioId } = sembrarCuentaExistente(db, 'R001');

    const r = ejecutarPaso1({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'R001', nombre: 'ETIQUETA SUCIA R001' }],
      datosPropietarios: new Map()
    });

    assert.deepEqual(r.reutilizados, [{ codigo: 'R001', cuentaId, propietarioId }]);
    assert.equal(r.creados.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM propietarios').get().n, 1, 'no crea un propietario nuevo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso1: reporta alerta si una cuenta existente no tiene propietario vigente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId } = sembrarCuentaExistente(db, 'R002', { conPropietario: false });

    const r = ejecutarPaso1({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'R002', nombre: 'X' }],
      datosPropietarios: new Map()
    });

    assert.deepEqual(r.sinPropietarioVigente, [{ codigo: 'R002', cuentaId }]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso1: crea un propietario nuevo con el nombre limpio de DATOS para una cuenta que no existe', () => {
  const ctx = crearDbTemporal();
  try {
    const r = ejecutarPaso1({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'R080', nombre: 'OSPITIA JESUS ANTONIO R080' }],
      datosPropietarios: new Map([['R080', { nombre: 'OSPITIA JESUS ANTONIO', cedula: null, telefono: null, correo: null }]])
    });

    assert.equal(r.creados.length, 1);
    assert.equal(r.creados[0].nombre, 'OSPITIA JESUS ANTONIO');
    assert.equal(r.creados[0].nombrePorVerificar, false);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso1: sin dato en DATOS, limpia el código del nombre de CARTERA por regex y lo marca por verificar', () => {
  const ctx = crearDbTemporal();
  try {
    const r = ejecutarPaso1({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'X099', nombre: 'ALGUIEN SIN DATO X099' }],
      datosPropietarios: new Map()
    });

    assert.equal(r.creados.length, 1);
    assert.equal(r.creados[0].nombre, 'ALGUIEN SIN DATO');
    assert.equal(r.creados[0].nombrePorVerificar, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso1: S0244 se omite (conflicto de propietario), no crea propietario', () => {
  const ctx = crearDbTemporal();
  try {
    const r = ejecutarPaso1({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'S0244', nombre: 'ZAPATO MACHADO PEDRO NEL S0244' }],
      datosPropietarios: new Map([['S0244', { nombre: 'ZAPATO MACHADO PEDRO NEL' }]])
    });

    assert.equal(r.creados.length, 0);
    assert.equal(r.omitidos.length, 1);
    assert.equal(r.omitidos[0].codigo, 'S0244');
    assert.match(r.omitidos[0].motivo, /Conflicto de propietario/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso1: S0332S0382 se omite (código corrupto), no crea propietario', () => {
  const ctx = crearDbTemporal();
  try {
    const r = ejecutarPaso1({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'S0332S0382', nombre: 'MACHADO CARRETERO MARGARITA MARIA' }],
      datosPropietarios: new Map()
    });

    assert.equal(r.creados.length, 0);
    assert.equal(r.omitidos.length, 1);
    assert.match(r.omitidos[0].motivo, /Código corrupto/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('limpiarNombreDeCartera: quita el código pegado al final del nombre', () => {
  assert.equal(limpiarNombreDeCartera('BONILLA NELSON R002', 'R002').nombre, 'BONILLA NELSON');
  assert.equal(limpiarNombreDeCartera('OSPITIA JESUS ANTONIO R080', 'R080').nombre, 'OSPITIA JESUS ANTONIO');
});
