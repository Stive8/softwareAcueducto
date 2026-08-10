# "Próximo período sugerido": desacoplarlo de `pago_periodos` sin confundirlo con "a pagar"

## Contexto

Antes de importar a producción, ninguna de las 318 cuentas puede quedar en un estado donde
`registrarPagoSostenimiento` rechace un pago por defecto. Hoy eso pasa para 58 cuentas: el
"próximo período sugerido" de `PagoService.getEstadoCuenta` se calcula desde `pago_periodos`
(`PagoRepository.getUltimoPeriodoPagado`), que quedó atrás de `cartera_movimientos` para
cuentas cuyos recibos se causaron directo en cartera durante la carga inicial (caso real:
R001). El guardián de la doble escritura rechaza correctamente el pago cuando eso pasa — el
problema no es el guardián, es que la sugerencia que lo dispara ya está mal antes de que el
operador toque nada.

Un primer intento de arreglarlo reemplazó la fuente por `cubiertoHasta`
(`CarteraService.getEstadoCartera`) y se verificó, antes de aceptarlo, contra las 318 cuentas
reales (`scripts/decommission-modelo-viejo/comparar-siguiente-periodo.js`, que queda en el
repo como herramienta reutilizable — ver ese archivo). El resultado: 149 sin cambio, 57
correctamente arregladas, pero **112 retrocedieron**, alguna hasta 98 meses. La verificación
hizo su trabajo — atrapó un intento de fix que era peor que el problema que resolvía, antes de
que tocara producción.

## El problema de fondo: "a pagar" y "próximo período" son preguntas distintas

`cubiertoHasta` responde correctamente "¿cuánto debe en total?": camina mes a mes desde el
primer `CargoMensual` causado y se detiene en el primer hueco, porque ese hueco es deuda real
que hay que cobrar. Es exactamente lo que necesita `calcularAPagar` y el aviso de "deuda
anterior al corte".

Pero "¿qué mes le sugiero pagar ahora?" es una pregunta distinta, y compartir la misma función
para las dos fue el error del primer intento. Caso real, cuenta S050: tiene un `CargoMensual`
sin cubrir en 2024-1 y otro en 2024-3, y **todo lo demás pagado sin huecos hasta julio 2026**.
`cubiertoHasta` da `null` (el primer cargo ya está sin cubrir), así que "próximo período
sugerido" caía al *fallback* — y ahí apareció un segundo bug, propio de este intento: el
fallback llamaba a `PagoRepository.getFechaInicioFacturacion` (la función vieja, que lee
`cuenta_categorias` y no tiene relación con causación) en vez de
`CarteraService.getFechaInicioFacturacion` (la cadena de 4 niveles ya validada en la Fase 1).
Para S050 eso dio 2018 en vez de 2024. Los otros ~90 casos que retrocedieron por 1-25 meses
son cuentas con huecos reales más chicos, más recientes, que `cubiertoHasta` respeta
correctamente para "a pagar" pero que no deberían frenar la sugerencia de pago.

## Decisión: dos conceptos, dos nombres, un solo dato de origen

**`cubiertoHasta`** (sin cambios): sigue siendo la deuda real, incluidos los huecos
históricos. Sigue alimentando `calcularAPagar` y el aviso "deuda anterior al corte" tal como
hoy. Esta fase no lo toca.

**`alDiaHasta`** (nuevo, nombre deliberadamente distinto): el mes más reciente que está
cubierto por completo, sin importar si hay huecos *antes* de él. Se calcula con una función
nueva en `src/services/cartera/imputacion.js`, hermana de `calcularCubiertoHasta` pero sin el
`break` en el primer hueco — recorre todos los cargos con mes y se queda con el último
cubierto, punto:

```js
// "Al día hasta" X = el mes más reciente ya cubierto por completo. A diferencia de
// calcularCubiertoHasta, NO se detiene en el primer hueco: un hueco viejo sigue siendo deuda
// real (eso lo captura cubiertoHasta/calcularAPagar/deudaExigible, sin cambios acá), pero no
// debe congelar "qué mes le sugiero pagar ahora" en un punto del pasado ya superado.
function calcularAlDiaHasta(cargosConCobertura) {
  let ultimo = null;
  for (const cargo of cargosConCobertura) {
    if (cargo.anio === null || cargo.mes === null) continue;
    const falta = redondear(cargo.monto) - redondear(cargo.cubierto);
    if (!esMayor(falta, 0)) ultimo = { anio: cargo.anio, mes: cargo.mes };
  }
  return ultimo;
}
```

Depende de que `getCargosConCobertura` venga ordenado ascendente por `anio, mes` (ya lo está,
`CarteraRepository.js:134`): recorre todo sin cortar y el último asignado a `ultimo` es,
necesariamente, el más reciente cubierto.

Se exporta junto a `calcularCubiertoHasta` en el mismo módulo.

## Dónde vive el cálculo del "próximo período"

Nuevo método en `CarteraService`, `getProximoPeriodoSugerido(cuentaId)`:

