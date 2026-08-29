// Paso 9b de la carga inicial: correcciones puntuales encontradas durante la revisión manual
// del paso 11 (conciliación), que NO están en `carga_inicial_cartera.json` y por lo tanto no
// las genera el paso 9. Se documentan aquí como código, no como script suelto, para que una
// corrida limpia del loader las reproduzca exactamente igual.
//
// Corre después del paso 10 (imputación) y antes de calcular la conciliación del paso 11.
// Las correcciones 1 y 2 (S03311, tarifa) no interactúan con lo que ya imputó el paso 10 --
// ninguna de esas cuentas tiene un recibo o abono desde 2024 en el JSON. Las correcciones 4 a
// 7 (recibos 2137, 2384, 1659, 1825) SÍ tocan abonos que el paso 10 ya imputó, así que
// deshacen y rehacen esa imputación puntual con el mismo mecanismo (`distribuir` +
// `mesesDelPeriodo`, reusados de paso10-imputacion.js, no reinventados).
//
// 1. S03311: la única de las "20 cuentas con celda vacía en 2024" donde el año faltante SÍ
//    estaba causado en la realidad (verificado: sumar 12 meses a 10.000 cierra la conciliación
//    exacto contra `saldo_cartera_excel_2026`). Las otras 19 celda-vacía NO llevan esta
//    corrección -- para ellas la celda vacía es legítima (cuenta nueva sin deuda ese año) o no
//    cierra ni sumando el año, y quedan tal cual.
//
// 2. C021, R080, R091, S0244: decisión de negocio -- la tarifa de 5.000 que trae
//    `plan_causacion` para estas 4 cuentas es una tarifa derogada en 2024 que CARTERA nunca
//    actualizó. Verificado en DatosPropietariosCuentas que las 4 son TIPO=CASA, activas
//    (sin fecha_suspension), con coordenadas de campo -- y sin ningún recibo desde 2024. Se
//    recausa el 2024-2026 completo a 10.000 (la tarifa vigente). Las 7 cuentas suspendidas que
//    comparten la misma tarifa vieja (R002, R0501, R0971, S004, S009, S0141, S0441) NO se
//    tocan: DatosPropietariosCuentas las marca "NO EXISTE" / "NO ENCONTRADO" / "CASA
//    ABANDONADA", y subirles la tarifa solo infla cartera que la junta debe decidir si castiga.
//
// 3. S0244: nunca tuvo fila en `cuenta_propietarios` (la cuenta ya existía antes de esta carga,
//    así que `leer-datos-propietarios.js` -- que solo alimenta cuentas nuevas -- nunca la tocó).
//    DatosPropietariosCuentas.xlsx trae "ZAPATO MACHADO PEDRO NEL" con la misma cédula, teléfono
//    y correo que ya estaban en `carga_inicial_cartera.json` para esta cuenta, y una columna de
//    nombre anterior que coincide exacto con el nombre que CARTERA nunca actualizó ("MACHADO
//    ZAPATA LUIS HERNANDO"). Confirma cambio de dueño no reflejado. Ver PUNTOS-CONFLICTIVOS.md
//    sección 4.
//
// 4. Recibo 2137 -- reasignar de S0312 a S0393. El 22-mar-2025 la familia Ospina pagó sus
//    cuatro puntos por transferencia en recibos consecutivos de 270.000 cada uno (2134→S0394,
//    2135→S0391, 2136→S0392, 2137→quedó anotado S0312 en vez de S0393). Evidencia: el nombre en
//    la colilla 2137 es "Ospina Machado Mariano y/o Azucena Salguero", pero S0312 ya había
//    cambiado de dueño a Azucena Salguero antes de esa fecha; los demás recibos de S0312 forman
//    una cadena sin huecos que el 2137 duplicaría; y CARTERA mostraba S0312 con saldo negativo
//    (crédito que no existía). Solo se mueve el movimiento de cartera (bucket de dinero) -- el
//    recibo en sí NUNCA se toca (ni su número, ni `recibos.cuenta_id`): por diseño, el
//    "Historial de Aportes" del sistema viejo seguirá mostrando este recibo bajo S0312, mientras
//    que la cartera nueva ya lo cuenta bien bajo S0393. Efecto: S0393 cierra contra CARTERA;
//    S0312 se abre con +270.000 (ver `motivosDiferencia.js`).
//
// 5. Recibo 2384 (S048) -- corregir el período del recibo de 2026 a 2025. Cambia
//    `recibo_detalles.periodo_desde/periodo_hasta` (lo que muestra "Historial de Aportes" del
//    sistema viejo); el `concepto_original` ("...ENERO A DICIEMBRE 2026") se conserva intacto.
//    Evidencia: la asociada paga una vez al año, a fin de año o comienzos del siguiente, sin
//    fallar desde 2017 y sin adelantar nunca un año completo; CARTERA registra PAGOS EN 2025 =
//    192.000, lo que confirma que este pago era de 2025, no de 2026.
//
//    Corrección 2026-08-06: la primera versión de esto solo tocaba el texto de
//    recibo_detalles y dejaba dicho (equivocadamente) que no hacía falta re-imputar porque "el
//    saldo sale de la suma de los montos, no de a qué cargo quedó imputado un abono" -- cierto
//    para el TOTAL de la conciliación (paso11, que sigue igual), pero falso para la cifra
//    principal nueva (calcularAPagar), que sí depende de a qué mes quedó imputado cada abono.
//    El abono seguía imputado contra su período ORIGINAL (2026, tal como decía el recibo antes
//    de la corrección): 112.000 a ene-jul 2026 (los únicos meses de 2026 que existían al correr
//    el paso 10) + 80.000 de sobrante FIFO contra la apertura opaca. Resultado: 2025 aparecía
//    sin cubrir y ene-jul 2026 se cobraban dos veces. Ahora también se re-imputa contra el
//    período ya corregido (2025 completo, 12 × 16.000 = 192.000 exacto, sin sobrante), igual
//    que las correcciones 4, 6 y 7. La conciliación (paso11) no se mueve -- sigue siendo la
//    suma de los mismos montos, solo cambia a qué cargo quedan atados.
//
// 6 y 7. Recibos 1659 y 1825 (S010) -- 1659 deja de generar movimiento de abono: su efecto ya
//    está incorporado en el saldo de apertura al 31/12/2023 según CARTERA (que usó este recibo
//    para cerrar 2023 en 0 sin anotarlo como pago; contarlo también como abono en 2024 sería
//    contarlo dos veces). 1825 pasa a abono libre (sin período, FIFO puro) -- su concepto
//    ("julio 2022 a diciembre 2023") es una transcripción errada, confirmada contra el recibo
//    pareja del mismo día en S015. Estas dos correcciones cambian qué hay que re-imputar para
//    LOS TRES abonos de S010 desde 2024 (938, 621, 482), así que se recalculan los tres juntos,
//    en orden cronológico, igual que haría el paso 10. Efecto verificado (no el que se esperaba
//    a primera vista): S010 NO cierra -- queda debiendo 50.000 y la diferencia final es -90.000,
//    exactamente el monto del recibo 1825 que CARTERA nunca registró (mismo patrón que S034).
//
// 8. S044: la apertura opaca ($156.000) NO era deuda de sostenimiento -- duplicaba el saldo
//    pendiente del punto de agua. Verificado con la aritmética de CARTERA: saldo 31/12/2022
//    ($156.000) + causación 2023 ($240.000) - pagos 2023 ($240.000) = $156.000 sin moverse, y
//    ese mismo arrastre coincide exacto con el recibo 1296 (dic-2022): "PAGA ENERO A DICIEMBRE
//    2022 - PENDIENTE $156.000 DEL PUNTO" -- el sostenimiento de 2022 estaba al día, lo
//    pendiente era del punto. Encaja además con el precio del punto ($306.000 = $150.000 del
//    recibo 177/2018 + estos mismos $156.000, saldados por los tres abonos de 52.000 en 2024).
//    Se corrige la apertura a 0, con nota. NO se toca S0339 (mismo patrón textual -- recibo
//    "PENDIENTE $100.000 DEL PUNTO" -- pero su aritmética SÍ cierra como deuda real de
//    sostenimiento: saldo 2022 $205.000 + causación $60.000 - pagos $65.000 = $200.000, contra
//    los $100.000 que trae CARTERA -- ahí el error del Excel fue escribir el pendiente del
//    punto EN LUGAR DEL saldo de sostenimiento, no sumado. Queda marcada para revisión manual,
//    no para esta corrección automática).
//
// 9. Recibo 2229 (S044): período mal cargado. El concepto dice "ENERIO A JUNIO 2025" (con el
//    typo del texto original) pero periodo_desde/periodo_hasta quedaron ambos en "Junio 2025"
//    en vez de "Enero 2025" a "Junio 2025". Por eso el paso 10 solo emparejó junio por período
//    y el sobrante ($250.000) cayó al FIFO general, que gastó $156.000 en la apertura opaca
//    (corrección 8, ya errónea) antes de llegar a enero/febrero de 2025. Se corrige el período
//    y se reimputa el abono contra los 6 meses correctos -- con la apertura ya en 0, los
//    $300.000 alcanzan exacto para enero-junio 2025, sin sobrante.
//
// 10. S058: conexión nueva sin fila en CARTERA.xlsx -- por eso el paso 9 nunca la causó (no hay
//    plan_causacion sin fila de origen). De las 8 cuentas activas sin ningún CargoMensual
//    causado, es la única que SÍ aparece en el barrido de campo de DatosPropietariosCuentas.xlsx
//    (TIPO=CASA, con coordenadas y teléfono) -- las otras 7 van en la corrección 11. Pagó el
//    punto de conexión el 31-ene-2026 ($500.000, saldado); se causa sostenimiento desde FEBRERO
//    2026 (regla de negocio: el mes siguiente a la instalación, nunca el mismo mes) hasta julio
//    2026 (mismo tope que el resto de la carga inicial, ver paso9-causacion.js), a la tarifa de
//    Finca vigente (10.000). Categoría corregida de "Sin clasificar" (donde quedó por no tener
//    fila de origen) a Finca. Nota aparte, no accionable acá: mismo teléfono que R0081 (Arias
//    Moreno Martha Lucía) -- es la misma persona con un segundo punto de agua; cada punto es su
//    propia cuenta, no se fusionan.
//
// 11. Las otras 7 cuentas sin ningún CargoMensual causado (O40-1, R0103, R031, R0401, S0101,
//    S061, S091) tampoco aparecen en el barrido de campo de DatosPropietariosCuentas -- son
//    puntos que dejaron de existir y nadie los dio de baja formalmente. Se suspenden sin causar
//    nada, con fecha de suspensión el mes siguiente a su último recibo real (para que no generen
//    deuda desde entonces). S0332S0382 (la octava cuenta con cero CargoMensual) NO entra acá: ya
//    está marcada como cuenta corrupta desactivada desde el paso 1 (`construirPlan` la salta
//    explícitamente), nunca tuvo cuenta_estados que corregir.
//
// 12. S063: fusionada con S0365 ("punto no existe, punto verdadero S0365" según CARTERA) --
//    decisión ya tomada en la carga inicial, con la observación puesta en la cuenta, pero el
//    `estado` se quedó en Activo por descuido (nunca se le tocó cuenta_estados). No es un hallazgo
//    del reporte de Fase 2 (ver docs/superpowers/specs/2026-08-10-fase2-reportes-dashboard-design.md):
//    el reporte solo expuso que esta cuenta, sin ningún movimiento de cartera ni tarifa vigente
//    (categoría "Sin clasificar"), no debía seguir contando ni como al día ni como en mora -- el
//    dato incompleto de la migración es este. Se pasa a Inactivo, mismo mecanismo que la
//    corrección 11 (reemplaza el marcador sintético "Estado inicial al migrar a cartera", no hay
//    historial real que preservar).
//
// 13. R007: el crédito de apertura ($92.000) se mostraba disponible completo, pero el recibo
//    físico 1773 (16-mar-2024) documenta que la tesorería ya lo aplicó ese día: "CUOTA DE
//    SOSTENIMIENTO DE ENERO A DICIEMBRE 2024 (TENÍA SALDO A FAVOR DE $92.000)", pagó $100.000 en
//    efectivo -- $100.000 + $92.000 = $192.000, el año completo. El sistema imputó el efectivo
//    por FIFO cronológico (ene-jun completo + parte de jul) y dejó el crédito sin tocar; el hueco
//    real de 2024 (jul-dic) se terminó cerrando recién con el pago de 2026, dejando diciembre
//    2024 con $12.000 todavía pendientes. Investigado el 2026-08-11/12 (auditoría de entrega):
//    verificado que poner el crédito completo en $0 rompe la conciliación de R007 en exactamente
//    $92.000 (saldoSistema no cambia, pero el target sí, porque paso11-conciliacion.js suma
//    saldoCreditoDisponible al target -- ver su comentario, líneas 34-42). La versión que sí
//    mantiene la conciliación en $0: redimir del crédito exactamente lo que hace falta para
//    cerrar el hueco real todavía abierto (diciembre 2024, $12.000) y dejar el resto ($80.000)
//    como saldo a favor genuino -- mismo mecanismo que CarteraService.redimirCredito (un Abono
//    exigible que imputa contra el cargo, más una fila 'Aplicado' en cuenta_creditos), fechado
//    16-mar-2024 para reflejar cuándo pasó en la realidad, no cuándo se corrió esta corrección.
//
// 14. Limpieza: 198 filas AjusteCategoria erróneas encontradas el 2026-08-12 en la base real,
//    creadas todas en el mismo segundo (2026-08-11 18:38:03) por un comando suelto que nunca
//    quedó versionado -- exactamente el problema que esta corrección viene a prevenir hacia
//    adelante. Afectan a las 7 cuentas suspendidas de PUNTOS-CONFLICTIVOS.md sección 3 (R002,
//    R0501, R0971, S004, S009, S0141, S0441). Confunden CATEGORÍA con CAUSACIÓN: la sección 1.5
//    dice que estas 7 comparten la tarifa vieja de las 4 que sí se corrigieron (C021/R080/R091/
//    S0244) pero que "no se les subió la tarifa" -- decisión de negocio, no un olvido. Su
//    categoría ya era Finca ($10.000, vigente) desde la carga inicial -- eso está bien y no se
//    toca. Pero el CargoMensual histórico (2024-2026) ya estaba correcto a $5.000/mes desde el
//    paso 9 (2026-08-02); las 198 filas de AjusteCategoria, con observación "...causados a
//    $5.000... en vez de $10.000 (tarifa Finca vigente)", duplicaron ese cargo en vez de
//    corregir nada: CargoMensual $5.000 + AjusteCategoria $5.000 = $10.000/mes cobrados, el
//    doble. Se verificó antes de aplicar que ninguna cartera_imputaciones referencia esas 198
//    filas (cero pagos reales tocan la deuda inflada), así que se pueden borrar sin revertir
//    ningún abono. Efecto esperado: la conciliación (paso11) vuelve a cuadrar exacto en las 6
//    cuentas con fila en el Excel (venían con +$155.000 c/u) y la cartera incobrable de la
//    sección 3 vuelve a $3.918.000 (venía en $4.908.000, $990.000 de más).
//
// 15. R0942, recibo 2246: la transferencia real fue de $180.000 (texto del recibo: "TRANSFERENCIA
//    19/06/2025 - $180,000 - SALDO A FAVOR 4,000"), pero el recibo se cargó al sistema por
//    $176.000 -- los $4.000 no quedaron en ninguna parte, ni como deuda pagada ni como crédito.
//    Verificado contra el talonario físico (2026-08-13): es plata real que la asociación
//    recibió y el sistema no reconoce. Se crea como saldo a favor disponible, con la fecha de
//    la transferencia (no la del recibo) y ligado al mismo recibo_detalle del abono real.
//
// 16. R0831: recibos 2159, 2311 y 2407 recalculados juntos, en orden cronológico (2026-08-14,
//    reemplaza la versión del 2026-08-13 que solo atacaba el síntoma). La causa real no era el
//    recibo 2407: era el 2159 ($100.000, 29-mar-2025, concepto "ABONO A DEUDA", sin período
//    declarado). El diseño de paso10 nunca corre FIFO sin período (para no repetir el caso
//    S010/recibo 1825, donde el período era una transcripción errada) -- pero "ABONO A DEUDA"
//    SÍ es una instrucción explícita de pagar deuda, a diferencia de ese caso. Al quedar
//    convertido íntegro en crédito, dejó sin pagar el tramo más viejo de la cuenta, y los dos
//    abonos posteriores (2311 y 2407) se imputaron en cascada contra esa base equivocada --
//    2311 ($412.000, "HASTA DICIEMBRE 2025") terminó pagando de más hacia 2026 por FIFO,
//    dejando a 2407 sin nada real contra qué imputarse. La corrección anterior (deshacer 2
//    imputaciones puntuales de mayo/junio 2025) tapaba el síntoma en 2407 sin tocar la causa.
//    Ahora se recalculan los tres, en orden: 2159 SÍ corre FIFO pese a no tener período (forzado
//    explícitamente, únicamente para este caso), contra el pool COMBINADO (apertura opaca +
//    exigible, la más vieja primero -- alcanza para cerrar completo el opaco de $128.000 más
//    parte de 2024); 2311 y 2407 se reimputan después con su período declarado, igual que
//    siempre. Resultado verificado contra el talonario: deudaAntes2024 $0, deudaExigible $0,
//    cubiertoHasta julio 2026, saldoCreditoDisponible $8.000 -- exactamente el sobrante que el
//    recibo 2407 declaraba, ni un peso más ni menos.
//
// Idempotente: antes de insertar, borra los CargoMensual existentes de la cuenta en los años
// que va a recrear (2024-2026 completos para las 4 de tarifa; solo 2024 para S03311; feb-jul
// 2026 para S058), así que re-ejecutar da el mismo resultado sin duplicar ni acumular montos
// viejos. La asignación de propietario de S0244 solo inserta si la cuenta sigue sin propietario
// activo. Las correcciones 4 a 9 se detectan por si el movimiento/campo que tocan ya quedó en el
// estado corregido (ver cada bloque), así que repetir la corrida no duplica imputaciones ni
// revierte nada. Las correcciones 11 y 12 se detectan por si la vigencia abierta de cuenta_estados
// ya es exactamente la esperada (mismo estado, misma fecha_inicio). La corrección 13 se detecta
// por el pendiente real del cargo de diciembre 2024 de R007: $0 significa que ya corrió (o algo
// más lo cerró), $12.000 significa que hay que aplicarla, cualquier otro valor es un estado
// inesperado y la corrección se detiene con un error en vez de adivinar cuánto redimir. La 14 se
// detecta por si sigue habiendo AjusteCategoria con ese texto exacto (si no hay ninguna, ya
// corrió o nunca existió -- no hace nada). La 15 se detecta por si ya existe un crédito en
// cuenta_creditos ligado al mismo abono_movimiento_id -- mismo mecanismo que cualquier otro
// crédito de este archivo. La 16 se detecta por si el abono del recibo 2159 ya tiene alguna
// imputación real (en el estado original siempre tiene cero, porque quedó convertido íntegro
// en crédito) -- si ya tiene, deshace todo (imputaciones y créditos) de los tres abonos
// involucrados y los recalcula desde cero, así que repetir la corrida no duplica nada. La 17 se
// detecta candidato por candidato: costoPeriodoSinCausar devuelve 0 cuando el período declarado
// ya está totalmente cubierto (por esta corrida o una anterior), así que se salta sin tocar
// nada -- y como candidatosPagoAdelantado() vuelve a consultar cuenta_creditos en cada corrida,
// un candidato ya corregido (sin sobrante) simplemente deja de aparecer la próxima vez.
const { normalizarCodigo } = require('./normalizar');
const { primerDiaDelMes, decodificarPeriodo } = require('../../src/services/cartera/periodos');
const { distribuir, MODOS } = require('../../src/services/cartera/imputacion');
const { redondear, esMayor } = require('../../src/services/cartera/dinero');
const { mesesDelPeriodo, TIPOS_CARGO_COMBINADOS } = require('./paso10-imputacion');

const OBSERVACION_S03311 =
  'Causacion inferida: celda vacia en CARTERA, confirmada por continuidad del saldo';
const OBSERVACION_TARIFA =
  'Tarifa corregida a la vigente 2024: CARTERA mantenia 5.000 (tarifa derogada) por falta de actualizacion';

const CUENTAS_TARIFA_CORREGIDA = ['C021', 'R080', 'R091', 'S0244'];

const PROPIETARIO_S0244 = {
  codigoCuenta: 'S0244',
  nombre_completo: 'ZAPATO MACHADO PEDRO NEL',
  numero_identificacion: '93369009',
  telefono: '3505240204',
  email: 'pedronelza55@gmail.com',
  fechaInicio: '2023-12-31',
  observacionesPropietario: 'Carga inicial de cartera 2026-07: propietario tomado de ' +
    'DatosPropietariosCuentas.xlsx (coincide en cedula/telefono/correo con la fila de S0244 en ' +
    'el Excel de CARTERA, que lo tenia registrado bajo el nombre anterior "MACHADO ZAPATA LUIS ' +
    'HERNANDO"). Ver PUNTOS-CONFLICTIVOS.md seccion 4.',
  observacionesAsignacion: 'Cambio de propietario detectado en la carga inicial de cartera; ' +
    'no habia registro previo en cuenta_propietarios.'
};

const REASIGNACION_RECIBO_2137 = {
  numeroRecibo: 2137,
  codigoCuentaOrigen: 'S0312',
  codigoCuentaDestino: 'S0393',
  periodoDesde: '2025-03',
  periodoHasta: '2025-03'
};

const CORRECCION_PERIODO_RECIBO_2384 = {
  numeroRecibo: 2384,
  periodoDesdeNuevo: 'Enero 2025',
  periodoHastaNuevo: 'Diciembre 2025'
};

// S010: 1659 se elimina (correccion 6); 1825 pasa a abono libre (correccion 7); los tres
// abonos desde 2024 se recalculan juntos, en el orden cronologico real (fecha_pago_real).
const RECALCULO_S010 = {
  cuentaCodigo: 'S010',
  numeroReciboEliminado: 1659,
  numeroReciboLibre: 1825,
  abonosOrdenCronologico: [
    { numeroRecibo: 1825, periodoDesde: null, periodoHasta: null },
    { numeroRecibo: 2151, periodoDesde: '2024-01', periodoHasta: '2024-12' },
    { numeroRecibo: 2302, periodoDesde: '2025-01', periodoHasta: '2025-12' }
  ]
};

const OBSERVACION_APERTURA_S044 =
  'Apertura opaca corregida a 0: los 156.000 originales eran el saldo pendiente del punto de ' +
  'agua (recibo 1296, dic-2022: "PENDIENTE $156.000 DEL PUNTO"), no deuda de sostenimiento -- ' +
  'CARTERA lo arrastro por error en el saldo 31/12/2023. Ese pendiente del punto ya quedo ' +
  'cubierto por los tres abonos de 2024 (recibos 1751, 1815, 1816, 52.000 c/u = 156.000).';

const CORRECCION_APERTURA_S044 = {
  codigoCuenta: 'S044',
  montoNuevo: 0
};

const CORRECCION_PERIODO_RECIBO_2229 = {
  numeroRecibo: 2229,
  periodoDesdeNuevo: 'Enero 2025',
  periodoHastaNuevo: 'Junio 2025'
};

const OBSERVACION_SUSPENSION_SIN_CARTERA =
  'No localizada en el barrido de campo; sin fila en CARTERA. Suspendida en la carga inicial.';

// Fecha de suspensión = mes siguiente al último recibo real de cada cuenta (ver comentario de
// la corrección 11 arriba para el porqué).
//
// R031 YA NO está en esta lista: se creía una cuenta real sin fila en CARTERA, pero es un
// código mal digitalizado de R0301 (ver corrección 34) -- no una cuenta que deba suspenderse,
// sino una que no debería existir. La corrección 34 la elimina directamente; dejarla aquí
// también haría que esta corrección fallara ("no existe en la base") en cualquier corrida
// posterior a que la 34 ya la haya borrado.
const SUSPENSIONES_SIN_CARTERA = [
  { codigoCuenta: 'O40-1', fechaInicio: '2018-01-01' },
  { codigoCuenta: 'R0103', fechaInicio: '2020-01-01' },
  { codigoCuenta: 'R0401', fechaInicio: '2018-05-01' },
  { codigoCuenta: 'S0101', fechaInicio: '2020-09-01' },
  { codigoCuenta: 'S061', fechaInicio: '2021-05-01' },
  { codigoCuenta: 'S091', fechaInicio: '2021-06-01' }
];

const OBSERVACION_INACTIVA_S063 =
  'Fusionada con S0365 ("punto no existe, punto verdadero S0365" segun CARTERA): decision ya ' +
  'tomada en la carga inicial (ver observaciones de la cuenta), pero el estado se quedo en ' +
  'Activo por descuido -- corregido acá.';

const INACTIVA_FUSIONADA_S063 = { codigoCuenta: 'S063', fechaInicio: '2026-06-27' };

