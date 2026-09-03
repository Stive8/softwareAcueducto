const { getSesionActual } = require('./sesion');
const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');

function registrarAsientosHandlers({ envolverHandle, asientoContableService, getMainWindow }) {
  // Asientos contables (doble partida). La generación automática ocurre dentro de los servicios
  // de gastos/pagos/caja; aquí solo se exponen consulta, el asiento manual (ajustes) y reversión.
  envolverHandle('asientos:getAll', async (event, params) => {
    try {
      return { success: true, data: asientoContableService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:getById', async (event, id) => {
    try {
      const asiento = asientoContableService.getById(id);
      if (!asiento) return { success: false, error: 'Asiento no encontrado' };
      return { success: true, data: asiento };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:crearManual', async (event, datos) => {
    try {
      const id = asientoContableService.crearManual({ ...datos, usuarioId: getSesionActual().id });
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:revertir', async (event, id, motivo) => {
    try {
      const reversionId = asientoContableService.revertirManual(id, motivo, getSesionActual().id);
      return { success: true, data: { id: reversionId } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:getLibroMayor', async (event, cuentaContableId, fechaDesde, fechaHasta) => {
    try {
      return { success: true, data: asientoContableService.getLibroMayor(cuentaContableId, fechaDesde, fechaHasta) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:getBalancePrueba', async (event, fechaDesde, fechaHasta) => {
    try {
      return { success: true, data: asientoContableService.getBalancePrueba(fechaDesde, fechaHasta) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:getConciliacionCajaBanco', async () => {
    try {
      return { success: true, data: asientoContableService.verificarConciliacionCajaBanco() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:imprimir', async (event, id) => {
    let ventanaImpresion;
    try {
      const html = asientoContableService.generarHTML(id);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      return await new Promise((resolve) => {
        ventanaImpresion.webContents.print({ silent: false }, (success, errorType) => {
          ventanaImpresion.close();
          if (getMainWindow()) getMainWindow().focus();
          if (success) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: errorType || 'No se pudo imprimir el registro contable' });
          }
        });
      });
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:exportarPDF', async (event, id) => {
    let ventanaImpresion;
    try {
      const asiento = asientoContableService.getById(id);
      if (!asiento) {
        return { success: false, error: 'Asiento no encontrado' };
      }

      const { canceled, filePath } = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Guardar Registro Contable como PDF',
        defaultPath: `RegistroContable_${asiento.numero}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const html = asientoContableService.generarHTML(id);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const pdfBuffer = await ventanaImpresion.webContents.printToPDF({});
      fs.writeFileSync(filePath, pdfBuffer);
      ventanaImpresion.close();

      return { success: true, filePath };
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registrarAsientosHandlers };
