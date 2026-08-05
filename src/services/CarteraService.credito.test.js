// src/services/CarteraService.credito.test.js
//
// El cambio de diseño (2026-08-04): el saldo a favor deja de restar solo. Un abono sin
// destino (ANTICIPO) o el sobrante de uno que sí lo tiene va a cuenta_creditos como 'Abono'
// y no toca deuda_exigible hasta que alguien lo redime explícitamente (redimirCredito).
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');
const { MODOS } = require('./cartera/imputacion');

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

test('redimirCredito convierte crédito disponible en un Abono real vía FIFO por defecto', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    service.registrarAbono({ cuentaId, fecha: '2026-01-15', monto: 15000, modo: MODOS.ANTICIPO });
    assert.equal(service.repository.getSaldoCreditoDisponible(cuentaId), 15000);

    const r = service.redimirCredito({ cuentaId, fecha: '2026-04-01', monto: 15000 });

    assert.equal(r.aplicado, 15000);
    assert.equal(r.saldoRestante, 0);
    assert.equal(service.repository.getSaldoCreditoDisponible(cuentaId), 0);

    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, 15000, '30.000 de cargos menos 15.000 ya redimidos');
    assert.deepEqual(e.cubiertoHasta, { anio: 2026, mes: 1 });
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('redimirCredito deja traza: la fila Aplicado apunta al Abono real vía abono_movimiento_id', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    service.registrarAbono({ cuentaId, fecha: '2026-01-15', monto: 10000, modo: MODOS.ANTICIPO });
    const r = service.redimirCredito({ cuentaId, fecha: '2026-04-01', monto: 10000 });

    const [, aplicado] = service.repository.getCreditos(cuentaId);
    assert.equal(aplicado.tipo, 'Aplicado');
    assert.equal(aplicado.abono_movimiento_id, r.abonoId);

    const cubiertos = ctx.dbService.getDb()
      .prepare(`SELECT cargo_id FROM cartera_imputaciones WHERE abono_id = ?`).all(r.abonoId);
    assert.equal(cubiertos.length, 1, 'se ve, vía el Abono, qué cargo cubrió');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('redimirCredito no puede pedir más de lo disponible', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    service.registrarAbono({ cuentaId, fecha: '2026-01-15', monto: 5000, modo: MODOS.ANTICIPO });
    assert.throws(
      () => service.redimirCredito({ cuentaId, fecha: '2026-04-01', monto: 10000 }),
      /No hay \$10000 de crédito disponible/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('redimirCredito contra meses específicos', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service, cargos } = sembrarCartera(ctx.dbService);
    service.registrarAbono({ cuentaId, fecha: '2026-01-15', monto: 10000, modo: MODOS.ANTICIPO });

    service.redimirCredito({
      cuentaId, fecha: '2026-04-01', monto: 10000,
      modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargos[2]]   // marzo, no enero
    });

    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.cubiertoHasta, null, 'enero y febrero siguen descubiertos: eligió marzo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('redimirCredito rechaza modos que no aplican a deuda exigible (opaco, anticipo)', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    service.registrarAbono({ cuentaId, fecha: '2026-01-15', monto: 5000, modo: MODOS.ANTICIPO });
    assert.throws(
      () => service.redimirCredito({ cuentaId, fecha: '2026-04-01', monto: 5000, modo: MODOS.ABONO_SALDO_OPACO }),
      /solo se redime contra deuda exigible/
    );
    assert.throws(
      () => service.redimirCredito({ cuentaId, fecha: '2026-04-01', monto: 5000, modo: MODOS.ANTICIPO }),
      /solo se redime contra deuda exigible/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('redimirCredito sin deuda exigible pendiente no crea un Abono vacío', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    service.registrarAbono({ cuentaId, fecha: '2026-01-01', monto: 30000, modo: MODOS.ABONO_DEUDA_FIFO });
    service.registrarAbono({ cuentaId, fecha: '2026-02-01', monto: 5000, modo: MODOS.ANTICIPO });

    assert.throws(
      () => service.redimirCredito({ cuentaId, fecha: '2026-04-01', monto: 5000 }),
      /No hay deuda exigible pendiente/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

// Caso de referencia S010 (Dalila): CARTERA nunca registró el recibo 1825 ($90.000) y por eso
// restaba esa plata de la deuda directamente. Con el cambio, la cifra principal ignora el
// crédito hasta que alguien lo redima: debe mostrar los 7 meses completos y el crédito aparte.
test('caso de referencia S010: 90.000 a favor no bajan la cifra principal hasta que se redimen', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES ('S010', 'Vereda Test', 'Activo')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'S010'`).get().id;

    db.prepare(`INSERT INTO categorias (nombre) VALUES ('Finca-S010')`).run();
    const catId = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca-S010'`).get().id;
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
                VALUES (?, 20000, '2024-01-01')`).run(catId);
    db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
                VALUES (?, ?, '2024-01-01')`).run(cuentaId, catId);

    new CuentaEstadoRepository(ctx.dbService)
      .sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2024-01-01' });

    const service = new CarteraService(ctx.dbService);
    // Diciembre 2025 queda cubierto (24 meses de 2024-2025 a $20.000 c/u = $480.000).
    for (let mes = 1; mes <= 12; mes++) {
      service.repository.crearMovimiento({ cuentaId, fecha: `2024-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 20000, anio: 2024, mes });
      service.repository.crearMovimiento({ cuentaId, fecha: `2025-${String(mes).padStart(2, '0')}-01`, tipo: 'CargoMensual', exigible: 1, monto: 20000, anio: 2025, mes });
    }
    service.registrarAbono({ cuentaId, fecha: '2025-12-15', monto: 480000, modo: MODOS.ABONO_DEUDA_FIFO });
    // El recibo 1825: $90.000 que CARTERA nunca anotó. En el modelo nuevo entra como crédito.
    service.registrarAbono({ cuentaId, fecha: '2024-05-04', monto: 90000, modo: MODOS.ANTICIPO });

    const e = service.getEstadoCartera(cuentaId);
    assert.deepEqual(e.ultimoMesCubierto, { anio: 2025, mes: 12 });
    assert.equal(e.saldoCreditoDisponible, 90000);
    assert.equal(e.saldoAFavor, 90000);
    // La cifra principal depende del mes de "hoy" en el entorno de test, así que se valida
    // por construcción en vez de un número fijo: son exactamente los meses después de dic-2025
    // hasta hoy, a $20.000 cada uno -- nunca descontando los 90.000 de crédito.
    const hoy = new Date();
    const mesesEsperados = (hoy.getFullYear() - 2025) * 12 + (hoy.getMonth() + 1 - 12);
    assert.equal(e.mesesAPagar.length, mesesEsperados);
    assert.equal(e.aPagar, mesesEsperados * 20000);
    assert.ok(e.mesesAPagar.every(m => m.valor === 20000));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('calcularAPagar no incluye meses en que la cuenta no estaba Activa', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES ('T002', 'Vereda Test', 'Activo')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T002'`).get().id;
    db.prepare(`INSERT INTO categorias (nombre) VALUES ('Finca-T002')`).run();
    const catId = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca-T002'`).get().id;
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
                VALUES (?, 10000, '2024-01-01')`).run(catId);
    db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
                VALUES (?, ?, '2024-01-01')`).run(cuentaId, catId);

    const estadoRepo = new CuentaEstadoRepository(ctx.dbService);
    estadoRepo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2024-01-01' });
    estadoRepo.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2024-02-01', motivo: 'test' });
    estadoRepo.cambiarEstado({ cuentaId, estado: 'Activo', fechaInicio: '2024-03-01', motivo: 'test' });
    estadoRepo.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2024-04-01', motivo: 'test' });

    const service = new CarteraService(ctx.dbService);
    const { meses } = service.calcularAPagar(cuentaId, { anio: 2024, mes: 1 });
    assert.deepEqual(meses.map(m => `${m.anio}-${m.mes}`), ['2024-3'], 'solo marzo estuvo Activo entre feb-2024 y ahora');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
