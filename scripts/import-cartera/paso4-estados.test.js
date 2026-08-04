const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const CuentaEstadoRepository = require('../../src/repositories/CuentaEstadoRepository');
const { ejecutarPaso4, TODAS_LAS_SUSPENDIDAS, FECHA_SUSPENSION } = require('./paso4-estados');

function sembrarCuenta(db, codigo, { conVigenciaPrevia = false } = {}) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
  if (conVigenciaPrevia) {
    db.prepare(`INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio) VALUES (?, 'Activo', '2026-06-27')`).run(cuentaId);
  }
  return cuentaId;
}

test('paso4: suspende las 11 desde 2026-08-01, con y sin vigencia previa', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    for (const cod of TODAS_LAS_SUSPENDIDAS) {
      sembrarCuenta(db, cod, { conVigenciaPrevia: ['S004', 'S0141', 'S0395', 'S0441'].includes(cod) });
    }

    const r = ejecutarPaso4({ dbService: ctx.dbService });
    assert.equal(r.suspendidas.length, 11);
    assert.equal(r.fechaSuspension, '2026-08-01');

    for (const cod of TODAS_LAS_SUSPENDIDAS) {
      const cuenta = db.prepare('SELECT id, estado FROM cuentas WHERE codigo = ?').get(cod);
      assert.equal(cuenta.estado, 'Suspendido', `${cod} debe quedar Suspendido`);
      const vigenciaAbierta = db.prepare('SELECT estado, fecha_inicio FROM cuenta_estados WHERE cuenta_id = ? AND fecha_fin IS NULL').get(cuenta.id);
      assert.equal(vigenciaAbierta.estado, 'Suspendido');
      assert.equal(vigenciaAbierta.fecha_inicio, FECHA_SUSPENSION);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso4: no es retroactivo -- enero 2024 a junio 2026 quedan Activo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    for (const cod of TODAS_LAS_SUSPENDIDAS) {
      sembrarCuenta(db, cod, { conVigenciaPrevia: ['S004', 'S0141', 'S0395', 'S0441'].includes(cod) });
    }
    const cuentaId = db.prepare('SELECT id FROM cuentas WHERE codigo = ?').get('R002').id;
    ejecutarPaso4({ dbService: ctx.dbService });

    const estadoRepo = new CuentaEstadoRepository(ctx.dbService);
    assert.equal(estadoRepo.estadoEnMes(cuentaId, 2024, 1), 'Activo');
    assert.equal(estadoRepo.estadoEnMes(cuentaId, 2026, 6), 'Activo');
    // fecha_inicio = 2026-08-01 (primer día del mes): julio queda Activo sin ambigüedad, la
    // suspensión arranca justo en agosto. Con 2026-07-31 (el último día de julio) todo julio se
    // habría leído Suspendido pese a que la cuenta estuvo activa los 31 días -- por eso se cambió.
    assert.equal(estadoRepo.estadoEnMes(cuentaId, 2026, 7), 'Activo');
    assert.equal(estadoRepo.estadoEnMes(cuentaId, 2026, 8), 'Suspendido');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('paso4: falla si alguna de las 11 no existe todavía (no corrió el paso 2)', () => {
  const ctx = crearDbTemporal();
  try {
    assert.throws(() => ejecutarPaso4({ dbService: ctx.dbService }), /no existe en la base/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
