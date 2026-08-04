// CLI del paso 2 (cuentas). Reutiliza el resultado guardado del paso 1 (no lo vuelve a ejecutar:
// re-ejecutar paso1-propietarios.js contra una base donde las 14 cuentas todavía no existen
// duplicaría los propietarios recién creados).
// Uso:
//   ELECTRON_RUN_AS_NODE=1 electron scripts/import-cartera/paso2.js <carga_inicial_cartera.json> <paso1-resultado.json>
const fs = require('fs');
const path = require('path');
const { ejecutarPaso2, aplicarCasosEspeciales } = require('./paso2-cuentas');

function main() {
  const jsonPath = process.argv[2];
  const paso1Path = process.argv[3];
  if (!jsonPath || !paso1Path) {
    console.error('Uso: paso2.js <carga_inicial_cartera.json> <paso1-resultado.json>');
    process.exit(1);
  }

  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const paso1 = JSON.parse(fs.readFileSync(paso1Path, 'utf8'));

  const fechaHoy = '2026-07-31';
  const r2 = ejecutarPaso2({ dbService, cuentasJson: data.cuentas, propietariosCreados: paso1.creados });
  const rEspeciales = aplicarCasosEspeciales({ dbService, fechaHoy });

  console.log(`Cuentas creadas: ${r2.creadas.length}`);
  for (const c of r2.creadas) {
    console.log(`  - ${c.codigo} (id ${c.cuentaId}): ${c.categoriaNombre} | ${c.direccion} | propietario=${c.propietarioId ?? 'ninguno'}`);
  }
  console.log(`Con categoría "Sin clasificar" (a revisar antes de causar): ${r2.categoriaPlaceholder.length}`);
  for (const c of r2.categoriaPlaceholder) console.log(`  - ${c.codigo}: ${c.motivo}`);
  console.log('Casos especiales:', JSON.stringify(rEspeciales));

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso2-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ ...r2, casosEspeciales: rEspeciales }, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main();
