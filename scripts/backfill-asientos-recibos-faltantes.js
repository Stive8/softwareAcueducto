// Backfill puntual: genera el asiento contable faltante para recibos reales que se cargaron
// directo por scripts/import-cartera/paso9b-correcciones.js (recibos físicos del talonario
// encontrados en las rondas de cruce de agosto 2026) sin pasar por PagoService/ReciboService,
// que es donde normalmente se dispara AsientoContableService.generarDesdeRecibo(). Resultado:
// esos recibos quedaban visibles en Cartera pero invisibles en Estado de Resultados / Balance
// de Prueba (que leen movimientos_contables).
//
// Además, ~34 de esas líneas de recibo_detalles quedaron con cuenta_contable_id NULL (el bug
// que dejó esto así no se investigó a fondo -- no es necesario para corregir hacia adelante).
// Antes de generar el asiento, este script les resuelve la cuenta usando el mismo mapeo que usa
// la app (mapeo_conceptos_contables, módulo 'RecibosDetalle'), inferido del texto del concepto:
// "SOSTENIMIENTO" -> Sostenimiento; "ABONO PUNTO NUEVO" -> AbonoPuntoNuevo.
//
// Uso: node scripts/backfill-asientos-recibos-faltantes.js         (dry-run, no escribe nada)
//      node scripts/backfill-asientos-recibos-faltantes.js --commit (aplica los cambios)

const path = require('path');
const DatabaseService = require('../src/database/DatabaseService');
const AsientoContableService = require('../src/services/AsientoContableService');

const COMMIT = process.argv.includes('--commit');

const dbService = new DatabaseService(process.cwd());
const db = dbService.getDb();
const asientoService = new AsientoContableService(dbService);

function resolverCuentaPorConcepto(concepto) {
  const c = concepto.toUpperCase();
  if (c.includes('ABONO PUNTO NUEVO')) return 'AbonoPuntoNuevo';
  if (c.includes('SOSTENIMIENTO') || c.includes('PUNTO DE AGUA')) return 'Sostenimiento';
  return null;
}

function main() {
  const pendientes = db.prepare(`
    SELECT r.id, r.numero_recibo, r.fecha_recibo, r.total
    FROM recibos r
    WHERE r.estado = 'Activo'
      AND NOT EXISTS (
        SELECT 1 FROM asientos_contables a
        WHERE a.referencia_tipo = 'Recibo' AND a.referencia_id = r.id AND a.estado != 'Anulado'
      )
    ORDER BY r.fecha_recibo ASC, r.id ASC
  `).all();

  console.log(`Recibos activos sin asiento: ${pendientes.length}`);

  const detallesSinCuenta = db.prepare(`
    SELECT rd.id, rd.recibo_id, rd.concepto
    FROM recibo_detalles rd
    WHERE rd.cuenta_contable_id IS NULL
      AND rd.recibo_id IN (${pendientes.map(r => r.id).join(',') || '0'})
  `).all();

  const mapeoStmt = db.prepare(`SELECT cuenta_contable_id FROM mapeo_conceptos_contables WHERE modulo = 'RecibosDetalle' AND concepto = ?`);
  const resoluciones = [];
  for (const d of detallesSinCuenta) {
    const tipo = resolverCuentaPorConcepto(d.concepto);
    if (!tipo) throw new Error(`No se pudo inferir el tipo de concepto contable para recibo_detalle id=${d.id} ("${d.concepto}"). Revisar manualmente.`);
    const fila = mapeoStmt.get(tipo);
    if (!fila) throw new Error(`No hay mapeo_conceptos_contables para RecibosDetalle/${tipo}`);
    resoluciones.push({ detalleId: d.id, reciboId: d.recibo_id, concepto: d.concepto, tipo, cuentaContableId: fila.cuenta_contable_id });
  }

  console.log(`Detalles de recibo sin cuenta_contable_id a resolver: ${resoluciones.length}`);
  resoluciones.forEach(r => console.log(`  detalle #${r.detalleId} (recibo ${r.reciboId}): "${r.concepto}" -> ${r.tipo} (cuenta ${r.cuentaContableId})`));

  if (!COMMIT) {
    console.log('\n[DRY-RUN] No se escribió nada. Corra con --commit para aplicar.');
    console.log(`\nSe generarían asientos para ${pendientes.length} recibos:`);
    pendientes.forEach(r => console.log(`  recibo ${r.id} (No. ${r.numero_recibo}) ${r.fecha_recibo} $${r.total.toLocaleString('es-CO')}`));
    return;
  }

  const actualizarCuenta = db.prepare(`UPDATE recibo_detalles SET cuenta_contable_id = ? WHERE id = ?`);

  const resultados = { ok: [], error: [] };

  const ejecutar = db.transaction(() => {
    for (const r of resoluciones) {
      actualizarCuenta.run(r.cuentaContableId, r.detalleId);
    }

    for (const p of pendientes) {
      try {
        const asientoId = asientoService.generarDesdeRecibo(p.id, null);
        resultados.ok.push({ reciboId: p.id, numeroRecibo: p.numero_recibo, asientoId });
      } catch (e) {
        resultados.error.push({ reciboId: p.id, numeroRecibo: p.numero_recibo, error: e.message });
        throw e; // aborta toda la transacción: o se generan todos, o ninguno
      }
    }
  });

  ejecutar();

  console.log(`\nAsientos generados: ${resultados.ok.length}`);
  resultados.ok.forEach(r => console.log(`  recibo ${r.reciboId} (No. ${r.numeroRecibo}) -> asiento ${r.asientoId}`));

  const balance = db.prepare(`
    SELECT COALESCE(SUM(debito),0) as td, COALESCE(SUM(credito),0) as tc FROM movimientos_contables
  `).get();
  console.log(`\nBalance de Prueba global: débito=${balance.td} crédito=${balance.tc} (diferencia=${balance.td - balance.tc})`);
}

try {
  main();
} finally {
  db.close();
}
