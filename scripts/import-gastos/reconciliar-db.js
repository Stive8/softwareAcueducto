// scripts/import-gastos/reconciliar-db.js
const path = require('path');
const { CORRECCIONES_DB } = require('./terceros-canonicos');

// Aplica CORRECCIONES_DB sobre terceros ya guardados: corrige identificaciones con typo a su
// forma canónica, para que el import las encuentre por match exacto en vez de crear duplicados.
function reconciliarIdentificaciones(dbService) {
  const db = dbService.getDb();
  const detalles = [];
  let corregidos = 0;

  const buscar = db.prepare(`SELECT id, nombre_razon_social FROM terceros WHERE numero_identificacion = ?`);
  const actualizar = db.prepare(`UPDATE terceros SET numero_identificacion = ? WHERE id = ?`);

  for (const { de, a } of CORRECCIONES_DB) {
    const origen = buscar.get(de);
    if (!origen) continue; // ya corregido o nunca existió
    const destino = buscar.get(a);
    if (destino) {
      detalles.push(`Conflicto: ya existe un tercero con ${a} (id=${destino.id}); no se toca "${origen.nombre_razon_social}" (id=${origen.id}). Revisar manualmente.`);
      continue;
    }
    actualizar.run(a, origen.id);
    corregidos++;
    detalles.push(`Corregido "${origen.nombre_razon_social}" (id=${origen.id}): ${de} → ${a}`);
  }

  return { corregidos, detalles };
}

module.exports = { reconciliarIdentificaciones };

// --- CLI ---
if (require.main === module) {
  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();
  const r = reconciliarIdentificaciones(dbService);
  console.log(`Reconciliación de terceros: ${r.corregidos} corregido(s).`);
  r.detalles.forEach((d) => console.log('  - ' + d));
  dbService.close();
}
