const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const CarteraService = require('../../src/services/CarteraService');
const NuevoPuntoRepository = require('../../src/repositories/NuevoPuntoRepository');
const { ejecutarPaso6, FECHA_APERTURA, OBSERVACION_GENERICA } = require('./paso6-punto');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

function puntoBase(overrides = {}) {
  return {
    precio: 300000, abonado: 300000, saldo: 0, estado: 'Saldado',
    primer_abono: '2019-01-04', abonado_pre_2024: 300000, abonado_desde_2024: 0,
    origen_precio: 'override de negocio', nota: null,
    ...overrides
  };
}

test('paso6: crea el punto y el abono de apertura cuando abonado_pre_2024 > 0', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'S0331');

    const r = ejecutarPaso6({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'S0331', punto_conexion: puntoBase({ nota: 'nota específica' }) }]
    });

    assert.equal(r.totalCreados, 1);
    assert.equal(r.conAbonoApertura.length, 1);
    assert.equal(r.totalAperturaAbonos, 300000);

    const repo = new NuevoPuntoRepository(ctx.dbService);
    const punto = repo.findById(r.creados[0].nuevoPuntoId);
    assert.equal(punto.valor_total, 300000);
    assert.equal(punto.saldo_pendiente, 0, 'actualizarSaldoYEstado debe dejar el saldo en 0');
    assert.equal(punto.estado, 'Pagado');
    assert.equal(punto.fecha_registro, '2019-01-04');

    const abonos = repo.getAbonos(punto.id);
    assert.equal(abonos.length, 1);
    assert.equal(abonos[0].monto, 300000);
    assert.equal(abonos[0].fecha_abono, FECHA_APERTURA);
    assert.equal(abonos[0].recibo_detalle_id, null);
    assert.equal(abonos[0].observaciones, 'nota específica');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso6: sin nota usa la observación genérica', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'S0331');

    ejecutarPaso6({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'S0331', punto_conexion: puntoBase({ nota: null }) }]
    });

    const repo = new NuevoPuntoRepository(ctx.dbService);
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo='S0331'`).get().id;
    const [punto] = repo.findByCuentaId(cuentaId);
    const [abono] = repo.getAbonos(punto.id);
    assert.equal(abono.observaciones, OBSERVACION_GENERICA);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso6: abonado_pre_2024 = 0 no crea abono, el punto queda Pendiente por el monto completo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'S0999');

    const r = ejecutarPaso6({
      dbService: ctx.dbService,
      cuentasJson: [{
        codigo: 'S0999',
        punto_conexion: puntoBase({ abonado: 0, saldo: 300000, abonado_pre_2024: 0, estado: 'Pendiente' })
      }]
    });

    assert.equal(r.conAbonoApertura.length, 0);
    assert.equal(r.sinAbonoApertura.length, 1);

    const repo = new NuevoPuntoRepository(ctx.dbService);
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo='S0999'`).get().id;
    const [punto] = repo.findByCuentaId(cuentaId);
    assert.equal(punto.saldo_pendiente, 300000, 'sin abono de apertura, el saldo pendiente es el valor total');
    assert.equal(repo.getAbonos(punto.id).length, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso6: abonado_desde_2024 no genera abono aquí -- queda diferido al paso 8', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'S0500');

    ejecutarPaso6({
      dbService: ctx.dbService,
      cuentasJson: [{
        codigo: 'S0500',
        punto_conexion: puntoBase({ abonado: 300000, saldo: 0, abonado_pre_2024: 100000, abonado_desde_2024: 200000 })
      }]
    });

    const repo = new NuevoPuntoRepository(ctx.dbService);
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo='S0500'`).get().id;
    const [punto] = repo.findByCuentaId(cuentaId);
    assert.equal(punto.saldo_pendiente, 200000, 'solo se refleja el abono pre-2024, el resto lo trae el paso 8');
    assert.equal(repo.getAbonos(punto.id).length, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso6: cuenta sin punto_conexion (null) se ignora por completo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'S0001');

    const r = ejecutarPaso6({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'S0001', punto_conexion: null }]
    });

    assert.equal(r.totalCreados, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso6: S0332S0382 se ignora aunque traiga punto_conexion', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'S0332S0382');

    const r = ejecutarPaso6({
      dbService: ctx.dbService,
      cuentasJson: [{ codigo: 'S0332S0382', punto_conexion: puntoBase() }]
    });

    assert.equal(r.totalCreados, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso6: deudaPuntoConexion en getEstadoCartera refleja el saldo pendiente tras la apertura', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'S0700');

    ejecutarPaso6({
      dbService: ctx.dbService,
      cuentasJson: [{
        codigo: 'S0700',
        punto_conexion: puntoBase({ precio: 500000, abonado: 300000, saldo: 200000, abonado_pre_2024: 300000 })
      }]
    });

    const service = new CarteraService(ctx.dbService);
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo='S0700'`).get().id;
    const estado = service.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaPuntoConexion, 200000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso6: falla ruidosamente si abonado_pre_2024 + abonado_desde_2024 != abonado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'S0331');

    assert.throws(
      () => ejecutarPaso6({
        dbService: ctx.dbService,
        cuentasJson: [{
          codigo: 'S0331',
          punto_conexion: puntoBase({ abonado: 300000, abonado_pre_2024: 600000, abonado_desde_2024: 0 })
        }]
      }),
      /abonado_pre_2024 \(600000\) \+ abonado_desde_2024 \(0\) != abonado \(300000\)/
    );

    const repo = new NuevoPuntoRepository(ctx.dbService);
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo='S0331'`).get().id;
    assert.equal(repo.findByCuentaId(cuentaId).length, 0, 'no debe quedar nada insertado');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso6: falla ruidosamente si precio - abonado != saldo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'S008');

    assert.throws(
      () => ejecutarPaso6({
        dbService: ctx.dbService,
        cuentasJson: [{
          codigo: 'S008',
          punto_conexion: puntoBase({ precio: 300000, abonado: 315000, saldo: 0, abonado_pre_2024: 315000 })
        }]
      }),
      /precio \(300000\) - abonado \(315000\) != saldo \(0\)/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso6: valida TODO antes de insertar nada -- una cuenta mala no deja huérfanas a las buenas anteriores', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    sembrarCuenta(db, 'S0100');
    sembrarCuenta(db, 'S0200');

    assert.throws(() => ejecutarPaso6({
      dbService: ctx.dbService,
      cuentasJson: [
        { codigo: 'S0100', punto_conexion: puntoBase() },
        { codigo: 'S0200', punto_conexion: puntoBase({ abonado: 999999 }) }
      ]
    }));

    const repo = new NuevoPuntoRepository(ctx.dbService);
    const cuenta100 = db.prepare(`SELECT id FROM cuentas WHERE codigo='S0100'`).get().id;
    assert.equal(repo.findByCuentaId(cuenta100).length, 0, 'S0100 no debe haber quedado a medio insertar');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso6: falla si una cuenta con punto todavía no existe en la base', () => {
  const ctx = crearDbTemporal();
  try {
    assert.throws(
      () => ejecutarPaso6({
        dbService: ctx.dbService,
        cuentasJson: [{ codigo: 'X404', punto_conexion: puntoBase() }]
      }),
      /no existe en la base/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
