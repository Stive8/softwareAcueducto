// Helpers puros de fecha y período. Sin I/O, sin estado.
//
// Ninguno usa `new Date(fechaString)` sobre una fecha sin hora: un string de solo fecha se
// interpreta como medianoche UTC, y en una zona negativa (Colombia, UTC-5) eso retrocede el
// día -- y si era el día 1, retrocede el mes entero.

// Codifica un período como entero comparable y restable: la diferencia entre dos códigos es
// la cantidad de meses entre ellos.
function codificarPeriodo(anio, mes) {
  return anio * 12 + (mes - 1);
}

function decodificarPeriodo(codigo) {
  return { anio: Math.floor(codigo / 12), mes: (codigo % 12) + 1 };
}

function anioMesDeFecha(fecha) {
  const [anio, mes] = String(fecha).split(' ')[0].split('-').map(Number);
  return { anio, mes };
}

function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

function primerDiaDelMes(anio, mes) {
  return `${anio}-${dosDigitos(mes)}-01`;
}

// Usa Date solo con argumentos numéricos (no parsea strings), que es seguro: construye la
// fecha en hora local. El día 0 del mes siguiente es el último del mes pedido.
function ultimoDiaDelMes(anio, mes) {
  const dia = new Date(anio, mes, 0).getDate();
  return `${anio}-${dosDigitos(mes)}-${dosDigitos(dia)}`;
}

function diaAnterior(fecha) {
  const [anio, mes, dia] = String(fecha).split(' ')[0].split('-').map(Number);
  const d = new Date(anio, mes - 1, dia - 1);
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
}

// Lista los meses entre dos códigos, ambos inclusive. Rango invertido devuelve vacío.
function rangoDeMeses(desdeCod, hastaCod) {
  const meses = [];
  for (let c = desdeCod; c <= hastaCod; c++) {
    meses.push({ ...decodificarPeriodo(c), codigo: c });
  }
  return meses;
}

module.exports = {
  codificarPeriodo, decodificarPeriodo, anioMesDeFecha,
  primerDiaDelMes, ultimoDiaDelMes, diaAnterior, rangoDeMeses
};
