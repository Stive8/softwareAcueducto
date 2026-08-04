// Paso 9 de la carga inicial (sección 14 del MD): causar los meses de sostenimiento 2024 →
// julio 2026 desde `plan_causacion`, la única fuente de verdad para estos 3 años (nunca se
// deriva de `categoria_tarifas`).
//
// Decisiones tomadas con el usuario para este paso (no están en el MD, se resolvieron en chat):
//
// 1. `plan_causacion.<año>.meses === null` se trata como 0 meses causados ESE año. Esto ya está
//    validado por el propio JSON: `conciliacion.cuadra_exacto` compara el saldo que resulta de
//    tratar los null como 0 contra el saldo real de CARTERA, y da true en 286/306 cuentas (las
//    otras 20 fallan por una razón distinta y ya conocida -- ver sección 7 del MD). No hace falta
//    re-verificar continuidad de saldo cuenta por cuenta: ese chequeo ya está hecho.
//
// 2. 2024 y 2025 con `meses` entero: se generan N movimientos CargoMensual, uno por mes, a
//    tarifa completa. El mes de arranque es el de `inicio_causacion_estimado` SI su año coincide
//    con el año que se está procesando; si no, enero. Verificado contra las 24 cuentas reales con
//    inicio_causacion_estimado: todas terminan exacto en diciembre, nunca se desborda.
//
// 3. 2024 con `meses` fraccionario (7 cuentas: R0942, R096, R097, S0222, S023, S037, S0372) --
//    representa un cambio de categoría/tarifa a mitad de año que no se puede partir en meses
//    exactos. Se generan floor(meses) [tope 12] CargoMensual de tarifa completa desde el mes de
//    arranque, más UN AjusteCategoria por el residuo (causacion_sostenimiento menos lo ya
//    causado), fechado el 1 de enero de ese año, con mes=NULL porque no hay mes exacto que le
//    corresponda.
//
// 4. 2026 SIEMPRE se topa a julio (mes 7), sin importar qué diga `meses` -- el número real de
//    meses a causar es `meses - 5` (los 5 meses de agosto a diciembre quedan sin causar en TODAS
//    las cuentas, se resuelven en el ajuste global del paso 11: SALDO A 31/12/2026 − 5×tarifa).
//    El mes de arranque dentro de 2026 se deriva como `13 - meses`, sin usar
//    inicio_causacion_estimado aunque exista para ese año (confirmado con el usuario usando
//    R0972 como caso de prueba: meses=6 -> arranca en julio, causa 1 solo mes, no 6).
//
// 5. Las 9 cuentas sin fila en CARTERA (plan_causacion == {}) y las que tengan un año sin ninguna
//    clave -- no causan nada ese año. No hay tarifa de origen que inventar.
//
// Idempotente: un CargoMensual se identifica por (cuenta_id, anio, mes); el residuo por
// (cuenta_id, anio, tipo=AjusteCategoria, mes IS NULL). Reejecutar no duplica.
const { normalizarCodigo } = require('./normalizar');
const { primerDiaDelMes } = require('../../src/services/cartera/periodos');
const { redondear, sonIguales } = require('../../src/services/cartera/dinero');

const OBSERVACION_RESIDUAL =
  'Residuo de causacion anual segun hoja CARTERA - cambio de categoria o ajuste a mitad de año, mes exacto no determinable';

function parsearInicio(inicioStr) {
  if (!inicioStr) return null;
  const [anio, mes] = inicioStr.split('-').map(Number);
  return { anio, mes };
}

function mesInicioParaAnio(inicioEstimado, anio) {
  return (inicioEstimado && inicioEstimado.anio === anio) ? inicioEstimado.mes : 1;
}

