// Atajo para "npm run conciliacion": corre paso11.js (solo lectura, nunca inserta) contra
// data/carga_inicial_cartera.json y la base real. Mismo mecanismo que scripts/test.js -- usa
// el runtime de Node embebido en Electron porque better-sqlite3 está compilado contra su ABI.
//
// Regla del README: toda escritura contra la base real (una corrección de
// paso9b-correcciones.js, una redención, un ajuste) va seguida de `npm run conciliacion`. Si
// el conteo de "Cuadran exacto" no da lo esperado, hay que explicar por qué antes de seguir.
const path = require('path');
const { spawnSync } = require('child_process');
const electronPath = require('electron');

const proyectoDir = path.join(__dirname, '..');
const jsonPath = path.join(proyectoDir, 'data', 'carga_inicial_cartera.json');

const resultado = spawnSync(electronPath, [path.join(__dirname, 'import-cartera', 'paso11.js'), jsonPath], {
  stdio: 'inherit',
  cwd: proyectoDir,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});

process.exit(resultado.status === null ? 1 : resultado.status);
