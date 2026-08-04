// CLI del paso 4 (estados y suspensiones).
const path = require('path');
const { ejecutarPaso4 } = require('./paso4-estados');

function main() {
  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const r = ejecutarPaso4({ dbService, usuarioId: 1 });

  console.log(`Suspendidas: ${r.suspendidas.length} (fecha ${r.fechaSuspension})`);
  for (const s of r.suspendidas) console.log(`  - ${s.codigo} (id ${s.cuentaId})`);

  dbService.close();
}

main();
