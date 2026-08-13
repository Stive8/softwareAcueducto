// Captura, UNA SOLA VEZ, el crédito disponible y el saldo pendiente de punto de conexión de
// cada cuenta -- y los persiste dentro de carga_inicial_cartera.json, en
// cuenta.conciliacion.snapshot_captura -- para que paso11-conciliacion.js deje de leerlos en
// vivo desde la base.
//
// POR QUÉ EXISTE (2026-08-14, ver la conversación que lo motivó):
// paso11-conciliacion.js compara el sistema contra el Excel de CARTERA para responder una
// pregunta puntual: "¿la carga inicial reprodujo bien el Excel?". Dos de sus términos
// (saldoCreditoDisponible y saldoPendientePunto) se leían EN VIVO desde la base -- así que
// cualquier operación posterior que reclasificara esa misma plata (redimir un crédito, pagar
// un punto de conexión) movía el target sin que saldoSistema se moviera con él, descuadrando
// cuentas que en realidad no tenían ningún problema real. Verificado con R005 (crédito) y
// R0031 (punto): redimir/pagar sobre una copia aislada descuadraba la cuenta por el monto
// exacto de lo reclasificado.
//
// La fórmula pura (derivar de apertura_opaca_2023_12_31 + sobrantes de imputación del JSON)
// SE INTENTÓ y casi funciona, pero rompe R007 por $12.000: su corrección 13 (2026-08-12) ya
// redimió parte del crédito de apertura ANTES de este snapshot, como parte de arreglar la
// carga -- una fórmula sin estado no puede distinguir esa redención (que sí debe quedar
// reflejada) de una redención futura por la app (que no debe). Hardcodear la excepción de
// R007 habría sido el mismo "ajuste para que cuadre" que este trabajo prohíbe.
//
// La solución es más simple: CAPTURAR el estado actual (correcciones ya aplicadas, cero
// operación real todavía) en vez de intentar recalcularlo. Es una foto, no una fórmula.
//
// Se corre UNA SOLA VEZ. Si se vuelve a correr después de que la app ya registró operación
// real (pagos, redenciones), el snapshot quedaría contaminado con esa operación y dejaría de
// representar "el estado al cierre de la carga". Por eso se niega a pisar un snapshot
// existente salvo que se pase --forzar explícitamente (con advertencia impresa).
//
// Uso: electron capturar-snapshot-conciliacion.js <carga_inicial_cartera.json> [--forzar]
const fs = require('fs');
const path = require('path');

const NOTA_SNAPSHOT =
  'Foto fija del crédito disponible y el saldo pendiente de punto de conexión, tomada UNA SOLA ' +
  'VEZ al cierre de la carga inicial y sus correcciones (paso9b), antes de cualquier operación ' +
  'real por la app. NO recalcular ni "actualizar": paso11-conciliacion.js la usa como referencia ' +
  'fija a propósito -- ver scripts/import-cartera/capturar-snapshot-conciliacion.js.';

function capturarSnapshot({ dbService, cuentasJson, forzar = false }) {
  const CarteraService = require('../../src/services/CarteraService');
  const db = dbService.getDb();
  const service = new CarteraService(dbService);

  const yaCapturadas = cuentasJson.filter(c => c.conciliacion && c.conciliacion.snapshot_captura);
  if (yaCapturadas.length > 0 && !forzar) {
    throw new Error(
      `${yaCapturadas.length} cuenta(s) ya tienen snapshot_captura (ej. ${yaCapturadas[0].codigo}). ` +
      `Este script se corre una sola vez -- si de verdad hay que recapturar (¿por qué? el ` +
      `snapshot no se "actualiza"), pasar --forzar explícitamente.`
    );
  }
  if (forzar && yaCapturadas.length > 0) {
    console.warn(
      `ADVERTENCIA: sobreescribiendo snapshot_captura ya existente en ${yaCapturadas.length} cuenta(s). ` +
      `Si la app ya registró operación real desde la captura anterior, el nuevo snapshot va a ` +
      `contaminarse con esa operación.`
    );
  }

  const idPorCodigo = new Map(db.prepare('SELECT id, codigo FROM cuentas').all().map(c => [c.codigo, c.id]));
  const saldoPendientePuntoPorCuentaId = new Map(
    db.prepare('SELECT cuenta_id, saldo_pendiente FROM nuevos_puntos').all().map(p => [p.cuenta_id, p.saldo_pendiente])
  );

  const fecha = new Date().toISOString().split('T')[0];
  let capturadas = 0;
  for (const cuenta of cuentasJson) {
    const cuentaId = idPorCodigo.get(cuenta.codigo);
    if (cuentaId === undefined) continue; // cuenta del JSON que no llegó a existir en la base (ver HUERFANOS_A_CREAR)
    if (!cuenta.conciliacion) continue;    // sin bloque de conciliación: nada que capturar

    const estado = service.getEstadoCartera(cuentaId);
    const saldoPendientePunto = saldoPendientePuntoPorCuentaId.get(cuentaId) || 0;

    cuenta.conciliacion.snapshot_captura = {
      fecha,
      nota: NOTA_SNAPSHOT,
      saldo_credito_disponible: estado.saldoCreditoDisponible,
      saldo_pendiente_punto: saldoPendientePunto
    };
    capturadas++;
  }

  return { capturadas, fecha };
}

function main() {
  const args = process.argv.slice(2);
  const forzar = args.includes('--forzar');
  const jsonPath = args.find(a => !a.startsWith('--'));
  if (!jsonPath) {
    console.error('Uso: capturar-snapshot-conciliacion.js <carga_inicial_cartera.json> [--forzar]');
    process.exit(1);
  }

  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  let resultado;
  try {
    resultado = capturarSnapshot({ dbService, cuentasJson: data.cuentas, forzar });
  } catch (err) {
    dbService.close();
    console.error(err.message);
    process.exit(1);
  }

  data.meta.snapshot_conciliacion = {
    fecha: resultado.fecha,
    nota: 'Ver cuenta.conciliacion.snapshot_captura -- ' + NOTA_SNAPSHOT
  };

  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Snapshot capturado en ${resultado.capturadas} cuenta(s), fecha ${resultado.fecha}.`);
  console.log(`Escrito en ${jsonPath}`);

  dbService.close();
}

if (require.main === module) main();

module.exports = { capturarSnapshot, NOTA_SNAPSHOT };
