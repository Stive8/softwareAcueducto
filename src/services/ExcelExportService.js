const ExcelJS = require('exceljs');
const ReporteService = require('./ReporteService');

const COLOR_ENCABEZADO = 'FF1E40AF';

class ExcelExportService {
  constructor(dbService) {
    this.reporteService = new ReporteService(dbService);
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

  construirHojaTabla(workbook, reporte) {
    const sheet = workbook.addWorksheet(reporte.titulo.substring(0, 31));

    sheet.columns = reporte.columnas.map(col => ({
      header: col.label,
      key: col.key,
      width: Math.max(col.label.length + 4, 18)
    }));

    const headerRow = sheet.getRow(1);
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
    sheet.columns = [{ width: 45 }, { width: 20 }];

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
