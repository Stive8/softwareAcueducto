// CLI del paso 5 (apertura opaca).
const fs = require('fs');
const path = require('path');
const { ejecutarPaso5 } = require('./paso5-apertura');

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) { console.error('Uso: paso5.js <carga_inicial_cartera.json>'); process.exit(1); }

  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const r = ejecutarPaso5({ dbService, cuentasJson: data.cuentas });

  console.log(`Positivas: ${r.positivas.length} (suma $${r.totalPositivas.toLocaleString('es-CO')})`);
  console.log(`Negativas: ${r.negativas.length} (suma $${r.totalNegativas.toLocaleString('es-CO')})`);
  console.log(`En cero: ${r.cero.length}`);
  console.log(`Sin dato (sin movimiento): ${r.sinDato.length}`);
  console.log('  ' + r.sinDato.map(s => s.codigo).join(', '));

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso5-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main();
