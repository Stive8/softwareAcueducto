// Comparaciones de dinero. Los importes históricos vienen fraccionarios porque el importador
// repartió el total de un recibo entre N meses (hay valores como 1439.252336448598), así que
// nunca se comparan dos importes con === .
const EPSILON = 0.01;

function redondear(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function sonIguales(a, b) {
  return Math.abs(Number(a) - Number(b)) < EPSILON;
}

function esMayor(a, b) {
  return Number(a) - Number(b) >= EPSILON;
}

module.exports = { EPSILON, redondear, sonIguales, esMayor };
