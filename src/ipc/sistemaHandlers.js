const { shell } = require('electron');

function registrarSistemaHandlers({ envolverHandle, devToolsService }) {
  // Herramientas de prueba (solo datos de ejemplo, nunca se ejecutan automáticamente)
  envolverHandle('devtools:tieneDatosOperativos', async () => {
    try {
      return { success: true, data: devToolsService.tieneDatosOperativos() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Utilidades generales de sistema
  envolverHandle('sistema:abrirEnlaceExterno', async (event, url) => {
    try {
      // Solo se permite https: evita que este canal genérico se use para abrir esquemas
      // arbitrarios (file:, javascript:, etc.) si algún día recibe una URL no controlada.
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
        throw new Error('Enlace externo inválido');
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registrarSistemaHandlers };
