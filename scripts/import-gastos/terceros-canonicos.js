// scripts/import-gastos/terceros-canonicos.js
// Reconciliación de terceros duplicados por typo en la identificación (criterio: gana la
// variante más frecuente en el Excel; verificado por conteo). Ver spec, sección
// "Reconciliación de terceros duplicados". Los números aquí son SIN dígito de verificación
// (ya normalizados como los deja clasificar.normalizarIdentificacion).
const ALIAS_A_CANONICO = {
  '93238699': '93328699',   // Vicencio Herrera: cédula transpuesta en la BD (registro de prueba id=2)
  '933228699': '93328699',  // Vicencio Herrera: variante con dígito extra en 2 filas del Excel
  '900531740': '900351740', // INGECOM: NIT alterno (aparece x8) → canónico el mayoritario (x13)
  '142365013': '14236501',  // Ferretería Juanjo: detectado en producción (2026-07-21) al importar
                             // 2025/2024/2023 — 14236501 aparece 2 veces (2024, 2023) vs 1 (2025).
                             // El tercero con 142365013 ya se fusionó a mano en la BD real (id=8→28).
};

function canonicalizarIdentificacion(idNormalizada) {
  if (idNormalizada == null) return idNormalizada;
  return ALIAS_A_CANONICO[idNormalizada] || idNormalizada;
}

// Correcciones a aplicar sobre terceros YA guardados en la BD antes de importar (reconciliar-db.js).
const CORRECCIONES_DB = [
  { de: '93238699', a: '93328699' }, // Vicencio Herrera (tercero id=2)
];

module.exports = { canonicalizarIdentificacion, CORRECCIONES_DB };
