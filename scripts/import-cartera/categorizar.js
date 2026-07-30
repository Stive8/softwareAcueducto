// scripts/import-cartera/categorizar.js
// La categoría se deriva de la MENSUALIDAD que el Excel de cartera ya cobra, nunca del TIPO
// relevado en Datos.xlsx (spec §10.3, §11.1): la carga inicial reproduce lo que la asociación
// viene cobrando; las ~44 discrepancias entre TIPO y mensualidad se reportan para que el
// usuario las corrija a mano con CarteraService.recategorizar, con la fecha de vigencia real.
const MAPA = {
  5000: 'Finca', 10000: 'Finca',
  8000: 'Finca con piscina', 16000: 'Finca con piscina',
  12000: 'Tienda', 20000: 'Tienda',
  50000: 'Finca para alquiler'
};

function categoriaPorMensualidad(mensualidad) {
  return MAPA[mensualidad] ?? null;
}

module.exports = { categoriaPorMensualidad };
