// scripts/import-gastos/config-hojas.js
// Mapeo de columnas por hoja del archivo "Gastos Totales.xlsx". Los índices son 0-based sobre
// el array de valores de cada fila (ver leer-excel.js). Difieren entre hojas porque el archivo
// se llevó a mano durante años: 2022 no tiene columna de identificación (su 3a columna es
// CANTIDAD), 2023 arrastra una tabla de conciliación en columnas 6-13 que se ignora leyendo
// solo 0-4, y todas las hojas traen filas de título/total que se excluyen en leer-excel.js.
const CONFIG_HOJAS = {
  '2026': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 } },
  '2025': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 } },
  '2024': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 } },
  '2023': {
    headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 },
    // La sección "RETIROS DE LA CUENTA" al final no son gastos individuales sino un resumen
    // aparte: esa fila y todas las siguientes se descartan como bloque.
    truncarTodoDespuesDe: { col: 'nombre', patron: /RETIROS DE LA CUENTA/i },
  },
  '2022': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: null, concepto: 3, valor: 4 } },
};

// De la más nueva (más limpia) a la más vieja: se valida el proceso completo en 2026 antes de
// arriesgar las hojas sucias, y para cuando se llega a 2022 (sin IDs) el catálogo de terceros
// ya está poblado por los años posteriores, habilitando el match por nombre.
const ORDEN_PROCESAMIENTO = ['2026', '2025', '2024', '2023', '2022'];

module.exports = { CONFIG_HOJAS, ORDEN_PROCESAMIENTO };
