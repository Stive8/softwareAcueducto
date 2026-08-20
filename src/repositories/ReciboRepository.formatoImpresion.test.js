// src/repositories/ReciboRepository.formatoImpresion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ReciboRepository = require('./ReciboRepository');

test('getConfiguracionAsociacion incluye logo_path', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`UPDATE configuracion SET valor = 'logo.png' WHERE clave = 'logo_path'`).run();

    const repo = new ReciboRepository(ctx.dbService);
    const config = repo.getConfiguracionAsociacion();

    assert.equal(config.logo_path, 'logo.png');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getFormatoImpresionPredeterminado devuelve "carta" por defecto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`DELETE FROM configuracion WHERE clave = 'formato_impresion_recibo'`).run();

    const repo = new ReciboRepository(ctx.dbService);
    assert.equal(repo.getFormatoImpresionPredeterminado(), 'carta');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getFormatoImpresionPredeterminado devuelve el valor configurado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`
      INSERT INTO configuracion (clave, valor) VALUES ('formato_impresion_recibo', 'termico_80mm')
      ON CONFLICT(clave) DO UPDATE SET valor = 'termico_80mm'
    `).run();

    const repo = new ReciboRepository(ctx.dbService);
    assert.equal(repo.getFormatoImpresionPredeterminado(), 'termico_80mm');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
