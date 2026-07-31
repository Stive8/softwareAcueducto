// scripts/import-cartera/codigos.js
// Conciliación de códigos entre los Excel y la base (spec §10.11).
//
// CORRECCIÓN 2026-07-31: el spec original afirmaba que 19 de los 22 códigos "huérfanos" eran
// solo desajustes de formato (guiones/ceros) ya resueltos por normalizarCodigo, y que solo
// C021 y S03321 faltaban de verdad. Eso se verificó contra un snapshot equivocado: al correr
// preview.js (dry-run) contra la base real, 11 de esos 22 NO existen bajo ningún código
// normalizado (ni ahora ni en el backup previo a la fusión de cuentas duplicadas del
// 2026-07-21). Se verificó cada uno contra Datos.xlsx (nombre, TIPO, observación) antes de
// agregarlo aquí:
//  - R0081 es la MISMA cuenta que S058 (mismo teléfono en Datos.xlsx, mismo pago de $500.000
//    del 2026-01-31 ya registrado bajo S058): se mapea, nunca se crea.
//  - C021, R002, R0211, R044, R0501, R085, R0971, S009, S025 no tienen ningún registro real
//    conocido (8 de ellos ya traen su propia marca "no existe/suspender/revisar" en la
//    observación de Datos.xlsx): se crean como cuenta nueva, Suspendida.
//  - S03321, R080, R091, S0244 tienen datos propios reales en Datos.xlsx (S0244 incluso trae
//    cédula, teléfono y correo) y ninguna marca de suspensión: son puntos activos que nunca
//    quedaron guardados con este código. Se crean como cuenta nueva, Activa.
function normalizarCodigo(codigo) {
  return String(codigo).trim().toUpperCase().replace(/[\s-]/g, '');
}

const EQUIVALENCIAS = new Map([
  ['R0081', 'S058']
]);

const HUERFANOS_A_CREAR = [
  { codigo: 'C021', nombre: 'CASTRO DIEGO', categoriaNombre: 'Finca', motivoSuspension: 'no encontrado' },
  { codigo: 'S03321', nombre: 'MARIN HERRERA ORFILIA', categoriaNombre: 'Finca', motivoSuspension: null },
  { codigo: 'R002', nombre: 'BONILLA NELSON', categoriaNombre: 'Finca', motivoSuspension: 'no existe' },
  { codigo: 'R0211', nombre: 'DISCOBAR - ADM CHACO', categoriaNombre: 'Tienda', motivoSuspension: 'no existe' },
  { codigo: 'R044', nombre: 'PUNTO DE LA ESCUELA', categoriaNombre: 'Tienda', motivoSuspension: 'revisar / suspendido' },
  { codigo: 'R0501', nombre: 'VELASQUEZ NORA LUCIA', categoriaNombre: 'Finca', motivoSuspension: 'suspender' },
  { codigo: 'R085', nombre: 'RUIZ OLGA', categoriaNombre: 'Finca', motivoSuspension: 'no encontrado' },
  { codigo: 'R0971', nombre: 'GOMEZ GAMBOA JESUS', categoriaNombre: 'Finca', motivoSuspension: 'no encontrado' },
  { codigo: 'S009', nombre: 'DISNEY GUILLERMO', categoriaNombre: 'Finca', motivoSuspension: 'no existe' },
  { codigo: 'S025', nombre: 'CASTAÑO JOSE, PUNTO SIN LEGALIZAR', categoriaNombre: 'Finca', motivoSuspension: 'no existe' },
  { codigo: 'R080', nombre: 'OSPITIA JESUS ANTONIO', categoriaNombre: 'Finca', motivoSuspension: null },
  { codigo: 'R091', nombre: 'POLANIA JOAQUIN', categoriaNombre: 'Finca', motivoSuspension: null },
  { codigo: 'S0244', nombre: 'ZAPATO MACHADO PEDRO NEL', categoriaNombre: 'Finca', motivoSuspension: null }
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
