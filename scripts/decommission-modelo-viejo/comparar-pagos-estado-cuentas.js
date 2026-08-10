// scripts/decommission-modelo-viejo/comparar-pagos-estado-cuentas.js
//
// Compara, para las 318 cuentas reales, lo que mostraba la tabla "Estado de Cuentas" del módulo
// de Pagos (PagoRepository/PagoService.getCuentasConEstado, antes de esta corrección: leía
// meses_mora de pago_periodos con el rango completo desde el hueco) contra lo que muestra ahora
// (PagoService.getCuentasConEstado ya corregido, vía CarteraService.getIndicadoresMoraTodas).
// Mismo patrón que comparar-mora-reportes.js -- réplica standalone del cálculo viejo, comparada
// contra el método real ya corregido (no una copia paralela de la lógica nueva).
//
// Se espera que las cuentas que cambian de estado sean las mismas 54 que ya se vieron y
// aceptaron en la Fase 2 (dashboard/reportes) -- esta pantalla usaba la MISMA fórmula rota
// (mismo pago_periodos, mismo rango sin frenar en el hueco), así que el conjunto de cambios no
// debería ser nuevo, solo estaba sin corregir en un segundo lugar.
//
// Uso: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe scripts/decommission-modelo-viejo/comparar-pagos-estado-cuentas.js
const path = require('path');
const DatabaseService = require('../../src/database/DatabaseService');
const PagoService = require('../../src/services/PagoService');

function codificarPeriodoViejo(anio, mes) { return anio * 12 + (mes - 1); }

function anioMesDeFecha(fechaString) {
  const [anio, mes] = fechaString.split(' ')[0].split('-').map(Number);
  return { anio, mes };
}

// Réplica exacta de lo que hacía PagoRepository.getCuentasConEstado + PagoService.getCuentasConEstado
// antes de esta corrección: ultimo_periodo_num de pago_periodos, rango completo sin frenar en el
// primer hueco, sin considerar deuda_antes_2024 en absoluto.
function estadoMoraPagosViejo(db, cuentaId, periodoActualCod) {
  const fila = db.prepare(`
    SELECT c.fecha_creacion,
           (SELECT MAX(anio * 12 + (mes - 1)) FROM pago_periodos WHERE cuenta_id = c.id) as ultimo_periodo_num,
           (SELECT MIN(fecha_inicio) FROM cuenta_categorias WHERE cuenta_id = c.id) as fecha_inicio_facturacion
    FROM cuentas c WHERE c.id = ?
  `).get(cuentaId);

  let pagadoHasta = null, siguienteCod;
  if (fila.ultimo_periodo_num !== null && fila.ultimo_periodo_num !== undefined) {
    const anio = Math.floor(fila.ultimo_periodo_num / 12);
    const mes = (fila.ultimo_periodo_num % 12) + 1;
    pagadoHasta = `${anio}-${String(mes).padStart(2, '0')}`;
    siguienteCod = fila.ultimo_periodo_num + 1;
  } else {
    const inicio = anioMesDeFecha(fila.fecha_inicio_facturacion || fila.fecha_creacion);
    siguienteCod = codificarPeriodoViejo(inicio.anio, inicio.mes);
  }
  const mesesMora = Math.max(periodoActualCod - siguienteCod + 1, 0);
  return { pagadoHasta, mesesMora, enMora: mesesMora > 0 };
}

function main() {
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();
  const db = dbService.getDb();
  const pagoService = new PagoService(dbService);

  const hoy = new Date();
  const periodoActualCod = codificarPeriodoViejo(hoy.getFullYear(), hoy.getMonth() + 1);

  const cuentas = db.prepare(`SELECT id, codigo FROM cuentas WHERE estado = 'Activo' ORDER BY codigo`).all();

  const nuevasFilas = pagoService.getCuentasConEstado({ page: 1, limit: cuentas.length + 1 }).data;
  const porCodigo = new Map(nuevasFilas.map(f => [f.codigo, f]));

  console.log('=== Estado de Cuentas (Pagos): viejo vs nuevo, 318 cuentas activas ===');
  let mismoEstado = 0, pasanAMora = 0, pasanAlDia = 0;
  const cambios = [];
  const pagadoHastaDistinto = [];

  for (const c of cuentas) {
    const viejo = estadoMoraPagosViejo(db, c.id, periodoActualCod);
    const nueva = porCodigo.get(c.codigo);

    if (viejo.enMora === nueva.en_mora) {
      mismoEstado++;
    } else if (nueva.en_mora) {
      pasanAMora++;
      cambios.push({ codigo: c.codigo, de: 'Al día', a: 'En mora', mesesViejo: viejo.mesesMora, mesesNuevo: nueva.meses_mora, deudaAntes2024: nueva.deuda_antes_2024, motivo: nueva.motivo_mora });
    } else {
      pasanAlDia++;
      cambios.push({ codigo: c.codigo, de: 'En mora', a: 'Al día', mesesViejo: viejo.mesesMora, mesesNuevo: nueva.meses_mora, deudaAntes2024: nueva.deuda_antes_2024, motivo: nueva.motivo_mora });
    }

    // Casos donde el estado (en mora / al día) no cambió pero el conteo de meses sí -- el
    // patrón R007 (mismo estado "en mora" en los dos, pero el número que ve el operador baja).
    if (viejo.enMora === nueva.en_mora && viejo.mesesMora !== nueva.meses_mora) {
      pagadoHastaDistinto.push({ codigo: c.codigo, mesesViejo: viejo.mesesMora, mesesNuevo: nueva.meses_mora, deudaAntes2024: nueva.deuda_antes_2024 });
    }
  }

  console.log(`Mismo estado (en mora / al día): ${mismoEstado}`);
  console.log(`Pasan de "al día" a "en mora": ${pasanAMora}`);
  console.log(`Pasan de "en mora" a "al día": ${pasanAlDia}`);
  for (const ch of cambios) {
    console.log(`  ${ch.codigo}: ${ch.de} -> ${ch.a} (meses viejo=${ch.mesesViejo}, meses nuevo=${ch.mesesNuevo}, deuda_antes_2024=${ch.deudaAntes2024}, motivo_mora=${JSON.stringify(ch.motivo)})`);
  }

  console.log(`\nMismo estado pero el conteo de meses cambió (patrón R007, sigue "en mora" en los dos pero el número baja): ${pagadoHastaDistinto.length}`);
  for (const p of pagadoHastaDistinto) {
    console.log(`  ${p.codigo}: meses viejo=${p.mesesViejo} -> meses nuevo=${p.mesesNuevo} (deuda_antes_2024=${p.deudaAntes2024})`);
  }

  dbService.close();
}

main();
