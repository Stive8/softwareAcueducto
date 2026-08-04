// CLI del paso 10 (imputación: período declarado, luego FIFO).
const fs = require('fs');
const path = require('path');
const { ejecutarPaso10 } = require('./paso10-imputacion');

function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) { console.error('Uso: paso10.js <carga_inicial_cartera.json>'); process.exit(1); }

  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const r = ejecutarPaso10({ dbService, recibosJson: data.recibos });

  console.log(`Abonos procesados: ${r.procesados} (ya estaban imputados: ${r.saltados.length})`);
  console.log(`Imputados por período declarado: ${r.conPeriodo.length}`);
  console.log(`Imputados por FIFO: ${r.conFifo.length}`);
  console.log(`Con sobrante (saldo a favor implícito): ${r.conSobrante.length} (suma $${r.totalSobrante.toLocaleString('es-CO')})`);
  console.log(`Imputado hacia AperturaOpaca (deuda antes de 2024): $${r.porPozo.apertura.toLocaleString('es-CO')}`);
  console.log(`Imputado hacia CargoMensual/AjusteCategoria/AjusteAsamblea (deuda desde 2024): $${r.porPozo.cargosDesde2024.toLocaleString('es-CO')}`);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso10-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main();
