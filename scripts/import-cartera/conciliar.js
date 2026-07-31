// scripts/import-cartera/conciliar.js
const CarteraService = require('../../src/services/CarteraService');

const TOLERANCIA = 1;

// Compara el saldo de referencia del Excel (deuda exigible + saldo opaco al 31/12 más reciente
// que el Excel tenga cerrado) contra lo que el motor calcula hoy. Es el criterio de aceptación
// de toda la migración (spec §10.10): si esto no cuadra, no se considera terminada la carga.
function conciliar({ plan, dbService }) {
  const carteraService = new CarteraService(dbService);
  const difieren = [];
  let comparadas = 0, coinciden = 0;

  for (const cuenta of plan.cuentas) {
    if (cuenta.saldoReferencia2025 === null || cuenta.saldoReferencia2025 === undefined) continue;
    comparadas++;

    const estado = carteraService.getEstadoCartera(cuenta.cuentaId);
    const delta = Math.round((estado.totalReferencia - cuenta.saldoReferencia2025) * 100) / 100;

    if (Math.abs(delta) <= TOLERANCIA) {
      coinciden++;
    } else {
      difieren.push({ codigo: cuenta.codigo, esperado: cuenta.saldoReferencia2025, calculado: estado.totalReferencia, delta });
    }
  }

  return { comparadas, coinciden, difieren };
}

module.exports = { conciliar };
