// Lanza los tests con el runtime de Node embebido en Electron. Es necesario porque
// better-sqlite3 está compilado contra el ABI de Electron (ver "rebuild" en package.json),
// no contra el del Node del sistema: requerirlo desde un `node` normal falla con
// "NODE_MODULE_VERSION mismatch". ELECTRON_RUN_AS_NODE=1 hace que electron.exe se comporte
// como un proceso Node normal (sin abrir ninguna ventana), así que node:test funciona igual
// que en Node puro.
const { spawnSync } = require('child_process');
const electronPath = require('electron');

const resultado = spawnSync(electronPath, ['--test', '--test-reporter=spec'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});

process.exit(resultado.status === null ? 1 : resultado.status);
