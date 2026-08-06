// CLI del paso 9b (correcciones puntuales: causación S03311 + tarifa derogada de 4 cuentas).
const fs = require('fs');
const path = require('path');
const { ejecutarPaso9b } = require('./paso9b-correcciones');

function main() {
  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const r = ejecutarPaso9b({ dbService });

  console.log(`S03311: ${r.s03311Creados.length} CargoMensual creados (2024 a 10.000)`);
  for (const t of r.tarifaCorregida) {
    console.log(`${t.codigo}: ${t.borrados} CargoMensual borrados (5.000), ${t.creados} creados (10.000)`);
  }
  console.log(`S0244 propietario: ${r.propietarioS0244.creado ? 'asignado' : 'ya estaba asignado'}`);
  console.log(`Recibo 2137: ${r.reasignacion2137.reasignado ? 'reasignado de S0312 a S0393' : 'ya estaba en S0393'}`);
  console.log(`Recibo 2384: ${r.correccion2384.corregido ? 'período corregido a 2025' : 'ya estaba corregido'} (texto); ${r.reimputacion2384.reimputado ? 're-imputado contra 2025' : 'ya estaba re-imputado'} (modelo nuevo)`);
  console.log(`S010 (recibos 1659/1825): ${r.recalculoS010.yaCorregido ? 'ya estaba corregido' : `1659 eliminado, ${r.recalculoS010.abonos.length} abonos recalculados`}`);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso9b-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main();
