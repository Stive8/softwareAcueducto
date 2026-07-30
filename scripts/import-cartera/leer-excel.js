// scripts/import-cartera/leer-excel.js
const ExcelJS = require('exceljs');

// Extrae el valor "plano" de una celda exceljs. Los tres Excel de cartera fueron llevados a
// mano por años: traen fórmulas con error, fórmulas cuyo resultado nunca se guardó (el caso
// central del VLOOKUP de "SALDO PAGOS 31/12/2021", ver leer-cartera.js), y texto en rich-text.
// Ninguno de los tres se adivina: error → sentinel {__error}, sin resultado → null.
function valorCelda(cell) {
  let v = cell.value;
  if (v == null) return v;
  if (typeof v === 'object') {
    if (v.error !== undefined) return { __error: v.error };
    if (v.result !== undefined) {
      if (v.result && typeof v.result === 'object' && v.result.error !== undefined) {
        return { __error: v.result.error };
      }
      return v.result;
    }
    if (v.formula !== undefined || v.sharedFormula !== undefined) return null;   // fórmula sin resultado guardado
    if (Array.isArray(v.richText)) return v.richText.map((rt) => rt.text).join('');
    if (v.text !== undefined) return v.text;   // hyperlink u otro con .text
  }
  return v;
}

async function abrirLibro(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return wb;
}

function hoja(wb, nombre) {
  const ws = wb.getWorksheet(nombre);
  if (!ws) throw new Error(`No se encontró la hoja "${nombre}"`);
  return ws;
}

module.exports = { valorCelda, abrirLibro, hoja };
