const { getSesionActual } = require('./sesion');
const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');

function registrarRecibosHandlers({ envolverHandle, reciboService, getMainWindow }) {
  envolverHandle('recibos:getAll', async (event, params) => {
    try {
      return { success: true, data: reciboService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:getById', async (event, id) => {
    try {
      const recibo = reciboService.getById(id);
      if (!recibo) {
        return { success: false, error: 'Recibo no encontrado' };
      }
      return { success: true, data: recibo };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:anular', async (event, id, motivo) => {
    try {
      reciboService.anular(id, motivo, getSesionActual().id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:corregirMetodoPago', async (event, id, nuevoMetodoPago, motivo) => {
    try {
      reciboService.corregirMetodoPago(id, nuevoMetodoPago, motivo, getSesionActual().id);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:getConsecutivo', async () => {
    try {
      return { success: true, data: reciboService.getConsecutivoRecibo() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:registrarAnuladoFisico', async (event, datos) => {
    try {
      return { success: true, data: reciboService.registrarAnuladoFisico(datos) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:getAnuladosFisicos', async () => {
    try {
      return { success: true, data: reciboService.getAnuladosFisicos() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Chromium exige alto Y ancho fijos en pageSize (no hay "alto automático" como en una impresora
  // térmica física de papel continuo). Como el recibo térmico varía de largo según cuántos
  // conceptos tenga, se mide el contenido ya cargado en la ventana oculta y se calcula el alto en
  // micrones a partir de eso, en vez de asumir un tamaño fijo que podría cortar el recibo o
  // desperdiciar papel.
  const ANCHO_TERMICO_MICRONES = 80000; // 80mm
  const MARGEN_ALTURA_TERMICO_MICRONES = 10000; // 10mm de margen de seguridad
  const MICRONES_POR_PX = 25400 / 96; // 1 CSS px = 1/96 pulgada = 25400/96 micrones
  const MICRONES_POR_PULGADA = 25400;

  async function calcularPageSizeTermico(ventana) {
    const alturaPx = await ventana.webContents.executeJavaScript('document.body.scrollHeight');
    const alturaMicrones = Math.round(alturaPx * MICRONES_POR_PX) + MARGEN_ALTURA_TERMICO_MICRONES;
    return { width: ANCHO_TERMICO_MICRONES, height: alturaMicrones };
  }

  // webContents.print() y webContents.printToPDF() usan unidades DISTINTAS para pageSize pese a
  // aceptar la misma forma { width, height }: print() espera micrones (mismo pipeline nativo de
  // impresión de Chromium), printToPDF() espera PULGADAS (documentado explícitamente en los docs
  // de Electron). Pasar micrones a printToPDF sin convertir generaba una página de ~2 km de ancho
  // (80000 interpretado como pulgadas), con el recibo real reducido a un punto en la esquina.
  function pageSizeMicronesAPulgadas(pageSizeMicrones) {
    return {
      width: pageSizeMicrones.width / MICRONES_POR_PULGADA,
      height: pageSizeMicrones.height / MICRONES_POR_PULGADA
    };
  }

  envolverHandle('recibos:imprimir', async (event, id, formato) => {
    let ventanaImpresion;
    try {
      const formatoEfectivo = reciboService.resolverFormato(formato);
      const html = reciboService.generarHTML(id, formatoEfectivo);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const opcionesImpresion = { silent: false };
      if (formatoEfectivo === 'termico_80mm') {
        opcionesImpresion.pageSize = await calcularPageSizeTermico(ventanaImpresion);
        opcionesImpresion.margins = { marginType: 'none' };
      }

      return await new Promise((resolve) => {
        ventanaImpresion.webContents.print(opcionesImpresion, (success, errorType) => {
          ventanaImpresion.close();
          // El diálogo nativo de impresión deja a veces el foco de teclado sin volver
          // correctamente a la ventana principal; se restaura explícitamente.
          if (getMainWindow()) getMainWindow().focus();
          if (success) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: errorType || 'No se pudo imprimir el recibo' });
          }
        });
      });
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:exportarPDF', async (event, id, formato) => {
    let ventanaImpresion;
    try {
      const recibo = reciboService.getById(id);
      if (!recibo) {
        return { success: false, error: 'Recibo no encontrado' };
      }

      const { canceled, filePath } = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Guardar Recibo como PDF',
        defaultPath: `Recibo_${recibo.numero_recibo}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const formatoEfectivo = reciboService.resolverFormato(formato);
      const html = reciboService.generarHTML(id, formatoEfectivo);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const opcionesPDF = {};
      if (formatoEfectivo === 'termico_80mm') {
        const pageSizeMicrones = await calcularPageSizeTermico(ventanaImpresion);
        opcionesPDF.pageSize = pageSizeMicronesAPulgadas(pageSizeMicrones);
        // printToPDF no tiene marginType (a diferencia de print()): solo acepta top/bottom/left/
        // right en pulgadas, por eso van en 0 explícitos en vez de 'none'.
        opcionesPDF.margins = { top: 0, bottom: 0, left: 0, right: 0 };
      }

      const pdfBuffer = await ventanaImpresion.webContents.printToPDF(opcionesPDF);
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

module.exports = { registrarRecibosHandlers };
