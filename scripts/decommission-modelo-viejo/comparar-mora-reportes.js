// scripts/decommission-modelo-viejo/comparar-mora-reportes.js
//
// Compara, para las 318 cuentas reales, las cifras de mora/cartera por cobrar que daba el
// modelo viejo (pago_periodos, SQL crudo tal como estaba antes de la Fase 2) contra las que da
// ahora ReporteRepository/DashboardRepository (cartera, vía CarteraService). Se escribió para
// verificar, antes de aceptarlo, el cambio descrito en
// docs/superpowers/specs/2026-08-10-fase2-reportes-dashboard-design.md -- mismo patrón que
// scripts/decommission-modelo-viejo/comparar-siguiente-periodo.js.
//
// A diferencia de ese script, acá NO hay un número esperado de antemano: el viejo cuenta meses
// de mora, el nuevo cuenta dinero, y además el nuevo suma deudaAntes2024 y deudaPuntoConexion
// que el viejo nunca contó. Se esperan diferencias grandes -- el criterio no es "que sea
// parecido", es que cada diferencia se pueda explicar al revisarla.
//
// Uso: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe scripts/decommission-modelo-viejo/comparar-mora-reportes.js
const path = require('path');
const DatabaseService = require('../../src/database/DatabaseService');
const ReporteRepository = require('../../src/repositories/ReporteRepository');
const DashboardRepository = require('../../src/repositories/DashboardRepository');

function codificarPeriodoViejo(anio, mes) { return anio * 12 + (mes - 1); }

function anioMesDeFecha(fechaString) {
  const [anio, mes] = fechaString.split(' ')[0].split('-').map(Number);
  return { anio, mes };
}

// Réplica exacta de la lógica vieja (pre-Fase 2) de getCuentasConUltimoPeriodo +
// procesarEstadoCuentas, para tener un "antes" real con el que comparar sin depender de código
// que ya se modificó.
function estadoMoraViejo(db, cuentaId, periodoActualCod) {
  const fila = db.prepare(`
    SELECT c.fecha_creacion,
           (SELECT MAX(anio * 12 + (mes - 1)) FROM pago_periodos WHERE cuenta_id = c.id) as ultimo_periodo_num,
           (SELECT MIN(fecha_inicio) FROM cuenta_categorias WHERE cuenta_id = c.id) as fecha_inicio_facturacion
    FROM cuentas c WHERE c.id = ?
  `).get(cuentaId);

  let siguienteCod;
  if (fila.ultimo_periodo_num !== null && fila.ultimo_periodo_num !== undefined) {
    siguienteCod = fila.ultimo_periodo_num + 1;
  } else {
    const inicio = anioMesDeFecha(fila.fecha_inicio_facturacion || fila.fecha_creacion);
    siguienteCod = inicio.anio * 12 + (inicio.mes - 1);
  }
  const mesesMora = Math.max(periodoActualCod - siguienteCod + 1, 0);
  return { mesesMora, enMora: mesesMora > 0 };
}

function tarifaActualViejo(db, cuentaId) {
  const fila = db.prepare(`
    SELECT ct.tarifa_sostenimiento
    FROM cuenta_categorias cc
    INNER JOIN categoria_tarifas ct ON ct.categoria_id = cc.categoria_id
    WHERE cc.cuenta_id = ? AND cc.fecha_fin IS NULL AND ct.fecha_vigencia_hasta IS NULL
    LIMIT 1
  `).get(cuentaId);
  return fila ? fila.tarifa_sostenimiento : 0;
}

