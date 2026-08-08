// src/services/CarteraService.aplicarCredito.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');

function sembrarCartera(dbService) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Vereda Test')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;

  const service = new CarteraService(dbService);
  const cargos = [1, 2, 3].map(mes => service.repository.crearMovimiento({
    cuentaId, fecha: `2026-0${mes}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000,
    anio: 2026, mes
  }));
  return { cuentaId, service, cargos };
}

test('aplicarCreditoAMeses cubre exactamente los cargos elegidos y deja la traza en cuenta_creditos', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service, cargos } = sembrarCartera(ctx.dbService);

    const r = service.aplicarCreditoAMeses({
      cuentaId, monto: 20000, cargosElegidos: [cargos[0], cargos[1]], fecha: '2026-03-01'
    });

    assert.equal(r.aplicado, 20000);
    assert.equal(r.sobrante, 0);

    const estado = service.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaExigible, 10000, 'quedan 10.000 del tercer cargo, sin tocar');

    const creditos = service.repository.getCreditos(cuentaId);
    assert.equal(creditos.length, 1);
    assert.equal(creditos[0].tipo, 'Aplicado');
    assert.equal(creditos[0].monto, 20000);
    assert.equal(creditos[0].abono_movimiento_id, r.abonoId, 'debe apuntar al Abono real que dejó');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('aplicarCreditoAMeses solo imputa los cargos de la lista, aunque haya otros más viejos pendientes', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service, cargos } = sembrarCartera(ctx.dbService);

    // Elige el cargo de febrero (cargos[1]) sin tocar el de enero (cargos[0]), que es más
    // viejo -- esto es lo que un FIFO haría distinto y por lo que no se reutiliza AbonoDeudaFIFO.
    const r = service.aplicarCreditoAMeses({
      cuentaId, monto: 10000, cargosElegidos: [cargos[1]], fecha: '2026-03-01'
    });

    assert.equal(r.aplicado, 10000);
    const imputaciones = ctx.dbService.getDb()
      .prepare(`SELECT cargo_id FROM cartera_imputaciones WHERE abono_id = ?`).all(r.abonoId);
    assert.deepEqual(imputaciones.map(i => i.cargo_id), [cargos[1]]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('aplicarCreditoAMeses exige al menos un cargo elegido', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    assert.throws(
      () => service.aplicarCreditoAMeses({ cuentaId, monto: 10000, cargosElegidos: [], fecha: '2026-03-01' }),
      /Debe elegir al menos un mes/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('aplicarCreditoAMeses falla si los cargos elegidos ya no tienen nada pendiente', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service, cargos } = sembrarCartera(ctx.dbService);
    service.aplicarCreditoAMeses({ cuentaId, monto: 10000, cargosElegidos: [cargos[0]], fecha: '2026-01-01' });

    assert.throws(
      () => service.aplicarCreditoAMeses({ cuentaId, monto: 5000, cargosElegidos: [cargos[0]], fecha: '2026-02-01' }),
      /no tienen deuda pendiente/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