const OBSERVACION_REDENCION_R007 =
  'Redime $12.000 del credito de apertura contra el hueco real de diciembre 2024, ' +
  'reconstruyendo lo que la tesoreria hizo el 16-mar-2024 segun el recibo 1773: "CUOTA DE ' +
  'SOSTENIMIENTO DE ENERO A DICIEMBRE 2024 (TENIA SALDO A FAVOR DE $92.000)" -- pago $100.000 ' +
  'en efectivo + $92.000 de credito = $192.000, el año 2024 completo. El sistema solo aplico el ' +
  'efectivo por FIFO cronologico y dejo el credito sin tocar; el hueco real se termino cerrando ' +
  'con el pago de 2026, dejando diciembre 2024 con $12.000 pendientes y el credito completo ' +
  'mostrandose disponible pese a que ya se habia usado. Deja $80.000 como saldo a favor genuino. ' +
  'Verificado 2026-08-12: la conciliacion contra CARTERA.xlsx sigue en $0 (paso11-conciliacion.js).';

const REDENCION_R007 = {
  codigoCuenta: 'R007',
  anio: 2024,
  mes: 12,
  montoARedimir: 12000,
  fecha: '2024-03-16'
};

// 18. R007: el saldo a favor restante ($80.000, después de la corrección 13) no es un sobrepago
//    genuino sin destino -- es el resto del recibo 2470 (11-abr-2026, "ENERO A DICIEMBRE 2026",
//    $192.000). paso10-imputacion.js solo encontró causado enero-julio 2026 ($112.000); el
//    sobrante ($80.000) cayó al FIFO general de la cuenta y pagó el hueco de julio-diciembre
//    2024 en vez de quedarse cubriendo su propio año. Investigado 2026-08-18: agosto-diciembre
//    2026 (5 meses x $16.000 = $80.000, exacto) nunca se causaron -- ni en la carga inicial
//    (tope real julio 2026) ni después, porque no hay causación automática -- así que
//    calcularAPagar los sigue mostrando "a pagar" en vivo pese a que el recibo ya los pagó.
//    Mismo mecanismo que la corrección 17 (asegurarCausacion + redimirCredito, MesesEspecificos)
//    pero bespoke, no query-driven: este crédito no está ligado al recibo 2470
//    (recibo_detalle_id es null, viene de la apertura opaca de 2023-12-31), así que
//    candidatosPagoAdelantado() nunca lo iba a encontrar solo.
const OBSERVACION_REDENCION_R007_2026 =
  'Redime los $80.000 de credito restantes (ver correccion 13) contra agosto-diciembre 2026, el ' +
  'tramo que el recibo 2470 (11-abr-2026, "ENERO A DICIEMBRE 2026", $192.000) declaro pagar pero ' +
  'que paso10-imputacion.js nunca causo -- el sobrante de ese pago se desvio por FIFO hacia el ' +
  'hueco de 2024 en vez de quedarse en su propio año. Investigado 2026-08-18. Deja cubierto hasta ' +
  'diciembre 2026, $0 a pagar, $0 de saldo a favor.';

const REDENCION_R007_2026 = {
  codigoCuenta: 'R007',
  hasta: { anio: 2026, mes: 12 },
  montoARedimir: 80000,
  fecha: '2026-04-11'
};

// 19. REAJUSTE 2024 sin período: cuando la tarifa subió de $5.000 a $10.000 en enero 2024,
//    varias cuentas pagaron primero a la tarifa vieja y llevaron un segundo recibo "de
//    reajuste" para completar la diferencia -- patrón encontrado en 47 recibos de 32 cuentas
//    (investigado 2026-08-19). De esos, 13 quedaron sin período declarado en el concepto
//    (texto tipo "PAGO REAJUSTE 2024", sin mes explícito) -- 10 ya se habían imputado bien
//    (procesados antes del cambio de diseño 2026-08-04, que exige período para que el FIFO de
//    respaldo corra); solo 3 quedaron sin redimir, con evidencia verificada contra el
//    talonario físico:
//    - S0334 (recibo 2067, 1-feb-2025, $60.000, "PAGO REAJUSTE 2024"): el recibo anterior
//      (1646, 27-ene-2024) dice literalmente "PENDIENTE REAJUSTE 2024" -- pagó 12 meses a
//      $5.000 (tarifa vieja) y quedó debiendo la diferencia. $60.000 calza exacto contra el
//      hueco real julio-diciembre 2024 (6 meses x $10.000).
//    - S039 (recibo 2068, 1-feb-2025, $60.000, "PAGO REAJUSTE 2024"): mismo patrón textual,
//      mismo tesorero, mismo día que S0334. El hueco real (junio-diciembre 2024) es de
//      $61.000 -- junio quedó con $1.000 pendiente (el pago inicial fue $59.000, un mes menos
//      que S0334) -- y esta cuenta además tiene, aparte, un crédito de apertura de $1.000
//      (2023-12-31) sin relación con el reajuste. Los dos créditos juntos ($60.000 + $1.000)
//      calzan exacto contra el hueco de $61.000.
//    - S0271 (recibo 2021, 28-dic-2024, $60.000, "PAGO REAJUSTE 2024"): a diferencia de las
//      dos anteriores, acá el pago inicial (recibo 1693) ya estaba a la tarifa vigente de
//      $10.000 -- no hay "tarifa vieja" que reajustar. Solo $20.000 de los $60.000 tienen un
//      hueco real contra el cual calzar (noviembre-diciembre 2024, el tramo que ni el recibo
//      1693 -- que llega hasta octubre 2024 -- ni el 1984 -- que empieza en enero 2025 --
//      cubren). Los otros $40.000 no tienen evidencia de a qué corresponden (la cuenta además
//      arrastra $500.000 de deuda opaca anterior a 2024, sin relación con esto): se redimen
//      solo los $20.000 que calzan, y el resto queda como crédito disponible sin tocar,
//      marcado para que la junta lo revise -- mismo tratamiento que los 4 créditos "no
//      consumidos" ya documentados (S0331, R028, R070, R086).
const REDENCIONES_REAJUSTE_2024 = [
  {
    codigoCuenta: 'S0334', desde: { anio: 2024, mes: 7 }, hasta: { anio: 2024, mes: 12 },
    montoARedimir: 60000, fecha: '2025-02-01',
    observaciones:
      'Redime $60.000 del recibo 2067 ("PAGO REAJUSTE 2024") contra julio-diciembre 2024: el ' +
      'recibo 1646 pagó 12 meses a la tarifa vieja ($5.000, "PENDIENTE REAJUSTE 2024") y este ' +
      'completa la diferencia a la tarifa vigente ($10.000). Sin período declarado, había ' +
      'quedado como credito sin aplicar. Investigado 2026-08-19.'
  },
  {
    codigoCuenta: 'S039', desde: { anio: 2024, mes: 6 }, hasta: { anio: 2024, mes: 12 },
    montoARedimir: 61000, fecha: '2025-02-01',
    observaciones:
      'Redime $61.000 ($60.000 del recibo 2068 "PAGO REAJUSTE 2024" + $1.000 de un credito de ' +
      'apertura aparte) contra junio-diciembre 2024: el recibo 1645 pagó 12 meses a la tarifa ' +
      'vieja ($5.000, "PENDIENTE REAJUSTE 2024") y este completa la diferencia a la tarifa ' +
      'vigente ($10.000). Sin período declarado, había quedado como credito sin aplicar. ' +
      'Investigado 2026-08-19.'
  },
  {
    codigoCuenta: 'S0271', desde: { anio: 2024, mes: 11 }, hasta: { anio: 2024, mes: 12 },
    montoARedimir: 20000, fecha: '2024-12-28',
    observaciones:
      'Redime $20.000 (de los $60.000) del recibo 2021 ("PAGO REAJUSTE 2024") contra ' +
      'noviembre-diciembre 2024, el unico hueco real que calza. Los $40.000 restantes no ' +
      'tienen evidencia de a que corresponden y quedan como credito disponible, para revision ' +
      'de la junta. Investigado 2026-08-19.'
  }
];

// 20. S023: el recibo 1627 (18-ene-2024, "PAGA DEUDA PENDIENTE", $15.000) declaraba pagar la
//    deuda opaca de apertura (identica en monto: $15.000 al 31-dic-2023), pero al no tener
//    periodo declarado el sistema lo guardo integro como credito sin aplicar. El siguiente
//    recibo (1759, 2-mar-2024, "ENERO A JUNIO 2024", $100.000) barrio por FIFO cronologico esa
//    misma deuda opaca de apertura + el ajuste de categoria de $4.000, dejando julio 2024 (el
//    mes que ese FIFO desplazo, "sandwich" entre junio 2024 cubierto y agosto 2024 cubierto por
//    el recibo 2029, 28-dic-2024, "AGOSTO A DICIEMBRE 2024") con $15.000 sin cubrir. El credito
//    varado calza exacto contra ese hueco. Investigado 2026-08-19 contra el talonario fisico.
//    Aplicada contra la base real 2026-08-19: como con la correccion 19, paso11-conciliacion.js
//    muestra un residuo pequeño ($1.000) tras aplicarla, porque su target usa el snapshot
//    congelado del 14-ago-2024 (snapshot_captura), no el credito en vivo -- mismo mecanismo de
//    fondo que las diferencias ya documentadas de S0334/S039/S0271, no un error de esta
//    correccion (verificado con getEstadoCartera: saldoAFavor=0, deudaExigible correcta).
const OBSERVACION_REDENCION_S023 =
  'Redime $15.000 del recibo 1627 (18-ene-2024, "PAGA DEUDA PENDIENTE") contra julio 2024, el ' +
  'unico mes con hueco real. El recibo declaraba pagar la deuda opaca pre-2024 ($15.000, monto ' +
  'identico a la apertura opaca), pero el sistema lo guardo integro como credito sin aplicar ' +
  '(sin periodo declarado). El siguiente recibo (1759, 2-mar-2024, "ENERO A JUNIO 2024", ' +
  '$100.000) barrio por FIFO esa misma deuda opaca de apertura + el ajuste de categoria, dejando ' +
  'julio 2024 con $15.000 sin cubrir cuando el recibo 2029 (28-dic-2024) siguio con ' +
  'agosto-diciembre 2024. El credito de $15.000 calza exacto contra ese hueco. Investigado ' +
  '2026-08-19.';

const REDENCION_S023 = {
  codigoCuenta: 'S023',
  desde: { anio: 2024, mes: 7 },
  hasta: { anio: 2024, mes: 7 },
  montoARedimir: 15000,
  fecha: '2024-01-18'
};

// 21-22. Dos huecos mas, cada uno con un recibo cuyo propio concepto nombra el mes exacto del
//    hueco -- misma calidad de evidencia que S023, investigados 2026-08-19 contra el talonario
//    fisico. A diferencia de S023 (calce exacto), en ambos el credito disponible excede el monto
//    a redimir: se redime solo lo que calza contra el hueco real y el resto queda documentado
//    como credito sin tocar, para revision de la junta (mismo tratamiento que S0271, correccion 19).
//    - S0501 (recibo 1793, 6-abr-2024, $20.000, "CU0TA DE SOSTENIMIENTO MARZO Y ABRIL"): el
//      concepto declara dos meses (marzo Y abril 2024) pero el periodo se guardo como un solo
//      mes (marzo=marzo), asi que el recibo entero cayo a credito sin aplicar. Marzo 2024 se
//      termino cubriendo por otra via (el sobrante del recibo 2194, "FEBRERO A MARZO 2025",
//      11-may-2025) antes de que este credito se tocara, asi que solo abril 2024 sigue siendo un
//      hueco real ($10.000); los otros $10.000 no tienen destino claro.
//    - S022 (recibo 2394, 24-ene-2026, $100.000, concepto real "...Y ENERO A FEBRERO 2026"): el
//      periodo guardado en la base no capturo esa segunda clausula, y el FIFO de respaldo desvio
//      2 de los 10 meses declarados hacia una deuda vieja real (febrero-marzo 2024, que si estaba
//      pendiente) en vez de completar hasta febrero 2026 como el concepto promete. Enero-febrero
//      2026 quedan con $20.000 sin cubrir, calzando exacto contra $20.000 de los $100.000 en
//      credito varado que arrastran dos recibos "ABONO A LA DEUDA" sin periodo (1692 y 1813,
//      ambos de 2024). Los $80.000 restantes no tienen destino claro.
//    Aplicadas contra la base real 2026-08-19: S0501 concilia exacto ($0). S022 muestra un
//    residuo de -$10.000 en paso11-conciliacion.js -- mismo mecanismo del snapshot congelado del
//    14-ago-2024 ya documentado en S023/S0334/S039/S0271, no un error de esta correccion
//    (verificado con getEstadoCartera: cubiertoHasta avanza sin huecos, saldoAFavor documentado).
const REDENCIONES_HUECO_TEXTUAL_2026 = [
  {
    codigoCuenta: 'S0501', desde: { anio: 2024, mes: 4 }, hasta: { anio: 2024, mes: 4 },
    montoARedimir: 10000, fecha: '2024-04-06',
    observaciones:
      'Redime $10.000 (de los $20.000) del recibo 1793 ("CU0TA DE SOSTENIMIENTO MARZO Y ABRIL") ' +
      'contra abril 2024, el unico mes con hueco real -- marzo 2024 ya se cubrio por otra via ' +
      '(recibo 2194) antes de que este credito se tocara. Los $10.000 restantes no tienen ' +
      'evidencia de a que corresponden y quedan como credito disponible, para revision de la ' +
      'junta. Investigado 2026-08-19.'
  },
  {
    codigoCuenta: 'S022', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 2 },
    montoARedimir: 20000, fecha: '2026-01-24',
    observaciones:
      'Redime $20.000 (de los $100.000) de credito varado (recibos 1692 y 1813, "ABONO A LA ' +
      'DEUDA" sin periodo, ambos de 2024) contra enero-febrero 2026 -- el tramo que el recibo ' +
      '2394 ("...Y ENERO A FEBRERO 2026") declaro pagar pero el FIFO de respaldo desvio hacia ' +
      'una deuda vieja real de 2024. Los $80.000 restantes no tienen evidencia de a que ' +
      'corresponden y quedan como credito disponible, para revision de la junta. Investigado ' +
      '2026-08-19.'
  }
];

const FRAGMENTO_AJUSTE_ERRONEO_SUSPENDIDAS = 'Corrección: meses desde 2024-01 causados a $5.000';
const CUENTAS_SUSPENDIDAS_SIN_RECAUSAR = ['R002', 'R0501', 'R0971', 'S004', 'S009', 'S0141', 'S0441'];

// 23. Cuenta fantasma "R0081": codigos.js documentaba (2026-07-31) que R0081 era la MISMA cuenta
//    que S058 y que nunca debía crearse aparte -- pero sí se creó (id distinto, fuera del flujo
//    de huérfanos: fecha_creacion 2026-07-31, con coordenadas GPS reales de un barrido de campo,
//    algo que ninguna cuenta creada por la importación histórica trae). Investigado 2026-08-20:
//    R0081 es la cuenta real (dirección "Vereda El Rodeo", propietaria "ARIAS MORENO MARTHA
//    LUCIA" desde 2023-12-31) y S058 es la duplicada que sí vino de la importación histórica del
//    talonario (mismo nombre, "ARIAS MARTHA LUCIA", sin coordenadas, creada 2026-06-27) --
//    exactamente al revés de lo que asumía codigos.js. Decisión: mover a R0081 lo único real y
//    no duplicado que tiene S058 (el recibo 2400 del punto, $500.000, y su fila en
//    `nuevos_puntos`) y eliminar S058. Los 6 CargoMensual de S058 (feb-jul 2026, $10.000 c/u) NO
//    se mueven -- son duplicados exactos de los 6 que R0081 ya tiene por su cuenta (misma deuda
//    real, cobrada dos veces); moverlos doblaría la deuda de la persona. cuenta_propietarios,
//    cuenta_estados y cuenta_categorias de S058 tampoco se mueven -- R0081 ya tiene sus propias
//    filas (más antiguas y más completas) para las tres. Esto también retira la corrección 10
//    (CAUSACION_S058): dejaba de tener sentido recrear cargos para una cuenta que se elimina, y
//    R0081 ya causa esos mismos 6 meses por su cuenta, sin necesitar la corrección.
const OBSERVACION_MERGE_R0081_S058 =
  'Recibo movido de S058 (cuenta duplicada, eliminada) a R0081 (cuenta real, con coordenadas de ' +
  'campo). codigos.js asumia lo contrario -- corregido 2026-08-20 tras verificar cual de las dos ' +
  'tenia datos de campo reales.';

const MERGE_R0081_S058 = { codigoOrigen: 'S058', codigoDestino: 'R0081', numeroReciboPunto: 2400 };

// 24. S0312: reimputar los recibos 2191 y 2362 en el orden cronológico correcto, ahora que la
//    corrección 4 le quitó el recibo 2137 (que nunca fue suyo, ver más arriba). Cuando el paso 10
//    corrió por primera vez, el 2137 SÍ estaba asignado a S0312 en ese momento (la corrección 4 lo
//    reasigna DESPUÉS), así que su FIFO de respaldo pagó por adelantado casi todo 2025-2026 antes
//    de que se procesaran el 2191 (30-jul-2025, "ENERO A MARZO 2025", $30.000) y el 2362
//    (3-ene-2026, "ABRIL 2025 A DICIEMBRE 2026", $210.000) -- a esos dos no les quedó nada
//    pendiente contra qué aplicar su propio período declarado, y el sobrante de cada uno se fue a
//    donde el FIFO general encontró hueco (2191 terminó pagando mayo-julio 2026; el 2362, sin
//    ningún hueco que cubrir en ningún lado, quedó íntegro como crédito sin aplicar).
//    La corrección 4 deshizo la imputación del 2137, pero nunca volvió a correr el 2191 ni el 2362
//    contra los meses que el 2137 dejó de cubrir -- por eso persistía esta diferencia de
//    $270.000 en `npm run conciliacion` pese a que S0312 ya no recibe nada del 2137.
//    Se deshace la imputación actual de ambos (2191 primero, 2362 después, mismo orden
//    cronológico que usó el paso 10 originalmente) y se rehace con el mismo mecanismo
//    (`distribuir` + `mesesDelPeriodo`, período primero) -- nunca a mano.
//
//    2191 cubre enero-marzo 2025 exacto, sin sobrante -- no hay nada más que decidir ahí.
//
//    2362 SÍ necesita una decisión, revisada 2026-08-20 después de que el usuario señaló que el
//    primer intento (dejar que el sobrante cayera al FIFO general, como hace el sistema por
//    defecto) no tenía sentido: el propio recibo declara "ABRIL 2025 A DICIEMBRE 2026" -- una
//    intención específica de cubrir esos meses, no de pagar deuda de antes de 2024 (de la que el
//    recibo no dice una palabra). De los 21 meses que declara, solo 16 (abril 2025-julio 2026)
//    existen hoy como CargoMensual -- agosto a diciembre 2026 todavía no se causan (regla pareja
//    para todas las cuentas: los últimos 5 meses del año nunca se causan por adelantado). El FIFO
//    general, por diseño del sistema ("quien paga, salda primero lo viejo"), habría tomado esos
//    $50.000 sobrantes y los habría aplicado contra la deuda de apertura -- técnicamente válido
//    como regla general, pero contradice la evidencia específica de ESTE recibo. Por eso acá se
//    desactiva el FIFO de respaldo (`permitirFifoConPeriodo: false`) y el sobrante se deja como
//    crédito explícito, documentado como reservado para agosto-diciembre 2026 -- listo para
//    aplicarse cuando esos meses se causen, en vez de perderse dentro de la apertura.
//    Resultado final, verificado en copia aislada: enero-marzo 2025 (2191) y abril-julio 2026
//    (2362) quedan pagados. La deuda de apertura queda en $110.000 (sin tocar -- el 2362 nunca la
//    toca). Queda un crédito de $50.000, reservado y visible, no un saldo a favor genérico.
const OBSERVACION_REIMPUTACION_S0312_2191 =
  'Reimputado tras la reasignacion del recibo 2137 (correccion 4): el periodo declarado (enero a ' +
  'marzo 2025) no tenia nada pendiente contra que aplicarse porque el 2137 (que en ese momento SI ' +
  'estaba asignado a esta cuenta) ya lo habia cubierto por adelantado. Investigado y verificado en ' +
  'copia aislada 2026-08-20.';

const OBSERVACION_REIMPUTACION_S0312_2362 =
  'Reimputado tras la reasignacion del recibo 2137 (correccion 4). El recibo declara "ABRIL 2025 A ' +
  'DICIEMBRE 2026" -- cubre abril 2025 a julio 2026 (los 16 meses que hoy existen como cargo). El ' +
  'sobrante de $50.000 (para agosto-diciembre 2026, que todavia no se causan) queda como credito ' +
  'reservado para esos meses -- a proposito NO se aplica contra la deuda de apertura (2022-2023): ' +
  'el recibo nunca menciona esa deuda, y aplicarlo ahi habria ignorado la intencion explicita del ' +
  'propio texto. Investigado y verificado en copia aislada 2026-08-20.';

const REIMPUTACION_S0312 = {
  codigoCuenta: 'S0312',
  recibos: [
    { numeroRecibo: 2191, periodoDesde: '2025-01', periodoHasta: '2025-03', permitirFifoConPeriodo: true, observaciones: OBSERVACION_REIMPUTACION_S0312_2191 },
    { numeroRecibo: 2362, periodoDesde: '2025-04', periodoHasta: '2026-12', permitirFifoConPeriodo: false, observaciones: OBSERVACION_REIMPUTACION_S0312_2362 }
  ]
};

// 25. R049: ver comentario junto a REDENCION_S023 (mismo patrón -- hueco real que un recibo
//    posterior, sin período declarado, alcanza a cubrir). Investigado 2026-08-19, confirmado
//    2026-08-20 contra CARTERA.xlsx directamente: la cuenta no trae saldo a favor en el Excel
//    (debía $120.000 a su corte), así que enero-mayo 2025 es un hueco real, no algo inventado.
const OBSERVACION_REDENCION_R049 =
  'Redime $50.000 (de los $100.000 disponibles del recibo 1677, 06-feb-2024, "ABONO A LA DEUDA", ' +
  'sin periodo) contra enero-mayo 2025, el hueco real de la cuenta. El recibo 2113 (01-mar-2025, ' +
  '$635.000) cubre aparte apertura completa + enero-julio 2024 + junio 2025 -- calce exacto al ' +
  'peso, sin dejar nada para enero-mayo 2025. Verificado contra CARTERA.xlsx: sin saldo a favor ' +
  'en el Excel, coincide con que el hueco es real. Investigado 2026-08-19/20.';

const REDENCION_R049 = {
  codigoCuenta: 'R049',
  desde: { anio: 2025, mes: 1 },
  hasta: { anio: 2025, mes: 5 },
  montoARedimir: 50000,
  fecha: '2024-02-06'
};

// 26. Recibo 458 (S0331, 18-feb-2019, $300.000, "PAGO PUNTO DE AGUA"): reasignar a S03311.
//    S0331 tiene DOS recibos de punto por $300.000 (04-ene-2019 y 18-feb-2019); el primero ya
//    coincide con la fecha que el sistema tiene registrada como "punto de S0331 pagado". El
//    segundo no tenía ningún destino -- nunca tocó cartera_movimientos ni cuenta_creditos (los
//    pagos de punto no pasan por ahí, viven solo en nuevos_puntos), así que reasignarlo NO
//    cambia el saldo a favor de S0331 (ese saldo viene de otro lado, sostenimiento, verificado
//    2026-08-20). S03311 (mismo nombre de propietario, código casi idéntico) tiene su punto
//    marcado "Pagado" pero con fecha sintética (31-dic-2023, sin recibo real detrás) -- este
//    recibo le da respaldo documental real. Confirmado por el usuario 2026-08-20: "reasignar el
//    recibo para que sea dinero del otro punto, para que no salga deuda pendiente" (opción a).
const OBSERVACION_REASIGNACION_458 =
  'Reasignado desde S0331: la cuenta tenia dos recibos de punto por $300.000 (04-ene y 18-feb de ' +
  '2019); el segundo (este) no tenia destino en S0331 -- el punto de S03311 estaba marcado ' +
  '"Pagado" con fecha sintetica sin recibo real detras. Este recibo le da respaldo documental ' +
  'real. No mueve plata "utilizable" (los pagos de punto no pasan por cartera_movimientos). ' +
  'Confirmado por el usuario 2026-08-20.';

const REASIGNACION_RECIBO_458 = {
  numeroRecibo: 458, codigoCuentaOrigen: 'S0331', codigoCuentaDestino: 'S03311', fechaRealPago: '2019-02-18'
};

// 27. Siete cuentas "probablemente incobrables" (R002, R0501, R0971, S004, S009, S0141, S0441):
//    la carga inicial (2026-07-31) ya las había marcado Suspendidas, pero desde 2026-08-01 "no
//    retroactiva" -- a propósito, para que la junta viera la cifra acumulada 2024-jul.2026 antes
//    de decidir qué hacer. El usuario ya decidió (2026-08-20): mover la suspensión al mes
//    siguiente al último pago real de cada una (o, para las 4 que nunca pagaron nada, al inicio
//    de toda causación posible -- "como si nunca hubieran debido nada"). Se mueve la fecha de la
//    vigencia Suspendida ya existente (no se crea una nueva) y se borran los CargoMensual que
//    quedan dentro del nuevo rango suspendido -- verificado 2026-08-20 que ninguno de los 7 tiene
//    ni una sola imputación real encima (nadie ha pagado nada desde 2024), así que no hay riesgo
//    de perder un pago real.
//    PENDIENTE (no resuelto en esta corrección): las 4 que nunca pagaron nada (R002, R0501, S009,
//    R0971) sí tienen deuda de apertura (antes de 2024) documentada -- $600.000, $600.000,
//    $600.000 y $345.000 respectivamente, tomada directo de CARTERA.xlsx. Esta corrección NO la
//    toca -- falta que el usuario confirme si "como si nunca hubieran debido nada" también debe
//    incluir esa deuda vieja, o si se queda (igual que en S004/S0441/S0141, donde la deuda de
//    antes del último pago real sí se conserva).
const OBSERVACION_SUSPENSION_INCOBRABLES =
  'Fecha de suspension movida al mes siguiente al ultimo pago real (o al inicio de toda causacion ' +
  'posible, para las que nunca pagaron nada) -- decision del usuario 2026-08-20, para que no ' +
  'siga generando cartera desde 2024 una cuenta probablemente incobrable. Los CargoMensual que ' +
  'quedan dentro del nuevo rango suspendido se borran (verificado: ninguno tenia imputacion real).';

