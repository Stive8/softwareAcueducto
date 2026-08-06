// Motivo documentado de las 12 cuentas cuyo saldo del nuevo modelo de cartera no coincide con
// el Excel de CARTERA (ver PUNTOS-CONFLICTIVOS.md sección 1 y paso12-reporte-final.md sección 3).
// Texto fijo, no calculado: cada motivo se investigó y verificó a mano durante la conciliación
// (paso 11) y no se deriva de ningún dato en la base -- por eso vive como constante aquí, para
// que la pantalla de cartera lo muestre sin que el operador tenga que ir a buscar el .md.
//
// Revisión 2026-08-04 (mañana): S0393 salió de esta lista (cierra exacto tras reasignar el
// recibo 2137 a su cuenta correcta); S0312 entró (recibió ese mismo pago mal anotado). S010 y
// S048 mantienen diferencia pero con motivo actualizado tras revisar recibo por recibo contra
// CARTERA y el talonario físico. S0162, C021, S034, R079, R068 y S03351 tienen motivo
// reclasificado con más detalle (mismos montos que antes).
//
// Revisión 2026-08-04 (tarde): cambio de diseño -- el saldo a favor deja de restar la deuda por
// su cuenta sola (ver CarteraService.registrarAbono/redimirCredito); paso11-conciliacion.js ahora
// suma saldoCreditoDisponible al target, igual que ya hacía con el punto de conexión, así que el
// crédito no aplicado no aparece como "diferencia sin explicar". Sin ese ajuste, 68 cuentas más
// (sin ninguna otra causa real) mostraban diferencia == su propio crédito disponible, al peso.
// R079 (-15.000, antes se veía -5.000) y S03351 (2.000, antes se veía 52.000) recuperaron su
// valor real al excluir el crédito. C021 se corrige de "$310.000" a "$275.000" en el texto: era
// un error aritmético de esta sesión (155.000 + 120.000 = 275.000), no del sistema.
//
// Revisión 2026-08-07: los 12 textos mezclaban "diferencia contra el Excel de CARTERA" con
// "lo que debe el asociado", y en pantalla eso contradice la cifra principal nueva (aPagar,
// que es la cuota corriente, calculada en vivo -- ver CarteraService.calcularAPagar). Cada
// texto ahora deja explícito que el monto mencionado es la diferencia frente al Excel, nunca
// lo que se le cobra a la persona; no se repite ningún "debe $X" que pueda quedar desactualizado
// frente a la cifra principal, que cambia con el tiempo.
const MOTIVOS_DIFERENCIA = {
  S0312: 'El recibo 2137 ($270.000, 22 de marzo de 2025) estaba anotado a nombre de esta cuenta ' +
    'en CARTERA, pero pertenece al cuarto punto de la familia Ospina, cuenta S0393: este predio ' +
    'ya había cambiado de dueño antes de esa fecha, y los demás recibos de esta cuenta no dejan ' +
    'ningún hueco que ese pago pudiera llenar. El sistema corrigió la cuenta del pago; CARTERA ' +
    'no. La diferencia frente al Excel es de $270.000.',
  S048: 'CARTERA declara tres pagos anuales (2024, 2025 y 2026) pero solo existen dos recibos: ' +
    'el 2019 (diciembre de 2024) y el 2384 (enero de 2026). El tercero es una proyección del ' +
    'Excel, que repitió la fila asumiendo que la asociada pagaría igual que siempre. El período ' +
    'del recibo 2384 se corrigió a 2025 porque la asociada paga a fin de año o comienzos del ' +
    'siguiente y nunca ha pagado por adelantado. La diferencia frente al Excel es de $192.000 ' +
    '(el tercer pago que CARTERA proyectó de más).',
  S010: 'CARTERA nunca registró el recibo 1825 ($90.000, 4 de mayo de 2024): dejó PAGOS EN 2024 ' +
    'vacío y el saldo de ese año igual a la causación completa. El sistema sí lo cuenta. Además, ' +
    'el recibo 1659 no genera abono porque su efecto ya está dentro de la apertura: el Excel lo ' +
    'usó para cerrar 2023 en cero sin anotarlo como pago. La diferencia frente al Excel es de ' +
    '$90.000 -- no es lo que se le cobra a la asociada, que se calcula aparte a partir de sus ' +
    'meses realmente pendientes.',
  S034: 'El Excel no tiene anotado el recibo 2487 (2 de mayo de 2026, $100.000). Los recibos de ' +
    '2026 suman $300.000 y CARTERA registra $200.000. El sistema está más actualizado. La ' +
    'diferencia frente al Excel es de $100.000.',
  R079: 'CARTERA contó $110.000 en 2024 contra $125.000 reales; el recibo 1657 quedó incorporado ' +
    'en el cierre de 2023. Los pagos del sistema son correctos. La diferencia frente al Excel es ' +
    'de $15.000.',
  R068: 'CARTERA contó $106.000 en 2024 contra $108.000 reales, por el recibo 1689 de $58.000 ' +
    '(monto no redondo). La diferencia frente al Excel es de $2.000.',
  S03351: 'Error de digitación en CARTERA: anotó $192.000 donde el recibo 2495 dice $190.000 ' +
    '(19 meses × $10.000). La diferencia frente al Excel es de $2.000.',
  R080: 'Tarifa desactualizada: esta cuenta llevaba años pagando $5.000, una tarifa que dejó de ' +
    'existir en 2024. CARTERA nunca actualizó su hoja. El sistema cobra la tarifa vigente ' +
    '($10.000) desde enero de 2024 -- a propósito, no es un descuadre. La diferencia frente al ' +
    'Excel es de $155.000.',
  R091: 'Tarifa desactualizada: esta cuenta llevaba años pagando $5.000, una tarifa que dejó de ' +
    'existir en 2024. CARTERA nunca actualizó su hoja. El sistema cobra la tarifa vigente ' +
    '($10.000) desde enero de 2024 -- a propósito, no es un descuadre. La diferencia frente al ' +
    'Excel es de $155.000.',
  S0244: 'Tarifa desactualizada: esta cuenta llevaba años pagando $5.000, una tarifa que dejó de ' +
    'existir en 2024. CARTERA nunca actualizó su hoja. El sistema cobra la tarifa vigente ' +
    '($10.000) desde enero de 2024 -- a propósito, no es un descuadre. La diferencia frente al ' +
    'Excel es de $155.000.',
  C021: '$155.000 por corrección de tarifa derogada (la misma que R080/R091/S0244), más ' +
    '$120.000 por error aritmético en CARTERA (saldo 2025 escrito en $0 cuando debía ser ' +
    '$120.000). Nunca ha registrado ningún pago. La diferencia frente al Excel es de $275.000 -- ' +
    'es la mayor de todo el proyecto, y no es lo que se le cobra hoy a la cuenta (eso sale de sus ' +
    'meses pendientes reales, no de esta comparación contra CARTERA).',
  S0162: 'Error aritmético en CARTERA: en 2024 el saldo debía ser $240.000 ($120.000 previos + ' +
    '$120.000 causados, sin pagos) y se escribió $30.000. El error se arrastra a los años ' +
    'siguientes. La asociada no ha pagado sostenimiento desde 2018. La diferencia frente al ' +
    'Excel es de $210.000.'
};

function getMotivoDiferencia(codigo) {
  return MOTIVOS_DIFERENCIA[codigo] || null;
}

module.exports = { MOTIVOS_DIFERENCIA, getMotivoDiferencia };
