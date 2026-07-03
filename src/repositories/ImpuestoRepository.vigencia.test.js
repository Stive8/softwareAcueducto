const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ImpuestoRepository = require('./ImpuestoRepository');

function crearImpuestoDePrueba(dbService, repo) {
  const db = dbService.getDb();
  const cuenta = db.prepare(`SELECT id FROM plan_cuentas WHERE tipo = 'Pasivo' AND NOT EXISTS (SELECT 1 FROM plan_cuentas h WHERE h.padre_id = plan_cuentas.id) LIMIT 1`).get();
  return repo.create({ codigo: 'RETE_PRUEBA', nombre: 'Retención de prueba', tipo: 'ReteFuente', porcentaje: 2.5, cuentaId: cuenta.id, ladoAjuste: 'Credito', baseCampo: 'valor' });
}

test('update() cambia el porcentaje vigente hacia adelante sin alterar la tasa histórica', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new ImpuestoRepository(ctx.dbService);
    const id = crearImpuestoDePrueba(ctx.dbService, repo);

    const hoy = new Date().toLocaleDateString('en-CA');
    assert.equal(repo.getPorcentajeVigente(id, hoy), 2.5, 'Antes de editar, la tasa vigente hoy debe ser la original');

    repo.update(id, { nombre: 'Retención de prueba', tipo: 'ReteFuente', porcentaje: 3.5, cuentaId: repo.findById(id).cuenta_id, ladoAjuste: 'Credito', baseCampo: 'valor' });

    assert.equal(repo.getPorcentajeVigente(id, hoy), 3.5, 'Hoy debe regir la tasa nueva');
    assert.equal(repo.getPorcentajeVigente(id, '2020-01-01'), 2.5, 'Una fecha pasada debe seguir usando la tasa que regía entonces');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('update() aplicado dos veces el mismo día no produce rango invertido en historial', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new ImpuestoRepository(ctx.dbService);
    const id = crearImpuestoDePrueba(ctx.dbService, repo);
    const db = ctx.dbService.getDb();

    const hoy = new Date().toLocaleDateString('en-CA');

    // Primera edición: cambio de 2.5% a 3.5%
    repo.update(id, { nombre: 'Retención de prueba', tipo: 'ReteFuente', porcentaje: 3.5, cuentaId: repo.findById(id).cuenta_id, ladoAjuste: 'Credito', baseCampo: 'valor' });

    // Segunda edición el mismo día: cambio de 3.5% a 4.5%
    // Este es el caso que causaba el bug: fecha_desde = hoy (fijado por la primera edición),
    // pero fecha_hasta = ayer (antes de fecha_desde).
    repo.update(id, { nombre: 'Retención de prueba', tipo: 'ReteFuente', porcentaje: 4.5, cuentaId: repo.findById(id).cuenta_id, ladoAjuste: 'Credito', baseCampo: 'valor' });

    // Verificar que todas las filas de historial tienen fecha_desde <= fecha_hasta
    const filas = db.prepare(`
      SELECT id, porcentaje, fecha_desde, fecha_hasta
      FROM impuesto_historial_porcentaje
      WHERE impuesto_id = ?
      ORDER BY fecha_desde ASC
    `).all(id);

    assert.ok(filas.length >= 2, 'Debe haber al menos 2 filas de historial (dos cambios)');

    for (const fila of filas) {
      assert.ok(fila.fecha_desde <= fila.fecha_hasta, `Fila id=${fila.id}: fecha_desde (${fila.fecha_desde}) debe ser <= fecha_hasta (${fila.fecha_hasta})`);
    }

    // Verificar la segunda fila (la que causaba el bug): debe tener fecha_desde = hoy y fecha_hasta >= fecha_desde
    const segundaFila = filas[1];
    assert.equal(segundaFila.fecha_desde, hoy, 'La segunda fila debe tener fecha_desde = hoy');
    assert.ok(segundaFila.fecha_hasta >= segundaFila.fecha_desde, 'La segunda fila debe tener fecha_hasta >= fecha_desde');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
