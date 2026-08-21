// Lectura de C:\Users\Brayhan\Desktop\DatosPropietariosCuentas.xlsx y emparejamiento de su
// columna COD contra la tabla `cuentas`. Compartido entre los distintos scripts de carga
// (coordenadas, datos de contacto) para que la resolución de cuentas sea idéntica en todos.
const ExcelJS = require('exceljs');

const EXCEL_PATH = 'C:/Users/Brayhan/Desktop/DatosPropietariosCuentas.xlsx';

// Pares de códigos que normalizan igual (mismo código sin guiones) pero son cuentas reales
// distintas en la base (confirmado 2026-08-21: en los 11 casos, la variante con guion está
// Inactivo y sin propietario asignado; la variante sin guion está Activo). Se resuelve
// prefiriendo siempre la cuenta Activo.
const PARES_AMBIGUOS = [
  ['S006-1', 'S0061'], ['R059-1', 'R0591'], ['S033-7', 'S0337'], ['S0338', 'S033-8'],
  ['S022-1', 'S0221'], ['S0161', 'S016-1'], ['S033-2', 'S0332'], ['S039-4', 'S0394'],
  ['S039-2', 'S0392'], ['R007-1', 'R0071'], ['S0333', 'S033-3']
];

// S058 (Excel) no tiene ninguna cuenta con código equivalente en la base: fue fusionada
// hace tiempo con R0081 (recibo movido, cuenta eliminada). Pero las coordenadas de S058 en
// el Excel están a ~900m de las que R0081 ya tiene en la base -- no parecen el mismo punto
// físico. Se deja sin tocar en todos los scripts de carga y se reporta aparte.
const CODIGOS_SIN_TOCAR = ['S058'];

function normalizar(codigo) {
  return codigo.replace(/-/g, '').trim().toUpperCase();
}

function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v.text) return String(v.text).trim();
    if (v.result !== undefined) return String(v.result).trim();
    if (v.richText) return v.richText.map(rt => rt.text).join('').trim();
    return null;
  }
  const s = String(v).trim();
  return s === '' ? null : s;
}

async function leerFilasExcel() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);
  const ws = wb.worksheets[0];

  const headerMap = {};
  ws.getRow(1).eachCell((cell, colNumber) => { headerMap[colNumber] = String(cell.value).trim(); });

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    let hasAny = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headerMap[colNumber];
      const val = cellText(cell);
      obj[key] = val;
      if (val !== null) hasAny = true;
    });
    if (hasAny && obj.COD) rows.push(obj);
  }
  return rows;
}

// listaCuentas: filas de `cuentas` con al menos {id, codigo, estado}.
// Devuelve una función resolverCuenta(codigoExcel) -> { cuenta, motivo }.
function crearResolverCuenta(listaCuentas) {
  const porCodigoExacto = new Map(listaCuentas.map(c => [c.codigo, c]));
  const porNormalizado = new Map();
  for (const c of listaCuentas) {
    const n = normalizar(c.codigo);
    if (!porNormalizado.has(n)) porNormalizado.set(n, []);
    porNormalizado.get(n).push(c);
  }

  const ambiguosSet = new Set(PARES_AMBIGUOS.flat());

  return function resolverCuenta(codigoExcel) {
    if (CODIGOS_SIN_TOCAR.includes(codigoExcel)) return { cuenta: null, motivo: 'sin_tocar' };
    if (porCodigoExacto.has(codigoExcel)) return { cuenta: porCodigoExacto.get(codigoExcel), motivo: 'exacto' };

    const n = normalizar(codigoExcel);
    const candidatas = porNormalizado.get(n) || [];
    if (candidatas.length === 0) return { cuenta: null, motivo: 'no_encontrada' };
    if (candidatas.length === 1) return { cuenta: candidatas[0], motivo: 'normalizado' };

    // Colisión: hay más de una cuenta real con ese código normalizado.
    if (ambiguosSet.has(codigoExcel)) {
      const activo = candidatas.find(c => c.estado === 'Activo');
      if (activo) return { cuenta: activo, motivo: 'colision_resuelta_a_activo' };
    }
    return { cuenta: null, motivo: 'colision_sin_resolver' };
  };
}

module.exports = {
  EXCEL_PATH,
  PARES_AMBIGUOS,
  CODIGOS_SIN_TOCAR,
  normalizar,
  leerFilasExcel,
  crearResolverCuenta
};
