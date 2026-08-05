// Paso 11 de la carga inicial (sección 14 del MD): conciliar el saldo de sostenimiento del
// sistema contra `SALDO A 31/12/2026` de CARTERA.xlsx.
//
// Esta parte SOLO calcula -- no inserta ningún AjusteCargaInicial. El usuario revisó la
// distribución de diferencias a fondo (ver historial del chat) y concluyó que ninguna de las
// que sobrevivieron a las correcciones de abajo lo necesita: cada una tiene una explicación
// distinta y ya conocida (pago que CARTERA no registró, o desfase de período declarado).
//
// Fórmula final, construida en capas sobre la que dio el usuario originalmente
// (saldo_objetivo = SALDO A 31/12/2026 − 5×tarifa_2026):
//
// 1. saldoObjetivoBruto = saldo_cartera_excel_2026 − 5×tarifa_2026
//    Los 5 meses de agosto-diciembre 2026 nunca se causan (paso 9), en ninguna cuenta.
//
// 2. Término de punto (solo si la cuenta tiene punto de conexión; 0 si no aplica):
//      - cuadra_exacto:true Y la cuenta tiene `cargo_punto_incluido` en algún año de
//        plan_causacion (el grupo de 9 donde CARTERA sí causó el punto junto con el
//        sostenimiento) → restar saldoPendientePunto. Para las otras cuadra_exacto:true
//        (sin cargo_punto_incluido) NO se toca nada, aunque tengan un punto con saldo
//        pendiente propio y sin relación con esta diferencia -- restarles algo ahí rompe
//        cuentas que ya cuadraban (confirmado: R068, R0592, S0441, S0501, S032, S055, S022).
//      - cuadra_exacto:false y la cuenta SÍ tiene apertura_opaca_2023_12_31 > 0 → sumar
//        abonos_punto_desde_2024 (CARTERA netea el abono completo contra el saldo heredado).
//      - cuadra_exacto:false y la cuenta NO tiene apertura opaca → restar saldoPendientePunto
//        (CARTERA nunca causó el punto como cargo; sin apertura previa, lo único que puede
//        explicar la diferencia es lo que aún falta por pagar del punto).
//    Verificado 1:1 contra las 24 cuentas con punto y cuadra_exacto:false, y contra las 3
//    (R0944, R0031, R0945) con cuadra_exacto:true, cargo_punto_incluido y saldo de punto
//    aún pendiente.
//
// 3. Recibos "pendientes de carga" (existen en el talonario pero no en historial-aportes, por
//    lo que CARTERA tampoco los contó en PAGOS): se restan del objetivo, agrupados por cuenta.
//
// 4. Saldo a favor disponible (cambio de diseño 2026-08-04): desde que un abono con sobrante
//    ya no resta la deuda por su cuenta -- se recorta a lo imputado y el resto va a
//    cuenta_creditos, sin aplicarse solo (ver CarteraService.registrarAbono/redimirCredito) --
//    saldoSistema quedó más alto que antes en cualquier cuenta con crédito, exactamente por el
//    monto del crédito. El Excel de CARTERA sí lo tenía descontado. Se suma al target por el
//    mismo motivo que el término de punto: es una diferencia de MODELO entre los dos sistemas,
//    no una diferencia de datos que haya que documentar cuenta por cuenta. Verificado: sin este
//    término, 68 cuentas sin ninguna otra diferencia real aparecían con diferencia == su propio
//    saldoCreditoDisponible, al peso, las 68.
//
// diferencia = saldoSistema − target. Un valor de 0 (con tolerancia < 1000) significa que la
// diferencia está completamente explicada por lo de arriba.
const { normalizarCodigo } = require('./normalizar');
const { redondear } = require('../../src/services/cartera/dinero');

const NOTA_PENDIENTE_DE_CARGA = 'PENDIENTE DE CARGA';

