const ExcelJS = require('exceljs');
const ReporteService = require('./ReporteService');
const PlantillaReporteService = require('./PlantillaReporteService');

const COLOR_ENCABEZADO = 'FF1E40AF';

class ExcelExportService {
  constructor(dbService) {
    this.reporteService = new ReporteService(dbService);
    this.plantillaReporteService = new PlantillaReporteService(dbService);
  }

  async generarExcel(tipoReporte, params = {}) {
    const reporte = this.reporteService.getReporte(tipoReporte, params);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Sistema Administrativo Acueducto Veredal';
    workbook.created = new Date();

    if (reporte.tipo === 'compuesto') {
      // Una hoja por cada parte del informe (cartera, balance, resultados, flujo, auditoría),
      // con el título de la parte como nombre de hoja (Excel exige nombres únicos y cortos).
      const nombresUsados = new Set();
      reporte.partes.forEach(parte => {
        let nombre = parte.titulo.substring(0, 31);
        let sufijo = 2;
        while (nombresUsados.has(nombre)) {
          nombre = `${parte.titulo.substring(0, 28)} ${sufijo}`;
          sufijo++;
        }
        nombresUsados.add(nombre);

        if (parte.tipo === 'resumen') {
          this.construirHojaResumen(workbook, { ...parte, titulo: nombre });
        } else {
          this.construirHojaTabla(workbook, { ...parte, titulo: nombre });
        }
      });
    } else if (reporte.tipo === 'resumen') {
      this.construirHojaResumen(workbook, reporte);
    } else {
      this.construirHojaTabla(workbook, reporte);
    }

    return workbook.xlsx.writeBuffer();
  }

  // Filas institucionales (nombre, NIT/dirección/teléfono, título del reporte, período y filtros
  // usados) antes de la tabla/resumen — para que el archivo conserve contexto por sí solo, sin
  // tener que volver al ERP para saber qué contiene. Una fila por dato, una sola celda (columna A).
  construirEncabezadoInstitucional(sheet, config, documento) {
    sheet.getCell('A1').value = config.nombreAsociacion;
    sheet.getCell('A1').font = { bold: true, size: 13, color: { argb: COLOR_ENCABEZADO } };
    sheet.addRow([]);

    const datosLinea = [
      config.nit && `NIT: ${config.nit}`,
      [config.direccion, config.ciudad].filter(Boolean).join(', '),
      config.telefono && `Tel: ${config.telefono}`,
      config.email
    ].filter(Boolean).join('   |   ');
    if (datosLinea) {
      const filaDatos = sheet.addRow([datosLinea]);
      filaDatos.getCell(1).font = { size: 9, color: { argb: 'FF64748B' } };
    }

    const filaTitulo = sheet.addRow([documento.titulo]);
    filaTitulo.getCell(1).font = { bold: true, size: 11 };

    const ahora = new Date();
    let lineaInfo = `Generado el ${ahora.toLocaleDateString('es-CO')} ${ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;
    if (documento.periodo?.tipo === 'rango' && (documento.periodo.fechaDesde || documento.periodo.fechaHasta)) {
      lineaInfo = `Período: ${documento.periodo.fechaDesde || 'inicio'} a ${documento.periodo.fechaHasta || 'hoy'}   |   ${lineaInfo}`;
    } else if (documento.periodo?.tipo === 'corte') {
      lineaInfo = `Fecha de corte: ${documento.periodo.fecha}   |   ${lineaInfo}`;
    }
    const filaInfo = sheet.addRow([lineaInfo]);
    filaInfo.getCell(1).font = { size: 9, italic: true };

    if (documento.filtros && documento.filtros.length > 0) {
      const filaFiltros = sheet.addRow([`Filtros: ${documento.filtros.map(f => `${f.label}: ${f.valor}`).join('  |  ')}`]);
      filaFiltros.getCell(1).font = { size: 9, italic: true };
    }

    sheet.addRow([]);
  }

  _pageSetup(documento) {
    return {
      orientation: this.plantillaReporteService.decidirOrientacion(documento) === 'horizontal' ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    };
  }

  construirHojaTabla(workbook, reporte) {
    const sheet = workbook.addWorksheet(reporte.titulo.substring(0, 31));
    const config = this.plantillaReporteService.obtenerConfiguracionInstitucional();
    sheet.pageSetup = this._pageSetup(reporte);

    this.construirEncabezadoInstitucional(sheet, config, reporte);

    // Sin 'header' aquí a propósito: con 'header' ExcelJS escribe automáticamente la fila de
    // encabezados en la fila 1, pisando el encabezado institucional ya agregado arriba. 'key' y
    // 'width' sí se necesitan (los usa addRow con objetos más abajo, y getCell(col.key)).
    sheet.columns = reporte.columnas.map(col => ({
      key: col.key,
      width: Math.max(col.label.length + 4, 18)
    }));

    const headerRow = sheet.addRow(reporte.columnas.map(c => c.label));
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } };
      cell.alignment = { vertical: 'middle' };
    });

    reporte.filas.forEach(fila => {
      const rowData = {};
      reporte.columnas.forEach(col => {
        let valor = fila[col.key];
        if (col.tipo === 'fecha' && valor) valor = new Date(valor);
        rowData[col.key] = valor ?? '';
      });
      const row = sheet.addRow(rowData);

      reporte.columnas.forEach(col => {
        const cell = row.getCell(col.key);
        if (col.tipo === 'moneda') cell.numFmt = '$ #,##0';
        if (col.tipo === 'fecha') cell.numFmt = 'dd/mm/yyyy';
      });
    });

    if (reporte.totales) {
      const totalRowData = {};
      reporte.columnas.forEach((col, i) => {
        if (i === 0) { totalRowData[col.key] = 'TOTAL'; return; }
        totalRowData[col.key] = reporte.totales[col.key] !== undefined ? reporte.totales[col.key] : '';
      });
      const totalRow = sheet.addRow(totalRowData);
      totalRow.eachCell(cell => { cell.font = { bold: true }; });
      reporte.columnas.forEach(col => {
        if (col.tipo === 'moneda') totalRow.getCell(col.key).numFmt = '$ #,##0';
      });
    }
  }

  construirHojaResumen(workbook, reporte) {
    const sheet = workbook.addWorksheet(reporte.titulo.substring(0, 31));
    const config = this.plantillaReporteService.obtenerConfiguracionInstitucional();
    sheet.pageSetup = this._pageSetup(reporte);
    sheet.columns = [{ width: 45 }, { width: 20 }];

    this.construirEncabezadoInstitucional(sheet, config, reporte);

    reporte.secciones.forEach(seccion => {
      const tituloRow = sheet.addRow([seccion.titulo, '']);
      tituloRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      tituloRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } };
      });

      seccion.items.forEach(item => {
        const row = sheet.addRow([item.label, item.valor]);
        if (item.tipo !== 'numero') row.getCell(2).numFmt = '$ #,##0';
      });

      const totalRow = sheet.addRow([`Total ${seccion.titulo}`, seccion.total]);
      totalRow.font = { bold: true };
      if (seccion.tipoValor !== 'numero') totalRow.getCell(2).numFmt = '$ #,##0';

      sheet.addRow([]);
    });
  }
}

module.exports = ExcelExportService;