const SUSPENSION_INCOBRABLES = [
  { codigoCuenta: 'S004', fechaInicio: '2021-07-01' },
  { codigoCuenta: 'S0441', fechaInicio: '2019-01-01' },
  { codigoCuenta: 'S0141', fechaInicio: '2023-01-01' },
  { codigoCuenta: 'R002', fechaInicio: '2022-01-01' },
  { codigoCuenta: 'R0501', fechaInicio: '2022-01-01' },
  { codigoCuenta: 'S009', fechaInicio: '2022-01-01' },
  { codigoCuenta: 'R0971', fechaInicio: '2022-01-01' }
];

// 28. Recibo 1284 (S0244, 03-dic-2022, $60.000): faltaba por completo en la base. Encontrado por
//    el cruce automático del talonario completo (ronda 3, 2026-08-19): código de cuenta en
//    blanco en el talonario ("SIN CODIFICAR"), pero el nombre sí está escrito ("ZAPATA MACHADO
//    PEDRO"), que coincide con S0244 ("ZAPATO MACHADO PEDRO NEL"). Confirmado por el usuario
//    2026-08-20. El concepto ("CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2021") es anterior a
//    2024 y no tiene ningún CargoMensual de 2021 contra qué aplicarse (esa deuda vive solo en el
//    bulto opaco) -- se deja que el mismo mecanismo de siempre (reimputarAbono, período primero,
//    FIFO con el sobrante) lo resuelva: el período no encuentra nada, así que el FIFO general lo
//    aplica contra lo más viejo pendiente, que es exactamente la apertura opaca (fechada antes
//    que cualquier CargoMensual) -- el resultado correcto para un recibo que paga deuda de 2021.
// Corrección 35 (2026-08-29) acortó este texto: la referencia al proceso interno de
// reconciliación ("encontrado por el cruce automático... ronda 3, 2026-08-19") no le aporta nada
// a quien consulta el recibo desde la pantalla de Recibos -- esa trazabilidad ya queda
// documentada en este script. OBSERVACION_RECIBO_S0244_ORIGINAL (más abajo) conserva el texto
// viejo solo para localizar y corregir la fila que ya quedó escrita en producción con él.
const OBSERVACION_RECIBO_S0244 =
  'Recibo del talonario fisico que nunca se cargo a la base. Codigo en blanco en el talonario ' +
  '("SIN CODIFICAR"), identificado por el nombre del propietario. Confirmado por el usuario ' +
  '2026-08-20.';

const OBSERVACION_RECIBO_S0244_ORIGINAL =
  'Recibo del talonario fisico que nunca se cargo a la base -- encontrado por el cruce automatico ' +
  'del talonario completo contra la base (ronda 3, 2026-08-19). Codigo en blanco en el talonario ' +
  '("SIN CODIFICAR"), identificado por el nombre del propietario. Confirmado por el usuario ' +
  '2026-08-20.';

const RECIBO_FALTANTE_S0244 = {
  numeroRecibo: 1284, codigoCuenta: 'S0244', fecha: '2022-12-03', valor: 60000,
  concepto: 'PAGA CUOTA DE SOSTENIMIENTO ENERO 2021 A DICIEMBRE 2021',
  periodoDesde: '2021-01', periodoHasta: '2021-12'
};

// 29. Las 4 cuentas de la corrección 27 que nunca pagaron nada (R002, R0501, S009, R0971):
//    decisión del usuario 2026-08-20, ampliando "como si nunca hubieran debido nada" a también
//    la deuda de apertura (antes de 2024) que trae CARTERA.xlsx -- $600.000, $600.000, $600.000
//    y $345.000 respectivamente. A diferencia de S004/S0441/S0141 (que sí pagaron algo real y
//    conservan su deuda de apertura), estas 4 no tienen ni un pago real conocido, así que
//    quedan en 0 igual que su tramo 2024+ (corrección 27): "cuentas suspendidas, que no
//    sabemos nada, no existen".
const OBSERVACION_APERTURA_INCOBRABLES =
  'Apertura opaca (antes de 2024) puesta en 0: decision del usuario 2026-08-20 -- "como si nunca ' +
  'hubieran debido nada", cuenta suspendida sin ningun pago real conocido desde el barrido de ' +
  'campo. Ver correccion 27.';

const APERTURA_INCOBRABLES = ['R002', 'R0501', 'S009', 'R0971'];

// 30. R0948 (Luz Stella Gómez) y R0949 (Alfonso Torres Vásquez): dos conexiones nuevas de 2026
//    que el talonario físico ya registra (recibos 2560 y 2562, ambos "ABONO PUNTO NUEVO DE
//    AGUA", $100.000, 08-ago-2026) pero que nunca se dieron de alta en el sistema -- encontradas
//    por el cruce automático del talonario completo (ronda 3, 2026-08-19, sección "cuenta no
//    resuelta" de cruce-colillas-vs-db.md). Confirmado por el usuario: crearlas mínimas, sin
//    cédula/teléfono/correo ("se actualiza después"); precio del punto $500.000 (confirmado
//    2026-08-20, precio vigente hoy). Categoría Finca por defecto -- sin dato de campo que diga
//    lo contrario, mismo criterio que el resto de cuentas nuevas sin barrido (ver
//    CATEGORIA_POR_TIPO en preview.js). Sin AperturaOpaca ni CargoMensual: son conexiones nuevas
//    sin ningún historial anterior a agosto 2026 -- la causación de sostenimiento sigue el curso
//    normal del sistema (regla de negocio: el mes siguiente a la instalación), no algo que esta
//    corrección deba anticipar.
// Corrección 35 (2026-08-29) acortó este texto -- mismo motivo que OBSERVACION_RECIBO_S0244 y
// OBSERVACION_RECIBO_FALTANTE_2026 más arriba. Este queda escrito en 5 tablas distintas (cuentas,
// cuenta_estados, recibos, nuevos_puntos, nuevo_punto_abonos): la corrección 35 lo busca y
// acorta en las 5.
const OBSERVACION_CUENTA_NUEVA_2026 =
  'Cuenta creada por una conexión nueva de 2026 que el talonario ya registraba pero que no ' +
  'estaba dada de alta en el sistema. Mínima, sin cédula/teléfono/correo -- confirmado por el ' +
  'usuario que se actualiza después. Categoría Finca por defecto, sin dato de campo que diga lo ' +
  'contrario.';

const OBSERVACION_CUENTA_NUEVA_2026_ORIGINAL =
  'Cuenta creada por el cruce automatico del talonario completo (ronda 3, 2026-08-19): conexion ' +
  'nueva de 2026 que el talonario ya registraba pero que no estaba dada de alta en el sistema. ' +
  'Minima, sin cedula/telefono/correo -- confirmado por el usuario que se actualiza despues. ' +
  'Categoria Finca por defecto, sin dato de campo que diga lo contrario.';

const VALOR_PUNTO_NUEVO_2026 = 500000;
const FECHA_CUENTAS_NUEVAS_2026 = '2026-08-08';

const CUENTAS_NUEVAS_2026 = [
  { codigo: 'R0948', nombre: 'LUZ STELLA GOMEZ', numeroRecibo: 2560 },
  { codigo: 'R0949', nombre: 'ALFONSO TORRES VASQUEZ', numeroRecibo: 2562 }
];

// 32. 15 recibos reales del talonario físico (encontrados por el cruce automático completo,
// ronda 3, 2026-08-19 -- ver scripts/import-cartera/output/cruce-colillas-vs-db.md, sección
// "no_encontrado_en_db") que nunca se dieron de alta en el sistema. Confirmado por el usuario
// 2026-08-21: "todos los recibos deben de estar".
//
// 12 de los 15 (todos menos S015/2549, S0292/2551 y R0942/2563) coinciden EXACTO contra lo que
// de verdad falta causar en cada cuenta -- verificado mes a mes contra `cartera_movimientos`, no
// solo contra el texto del recibo (ver RECIBOS_FALTANTES_2026, campo `monto` vs. lo que arroja
// sumar los cargos pendientes del rango declarado). Los otros tres necesitaron revisión aparte:
//
// - 2549 (S015, "Enero a Diciembre 2026", $120.000): enero-julio ya estaban pagados por otros
//   dos recibos (2152 y 2301) cuyo sobrante llegó ahí por FIFO -- mismo patrón investigado toda
//   la sesión, no un error (ver corrección 31). Solo agosto-diciembre ($50.000) estaba
//   realmente pendiente dentro del rango declarado; el resto ($70.000) del efectivo recibido
//   queda como saldo a favor real -- mismo mecanismo que cualquier sobrante de `registrarAbono`,
//   no se inventa ni se pierde.
// - 2551 (S0292, "Abono a Punto Nuevo"): no es sostenimiento, es un abono al punto de conexión
//   ya existente de esta cuenta (saldo pendiente $300.000 antes de este abono).
// - 2563 (R0942, "Marzo a Diciembre 2026 (TENIA $4.000 A FAVOR)"): el paréntesis del propio
//   recibo coincide exacto con el crédito de $4.000 que ya se había encontrado y documentado en
//   la corrección 14 de esta misma sesión -- $156.000 en efectivo + esos $4.000 = $160.000, el
//   valor exacto de los 10 meses (mar-dic 2026 a $16.000/mes).
//
// 2550 (código crudo del talonario "S038", $60.000): al principio se dejó afuera porque la
// tarifa de S038 (Finca con piscina, $16.000/mes) necesitaba $80.000 para julio-diciembre 2026,
// $20.000 más de lo que trae el recibo. Confirmado por el usuario 2026-08-21: el código
// "S038" es un error de transcripción del talonario/Excel -- la cuenta real es **S0383**
// (propietaria "Galindo Jhon Eduardo", coincide exacto con el nombre del recibo "JHON EDUARD
// GALINDO"), categoría Finca a $10.000/mes: 6 meses x $10.000 = $60.000, calza exacto. Se
// incluye en RECIBOS_FALTANTES_2026 con el código correcto.
//
// Ninguno de estos recibos mueve el saldo de Caja/Banco (tabla `movimientos`): mismo criterio
// que la corrección 30 -- esa reconciliación se hace aparte, en el checkpoint contable real
// (arqueo físico + extracto bancario + "Ajustar saldos"), no recibo por recibo.
// Corrección 35 (2026-08-29) acortó este texto -- ver el comentario junto a
// OBSERVACION_RECIBO_S0244 más arriba, mismo motivo. OBSERVACION_RECIBO_FALTANTE_2026_ORIGINAL
// (más abajo) conserva el texto viejo solo para localizar y corregir las filas que ya quedaron
// escritas en producción con él.
const OBSERVACION_RECIBO_FALTANTE_2026 =
  'Recibo físico ya escrito en el talonario que nunca se había dado de alta en el sistema.';

const OBSERVACION_RECIBO_FALTANTE_2026_ORIGINAL =
  'Recibo físico ya escrito en el talonario que nunca se había dado de alta en el sistema -- ' +
  'encontrado por el cruce automático del talonario completo (ronda 3, 2026-08-19), ver ' +
  'scripts/import-cartera/output/cruce-colillas-vs-db.md.';

const RECIBOS_FALTANTES_2026 = [
  { numeroRecibo: 2548, codigo: 'S010', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 12 }, monto: 240000, metodoPago: 'Efectivo', fecha: '2026-07-18', concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026' },
  { numeroRecibo: 2552, codigo: 'C004', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 12 }, monto: 240000, metodoPago: 'Efectivo', fecha: '2026-07-25', concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026' },
  { numeroRecibo: 2553, codigo: 'C0041', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 12 }, monto: 120000, metodoPago: 'Efectivo', fecha: '2026-07-25', concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DCIEMBRE 2026' },
  { numeroRecibo: 2554, codigo: 'R0131', desde: { anio: 2026, mes: 6 }, hasta: { anio: 2026, mes: 9 }, monto: 40000, metodoPago: 'Transferencia', fecha: '2026-07-25', concepto: 'CUOTA DE SOSTENIMIENTO JUNIO A SEPTIEMBRE 2026 (TRANSFERENCIA 25/07/2026 $100,000)' },
  { numeroRecibo: 2555, codigo: 'R013', desde: { anio: 2026, mes: 4 }, hasta: { anio: 2026, mes: 9 }, monto: 60000, metodoPago: 'Transferencia', fecha: '2026-07-25', concepto: 'CUOTA DE SOSTENIMIENTO ABRIL A SEPTIEMBRE 2026 (TRANSFERENCIA 25/07/2026 $100,000)' },
  { numeroRecibo: 2556, codigo: 'C016', desde: { anio: 2026, mes: 7 }, hasta: { anio: 2026, mes: 12 }, monto: 60000, metodoPago: 'Efectivo', fecha: '2026-07-25', concepto: 'CUOTA DE SOSTENIMIENTO JULIO A DICIEMBRE 2026' },
  { numeroRecibo: 2557, codigo: 'S0334', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 12 }, monto: 120000, metodoPago: 'Efectivo', fecha: '2026-08-01', concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026' },
  { numeroRecibo: 2558, codigo: 'S039', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 12 }, monto: 120000, metodoPago: 'Efectivo', fecha: '2026-08-01', concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026' },
  { numeroRecibo: 2559, codigo: 'S0338', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 6 }, monto: 96000, metodoPago: 'Efectivo', fecha: '2026-08-01', concepto: 'CUOTA DE SOSTENIMIENTO ENERO A JUNIO 2026' },
  { numeroRecibo: 2561, codigo: 'S042', desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 12 }, monto: 120000, metodoPago: 'Efectivo', fecha: '2026-08-08', concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026' },
  { numeroRecibo: 2564, codigo: 'R047', desde: { anio: 2024, mes: 10 }, hasta: { anio: 2025, mes: 12 }, monto: 150000, metodoPago: 'Efectivo', fecha: '2026-06-27', concepto: 'CUOTA DE SOSTENIMIENTO OCTUBRE 2024 A DICIEMBRE 2025' },
  // Código crudo del talonario "S038" -- error de transcripción, la cuenta real es S0383
  // (confirmado por el usuario 2026-08-21, ver el comentario de la corrección 32 más arriba).
  { numeroRecibo: 2550, codigo: 'S0383', desde: { anio: 2026, mes: 7 }, hasta: { anio: 2026, mes: 12 }, monto: 60000, metodoPago: 'Efectivo', fecha: '2026-07-24', concepto: 'CUOTA DE SOSTENIMIENTO JULIO A DICIEMBRE 2026' }
];

const RECIBO_1167_BLANCO_MOTIVO =
  'Talonario en blanco -- hoja del talonario físico sin usar, encontrada por el cruce automático ' +
  'del talonario completo (ronda 3, 2026-08-19). No representa un pago ni un recibo anulado con ' +
  'pago previo: nunca se escribió nada en ella.';