function main() {
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();
  const db = dbService.getDb();
  const reporteRepo = new ReporteRepository(dbService);
  const dashRepo = new DashboardRepository(dbService);

  const hoy = new Date();
  const periodoActualCod = codificarPeriodoViejo(hoy.getFullYear(), hoy.getMonth() + 1);

  const cuentas = db.prepare(`SELECT id, codigo FROM cuentas WHERE estado = 'Activo' ORDER BY codigo`).all();

  // --- 1. Cuentas en Mora: viejo vs nuevo ---
  console.log('=== 1. Cuentas en Mora (al día -> en mora, o viceversa) ===');
  let mismoEstado = 0, pasanAMora = 0, pasanAlDia = 0;
  const cambiosEstado = [];
  // getCuentasConUltimoPeriodo ya trae las 318 de una: se pide una sola vez, no por cuenta.
  const filasNuevas = reporteRepo.getCuentasConUltimoPeriodo();
  const porCodigo = new Map(filasNuevas.map(f => [f.codigo, f]));
  for (const c of cuentas) {
    const viejo = estadoMoraViejo(db, c.id, periodoActualCod);
    const nueva = porCodigo.get(c.codigo);
    // meses_impagos (CarteraService.getIndicadoresMoraTodas), NO (periodo_actual -
    // ultimo_periodo_num): ese rango cuenta todo lo que pasó desde el primer hueco aunque ya se
    // haya puesto al día después (ver el fix del caso R007 en el spec).
    const mesesMoraNuevo = nueva.meses_impagos;
    const enMoraNuevo = mesesMoraNuevo > 0 || (nueva.deuda_antes_2024 || 0) > 0;

    if (viejo.enMora === enMoraNuevo) {
      mismoEstado++;
    } else if (enMoraNuevo) {
      pasanAMora++;
      cambiosEstado.push({ codigo: c.codigo, de: 'Al día', a: 'En mora', mesesMoraViejo: viejo.mesesMora, mesesMoraNuevo, deudaAntes2024: nueva.deuda_antes_2024 });
    } else {
      pasanAlDia++;
      cambiosEstado.push({ codigo: c.codigo, de: 'En mora', a: 'Al día', mesesMoraViejo: viejo.mesesMora, mesesMoraNuevo, deudaAntes2024: nueva.deuda_antes_2024 });
    }
  }
  console.log(`Mismo estado: ${mismoEstado}`);
  console.log(`Pasan de "al día" a "en mora": ${pasanAMora}`);
  console.log(`Pasan de "en mora" a "al día": ${pasanAlDia}`);
  for (const ch of cambiosEstado) {
    console.log(`  ${ch.codigo}: ${ch.de} -> ${ch.a} (meses viejo=${ch.mesesMoraViejo}, meses nuevo=${ch.mesesMoraNuevo}, deuda_antes_2024=${ch.deudaAntes2024})`);
  }

  // --- 2. Cartera por Edades ---
  console.log('\n=== 2. Cartera por Edades: rango viejo vs nuevo ===');
  const filasAgingNuevas = reporteRepo.getCartedaPorEdades();
  let filasVanEntrando = 0;
  const detalleAging = [];
  for (const fila of filasAgingNuevas) {
    const cuenta = cuentas.find(c => c.codigo === fila.codigo);
    const viejo = estadoMoraViejo(db, cuenta.id, periodoActualCod);
    if (viejo.mesesMora === 0) {
      filasVanEntrando++;
      detalleAging.push({ codigo: fila.codigo, rango: fila.rango_mora, valor: fila.valor_estimado, motivo: 'no estaba antes (solo deuda anterior al corte)' });
    }
  }
  console.log(`Filas nuevas en el reporte que antes NO aparecían: ${filasVanEntrando}`);
  for (const d of detalleAging) console.log(`  ${d.codigo}: ${d.rango}, $${d.valor} (${d.motivo})`);

  // --- 3. Cuentas por Cobrar (Balance General) ---
  console.log('\n=== 3. Cuentas por Cobrar: total viejo vs nuevo (desglosado) ===');
  let totalViejo = 0;
  for (const c of cuentas) {
    const viejo = estadoMoraViejo(db, c.id, periodoActualCod);
    const tarifa = tarifaActualViejo(db, c.id);
    totalViejo += viejo.mesesMora * tarifa;
  }
  const nuevoDesglose = reporteRepo.getCuentasPorCobrarEstimado();
  console.log(`Total viejo (solo meses de mora x tarifa, sin apertura ni punto): $${totalViejo}`);
  console.log(`Total nuevo: $${nuevoDesglose.total}`);
  console.log(`  Deuda anterior al corte (2024): $${nuevoDesglose.deudaAntes2024} (el viejo nunca la contó)`);
  console.log(`  Deuda desde 2024 (deudaExigible): $${nuevoDesglose.deudaExigible}`);
  console.log(`  Deuda de conexión: $${nuevoDesglose.deudaPuntoConexion} (el viejo nunca la contó)`);
  console.log(`Diferencia total: $${nuevoDesglose.total - totalViejo}`);
  console.log(`  De la cual, "de verdad" nueva info (antes/punto): $${nuevoDesglose.deudaAntes2024 + nuevoDesglose.deudaPuntoConexion}`);
  console.log(`  Y la diferencia en la parte comparable (2024+): $${nuevoDesglose.deudaExigible - totalViejo}`);

  // --- 4. Saldo a Favor (no existía antes en ningún lado) ---
  console.log('\n=== 4. Saldo a Favor de Asociados (nuevo, sin comparación posible) ===');
  const saldoAFavorTotal = reporteRepo.getCuentasConSaldoAFavor().reduce((s, f) => s + f.saldo, 0);
  const cantidadCuentas = reporteRepo.getCuentasConSaldoAFavor().length;
  console.log(`Total: $${saldoAFavorTotal} (${cantidadCuentas} cuentas)`);

  dbService.close();
}

main();
