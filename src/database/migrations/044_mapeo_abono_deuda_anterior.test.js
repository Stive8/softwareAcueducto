// src/database/migrations/044_mapeo_abono_deuda_anterior.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');
const MapeoContableRepository = require('../../repositories/MapeoContableRepository');

test('044: AbonoDeudaAnterior se mapea a 413505 (Sostenimiento Mensual), no al __default__ de RecibosDetalle', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new MapeoContableRepository(ctx.dbService);
    const cuentaId = repo.resolverCuentaContableId('RecibosDetalle', 'AbonoDeudaAnterior');

    const db = ctx.dbService.getDb();
    const cuenta = db.prepare('SELECT codigo, nombre FROM plan_cuentas WHERE id = ?').get(cuentaId);
    const cuentaSostenimiento = db.prepare('SELECT id FROM plan_cuentas WHERE codigo = ?').get('413505');

    assert.equal(cuenta.codigo, '413505');
    assert.equal(cuentaId, cuentaSostenimiento.id);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('044: AbonoDeudaAnterior aparece como fila propia en el Mapeo Contable (no solo resuelto vía __default__)', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new MapeoContableRepository(ctx.dbService);
    const filas = repo.findAll('RecibosDetalle');
    const fila = filas.find(f => f.concepto === 'AbonoDeudaAnterior');

    assert.ok(fila, 'Debe existir una fila explícita para AbonoDeudaAnterior, visible en la pantalla de Mapeo Contable');
    assert.equal(fila.cuenta_codigo, '413505');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('044: es idempotente si la fila de mapeo ya existe (p. ej. parchada a mano en producción antes del fix) -- no debe reventar con UNIQUE constraint failed', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();

    // crearDbTemporal() ya corrió la migración 044 una vez (la fila ya existe). Ejecutar el MISMO
    // contenido del archivo de migración otra vez simula el escenario real: una fila conflictiva
    // ya presente cuando la migración intenta insertar -- sin INSERT OR IGNORE, esto reventaría
    // con UNIQUE constraint failed (mapeo_conceptos_contables tiene UNIQUE(modulo, concepto)) y,
    // como runMigrations hace rollback sin marcar la migración aplicada, bricaría el arranque de
    // la app en TODOS los intentos siguientes (mismo patrón que la migración 017).
    const sqlPath = path.join(__dirname, '044_mapeo_abono_deuda_anterior.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    assert.doesNotThrow(() => db.exec(sql), 'El INSERT OR IGNORE debe ser seguro de re-ejecutar aunque la fila ya exista');

    const filas = db.prepare(
      `SELECT cuenta_contable_id FROM mapeo_conceptos_contables WHERE modulo = ? AND concepto = ?`
    ).all('RecibosDetalle', 'AbonoDeudaAnterior');
    assert.equal(filas.length, 1, 'No debe haber quedado una fila duplicada');

    const cuentaSostenimiento = db.prepare('SELECT id FROM plan_cuentas WHERE codigo = ?').get('413505');
    assert.equal(filas[0].cuenta_contable_id, cuentaSostenimiento.id);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
