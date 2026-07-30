// scripts/import-cartera/codigos.js
// Conciliación de códigos entre los Excel y la base (spec §10.11). Se verificaron los 22
// códigos que aparecían en algún Excel y no en la base bajo el mismo código normalizado:
//  - 19 eran solo desajustes de formato (guiones/ceros), ya resueltos por normalizarCodigo.
//  - C021 falta de verdad: se crea.
//  - R0081 es la MISMA cuenta que S058 (mismo teléfono en Datos.xlsx, mismo pago de $500.000
//    del 2026-01-31 ya registrado bajo S058): se mapea, nunca se crea.
//  - S03321 es ambiguo (¿punto aparte de Orfilia Marín Herrera, o co-propietaria de S022?):
//    queda pendiente de decisión del usuario, no se crea.
function normalizarCodigo(codigo) {
  return String(codigo).trim().toUpperCase().replace(/[\s-]/g, '');
}

const EQUIVALENCIAS = new Map([
  ['R0081', 'S058']
]);

const HUERFANO_A_CREAR = {
  codigo: 'C021',
  nombre: 'CASTRO DIEGO',
  categoriaNombre: 'Finca',
  motivoSuspension: 'no encontrado'
};

const CODIGOS_PENDIENTES = ['S03321'];

// codigosEnBase: Set de códigos YA normalizados (normalizarCodigo aplicado) existentes en `cuentas`.
function resolverCodigo(codigoExcel, codigosEnBase) {
  const norm = normalizarCodigo(codigoExcel);

  if (codigosEnBase.has(norm)) return { codigoBase: norm };
  if (EQUIVALENCIAS.has(norm)) return { codigoBase: EQUIVALENCIAS.get(norm) };
  if (CODIGOS_PENDIENTES.includes(norm)) return { esPendiente: true };
  return { esHuerfano: true, esPendiente: false };
}

module.exports = { normalizarCodigo, EQUIVALENCIAS, HUERFANO_A_CREAR, CODIGOS_PENDIENTES, resolverCodigo };
