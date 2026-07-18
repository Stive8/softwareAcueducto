// scripts/import-gastos/leer-excel.js
const ExcelJS = require('exceljs');
const { clasificarFila } = require('./normalizar');

// Extrae el valor "plano" de una celda exceljs (resuelve fórmulas y rich-text a su valor final).
function valorCelda(cell) {
  let v = cell.value;
  if (v && typeof v === 'object' && v.error !== undefined) return { __error: v.error };
  if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
  if (v && typeof v === 'object' && v.text !== undefined) v = v.text;
  return v;
}

function filaComoArray(row, maxCol) {
  const arr = [];
  for (let c = 1; c <= maxCol; c++) arr[c - 1] = valorCelda(row.getCell(c));
  return arr;
}

async function abrirLibro(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return wb;
}

async function leerHoja(filePath, hojaNombre, config) {
  const wb = await abrirLibro(filePath);
  const ws = wb.getWorksheet(hojaNombre);
  if (!ws) throw new Error(`No se encontró la hoja "${hojaNombre}" en ${filePath}`);

  const maxCol = Math.max(config.cols.fecha, config.cols.nombre, config.cols.id ?? 0, config.cols.concepto, config.cols.valor) + 1;
  const filas = [];
  const excluidas = [];

  for (let r = config.headerRow + 1; r <= ws.rowCount; r++) {
    const raw = filaComoArray(ws.getRow(r), maxCol);
    // Celda con error de fórmula en cualquier columna relevante → excluida (no se adivina).
    if (raw.some((v) => v && typeof v === 'object' && v.__error !== undefined)) {
      excluidas.push({ filaExcel: r, motivo: `error de fórmula (${raw.find((v) => v && v.__error).__error})` });
      continue;
    }
    const res = clasificarFila(raw, config, r);
    if (res.tipo === 'truncar') break;
    if (res.tipo === 'excluida') excluidas.push({ filaExcel: r, motivo: res.motivo });
    else filas.push(res.fila);
  }

  return { filas, excluidas };
}

module.exports = { leerHoja, abrirLibro };
