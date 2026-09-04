// src/services/CarteraService.getIndicadoresMoraTodas.bulk.test.js
//
// getIndicadoresMoraTodas alimentaba cuentas:getStats y pagos:getCuentasConEstado con un
// getEstadoCartera(cuentaId) POR CUENTA -- cada uno disparando ~5 consultas a SQLite. Con 288
// cuentas activas eso medía ~800ms reales (ver benchmark de la auditoría de rendimiento,
// 2026-09-03), bloqueando el proceso principal (better-sqlite3 es síncrono) antes de poder
// pintar el listado. Esta corrección precarga en un puñado de consultas agrupadas por
// cuenta_id lo que antes se pedía cuenta por cuenta, y getEstadoCartera usa esos datos si se
// los pasan -- el cálculo en sí (calcularAPagar y todo lo demás) no cambia una sola línea, así
// que estos tests fijan que el resultado por lotes es IDÉNTICO al de pedirlo cuenta por cuenta,
// y que el número de consultas ya no crece con la cantidad de cuentas.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const { MODOS } = require('./cartera/imputacion');
const { codificarPeriodo } = require('./cartera/periodos');

function sembrarCuenta(db, codigo, estado = 'Activo') {
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', ?)`).run(codigo, estado);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

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

// Causa mes a mes desde 2024-01 hasta el mes actual (inclusive), pagando todo salvo los meses
// en `mesesSinPagar` (1-indexado desde 2024-01) -- para dejar cubiertoHasta en el mes actual y
// que calcularAPagar no necesite ninguna consulta en vivo (ver segundo test, que cuenta
// consultas).
function causarHastaHoy(carteraService, cuentaId, mesesSinPagar = new Set()) {
  const hoy = new Date();
  const mesActualCod = hoy.getFullYear() * 12 + hoy.getMonth();
  let i = 0;
  for (let cod = 2024 * 12; cod <= mesActualCod; cod++) {
    const anio = Math.floor(cod / 12);
    const mes = (cod % 12) + 1;
    i++;
    const mm = String(mes).padStart(2, '0');
    const cargo = carteraService.repository.crearMovimiento({
      cuentaId, fecha: `${anio}-${mm}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000, anio, mes
    });
    if (!mesesSinPagar.has(i)) {
      carteraService.registrarAbono({ cuentaId, fecha: `${anio}-${mm}-05`, monto: 10000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [cargo] });
    }
  }
}

test('getIndicadoresMoraTodas (por lotes) da el mismo resultado que pedir getEstadoCartera cuenta por cuenta, en un grupo con escenarios mezclados', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const carteraService = new CarteraService(ctx.dbService);

    // Al día, sin ningún aviso.
    const idAlDia = sembrarCuenta(db, 'B900');
    asignarTarifaFinca(db, idAlDia);
    causarHastaHoy(carteraService, idAlDia);

    // Con un hueco reciente (en mora).
    const idEnMora = sembrarCuenta(db, 'B901');
    asignarTarifaFinca(db, idEnMora);
    causarHastaHoy(carteraService, idEnMora, new Set([2]));

    // Con deuda opaca anterior a 2024 (en mora aunque 2024+ esté al día).
    const idDeudaOpaca = sembrarCuenta(db, 'B902');
    asignarTarifaFinca(db, idDeudaOpaca);
    causarHastaHoy(carteraService, idDeudaOpaca);
    carteraService.repository.crearMovimiento({ cuentaId: idDeudaOpaca, fecha: '2023-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 60000 });

    // Con punto de conexión pendiente.
    const idPunto = sembrarCuenta(db, 'B903');
    asignarTarifaFinca(db, idPunto);
    causarHastaHoy(carteraService, idPunto);
    carteraService.nuevoPuntoRepository.create({ cuentaId: idPunto, valorTotal: 50000, fechaRegistro: '2025-01-01', observaciones: null });

    // Con saldo a favor (crédito disponible).
    const idCredito = sembrarCuenta(db, 'B904');
    asignarTarifaFinca(db, idCredito);
    causarHastaHoy(carteraService, idCredito);
    carteraService.repository.crearCredito({ cuentaId: idCredito, tipo: 'Abono', monto: 15000, fecha: '2026-01-01' });

    // Sin ninguna cobertura todavía (cuenta recién creada, sin ningún cargo causado).
    const idSinNada = sembrarCuenta(db, 'B905');
    asignarTarifaFinca(db, idSinNada, '2026-01-01');

    const ids = [idAlDia, idEnMora, idDeudaOpaca, idPunto, idCredito, idSinNada];

    const hoy = new Date();
    const periodoActualCod = codificarPeriodo(hoy.getFullYear(), hoy.getMonth() + 1);

    const esperado = ids.map(id => {
      const estado = carteraService.getEstadoCartera(id);
      const mesesVencidos = estado.mesesAPagar.filter(m => codificarPeriodo(m.anio, m.mes) < periodoActualCod);
      return {
        cuentaId: id,
        cubiertoHasta: estado.cubiertoHasta,
        deudaExigible: estado.deudaExigible,
        deudaAntes2024: estado.deudaAntes2024,
        deudaPuntoConexion: estado.deudaPuntoConexion,
        mesesImpagos: mesesVencidos.length,
        mesMasAntiguoImpago: mesesVencidos[0] || null,
        aPagar: estado.aPagar
      };
    });

    const porLotes = carteraService.getIndicadoresMoraTodas(ids);

    assert.deepEqual(porLotes, esperado);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getIndicadoresMoraTodas no dispara una consulta SQL por cuenta -- el número de consultas no crece con la cantidad de cuentas', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const carteraService = new CarteraService(ctx.dbService);

    const ids = [];
    for (let i = 0; i < 20; i++) {
      const id = sembrarCuenta(db, `B9${String(i).padStart(2, '0')}`);
      asignarTarifaFinca(db, id);
      causarHastaHoy(carteraService, id); // cubiertoHasta queda en el mes actual: cero consultas en vivo por mes
      ids.push(id);
    }

    let llamadas = 0;
    const prepareOriginal = db.prepare.bind(db);
    db.prepare = (sql) => {
      llamadas++;
      return prepareOriginal(sql);
    };

    try {
      carteraService.getIndicadoresMoraTodas(ids);
    } finally {
      db.prepare = prepareOriginal;
    }

    // Antes: ~5 consultas x 20 cuentas = ~100. Con precarga por lotes debe quedar muy por debajo
    // de eso, y sobre todo no debe escalar con la cantidad de cuentas (un puñado de consultas
    // agrupadas, no una por cuenta).
    assert.ok(llamadas < 20, `esperaba bien menos de 20 consultas para 20 cuentas (una por cuenta sería ~100), se hicieron ${llamadas}`);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
