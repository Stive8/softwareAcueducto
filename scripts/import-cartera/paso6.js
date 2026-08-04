// CLI del paso 6 (punto de conexión).
const fs = require('fs');
const path = require('path');
const { ejecutarPaso6 } = require('./paso6-punto');

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) { console.error('Uso: paso6.js <carga_inicial_cartera.json>'); process.exit(1); }

  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const r = ejecutarPaso6({ dbService, cuentasJson: data.cuentas });

  console.log(`Puntos creados: ${r.totalCreados}`);
  console.log(`Con abono de apertura: ${r.conAbonoApertura.length} (suma $${r.totalAperturaAbonos.toLocaleString('es-CO')})`);
  console.log(`Sin abono de apertura: ${r.sinAbonoApertura.length}`);
  console.log('  ' + r.sinAbonoApertura.map(s => s.codigo).join(', '));

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso6-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main();
