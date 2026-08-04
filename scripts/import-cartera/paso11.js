// CLI del paso 11 (conciliación). Solo calcula y reporta -- NUNCA inserta AjusteCargaInicial.
// Las 12 cuentas con diferencia quedan documentadas (ver PUNTOS-CONFLICTIVOS.md), no ajustadas.
const fs = require('fs');
const path = require('path');
const { calcularConciliacion } = require('./paso11-conciliacion');

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) { console.error('Uso: paso11.js <carga_inicial_cartera.json>'); process.exit(1); }

  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const r = calcularConciliacion({ dbService, cuentasJson: data.cuentas, recibosJson: data.recibos });

  console.log(`Evaluadas: ${r.filas.length} (sin target: ${r.sinTarget.length})`);
  console.log(`Cuadran exacto: ${r.cero.length}`);
  console.log(`Diferencia baja (<1000): ${r.bajo.length}`);
  console.log(`Diferencia alta (>=1000): ${r.alto.length}`);
  for (const f of r.alto) console.log(`  - ${f.codigo}: ${f.diferencia}`);
  console.log('AjusteCargaInicial insertados: 0 (este paso nunca inserta)');

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso11-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main();
