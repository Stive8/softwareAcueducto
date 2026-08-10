// src/services/PagoService.getCuentasConEstado.test.js
//
// getCuentasConEstado alimenta la tabla "Estado de Cuentas" del módulo de Pagos -- lo que el
// operador ve todos los días, con sus filtros "Solo al día"/"Solo en mora". Hasta esta corrección
// leía meses_mora directo de pago_periodos con un rango (periodo_actual - ultimo_periodo_num) que
// no paraba en el primer hueco, así que podía mostrar un número distinto al del detalle de la
// misma cuenta (caso real R007: "21 meses" en esta lista, "2 meses" en su propio detalle). Estos
// tests fijan que ahora usa el mismo CarteraService.getIndicadoresMoraTodas que
// ReporteService.procesarEstadoCuentas, con el mismo criterio de "en mora".
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const PagoService = require('./PagoService');
const CarteraService = require('./CarteraService');
const { MODOS } = require('./cartera/imputacion');

function sembrarCuenta(db, codigo) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

// El mes actual (sin CargoMensual causado todavía) solo entra en mesesAPagar si hay tarifa
// vigente para la categoría de la cuenta -- si no, calcularAPagar lo salta a mesesSinTarifa en
// vez de contarlo como impago (ver console.warn), y el conteo real quedaría subestimado.
function asignarTarifaFinca(db, cuentaId, fechaInicio = '2020-01-01') {
  let catFila = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get();
  if (!catFila) {
    db.prepare(`INSERT INTO categorias (nombre) VALUES ('Finca')`).run();
    catFila = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get();
  }
  if (!db.prepare(`SELECT id FROM categoria_tarifas WHERE categoria_id = ?`).get(catFila.id)) {
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde) VALUES (?, 10000, '2020-01-01')`).run(catFila.id);
  }
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, ?)`).run(cuentaId, catFila.id, fechaInicio);
}

test('getCuentasConEstado: meses_mora sale de cartera (mesesImpagos), no del rango completo desde pago_periodos (reproduce el caso real de R007)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T900');
    asignarTarifaFinca(db, cuentaId);
    const carteraService = new CarteraService(ctx.dbService);
    const pagoService = new PagoService(ctx.dbService);

    const cEne = carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1
    });
    carteraService.registrarAbono({ cuentaId, fecha: '2024-01-05', monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cEne] });

    const cFeb = carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2024-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 2
    });
    carteraService.registrarAbono({ cuentaId, fecha: '2024-02-10', monto: 2000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cFeb] });

    const hoy = new Date();
    const mesActualCod = hoy.getFullYear() * 12 + hoy.getMonth();
    for (let cod = 2024 * 12 + 2; cod < mesActualCod; cod++) {
      const anio = Math.floor(cod / 12);
      const mes = (cod % 12) + 1;
      const mm = String(mes).padStart(2, '0');
      const c = carteraService.repository.crearMovimiento({
        cuentaId, fecha: `${anio}-${mm}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio, mes
      });
      carteraService.registrarAbono({ cuentaId, fecha: `${anio}-${mm}-05`, monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [c] });
    }

    // precondición: pago_periodos vacío -- si el resultado sigue siendo correcto, no puede venir de ahí.
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM pago_periodos`).get().n, 0);

    const r = pagoService.getCuentasConEstado({ page: 1, limit: 50 });
    const fila = r.data.find(f => f.codigo === 'T900');

    assert.equal(fila.meses_mora, 2, 'solo febrero-2024 (el hueco) + el mes actual sin causar');
    assert.equal(fila.en_mora, true);
    assert.deepEqual(fila.motivo_mora, ['meses_corrientes']);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCuentasConEstado: deuda anterior al corte cuenta como en_mora aunque 2024+ esté al día', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T901');
    const carteraService = new CarteraService(ctx.dbService);
    const pagoService = new PagoService(ctx.dbService);

    carteraService.repository.crearMovimiento({ cuentaId, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 60000 });
    const hoy = new Date();
    const cargo = carteraService.repository.crearMovimiento({
      cuentaId, fecha: hoy.toISOString().split('T')[0], tipo: 'CargoMensual', exigible: 1, monto: 10000,
      anio: hoy.getFullYear(), mes: hoy.getMonth() + 1
    });
    carteraService.registrarAbono({ cuentaId, fecha: hoy.toISOString().split('T')[0], monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargo] });

    const r = pagoService.getCuentasConEstado({ page: 1, limit: 50 });
    const fila = r.data.find(f => f.codigo === 'T901');

    assert.equal(fila.meses_mora, 0);
    assert.equal(fila.deuda_antes_2024, 60000);
    assert.equal(fila.en_mora, true, 'la apertura opaca pendiente ya cuenta como mora');
    assert.deepEqual(fila.motivo_mora, ['deuda_anterior_2024']);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCuentasConEstado: filtro en_mora/al_dia usa el criterio nuevo (meses_impagos O deuda_antes_2024), no meses_mora === 0 del rango viejo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const carteraService = new CarteraService(ctx.dbService);
    const pagoService = new PagoService(ctx.dbService);

    const idAlDia = sembrarCuenta(db, 'T902');
    const hoy = new Date();
    const cargoAlDia = carteraService.repository.crearMovimiento({
      cuentaId: idAlDia, fecha: hoy.toISOString().split('T')[0], tipo: 'CargoMensual', exigible: 1, monto: 10000,
      anio: hoy.getFullYear(), mes: hoy.getMonth() + 1
    });
    carteraService.registrarAbono({ cuentaId: idAlDia, fecha: hoy.toISOString().split('T')[0], monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargoAlDia] });

    const idSoloApertura = sembrarCuenta(db, 'T903');
    carteraService.repository.crearMovimiento({ cuentaId: idSoloApertura, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 50000 });

    const alDia = pagoService.getCuentasConEstado({ page: 1, limit: 50, filtroPago: 'al_dia' });
    assert.ok(alDia.data.some(f => f.codigo === 'T902'));
    assert.ok(!alDia.data.some(f => f.codigo === 'T903'), 'con apertura opaca pendiente no debe salir en "al día"');

    const enMora = pagoService.getCuentasConEstado({ page: 1, limit: 50, filtroPago: 'en_mora' });
    assert.ok(!enMora.data.some(f => f.codigo === 'T902'));
    assert.ok(enMora.data.some(f => f.codigo === 'T903'), 'con apertura opaca pendiente debe salir en "en mora"');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCuentasConEstado: pagado_hasta sale de cubiertoHasta (cartera), no de pago_periodos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(db, 'T904');
    const carteraService = new CarteraService(ctx.dbService);
    const pagoService = new PagoService(ctx.dbService);

    const cargo = carteraService.repository.crearMovimiento({
      cuentaId, fecha: '2024-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2024, mes: 1
    });
    carteraService.registrarAbono({ cuentaId, fecha: '2024-01-05', monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargo] });
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM pago_periodos`).get().n, 0);

    const r = pagoService.getCuentasConEstado({ page: 1, limit: 50 });
    const fila = r.data.find(f => f.codigo === 'T904');

    assert.equal(fila.pagado_hasta, 'Enero 2024');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
