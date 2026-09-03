const { getSesionActual } = require('./sesion');
const { dialog } = require('electron');
const fs = require('fs');
const path = require('path');

function registrarGastosHandlers({ envolverHandle, gastoService, comprobanteCloudService, getMainWindow }) {
  envolverHandle('gastos:getAll', async (event, params) => {
    try {
      return { success: true, data: gastoService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:getStats', async (event, params) => {
    try {
      return { success: true, data: gastoService.getStats(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:getById', async (event, id) => {
    try {
      const gasto = gastoService.getById(id);
      if (!gasto) {
        return { success: false, error: 'Gasto no encontrado' };
      }
      return { success: true, data: gasto };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:getTiposGasto', async () => {
    try {
      return { success: true, data: gastoService.getTiposGasto() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:create', async (event, gastoData) => {
    try {
      const id = gastoService.create(gastoData, getSesionActual().id);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:anular', async (event, id, motivo) => {
    try {
      gastoService.anular(id, motivo, getSesionActual().id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:corregirMetodoPago', async (event, id, nuevoMetodoPago, motivo) => {
    try {
      gastoService.corregirMetodoPago(id, nuevoMetodoPago, motivo, getSesionActual().id);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:actualizarDatos', async (event, payload) => {
    try {
      const { id, concepto, observaciones } = payload;
      gastoService.actualizarDatos(id, { concepto, observaciones });
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Soportes documentales de gastos (facturas, recibos, imágenes), guardados en Google Drive —
  // ver ComprobanteCloudService. El archivo nunca se queda en disco local de forma permanente.
  envolverHandle('gastos:adjuntarSoporte', async (event, gastoId, tipoSoporte) => {
    try {
      if (!comprobanteCloudService.estaConectado()) {
        return { success: false, error: 'No hay una cuenta de Google conectada. Ve a Configuración → Respaldo en la Nube para conectarla.' };
      }

      const { canceled, filePaths } = await dialog.showOpenDialog(getMainWindow(), {
        title: 'Seleccionar soporte',
        filters: [{ name: 'PDF o imagen', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }],
        properties: ['openFile']
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const filePath = filePaths[0];
      const extension = path.extname(filePath).toLowerCase().replace('.', '');
      if (!['pdf', 'png', 'jpg', 'jpeg'].includes(extension)) {
        return { success: false, error: 'El archivo debe ser PDF, PNG o JPG.' };
      }

      const tamanioMb = fs.statSync(filePath).size / (1024 * 1024);
      if (tamanioMb > 15) {
        return { success: false, error: 'El archivo supera el límite de 15 MB.' };
      }

      const nombreArchivo = path.basename(filePath);
      const subida = await comprobanteCloudService.subirSoporte(filePath, nombreArchivo);

      gastoService.adjuntarSoporte(gastoId, { tipoSoporte, driveFileId: subida.id, nombreArchivo: subida.name });
      return { success: true, data: { id: gastoId } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:getSoportes', async (event, gastoId) => {
    try {
      return { success: true, data: gastoService.getSoportes(gastoId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:getSoporte', async (event, gastoId, soporteId) => {
    try {
      const soporte = gastoService.getSoporte(soporteId);
      if (!soporte) return { success: false, error: 'Soporte no encontrado' };

      await comprobanteCloudService.descargarYAbrir(soporte.drive_file_id, soporte.nombre_archivo);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registrarGastosHandlers };
