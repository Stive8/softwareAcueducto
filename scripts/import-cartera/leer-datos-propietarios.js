// Lee DatosPropietariosCuentas.xlsx (columna NOMBRE, limpia) para los propietarios de cuentas
// nuevas. NO se usa para las 292 cuentas que ya existen en la app -- esas reutilizan su
// propietario vigente tal cual está. Ver REGLAS_CARGA_INICIAL.md sección 10 y el hallazgo de
// que el campo `nombre` del JSON es la etiqueta cruda de CARTERA (sucia, código pegado al final
// en 8 de las 14 cuentas nuevas).
const ExcelJS = require('exceljs');
const { normalizarCodigo } = require('./normalizar');

async function leerDatosPropietarios(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  const porCodigo = new Map();
  ws.eachRow((row, i) => {
    if (i === 1) return; // encabezado
    const cod = row.getCell(1).value;
    if (!cod) return;
    const nombreCell = row.getCell(2).value;
    const correoCell = row.getCell(5).value;
    const cedulaCell = row.getCell(3).value;
    const telefonoCell = row.getCell(4).value;
    porCodigo.set(normalizarCodigo(cod), {
      nombre: nombreCell ? String(nombreCell).trim().replace(/\s+/g, ' ') : null,
      // String() explícito: better-sqlite3 liga un Number JS a una columna TEXT como REAL y
      // SQLite lo formatea con ".0" al final (reproducido: bind(3227600287) -> "3227600287.0").
      cedula: (cedulaCell !== null && cedulaCell !== undefined) ? String(cedulaCell) : null,
      telefono: (telefonoCell !== null && telefonoCell !== undefined) ? String(telefonoCell) : null,
      correo: (correoCell && correoCell.text) ? correoCell.text : (correoCell || null)
    });
  });
  return porCodigo;
}

module.exports = { leerDatosPropietarios };