// 33. Los otros 96 huecos que quedaban en la numeración consecutiva (1 a 2564) tras las
// correcciones 31 y 32, registrados uno por uno en recibos_anulados_fisicos -- mismo mecanismo
// que el 1167. Confirmado por el usuario 2026-08-21: "es muy importante que estén TODOS los
// recibos". Se clasificaron contra las 2.622 filas transcritas mecánicamente del talonario
// físico completo (scripts/import-cartera/output/colillas-clasificadas-completo.json, cruce
// ronda 3, 2026-08-19):
//
// - 90 están anulados EN EL PROPIO TALONARIO (la colilla física dice "ANULADO..." con su
//   motivo) -- nunca representaron un cobro. El motivo se guarda tal cual está escrito en la
//   colilla, no reinterpretado.
// - 3 son hojas en blanco (mismo caso que el 1167): 1667, 2441, 2442.
// - 3 (287, 1143, 1148) NO aparecen en ninguna de las 2.622 filas transcritas -- no hay colilla
//   física con ese número. No se puede confirmar si el talonario los anuló, los usó y la colilla
//   se perdió, o simplemente saltó esos números al numerar -- se registra la incertidumbre tal
//   cual, no se inventa un motivo.
const RECIBOS_ANULADOS_FALTANTES = [
  { numeroRecibo: 4, fecha: null, motivo: 'NO ESPECIFICA EL MOTIVO DE LA ANULACIÒN DEL RECIBO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 18, fecha: '2017-10-13', motivo: 'NO ESPECIFICA EL MOTIVO DE LA ANULACIÒN DEL RECIBO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 40, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 41, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 42, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 43, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 44, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 45, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 46, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 47, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 48, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 49, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 50, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 51, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 52, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 53, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 54, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 55, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 56, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 57, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 58, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 59, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 60, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 61, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 62, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 63, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 64, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 65, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 66, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 67, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 68, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 69, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 70, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 71, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 72, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 73, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 74, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 75, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 76, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 77, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 78, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 79, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 80, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 81, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 82, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 83, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 84, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 85, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 86, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 87, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 88, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 89, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 90, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 91, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 92, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 93, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 94, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 95, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 96, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 97, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 98, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 99, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 100, fecha: null, motivo: 'ANULADO POR DEVOLUCIÒN SIN USO, SOLO APARECE COLILLA (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 102, fecha: null, motivo: 'NO ESPECIFICA EL MOTIVO DE LA ANULACIÒN DEL RECIBO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 287, fecha: null, motivo: 'Número no aparece en ninguna de las 2.622 filas transcritas mecánicamente del talonario físico completo -- no se puede confirmar si fue anulado, usado o simplemente saltado en la numeración original. Registrado para no dejar un hueco sin explicación (cruce automático del talonario, ronda 3, 2026-08-19).' },
  { numeroRecibo: 311, fecha: null, motivo: 'NO ESPECIFICA EL MOTIVO DE LA ANULACIÒN DEL RECIBO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 585, fecha: null, motivo: 'NO ESPECIFICA EL MOTIVO DE LA ANULACIÒN DEL RECIBO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 671, fecha: null, motivo: 'ANULADO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 700, fecha: null, motivo: 'ANULADO POR NO USO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 939, fecha: null, motivo: 'ANULADO ERROR EN EL DILIGENCIAMIENTO EN EL NOMBRE DEL USUARIO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 957, fecha: null, motivo: 'ANULADO ERROR EN EL DILIGENCIAMIENTO EN EL VALOR TOTAL A CANCELAR (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 959, fecha: null, motivo: 'ANULADO ERROR EN EL DILIGENCIAMIENTO EN EL VALOR DE LA CUOTA DE SOSTENIMIENTO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1043, fecha: null, motivo: 'ANULADO - ERROR EN EL DILIGENCIAMIENTO DEL NOMBRE DEL USUARIO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1044, fecha: null, motivo: 'ANULADO - ERROR EN EL DILIGENCIAMIENTO DEL NOMBRE DEL USUARIO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1143, fecha: null, motivo: 'Número no aparece en ninguna de las 2.622 filas transcritas mecánicamente del talonario físico completo -- no se puede confirmar si fue anulado, usado o simplemente saltado en la numeración original. Registrado para no dejar un hueco sin explicación (cruce automático del talonario, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1148, fecha: null, motivo: 'Número no aparece en ninguna de las 2.622 filas transcritas mecánicamente del talonario físico completo -- no se puede confirmar si fue anulado, usado o simplemente saltado en la numeración original. Registrado para no dejar un hueco sin explicación (cruce automático del talonario, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1152, fecha: null, motivo: 'ANULADO POR REPETICIÒN DE RECIBO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1188, fecha: null, motivo: 'RECIBO ANULADO POR ERROR DE VALOR TOTAL (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1197, fecha: null, motivo: 'ANULADO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1245, fecha: null, motivo: 'ANULADO POR ERROR EN MES DE PAGO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1256, fecha: null, motivo: 'ANULADO POR ERROR EN MES DE PAGO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1314, fecha: '2023-01-07', motivo: 'ANULADO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1348, fecha: null, motivo: 'ANULADO POR ERROR EN MES DE PAGO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1438, fecha: '2023-04-22', motivo: 'ANULADO POR ERROR EN MES DE PAGO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1458, fecha: null, motivo: 'ANULADO POR ERROR EN MES DE PAGO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1515, fecha: '2023-07-22', motivo: 'ANULADO POR ERROR EN MES DE PAGO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1554, fecha: '2023-09-30', motivo: 'ANULADO POR ERROR EN MES DE PAGO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1596, fecha: '2023-12-02', motivo: 'ANULADO POR ERROR EN MES DE PAGO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1647, fecha: '2024-01-27', motivo: 'ANULADO POR ERROR EN MES DE PAGO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1666, fecha: '2024-02-03', motivo: 'ANULADO POR ERROR EN NOMBRE DE USUARIO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1667, fecha: '2024-02-03', motivo: 'Talonario en blanco -- hoja del talonario físico sin usar, encontrada por el cruce automático del talonario completo (ronda 3, 2026-08-19). No representa un pago ni un recibo anulado con pago previo: nunca se escribió nada en ella.' },
  { numeroRecibo: 1928, fecha: null, motivo: 'ANULADO POR ERROR EN CUOTA DE SOSTENIMIENTO (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 1995, fecha: null, motivo: 'ANULADO POR ERROR DE DATOS (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 2413, fecha: null, motivo: 'ANULADO POR ERROR DE DATOS (motivo tal cual anotado en el talonario físico; encontrado por el cruce automático, ronda 3, 2026-08-19).' },
  { numeroRecibo: 2441, fecha: null, motivo: 'Talonario en blanco -- hoja del talonario físico sin usar, encontrada por el cruce automático del talonario completo (ronda 3, 2026-08-19). No representa un pago ni un recibo anulado con pago previo: nunca se escribió nada en ella.' },
  { numeroRecibo: 2442, fecha: null, motivo: 'Talonario en blanco -- hoja del talonario físico sin usar, encontrada por el cruce automático del talonario completo (ronda 3, 2026-08-19). No representa un pago ni un recibo anulado con pago previo: nunca se escribió nada en ella.' }
];

// 34. Cuenta fantasma "R031": el talonario físico digitalizó mal el código del recibo 1819
// (2024-05-04, $60.000, "CUOTA DE SOSTENIMIENTO ENERO A JUNIO 2024") -- el importador creó una
// cuenta nueva "R031" solo para ese recibo (sin fila en CARTERA.xlsx, por eso quedó Suspendido
// "no localizada en el barrido de campo"). Confirmado por el usuario 2026-08-22: el código real
// es R0301, y coincide en todo: mismo propietario vigente (FLOREZ FLORENTINO, id 265, dueño de
// R0301 desde 2019-08-08, sin interrupción) y, sobre todo, R0301 tiene exactamente un hueco de
// enero a junio 2024 (6 meses x $10.000 = $60.000) totalmente sin imputar entre el recibo 1687
// (que cierra 2023) y el 2287 (que abre en julio 2024) -- el monto y el período calzan exacto.
// Se mueve el recibo a R0301 y se imputa de verdad contra ese hueco (antes el retrofit del
// modelo nuevo lo había dejado como saldo a favor sin aplicar, precisamente porque R031 nunca
// tuvo causación contra la cual imputarlo). El resto de la huella de R031 (categoría, estado,
// propietario, movimiento y crédito parcial del retrofit) se descarta -- R0301 ya tiene su
// propia versión correcta de cada una desde 2019, mismo mecanismo que la corrección 23
// (R0081/S058). pago_periodos SÍ se mueve (no se descarta): no hay fila de R0301 para esos 6
// meses todavía, así que representa historial real, no un duplicado.
const RESOLUCION_R031_R0301 = {
  codigoOrigen: 'R031', codigoDestino: 'R0301', numeroRecibo: 1819,
  periodoDesde: { anio: 2024, mes: 1 }, periodoHasta: { anio: 2024, mes: 6 }, monto: 60000
};
const OBSERVACION_RESOLUCION_R031_R0301 =
  'Cuenta reasignada de R031 (código mal digitalizado en el talonario) a R0301 -- confirmado ' +
  'por el usuario 2026-08-22. Cubre el hueco de enero a junio 2024 en R0301, sin imputar hasta ' +
  'esta corrección.';

const OBSERVACION_CREDITO_R0942 =
  'Saldo a favor no registrado: el recibo 2246 documenta una transferencia de $180.000 el ' +
  '19-jun-2025 ("CUOTA DE SOSTENIMIENTO ABRIL 2025 A FEBRERO 2026 (TRANSFERENCIA 19/06/2025 - ' +
  '$180,000 - SALDO A FAVOR 4,000)"), pero el recibo se cargó al sistema por $176.000 -- los ' +
  '$4.000 no quedaban en ninguna parte. Verificado contra el talonario físico 2026-08-13: plata ' +
  'real que la asociación recibió y el sistema no reconocía.';

// numeroRecibo resuelve el abono/recibo_detalle en vivo (getReciboDetalle/getAbonoPorDetalle),
// igual que las correcciones 4-9 -- nunca un id interno fijo, que no sobrevive a una corrida
// distinta del loader (autoincrement depende del orden de inserción de todo el dataset).
const CREDITO_R0942 = {
  codigoCuenta: 'R0942',
  numeroRecibo: 2246,
  monto: 4000,
  fecha: '2025-06-19'
};

// R0831: recibo 2159 ($100.000, "ABONO A DEUDA", sin período) fuerza FIFO contra el pool
// combinado (apertura opaca + exigible) pese a no declarar período -- única excepción de este
// archivo a la regla general de reimputarAbono ("sin período, el FIFO nunca corre"), porque acá
// el texto SÍ es una instrucción explícita de pagar deuda (a diferencia de S010/recibo 1825,
// donde el período era un error de transcripción). 2311 y 2407 se reimputan después con su
// período declarado, en orden cronológico real.
const OBSERVACION_RECALCULO_R0831 =
  'Recalculado 2026-08-14 junto con los recibos 2311 y 2407, en orden cronológico: "ABONO A ' +
  'DEUDA" (sin período declarado) es una instrucción explícita de pagar deuda -- a diferencia ' +
  'del caso S010/recibo 1825 (período con error de transcripción), acá sí corresponde correr ' +
  'FIFO contra el pool combinado (apertura opaca + exigible, la más vieja primero) pese a no ' +
  'tener período. Resultado verificado contra el talonario: cierra completo el saldo opaco de ' +
  '$128.000 y deja el resto contra 2024+.';

const RECALCULO_R0831 = {
  cuentaCodigo: 'R0831',
  abonosOrdenCronologico: [
    { numeroRecibo: 2159, periodoDesde: null, periodoHasta: null, forzarFifoSinPeriodo: true },
    { numeroRecibo: 2311, periodoDesde: '2025-12', periodoHasta: '2025-12' },
    { numeroRecibo: 2407, periodoDesde: '2026-01', periodoHasta: '2026-07' }
  ]
};

// 17. PAGOS POR ADELANTADO: cuentas cuyo recibo declaraba un período que se extendía más allá
//    de lo que la carga causó (tope julio 2026, ver paso9-causacion.js) quedaron con ese tramo
//    convertido en crédito genérico -- "pagado hasta julio 2026" y saldo a favor, cuando en
//    realidad ya pagaron hasta diciembre. A diferencia de las correcciones 1-16 (una cuenta a
//    la vez, con evidencia puntual), esta es QUERY-DRIVEN (ver candidatosPagoAdelantado): no
//    hay una lista fija porque el patrón se repite en decenas de cuentas y no hay nada puntual
//    que investigar en cada una -- todas comparten el mismo mecanismo (paso10-imputacion.js
//    solo imputa contra cargos que YA existen; un mes futuro sin causar no es candidato, así
//    que el sobrante queda como crédito). La corrección: causar los meses que el recibo
//    declara (asegurarCausacion) y redimir el crédito contra esos cargos puntuales
//    (CarteraService.redimirCredito, MesesEspecificos) -- NUNCA borra ni reconstruye la
//    imputación original (a diferencia de las correcciones 4-9/16): ver el comentario extenso
//    en el bloque de la corrección, sección "Chequeo de seguridad", sobre por qué reconstruir
//    desde cero desalinea cuentas que en verdad no tenían ningún problema.
//
//    Chequeo de seguridad por cuenta (costoPeriodoSinCausar): si el crédito disponible no
//    alcanza para cubrir lo que el período declarado necesita -- señal de que parte de esa
//    plata ya pagó deuda vieja real, o de que el recibo nunca alcanzó para todo lo que dice --
//    la cuenta NO se toca y queda en pendientesManuales para revisión con el talonario. De las
//    49 candidatas reales (2026-08-14), 10 cayeron acá (R027, R051, S014, C009, R048, S040,
//    C019, S011, R103, S03311): todas tenían parte del sobrante ya aplicado por FIFO contra
//    deuda anterior a 2024, y causar el período completo sin ese chequeo las descuadraba contra
//    CARTERA.xlsx por exactamente el monto que faltaba -- verificado antes de aplicar nada real.
//
//    EXCLUSIONES explícitas (candidatosPagoAdelantado las descarta, no es que no calcen el
//    patrón -- calzan, pero aplicarles esto sería incorrecto o le quita una decisión a la junta):
//    - S0312: los $210.000 son un pago mal anotado, no un pago adelantado real -- aplicarlo
//      marcaría meses futuros como pagados sin que sea cierto (PUNTOS-CONFLICTIVOS.md, nota
//      interna de la sección de saldo a favor).
//    - R028, S0331: créditos viejos sin usar, documentados como decisión pendiente de la junta
//      (avisarle a la persona o no) -- no es una corrección de datos que el sistema deba tomar
//      solo (PUNTOS-CONFLICTIVOS.md sección 2, "Los 4 créditos a favor que nadie usa").
//    - S0061: cuenta duplicada e inactiva desde antes de esta carga (PUNTOS-CONFLICTIVOS.md
//      sección de duplicadas) -- no es una cuenta real con un pago pendiente de aplicar.
//    - R031: Suspendida y sin categoria_tarifas configurada para su historia temprana (2024) --
//      asegurarCausacion no puede causar nada ahí; causar el resto sin resolver eso primero
//      dejaría un hueco a mitad de camino. Necesita revisión manual aparte.
const EXCLUSIONES_PAGO_ADELANTADO = {
  S0312: 'crédito de $210.000 es un pago mal anotado, no un pago adelantado real',
  R028: 'crédito viejo sin usar -- decisión pendiente de la junta, no del sistema',
  S0331: 'crédito viejo sin usar -- decisión pendiente de la junta, no del sistema',
  S0061: 'cuenta duplicada e inactiva desde antes de esta carga',
  R031: 'sin categoria_tarifas configurada para su historia temprana -- revisión manual aparte'
};

const OBSERVACION_PAGO_ADELANTADO =
  'Recalculado (paso9b, corrección 17): el recibo declaraba un período que se extendía más ' +
  'allá de lo que la carga había causado, así que el tramo futuro había quedado como crédito ' +
  'genérico en vez de imputado a esos meses. Se causaron los meses declarados y se redimió el ' +
  'crédito disponible contra esos cargos puntuales, sin tocar ninguna imputación previa.';

const MESES_TEXTO_A_NUMERO = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

// recibo_detalles.periodo_desde/periodo_hasta mezcla dos formatos según cuándo se cargó el
// recibo ("Enero 2026" o "2026-01") -- a diferencia de paso10-imputacion.js (que solo lee del
// JSON, siempre ISO), acá hay que leer lo que quedó en la base, en cualquiera de los dos.
function parsearPeriodoAnioMes(texto) {
  if (!texto) return null;
  let m = texto.match(/^(\d{4})-(\d{2})$/);
  if (m) return { anio: Number(m[1]), mes: Number(m[2]) };
  m = texto.trim().toLowerCase().match(/^([a-záéíóúñ]+)\s+(\d{4})$/);
  if (m && MESES_TEXTO_A_NUMERO[m[1]]) return { anio: Number(m[2]), mes: MESES_TEXTO_A_NUMERO[m[1]] };
  return null;
}

function periodoAIso(periodo) {
  return `${periodo.anio}-${String(periodo.mes).padStart(2, '0')}`;
}

// 31. periodo_desde/periodo_hasta de recibo_detalles: campo LEGACY que solo alimenta el
//    "Historial de Aportes" (recibos.js) -- paso7/paso8/paso10 nunca lo leen, causan e imputan
//    con su propio período tomado del JSON. Un parser antiguo, ya no existe en el código, solo
//    entendía el conector " A " -- cuando el concepto usaba "HASTA" o "Y" para declarar el rango
//    ("...HASTA Diciembre 2022", "Enero Y Febrero 2024"), se quedó con el primer mes solo, en
//    los dos campos. Además, cuando el rango completo compartía un solo año ("Enero A Diciembre
//    2017"), el "desde" a veces quedó con el año del propio recibo (cuándo se escribió) en vez
//    del año que el concepto realmente declara. Encontrado 2026-08-20: el usuario revisó el
//    recibo 1773 de R007 y vio "Enero 2024" en vez de "Enero a Diciembre 2024".
//
//    Investigado a fondo antes de tocar nada: es 100% cosmético. Confirmado leyendo paso7/paso8/
//    paso10 que ninguno lee este campo -- la plata real de cada recibo (cartera_movimientos/
//    cartera_imputaciones) viene de una fuente separada y ya está correcta, verificada recibo
//    por recibo contra el ledger real en los que generaron un Abono real.
//
//    Corrección query-driven (mismo patrón que la 17), no una lista fija -- se re-evalúa cada
//    corrida contra las ~2.133 filas con período declarado:
//    - Si el recibo_detalle tiene un Abono real con imputaciones a CargoMensual, el rango
//      correcto es el mínimo/máximo real de esas imputaciones -- la fuente más confiable, es
//      plata ya verificada. Si además dejó un crédito sin aplicar ligado al mismo detalle
//      (declaró más meses de los que ya se causaron), el "hasta" se extiende con lo que el
//      propio texto del concepto declara, para no mostrar un rango más corto que la intención
//      real del recibo.
//    - Si no hay Abono real (deuda anterior a 2024, absorbida en la apertura opaca), el rango
//      sale de parsear el concepto (conectores A/HASTA/Y, con acarreo de año hacia atrás cuando
//      un mes no trae año explícito y el mes siguiente retrocede en el calendario -- ej.
//      "Diciembre Y Enero 2024" -> Diciembre 2023, Enero 2024).
//    - Si ninguna de las dos fuentes da un año con confianza (texto sin ningún año, ej. "Mayo A
//      Diciembre" sin año -- ~40 casos donde el año faltante ya se rellenó bien con el año del
//      propio recibo al digitalizar), se deja tal cual -- no se adivina.
//
//    SOBRESCRITURA_PERIODO_MANUAL cubre el único caso real de mes abreviado en todo concepto de
//    la base (recibo 171, "ENERO A NOV 2010" -- el parser solo entiende nombres completos, para
//    no arriesgar falsos positivos con abreviaturas de 3 letras que puedan colisionar con otras
//    palabras del texto en el resto de los ~2.500 recibos).
const NOMBRES_MES_COMPLETO = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];
const REGEX_MESES = new RegExp(`\\b(${NOMBRES_MES_COMPLETO.join('|')})\\b`, 'g');

function formatearPeriodoTexto(p) {
  const nombre = NOMBRES_MES_COMPLETO[p.mes - 1];
  return `${nombre[0]}${nombre.slice(1).toLowerCase()} ${p.anio}`;
}

// Encuentra menciones "MES [AÑO]" en orden; cuando un mes no trae año explícito, lo hereda de
// la siguiente mención que sí lo traiga -- retrocediendo el año si esa mención está en un mes
// MENOR (el calendario retrocedió, ej. "Diciembre y Enero 2024").
function inferirPeriodoDeTexto(concepto) {
  const t = (concepto || '').toUpperCase();
  const posiciones = [];
  let m;
  REGEX_MESES.lastIndex = 0;
  while ((m = REGEX_MESES.exec(t)) !== null) {
    posiciones.push({ mes: NOMBRES_MES_COMPLETO.indexOf(m[1]) + 1, pos: m.index });
  }
  if (posiciones.length === 0) return null;

  // El año explícito de una mención solo puede venir de DESPUÉS de ella y ANTES de la próxima
  // mención de mes -- si la ventana se extendiera más allá, "Diciembre Y Enero 2024" leería el
  // 2024 de Enero como si también fuera el año explícito de Diciembre (mismo bug del parser
  // legacy que esta corrección reemplaza, solo que corrido un mes hacia atrás).
  const menciones = posiciones.map((p, idx) => {
    const finVentana = idx + 1 < posiciones.length ? posiciones[idx + 1].pos : t.length;
    const anioMatch = t.slice(p.pos, finVentana).match(/20\d\d/);
    return { mes: p.mes, anioExplicito: anioMatch ? Number(anioMatch[0]) : null };
  });

  for (let i = menciones.length - 1; i >= 0; i--) {
    if (menciones[i].anioExplicito !== null) { menciones[i].anioInferido = menciones[i].anioExplicito; continue; }
    let j = i + 1;
    while (j < menciones.length && menciones[j].anioExplicito === null) j++;
    if (j < menciones.length) {
      let anio = menciones[j].anioExplicito;
      if (menciones[i].mes > menciones[j].mes) anio -= 1;
      menciones[i].anioInferido = anio;
    } else {
      menciones[i].anioInferido = null;
    }
  }
  if (menciones.some(x => x.anioInferido === null)) return null;

  const primera = menciones[0], ultima = menciones[menciones.length - 1];
  return {
    desde: { anio: primera.anioInferido, mes: primera.mes },
    hasta: { anio: ultima.anioInferido, mes: ultima.mes }
  };
}

// El parser exacto (inferirPeriodoDeTexto) solo reconoce los 12 nombres de mes completos, bien
// escritos -- a propósito: aceptar coincidencias difusas arriesga falsos positivos (ej. "PUNTO"
// cae a distancia 2 de "JUNIO"). Encontrados 2026-08-20 con una búsqueda por distancia de edición
// contra los 12 nombres de mes (distancia <= 2, sobre conceptos con año) y verificados a mano uno
// por uno contra el propio texto: son los únicos con un typo real en el nombre del mes que el
// parser exacto no puede leer solo. R027 (1710/1711) además se verificó contra su ledger real
// (enero-diciembre 2024 completo, imputaciones a CargoMensual): coincide exacto.
const SOBRESCRITURA_PERIODO_MANUAL = {
  171: { desde: { anio: 2010, mes: 1 }, hasta: { anio: 2010, mes: 11 } },     // "ENERO A NOV 2010"
  217: { desde: { anio: 2017, mes: 6 }, hasta: { anio: 2017, mes: 9 } },      // "JUNIO A SEPTEMBRE 2017"
  614: { desde: { anio: 2019, mes: 10 }, hasta: { anio: 2019, mes: 12 } },    // "OCTUBBRE A DICIEMBRE 2019"
  851: { desde: { anio: 2021, mes: 9 }, hasta: { anio: 2021, mes: 12 } },     // "SE`PTIEMBRE A DICIEMBRE 2021"
  857: { desde: { anio: 2021, mes: 1 }, hasta: { anio: 2021, mes: 9 } },      // "ENERO A SEPTIIEMBRE 2021"
  1276: { desde: { anio: 2022, mes: 11 }, hasta: { anio: 2022, mes: 12 } },   // "NOVIDEMBRE 2022 A DICIEMBRE 2022"
  1560: { desde: { anio: 2019, mes: 2 }, hasta: { anio: 2019, mes: 5 } },     // "FERERO 2019 A MAYO 2019"
  1698: { desde: { anio: 2023, mes: 6 }, hasta: { anio: 2023, mes: 11 } },    // "JUNIO A MOVIEMBRE 2023"
  1710: { desde: { anio: 2024, mes: 1 }, hasta: { anio: 2024, mes: 12 } },    // "ENERO A DICIEMRBE 2024"
  1711: { desde: { anio: 2024, mes: 1 }, hasta: { anio: 2024, mes: 12 } },    // "ENERO A DICIEMRBE 2024"
  1741: { desde: { anio: 2024, mes: 1 }, hasta: { anio: 2024, mes: 2 } },     // "ENERO A FEBREO 2024"
  1773: { desde: { anio: 2024, mes: 1 }, hasta: { anio: 2024, mes: 12 } },    // "ENERO A DIIEMBRE 2024" (R007)
  1992: { desde: { anio: 2024, mes: 1 }, hasta: { anio: 2024, mes: 12 } },    // "ENERO A JUNIO Y HASTA DICIEMRE 2024"
  2487: { desde: { anio: 2026, mes: 1 }, hasta: { anio: 2026, mes: 2 } },     // "ENERO A FEBREO 2026"
  // "20217" (dígito de más): el año leído tal cual (2021) es imposible -- los 4 recibos son de
  // 2017, no pueden cubrir hasta un año que todavía no había pasado. 2017 es la única lectura
  // consistente con la fecha real del recibo.
  2: { desde: { anio: 2016, mes: 1 }, hasta: { anio: 2017, mes: 12 } },       // "DICIEMBRE 20217" (recibo real de 2017)
  3: { desde: { anio: 2016, mes: 1 }, hasta: { anio: 2017, mes: 12 } },       // "DICIEMBRE 20217" (recibo real de 2017)
  14: { desde: { anio: 2016, mes: 1 }, hasta: { anio: 2017, mes: 12 } },      // "DICIEMBRE 20217" (recibo real de 2017)
  90014: { desde: { anio: 2016, mes: 1 }, hasta: { anio: 2017, mes: 12 } },   // "DICIEMBRE 20217" (recibo real de 2017)
  5: { desde: { anio: 2016, mes: 1 }, hasta: { anio: 2017, mes: 5 } },        // "MAYO 20217" (recibo real de 2017)
  1490: { desde: { anio: 2022, mes: 5 }, hasta: { anio: 2022, mes: 12 } },    // "MAY0 2022 A DICIEMBRE 2022" (cero por O)
  1491: { desde: { anio: 2022, mes: 5 }, hasta: { anio: 2022, mes: 12 } }     // "MAY0 2022 A DICIEMBRE 2022" (cero por O)
};

// Recibos cuyo periodo_desde/periodo_hasta ya lo escribe una corrección puntual de este mismo
// archivo (5: recibo 2384: 9: recibo 2229) -- 31 los deja intactos, ver su comentario arriba.
const RECIBOS_PERIODO_GESTIONADO_APARTE = [2384, 2229];

// Prioridad: 1) override manual puntual, 2) texto del concepto, 3) ledger real (Abono +
// imputaciones a CargoMensual), solo como respaldo cuando el texto no trae ningún año.
//
// Investigado 2026-08-20 (caso real: recibo 2470 de R007): el ledger NO es la fuente correcta
// para esto pese a ser "la plata ya verificada" -- cuando el sobrante de un recibo se desvió por
// FIFO hacia deuda vieja SIN RELACIÓN (el patrón que motivó media docena de correcciones de este
// archivo: R007, R049, S0312...), el rango real de imputaciones de ese abono queda mucho más
// ancho que lo que el recibo declara (ej. "Julio 2024 a Julio 2026" para un recibo que dice
// "Enero a Diciembre 2026") -- técnicamente cierto sobre a dónde fue la plata, pero es peor que
// el bug original para el propósito de esta pantalla: mostrar lo que la colilla física dice, no
// una traza forense de cada peso. El texto del propio concepto es la fuente correcta casi
// siempre (y coincide con el ledger en el caso común, donde no hubo desvío) -- el ledger solo
// entra cuando el texto no trae ningún año (ej. "Mayo a Diciembre" sin año, y sin ningún Abono
// real tampoco: ahí no hay ninguna fuente y se deja tal cual).
function derivarPeriodoCorrecto(db, { detalleId, numeroRecibo, concepto }) {
  if (SOBRESCRITURA_PERIODO_MANUAL[numeroRecibo]) return SOBRESCRITURA_PERIODO_MANUAL[numeroRecibo];

  const porTexto = inferirPeriodoDeTexto(concepto);
  if (porTexto) return porTexto;

  const abono = db.prepare(`SELECT id FROM cartera_movimientos WHERE recibo_detalle_id=? AND tipo='Abono'`).get(detalleId);
  if (!abono) return null;

  const reales = db.prepare(`
    SELECT cg.anio, cg.mes FROM cartera_imputaciones i JOIN cartera_movimientos cg ON cg.id=i.cargo_id
    WHERE i.abono_id=? AND cg.anio IS NOT NULL AND cg.mes IS NOT NULL
  `).all(abono.id);
  if (reales.length === 0) return null;

  const cod = x => x.anio * 12 + x.mes;
  const minReal = reales.reduce((a, b) => cod(a) < cod(b) ? a : b);
  const maxReal = reales.reduce((a, b) => cod(a) > cod(b) ? a : b);
  return { desde: { anio: minReal.anio, mes: minReal.mes }, hasta: { anio: maxReal.anio, mes: maxReal.mes } };
}

// Créditos tipo='Abono' ligados a un recibo_detalle cuyo periodo_hasta declarado va más allá
// del último CargoMensual que la cuenta tiene causado hoy -- el patrón exacto de "pago
// adelantado" (ver comentario de la corrección 17 arriba). No es una lista fija: se recalcula
// cada vez que corre este paso, así que si aparece un pago adelantado nuevo (real, posterior a
// esta carga) esta consulta también lo encuentra -- por diseño, para que el paso siga sirviendo
// más allá de esta corrida puntual.
function candidatosPagoAdelantado(db) {
  const maxCausadoPorCuenta = new Map(
    db.prepare(`
      SELECT cuenta_id, MAX(anio * 12 + (mes - 1)) AS cod
      FROM cartera_movimientos WHERE tipo = 'CargoMensual' GROUP BY cuenta_id
    `).all().map(f => [f.cuenta_id, f.cod])
  );

  const filas = db.prepare(`
    SELECT cc.id AS creditoId, cc.cuenta_id AS cuentaId, cc.monto AS creditoMonto, cu.codigo,
           rd.id AS detalleId, rd.periodo_desde, rd.periodo_hasta, r.numero_recibo AS numeroRecibo
    FROM cuenta_creditos cc
    JOIN recibo_detalles rd ON rd.id = cc.recibo_detalle_id
    JOIN recibos r ON r.id = rd.recibo_id
    JOIN cuentas cu ON cu.id = cc.cuenta_id
    WHERE cc.tipo = 'Abono' AND rd.periodo_hasta IS NOT NULL
    ORDER BY cu.codigo, r.numero_recibo
  `).all();

  const candidatos = [];
  for (const f of filas) {
    if (EXCLUSIONES_PAGO_ADELANTADO[f.codigo]) continue;
    const desde = parsearPeriodoAnioMes(f.periodo_desde);
    const hasta = parsearPeriodoAnioMes(f.periodo_hasta);
    if (!desde || !hasta) continue;
    const hastaCod = hasta.anio * 12 + (hasta.mes - 1);
    const maxCod = maxCausadoPorCuenta.get(f.cuentaId);
    if (maxCod !== undefined && hastaCod <= maxCod) continue; // ya no es "futuro": nada que hacer
    candidatos.push({ ...f, desde, hasta });
  }
  return candidatos;
}

// Cuánto falta pagar en [desde, hasta] SIN causar nada todavía: para los meses que ya tienen
// CargoMensual, lo realmente pendiente (monto menos lo imputado); para los que no, la tarifa
// vigente en ese mes (lo que asegurarCausacion crearía). Si algún mes no tiene tarifa
// configurada, cuenta como 0 -- asegurarCausacion tampoco podría causarlo, y ese hueco ya lo
// reporta mesesSinTarifa por su cuenta; no es responsabilidad de esta corrección.
function costoPeriodoSinCausar(db, pagoRepo, cuentaId, desde, hasta) {
  const desdeCod = desde.anio * 12 + (desde.mes - 1);
  const hastaCod = hasta.anio * 12 + (hasta.mes - 1);
  let total = 0;
  for (let cod = desdeCod; cod <= hastaCod; cod++) {
    const anio = Math.floor(cod / 12), mes = (cod % 12) + 1;
    const cargo = db.prepare(
      `SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=? AND mes=?`
    ).get(cuentaId, anio, mes);
    if (cargo) {
      const cubierto = db.prepare(
        `SELECT COALESCE(SUM(monto),0) s FROM cartera_imputaciones WHERE cargo_id=?`
      ).get(cargo.id).s;
      total += Math.max(0, redondear(cargo.monto - cubierto));
    } else {
      const tarifa = pagoRepo.getCategoriaTarifaParaMes(cuentaId, anio, mes);
      total += tarifa ? tarifa.tarifa_sostenimiento : 0;
    }
  }
  return redondear(total);
}

// Cargos pendientes (con saldo > 0) dentro de [desde, hasta], para pasarlos como cargosElegidos
// a redimirCredito -- se llama DESPUÉS de asegurarCausacion, cuando ya existen.
function cargosPendientesEnRango(db, cuentaId, desde, hasta) {
  const desdeCod = desde.anio * 12 + (desde.mes - 1);
  const hastaCod = hasta.anio * 12 + (hasta.mes - 1);
  return db.prepare(`
    SELECT m.id, m.monto,
      COALESCE((SELECT SUM(i.monto) FROM cartera_imputaciones i WHERE i.cargo_id = m.id), 0) AS cubierto
    FROM cartera_movimientos m
    WHERE m.cuenta_id = ? AND m.tipo = 'CargoMensual' AND (m.anio * 12 + (m.mes - 1)) BETWEEN ? AND ?
  `).all(cuentaId, desdeCod, hastaCod)
    .map(f => ({ id: f.id, pendiente: redondear(f.monto - f.cubierto) }))
    .filter(f => esMayor(f.pendiente, 0));
}

function borrarCargoMensualDelAnio(db, cuentaId, anio) {
  return db.prepare("DELETE FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=?")
    .run(cuentaId, anio).changes;
}

function getReciboDetalle(db, numeroRecibo) {
  const recibo = db.prepare('SELECT id FROM recibos WHERE numero_recibo=?').get(numeroRecibo);
  if (!recibo) throw new Error(`Recibo ${numeroRecibo}: no existe en la base -- ¿corrió el paso 7?`);
  const detalle = db.prepare('SELECT id FROM recibo_detalles WHERE recibo_id=?').get(recibo.id);
  if (!detalle) throw new Error(`Recibo ${numeroRecibo}: no tiene recibo_detalle -- ¿corrió el paso 7?`);
  return { reciboId: recibo.id, detalleId: detalle.id };
}

function getAbonoPorDetalle(db, detalleId) {
  return db.prepare(`SELECT id, cuenta_id, monto FROM cartera_movimientos WHERE recibo_detalle_id=? AND tipo='Abono'`).get(detalleId);
}

function cargosPendientesCombinados(db, cuentaId) {
  const tiposSQL = TIPOS_CARGO_COMBINADOS.map(t => `'${t}'`).join(', ');
  const filas = db.prepare(`
    SELECT m.id, m.anio, m.mes, m.monto,
      COALESCE((SELECT SUM(i.monto) FROM cartera_imputaciones i WHERE i.cargo_id = m.id), 0) AS cubierto
    FROM cartera_movimientos m
    WHERE m.cuenta_id = ? AND m.tipo IN (${tiposSQL}) AND m.monto > 0
    ORDER BY m.fecha ASC, m.id ASC
  `).all(cuentaId);
  return filas.map(f => ({ ...f, pendiente: redondear(f.monto - f.cubierto) })).filter(f => esMayor(f.pendiente, 0));
}

// Reimputa un abono contra los cargos pendientes de su cuenta: primero por período declarado
// (si trae), y el sobrante a FIFO. Mismo mecanismo que paso10-imputacion.js -- se asume que
// las imputaciones viejas de este abono ya se borraron antes de llamar esta función.
// Mismo cambio de diseño que paso10-imputacion.js (2026-08-04): lo que no se imputa no queda
// como saldo a favor implícito en el Abono. Se recorta su monto a lo realmente imputado y el
// sobrante pasa a cuenta_creditos como 'Abono' sin aplicar.
//
// Sin período declarado, el FIFO NUNCA corre por defecto (mismo cambio 2026-08-04 que
// paso10-imputacion.js): el monto entero pasa a crédito. Es el caso exacto del recibo 1825 de
// S010 ($90.000, "abono libre" por decisión de esta misma corrección): al no tener período,
// antes caía igual al FIFO general y la plata se aplicaba sola contra los meses de 2026 --
// restaurando en la práctica el comportamiento que este cambio de diseño existe para evitar.
//
// forzarFifoSinPeriodo (default false) es la única excepción: para un abono sin período cuyo
// propio texto SÍ es una instrucción explícita de pagar deuda (ver R0831/recibo 2159, "ABONO A
// DEUDA" -- a diferencia del 1825 de arriba, que era un error de transcripción, no una
// instrucción). Nunca activarlo por defecto: cada uso es una decisión caso por caso, con su
// propia evidencia documentada en el bloque que llama a esta función.
// permitirFifoConPeriodo (default true) es la excepción simétrica a forzarFifoSinPeriodo: para
// un abono CON período declarado cuyo sobrante NO debe caer al FIFO general -- porque el propio
// texto ya declara un destino específico para ese sobrante (meses futuros que todavía no existen
// como cargo), y aplicarlo contra la deuda vieja (lo más antiguo, por diseño del FIFO) contradice
// esa evidencia en vez de honrarla. Ver REIMPUTACION_S0312/recibo 2362 para el caso real.
function reimputarAbono(db, repo, { abonoId, cuentaId, monto, periodoDesde, periodoHasta, forzarFifoSinPeriodo = false, permitirFifoConPeriodo = true }) {
  let restante = monto;
  let periodoImputados = 0;
  let fifoImputados = 0;
  const meses = mesesDelPeriodo(periodoDesde, periodoHasta);
  if (meses.length > 0) {
    const cargos = cargosPendientesCombinados(db, cuentaId);
    const idsElegidos = cargos.filter(c => meses.some(m => m.anio === c.anio && m.mes === c.mes)).map(c => c.id);
    const { imputaciones, sobrante } = distribuir({ modo: MODOS.MESES_ESPECIFICOS, cargos, monto: restante, cargosElegidos: idsElegidos });
    for (const imp of imputaciones) repo.crearImputacion({ abonoId, cargoId: imp.cargoId, monto: imp.monto });
    periodoImputados = imputaciones.length;
    restante = sobrante;
  }

  const corresponFifo = meses.length > 0 ? permitirFifoConPeriodo : forzarFifoSinPeriodo;
  if (esMayor(restante, 0) && corresponFifo) {
    const cargosFifo = cargosPendientesCombinados(db, cuentaId);
    const { imputaciones: impFifo, sobrante: sobranteFifo } = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: cargosFifo, monto: restante });
    for (const imp of impFifo) repo.crearImputacion({ abonoId, cargoId: imp.cargoId, monto: imp.monto });
    fifoImputados = impFifo.length;
    restante = sobranteFifo;
  }

  let creditoId = null;
  if (esMayor(restante, 0)) {
    const movimiento = db.prepare('SELECT fecha, recibo_detalle_id FROM cartera_movimientos WHERE id=?').get(abonoId);
    const imputadoTotal = redondear(monto - restante);
    repo.actualizarMontoMovimiento(
      abonoId, -imputadoTotal,
      imputadoTotal === 0 ? 'Convertido íntegro a saldo a favor (sin imputación)' : undefined
    );
    creditoId = repo.crearCredito({
      cuentaId, tipo: 'Abono', monto: restante, fecha: movimiento.fecha,
      reciboDetalleId: movimiento.recibo_detalle_id,
      observaciones: 'Sobrante de reimputación (paso9b): crédito no aplicado'
    });
  }

  return { periodoImputados, fifoImputados, sobrante: restante, creditoId };
}

function ejecutarPaso9b({ dbService }) {
  const CarteraRepository = require('../../src/repositories/CarteraRepository');
  const CarteraService = require('../../src/services/CarteraService');
  const PagoRepository = require('../../src/repositories/PagoRepository');
  const db = dbService.getDb();
  const repo = new CarteraRepository(dbService);
  const service = new CarteraService(dbService);
  const pagoRepo = new PagoRepository(dbService);

  const idPorCodigo = new Map(
    db.prepare('SELECT id, codigo FROM cuentas').all().map(c => [normalizarCodigo(c.codigo), c.id])
  );

  const s03311Creados = [];
  const tarifaCorregida = [];
  let propietarioS0244 = null;
  let reasignacion2137 = null;
  let correccion2384 = null;
  let reimputacion2384 = null;
  let recalculoS010 = null;
  let correccionAperturaS044 = null;
  let correccionPeriodo2229 = null;
  let reimputacion2229 = null;
  const suspensionesSinCartera = [];
  let inactivaS063 = null;
  let redencionR007 = null;
  let redencionR007Adelantado = null;
  let redencionS023 = null;
  const redencionesHuecoTextual2026 = [];
  const redencionesReajuste2024 = [];
  const limpiezaSuspendidas = [];
  let creditoR0942 = null;
  let recalculoR0831 = null;
  const pagosAdelantados = [];
  const pendientesManuales = [];
  let mergeR0081S058 = null;
  let reimputacionS0312 = null;
  let redencionR049 = null;
  let reasignacion458 = null;
  const suspensionIncobrables = [];
  let reciboFaltanteS0244 = null;
  const aperturaIncobrables = [];
  const cuentasNuevas2026 = [];
  const periodosTextoCorregidos = [];
  const recibosFaltantes2026 = [];
  let recibo1167Blanco = null;
  const recibosAnuladosFaltantes = [];
  let resolucionR031R0301 = null;
  const observacionesAcortadas = [];

  const transaccion = db.transaction(() => {
    // 31. Ver comentario junto a derivarPeriodoCorrecto más arriba. Corre PRIMERO en la
    // transacción, antes que cualquier otra corrección que también toque periodo_desde/hasta:
    // así una corrección puntual con más contexto (ej. un typo en el concepto que el parser
    // genérico no puede adivinar, como "ENERIO" en el recibo 2229) siempre tiene la última
    // palabra sobre su propio recibo. RECIBOS_PERIODO_GESTIONADO_APARTE cubre además los que
    // esas correcciones puntuales SÍ escriben en periodo_desde/hasta -- sin la exclusión, un
    // typo así haría que 31 y la corrección puntual se corrigieran mutuamente en cada corrida
    // sin converger nunca a un estado idempotente (verificado con el test de S044/2229).
    {
      const todos = db.prepare(`
        SELECT rd.id AS detalleId, rd.periodo_desde, rd.periodo_hasta, rd.concepto, r.numero_recibo
        FROM recibo_detalles rd JOIN recibos r ON r.id = rd.recibo_id
        WHERE rd.periodo_desde IS NOT NULL AND r.numero_recibo NOT IN (${RECIBOS_PERIODO_GESTIONADO_APARTE.join(',')})
      `).all();

      for (const fila of todos) {
        const correcto = derivarPeriodoCorrecto(db, {
          detalleId: fila.detalleId, numeroRecibo: fila.numero_recibo, concepto: fila.concepto
        });
        if (!correcto) continue;

        // Comparación por STRING contra el texto ya formateado, no por {anio,mes} ya parseados:
        // un valor guardado en ISO ("2026-08") puede tener el año/mes numéricamente correcto y
        // aun así seguir en el formato equivocado -- comparar tuplas lo daba por "ya bien" y lo
        // dejaba sin convertir (caso real: recibo 2528 de C010, carga inicial que quedó en ISO).
        const desdeTexto = formatearPeriodoTexto(correcto.desde);
        const hastaTexto = formatearPeriodoTexto(correcto.hasta);
        if (fila.periodo_desde === desdeTexto && fila.periodo_hasta === hastaTexto) {
          periodosTextoCorregidos.push({ numeroRecibo: fila.numero_recibo, corregido: false });
          continue;
        }

        db.prepare('UPDATE recibo_detalles SET periodo_desde=?, periodo_hasta=? WHERE id=?').run(
          desdeTexto, hastaTexto, fila.detalleId
        );
        periodosTextoCorregidos.push({
          numeroRecibo: fila.numero_recibo, corregido: true,
          antes: [fila.periodo_desde, fila.periodo_hasta],
          despues: [desdeTexto, hastaTexto]
        });
      }
    }

    // 1. S03311: causar 2024 completo a 10.000
    const cuentaS03311 = idPorCodigo.get(normalizarCodigo('S03311'));
    if (cuentaS03311 === undefined) throw new Error('S03311: no existe en la base -- ¿corrieron los pasos 1-2?');
    borrarCargoMensualDelAnio(db, cuentaS03311, 2024);
    for (let mes = 1; mes <= 12; mes++) {
      const movId = repo.crearMovimiento({
        cuentaId: cuentaS03311, fecha: primerDiaDelMes(2024, mes),
        tipo: 'CargoMensual', exigible: 1, monto: 10000,
        anio: 2024, mes, observaciones: OBSERVACION_S03311
      });
      s03311Creados.push({ mes, movId });
    }

    // 2. C021, R080, R091, S0244: recausar 2024-2026 a 10.000 (tarifa derogada)
    for (const codigo of CUENTAS_TARIFA_CORREGIDA) {
      const cuentaId = idPorCodigo.get(normalizarCodigo(codigo));
      if (cuentaId === undefined) throw new Error(`${codigo}: no existe en la base -- ¿corrieron los pasos 1-2?`);

      let borrados = 0;
      for (const anio of [2024, 2025, 2026]) borrados += borrarCargoMensualDelAnio(db, cuentaId, anio);

      const creados = [];
      for (const [anio, mesInicio, mesFin] of [[2024, 1, 12], [2025, 1, 12], [2026, 1, 7]]) {
        for (let mes = mesInicio; mes <= mesFin; mes++) {
          const movId = repo.crearMovimiento({
            cuentaId, fecha: primerDiaDelMes(anio, mes),
            tipo: 'CargoMensual', exigible: 1, monto: 10000,
            anio, mes, observaciones: OBSERVACION_TARIFA
          });
          creados.push({ anio, mes, movId });
        }
      }

      tarifaCorregida.push({ codigo, cuentaId, borrados, creados: creados.length });
    }

    // 3. S0244: asignar propietario solo si sigue sin ninguno activo (ver comentario arriba).
    const cuentaS0244 = idPorCodigo.get(normalizarCodigo(PROPIETARIO_S0244.codigoCuenta));
    if (cuentaS0244 === undefined) throw new Error('S0244: no existe en la base -- ¿corrieron los pasos 1-2?');

    const activoExistente = db.prepare(
      'SELECT id FROM cuenta_propietarios WHERE cuenta_id=? AND fecha_fin IS NULL'
    ).get(cuentaS0244);

    if (!activoExistente) {
      let propietarioId = db.prepare(
        'SELECT id FROM propietarios WHERE numero_identificacion=?'
      ).get(PROPIETARIO_S0244.numero_identificacion)?.id;

      if (propietarioId === undefined) {
        propietarioId = db.prepare(`
          INSERT INTO propietarios (nombre_completo, numero_identificacion, telefono, email, observaciones)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          PROPIETARIO_S0244.nombre_completo, PROPIETARIO_S0244.numero_identificacion,
          PROPIETARIO_S0244.telefono, PROPIETARIO_S0244.email, PROPIETARIO_S0244.observacionesPropietario
        ).lastInsertRowid;
      }

      const asignacionId = db.prepare(`
        INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio, observaciones)
        VALUES (?, ?, ?, ?)
      `).run(cuentaS0244, propietarioId, PROPIETARIO_S0244.fechaInicio, PROPIETARIO_S0244.observacionesAsignacion)
        .lastInsertRowid;

      propietarioS0244 = { propietarioId, asignacionId, creado: true };
    } else {
      propietarioS0244 = { asignacionId: activoExistente.id, creado: false };
    }

    // 4. Recibo 2137: reasignar el movimiento de cartera de S0312 a S0393.
    const cuentaOrigen2137 = idPorCodigo.get(normalizarCodigo(REASIGNACION_RECIBO_2137.codigoCuentaOrigen));
    const cuentaDestino2137 = idPorCodigo.get(normalizarCodigo(REASIGNACION_RECIBO_2137.codigoCuentaDestino));
    if (cuentaOrigen2137 === undefined || cuentaDestino2137 === undefined) {
      throw new Error('S0312/S0393: no existen en la base -- ¿corrieron los pasos 1-2?');
    }
    const { detalleId: detalle2137 } = getReciboDetalle(db, REASIGNACION_RECIBO_2137.numeroRecibo);
    const abono2137 = getAbonoPorDetalle(db, detalle2137);
    if (!abono2137) throw new Error(`Recibo ${REASIGNACION_RECIBO_2137.numeroRecibo}: no tiene movimiento de Abono -- ¿corrió el paso 8?`);

    if (abono2137.cuenta_id === cuentaDestino2137) {
      reasignacion2137 = { abonoId: abono2137.id, reasignado: false };
    } else {
      if (abono2137.cuenta_id !== cuentaOrigen2137) {
        throw new Error(
          `Recibo ${REASIGNACION_RECIBO_2137.numeroRecibo}: se esperaba su abono en ` +
          `${REASIGNACION_RECIBO_2137.codigoCuentaOrigen}, está en cuenta_id=${abono2137.cuenta_id}`
        );
      }
      db.prepare('DELETE FROM cartera_imputaciones WHERE abono_id=?').run(abono2137.id);
      db.prepare('UPDATE cartera_movimientos SET cuenta_id=? WHERE id=?').run(cuentaDestino2137, abono2137.id);
      const r = reimputarAbono(db, repo, {
        abonoId: abono2137.id, cuentaId: cuentaDestino2137, monto: redondear(-abono2137.monto),
        periodoDesde: REASIGNACION_RECIBO_2137.periodoDesde, periodoHasta: REASIGNACION_RECIBO_2137.periodoHasta
      });
      reasignacion2137 = { abonoId: abono2137.id, reasignado: true, ...r };
    }

    // 5. Recibo 2384 (S048): corregir el período de 2026 a 2025. Corrige primero el texto de
    // recibo_detalles (lo que ve el sistema viejo).
    const { detalleId: detalle2384 } = getReciboDetalle(db, CORRECCION_PERIODO_RECIBO_2384.numeroRecibo);
    const actual2384 = db.prepare('SELECT periodo_desde, periodo_hasta FROM recibo_detalles WHERE id=?').get(detalle2384);
    if (actual2384.periodo_desde === CORRECCION_PERIODO_RECIBO_2384.periodoDesdeNuevo &&
        actual2384.periodo_hasta === CORRECCION_PERIODO_RECIBO_2384.periodoHastaNuevo) {
      correccion2384 = { detalleId: detalle2384, corregido: false };
    } else {
      db.prepare('UPDATE recibo_detalles SET periodo_desde=?, periodo_hasta=? WHERE id=?').run(
        CORRECCION_PERIODO_RECIBO_2384.periodoDesdeNuevo, CORRECCION_PERIODO_RECIBO_2384.periodoHastaNuevo, detalle2384
      );
      correccion2384 = { detalleId: detalle2384, corregido: true };
    }

    // 5b. Re-imputa el abono contra el período ya corregido (modelo nuevo). Idempotencia
    // propia, independiente de la del texto: si sus imputaciones actuales ya son 12 meses de
    // CargoMensual de 2025, ya corrió antes.
    const abono2384 = getAbonoPorDetalle(db, detalle2384);
    if (!abono2384) throw new Error(`Recibo ${CORRECCION_PERIODO_RECIBO_2384.numeroRecibo}: no tiene movimiento de Abono -- ¿corrió el paso 8?`);
    const imputacionesActuales2384 = db.prepare(`
      SELECT cg.anio, cg.mes, cg.tipo FROM cartera_imputaciones i JOIN cartera_movimientos cg ON cg.id = i.cargo_id
      WHERE i.abono_id = ?
    `).all(abono2384.id);
    const yaImputado2025 = imputacionesActuales2384.length > 0 &&
      imputacionesActuales2384.every(c => c.tipo === 'CargoMensual' && c.anio === 2025);
    if (yaImputado2025) {
      reimputacion2384 = { abonoId: abono2384.id, reimputado: false };
    } else {
      db.prepare('DELETE FROM cartera_imputaciones WHERE abono_id=?').run(abono2384.id);
      const r = reimputarAbono(db, repo, {
        abonoId: abono2384.id, cuentaId: abono2384.cuenta_id, monto: redondear(-abono2384.monto),
        periodoDesde: '2025-01', periodoHasta: '2025-12'
      });
      reimputacion2384 = { abonoId: abono2384.id, reimputado: true, ...r };
    }

    // 6 y 7. S010: recibo 1659 sin abono (su efecto ya está en la apertura), recibo 1825 como
    // abono libre. Se detecta por si el abono de 1659 sigue existiendo -- si ya no está, esta
    // corrección (y el recálculo de los tres abonos) ya corrió antes.
    const cuentaS010 = idPorCodigo.get(normalizarCodigo(RECALCULO_S010.cuentaCodigo));
    if (cuentaS010 === undefined) throw new Error('S010: no existe en la base -- ¿corrieron los pasos 1-2?');

    const { detalleId: detalle1659 } = getReciboDetalle(db, RECALCULO_S010.numeroReciboEliminado);
    const abono1659 = getAbonoPorDetalle(db, detalle1659);

    if (!abono1659) {
      recalculoS010 = { yaCorregido: true };
    } else {
      db.prepare('DELETE FROM cartera_imputaciones WHERE abono_id=?').run(abono1659.id);
      db.prepare('DELETE FROM cartera_movimientos WHERE id=?').run(abono1659.id);

      const { detalleId: detalle1825 } = getReciboDetalle(db, RECALCULO_S010.numeroReciboLibre);
      db.prepare('UPDATE recibo_detalles SET periodo_desde=NULL, periodo_hasta=NULL WHERE id=?').run(detalle1825);

      const recalculados = [];
      for (const item of RECALCULO_S010.abonosOrdenCronologico) {
        const { detalleId } = getReciboDetalle(db, item.numeroRecibo);
        const abono = getAbonoPorDetalle(db, detalleId);
        if (!abono) throw new Error(`Recibo ${item.numeroRecibo}: no tiene movimiento de Abono -- ¿corrió el paso 8?`);
        db.prepare('DELETE FROM cartera_imputaciones WHERE abono_id=?').run(abono.id);
        recalculados.push({ numeroRecibo: item.numeroRecibo, abonoId: abono.id, periodoDesde: item.periodoDesde, periodoHasta: item.periodoHasta });
      }
      const resultados = [];
      for (const r of recalculados) {
        const res = reimputarAbono(db, repo, {
          abonoId: r.abonoId, cuentaId: cuentaS010, monto: redondear(-db.prepare('SELECT monto FROM cartera_movimientos WHERE id=?').get(r.abonoId).monto),
          periodoDesde: r.periodoDesde, periodoHasta: r.periodoHasta
        });
        resultados.push({ ...r, ...res });
      }

      recalculoS010 = { yaCorregido: false, eliminado1659: abono1659.id, abonos: resultados };
    }

    // 8. S044: la apertura opaca duplicaba el pendiente del punto de agua -- se corrige a 0.
    const cuentaS044 = idPorCodigo.get(normalizarCodigo(CORRECCION_APERTURA_S044.codigoCuenta));
    if (cuentaS044 === undefined) throw new Error('S044: no existe en la base -- ¿corrieron los pasos 1-2?');
    const aperturaS044 = db.prepare(
      `SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='AperturaOpaca'`
    ).get(cuentaS044);
    if (!aperturaS044) throw new Error('S044: no tiene movimiento AperturaOpaca -- ¿corrió el paso 5?');

    if (aperturaS044.monto === CORRECCION_APERTURA_S044.montoNuevo) {
      correccionAperturaS044 = { movId: aperturaS044.id, corregido: false };
    } else {
      repo.actualizarMontoMovimiento(aperturaS044.id, CORRECCION_APERTURA_S044.montoNuevo, OBSERVACION_APERTURA_S044);
      correccionAperturaS044 = { movId: aperturaS044.id, corregido: true };
    }

    // 9. Recibo 2229 (S044): período mal cargado (junio-junio -> enero-junio 2025). Corrige el
    // texto y luego reimputa el abono contra el período correcto -- con la apertura ya en 0
    // (paso 8, que corre antes en esta misma transacción), el sobrante ya no tiene adónde
    // desviarse.
    const { detalleId: detalle2229 } = getReciboDetalle(db, CORRECCION_PERIODO_RECIBO_2229.numeroRecibo);
    const actual2229 = db.prepare('SELECT periodo_desde, periodo_hasta FROM recibo_detalles WHERE id=?').get(detalle2229);
    if (actual2229.periodo_desde === CORRECCION_PERIODO_RECIBO_2229.periodoDesdeNuevo &&
        actual2229.periodo_hasta === CORRECCION_PERIODO_RECIBO_2229.periodoHastaNuevo) {
      correccionPeriodo2229 = { detalleId: detalle2229, corregido: false };
    } else {
      db.prepare('UPDATE recibo_detalles SET periodo_desde=?, periodo_hasta=? WHERE id=?').run(
        CORRECCION_PERIODO_RECIBO_2229.periodoDesdeNuevo, CORRECCION_PERIODO_RECIBO_2229.periodoHastaNuevo, detalle2229
      );
      correccionPeriodo2229 = { detalleId: detalle2229, corregido: true };
    }

    const abono2229 = getAbonoPorDetalle(db, detalle2229);
    if (!abono2229) throw new Error(`Recibo ${CORRECCION_PERIODO_RECIBO_2229.numeroRecibo}: no tiene movimiento de Abono -- ¿corrió el paso 8?`);
    const imputacionesActuales2229 = db.prepare(`
      SELECT cg.anio, cg.mes, cg.tipo FROM cartera_imputaciones i JOIN cartera_movimientos cg ON cg.id = i.cargo_id
      WHERE i.abono_id = ?
    `).all(abono2229.id);
    const yaImputadoCorrecto2229 = imputacionesActuales2229.length > 0 &&
      imputacionesActuales2229.every(c => c.tipo === 'CargoMensual' && c.anio === 2025 && c.mes >= 1 && c.mes <= 6);
    if (yaImputadoCorrecto2229) {
      reimputacion2229 = { abonoId: abono2229.id, reimputado: false };
    } else {
      db.prepare('DELETE FROM cartera_imputaciones WHERE abono_id=?').run(abono2229.id);
      const r = reimputarAbono(db, repo, {
        abonoId: abono2229.id, cuentaId: abono2229.cuenta_id, monto: redondear(-abono2229.monto),
        periodoDesde: '2025-01', periodoHasta: '2025-06'
      });
      reimputacion2229 = { abonoId: abono2229.id, reimputado: true, ...r };
    }

    // 10. (retirada 2026-08-20, ver corrección 23) -- causaba sostenimiento para S058, cuenta que
    // la corrección 23 elimina por ser un duplicado de R0081. R0081 ya causa esos mismos meses por
    // su cuenta, así que no hace falta reemplazarla por nada.

    // 11. Siete cuentas sin cartera y sin barrido de campo: suspender sin causar nada. Se
    // detecta por si la vigencia abierta ya es exactamente el Suspendido esperado; si no,
    // se reemplaza entera -- para estas 7 cuentas la única fila que existe hoy es el marcador
    // sintético "Estado inicial al migrar a cartera" (Activo, 2026-06-27) que puso la carga
    // inicial por defecto a TODAS las cuentas por igual, así que no hay historial real que
    // preservar al reemplazarla.
    for (const item of SUSPENSIONES_SIN_CARTERA) {
      const cuentaId = idPorCodigo.get(normalizarCodigo(item.codigoCuenta));
      if (cuentaId === undefined) throw new Error(`${item.codigoCuenta}: no existe en la base -- ¿corrieron los pasos 1-2?`);

      const abierta = db.prepare(
        'SELECT id, estado, fecha_inicio FROM cuenta_estados WHERE cuenta_id=? AND fecha_fin IS NULL'
      ).get(cuentaId);
      if (abierta && abierta.estado === 'Suspendido' && abierta.fecha_inicio === item.fechaInicio) {
        suspensionesSinCartera.push({ codigo: item.codigoCuenta, corregido: false });
        continue;
      }

      db.prepare('DELETE FROM cuenta_estados WHERE cuenta_id=?').run(cuentaId);
      db.prepare(`
        INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo) VALUES (?, 'Suspendido', ?, ?)
      `).run(cuentaId, item.fechaInicio, OBSERVACION_SUSPENSION_SIN_CARTERA);
      db.prepare("UPDATE cuentas SET estado='Suspendido' WHERE id=?").run(cuentaId);

      suspensionesSinCartera.push({ codigo: item.codigoCuenta, corregido: true });
    }

    // 12. S063: fusionada con S0365, se quedó en Activo por descuido. Mismo mecanismo que la
    // corrección 11 -- reemplaza el marcador sintético si no es ya exactamente el Inactivo
    // esperado.
    const cuentaS063 = idPorCodigo.get(normalizarCodigo(INACTIVA_FUSIONADA_S063.codigoCuenta));
    if (cuentaS063 === undefined) throw new Error('S063: no existe en la base -- ¿corrieron los pasos 1-2?');

    const abiertaS063 = db.prepare(
      'SELECT id, estado, fecha_inicio FROM cuenta_estados WHERE cuenta_id=? AND fecha_fin IS NULL'
    ).get(cuentaS063);
    if (abiertaS063 && abiertaS063.estado === 'Inactivo' && abiertaS063.fecha_inicio === INACTIVA_FUSIONADA_S063.fechaInicio) {
      inactivaS063 = { corregido: false };
    } else {
      db.prepare('DELETE FROM cuenta_estados WHERE cuenta_id=?').run(cuentaS063);
      db.prepare(`
        INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo) VALUES (?, 'Inactivo', ?, ?)
      `).run(cuentaS063, INACTIVA_FUSIONADA_S063.fechaInicio, OBSERVACION_INACTIVA_S063);
      db.prepare("UPDATE cuentas SET estado='Inactivo' WHERE id=?").run(cuentaS063);

      inactivaS063 = { corregido: true };
    }

    // 13. R007: redimir $12.000 del crédito de apertura contra el hueco real de diciembre 2024.
    const cuentaR007 = idPorCodigo.get(normalizarCodigo(REDENCION_R007.codigoCuenta));
    if (cuentaR007 === undefined) throw new Error('R007: no existe en la base -- ¿corrieron los pasos 1-2?');

    const cargoDic2024R007 = db.prepare(
      `SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=? AND mes=?`
    ).get(cuentaR007, REDENCION_R007.anio, REDENCION_R007.mes);
    if (!cargoDic2024R007) throw new Error('R007: no tiene CargoMensual de diciembre 2024 -- ¿corrieron los pasos 9/10?');

    const cubiertoDic2024R007 = db.prepare(
      `SELECT COALESCE(SUM(monto),0) AS total FROM cartera_imputaciones WHERE cargo_id=?`
    ).get(cargoDic2024R007.id).total;
    const pendienteDic2024R007 = redondear(cargoDic2024R007.monto - cubiertoDic2024R007);

    if (!esMayor(pendienteDic2024R007, 0)) {
      redencionR007 = { yaCorregido: true };
    } else if (Math.abs(pendienteDic2024R007 - REDENCION_R007.montoARedimir) < 1) {
      const abonoId = repo.crearMovimiento({
        cuentaId: cuentaR007, fecha: REDENCION_R007.fecha, tipo: 'Abono', exigible: 1,
        monto: -REDENCION_R007.montoARedimir, observaciones: OBSERVACION_REDENCION_R007
      });
      repo.crearImputacion({ abonoId, cargoId: cargoDic2024R007.id, monto: REDENCION_R007.montoARedimir });
      const creditoId = repo.crearCredito({
        cuentaId: cuentaR007, tipo: 'Aplicado', monto: REDENCION_R007.montoARedimir, fecha: REDENCION_R007.fecha,
        abonoMovimientoId: abonoId, observaciones: OBSERVACION_REDENCION_R007
      });
      redencionR007 = { yaCorregido: false, abonoId, creditoId, monto: REDENCION_R007.montoARedimir };
    } else {
      throw new Error(
        `R007: se esperaba que diciembre 2024 tuviera $${REDENCION_R007.montoARedimir} pendientes ` +
        `antes de esta corrección, tiene $${pendienteDic2024R007} -- revisar antes de aplicar a ciegas`
      );
    }

    // 14. Limpieza de las 7 suspendidas: borrar el AjusteCategoria erróneo que dobló su
    // causación. Se detecta por el texto exacto de la observación -- si ya no hay ninguna fila
    // así para una cuenta, no hace nada con ella.
    for (const codigo of CUENTAS_SUSPENDIDAS_SIN_RECAUSAR) {
      const cuentaId = idPorCodigo.get(normalizarCodigo(codigo));
      if (cuentaId === undefined) throw new Error(`${codigo}: no existe en la base -- ¿corrieron los pasos 1-2?`);

      const erroneas = db.prepare(
        `SELECT id FROM cartera_movimientos
         WHERE cuenta_id=? AND tipo='AjusteCategoria' AND mes IS NOT NULL AND observaciones LIKE ?`
      ).all(cuentaId, `%${FRAGMENTO_AJUSTE_ERRONEO_SUSPENDIDAS}%`);

      if (erroneas.length === 0) {
        limpiezaSuspendidas.push({ codigo, borradas: 0 });
        continue;
      }

      const ids = erroneas.map(e => e.id);
      const placeholders = ids.map(() => '?').join(',');
      const referenciadas = db.prepare(
        `SELECT COUNT(*) n FROM cartera_imputaciones WHERE cargo_id IN (${placeholders})`
      ).get(...ids).n;
      if (referenciadas > 0) {
        throw new Error(
          `${codigo}: ${referenciadas} imputación(es) reales sobre el AjusteCategoria erróneo -- ` +
          `revisar antes de borrar a ciegas`
        );
      }

      db.prepare(`DELETE FROM cartera_movimientos WHERE id IN (${placeholders})`).run(...ids);
      limpiezaSuspendidas.push({ codigo, borradas: ids.length });
    }

    // 15. R0942: crear el saldo a favor de $4.000 que el recibo 2246 documenta pero que nunca
    // se registró en ninguna parte. Se detecta por si ya existe un crédito ligado a este mismo
    // abono.
    const cuentaR0942 = idPorCodigo.get(normalizarCodigo(CREDITO_R0942.codigoCuenta));
    if (cuentaR0942 === undefined) throw new Error('R0942: no existe en la base -- ¿corrieron los pasos 1-2?');

    const { detalleId: detalle2246Id } = getReciboDetalle(db, CREDITO_R0942.numeroRecibo);
    const abono2246 = getAbonoPorDetalle(db, detalle2246Id);
    if (!abono2246) throw new Error(`Recibo ${CREDITO_R0942.numeroRecibo}: no tiene Abono asociado -- ¿corrió el paso 10?`);

    const creditoExistenteR0942 = db.prepare(
      `SELECT id FROM cuenta_creditos WHERE cuenta_id=? AND abono_movimiento_id=?`
    ).get(cuentaR0942, abono2246.id);

    if (creditoExistenteR0942) {
      creditoR0942 = { yaCorregido: true };
    } else {
      const creditoId = repo.crearCredito({
        cuentaId: cuentaR0942, tipo: 'Abono', monto: CREDITO_R0942.monto, fecha: CREDITO_R0942.fecha,
        reciboDetalleId: detalle2246Id, abonoMovimientoId: abono2246.id,
        observaciones: OBSERVACION_CREDITO_R0942
      });
      creditoR0942 = { yaCorregido: false, creditoId, monto: CREDITO_R0942.monto };
    }

    // 16. R0831: recalcular 2159, 2311 y 2407 juntos, en orden cronológico. Se detecta por si
    // el recibo 2159 ya tiene alguna imputación real -- en el estado original (y en la versión
    // anterior de esta corrección, que nunca tocó 2159) siempre tiene cero, porque quedó
    // convertido íntegro en crédito desde la carga inicial.
    const cuentaR0831 = idPorCodigo.get(normalizarCodigo(RECALCULO_R0831.cuentaCodigo));
    if (cuentaR0831 === undefined) throw new Error('R0831: no existe en la base -- ¿corrieron los pasos 1-2?');

    const { detalleId: detalle2159Id } = getReciboDetalle(db, RECALCULO_R0831.abonosOrdenCronologico[0].numeroRecibo);
    const abono2159 = getAbonoPorDetalle(db, detalle2159Id);
    if (!abono2159) throw new Error('Recibo 2159: no tiene Abono asociado -- ¿corrió el paso 10?');

    const imputado2159 = db.prepare(
      `SELECT COALESCE(SUM(monto),0) s FROM cartera_imputaciones WHERE abono_id=?`
    ).get(abono2159.id).s;

    if (imputado2159 > 0) {
      recalculoR0831 = { yaCorregido: true };
    } else {
      // Deshace lo que haya (créditos e imputaciones) de los tres abonos, incluida cualquier
      // fila que haya dejado la versión anterior de esta corrección (crédito ligado al abono
      // del recibo 2407), y restaura cada abono a su monto original antes de recalcular.
      const abonos = RECALCULO_R0831.abonosOrdenCronologico.map(item => {
        const { detalleId } = getReciboDetalle(db, item.numeroRecibo);
        const abono = getAbonoPorDetalle(db, detalleId);
        if (!abono) throw new Error(`Recibo ${item.numeroRecibo}: no tiene Abono asociado -- ¿corrió el paso 10?`);
        return { ...item, detalleId, abonoId: abono.id };
      });

      for (const a of abonos) {
        db.prepare('DELETE FROM cartera_imputaciones WHERE abono_id=?').run(a.abonoId);
        db.prepare('DELETE FROM cuenta_creditos WHERE abono_movimiento_id=? OR recibo_detalle_id=?').run(a.abonoId, a.detalleId);
        const recibo = db.prepare(
          `SELECT r.total FROM recibos r JOIN recibo_detalles rd ON rd.recibo_id=r.id WHERE rd.id=?`
        ).get(a.detalleId);
        repo.actualizarMontoMovimiento(a.abonoId, -recibo.total);
      }

      const resultados = [];
      for (const a of abonos) {
        const montoOriginal = -db.prepare('SELECT monto FROM cartera_movimientos WHERE id=?').get(a.abonoId).monto;
        const r = reimputarAbono(db, repo, {
          abonoId: a.abonoId, cuentaId: cuentaR0831, monto: montoOriginal,
          periodoDesde: a.periodoDesde, periodoHasta: a.periodoHasta,
          forzarFifoSinPeriodo: a.forzarFifoSinPeriodo || false
        });
        if (r.creditoId) {
          db.prepare('UPDATE cuenta_creditos SET observaciones=? WHERE id=?').run(OBSERVACION_RECALCULO_R0831, r.creditoId);
        }
        resultados.push({ numeroRecibo: a.numeroRecibo, abonoId: a.abonoId, ...r });
      }

      recalculoR0831 = { yaCorregido: false, abonos: resultados };
    }

    // 17. PAGOS POR ADELANTADO -- ver candidatosPagoAdelantado() y el comentario de arriba.
    //
    // NUNCA borra ni reconstruye la imputación original del recibo (a diferencia de las
    // correcciones 4-9/16, que sí lo hacen porque ahí la imputación vieja estaba mal desde el
    // origen): acá lo que ya está imputado es correcto y no se toca -- incluido cualquier
    // sobrante que el FIFO del paso10/una corrección anterior ya haya usado para pagar deuda
    // vieja real (apertura opaca u otro cargo). Descubierto en la verificación de esta
    // corrección (2026-08-14): borrar y reimputar desde cero, aunque preserva el TOTAL de
    // plata, cambia A QUÉ se aplica -- si antes parte del sobrante pagaba una apertura opaca
    // real y ahora el período recién causado absorbe todo el abono, esa apertura queda
    // "despagada" de nuevo aunque nadie tocó esa deuda. El mecanismo seguro es
    // CarteraService.redimirCredito (el mismo que ya usa el operador desde la pantalla) contra
    // los cargos puntuales del período declarado -- nunca toca imputaciones existentes, solo
    // agrega una nueva.
    //
    // Chequeo de seguridad ANTES de causar nada: si el crédito disponible de la cuenta no
    // alcanza para cubrir lo que el período declarado necesita, es señal de que parte de esa
    // plata ya se usó en otra cosa (deuda vieja real) o de que el recibo, en plata, nunca
    // alcanzó para todo lo que dice cubrir -- en cualquiera de los dos casos hay algo que
    // revisar con el talonario antes de tocar la cuenta, así que se deja intacta y se reporta
    // en pendientesManuales en vez de causar meses que van a quedar a medio pagar.
    for (const candidato of candidatosPagoAdelantado(db)) {
      const necesario = costoPeriodoSinCausar(db, pagoRepo, candidato.cuentaId, candidato.desde, candidato.hasta);

      if (!esMayor(necesario, 0)) {
        pagosAdelantados.push({ codigo: candidato.codigo, numeroRecibo: candidato.numeroRecibo, yaCorregido: true });
        continue;
      }

      const disponible = repo.getSaldoCreditoDisponible(candidato.cuentaId);
      if (esMayor(necesario, disponible)) {
        pendientesManuales.push({
          codigo: candidato.codigo, numeroRecibo: candidato.numeroRecibo,
          motivo: 'credito_insuficiente', disponible, necesario, faltante: redondear(necesario - disponible)
        });
        continue;
      }

      // asegurarCausacion causa TODO lo que falte desde el ancla real de la cuenta hasta
      // `hasta` -- no solo lo que este recibo declaró. Si hay un hueco entre lo ya causado y el
      // `desde` de este recibo (otros meses, sin relación con él, que tampoco se han causado
      // nunca), asegurarCausacion los crearía igual -- y como cargosPendientesEnRango/
      // redimirCredito de acá abajo solo cubren [desde, hasta], esos meses del hueco quedarían
      // causados y sin pagar, deuda nueva que nadie pidió resolver (hallazgo real: C019, recibo
      // con período Octubre-Diciembre 2026 mientras la cuenta solo tenía causado hasta julio --
      // agosto y septiembre quedaban huérfanos). Se recalcula el máximo causado en este punto
      // (no el de candidatosPagoAdelantado, que es de antes de este loop y puede estar
      // desactualizado si una cuenta tiene más de un candidato) para decidir si hay hueco.
      const maxCod = db.prepare(
        `SELECT MAX(anio * 12 + (mes - 1)) AS cod FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual'`
      ).get(candidato.cuentaId).cod;
      const desdeCod = candidato.desde.anio * 12 + (candidato.desde.mes - 1);
      if (maxCod !== null && desdeCod > maxCod + 1) {
        pendientesManuales.push({
          codigo: candidato.codigo, numeroRecibo: candidato.numeroRecibo,
          motivo: 'hueco_antes_del_periodo_declarado',
          ultimoCausado: decodificarPeriodo(maxCod), desdeDeclarado: candidato.desde
        });
        continue;
      }

      const causacion = service.asegurarCausacion(candidato.cuentaId, candidato.hasta.anio, candidato.hasta.mes);

      const pendientesEnRango = cargosPendientesEnRango(db, candidato.cuentaId, candidato.desde, candidato.hasta);
      const creditoInfo = db.prepare('SELECT fecha FROM cuenta_creditos WHERE id=?').get(candidato.creditoId);
      const redencion = service.redimirCredito({
        cuentaId: candidato.cuentaId, fecha: creditoInfo.fecha, monto: necesario,
        modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: pendientesEnRango.map(c => c.id),
        observaciones: OBSERVACION_PAGO_ADELANTADO
      });

      pagosAdelantados.push({
        codigo: candidato.codigo, numeroRecibo: candidato.numeroRecibo, yaCorregido: false,
        creados: causacion.creados, aplicado: redencion.aplicado, saldoRestante: redencion.saldoRestante
      });
    }

    // 18. Ver comentario junto a REDENCION_R007_2026 más arriba.
    //
    // Detección de idempotencia: si diciembre 2026 ya existe y no tiene nada pendiente, esta
    // corrección ya corrió (o algo más lo cerró) -- se detiene sin volver a causar ni redimir.
    // Si diciembre 2026 no existe todavía, se verifica que el crédito disponible sea EXACTAMENTE
    // el esperado antes de causar y redimir nada -- mismo criterio de "no adivinar" que la
    // corrección 13: cualquier otro valor es un estado inesperado y se detiene con un error.
    const cuentaR007b = idPorCodigo.get(normalizarCodigo(REDENCION_R007_2026.codigoCuenta));
    if (cuentaR007b === undefined) throw new Error('R007: no existe en la base -- ¿corrieron los pasos 1-2?');

    const cargoDic2026R007 = db.prepare(
      `SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=? AND mes=?`
    ).get(cuentaR007b, REDENCION_R007_2026.hasta.anio, REDENCION_R007_2026.hasta.mes);

    if (cargoDic2026R007) {
      const cubiertoDic2026R007 = db.prepare(
        `SELECT COALESCE(SUM(monto),0) AS total FROM cartera_imputaciones WHERE cargo_id=?`
      ).get(cargoDic2026R007.id).total;
      const pendienteDic2026R007 = redondear(cargoDic2026R007.monto - cubiertoDic2026R007);

      if (!esMayor(pendienteDic2026R007, 0)) {
        redencionR007Adelantado = { yaCorregido: true };
      } else {
        throw new Error(
          `R007: diciembre 2026 ya existe pero tiene $${pendienteDic2026R007} pendientes -- ` +
          'estado inesperado, revisar antes de aplicar a ciegas'
        );
      }
    } else {
      const disponibleR007b = repo.getSaldoCreditoDisponible(cuentaR007b);
      if (Math.abs(disponibleR007b - REDENCION_R007_2026.montoARedimir) >= 1) {
        throw new Error(
          `R007: se esperaba $${REDENCION_R007_2026.montoARedimir} de credito disponible antes de ` +
          `esta correccion, hay $${disponibleR007b} -- revisar antes de aplicar a ciegas`
        );
      }

      const causacionR007b = service.asegurarCausacion(
        cuentaR007b, REDENCION_R007_2026.hasta.anio, REDENCION_R007_2026.hasta.mes
      );
      const pendientesAgostoDiciembre2026 = cargosPendientesEnRango(
        db, cuentaR007b, { anio: 2026, mes: 8 }, REDENCION_R007_2026.hasta
      );
      const redencionR007b = service.redimirCredito({
        cuentaId: cuentaR007b, fecha: REDENCION_R007_2026.fecha, monto: REDENCION_R007_2026.montoARedimir,
        modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: pendientesAgostoDiciembre2026.map(c => c.id),
        observaciones: OBSERVACION_REDENCION_R007_2026
      });

      redencionR007Adelantado = {
        yaCorregido: false, creados: causacionR007b.creados,
        aplicado: redencionR007b.aplicado, saldoRestante: redencionR007b.saldoRestante
      };
    }

    // 19. Ver comentario junto a REDENCIONES_REAJUSTE_2024 más arriba.
    //
    // Detección de idempotencia: si el último mes del rango ya no tiene nada pendiente, esta
    // redención ya corrió. Si el crédito disponible no alcanza el monto exacto a redimir antes
    // de empezar, es un estado inesperado -- se detiene en vez de redimir lo que sí haya.
    for (const r of REDENCIONES_REAJUSTE_2024) {
      const cuentaId = idPorCodigo.get(normalizarCodigo(r.codigoCuenta));
      if (cuentaId === undefined) throw new Error(`${r.codigoCuenta}: no existe en la base -- ¿corrieron los pasos 1-2?`);

      const cargoUltimoMes = db.prepare(
        `SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=? AND mes=?`
      ).get(cuentaId, r.hasta.anio, r.hasta.mes);
      if (!cargoUltimoMes) {
        throw new Error(`${r.codigoCuenta}: no tiene CargoMensual de ${r.hasta.anio}-${r.hasta.mes} -- ¿corrieron los pasos 9/10?`);
      }
      const cubiertoUltimoMes = db.prepare(
        `SELECT COALESCE(SUM(monto),0) AS total FROM cartera_imputaciones WHERE cargo_id=?`
      ).get(cargoUltimoMes.id).total;
      const pendienteUltimoMes = redondear(cargoUltimoMes.monto - cubiertoUltimoMes);

      if (!esMayor(pendienteUltimoMes, 0)) {
        redencionesReajuste2024.push({ codigo: r.codigoCuenta, yaCorregido: true });
        continue;
      }

      const disponible = repo.getSaldoCreditoDisponible(cuentaId);
      if (Math.abs(disponible - r.montoARedimir) >= 1 && disponible < r.montoARedimir) {
        throw new Error(
          `${r.codigoCuenta}: se esperaba al menos $${r.montoARedimir} de credito disponible antes ` +
          `de esta correccion, hay $${disponible} -- revisar antes de aplicar a ciegas`
        );
      }

      const pendientesEnRango = cargosPendientesEnRango(db, cuentaId, r.desde, r.hasta);
      const redencion = service.redimirCredito({
        cuentaId, fecha: r.fecha, monto: r.montoARedimir,
        modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: pendientesEnRango.map(c => c.id),
        observaciones: r.observaciones
      });

      redencionesReajuste2024.push({
        codigo: r.codigoCuenta, yaCorregido: false,
        aplicado: redencion.aplicado, saldoRestante: redencion.saldoRestante
      });
    }

    // 20. Ver comentario junto a REDENCION_S023 más arriba.
    //
    // Misma detección de idempotencia que la corrección 19: si julio 2024 ya no tiene nada
    // pendiente, esta redención ya corrió. Si el crédito disponible no coincide exacto con el
    // monto a redimir antes de empezar, es un estado inesperado -- se detiene.
    {
      const cuentaS023 = idPorCodigo.get(normalizarCodigo(REDENCION_S023.codigoCuenta));
      if (cuentaS023 === undefined) {
        throw new Error('S023: no existe en la base -- ¿corrieron los pasos 1-2?');
      }

      const cargoJulioS023 = db.prepare(
        `SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=? AND mes=?`
      ).get(cuentaS023, REDENCION_S023.hasta.anio, REDENCION_S023.hasta.mes);
      if (!cargoJulioS023) {
        throw new Error(
          `S023: no tiene CargoMensual de ${REDENCION_S023.hasta.anio}-${REDENCION_S023.hasta.mes} -- ¿corrieron los pasos 9/10?`
        );
      }
      const cubiertoJulioS023 = db.prepare(
        `SELECT COALESCE(SUM(monto),0) AS total FROM cartera_imputaciones WHERE cargo_id=?`
      ).get(cargoJulioS023.id).total;
      const pendienteJulioS023 = redondear(cargoJulioS023.monto - cubiertoJulioS023);

      if (!esMayor(pendienteJulioS023, 0)) {
        redencionS023 = { yaCorregido: true };
      } else {
        const disponibleS023 = repo.getSaldoCreditoDisponible(cuentaS023);
        if (Math.abs(disponibleS023 - REDENCION_S023.montoARedimir) >= 1) {
          throw new Error(
            `S023: se esperaba $${REDENCION_S023.montoARedimir} de credito disponible antes de ` +
            `esta correccion, hay $${disponibleS023} -- revisar antes de aplicar a ciegas`
          );
        }

        const pendientesJulioS023 = cargosPendientesEnRango(db, cuentaS023, REDENCION_S023.desde, REDENCION_S023.hasta);
        const redencion = service.redimirCredito({
          cuentaId: cuentaS023, fecha: REDENCION_S023.fecha, monto: REDENCION_S023.montoARedimir,
          modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: pendientesJulioS023.map(c => c.id),
          observaciones: OBSERVACION_REDENCION_S023
        });

        redencionS023 = {
          yaCorregido: false,
          aplicado: redencion.aplicado, saldoRestante: redencion.saldoRestante
        };
      }
    }

    // 21-22. Ver comentario junto a REDENCIONES_HUECO_TEXTUAL_2026 más arriba.
    //
    // Misma detección de idempotencia y mismo chequeo "al menos" que la corrección 19: si el
    // último mes del rango ya no tiene nada pendiente, ya corrió. Si el crédito disponible no
    // alcanza el monto a redimir, es un estado inesperado -- se detiene.
    for (const r of REDENCIONES_HUECO_TEXTUAL_2026) {
      const cuentaId = idPorCodigo.get(normalizarCodigo(r.codigoCuenta));
      if (cuentaId === undefined) throw new Error(`${r.codigoCuenta}: no existe en la base -- ¿corrieron los pasos 1-2?`);

      const cargoUltimoMes = db.prepare(
        `SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=? AND mes=?`
      ).get(cuentaId, r.hasta.anio, r.hasta.mes);
      if (!cargoUltimoMes) {
        throw new Error(`${r.codigoCuenta}: no tiene CargoMensual de ${r.hasta.anio}-${r.hasta.mes} -- ¿corrieron los pasos 9/10?`);
      }
      const cubiertoUltimoMes = db.prepare(
        `SELECT COALESCE(SUM(monto),0) AS total FROM cartera_imputaciones WHERE cargo_id=?`
      ).get(cargoUltimoMes.id).total;
      const pendienteUltimoMes = redondear(cargoUltimoMes.monto - cubiertoUltimoMes);

      if (!esMayor(pendienteUltimoMes, 0)) {
        redencionesHuecoTextual2026.push({ codigo: r.codigoCuenta, yaCorregido: true });
        continue;
      }

      const disponible = repo.getSaldoCreditoDisponible(cuentaId);
      if (Math.abs(disponible - r.montoARedimir) >= 1 && disponible < r.montoARedimir) {
        throw new Error(
          `${r.codigoCuenta}: se esperaba al menos $${r.montoARedimir} de credito disponible antes ` +
          `de esta correccion, hay $${disponible} -- revisar antes de aplicar a ciegas`
        );
      }

      const pendientesEnRango = cargosPendientesEnRango(db, cuentaId, r.desde, r.hasta);
      const redencion = service.redimirCredito({
        cuentaId, fecha: r.fecha, monto: r.montoARedimir,
        modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: pendientesEnRango.map(c => c.id),
        observaciones: r.observaciones
      });

      redencionesHuecoTextual2026.push({
        codigo: r.codigoCuenta, yaCorregido: false,
        aplicado: redencion.aplicado, saldoRestante: redencion.saldoRestante
      });
    }

    // 23. Ver comentario junto a MERGE_R0081_S058 más arriba.
    {
      const cuentaDestinoMerge = idPorCodigo.get(normalizarCodigo(MERGE_R0081_S058.codigoDestino));
      if (cuentaDestinoMerge === undefined) {
        throw new Error(`${MERGE_R0081_S058.codigoDestino}: no existe en la base -- ¿corrieron los pasos 1-2?`);
      }

      const cuentaOrigenMerge = idPorCodigo.get(normalizarCodigo(MERGE_R0081_S058.codigoOrigen));
      if (cuentaOrigenMerge === undefined) {
        // S058 ya no existe -- esta corrección ya corrió (o nunca hizo falta, en un reimport
        // limpio donde codigos.js ya mapea R0081 directo, sin crear S058 aparte).
        mergeR0081S058 = { yaAplicado: true };
      } else {
        const reciboPunto = db.prepare('SELECT id, cuenta_id, observaciones FROM recibos WHERE numero_recibo=?')
          .get(MERGE_R0081_S058.numeroReciboPunto);
        if (!reciboPunto) throw new Error(`Recibo ${MERGE_R0081_S058.numeroReciboPunto}: no existe -- ¿corrió el paso 7?`);
        if (reciboPunto.cuenta_id !== cuentaOrigenMerge) {
          throw new Error(
            `Recibo ${MERGE_R0081_S058.numeroReciboPunto}: se esperaba en cuenta_id=${cuentaOrigenMerge} ` +
            `(${MERGE_R0081_S058.codigoOrigen}), está en cuenta_id=${reciboPunto.cuenta_id} -- revisar antes de fusionar a ciegas`
          );
        }

        const observacionesNuevas = (reciboPunto.observaciones ? reciboPunto.observaciones + ' | ' : '') + OBSERVACION_MERGE_R0081_S058;
        db.prepare('UPDATE recibos SET cuenta_id=?, observaciones=? WHERE id=?')
          .run(cuentaDestinoMerge, observacionesNuevas, reciboPunto.id);
        const puntoMovido = db.prepare('UPDATE nuevos_puntos SET cuenta_id=? WHERE cuenta_id=?')
          .run(cuentaDestinoMerge, cuentaOrigenMerge).changes;
        // Los CargoMensual de la cuenta origen son duplicados exactos de los que ya tiene la
        // cuenta destino (misma deuda real, cobrada dos veces) -- se borran, no se mueven.
        const movimientosDuplicadosBorrados = db.prepare('DELETE FROM cartera_movimientos WHERE cuenta_id=?')
          .run(cuentaOrigenMerge).changes;
        db.prepare('DELETE FROM cuenta_propietarios WHERE cuenta_id=?').run(cuentaOrigenMerge);
        db.prepare('DELETE FROM cuenta_estados WHERE cuenta_id=?').run(cuentaOrigenMerge);
        db.prepare('DELETE FROM cuenta_categorias WHERE cuenta_id=?').run(cuentaOrigenMerge);
        db.prepare('DELETE FROM cuentas WHERE id=?').run(cuentaOrigenMerge);

        mergeR0081S058 = {
          yaAplicado: false, reciboMovido: reciboPunto.id, puntoMovido: puntoMovido > 0,
          movimientosDuplicadosBorrados, cuentaOrigenEliminada: cuentaOrigenMerge
        };
      }
    }

    // 24. Ver comentario junto a REIMPUTACION_S0312 más arriba.
    {
      const cuentaS0312 = idPorCodigo.get(normalizarCodigo(REIMPUTACION_S0312.codigoCuenta));
      if (cuentaS0312 === undefined) throw new Error('S0312: no existe en la base -- ¿corrieron los pasos 1-2?');

      const resultados = [];
      for (const r of REIMPUTACION_S0312.recibos) {
        const { detalleId } = getReciboDetalle(db, r.numeroRecibo);
        const abono = getAbonoPorDetalle(db, detalleId);
        if (!abono) throw new Error(`Recibo ${r.numeroRecibo}: no tiene movimiento de Abono -- ¿corrió el paso 8?`);
        if (abono.cuenta_id !== cuentaS0312) {
          throw new Error(`Recibo ${r.numeroRecibo}: se esperaba en cuenta_id=${cuentaS0312} (S0312), está en cuenta_id=${abono.cuenta_id}`);
        }

        const [anioDesde, mesDesde] = r.periodoDesde.split('-').map(Number);
        const imputacionesAbono = db.prepare(`
          SELECT cg.anio, cg.mes FROM cartera_imputaciones i JOIN cartera_movimientos cg ON cg.id = i.cargo_id
          WHERE i.abono_id = ?
        `).all(abono.id);
        // Ordena los meses reales primero (AperturaOpaca no tiene anio/mes -- no sirve para
        // comparar contra el período declarado del recibo).
        const primeraImputacion = imputacionesAbono
          .filter(x => x.anio !== null)
          .sort((a, b) => a.anio - b.anio || a.mes - b.mes)[0];
        const tocaApertura = imputacionesAbono.some(x => x.anio === null);
        const yaCorregido = !!primeraImputacion &&
          primeraImputacion.anio === anioDesde && primeraImputacion.mes === mesDesde &&
          (r.permitirFifoConPeriodo !== false || !tocaApertura);

        if (yaCorregido) {
          resultados.push({ numeroRecibo: r.numeroRecibo, reimputado: false });
          continue;
        }

        // Deshacer: borrar imputaciones e cualquier crédito que este abono haya dejado, y
        // restaurar el movimiento a su monto original completo antes de reaplicar.
        const creditoPrevio = db.prepare('SELECT COALESCE(SUM(monto),0) AS s FROM cuenta_creditos WHERE recibo_detalle_id=?')
          .get(detalleId).s;
        const montoOriginal = redondear(Math.abs(abono.monto) + creditoPrevio);
        db.prepare('DELETE FROM cartera_imputaciones WHERE abono_id=?').run(abono.id);
        db.prepare('DELETE FROM cuenta_creditos WHERE recibo_detalle_id=?').run(detalleId);
        db.prepare('UPDATE cartera_movimientos SET monto=? WHERE id=?').run(-montoOriginal, abono.id);

        const resultado = reimputarAbono(db, repo, {
          abonoId: abono.id, cuentaId: cuentaS0312, monto: montoOriginal,
          periodoDesde: r.periodoDesde, periodoHasta: r.periodoHasta,
          permitirFifoConPeriodo: r.permitirFifoConPeriodo
        });
        // La observación del crédito que crea reimputarAbono es genérica; se sobreescribe con
        // el detalle específico de esta corrección, si quedó algún sobrante.
        if (resultado.creditoId) {
          db.prepare('UPDATE cuenta_creditos SET observaciones=? WHERE id=?')
            .run(r.observaciones, resultado.creditoId);
        }
        resultados.push({ numeroRecibo: r.numeroRecibo, reimputado: true, ...resultado });
      }
      reimputacionS0312 = { cuentaId: cuentaS0312, resultados };
    }

    // 25. Ver comentario junto a REDENCION_R049 más arriba. Mismo patrón que S023/S0501/S022.
    {
      const cuentaR049 = idPorCodigo.get(normalizarCodigo(REDENCION_R049.codigoCuenta));
      if (cuentaR049 === undefined) throw new Error('R049: no existe en la base -- ¿corrieron los pasos 1-2?');

      const cargoMayoR049 = db.prepare(
        `SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=? AND mes=?`
      ).get(cuentaR049, REDENCION_R049.hasta.anio, REDENCION_R049.hasta.mes);
      if (!cargoMayoR049) {
        throw new Error(`R049: no tiene CargoMensual de ${REDENCION_R049.hasta.anio}-${REDENCION_R049.hasta.mes} -- ¿corrieron los pasos 9/10?`);
      }
      const cubiertoMayoR049 = db.prepare(
        `SELECT COALESCE(SUM(monto),0) AS total FROM cartera_imputaciones WHERE cargo_id=?`
      ).get(cargoMayoR049.id).total;
      const pendienteMayoR049 = redondear(cargoMayoR049.monto - cubiertoMayoR049);

      if (!esMayor(pendienteMayoR049, 0)) {
        redencionR049 = { yaCorregido: true };
      } else {
        const disponibleR049 = repo.getSaldoCreditoDisponible(cuentaR049);
        if (Math.abs(disponibleR049 - REDENCION_R049.montoARedimir) >= 1 && disponibleR049 < REDENCION_R049.montoARedimir) {
          throw new Error(
            `R049: se esperaba al menos $${REDENCION_R049.montoARedimir} de credito disponible antes ` +
            `de esta correccion, hay $${disponibleR049} -- revisar antes de aplicar a ciegas`
          );
        }

        const pendientesR049 = cargosPendientesEnRango(db, cuentaR049, REDENCION_R049.desde, REDENCION_R049.hasta);
        const redencion = service.redimirCredito({
          cuentaId: cuentaR049, fecha: REDENCION_R049.fecha, monto: REDENCION_R049.montoARedimir,
          modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: pendientesR049.map(c => c.id),
          observaciones: OBSERVACION_REDENCION_R049
        });

        redencionR049 = { yaCorregido: false, aplicado: redencion.aplicado, saldoRestante: redencion.saldoRestante };
      }
    }

    // 26. Ver comentario junto a REASIGNACION_RECIBO_458 más arriba.
    {
      const cuentaOrigen458 = idPorCodigo.get(normalizarCodigo(REASIGNACION_RECIBO_458.codigoCuentaOrigen));
      const cuentaDestino458 = idPorCodigo.get(normalizarCodigo(REASIGNACION_RECIBO_458.codigoCuentaDestino));
      if (cuentaOrigen458 === undefined) throw new Error('S0331: no existe en la base -- ¿corrieron los pasos 1-2?');
      if (cuentaDestino458 === undefined) throw new Error('S03311: no existe en la base -- ¿corrieron los pasos 1-2?');

      const recibo458 = db.prepare('SELECT id, cuenta_id FROM recibos WHERE numero_recibo=?').get(REASIGNACION_RECIBO_458.numeroRecibo);
      if (!recibo458) throw new Error(`Recibo ${REASIGNACION_RECIBO_458.numeroRecibo}: no existe -- ¿corrió el paso 7?`);

      if (recibo458.cuenta_id === cuentaDestino458) {
        reasignacion458 = { yaAplicado: true };
      } else {
        if (recibo458.cuenta_id !== cuentaOrigen458) {
          throw new Error(
            `Recibo ${REASIGNACION_RECIBO_458.numeroRecibo}: se esperaba en cuenta_id=${cuentaOrigen458} ` +
            `(S0331), está en cuenta_id=${recibo458.cuenta_id} -- revisar antes de reasignar a ciegas`
          );
        }
        const puntoDestino458 = db.prepare('SELECT id FROM nuevos_puntos WHERE cuenta_id=?').get(cuentaDestino458);
        if (!puntoDestino458) throw new Error('S03311: no tiene fila en nuevos_puntos -- ¿corrió el paso 6?');

        db.prepare('UPDATE recibos SET cuenta_id=? WHERE id=?').run(cuentaDestino458, recibo458.id);
        db.prepare('UPDATE nuevos_puntos SET fecha_registro=?, observaciones=? WHERE id=?')
          .run(REASIGNACION_RECIBO_458.fechaRealPago, OBSERVACION_REASIGNACION_458, puntoDestino458.id);

        reasignacion458 = { yaAplicado: false, reciboId: recibo458.id, puntoActualizado: puntoDestino458.id };
      }
    }

    // 27. Ver comentario junto a SUSPENSION_INCOBRABLES más arriba.
    for (const item of SUSPENSION_INCOBRABLES) {
      const cuentaId = idPorCodigo.get(normalizarCodigo(item.codigoCuenta));
      if (cuentaId === undefined) throw new Error(`${item.codigoCuenta}: no existe en la base -- ¿corrieron los pasos 1-2?`);

      const vigente = db.prepare(
        `SELECT id, estado, fecha_inicio FROM cuenta_estados WHERE cuenta_id=? AND fecha_fin IS NULL`
      ).get(cuentaId);
      if (!vigente || vigente.estado !== 'Suspendido') {
        throw new Error(`${item.codigoCuenta}: se esperaba un estado Suspendido vigente -- estado real: ${vigente ? vigente.estado : 'ninguno'}`);
      }
      if (vigente.fecha_inicio === item.fechaInicio) {
        suspensionIncobrables.push({ codigo: item.codigoCuenta, yaCorregido: true, borrados: 0 });
        continue;
      }

      const [anioCorte, mesCorte] = item.fechaInicio.split('-').map(Number);
      const corteCod = anioCorte * 12 + (mesCorte - 1);
      const cargosEnRango = db.prepare(
        `SELECT id FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND (anio*12+(mes-1)) >= ?`
      ).all(cuentaId, corteCod);
      const conImputacionReal = cargosEnRango.filter(c =>
        db.prepare('SELECT COUNT(*) n FROM cartera_imputaciones WHERE cargo_id=?').get(c.id).n > 0
      );
      if (conImputacionReal.length > 0) {
        throw new Error(
          `${item.codigoCuenta}: tiene ${conImputacionReal.length} CargoMensual con una imputación real ` +
          `dentro del nuevo rango suspendido -- no se puede borrar a ciegas, revisar antes de continuar`
        );
      }

      db.prepare('UPDATE cuenta_estados SET fecha_inicio=?, motivo=? WHERE id=?')
        .run(item.fechaInicio, OBSERVACION_SUSPENSION_INCOBRABLES, vigente.id);
      let borrados = 0;
      for (const c of cargosEnRango) {
        borrados += db.prepare('DELETE FROM cartera_movimientos WHERE id=?').run(c.id).changes;
      }
      suspensionIncobrables.push({ codigo: item.codigoCuenta, yaCorregido: false, borrados });
    }

    // 28. Ver comentario junto a RECIBO_FALTANTE_S0244 más arriba.
    {
      const cuentaS0244Falt = idPorCodigo.get(normalizarCodigo(RECIBO_FALTANTE_S0244.codigoCuenta));
      if (cuentaS0244Falt === undefined) throw new Error('S0244: no existe en la base -- ¿corrieron los pasos 1-2?');

      const yaExiste = db.prepare('SELECT id FROM recibos WHERE numero_recibo=?').get(RECIBO_FALTANTE_S0244.numeroRecibo);
      if (yaExiste) {
        reciboFaltanteS0244 = { yaAplicado: true };
      } else {
        const propietarioS0244Falt = db.prepare(
          'SELECT propietario_id FROM cuenta_propietarios WHERE cuenta_id=? AND fecha_fin IS NULL'
        ).get(cuentaS0244Falt);
        if (!propietarioS0244Falt) throw new Error('S0244: no tiene propietario vigente en cuenta_propietarios');

        const reciboId = db.prepare(`
          INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, observaciones)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          RECIBO_FALTANTE_S0244.numeroRecibo, cuentaS0244Falt, propietarioS0244Falt.propietario_id,
          RECIBO_FALTANTE_S0244.fecha, RECIBO_FALTANTE_S0244.valor, OBSERVACION_RECIBO_S0244
        ).lastInsertRowid;
        const detalleId = db.prepare(`
          INSERT INTO recibo_detalles (recibo_id, concepto, periodo_desde, periodo_hasta, valor)
          VALUES (?, ?, ?, ?, ?)
        `).run(reciboId, RECIBO_FALTANTE_S0244.concepto, 'Enero 2021', 'Diciembre 2021', RECIBO_FALTANTE_S0244.valor).lastInsertRowid;
        const abonoId = repo.crearMovimiento({
          cuentaId: cuentaS0244Falt, fecha: RECIBO_FALTANTE_S0244.fecha, tipo: 'Abono', exigible: 1,
          monto: -RECIBO_FALTANTE_S0244.valor, reciboDetalleId: detalleId
        });

        const resultado = reimputarAbono(db, repo, {
          abonoId, cuentaId: cuentaS0244Falt, monto: RECIBO_FALTANTE_S0244.valor,
          periodoDesde: RECIBO_FALTANTE_S0244.periodoDesde, periodoHasta: RECIBO_FALTANTE_S0244.periodoHasta
        });

        reciboFaltanteS0244 = { yaAplicado: false, reciboId, detalleId, abonoId, ...resultado };
      }
    }

    // 29. Ver comentario junto a APERTURA_INCOBRABLES más arriba.
    for (const codigo of APERTURA_INCOBRABLES) {
      const cuentaId = idPorCodigo.get(normalizarCodigo(codigo));
      if (cuentaId === undefined) throw new Error(`${codigo}: no existe en la base -- ¿corrieron los pasos 1-2?`);

      const apertura = db.prepare(`SELECT id, monto FROM cartera_movimientos WHERE cuenta_id=? AND tipo='AperturaOpaca'`).get(cuentaId);
      if (!apertura || apertura.monto === 0) {
        aperturaIncobrables.push({ codigo, yaCorregido: true });
        continue;
      }

      const conImputacionReal = db.prepare('SELECT COUNT(*) n FROM cartera_imputaciones WHERE cargo_id=?').get(apertura.id).n;
      if (conImputacionReal > 0) {
        throw new Error(
          `${codigo}: la AperturaOpaca tiene ${conImputacionReal} imputación(es) real(es) -- ` +
          `no se puede poner en 0 a ciegas, revisar antes de continuar`
        );
      }

      repo.actualizarMontoMovimiento(apertura.id, 0, OBSERVACION_APERTURA_INCOBRABLES);
      aperturaIncobrables.push({ codigo, yaCorregido: false, montoAnterior: apertura.monto });
    }

    // 30. Ver comentario junto a CUENTAS_NUEVAS_2026 más arriba.
    {
      const CuentaRepository = require('../../src/repositories/CuentaRepository');
      const CuentaEstadoRepository = require('../../src/repositories/CuentaEstadoRepository');
      const CategoriaRepository = require('../../src/repositories/CategoriaRepository');
      const NuevoPuntoRepository = require('../../src/repositories/NuevoPuntoRepository');
      const cuentaRepo = new CuentaRepository(dbService);
      const estadoRepo = new CuentaEstadoRepository(dbService);
      const categoriaRepo = new CategoriaRepository(dbService);
      const puntoRepo = new NuevoPuntoRepository(dbService);
      const categoriaFinca = categoriaRepo.findByNombre('Finca');
      if (!categoriaFinca) throw new Error('Categoría "Finca" no encontrada en la base');

      for (const item of CUENTAS_NUEVAS_2026) {
        const yaExiste = db.prepare('SELECT id FROM cuentas WHERE codigo=?').get(item.codigo);
        if (yaExiste) {
          cuentasNuevas2026.push({ codigo: item.codigo, yaAplicado: true });
          continue;
        }

        const reciboExistente = db.prepare('SELECT id FROM recibos WHERE numero_recibo=?').get(item.numeroRecibo);
        if (reciboExistente) {
          throw new Error(
            `Recibo ${item.numeroRecibo}: ya existe en la base pero ${item.codigo} todavía no -- ` +
            `estado inesperado, revisar antes de crear la cuenta a ciegas`
          );
        }

        const cuentaId = cuentaRepo.create({
          codigo: item.codigo, direccion: 'Sin dirección registrada', estado: 'Activo',
          observaciones: OBSERVACION_CUENTA_NUEVA_2026,
          categoria_id: categoriaFinca.id, categoria_fecha_inicio: FECHA_CUENTAS_NUEVAS_2026
        });

        const propietarioId = db.prepare('INSERT INTO propietarios (nombre_completo) VALUES (?)')
          .run(item.nombre).lastInsertRowid;
        db.prepare('INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, ?)')
          .run(cuentaId, propietarioId, FECHA_CUENTAS_NUEVAS_2026);

        estadoRepo.sembrarVigenciaInicial({
          cuentaId, estado: 'Activo', fechaInicio: FECHA_CUENTAS_NUEVAS_2026,
          motivo: OBSERVACION_CUENTA_NUEVA_2026
        });

        const reciboId = db.prepare(`
          INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, observaciones)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          item.numeroRecibo, cuentaId, propietarioId, FECHA_CUENTAS_NUEVAS_2026, 100000, OBSERVACION_CUENTA_NUEVA_2026
        ).lastInsertRowid;
        const detalleId = db.prepare(`
          INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, ?, ?)
        `).run(reciboId, 'ABONO PUNTO NUEVO DE AGUA', 100000).lastInsertRowid;

        const nuevoPuntoId = puntoRepo.create({
          cuentaId, valorTotal: VALOR_PUNTO_NUEVO_2026, fechaRegistro: FECHA_CUENTAS_NUEVAS_2026,
          observaciones: OBSERVACION_CUENTA_NUEVA_2026
        });
        puntoRepo.crearAbono({
          nuevoPuntoId, monto: 100000, fechaAbono: FECHA_CUENTAS_NUEVAS_2026,
          reciboDetalleId: detalleId, observaciones: OBSERVACION_CUENTA_NUEVA_2026
        });
        const { saldoPendiente, estado } = puntoRepo.actualizarSaldoYEstado(nuevoPuntoId);

        cuentasNuevas2026.push({
          codigo: item.codigo, yaAplicado: false, cuentaId, propietarioId,
          reciboId, nuevoPuntoId, saldoPendiente, estado
        });
      }
    }

    // 32. Ver comentario junto a RECIBOS_FALTANTES_2026 más arriba.
    {
      const propietarioVigente = (cuentaId) => db.prepare(
        `SELECT propietario_id FROM cuenta_propietarios WHERE cuenta_id=? AND fecha_fin IS NULL`
      ).get(cuentaId);
      const mesesEntre = (desde, hasta) => {
        const lista = [];
        for (let c = desde.anio * 12 + desde.mes; c <= hasta.anio * 12 + hasta.mes; c++) {
          lista.push({ anio: Math.floor((c - 1) / 12), mes: ((c - 1) % 12) + 1 });
        }
        return lista;
      };
      const pendienteEnRango = (cuentaId, periodos) => repo.getCargosPendientes(cuentaId, 1)
        .filter(c => periodos.some(p => p.anio === c.anio && p.mes === c.mes));

      for (const item of RECIBOS_FALTANTES_2026) {
        const yaExiste = db.prepare('SELECT id FROM recibos WHERE numero_recibo=?').get(item.numeroRecibo);
        if (yaExiste) {
          recibosFaltantes2026.push({ numeroRecibo: item.numeroRecibo, codigo: item.codigo, yaAplicado: true });
          continue;
        }

        const cuentaId = idPorCodigo.get(normalizarCodigo(item.codigo));
        if (!cuentaId) throw new Error(`Corrección 32 (${item.numeroRecibo}/${item.codigo}): la cuenta no existe`);
        const propietario = propietarioVigente(cuentaId);
        if (!propietario) throw new Error(`Corrección 32 (${item.numeroRecibo}/${item.codigo}): sin propietario vigente`);

        const periodos = mesesEntre(item.desde, item.hasta);
        const causacion = service.asegurarCausacion(cuentaId, item.hasta.anio, item.hasta.mes, item.desde);
        if (causacion.omitidos.length > 0) {
          throw new Error(`Corrección 32 (${item.numeroRecibo}/${item.codigo}): no se pudo causar -- ${JSON.stringify(causacion.omitidos)}`);
        }

        const cargosPendientes = pendienteEnRango(cuentaId, periodos);
        if (cargosPendientes.length !== periodos.length) {
          throw new Error(`Corrección 32 (${item.numeroRecibo}/${item.codigo}): se esperaban ${periodos.length} cargos pendientes, se encontraron ${cargosPendientes.length}`);
        }

        const reciboId = pagoRepo.crearRecibo({
          numeroRecibo: item.numeroRecibo, cuentaId, propietarioId: propietario.propietario_id,
          fechaRecibo: item.fecha, total: item.monto, metodoPago: item.metodoPago,
          observaciones: OBSERVACION_RECIBO_FALTANTE_2026
        });
        const detalleId = pagoRepo.crearReciboDetalle({
          reciboId, concepto: item.concepto,
          periodoDesde: formatearPeriodoTexto(item.desde), periodoHasta: formatearPeriodoTexto(item.hasta),
          valor: item.monto
        });

        const abono = service.registrarAbono({
          cuentaId, fecha: item.fecha, monto: item.monto, modo: MODOS.MESES_ESPECIFICOS,
          cargosElegidos: cargosPendientes.map(c => c.id), reciboDetalleId: detalleId,
          observaciones: OBSERVACION_RECIBO_FALTANTE_2026
        });
        if (esMayor(abono.sobrante, 0)) {
          throw new Error(`Corrección 32 (${item.numeroRecibo}/${item.codigo}): quedó sobrante sin imputar de $${abono.sobrante}`);
        }
        const pendienteFinal = pendienteEnRango(cuentaId, periodos).reduce((s, c) => s + c.pendiente, 0);
        if (esMayor(pendienteFinal, 0)) {
          throw new Error(`Corrección 32 (${item.numeroRecibo}/${item.codigo}): quedó pendiente de $${pendienteFinal} dentro del rango declarado`);
        }

        recibosFaltantes2026.push({
          numeroRecibo: item.numeroRecibo, codigo: item.codigo, yaAplicado: false,
          cuentaId, reciboId, monto: item.monto
        });
      }

      // Caso especial 2549 (S015): enero-julio 2026 ya estaban pagados por otro recibo (FIFO,
      // ver comentario arriba) -- solo agosto-diciembre estaba realmente pendiente. El resto del
      // efectivo recibido ($70.000 de los $120.000) se banquea como saldo a favor real: mismo
      // mecanismo que cualquier sobrante de `registrarAbono` (ver CarteraService.registrarAbono).
      {
        const numeroRecibo = 2549;
        const yaExiste = db.prepare('SELECT id FROM recibos WHERE numero_recibo=?').get(numeroRecibo);
        if (yaExiste) {
          recibosFaltantes2026.push({ numeroRecibo, codigo: 'S015', yaAplicado: true });
        } else {
          const cuentaId = idPorCodigo.get(normalizarCodigo('S015'));
          const propietario = propietarioVigente(cuentaId);
          if (!propietario) throw new Error('Corrección 32 (2549/S015): sin propietario vigente');

          service.asegurarCausacion(cuentaId, 2026, 12, { anio: 2026, mes: 1 });
          const pendientes2026 = pendienteEnRango(cuentaId, mesesEntre({ anio: 2026, mes: 1 }, { anio: 2026, mes: 12 }));
          if (pendientes2026.length !== 5) {
            throw new Error(`Corrección 32 (2549/S015): se esperaban 5 meses pendientes de 2026 (ago-dic), se encontraron ${pendientes2026.length}`);
          }

          const reciboId = pagoRepo.crearRecibo({
            numeroRecibo, cuentaId, propietarioId: propietario.propietario_id,
            fechaRecibo: '2026-07-18', total: 120000, metodoPago: 'Efectivo',
            observaciones: OBSERVACION_RECIBO_FALTANTE_2026 + ' Enero-julio 2026 ya estaban ' +
              'pagados por los recibos 2152 y 2301 (el sobrante de esos abonos llegó ahí por ' +
              'FIFO, ver corrección 31); de este recibo, $50.000 se aplican a agosto-diciembre ' +
              '2026 (lo único pendiente dentro del rango) y $70.000 quedan como saldo a favor real.'
          });
          const detalleId = pagoRepo.crearReciboDetalle({
            reciboId, concepto: 'CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2026',
            periodoDesde: 'Enero 2026', periodoHasta: 'Diciembre 2026', valor: 120000
          });

          const abono = service.registrarAbono({
            cuentaId, fecha: '2026-07-18', monto: 120000, modo: MODOS.MESES_ESPECIFICOS,
            cargosElegidos: pendientes2026.map(c => c.id), reciboDetalleId: detalleId,
            observaciones: OBSERVACION_RECIBO_FALTANTE_2026
          });
          if (redondear(abono.sobrante) !== 70000) {
            throw new Error(`Corrección 32 (2549/S015): se esperaba un sobrante de $70.000, salió $${abono.sobrante}`);
          }

          recibosFaltantes2026.push({
            numeroRecibo, codigo: 'S015', yaAplicado: false, cuentaId, reciboId,
            monto: 120000, sobranteCredito: abono.sobrante
          });
        }
      }

      // Caso especial 2551 (S0292): no es sostenimiento -- abono al punto de conexión ya
      // existente de esta cuenta (nuevos_puntos).
      {
        const numeroRecibo = 2551;
        const yaExiste = db.prepare('SELECT id FROM recibos WHERE numero_recibo=?').get(numeroRecibo);
        if (yaExiste) {
          recibosFaltantes2026.push({ numeroRecibo, codigo: 'S0292', yaAplicado: true });
        } else {
          const NuevoPuntoRepository = require('../../src/repositories/NuevoPuntoRepository');
          const puntoRepo = new NuevoPuntoRepository(dbService);
          const cuentaId = idPorCodigo.get(normalizarCodigo('S0292'));
          const propietario = propietarioVigente(cuentaId);
          if (!propietario) throw new Error('Corrección 32 (2551/S0292): sin propietario vigente');
          const punto = db.prepare(`SELECT id, saldo_pendiente FROM nuevos_puntos WHERE cuenta_id=? AND estado='Pendiente'`).get(cuentaId);
          if (!punto) throw new Error('Corrección 32 (2551/S0292): no hay un punto de conexión pendiente');
          if (punto.saldo_pendiente < 100000) {
            throw new Error(`Corrección 32 (2551/S0292): saldo pendiente ($${punto.saldo_pendiente}) menor al abono ($100.000)`);
          }

          const reciboId = pagoRepo.crearRecibo({
            numeroRecibo, cuentaId, propietarioId: propietario.propietario_id,
            fechaRecibo: '2026-07-25', total: 100000, metodoPago: 'Transferencia',
            observaciones: OBSERVACION_RECIBO_FALTANTE_2026
          });
          const detalleId = pagoRepo.crearReciboDetalle({
            reciboId, concepto: 'ABONO A PUNTO NUEVO (TRANSFERENCIA 18/07/2026)', valor: 100000,
            tipoConceptoContable: 'AbonoPuntoNuevo'
          });
          puntoRepo.crearAbono({
            nuevoPuntoId: punto.id, monto: 100000, fechaAbono: '2026-07-25',
            reciboDetalleId: detalleId, observaciones: OBSERVACION_RECIBO_FALTANTE_2026
          });
          const { saldoPendiente, estado } = puntoRepo.actualizarSaldoYEstado(punto.id);

          recibosFaltantes2026.push({
            numeroRecibo, codigo: 'S0292', yaAplicado: false, cuentaId, reciboId,
            monto: 100000, saldoPendienteConexion: saldoPendiente, estadoConexion: estado
          });
        }
      }

      // Caso especial 2563 (R0942): el paréntesis del propio recibo ("TENIA $4.000 A FAVOR")
      // coincide exacto con el crédito ya documentado en la corrección 14 -- $156.000 en
      // efectivo + $4.000 de ese crédito = $160.000, el valor exacto de marzo-diciembre 2026
      // (10 meses x $16.000).
      {
        const numeroRecibo = 2563;
        const yaExiste = db.prepare('SELECT id FROM recibos WHERE numero_recibo=?').get(numeroRecibo);
        if (yaExiste) {
          recibosFaltantes2026.push({ numeroRecibo, codigo: 'R0942', yaAplicado: true });
        } else {
          const cuentaId = idPorCodigo.get(normalizarCodigo('R0942'));
          const propietario = propietarioVigente(cuentaId);
          if (!propietario) throw new Error('Corrección 32 (2563/R0942): sin propietario vigente');

          service.asegurarCausacion(cuentaId, 2026, 12, { anio: 2026, mes: 3 });
          const periodos = mesesEntre({ anio: 2026, mes: 3 }, { anio: 2026, mes: 12 });
          const cargosPendientes = pendienteEnRango(cuentaId, periodos);
          if (cargosPendientes.length !== 10) {
            throw new Error(`Corrección 32 (2563/R0942): se esperaban 10 cargos pendientes (mar-dic 2026), se encontraron ${cargosPendientes.length}`);
          }
          const cargosElegidosIds = cargosPendientes.map(c => c.id);

          const reciboId = pagoRepo.crearRecibo({
            numeroRecibo, cuentaId, propietarioId: propietario.propietario_id,
            fechaRecibo: '2026-08-08', total: 156000, metodoPago: 'Efectivo',
            observaciones: OBSERVACION_RECIBO_FALTANTE_2026 + ' Incluye el uso del saldo a ' +
              'favor de $4.000 ya documentado en la corrección 14 -- el propio recibo lo anota ' +
              '("TENIA $4.000 A FAVOR").'
          });
          const detalleId = pagoRepo.crearReciboDetalle({
            reciboId, concepto: 'CUOTA DE SOSTENIMIENTO MARZO A DICIEMBRE 2026 (TENIA $4,000 A FAVOR)',
            periodoDesde: 'Marzo 2026', periodoHasta: 'Diciembre 2026', valor: 160000
          });

          const abonoEfectivo = service.registrarAbono({
            cuentaId, fecha: '2026-08-08', monto: 156000, modo: MODOS.MESES_ESPECIFICOS,
            cargosElegidos: cargosElegidosIds, reciboDetalleId: detalleId,
            observaciones: OBSERVACION_RECIBO_FALTANTE_2026
          });
          if (esMayor(abonoEfectivo.sobrante, 0)) {
            throw new Error(`Corrección 32 (2563/R0942): sobrante inesperado de efectivo: $${abonoEfectivo.sobrante}`);
          }

          const detalleCreditoId = pagoRepo.crearReciboDetalle({
            reciboId, concepto: 'Aplicación de saldo a favor', valor: -4000,
            tipoConceptoContable: 'AplicacionSaldoFavor'
          });
          const abonoCredito = service.aplicarCreditoAMeses({
            cuentaId, monto: 4000, cargosElegidos: cargosElegidosIds,
            fecha: '2026-08-08', reciboDetalleId: detalleCreditoId
          });
          if (esMayor(abonoCredito.sobrante, 0)) {
            throw new Error(`Corrección 32 (2563/R0942): sobrante inesperado de crédito: $${abonoCredito.sobrante}`);
          }
          const pendienteFinal = pendienteEnRango(cuentaId, periodos).reduce((s, c) => s + c.pendiente, 0);
          if (esMayor(pendienteFinal, 0)) {
            throw new Error(`Corrección 32 (2563/R0942): quedó pendiente de $${pendienteFinal} dentro del rango declarado`);
          }

          recibosFaltantes2026.push({
            numeroRecibo, codigo: 'R0942', yaAplicado: false, cuentaId, reciboId, monto: 156000
          });
        }
      }

      // 1167: hoja en blanco del talonario físico -- no representa ningún pago, se registra en
      // recibos_anulados_fisicos para no dejar un hueco sin explicación en la numeración.
      {
        const yaExiste = db.prepare('SELECT id FROM recibos_anulados_fisicos WHERE numero_recibo=?').get(1167);
        if (yaExiste) {
          recibo1167Blanco = { yaAplicado: true };
        } else {
          db.prepare(`INSERT INTO recibos_anulados_fisicos (numero_recibo, motivo) VALUES (?, ?)`)
            .run(1167, RECIBO_1167_BLANCO_MOTIVO);
          recibo1167Blanco = { yaAplicado: false };
        }
      }

      // 33. Ver comentario junto a RECIBOS_ANULADOS_FALTANTES más arriba.
      for (const item of RECIBOS_ANULADOS_FALTANTES) {
        const yaExiste = db.prepare('SELECT id FROM recibos_anulados_fisicos WHERE numero_recibo=?').get(item.numeroRecibo);
        if (yaExiste) {
          recibosAnuladosFaltantes.push({ numeroRecibo: item.numeroRecibo, yaAplicado: true });
          continue;
        }
        db.prepare(`INSERT INTO recibos_anulados_fisicos (numero_recibo, fecha, motivo) VALUES (?, ?, ?)`)
          .run(item.numeroRecibo, item.fecha, item.motivo);
        recibosAnuladosFaltantes.push({ numeroRecibo: item.numeroRecibo, yaAplicado: false });
      }

      // 34. Ver comentario junto a RESOLUCION_R031_R0301 más arriba.
      {
        const cuentaDestino = idPorCodigo.get(normalizarCodigo(RESOLUCION_R031_R0301.codigoDestino));
        if (cuentaDestino === undefined) {
          throw new Error(`${RESOLUCION_R031_R0301.codigoDestino}: no existe en la base -- ¿corrieron los pasos 1-2?`);
        }

        const cuentaOrigen = idPorCodigo.get(normalizarCodigo(RESOLUCION_R031_R0301.codigoOrigen));
        if (cuentaOrigen === undefined) {
          // R031 ya no existe -- esta corrección ya corrió.
          resolucionR031R0301 = { yaAplicado: true };
        } else {
          const { reciboId, detalleId } = getReciboDetalle(db, RESOLUCION_R031_R0301.numeroRecibo);
          const reciboActual = db.prepare('SELECT cuenta_id, observaciones FROM recibos WHERE id=?').get(reciboId);
          if (reciboActual.cuenta_id !== cuentaOrigen) {
            throw new Error(
              `Recibo ${RESOLUCION_R031_R0301.numeroRecibo}: se esperaba en cuenta_id=${cuentaOrigen} ` +
              `(${RESOLUCION_R031_R0301.codigoOrigen}), está en cuenta_id=${reciboActual.cuenta_id} -- revisar antes de mover a ciegas`
            );
          }

          const observacionesNuevas = (reciboActual.observaciones ? reciboActual.observaciones + ' | ' : '') + OBSERVACION_RESOLUCION_R031_R0301;
          db.prepare('UPDATE recibos SET cuenta_id=?, observaciones=? WHERE id=?')
            .run(cuentaDestino, observacionesNuevas, reciboId);

          service.asegurarCausacion(
            cuentaDestino, RESOLUCION_R031_R0301.periodoHasta.anio, RESOLUCION_R031_R0301.periodoHasta.mes,
            RESOLUCION_R031_R0301.periodoDesde
          );
          const pendientes = cargosPendientesEnRango(
            db, cuentaDestino, RESOLUCION_R031_R0301.periodoDesde, RESOLUCION_R031_R0301.periodoHasta
          );
          if (pendientes.length !== 6) {
            throw new Error(`Corrección 34: se esperaban 6 cargos pendientes (ene-jun 2024) en R0301, se encontraron ${pendientes.length}`);
          }

          const abono = service.registrarAbono({
            cuentaId: cuentaDestino, fecha: '2024-05-04', monto: RESOLUCION_R031_R0301.monto,
            modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: pendientes.map(c => c.id),
            reciboDetalleId: detalleId, observaciones: OBSERVACION_RESOLUCION_R031_R0301
          });
          if (esMayor(abono.sobrante, 0)) {
            throw new Error(`Corrección 34: quedó sobrante sin imputar de $${abono.sobrante}`);
          }
          const pendienteFinal = cargosPendientesEnRango(
            db, cuentaDestino, RESOLUCION_R031_R0301.periodoDesde, RESOLUCION_R031_R0301.periodoHasta
          ).reduce((s, c) => s + c.pendiente, 0);
          if (esMayor(pendienteFinal, 0)) {
            throw new Error(`Corrección 34: quedó pendiente de $${pendienteFinal} en el rango declarado`);
          }

          // Limpieza de la huella de la cuenta fantasma: se descarta lo que R0301 ya tiene por su
          // cuenta (categoría, estado, propietario), y lo que el retrofit del modelo nuevo había
          // dejado sin aplicar (el abono en $0 y el crédito de $60.000 sin imputar de R031) -- ya
          // no hace falta, la imputación real de arriba lo reemplaza. pago_periodos SÍ se mueve:
          // es historial real que R0301 todavía no tiene para esos 6 meses (no un duplicado).
          db.prepare('DELETE FROM cartera_movimientos WHERE cuenta_id=?').run(cuentaOrigen);
          db.prepare('DELETE FROM cuenta_creditos WHERE cuenta_id=?').run(cuentaOrigen);
          db.prepare('UPDATE pago_periodos SET cuenta_id=? WHERE cuenta_id=?').run(cuentaDestino, cuentaOrigen);
          db.prepare('DELETE FROM cuenta_propietarios WHERE cuenta_id=?').run(cuentaOrigen);
          db.prepare('DELETE FROM cuenta_estados WHERE cuenta_id=?').run(cuentaOrigen);
          db.prepare('DELETE FROM cuenta_categorias WHERE cuenta_id=?').run(cuentaOrigen);
          db.prepare('DELETE FROM cuentas WHERE id=?').run(cuentaOrigen);

          resolucionR031R0301 = {
            yaAplicado: false, reciboMovido: reciboId, cuentaOrigenEliminada: cuentaOrigen,
            montoImputado: RESOLUCION_R031_R0301.monto
          };
        }
      }

      // 35. Acorta observaciones/motivos que quedaron escritos en producción con el texto viejo
      // (verboso, con referencia al proceso interno de reconciliación: ronda, archivo .md) de las
      // correcciones 28, 30 y 32. Esa trazabilidad ya queda documentada en este script y en
      // cruce-colillas-vs-db.md -- no le aporta nada a quien consulta el dato desde la pantalla
      // de Recibos, de Cuentas, o el detalle de movimientos/puntos de conexión (recibos,
      // cartera_movimientos, cuentas, cuenta_estados, nuevos_puntos, nuevo_punto_abonos).
      // Busca por el texto viejo como substring (no por id fijo) para
      // cubrir también los 3 casos especiales de la corrección 32 (2549/2551/2563) que le
      // agregaron texto propio después del texto compartido: split/join conserva ese agregado,
      // solo reemplaza el prefijo. Idempotente por construcción -- una fila ya acortada ya no
      // contiene el texto viejo, así que una segunda corrida no encuentra nada que tocar.
      for (const { textoViejo, textoNuevo, tabla, columna } of [
        { textoViejo: OBSERVACION_RECIBO_FALTANTE_2026_ORIGINAL, textoNuevo: OBSERVACION_RECIBO_FALTANTE_2026, tabla: 'recibos', columna: 'observaciones' },
        { textoViejo: OBSERVACION_RECIBO_FALTANTE_2026_ORIGINAL, textoNuevo: OBSERVACION_RECIBO_FALTANTE_2026, tabla: 'cartera_movimientos', columna: 'observaciones' },
        { textoViejo: OBSERVACION_RECIBO_FALTANTE_2026_ORIGINAL, textoNuevo: OBSERVACION_RECIBO_FALTANTE_2026, tabla: 'nuevo_punto_abonos', columna: 'observaciones' },
        { textoViejo: OBSERVACION_RECIBO_S0244_ORIGINAL, textoNuevo: OBSERVACION_RECIBO_S0244, tabla: 'recibos', columna: 'observaciones' },
        { textoViejo: OBSERVACION_CUENTA_NUEVA_2026_ORIGINAL, textoNuevo: OBSERVACION_CUENTA_NUEVA_2026, tabla: 'cuentas', columna: 'observaciones' },
        { textoViejo: OBSERVACION_CUENTA_NUEVA_2026_ORIGINAL, textoNuevo: OBSERVACION_CUENTA_NUEVA_2026, tabla: 'cuenta_estados', columna: 'motivo' },
        { textoViejo: OBSERVACION_CUENTA_NUEVA_2026_ORIGINAL, textoNuevo: OBSERVACION_CUENTA_NUEVA_2026, tabla: 'recibos', columna: 'observaciones' },
        { textoViejo: OBSERVACION_CUENTA_NUEVA_2026_ORIGINAL, textoNuevo: OBSERVACION_CUENTA_NUEVA_2026, tabla: 'nuevos_puntos', columna: 'observaciones' },
        { textoViejo: OBSERVACION_CUENTA_NUEVA_2026_ORIGINAL, textoNuevo: OBSERVACION_CUENTA_NUEVA_2026, tabla: 'nuevo_punto_abonos', columna: 'observaciones' }
      ]) {
        const filas = db.prepare(
          `SELECT id, ${columna} AS valor FROM ${tabla} WHERE ${columna} LIKE '%' || ? || '%'`
        ).all(textoViejo);
        for (const fila of filas) {
          db.prepare(`UPDATE ${tabla} SET ${columna} = ? WHERE id = ?`)
            .run(fila.valor.split(textoViejo).join(textoNuevo), fila.id);
          observacionesAcortadas.push({ tabla, id: fila.id });
        }
      }

      // Después de insertar los recibos históricos (hasta el 2564), el consecutivo debe quedar
      // apuntando al primer número realmente libre -- si no, el próximo pago registrado desde la
      // app chocaría con un UNIQUE constraint al intentar reusar un número que esta corrección ya
      // ocupó.
      {
        const MAX_NUMERO_RECIBO_CORRECCION_32 = 2565;
        const actual = parseInt(db.prepare("SELECT valor FROM configuracion WHERE clave='consecutivo_recibos'").get().valor, 10);
        if (actual < MAX_NUMERO_RECIBO_CORRECCION_32) {
          db.prepare("UPDATE configuracion SET valor=?, fecha_actualizacion=CURRENT_TIMESTAMP WHERE clave='consecutivo_recibos'")
            .run(String(MAX_NUMERO_RECIBO_CORRECCION_32));
        }
      }
    }

  });
  transaccion();

  return {
    s03311Creados, tarifaCorregida, propietarioS0244,
    reasignacion2137, correccion2384, reimputacion2384, recalculoS010,
    correccionAperturaS044, correccionPeriodo2229, reimputacion2229,
    suspensionesSinCartera, inactivaS063, redencionR007, redencionR007Adelantado,
    redencionesReajuste2024, redencionS023, redencionesHuecoTextual2026,
    limpiezaSuspendidas, creditoR0942, recalculoR0831, pagosAdelantados, pendientesManuales,
    mergeR0081S058, reimputacionS0312,
    redencionR049, reasignacion458, suspensionIncobrables, reciboFaltanteS0244,
    aperturaIncobrables, cuentasNuevas2026, periodosTextoCorregidos,
    recibosFaltantes2026, recibo1167Blanco, recibosAnuladosFaltantes, resolucionR031R0301,
    observacionesAcortadas
  };
}

