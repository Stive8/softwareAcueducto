// CLI del paso 7 (cargar recibos faltantes y fecha_pago_real).
const fs = require('fs');
const path = require('path');
const { ejecutarPaso7 } = require('./paso7-recibos');

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) { console.error('Uso: paso7.js <carga_inicial_cartera.json>'); process.exit(1); }

  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const r = ejecutarPaso7({ dbService, recibosJson: data.recibos });

  console.log(`Recibos creados: ${r.creados.length} (suma $${r.totalCreados.toLocaleString('es-CO')})`);
  console.log(`fecha_pago_real actualizada: ${r.fechaPagoRealActualizada.length}`);
  console.log(`Ya estaban correctos: ${r.yaCorrecta.length}`);
  console.log(`Omitidos sin cuenta resoluble: ${r.omitidosSinCuenta.length}`);
  for (const o of r.omitidosSinCuenta) console.log(`  - ${o.numeroRecibo} (${o.codigoCuenta}): ${o.motivo}`);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso7-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main();
