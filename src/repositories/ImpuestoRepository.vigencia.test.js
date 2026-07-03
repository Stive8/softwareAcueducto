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
