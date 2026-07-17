const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CuentaRepository = require('../repositories/CuentaRepository');
const ReporteService = require('./ReporteService');

test('reporteCuentas() incluye las coordenadas de acometida y vivienda, en columnas y filas', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaRepo = new CuentaRepository(ctx.dbService);
    const categoriaId = ctx.dbService.getDb().prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;

    cuentaRepo.create({
      codigo: 'C-200',
      direccion: 'Vereda El Roble',
      categoria_id: categoriaId,
      lat_acometida: 4.1, lon_acometida: -74.1,
      lat_vivienda: 4.2, lon_vivienda: -74.2
    });

    const service = new ReporteService(ctx.dbService);
    const reporte = service.reporteCuentas({});

    const keysColumnas = reporte.columnas.map(c => c.key);
    assert.ok(keysColumnas.includes('lat_acometida'));
    assert.ok(keysColumnas.includes('lon_acometida'));
    assert.ok(keysColumnas.includes('lat_vivienda'));
    assert.ok(keysColumnas.includes('lon_vivienda'));

    const fila = reporte.filas.find(f => f.codigo === 'C-200');
    assert.equal(fila.lat_acometida, 4.1);
    assert.equal(fila.lon_acometida, -74.1);
    assert.equal(fila.lat_vivienda, 4.2);
    assert.equal(fila.lon_vivienda, -74.2);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