function construirPlan(cuentasJson, idPorCodigo, violaciones) {
  const plan = [];

  for (const cuenta of cuentasJson) {
    if (cuenta.codigo === 'S0332S0382') continue;
    const cuentaId = idPorCodigo.get(normalizarCodigo(cuenta.codigo));
    if (cuentaId === undefined) { violaciones.push(`${cuenta.codigo}: no existe en la base -- ¿corrieron los pasos 1-2?`); continue; }

    const pc = cuenta.plan_causacion || {};
    const inicioEstimado = parsearInicio(cuenta.inicio_causacion_estimado);

    for (const anioStr of ['2024', '2025']) {
      const anio = Number(anioStr);
      const y = pc[anioStr];
      if (!y || y.meses === null || y.meses === undefined) continue;

      const mesInicio = mesInicioParaAnio(inicioEstimado, anio);

      if (Number.isInteger(y.meses)) {
        const mesFin = mesInicio + y.meses - 1;
        if (mesFin > 12) {
          violaciones.push(`${cuenta.codigo} ${anio}: mes inicio (${mesInicio}) + meses (${y.meses}) excede diciembre`);
          continue;
        }
        for (let mes = mesInicio; mes <= mesFin; mes++) {
          plan.push({ cuentaId, codigo: cuenta.codigo, anio, mes, monto: y.tarifa, tipo: 'CargoMensual' });
        }
      } else {
        const mesesEnteros = Math.min(Math.floor(y.meses), 12);
        const residual = redondear(y.causacion_sostenimiento - mesesEnteros * y.tarifa);
        if (!sonIguales(mesesEnteros * y.tarifa + residual, y.causacion_sostenimiento)) {
          violaciones.push(
            `${cuenta.codigo} ${anio}: (${mesesEnteros}×${y.tarifa}) + ${residual} != causacion_sostenimiento (${y.causacion_sostenimiento})`
          );
          continue;
        }
        const mesFin = mesInicio + mesesEnteros - 1;
        if (mesFin > 12) {
          violaciones.push(`${cuenta.codigo} ${anio}: mes inicio (${mesInicio}) + mesesEnteros (${mesesEnteros}) excede diciembre`);
          continue;
        }
        for (let mes = mesInicio; mes <= mesFin; mes++) {
          plan.push({ cuentaId, codigo: cuenta.codigo, anio, mes, monto: y.tarifa, tipo: 'CargoMensual' });
        }
        if (residual !== 0) {
          plan.push({ cuentaId, codigo: cuenta.codigo, anio, mes: null, monto: residual, tipo: 'AjusteCategoria' });
        }
      }
    }

    const y26 = pc['2026'];
    if (y26 && y26.meses !== null && y26.meses !== undefined) {
      if (!Number.isInteger(y26.meses)) {
        violaciones.push(`${cuenta.codigo} 2026: meses fraccionario (${y26.meses}) no soportado por este paso`);
        continue;
      }
      const mesesACausar = y26.meses - 5;
      if (mesesACausar > 0) {
        const mesInicio2026 = 13 - y26.meses;
        for (let mes = mesInicio2026; mes <= 7; mes++) {
          plan.push({ cuentaId, codigo: cuenta.codigo, anio: 2026, mes, monto: y26.tarifa, tipo: 'CargoMensual' });
        }
      }
    }
  }

  return plan;
}

function ejecutarPaso9({ dbService, cuentasJson }) {
  const CarteraRepository = require('../../src/repositories/CarteraRepository');
  const db = dbService.getDb();
  const repo = new CarteraRepository(dbService);

  const idPorCodigo = new Map(
    db.prepare('SELECT id, codigo FROM cuentas').all().map(c => [normalizarCodigo(c.codigo), c.id])
  );
  const getResidual = db.prepare(`
    SELECT id FROM cartera_movimientos WHERE cuenta_id = ? AND anio = ? AND tipo = 'AjusteCategoria' AND mes IS NULL
  `);

  const violaciones = [];
  const plan = construirPlan(cuentasJson, idPorCodigo, violaciones);

  if (violaciones.length > 0) {
    throw new Error(`Paso 9 -- validación previa falló:\n${violaciones.join('\n')}`);
  }

  const creados = [];
  const yaExistian = [];

  const transaccion = db.transaction(() => {
    for (const item of plan) {
      if (item.tipo === 'CargoMensual') {
        if (repo.getCargoMensual(item.cuentaId, item.anio, item.mes)) {
          yaExistian.push(item);
          continue;
        }
        const movId = repo.crearMovimiento({
          cuentaId: item.cuentaId, fecha: primerDiaDelMes(item.anio, item.mes),
          tipo: 'CargoMensual', exigible: 1, monto: item.monto, anio: item.anio, mes: item.mes
        });
        creados.push({ ...item, movId });
      } else {
        if (getResidual.get(item.cuentaId, item.anio)) {
          yaExistian.push(item);
          continue;
        }
        const movId = repo.crearMovimiento({
          cuentaId: item.cuentaId, fecha: `${item.anio}-01-01`,
          tipo: 'AjusteCategoria', exigible: 1, monto: item.monto,
          anio: item.anio, mes: null, observaciones: OBSERVACION_RESIDUAL
        });
        creados.push({ ...item, movId });
      }
    }
  });
  transaccion();

  return {
    creados, yaExistian,
    totalCreado: redondear(creados.reduce((s, c) => s + c.monto, 0))
  };
}

module.exports = { ejecutarPaso9, construirPlan, OBSERVACION_RESIDUAL };
