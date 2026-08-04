// CLI del paso 1 (propietarios). Uso:
//   ELECTRON_RUN_AS_NODE=1 electron scripts/import-cartera/paso1.js <carga_inicial_cartera.json> <DatosPropietariosCuentas.xlsx>
const fs = require('fs');
const path = require('path');
const { leerDatosPropietarios } = require('./leer-datos-propietarios');
const { ejecutarPaso1 } = require('./paso1-propietarios');

async function main() {
  const jsonPath = process.argv[2];
  const datosPath = process.argv[3];
  if (!jsonPath || !datosPath) {
    console.error('Uso: paso1.js <carga_inicial_cartera.json> <DatosPropietariosCuentas.xlsx>');
    process.exit(1);
  }

  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const datosPropietarios = await leerDatosPropietarios(datosPath);

  const r = ejecutarPaso1({ dbService, cuentasJson: data.cuentas, datosPropietarios, usuarioId: 1 });

  console.log(`Reutilizados (cuentas ya existentes con propietario vigente): ${r.reutilizados.length}`);
  console.log(`Creados (propietarios nuevos): ${r.creados.length}`);
  for (const c of r.creados) console.log(`  - ${c.codigo}: "${c.nombre}"${c.nombrePorVerificar ? ' (POR VERIFICAR, no estaba en DATOS)' : ''}`);
  console.log(`Omitidos (sin propietario, con alerta): ${r.omitidos.length}`);
  for (const o of r.omitidos) console.log(`  - ${o.codigo}: ${o.motivo}`);
  console.log(`Sin propietario vigente en una cuenta que ya existía (alerta): ${r.sinPropietarioVigente.length}`);
  for (const s of r.sinPropietarioVigente) console.log(`  - ${s.codigo} (cuentaId ${s.cuentaId})`);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso1-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main().catch(e => { console.error(e); process.exit(1); });
