// Segunda parte del backfill de scripts/backfill-asientos-recibos-faltantes.js: ese script
// generó el asiento contable (movimientos_contables) de los 50 recibos que paso9b-correcciones.js
// había insertado directo con pagoRepo.crearRecibo, pero no tocó el libro simple de Caja/Banco
// (tabla `movimientos`, la que usan Dashboard y la pantalla de Caja) -- porque generarDesdeRecibo
// asume que ese lado YA lo creó el llamador (así es como lo hace PagoService.registrarPago*
// para un recibo normal: primero repository.crearMovimiento(), después generarDesdeRecibo()).
// Efecto visible: el chequeo de conciliación Caja/Banco vs. contabilidad quedó descuadrado
// exactamente por el total de esos 50 recibos ($3.614.000 en Efectivo/Caja, $1.426.000 en
// Transferencia/Banco -- verificado antes de correr esto).
//
// Este script crea, para cada uno de esos recibos, el mismo `movimientos` que habría creado
// PagoService si el recibo se hubiera registrado por la app (mismo tipo/origen/concepto), usando
// PagoRepository.crearMovimiento (que además resuelve su propio cuenta_contable_id vía el mapeo
// 'Movimiento', igual que un recibo normal).
//
// Uso: node scripts/backfill-movimientos-recibos-faltantes.js          (dry-run, no escribe nada)
//      node scripts/backfill-movimientos-recibos-faltantes.js --commit  (aplica los cambios)

const DatabaseService = require('../src/database/DatabaseService');
const PagoRepository = require('../src/repositories/PagoRepository');
const AsientoContableService = require('../src/services/AsientoContableService');

const COMMIT = process.argv.includes('--commit');

const dbService = new DatabaseService(process.cwd());
const db = dbService.getDb();
const pagoRepo = new PagoRepository(dbService);
const asientoService = new AsientoContableService(dbService);

function main() {
  const pendientes = db.prepare(`
    SELECT r.id, r.numero_recibo, r.fecha_recibo, r.total, r.metodo_pago
    FROM recibos r
    WHERE r.estado = 'Activo'
      AND NOT EXISTS (SELECT 1 FROM movimientos m WHERE m.referencia_tipo = 'Recibo' AND m.referencia_id = r.id)
      AND EXISTS (
        SELECT 1 FROM asientos_contables a
        WHERE a.referencia_tipo = 'Recibo' AND a.referencia_id = r.id AND a.estado != 'Anulado'
      )
    ORDER BY r.fecha_recibo ASC, r.id ASC
  `).all();

  console.log(`Recibos con asiento contable pero sin movimiento de Caja/Banco: ${pendientes.length}`);
  pendientes.forEach(r => console.log(`  recibo ${r.id} (No. ${r.numero_recibo}) ${r.fecha_recibo} $${r.total.toLocaleString('es-CO')} (${r.metodo_pago} -> ${r.metodo_pago === 'Efectivo' ? 'Caja' : 'Banco'})`));

  const totalEfectivo = pendientes.filter(r => r.metodo_pago === 'Efectivo').reduce((s, r) => s + r.total, 0);
  const totalOtros = pendientes.filter(r => r.metodo_pago !== 'Efectivo').reduce((s, r) => s + r.total, 0);
  console.log(`\nTotal Caja (Efectivo): $${totalEfectivo.toLocaleString('es-CO')}`);
  console.log(`Total Banco (otros métodos): $${totalOtros.toLocaleString('es-CO')}`);

  if (!COMMIT) {
    console.log('\n[DRY-RUN] No se escribió nada. Corra con --commit para aplicar.');
    return;
  }

  const ejecutar = db.transaction(() => {
    for (const r of pendientes) {
      pagoRepo.crearMovimiento({
        tipo: 'Ingreso',
        origen: r.metodo_pago === 'Efectivo' ? 'Caja' : 'Banco',
        monto: r.total,
        concepto: `Recibo No. ${r.numero_recibo}`,
        referenciaId: r.id,
        referenciaTipo: 'Recibo',
        fechaMovimiento: r.fecha_recibo
      });
    }
  });

  ejecutar();

  console.log(`\n${pendientes.length} movimientos creados.`);

  console.log('\nConciliación Caja/Banco vs. contabilidad (mismo chequeo que usa la app):');
  console.log(asientoService.verificarConciliacionCajaBanco());
}

try {
  main();
} finally {
  db.close();
}
