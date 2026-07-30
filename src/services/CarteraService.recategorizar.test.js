// src/services/CarteraService.recategorizar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');
const { MODOS } = require('./cartera/imputacion');

// Cuenta "Finca" a $10.000 desde 2025-01, con recibo desde 2025-01, y una categoría
// "Finca con piscina" a $16.000 disponible para recategorizar.
function sembrar(dbService) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES ('T001', 'Vereda Test', 'Activo')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;

  // La migración 001 ya siembra 'Finca' y 'Finca con piscina' como categorías por defecto
  // (sin tarifa: "las tarifas NO se siembran con valores ficticios"), y categorias.nombre es
  // UNIQUE. Reusar la categoría si ya existe en vez de asumir que hay que crearla.
  const crearCategoria = (nombre, tarifa) => {
    let fila = db.prepare(`SELECT id FROM categorias WHERE nombre = ?`).get(nombre);
    if (!fila) {
      db.prepare(`INSERT INTO categorias (nombre) VALUES (?)`).run(nombre);
      fila = db.prepare(`SELECT id FROM categorias WHERE nombre = ?`).get(nombre);
    }
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
                VALUES (?, ?, '2020-01-01')`).run(fila.id, tarifa);
    return fila.id;
  };
  const finca = crearCategoria('Finca', 10000);
  const piscina = crearCategoria('Finca con piscina', 16000);

  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
              VALUES (?, ?, '2025-01-01')`).run(cuentaId, finca);

  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Prop T001')`).run();
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Prop T001'`).get().id;
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio)
              VALUES (?, ?, '2025-01-01')`).run(cuentaId, propietarioId);
  db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
              VALUES (5001, ?, ?, '2025-01-10', 0, 'Efectivo')`).run(cuentaId, propietarioId);

  new CuentaEstadoRepository(dbService)
    .sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2025-01-01' });

  return { cuentaId, finca, piscina, service: new CarteraService(dbService) };
}

