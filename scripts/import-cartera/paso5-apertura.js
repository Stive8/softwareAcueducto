// Paso 5 de la carga inicial (sección 14 del MD): apertura opaca al 31/12/2023.
//
// Verificado antes de escribir esto (ver CarteraRepository.getSaldos / getCargosPendientes):
//  - saldoOpaco (bucket 1, "antes de 2024") = SUM(monto) de movimientos exigible=0.
//    AperturaOpaca ya se inserta con exigible=0, así que el bucket 1 sale gratis del motor.
//  - cuenta_creditos NO participa en ningún cálculo de saldo (CarteraService.js:108 lo confirma
//    en un comentario: "queda sin uso"). Los 14 saldos a favor se cargan como AperturaOpaca con
//    monto NEGATIVO, no en esa tabla.
//  - getCargosPendientes filtra `monto > 0`, así que un AperturaOpaca negativo nunca aparece como
//    "cargo pendiente": el FIFO del paso 10 no puede imputarle nada por error.
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

    if (apertura !== 0) {
      repo.crearMovimiento({
        cuentaId, fecha: FECHA_APERTURA, tipo: 'AperturaOpaca', exigible: 0, monto: apertura
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
