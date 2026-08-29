// Motivo documentado de las cuentas cuyo saldo del nuevo modelo de cartera no coincide con
// el Excel de CARTERA (ver PUNTOS-CONFLICTIVOS.md sección 1 y paso12-reporte-final.md sección 3).
// Las primeras 12 son del cierre original de la carga inicial (agosto de 2026); el bloque
// agregado el 2026-08-29 documenta 23 más, encontradas al destrabar npm run conciliacion
// (rota desde la fusión de R031/R0301) y correr la comparación completa de nuevo -- todas
// corresponden a correcciones de paso9b-correcciones.js posteriores a que el Excel de
// referencia quedara congelado, ver el comentario junto a esas 23 entradas más abajo.
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
    'Excel es de $210.000.',

  // Revisión 2026-08-29: 23 cuentas más, encontradas al destrabar npm run conciliacion (llevaba
  // rota desde la fusión de R031 con R0301, ver commit de esa corrección) y correr la
  // comparación completa de nuevo. Todas corresponden a correcciones ya investigadas y aplicadas
  // en paso9b-correcciones.js entre el 2026-08-13 y el 2026-08-27 -- después de que el Excel de
  // referencia (target de la conciliación) quedara congelado -- así que la diferencia es
  // exactamente la plata real que se encontró después, no un descuadre nuevo.
  R002: 'Cuenta suspendida desde enero de 2024 (decisión del usuario, 2026-08-20): nunca se ' +
    'localizó en el barrido de campo y no tiene ningún pago real conocido, así que se trató ' +
    '"como si nunca hubiera debido nada". Se anularon los 31 meses de 2024 a julio de 2026 ' +
    'causados a la tarifa derogada ($5.000, $155.000 en total) y se puso en $0 la apertura ' +
    'opaca anterior a 2024 que traía CARTERA ($600.000). La diferencia frente al Excel es de ' +
    '$755.000 -- no es una deuda que se le esté cobrando a nadie, es exactamente lo que se le ' +
    'condonó.',
  R0501: 'Mismo caso que R002 (misma decisión, mismo día): suspendida desde enero de 2024, sin ' +
    'ningún pago real conocido. Se anularon los 31 meses de 2024 a julio de 2026 a la tarifa ' +
    'derogada ($155.000) y se puso en $0 la apertura opaca anterior a 2024 ($600.000). La ' +
    'diferencia frente al Excel es de $755.000 -- es lo que se le condonó, no lo que se le cobra.',
  S009: 'Mismo caso que R002 y R0501: suspendida desde enero de 2024, sin ningún pago real ' +
    'conocido. Se anularon los 31 meses de 2024 a julio de 2026 a la tarifa derogada ($155.000) ' +
    'y se puso en $0 la apertura opaca anterior a 2024 ($600.000). La diferencia frente al Excel ' +
    'es de $755.000 -- es lo que se le condonó, no lo que se le cobra.',
  R0971: 'Mismo caso que R002/R0501/S009, misma decisión del usuario (2026-08-20): suspendida ' +
    'desde enero de 2024, sin ningún pago real conocido. Se anularon los 31 meses de 2024 a ' +
    'julio de 2026 a la tarifa derogada ($155.000) y se puso en $0 la apertura opaca anterior a ' +
    '2024, que en este caso era de $345.000 (menor que las otras tres). La diferencia frente al ' +
    'Excel es de $500.000 -- es lo que se le condonó, no lo que se le cobra.',
  S044: 'La apertura opaca que traía CARTERA ($156.000) no era deuda de sostenimiento: era el ' +
    'saldo pendiente de un punto de conexión (recibo 1296, diciembre de 2022, "PENDIENTE ' +
    '$156.000 DEL PUNTO"), ya saldado con tres abonos de $52.000 en 2024 (recibos 1751, 1815 y ' +
    '1816). Se corrigió la apertura a $0. La diferencia frente al Excel es de $156.000.',
  S0141: 'Cuenta suspendida desde enero de 2023 (decisión del usuario, 2026-08-20): a diferencia ' +
    'de R002/R0501/S009/R0971, esta cuenta sí registra pagos reales, así que conserva su ' +
    'apertura opaca de antes de 2024 ($60.000) -- solo se anularon los 31 meses de 2024 a julio ' +
    'de 2026 causados a la tarifa derogada ($5.000, $155.000 en total). La diferencia frente al ' +
    'Excel es de $155.000.',
  S0441: 'Mismo caso que S0141: cuenta suspendida desde enero de 2019, con pagos reales previos, ' +
    'así que conserva su apertura opaca de antes de 2024 ($270.000). Se anularon los 31 meses de ' +
    '2024 a julio de 2026 causados a la tarifa derogada ($155.000). La diferencia frente al ' +
    'Excel es de $155.000.',
  R047: 'CARTERA no tenía anotado el recibo 2564 ($150.000, "CUOTA DE SOSTENIMIENTO OCTUBRE 2024 ' +
    'A DICIEMBRE 2025"), encontrado en el talonario físico durante el cruce completo de agosto ' +
    'de 2026. La diferencia frente al Excel es de $150.000.',
  C004: 'CARTERA no tenía anotado el recibo 2552 ($240.000, "CUOTA DE SOSTENIMIENTO ENERO A ' +
    'DICIEMBRE 2026"), encontrado en el talonario físico durante el cruce completo de agosto de ' +
    '2026. La conciliación solo compara contra enero-julio (agosto-diciembre nunca se causa por ' +
    'anticipado en ningún lado): de los $240.000 del recibo, la porción comparable es $140.000 ' +
    '(7 meses × $20.000). La diferencia frente al Excel es de $140.000.',
  S039: 'Dos hechos reales, no uno: (1) CARTERA no tenía anotado el recibo 2558 ($120.000, ' +
    '"CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026"), del cual la porción comparable ' +
    'enero-julio es $70.000 (7 × $10.000); (2) se redimieron $61.000 de crédito disponible ' +
    '(recibo 2068, "PAGO REAJUSTE 2024", más $1.000 de otra apertura) contra el hueco real de ' +
    'junio-diciembre de 2024 -- ese crédito todavía contaba como "disponible" en la foto fija ' +
    'del 13 de agosto de 2026 contra la que compara la conciliación, tomada antes de esta ' +
    'redención. $70.000 + $61.000 = $131.000. La diferencia frente al Excel es de $131.000.',
  S0334: 'Dos hechos reales, no uno: (1) CARTERA no tenía anotado el recibo 2557 ($120.000, ' +
    '"CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026"), del cual la porción comparable ' +
    'enero-julio es $70.000 (7 × $10.000); (2) se redimieron $60.000 de crédito disponible ' +
    '(recibo 2067, "PAGO REAJUSTE 2024") contra el hueco real de julio-diciembre de 2024 -- ese ' +
    'crédito todavía contaba como "disponible" en la foto fija del 13 de agosto de 2026 contra ' +
    'la que compara la conciliación, tomada antes de esta redención. $70.000 + $60.000 = ' +
    '$130.000. La diferencia frente al Excel es de $130.000.',
  S0338: 'CARTERA no tenía anotado el recibo 2559 ($96.000, "CUOTA DE SOSTENIMIENTO ENERO A ' +
    'JUNIO 2026"), encontrado en el talonario físico durante el cruce completo de agosto de ' +
    '2026. La diferencia frente al Excel es de $96.000.',
  R0942: 'El recibo 2563 (8 de agosto de 2026, $156.000 en efectivo, "CUOTA DE SOSTENIMIENTO ' +
    'MARZO A DICIEMBRE 2026, TENÍA $4.000 A FAVOR") no estaba anotado en CARTERA. Junto con los ' +
    '$4.000 de saldo a favor que ya traía la cuenta (documentado en una corrección anterior, ' +
    'recibo 2246), paga exacto los 10 meses de marzo a diciembre de 2026 ($16.000 cada uno) -- a ' +
    'diferencia de la mayoría de las demás cuentas, este recibo si causa y cobra por adelantado ' +
    'agosto-diciembre 2026, así que la comparación no puede descontar esos 5 meses como de ' +
    'costumbre. La diferencia frente al Excel es de $84.000.',
  C0041: 'CARTERA no tenía anotado el recibo 2553 ($120.000, "CUOTA DE SOSTENIMIENTO ENERO A ' +
    'DICIEMBRE 2026"), encontrado en el talonario físico durante el cruce completo de agosto de ' +
    '2026. La porción comparable (enero-julio, ya que agosto-diciembre nunca se causa por ' +
    'anticipado) es $70.000 (7 × $10.000). La diferencia frente al Excel es de $70.000.',
  S042: 'CARTERA no tenía anotado el recibo 2561 ($120.000, "CUOTA DE SOSTENIMIENTO ENERO A ' +
    'DICIEMBRE 2026"), encontrado en el talonario físico durante el cruce completo de agosto de ' +
    '2026. La porción comparable (enero-julio) es $70.000 (7 × $10.000). La diferencia frente al ' +
    'Excel es de $70.000.',
  R0301: 'El recibo 1819 (4 de mayo de 2024, $60.000, "CUOTA DE SOSTENIMIENTO ENERO A JUNIO ' +
    '2024") estaba digitalizado en el talonario bajo un código mal transcrito que generó una ' +
    'cuenta fantasma ("R031"): mismo propietario, mismo predio, y R0301 tenía exactamente un ' +
    'hueco de enero a junio de 2024 del mismo valor. Confirmado por el usuario 2026-08-22, el ' +
    'recibo se movió a R0301 y la cuenta fantasma se eliminó. La diferencia frente al Excel es ' +
    'de $60.000.',
  R013: 'CARTERA no tenía anotado el recibo 2555 ($60.000, "CUOTA DE SOSTENIMIENTO ABRIL A ' +
    'SEPTIEMBRE 2026"), la mitad de una transferencia de $100.000 del 25 de julio de 2026 que el ' +
    'talonario físico repartió entre esta cuenta y R0131. La porción comparable (abril-julio, ya ' +
    'que agosto-septiembre no se causa por anticipado) es $40.000 (4 × $10.000). La diferencia ' +
    'frente al Excel es de $40.000.',
  R049: 'Dos hechos distintos se mezclan acá: (1) el recibo 2537 ($120.000, "ENERO A DICIEMBRE ' +
    '2026") ya venía marcado desde la carga inicial como "pendiente de carga" (existía en el ' +
    'talonario pero no en historial-aportes); (2) se redimieron $50.000 de crédito disponible ' +
    '(recibo 1677, "ABONO A LA DEUDA", de 2024) contra el hueco real de enero-mayo de 2025, ' +
    'verificado contra CARTERA (que no registra ningún saldo a favor ahí). El total no cierra al ' +
    'peso contra estos dos hechos solos: queda un residuo pequeño (~$10.000) del mismo tipo que ' +
    'el de S023/S022/S0271 -- la conciliación compara contra una foto fija del 13 de agosto de ' +
    '2026, y esta redención es del 20 de agosto. La diferencia frente al Excel es de $40.000.',
  R0131: 'CARTERA no tenía anotado el recibo 2554 ($40.000, "CUOTA DE SOSTENIMIENTO JUNIO A ' +
    'SEPTIEMBRE 2026"), la otra mitad de la misma transferencia de $100.000 del 25 de julio de ' +
    '2026 repartida con R013. La porción comparable (junio-julio) es $20.000 (2 × $10.000). La ' +
    'diferencia frente al Excel es de $20.000.',
  C016: 'CARTERA no tenía anotado el recibo 2556 ($60.000, "CUOTA DE SOSTENIMIENTO JULIO A ' +
    'DICIEMBRE 2026"), encontrado en el talonario físico durante el cruce completo de agosto de ' +
    '2026. La porción comparable (solo julio, el único mes dentro del rango que la conciliación ' +
    'compara) es $10.000. La diferencia frente al Excel es de $10.000.',
  S022: 'Se redimieron $20.000 de un crédito varado de 2024 (recibos 1692 y 1813, "ABONO A LA ' +
    'DEUDA", sin período declarado) contra enero-febrero de 2026, el tramo que el recibo 2394 ' +
    'declaraba pagar pero que un reparto automático había desviado hacia una deuda vieja sin ' +
    'relación. Queda un residuo de $10.000 en la conciliación por el mismo motivo que S023 y ' +
    'S0271: compara contra una foto fija del 13 de agosto de 2026, tomada antes de esta ' +
    'redención (20 de agosto) -- no es un error de la corrección, ya verificado. La diferencia ' +
    'frente al Excel es de $10.000.',
  S0271: 'Se redimieron $20.000 (de $60.000 disponibles del recibo 2021, "PAGO REAJUSTE 2024") ' +
    'contra el hueco real de noviembre-diciembre de 2024; los $40.000 restantes quedan como ' +
    'crédito disponible, para que la junta decida. Queda un residuo de $10.000 en la ' +
    'conciliación por el mismo motivo que S023 y S022: compara contra una foto fija del 13 de ' +
    'agosto de 2026, tomada antes de esta redención. La diferencia frente al Excel es de $10.000.',
  S0383: 'El recibo 2550 ($60.000, "CUOTA DE SOSTENIMIENTO JULIO A DICIEMBRE 2026") estaba ' +
    'digitalizado en el talonario con el código "S038" (transcripción incompleta) en vez de ' +
    'S0383 -- confirmado 2026-08-21 por el nombre del propietario. La porción comparable (solo ' +
    'julio) es $10.000. La diferencia frente al Excel es de $10.000.',
  S023: 'Se redimieron $15.000 (del recibo 1627, "PAGA DEUDA PENDIENTE") contra el hueco real de ' +
    'julio de 2024, creado cuando un reparto automático anterior consumió la apertura y un ' +
    'ajuste de categoría antes que este pago. Queda un residuo de $1.000 en la conciliación, ya ' +
    'verificado (saldo a favor en $0, deuda exigible correcta): compara contra una foto fija del ' +
    '13 de agosto de 2026, tomada antes de esta redención. La diferencia frente al Excel es de $1.000.'
};

function getMotivoDiferencia(codigo) {
  return MOTIVOS_DIFERENCIA[codigo] || null;
}

module.exports = { MOTIVOS_DIFERENCIA, getMotivoDiferencia };
