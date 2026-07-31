// scripts/import-cartera/codigos.js
// Conciliación de códigos entre los Excel y la base (spec §10.11). Se verificaron los 22
// códigos que aparecían en algún Excel y no en la base bajo el mismo código normalizado:
//  - 19 eran solo desajustes de formato (guiones/ceros), ya resueltos por normalizarCodigo.
//  - C021 falta de verdad: se crea, Suspendida, motivo "no encontrado".
//  - R0081 es la MISMA cuenta que S058 (mismo teléfono en Datos.xlsx, mismo pago de $500.000
//    del 2026-01-31 ya registrado bajo S058): se mapea, nunca se crea.
//  - S03321 "MARIN HERRERA ORFILIA" tiene fila y teléfono propios en Datos.xlsx, aunque en la
//    base su nombre quedó fundido con el de la propietaria de S022. El usuario decidió
//    (2026-07-30) que es un punto aparte, no la co-propietaria de S022: se crea, Activa.
function normalizarCodigo(codigo) {
  return String(codigo).trim().toUpperCase().replace(/[\s-]/g, '');
}

const EQUIVALENCIAS = new Map([
  ['R0081', 'S058']
]);

const HUERFANOS_A_CREAR = [
  { codigo: 'C021', nombre: 'CASTRO DIEGO', motivoSuspension: 'no encontrado' },
  { codigo: 'S03321', nombre: 'MARIN HERRERA ORFILIA', motivoSuspension: null }
];

const CODIGOS_PENDIENTES = [];

// codigosEnBase: Set de códigos YA normalizados (normalizarCodigo aplicado) existentes en `cuentas`.
function resolverCodigo(codigoExcel, codigosEnBase) {
  const norm = normalizarCodigo(codigoExcel);

  if (codigosEnBase.has(norm)) return { codigoBase: norm };
  if (EQUIVALENCIAS.has(norm)) return { codigoBase: EQUIVALENCIAS.get(norm) };
  if (CODIGOS_PENDIENTES.includes(norm)) return { esPendiente: true };
  return { esHuerfano: true, esPendiente: false };
}

module.exports = { normalizarCodigo, EQUIVALENCIAS, HUERFANOS_A_CREAR, CODIGOS_PENDIENTES, resolverCodigo };
