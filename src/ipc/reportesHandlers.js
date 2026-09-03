const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const { getSesionActual } = require('./sesion');

function registrarReportesHandlers({ envolverHandle, reporteService, excelExportService, plantillaReporteService, getMainWindow }) {
  // Reportes
  // Lectura genérica para mostrar el listado en pantalla antes de exportar (botón "Buscar"),
  // reutilizable por cualquier reporte que en el futuro quiera el mismo patrón de previsualización.
  envolverHandle('reportes:getDatos', async (event, tipoReporte, params) => {
    try {
      return { success: true, data: reporteService.getReporte(tipoReporte, params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('reportes:generarPDF', async (event, tipoReporte, params) => {
    let ventanaImpresion;
    try {
      const reporte = reporteService.getReporte(tipoReporte, params);
      const orientacion = plantillaReporteService.decidirOrientacion(reporte);
      const config = plantillaReporteService.obtenerConfiguracionInstitucional();
      const html = plantillaReporteService.construirHTML(reporte, config, getSesionActual().nombreCompleto);

      const { canceled, filePath } = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Guardar Reporte como PDF',
        defaultPath: `${tipoReporte}_${new Date().toISOString().split('T')[0]}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const pdfBuffer = await ventanaImpresion.webContents.printToPDF({
        landscape: orientacion === 'horizontal',
        displayHeaderFooter: true,
        headerTemplate: plantillaReporteService.construirHeaderTemplate(config),
        footerTemplate: plantillaReporteService.construirFooterTemplate(getSesionActual().nombreCompleto),
        // Suficiente para que el header/footer compactos no se corten (el área que reserva
        // Electron por defecto es muy pequeña para contenido propio).
        margins: { top: 0.6, bottom: 0.6, left: 0.4, right: 0.4 }
      });
      fs.writeFileSync(filePath, pdfBuffer);
      ventanaImpresion.close();
      if (getMainWindow()) getMainWindow().focus();

      return { success: true, filePath };
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  // Vista previa: el MISMO HTML que produce el PDF (vía PlantillaReporteService), para que lo que
  // se ve en pantalla sea literalmente el mismo documento. El header/footerTemplate de paginación
  // repetida por página no aplica aquí (es exclusivo de printToPDF, ver PlantillaReporteService).
  envolverHandle('reportes:getVistaPreviaHTML', async (event, tipoReporte, params) => {
    try {
      const reporte = reporteService.getReporte(tipoReporte, params);
      const config = plantillaReporteService.obtenerConfiguracionInstitucional();
      const html = plantillaReporteService.construirHTML(reporte, config, getSesionActual().nombreCompleto);
      return { success: true, data: html };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('reportes:generarExcel', async (event, tipoReporte, params) => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Guardar Reporte como Excel',
        defaultPath: `${tipoReporte}_${new Date().toISOString().split('T')[0]}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const buffer = await excelExportService.generarExcel(tipoReporte, params);
      fs.writeFileSync(filePath, buffer);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registrarReportesHandlers };