function calcularConciliacion({ dbService, cuentasJson, recibosJson }) {
  const CarteraService = require('../../src/services/CarteraService');
  const db = dbService.getDb();
  const service = new CarteraService(dbService);

  const idPorCodigo = new Map(
    db.prepare('SELECT id, codigo FROM cuentas').all().map(c => [normalizarCodigo(c.codigo), c.id])
  );
  const saldoPendientePuntoPorCuentaId = new Map(
    db.prepare('SELECT cuenta_id, saldo_pendiente FROM nuevos_puntos').all().map(p => [p.cuenta_id, p.saldo_pendiente])
  );

  const pendienteDeCargaPorCodigo = new Map();
  for (const r of recibosJson || []) {
    if ((r.nota || '').includes(NOTA_PENDIENTE_DE_CARGA)) {
      const codigo = normalizarCodigo(r.codigo_cuenta);
      pendienteDeCargaPorCodigo.set(codigo, redondear((pendienteDeCargaPorCodigo.get(codigo) || 0) + r.valor));
    }
  }

  const filas = [];
  const sinTarget = [];

  for (const cuenta of cuentasJson) {
    if (cuenta.codigo === 'S0332S0382') continue;
    const codigoNorm = normalizarCodigo(cuenta.codigo);
    const cuentaId = idPorCodigo.get(codigoNorm);
    if (cuentaId === undefined) throw new Error(`${cuenta.codigo}: no existe en la base`);

    const conc = cuenta.conciliacion || {};
    if (conc.saldo_sostenimiento_esperado === null || conc.saldo_sostenimiento_esperado === undefined) {
      sinTarget.push({ codigo: cuenta.codigo, cuentaId, motivo: conc.motivo_diferencia || null });
      continue;
    }

    const estado = service.getEstadoCartera(cuentaId);
    const saldoSistema = redondear(estado.deudaAntes2024 + estado.deudaMesesDesde2024);

    const saldoCarteraExcel2026 = conc.saldo_cartera_excel_2026;
    const abonosPuntoDesde2024 = conc.abonos_punto_desde_2024 || 0;
    const cuadraExacto = conc.cuadra_exacto;
    const tarifa2026 = (cuenta.plan_causacion && cuenta.plan_causacion['2026'] && cuenta.plan_causacion['2026'].tarifa) || 0;
    const tieneAperturaOpaca = (cuenta.apertura_opaca_2023_12_31 || 0) > 0;
    const saldoPendientePunto = saldoPendientePuntoPorCuentaId.get(cuentaId) || 0;
    const pendienteDeCarga = pendienteDeCargaPorCodigo.get(codigoNorm) || 0;
    const tieneCargoPuntoIncluido = Object.values(cuenta.plan_causacion || {})
      .some(y => y && y.cargo_punto_incluido !== null && y.cargo_punto_incluido !== undefined);

    let terminoPunto = 0;
    if (cuadraExacto) {
      terminoPunto = tieneCargoPuntoIncluido ? -saldoPendientePunto : 0;
    } else if (tieneAperturaOpaca) {
      terminoPunto = abonosPuntoDesde2024;
    } else {
      terminoPunto = -saldoPendientePunto;
    }

    const target = redondear(saldoCarteraExcel2026 - 5 * tarifa2026 + terminoPunto - pendienteDeCarga + estado.saldoCreditoDisponible);
    const diferencia = redondear(saldoSistema - target);

    filas.push({
      codigo: cuenta.codigo, cuentaId, saldoSistema,
      saldoCarteraExcel2026, tarifa2026, cuadraExacto, tieneAperturaOpaca,
      abonosPuntoDesde2024, saldoPendientePunto, pendienteDeCarga,
      saldoCreditoDisponible: estado.saldoCreditoDisponible,
      target, diferencia
    });
  }

  const cero = filas.filter(f => f.diferencia === 0);
  const bajo = filas.filter(f => f.diferencia !== 0 && Math.abs(f.diferencia) < 1000);
  const alto = filas.filter(f => Math.abs(f.diferencia) >= 1000)
    .sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));

  return { filas, sinTarget, cero, bajo, alto };
}

module.exports = { calcularConciliacion };
