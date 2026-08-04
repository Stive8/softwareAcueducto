// CLI del paso 9 (causación 2024 -> julio 2026 desde plan_causacion).
const fs = require('fs');
const path = require('path');
const { ejecutarPaso9 } = require('./paso9-causacion');

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) { console.error('Uso: paso9.js <carga_inicial_cartera.json>'); process.exit(1); }

  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const r = ejecutarPaso9({ dbService, cuentasJson: data.cuentas });

  const cargos = r.creados.filter(c => c.tipo === 'CargoMensual');
  const residuales = r.creados.filter(c => c.tipo === 'AjusteCategoria');
  console.log(`CargoMensual creados: ${cargos.length} (suma $${cargos.reduce((s, c) => s + c.monto, 0).toLocaleString('es-CO')})`);
  console.log(`AjusteCategoria residuales creados: ${residuales.length} (suma $${residuales.reduce((s, c) => s + c.monto, 0).toLocaleString('es-CO')})`);
  console.log(`Total causado: $${r.totalCreado.toLocaleString('es-CO')}`);
  console.log(`Ya existían (re-ejecución idempotente): ${r.yaExistian.length}`);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso9-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main();
