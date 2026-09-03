const { getSesionActual } = require('./sesion');
const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');

function registrarPagosHandlers({ envolverHandle, pagoService, cuentaService, getMainWindow }) {
  envolverHandle('pagos:getCuentasConEstado', async (event, params) => {
    try {
      return { success: true, data: pagoService.getCuentasConEstado(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:getEstadoCuenta', async (event, cuentaId) => {
    try {
      return { success: true, data: pagoService.getEstadoCuenta(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:simularPago', async (event, cuentaId, anioInicio, mesInicio, cantidadMeses, usarSaldoAFavor) => {
    try {
      return { success: true, data: pagoService.simularPago(cuentaId, anioInicio, mesInicio, cantidadMeses, usarSaldoAFavor) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:registrarPagoSostenimiento', async (event, payload) => {
    try {
      return { success: true, data: pagoService.registrarPagoSostenimiento(payload, getSesionActual().id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:registrarAbonoDeudaAnterior', async (event, payload) => {
    try {
      return { success: true, data: pagoService.registrarAbonoDeudaAnterior(payload, getSesionActual().id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:getHistorialPagos', async (event, cuentaId) => {
    try {
      return { success: true, data: pagoService.getHistorialPagos(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:imprimirEstadoCuenta', async (event, cuentaId) => {
    let ventanaImpresion;
    try {
      const html = pagoService.generarHTMLEstadoCuenta(cuentaId);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      return await new Promise((resolve) => {
        ventanaImpresion.webContents.print({ silent: false }, (success, errorType) => {
          ventanaImpresion.close();
          if (getMainWindow()) getMainWindow().focus();
          if (success) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: errorType || 'No se pudo imprimir el estado de cuenta' });
          }
        });
      });
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:exportarEstadoCuentaPDF', async (event, cuentaId) => {
    let ventanaImpresion;
    try {
      const cuenta = cuentaService.getById(cuentaId);
      if (!cuenta) {
        return { success: false, error: 'Cuenta no encontrada' };
      }

      const { canceled, filePath } = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Guardar Estado de Cuenta como PDF',
        defaultPath: `Estado_Cuenta_${cuenta.codigo}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const html = pagoService.generarHTMLEstadoCuenta(cuentaId);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const pdfBuffer = await ventanaImpresion.webContents.printToPDF({});
      fs.writeFileSync(filePath, pdfBuffer);
      ventanaImpresion.close();
      if (getMainWindow()) getMainWindow().focus();
      return { success: true, filePath };
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registrarPagosHandlers };