```js
// "Próximo período sugerido": el mes siguiente al último cubierto (alDiaHasta), IGNORANDO
// huecos históricos -- esos siguen contando como deuda en getEstadoCartera, no acá. Puede
// devolver un mes que todavía no tiene CargoMensual causado (ej. una cuenta al día hasta julio
// que hoy es agosto): es intencional, asegurarCausacion lo crea al registrar el pago.
getProximoPeriodoSugerido(cuentaId) {
  const alDiaHasta = calcularAlDiaHasta(this.repository.getCargosConCobertura(cuentaId, 1));

  if (alDiaHasta) {
    const cod = codificarPeriodo(alDiaHasta.anio, alDiaHasta.mes) + 1;
    return { alDiaHasta, siguiente: decodificarPeriodo(cod) };
  }

  const ancla = this.getFechaInicioFacturacion(cuentaId);
  if (!ancla) return { alDiaHasta: null, siguiente: null };
  return { alDiaHasta: null, siguiente: anioMesDeFecha(ancla) };
}
```

El *fallback* (cuando no hay ningún mes cubierto) usa `this.getFechaInicioFacturacion` — el
método de `CarteraService`, la cadena de 4 niveles validada en la Fase 1 (`CargoMensual` →
`pago_periodos` congelada → recibo → `fecha_creacion`) — **no** `PagoRepository`. Ese fue
exactamente el bug de S050 en el primer intento.

`PagoService.getEstadoCuenta` pasa a llamar `this.carteraService.getProximoPeriodoSugerido(cuentaId)`
en vez de `this.repository.getUltimoPeriodoPagado`: `pagadoHasta` se llena con `alDiaHasta` y
`siguientePeriodo` con `siguiente`, sin más cambios en el resto de la función (`mesesMora`,
`saldoPendienteEstimado`, etc. ya dependen de `siguiente`, no de `pago_periodos` directamente).

## Los ~20 casos que convergen en el mes actual: verificado, no hace falta caso especial

Se investigaron 4 cuentas del grupo (R103, S011, S014, S017): todas tienen un recibo real de
pago anticipado (ej. R103: recibo 2395, "OCTUBRE A DICIEMBRE 2026") cuyos meses **no están
causados todavía** en `cartera_movimientos` — la causación no llegó tan lejos en el futuro
durante la carga inicial. Las cuatro tienen, además, una fila en `cuenta_creditos` con la
observación `"Sobrante de imputación: crédito no aplicado (retrofit 2026-08-04)"`, por el
monto que no se pudo imputar contra cargos que todavía no existían.

Es decir: el mecanismo de "sobrante → saldo a favor" (el mismo que ya usa S010) ya capturó
correctamente ese pago anticipado como crédito disponible, no como dato perdido. Con
`alDiaHasta` estas cuentas van a sugerir el mes siguiente al último `CargoMensual` real y
cubierto (ej. agosto 2026 para R103) — un mes que `asegurarCausacion` va a crear al registrar
ese pago — y el operador va a ver, al mismo tiempo, el aviso de saldo a favor con el monto
exacto del pago anticipado, con la casilla ya construida para aplicarlo si corresponde. **No
hace falta ningún caso especial**: el diseño ya construido para saldo a favor resuelve esto
sin cambios adicionales.

## Fuera de alcance

- `cubiertoHasta`, `calcularAPagar`, `deudaExigible` y el aviso de "deuda anterior al corte":
  sin cambios, siguen viendo los huecos históricos como corresponde.
- Cualquier reescritura de reportes/dashboard (eso es la Fase 2 del decommission general).
- `totalPagado`/`totalMesesPagados` de `getEstadoCuenta` (vienen de `getResumenPagos`, no de
  `getUltimoPeriodoPagado`): no forman parte de este fix.

## Testing

- Tests nuevos para `calcularAlDiaHasta` en `src/services/cartera/imputacion.test.js` (si no
  existe, crearlo): caso con huecos intermedios da el último cubierto, no el primer hueco;
  caso sin ningún mes cubierto da `null`; caso normal (todo contiguo) da lo mismo que
  `calcularCubiertoHasta` daría.
- Tests para `CarteraService.getProximoPeriodoSugerido`: reproducir el caso real de S050
  (huecos en 2024-1/2024-3, cubierto hasta 2026-7) y confirmar que sugiere 2026-8, no un
  fallback de 2018; reproducir el caso de R103 (nada causado más allá del mes actual, con
  saldo a favor del pago anticipado) y confirmar que sugiere el mes siguiente al último
  `CargoMensual` real, no lanza ni inventa un mes ya causado.
- Test de regresión directo para el bug del fallback: una cuenta sin ningún `CargoMensual`
  causado debe usar `CarteraService.getFechaInicioFacturacion`, nunca
  `PagoRepository.getFechaInicioFacturacion` — mismo tipo de aserción que ya prueba esa cadena
  en `CarteraService.causacion.test.js`.
- Antes de aceptar el fix: correr de nuevo
  `scripts/decommission-modelo-viejo/comparar-siguiente-periodo.js` contra las 318 cuentas
  reales. Esperado esta vez: 149 sin cambio + exactamente 57-58 avanzaron (las que tenían el
  desfase real tipo R001) + **0 retrocedieron**. Cualquier cuenta que retroceda es señal de que
  el fix todavía no está bien y no se acepta.
