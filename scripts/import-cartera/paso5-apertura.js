// Paso 5 de la carga inicial (sección 14 del MD): apertura opaca al 31/12/2023.
//
// Verificado antes de escribir esto (ver CarteraRepository.getSaldos / getCargosPendientes):
//  - saldoOpaco (bucket 1, "antes de 2024") = SUM(monto) de movimientos exigible=0.
//    AperturaOpaca ya se inserta con exigible=0, así que el bucket 1 sale gratis del motor.
//  - getCargosPendientes filtra `monto > 0`, así que un AperturaOpaca negativo nunca aparece como
//    "cargo pendiente": el FIFO del paso 10 no puede imputarle nada por error.
//
// Cambio de diseño 2026-08-04: los 14 saldos a favor anteriores al corte YA NO se cargan como
// AperturaOpaca negativo. Antes bajaban "deuda anterior al corte" por su cuenta y de forma
// invisible -- exactamente el problema que motivó separar "tener crédito" de "aplicarlo" (ver
// docs/superpowers/specs/... y CarteraService.registrarAbono/redimirCredito). Ahora van a
// cuenta_creditos como 'Abono' sin aplicar, y la cuenta queda con AperturaOpaca en 0 (verificado,
// no "sin dato": si algún día alguien pregunta si esta cuenta tuvo apertura, la fila con monto 0
// ya lo distingue de una cuenta que nunca se investigó).
//
// Es una decisión deliberada: estas 14 aperturas negativas ahora son redimibles contra meses de
// 2024 en adelante, igual que cualquier otro saldo a favor (ver redimirCredito). Antes del corte
// eran saldo opaco -- no cobrable por definición -- pero como crédito SÍ tiene sentido que se
// pueda aplicar a la deuda corriente si el operador decide hacerlo; solo que ya no pasa solo.
//
// Solo se inserta movimiento cuando `apertura_opaca_2023_12_31` es un número (incluido 0): si es
// null ("sin dato"), no se inserta nada -- ni se inventa un cero, ni se distingue de él en el
// saldo (ambos dan lo mismo: 0 al sumar), pero si algún día alguien necesita saber "¿esto se
// verificó en cero o nunca se resolvió?", la ausencia de fila ya lo dice.
const { normalizarCodigo } = require('./normalizar');

const FECHA_APERTURA = '2023-12-31';

function ejecutarPaso5({ dbService, cuentasJson }) {
  const CarteraRepository = require('../../src/repositories/CarteraRepository');
  const db = dbService.getDb();
  const repo = new CarteraRepository(dbService);

  const idPorCodigo = new Map(
    db.prepare('SELECT id, codigo FROM cuentas').all().map(c => [normalizarCodigo(c.codigo), c.id])
  );

  const positivas = [];
  const negativas = [];
  const cero = [];
  const sinDato = [];

  for (const cuenta of cuentasJson) {
    if (cuenta.codigo === 'S0332S0382') continue; // desactivada, no participa

    const cuentaId = idPorCodigo.get(normalizarCodigo(cuenta.codigo));
    if (cuentaId === undefined) throw new Error(`${cuenta.codigo}: no existe en la base -- ¿corrieron los pasos 1-2?`);

    const apertura = cuenta.apertura_opaca_2023_12_31;
    if (apertura === null || apertura === undefined) {
      sinDato.push({ codigo: cuenta.codigo, cuentaId });
      continue;
    }

    if (apertura > 0) {
      repo.crearMovimiento({
        cuentaId, fecha: FECHA_APERTURA, tipo: 'AperturaOpaca', exigible: 0, monto: apertura
      });
    } else if (apertura < 0) {
      // La apertura opaca queda en 0 (verificado): esta cuenta no tiene deuda anterior al
      // corte -- lo que tenía era, en realidad, un saldo a favor.
      repo.crearMovimiento({
        cuentaId, fecha: FECHA_APERTURA, tipo: 'AperturaOpaca', exigible: 0, monto: 0
      });
      repo.crearCredito({
        cuentaId, tipo: 'Abono', monto: -apertura, fecha: FECHA_APERTURA,
        observaciones: 'Apertura opaca negativa al 31/12/2023: saldo a favor anterior al corte, redimible contra deuda de 2024+'
      });
    } else {
      // 0 verificado: se deja constancia igual, a diferencia de "sin dato".
      repo.crearMovimiento({
        cuentaId, fecha: FECHA_APERTURA, tipo: 'AperturaOpaca', exigible: 0, monto: 0
      });
    }

    const bucket = apertura > 0 ? positivas : apertura < 0 ? negativas : cero;
    bucket.push({ codigo: cuenta.codigo, cuentaId, monto: apertura });
  }

  return {
    positivas, negativas, cero, sinDato,
    totalPositivas: positivas.reduce((s, c) => s + c.monto, 0),
    totalNegativas: negativas.reduce((s, c) => s + c.monto, 0)
  };
}

module.exports = { ejecutarPaso5, FECHA_APERTURA };
