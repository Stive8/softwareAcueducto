// scripts/import-gastos/normalizar.js
// Normaliza los valores crudos de una fila del Excel a un formato uniforme y decide si la fila
// es un gasto real, una fila a excluir (título/total/sin datos) o el corte de una sección.

function normalizarTexto(s) {
  if (s == null) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}

// Devuelve 'YYYY-MM-DD' o null. Las celdas de fecha de exceljs llegan como Date a medianoche
// UTC; a medianoche UTC, toISOString().slice(0,10) no corre el día. Obligatorio para no romper
// PeriodoContableService.validarFechaPermitida (hace new Date(fecha+'T00:00:00')).
function normalizarFecha(v) {
  if (v == null || v === '') return null;
  let d;
  if (v instanceof Date) d = v;
  else if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    d = new Date(v);
  } else return null;
  if (isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function clasificarFila(rawRow, config, filaExcel) {
  const { cols, truncarTodoDespuesDe } = config;
  const nombre = normalizarTexto(rawRow[cols.nombre]);
  const conceptoRaw = rawRow[cols.concepto];
  const valorRaw = rawRow[cols.valor];

  // Corte de sección (ej. "RETIROS DE LA CUENTA" en 2023): esta fila y todas las siguientes fuera.
  if (truncarTodoDespuesDe) {
    const campo = normalizarTexto(rawRow[cols[truncarTodoDespuesDe.col]]);
    if (truncarTodoDespuesDe.patron.test(campo)) return { tipo: 'truncar' };
  }

  const concepto = normalizarTexto(conceptoRaw);
  if (!concepto) return { tipo: 'excluida', motivo: 'sin concepto' };
  if (/^TOTAL/i.test(concepto)) return { tipo: 'excluida', motivo: 'fila de total' };

  if (valorRaw == null || valorRaw === '' || typeof valorRaw !== 'number' || !(valorRaw > 0)) {
    return { tipo: 'excluida', motivo: 'valor vacío o no numérico' };
  }

  const fecha = normalizarFecha(rawRow[cols.fecha]);
  if (!fecha) return { tipo: 'excluida', motivo: 'fecha inválida' };

  // 2022 no tiene columna de identificación (cols.id === null) → identificacion null.
  let identificacion = null;
  if (cols.id != null) {
    const idRaw = rawRow[cols.id];
    identificacion = idRaw == null || idRaw === '' ? null : String(idRaw).trim();
  }

  return { tipo: 'dato', fila: { filaExcel, fecha, nombre, identificacion, concepto, valor: valorRaw } };
}

module.exports = { normalizarFecha, normalizarTexto, clasificarFila };
