// Reproduce el hallazgo Crítico C-3: la fórmula propia de getDashboardContable() ignora el
// saldo inicial configurado y pierde el dinero movido en traslados internos (Caja<->Banco).
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ReporteRepository = require('./ReporteRepository');
const CajaRepository = require('./CajaRepository');

test('getDashboardContable().saldoCaja coincide con CajaRepository.getSaldoCaja() (incluye saldo inicial y traslados)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`UPDATE configuracion SET valor = '100000' WHERE clave = 'saldo_caja_inicial'`).run();

    // Un traslado Banco -> Caja: debe SUMAR a Caja y RESTAR de Banco.
    db.prepare(`
      INSERT INTO movimientos (tipo, origen, destino, monto, concepto, fecha_movimiento)
      VALUES ('Traslado', 'Banco', 'Caja', 25000, 'Retiro de banco a caja (prueba)', '2026-07-03')
    `).run();

    const reporteRepository = new ReporteRepository(ctx.dbService);
    const cajaRepository = new CajaRepository(ctx.dbService);

    const dashboard = reporteRepository.getDashboardContable();

    assert.equal(dashboard.saldoCaja, cajaRepository.getSaldoCaja());
    assert.equal(dashboard.saldoCaja, 125000, 'saldo inicial 100.000 + 25.000 entrantes por traslado');
    assert.equal(dashboard.saldoBanco, cajaRepository.getSaldoBanco());
    assert.equal(dashboard.saldoBanco, -25000, '0 inicial - 25.000 salientes por traslado');
    assert.equal(dashboard.saldoDisponible, dashboard.saldoCaja + dashboard.saldoBanco);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
