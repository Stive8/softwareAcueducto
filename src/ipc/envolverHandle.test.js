// src/ipc/envolverHandle.test.js
//
// envolverHandle.js es un módulo de proceso principal de Electron: hace
// `require('electron')` en su primera línea para obtener `ipcMain`. El paquete npm
// "electron" (node_modules/electron/index.js) solo expone la ruta al ejecutable -- el
// objeto real con `ipcMain`, `app`, etc. solo existe dentro de un proceso Electron ya
// arrancado como app, algo que scripts/test.js deliberadamente evita (corre los tests con
// ELECTRON_RUN_AS_NODE=1 para poder usar better-sqlite3, que está compilado contra el ABI
// de Electron). Como consecuencia, un `require('electron')` normal en este proceso de test
// da el string de la ruta, no el objeto real, y `ipcMain.handle(...)` explotaría.
//
// Node's `t.mock.module()` (node:test) tampoco sirve aquí: al intentar interceptar
// 'electron' lanza "The argument 'format' must be one of: ... Received 'electron'" porque
// el propio loader de Electron registra 'electron' con un formato especial que el
// resolutor de mocks de node:test no reconoce.
//
// La salida es la técnica clásica de CommonJS: precargar `require.cache` con un módulo
// falso para la ruta resuelta de 'electron' ANTES de requerir envolverHandle.js. Como
// require.cache se consulta antes de ir a disco, envolverHandle.js recibe nuestro
// `ipcMain` falso sin que su código fuente sepa que está siendo probado.
const test = require('node:test');
const assert = require('node:assert/strict');

const electronPath = require.resolve('electron');
const canalesRegistrados = new Map();
const ipcMainFalso = {
  handle(canal, listener) {
    canalesRegistrados.set(canal, listener);
  }
};
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { ipcMain: ipcMainFalso }
};

const { crearEnvolverHandle } = require('./envolverHandle');
const { setSesionActual, limpiarSesionActual } = require('./sesion');

test('envolverHandle: tras un rechazo, un reintento con el mismo opId vuelve a llamar al handler (no se queda pegado a la promesa rechazada)', async () => {
  setSesionActual({ id: 1, rol: 'Administrador' });
  try {
    const envolverHandle = crearEnvolverHandle({ auditoriaService: { registrar: () => {} } });

    let llamadas = 0;
    const fn = async () => {
      llamadas++;
      if (llamadas === 1) {
        throw new Error('fallo simulado en el primer intento');
      }
      return { success: true, data: { id: 99 } };
    };

    // 'gastos:create' está en CANALES_IDEMPOTENTES, así que se registra bajo el envoltorio
    // que protege contra doble clic / reintento.
    envolverHandle('gastos:create', fn);

    const listener = canalesRegistrados.get('gastos:create');
    assert.ok(listener, 'ipcMain.handle debía capturar el listener para gastos:create');

    // Primer intento: el handler real rechaza.
    await assert.rejects(
      () => listener({}, { opId: 'op-regresion-1', monto: 1000 }),
      /fallo simulado en el primer intento/
    );
    assert.equal(llamadas, 1, 'el handler real debe haberse llamado una vez tras el primer intento');

    // Segundo intento con el MISMO opId: antes del fix del try/finally, operacionesEnCurso
    // nunca se limpiaba tras un rechazo, así que esta segunda llamada devolvía la misma
    // promesa ya rechazada (o quedaba bloqueada) en vez de reintentar -- justo el caso real
    // de un doble clic sobre un botón que falló la primera vez.
    const resultado = await listener({}, { opId: 'op-regresion-1', monto: 1000 });

    assert.equal(llamadas, 2, 'el reintento con el mismo opId debe volver a invocar al handler real');
    assert.deepEqual(resultado, { success: true, data: { id: 99 } });
  } finally {
    limpiarSesionActual();
  }
});
