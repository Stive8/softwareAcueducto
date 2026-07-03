const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const MotorContabilizacionService = require('./MotorContabilizacionService');
const ImpuestoRepository = require('../repositories/ImpuestoRepository');
const PlantillaContabilizacionRepository = require('../repositories/PlantillaContabilizacionRepository');

test('generarLineas() aplica la tasa de impuesto vigente en la fecha del documento, no la actual', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const impuestoRepository = new ImpuestoRepository(ctx.dbService);
    const plantillaRepository = new PlantillaContabilizacionRepository(ctx.dbService);
    const motor = new MotorContabilizacionService(ctx.dbService);

    const cuentaImpuesto = db.prepare(`SELECT id FROM plan_cuentas WHERE tipo = 'Pasivo' AND NOT EXISTS (SELECT 1 FROM plan_cuentas h WHERE h.padre_id = plan_cuentas.id) LIMIT 1`).get();
    const impuestoId = impuestoRepository.create({ codigo: 'RETE_MOTOR', nombre: 'Retención motor', tipo: 'ReteFuente', porcentaje: 2, cuentaId: cuentaImpuesto.id, ladoAjuste: 'Credito', baseCampo: 'valor' });

    const plantillaGastoEfectivo = plantillaRepository.findVigente('Gasto', 'Efectivo', new Date().toLocaleDateString('en-CA'));
    impuestoRepository.asignarAPlantilla(plantillaGastoEfectivo.id, impuestoId, 100);

    // Sube la tasa al 5% HOY.
    impuestoRepository.update(impuestoId, { nombre: 'Retención motor', tipo: 'ReteFuente', porcentaje: 5, cuentaId: cuentaImpuesto.id, ladoAjuste: 'Credito', baseCampo: 'valor' });

    const cuentaGasto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();

    // Documento con fecha de AYER (antes del cambio de tasa): debe usar el 2%, no el 5% actual.
    const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
    const lineasAyer = motor.generarLineas(plantillaGastoEfectivo, {
      fecha: ayer, valor: 100000, cuenta_contable_id: cuentaGasto.id, caja_efectivo_id: cuentaGasto.id
    });
    const lineaImpuestoAyer = lineasAyer.find(l => l.cuentaContableId === cuentaImpuesto.id);
    assert.equal(lineaImpuestoAyer.credito, 2000, 'Con fecha de ayer debía aplicarse el 2% (200.000 * 0.02 = 2.000... con base 100.000 = 2.000)');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
