// scripts/import-cartera/categorizar.js
// La categoría se deriva de la MENSUALIDAD que el Excel de cartera ya cobra, nunca del TIPO
// relevado en Datos.xlsx (spec §10.3, §11.1): la carga inicial reproduce lo que la asociación
// viene cobrando; las ~44 discrepancias entre TIPO y mensualidad se reportan para que el
// usuario las corrija a mano con CarteraService.recategorizar, con la fecha de vigencia real.
//
// $20.000 es ambiguo entre eras: es la tarifa 2024+ de 'Tienda' Y la tarifa 2022-2023 de
// 'Finca para alquiler' (ver TARIFAS en aplicar-base.js). Por eso hay DOS mapas, uno por
// columna del Excel, y categoriaPorMensualidad exige indicar cuál.
const MAPA_VIEJA = {
  5000: 'Finca',
  8000: 'Finca con piscina',
  12000: 'Tienda',
  20000: 'Finca para alquiler'
};

const MAPA_2024 = {
  10000: 'Finca',
  16000: 'Finca con piscina',
  20000: 'Tienda',
  50000: 'Finca para alquiler'
};

// era: 'vieja' (tarifa 2022-2023, columna mensualidadVieja) | '2024' (columna mensualidad2024)
function categoriaPorMensualidad(mensualidad, era) {
  const mapa = era === '2024' ? MAPA_2024 : MAPA_VIEJA;
  return mapa[mensualidad] ?? null;
}

module.exports = { categoriaPorMensualidad };
