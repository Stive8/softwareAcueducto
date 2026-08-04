// CLI del paso 3 (categorías). Uso:
//   ELECTRON_RUN_AS_NODE=1 electron scripts/import-cartera/paso3.js <carga_inicial_cartera.json>
const fs = require('fs');
const path = require('path');
const { ejecutarPaso3 } = require('./paso3-categorias');

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error('Uso: paso3.js <carga_inicial_cartera.json>');
    process.exit(1);
  }

  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const r = ejecutarPaso3({ dbService, cuentasJson: data.cuentas });

  console.log(`Corregidas: ${r.corregidas.length}`);
  console.log(`Ya estaban correctas: ${r.yaCorrectas.length}`);
  console.log(`Sin dato en el JSON (sin tocar): ${r.sinResolver.length}`);
  for (const s of r.sinResolver) console.log(`  - ${s.codigo}`);
  console.log(`Cuentas que quedan en "Sin clasificar": ${r.sinClasificar.length}`);
  if (r.sinClasificar.length) console.log('  ' + r.sinClasificar.join(', '));

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso3-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main();