module.exports = {
  ejecutarPaso9b, CUENTAS_TARIFA_CORREGIDA, OBSERVACION_S03311, OBSERVACION_TARIFA, PROPIETARIO_S0244,
  REASIGNACION_RECIBO_2137, CORRECCION_PERIODO_RECIBO_2384, RECALCULO_S010,
  CORRECCION_APERTURA_S044, CORRECCION_PERIODO_RECIBO_2229, OBSERVACION_APERTURA_S044, reimputarAbono,
  SUSPENSIONES_SIN_CARTERA, OBSERVACION_SUSPENSION_SIN_CARTERA,
  INACTIVA_FUSIONADA_S063, OBSERVACION_INACTIVA_S063, REDENCION_R007, OBSERVACION_REDENCION_R007,
  REDENCION_R007_2026, OBSERVACION_REDENCION_R007_2026, REDENCIONES_REAJUSTE_2024,
  REDENCION_S023, OBSERVACION_REDENCION_S023, REDENCIONES_HUECO_TEXTUAL_2026,
  CUENTAS_SUSPENDIDAS_SIN_RECAUSAR, FRAGMENTO_AJUSTE_ERRONEO_SUSPENDIDAS,
  CREDITO_R0942, OBSERVACION_CREDITO_R0942, RECALCULO_R0831, OBSERVACION_RECALCULO_R0831,
  EXCLUSIONES_PAGO_ADELANTADO, OBSERVACION_PAGO_ADELANTADO, candidatosPagoAdelantado,
  parsearPeriodoAnioMes, periodoAIso,
  MERGE_R0081_S058, OBSERVACION_MERGE_R0081_S058, REIMPUTACION_S0312,
  OBSERVACION_REIMPUTACION_S0312_2191, OBSERVACION_REIMPUTACION_S0312_2362,
  REDENCION_R049, OBSERVACION_REDENCION_R049, REASIGNACION_RECIBO_458, OBSERVACION_REASIGNACION_458,
  SUSPENSION_INCOBRABLES, OBSERVACION_SUSPENSION_INCOBRABLES, RECIBO_FALTANTE_S0244, OBSERVACION_RECIBO_S0244,
  OBSERVACION_RECIBO_S0244_ORIGINAL, OBSERVACION_RECIBO_FALTANTE_2026_ORIGINAL,
  APERTURA_INCOBRABLES, OBSERVACION_APERTURA_INCOBRABLES,
  CUENTAS_NUEVAS_2026, OBSERVACION_CUENTA_NUEVA_2026, OBSERVACION_CUENTA_NUEVA_2026_ORIGINAL,
  VALOR_PUNTO_NUEVO_2026, FECHA_CUENTAS_NUEVAS_2026,
  inferirPeriodoDeTexto, derivarPeriodoCorrecto, formatearPeriodoTexto, SOBRESCRITURA_PERIODO_MANUAL,
  RECIBOS_FALTANTES_2026, OBSERVACION_RECIBO_FALTANTE_2026, RECIBO_1167_BLANCO_MOTIVO,
  RECIBOS_ANULADOS_FALTANTES, RESOLUCION_R031_R0301, OBSERVACION_RESOLUCION_R031_R0301
};
