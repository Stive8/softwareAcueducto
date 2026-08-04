// CLI del paso 8 (movimientos de cartera para recibos >= 2024).
const fs = require('fs');
const path = require('path');
const { ejecutarPaso8 } = require('./paso8-movimientos');

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) { console.error('Uso: paso8.js <carga_inicial_cartera.json>'); process.exit(1); }

  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const r = ejecutarPaso8({ dbService, recibosJson: data.recibos });

  console.log(`Movimientos de sostenimiento (cartera_movimientos): ${r.movimientosCartera.length} (suma $${r.totalSostenimiento.toLocaleString('es-CO')})`);
  console.log(`Abonos de punto (nuevo_punto_abonos): ${r.abonosPunto.length} (suma $${r.totalPunto.toLocaleString('es-CO')})`);
  console.log(`Ya existían (re-ejecución idempotente): ${r.yaExistian.length}`);
  console.log(`Omitidos sin punto de conexión creado: ${r.omitidosSinPunto.length}`);
  for (const o of r.omitidosSinPunto) console.log(`  - ${o.numeroRecibo} (${o.codigoCuenta})`);
  console.log(`Omitidos sin cuenta resoluble: ${r.omitidosSinCuenta.length}`);
  for (const o of r.omitidosSinCuenta) console.log(`  - ${o.numeroRecibo} (${o.codigoCuenta})`);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso8-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main();
