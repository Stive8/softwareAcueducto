const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const PlantillaContabilizacionService = require('./PlantillaContabilizacionService');
const ImpuestoRepository = require('../repositories/ImpuestoRepository');

test('actualizarLineas() conserva los impuestos ya asignados en la nueva versión de la plantilla', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new PlantillaContabilizacionService(ctx.dbService);
    const impuestoRepository = new ImpuestoRepository(ctx.dbService);

    const cuentaImpuesto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '2408'`).get()
      || db.prepare(`SELECT id FROM plan_cuentas WHERE nivel = (SELECT MAX(nivel) FROM plan_cuentas WHERE tipo = 'Pasivo')`).get();
    const impuestoId = impuestoRepository.create({
      codigo: 'IVA_PRUEBA', nombre: 'IVA de prueba', tipo: 'IVA', porcentaje: 19,
      cuentaId: cuentaImpuesto.id, ladoAjuste: 'Debito', baseCampo: 'valor'
    });

    const plantillaOriginal = db.prepare(`SELECT id FROM plantillas_contabilizacion WHERE codigo = 'GASTO_EFECTIVO' ORDER BY version DESC LIMIT 1`).get();
    impuestoRepository.asignarAPlantilla(plantillaOriginal.id, impuestoId, 100);

    assert.equal(impuestoRepository.findByPlantillaId(plantillaOriginal.id).length, 1, 'Precondición: el impuesto debe estar asignado a la versión original');

    const actual = service.getById(plantillaOriginal.id);
    const nuevaVersion = service.actualizarLineas(plantillaOriginal.id, actual.lineas.map(l => ({ ...l, descripcion_linea: 'editada' })));

    const impuestosEnNuevaVersion = impuestoRepository.findByPlantillaId(nuevaVersion.id);
    assert.equal(impuestosEnNuevaVersion.length, 1, 'El impuesto debía copiarse a la nueva versión');
    assert.equal(impuestosEnNuevaVersion[0].id, impuestoId);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