test('recategorizar hacia arriba emite AjusteCategoria por la diferencia y no muta los cargos', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, piscina, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2026, 1);   // ene-2025 a ene-2026 a $10.000 = $130.000
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 130000);

    // Se descubre que tenía piscina desde noviembre de 2025.
    const r = service.recategorizar({
      cuentaId, categoriaId: piscina, fechaVigencia: '2025-11-01', documento: 'Acta 7'
    });

    assert.equal(r.ajustes.length, 3, 'nov-2025, dic-2025, ene-2026');
    assert.equal(r.totalAjustado, 18000, '3 meses x $6.000');
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 148000);

    // El CargoMensual original sigue intacto: la corrección es una fila aparte.
    assert.equal(service.repository.getCargoMensual(cuentaId, 2025, 11).monto, 10000);
    const ajuste = ctx.dbService.getDb().prepare(`
      SELECT monto, documento FROM cartera_movimientos
      WHERE cuenta_id = ? AND tipo = 'AjusteCategoria' AND anio = 2025 AND mes = 11
    `).get(cuentaId);
    assert.equal(ajuste.monto, 6000);
    assert.equal(ajuste.documento, 'Acta 7');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar hacia arriba deja el ajuste como cargo pendiente que el FIFO puede cubrir', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, piscina, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2025, 2);   // ene y feb 2025 = $20.000
    service.registrarAbono({ cuentaId, fecha: '2025-03-01', monto: 20000, modo: MODOS.ABONO_DEUDA_FIFO });
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 0);

    service.recategorizar({ cuentaId, categoriaId: piscina, fechaVigencia: '2025-01-01' });

    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, 12000, '2 meses x $6.000 de diferencia');
    const pend = service.repository.getCargosPendientes(cuentaId, 1);
    assert.equal(pend.length, 2, 'los dos ajustes quedan cobrables');
    assert.ok(pend.every(c => c.pendiente === 6000));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar hacia abajo sobre meses ya pagados produce saldo a favor', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, finca, piscina, service } = sembrar(ctx.dbService);
    // Arranca como piscina ($16.000) y ya pagó todo.
    db.prepare(`UPDATE cuenta_categorias SET categoria_id = ? WHERE cuenta_id = ?`).run(piscina, cuentaId);
    service.asegurarCausacion(cuentaId, 2025, 2);   // 2 meses x $16.000 = $32.000
    service.registrarAbono({ cuentaId, fecha: '2025-03-01', monto: 32000, modo: MODOS.ABONO_DEUDA_FIFO });
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 0);

    // Se corrige: nunca tuvo piscina.
    const r = service.recategorizar({ cuentaId, categoriaId: finca, fechaVigencia: '2025-01-01' });

    assert.equal(r.totalAjustado, -12000, '2 meses x -$6.000');
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, -12000);
    assert.equal(e.saldoAFavor, 12000);
    assert.equal(e.totalCobrarHoy, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar no deshace ni modifica ninguna imputación existente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, finca, piscina, service } = sembrar(ctx.dbService);
    db.prepare(`UPDATE cuenta_categorias SET categoria_id = ? WHERE cuenta_id = ?`).run(piscina, cuentaId);
    service.asegurarCausacion(cuentaId, 2025, 2);
    service.registrarAbono({ cuentaId, fecha: '2025-03-01', monto: 32000, modo: MODOS.ABONO_DEUDA_FIFO });

    const antes = db.prepare(`SELECT abono_id, cargo_id, monto FROM cartera_imputaciones ORDER BY id`).all();
    service.recategorizar({ cuentaId, categoriaId: finca, fechaVigencia: '2025-01-01' });
    const despues = db.prepare(`SELECT abono_id, cargo_id, monto FROM cartera_imputaciones ORDER BY id`).all();

    assert.deepEqual(despues, antes);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar omite los meses donde la diferencia es cero', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2025, 3);
    // Otra categoría con la MISMA tarifa: recategorizar no debe generar ajustes.
    db.prepare(`INSERT INTO categorias (nombre) VALUES ('Finca bis')`).run();
    const bis = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca bis'`).get().id;
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
                VALUES (?, 10000, '2020-01-01')`).run(bis);

    const r = service.recategorizar({ cuentaId, categoriaId: bis, fechaVigencia: '2025-01-01' });

    assert.equal(r.ajustes.length, 0);
    assert.equal(r.totalAjustado, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM cartera_movimientos WHERE tipo = 'AjusteCategoria'`).get().n, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar cierra la vigencia anterior de cuenta_categorias y abre la nueva', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, finca, piscina, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2025, 12);

    service.recategorizar({ cuentaId, categoriaId: piscina, fechaVigencia: '2025-11-01' });

    const vig = db.prepare(`SELECT categoria_id, fecha_inicio, fecha_fin FROM cuenta_categorias
                            WHERE cuenta_id = ? ORDER BY fecha_inicio`).all(cuentaId);
    assert.equal(vig.length, 2);
    assert.equal(vig[0].categoria_id, finca);
    assert.equal(vig[0].fecha_fin, '2025-10-31');
    assert.equal(vig[1].categoria_id, piscina);
    assert.equal(vig[1].fecha_inicio, '2025-11-01');
    assert.equal(vig[1].fecha_fin, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar dos veces con la misma vigencia no acumula ajustes duplicados', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, piscina, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2025, 3);

    service.recategorizar({ cuentaId, categoriaId: piscina, fechaVigencia: '2025-01-01' });
    const despuesPrimera = service.getEstadoCartera(cuentaId).deudaExigible;
    const segunda = service.recategorizar({ cuentaId, categoriaId: piscina, fechaVigencia: '2025-01-01' });

    assert.equal(segunda.ajustes.length, 0, 'ya está en esa categoría: nada que ajustar');
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, despuesPrimera);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar valida los parámetros', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, piscina, service } = sembrar(ctx.dbService);
    assert.throws(() => service.recategorizar({ cuentaId, categoriaId: piscina, fechaVigencia: null }),
      /fecha de vigencia es obligatoria/);
    assert.throws(() => service.recategorizar({ cuentaId, categoriaId: 99999, fechaVigencia: '2025-01-01' }),
      /Categoría no encontrada/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
