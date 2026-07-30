// Lógica pura de imputación: contra qué cargos se aplica un abono, y hasta qué mes queda
// cubierta una cuenta. Sin I/O y sin estado -- todo entra por parámetro.
//
// Los cuatro modos comparten la misma mecánica (llenar cargos en orden hasta agotar el
// monto); lo único que cambia es QUÉ cargos son candidatos:
//   - MESES_ESPECIFICOS: solo los que el operador eligió. Es el que hace representable el
//     caso real de pagar 2023 completo dejando 2022 descubierto.
//   - ABONO_DEUDA_FIFO: todos, del más antiguo al más nuevo.
//   - ABONO_SALDO_OPACO: los del bucket no exigible (el llamador pasa esos cargos).
//   - ANTICIPO: ninguno; el monto entero queda como saldo a favor.
const { redondear, esMayor } = require('./dinero');
const { codificarPeriodo } = require('./periodos');

const MODOS = {
  MESES_ESPECIFICOS: 'MesesEspecificos',
  ABONO_DEUDA_FIFO: 'AbonoDeudaFIFO',
  ABONO_SALDO_OPACO: 'AbonoSaldoOpaco',
  ANTICIPO: 'Anticipo'
};

// `cargos` llega ordenado del más antiguo al más nuevo (responsabilidad del repositorio).
// Devuelve las imputaciones a crear y cuánto quedó sin imputar (= saldo a favor).
function distribuir({ modo, cargos = [], monto, cargosElegidos = [] }) {
  if (!Object.values(MODOS).includes(modo)) {
    throw new Error(`Modo de imputación inválido: ${modo}`);
  }
  if (!(Number(monto) > 0)) {
    throw new Error('El monto a imputar debe ser mayor a cero');
  }

  if (modo === MODOS.ANTICIPO) {
    return { imputaciones: [], sobrante: redondear(monto) };
  }

  let candidatos;
  if (modo === MODOS.MESES_ESPECIFICOS) {
    const elegidos = new Set(cargosElegidos);
    candidatos = cargos.filter(c => elegidos.has(c.id));
  } else {
    candidatos = cargos;
  }

  const imputaciones = [];
  let restante = redondear(monto);

  for (const cargo of candidatos) {
    if (!esMayor(restante, 0)) break;
    const pendiente = redondear(cargo.pendiente);
    if (!esMayor(pendiente, 0)) continue;

    const aplicar = redondear(Math.min(restante, pendiente));
    imputaciones.push({ cargoId: cargo.id, monto: aplicar });
    restante = redondear(restante - aplicar);
  }

  return { imputaciones, sobrante: esMayor(restante, 0) ? restante : 0 };
}

// Último mes totalmente cubierto SIN que haya ningún mes descubierto antes. Se detiene en el
// primer hueco: si alguien pagó 2023 pero debe 2022, no está cubierto hasta 2023.
// Esto reemplaza el MAX(mes pagado) del modelo viejo, que declaraba "al día" a quien tenía
// años sin pagar en el medio.
function calcularCubiertoHasta(cargosConCobertura) {
  const ordenados = [...cargosConCobertura]
    .filter(c => c.anio !== null && c.mes !== null)
    .sort((a, b) => codificarPeriodo(a.anio, a.mes) - codificarPeriodo(b.anio, b.mes));

  let ultimo = null;
  for (const cargo of ordenados) {
    const falta = redondear(cargo.monto) - redondear(cargo.cubierto);
    if (esMayor(falta, 0)) break;
    ultimo = { anio: cargo.anio, mes: cargo.mes };
  }
  return ultimo;
}

module.exports = { MODOS, distribuir, calcularCubiertoHasta };
