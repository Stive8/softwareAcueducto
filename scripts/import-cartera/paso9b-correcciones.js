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
// involucrados y los recalcula desde cero, así que repetir la corrida no duplica nada.
const { normalizarCodigo } = require('./normalizar');
const { primerDiaDelMes } = require('../../src/services/cartera/periodos');
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

const OBSERVACION_CAUSACION_S058 =
  'Causacion iniciada en febrero 2026 (mes siguiente a la instalacion del punto de conexion, ' +
  'pagado el 31-ene-2026 por $500.000) -- regla de negocio: el sostenimiento arranca el mes ' +
  'siguiente a la conexion, no el mismo mes.';

const CAUSACION_S058 = {
  codigoCuenta: 'S058',
  categoriaNombre: 'Finca',
  anio: 2026,
  mesInicio: 2,
  mesFin: 7,
  monto: 10000
};

const OBSERVACION_SUSPENSION_SIN_CARTERA =
  'No localizada en el barrido de campo; sin fila en CARTERA. Suspendida en la carga inicial.';

// Fecha de suspensión = mes siguiente al último recibo real de cada cuenta (ver comentario de
// la corrección 11 arriba para el porqué).
const SUSPENSIONES_SIN_CARTERA = [
  { codigoCuenta: 'O40-1', fechaInicio: '2018-01-01' },
  { codigoCuenta: 'R0103', fechaInicio: '2020-01-01' },
  { codigoCuenta: 'R031', fechaInicio: '2024-06-01' },
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

const FRAGMENTO_AJUSTE_ERRONEO_SUSPENDIDAS = 'Corrección: meses desde 2024-01 causados a $5.000';
const CUENTAS_SUSPENDIDAS_SIN_RECAUSAR = ['R002', 'R0501', 'R0971', 'S004', 'S009', 'S0141', 'S0441'];

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
function reimputarAbono(db, repo, { abonoId, cuentaId, monto, periodoDesde, periodoHasta, forzarFifoSinPeriodo = false }) {
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

  if (esMayor(restante, 0) && (meses.length > 0 || forzarFifoSinPeriodo)) {
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
  const db = dbService.getDb();
  const repo = new CarteraRepository(dbService);

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
  let correccionS058 = null;
  const suspensionesSinCartera = [];
  let inactivaS063 = null;
  let redencionR007 = null;
  const limpiezaSuspendidas = [];
  let creditoR0942 = null;
  let recalculoR0831 = null;

  const transaccion = db.transaction(() => {
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

    // 10. S058: causar sostenimiento desde febrero 2026 (mes siguiente a la conexión) y
    // corregir la categoría de "Sin clasificar" a Finca.
    const cuentaS058 = idPorCodigo.get(normalizarCodigo(CAUSACION_S058.codigoCuenta));
    if (cuentaS058 === undefined) throw new Error('S058: no existe en la base -- ¿corrieron los pasos 1-2?');

    const categoriaFinca = db.prepare('SELECT id FROM categorias WHERE nombre=?').get(CAUSACION_S058.categoriaNombre);
    if (!categoriaFinca) throw new Error(`Categoría "${CAUSACION_S058.categoriaNombre}" no existe en la base`);

    const catActualS058 = db.prepare(
      'SELECT id, categoria_id FROM cuenta_categorias WHERE cuenta_id=? AND fecha_fin IS NULL'
    ).get(cuentaS058);
    if (!catActualS058) throw new Error('S058: no tiene categoría activa en cuenta_categorias -- ¿corrió el paso de categorías?');

    let categoriaS058Corregida;
    if (catActualS058.categoria_id === categoriaFinca.id) {
      categoriaS058Corregida = false;
    } else {
      db.prepare('UPDATE cuenta_categorias SET categoria_id=? WHERE id=?').run(categoriaFinca.id, catActualS058.id);
      categoriaS058Corregida = true;
    }

    let borradosS058 = 0;
    for (let mes = CAUSACION_S058.mesInicio; mes <= CAUSACION_S058.mesFin; mes++) {
      borradosS058 += db.prepare(
        "DELETE FROM cartera_movimientos WHERE cuenta_id=? AND tipo='CargoMensual' AND anio=? AND mes=?"
      ).run(cuentaS058, CAUSACION_S058.anio, mes).changes;
    }
    const causacionS058 = [];
    for (let mes = CAUSACION_S058.mesInicio; mes <= CAUSACION_S058.mesFin; mes++) {
      const movId = repo.crearMovimiento({
        cuentaId: cuentaS058, fecha: primerDiaDelMes(CAUSACION_S058.anio, mes),
        tipo: 'CargoMensual', exigible: 1, monto: CAUSACION_S058.monto,
        anio: CAUSACION_S058.anio, mes, observaciones: OBSERVACION_CAUSACION_S058
      });
      causacionS058.push({ mes, movId });
    }
    correccionS058 = { categoriaCorregida: categoriaS058Corregida, borrados: borradosS058, creados: causacionS058.length };

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
  });
  transaccion();

  return {
    s03311Creados, tarifaCorregida, propietarioS0244,
    reasignacion2137, correccion2384, reimputacion2384, recalculoS010,
    correccionAperturaS044, correccionPeriodo2229, reimputacion2229,
    correccionS058, suspensionesSinCartera, inactivaS063, redencionR007,
    limpiezaSuspendidas, creditoR0942, recalculoR0831
  };
}

module.exports = {
  ejecutarPaso9b, CUENTAS_TARIFA_CORREGIDA, OBSERVACION_S03311, OBSERVACION_TARIFA, PROPIETARIO_S0244,
  REASIGNACION_RECIBO_2137, CORRECCION_PERIODO_RECIBO_2384, RECALCULO_S010,
  CORRECCION_APERTURA_S044, CORRECCION_PERIODO_RECIBO_2229, OBSERVACION_APERTURA_S044, reimputarAbono,
  CAUSACION_S058, OBSERVACION_CAUSACION_S058, SUSPENSIONES_SIN_CARTERA, OBSERVACION_SUSPENSION_SIN_CARTERA,
  INACTIVA_FUSIONADA_S063, OBSERVACION_INACTIVA_S063, REDENCION_R007, OBSERVACION_REDENCION_R007,
  CUENTAS_SUSPENDIDAS_SIN_RECAUSAR, FRAGMENTO_AJUSTE_ERRONEO_SUSPENDIDAS,
  CREDITO_R0942, OBSERVACION_CREDITO_R0942, RECALCULO_R0831, OBSERVACION_RECALCULO_R0831
};
