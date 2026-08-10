# Fase 2 del decommission — reportes y dashboard dejan de leer `pago_periodos`

## Contexto

Hoy el dashboard general y varios reportes contables calculan "meses de mora"/"cuentas en
mora"/"cartera por edades" con SQL crudo contra `pago_periodos` (el ledger del modelo viejo).
Esas cifras están mal en dos direcciones distintas, ambas ya evidenciadas con datos reales esta
sesión:

- **Infladas** para las cuentas con `pago_periodos` desfasado hacia atrás (el patrón de R001:
  un recibo se causó directo en cartera durante la carga inicial y nunca generó su fila en
  `pago_periodos`). Para esas cuentas, `pago_periodos` cree que el último pago fue antes de lo
  real, así que cuenta de más meses de mora.
- **Subestimadas** para cuentas con un hueco real en medio de su historial que sí está en
  `pago_periodos` pero que un `MAX()` ignora (el patrón de S044/S0393/R007, las cuentas que
  "cobraban de más" porque el sistema viejo asumía al día cuando no lo estaba).

Ambos patrones tienen la misma raíz: **`MAX(periodo pagado)` no es lo mismo que "cuánto debe
realmente"**. Cartera ya resuelve esto con `cubiertoHasta` (`CarteraService.getEstadoCartera` /
`calcularCubiertoHasta`): se detiene en el primer hueco sin cubrir, así que un hueco viejo
nunca desaparece detrás de pagos más recientes.

**Importante, para no repetir el error de la Fase del próximo período sugerido:** esta fase usa
`cubiertoHasta`, **no** `alDiaHasta` (la función nueva que ignora huecos, construida para
"próximo período sugerido"). Son opuestos a propósito. `alDiaHasta` existe para no congelar la
sugerencia de un pago nuevo en un hueco ya superado; usarla acá escondería exactamente la
deuda que estos reportes existen para mostrar. Ver
`docs/superpowers/specs/2026-08-09-proximo-periodo-sugerido-design.md` para la distinción
completa.

## Las 5 consultas exactas

### 1. `ReporteRepository.getCuentasConUltimoPeriodo()` — `src/repositories/ReporteRepository.js:112-124`

```sql
(SELECT MAX(anio * 12 + (mes - 1)) FROM pago_periodos WHERE cuenta_id = c.id) as ultimo_periodo_num
```

La envuelve `ReporteService.procesarEstadoCuentas()` (`ReporteService.js:195-216`), que calcula
`pagado_hasta` y `meses_mora` a partir de ese `MAX`. Alimenta **tres reportes**:
- "Cuentas al Día" (`reporteCuentasAlDia`, filtra `meses_mora === 0`)
- "Cuentas en Mora" (`reporteCuentasEnMora`, filtra `meses_mora > 0`)
- "Informe de Empalme" (`reporteInformeEmpalme`, cuenta al-día/en-mora para el resumen de
  entrega de cargo)

### 2. `ReporteRepository.getCartedaPorEdades()` — `src/repositories/ReporteRepository.js:190-252`

Mismo `MAX(anio*12+(mes-1)) FROM pago_periodos` (línea 197), usado para calcular `meses_mora`
por cuenta y clasificarla en un rango de antigüedad (1-3, 4-6, 7-12, +12 meses), valorado a la
tarifa vigente hoy. Alimenta el reporte **"Cartera por Edades (Aging)"**
(`ReporteService.reporteCarteraPorEdades`).

### 3. `ReporteRepository.getDashboardContable()` — `src/repositories/ReporteRepository.js:255-308`

El campo `cuentasMora` (líneas 285-291) cuenta cuentas activas cuyo `MAX(pago_periodos)` es
anterior al mes actual. El resto del método (ingresos, gastos, saldos) no toca `pago_periodos`
y no se toca en esta fase. Alimenta el **dashboard del módulo de Contabilidad**
(`ReporteService.getDashboardContable`).

### 4. `ReporteRepository.getCuentasPorCobrarEstimado()` — `src/repositories/ReporteRepository.js:315-350`

Sin filtrar por mora: recorre TODAS las cuentas activas, calcula `meses_mora` con el mismo
`MAX(pago_periodos)` (línea 321) y lo multiplica por la tarifa vigente hoy, sumando un solo
total. Alimenta la línea **"Cuentas por cobrar"** del **Balance General**
(`ReporteService.js:359`, dentro del reporte de balance).

### 5. `DashboardRepository.getCuentasAlDia()` / `getCuentasEnMoraIds()` — `src/repositories/DashboardRepository.js:37-50, 59-72`

Dos métodos, mismo criterio: `MAX(anio*12+(mes-1)) FROM pago_periodos` comparado contra el
período actual. Alimenta el **dashboard general** (pantalla de inicio) vía
`DashboardService.getStats()`: los contadores "cuentas al día" / "cuentas en mora", y también
`carteraPendiente` (línea 30-33), que sí hace algo más: por cada cuenta en mora, suma
`PagoService.getEstadoCuenta(cuentaId).saldoPendienteEstimado`.

**Hallazgo al escribir este spec, no cubierto por la fase anterior:** desde el fix de
"próximo período sugerido" (2026-08-09), `PagoService.getEstadoCuenta()` calcula
`mesesMora`/`saldoPendienteEstimado` a partir de `alDiaHasta` -- correcto para esa función
(sugerir el próximo período a pagar), pero **`carteraPendiente` del dashboard general reutiliza
ese mismo campo para una pregunta distinta** ("cuánto debe en total"), heredando sin querer la
misma ceguera a huecos viejos que este spec existe para eliminar. Antes del fix del 09-08 este
campo tenía el problema contrario (inflado por el desfase de `pago_periodos`); ahora tiene el
problema de S050 (subestimado si hay un hueco viejo ya superado). Se corrige en esta fase junto
con el resto: `carteraPendiente` deja de llamar a `PagoService.getEstadoCuenta` y se calcula
directo desde `CarteraService` -- la misma reutilización indebida que ya documenta el
comentario de `DashboardService.js:13-16`, solo que apuntando a la función equivocada.

## Decisión: la deuda anterior a 2024 SÍ cuenta como deuda real, en las 5

**Corrección sobre una primera versión de este spec:** se había propuesto que "cuentas por
cobrar" (consulta 4) mantuviera "el mismo alcance de hoy" excluyendo `deudaAntes2024`, con el
argumento de que el cálculo viejo tampoco la incluía. Eso es incorrecto: el cálculo viejo no
excluía la deuda anterior a 2024 *a propósito* -- simplemente no distinguía entre antes y
después de 2024, porque esa distinción es una invención del modelo nuevo. Contaba meses de
mora desde el último período pagado sin importar el año. "Mantener el mismo alcance" con
`deudaExigible` solo no preserva ese comportamiento: lo reduce.

Contablemente, "cuentas por cobrar" es lo que la asociación tiene derecho a cobrar. La apertura
opaca (~26 millones agregados) es deuda real de los asociados, aunque no se pueda sustentar mes
a mes. Excluirla subestima el activo del balance en esa cifra.

**Decisión, aplicada de forma consistente a las 5 consultas:** toda cifra de "cuánto debe" o
"está en mora" incluye `deudaAntes2024` además de `deudaExigible`. El mismo criterio de las
consultas 4 y 5 se extiende a las demás:

- **Balance General (consulta 4):** `cuentas_por_cobrar = deudaAntes2024 + deudaExigible`
  (sumado sobre todas las cuentas activas, solo la parte positiva de `deudaExigible`) **más
  `deudaPuntoConexion`** (ver la sección del punto de conexión más abajo). Se desglosa en
  líneas separadas ("Deuda anterior al corte" / "Deuda desde 2024" / "Deuda de conexión")
  además del total, para que se vea qué parte es cada cosa.

- **`carteraPendiente` del dashboard general (consulta 5):** mismo total,
  `deudaAntes2024 + deudaExigible + deudaPuntoConexion`, sumado sobre las cuentas con alguna de
  las tres en positivo -- no solo sobre las que tienen `deudaExigible > 0` como hoy.

- **Cartera por Edades (consulta 2):** `deudaAntes2024`, cuando existe, entra al reporte como
  parte del rango **"Más de 12 meses"** -- es, por definición, anterior a 2024, así que nunca es
  más reciente que 12 meses. Si una cuenta tiene `deudaAntes2024 > 0` pero está al día en sus
  meses 2024+ (`meses_mora` 2024+ = 0), **igual entra al reporte** en el rango "+12 meses"
  -- hoy esas cuentas no aparecen porque el reporte se salta a quien tiene `meses_mora === 0`.
  `valor_estimado` pasa a ser `deudaAntes2024 + (meses_mora_2024+ × tarifa_actual)`. `meses_mora`
  se conserva como el conteo 2024+ (información real, en meses, que sigue siendo útil mostrar);
  no se inventa un conteo en meses para la apertura opaca, que nunca estuvo expresada en meses.

- **Cuentas en Mora / Cuentas al Día / Informe de Empalme (consulta 1) y `cuentasMora` del
  dashboard contable (consulta 3):** una cuenta cuenta como **en mora** si
  `deudaExigible (2024+) > 0` **o** `deudaAntes2024 > 0` -- aunque esté al día en sus meses
  corrientes. Efecto esperado: algunas cuentas que hoy aparecen en "Cuentas al Día" van a pasar
  a "Cuentas en Mora" únicamente por la apertura opaca. No rompe nada funcionalmente (ningún
  código dispara una acción automática por estar "en mora" -- son reportes de solo lectura),
  pero sí puede verse contradictorio en pantalla: una cuenta puede mostrar "pagado hasta: julio
  2026" y aun así salir listada en "Cuentas en Mora", por la deuda vieja. Se agrega un campo
  `motivo_mora` (valores: `'meses_corrientes'`, `'deuda_anterior_2024'`, o ambos) a la fila de
  "Cuentas en Mora" para que no quede como una contradicción sin explicar en pantalla.

## Decisión: el punto de conexión pendiente (17 cuentas, $3.334.000)

Hoy `deudaPuntoConexion` (`nuevos_puntos.saldo_pendiente`, estado `'Pendiente'`) no entra en
ninguna de las 5 consultas -- no aparece en ningún reporte ni en el dashboard. Es dinero real
pendiente de cobro, pero de otra naturaleza que la cuota de sostenimiento (un cargo único por
la conexión física, no una cuota mensual recurrente). Criterio, por consulta:

- **Balance General (consulta 4):** SÍ entra en "cuentas por cobrar" -- es dinero que la
  asociación tiene derecho a cobrar, igual que la apertura opaca. Se desglosa como **tercera
  línea**, "Deuda de conexión", junto a "Deuda anterior al corte" y "Deuda desde 2024". Total:
  `cuentas_por_cobrar = deudaAntes2024 + deudaExigible + deudaPuntoConexion`.

- **`carteraPendiente` del dashboard general (consulta 5):** mismo criterio que el Balance,
  se incluye.

- **Cuentas en Mora (consulta 1) / `cuentasMora` (consulta 3):** **NO** entra en la
  determinación de "en mora" -- el punto es una deuda de otra naturaleza, no una cuota
  vencida, y mezclarla ensucia el reporte de mora corriente (que existe para saber a quién
  hay que cobrarle la cuota, no para cobranza general). Explícito: una cuenta al día en todo
  salvo su conexión **no** aparece en "Cuentas en Mora" por esa razón. Se agrega
  `'punto_conexion'` como valor válido de `motivo_mora` aunque no se use todavía, para que
  quede listo si en el futuro se decide lo contrario sin tener que rediseñar el campo.

- **Cartera por Edades (consulta 2):** se excluye por completo. El aging clasifica por
  antigüedad de cuotas vencidas (1-3, 4-6, 7-12, +12 meses); el punto de conexión no tiene esa
  dimensión temporal -- es un cargo único, no una sucesión de meses impagos.

## Decisión: el saldo a favor (92 cuentas, $5.824.000) en el Balance General

Contablemente es un pasivo -- plata que la asociación ya recibió y todavía debe en servicio,
no un menor valor de la cartera. No se resta de "cuentas por cobrar" bajo ningún concepto.

`cuenta_creditos` no genera ningún asiento contable hoy (confirmado: `CarteraRepository.crearCredito`
es un INSERT plano, sin pasar por `AsientoContableService`), así que no puede sumarse a la
sección real "Pasivos" de `reporteBalanceGeneral` (`ReporteService.js:346-397`) -- esa sección
sale exclusivamente de `movimientos_contables` vía `AsientoContableService.getBalancePrueba`, y
es lo que garantiza que Activo = Pasivo + Patrimonio cuadre siempre. Agregar un número ahí sin
su asiento real rompería esa identidad.

**Decisión:** se agrega una sección nueva, informativa, con el mismo tratamiento que ya tiene
"Cartera Pendiente" (`ReporteService.js:386-394`, fuera de la ecuación Activo=Pasivo+Patrimonio,
con el mismo comentario explicando por qué):

```js
{
  titulo: 'Saldo a Favor de Asociados (informativo, no incluido en el balance contable)',
  items: [{ label: 'Créditos disponibles sin aplicar', valor: saldoAFavorTotal }],
  total: saldoAFavorTotal
}
```

Convertirlo en un pasivo contable real (cuenta de Anticipos en el plan de cuentas, con asiento
real cada vez que se genera o se aplica un crédito) queda **fuera de esta fase** -- es un
cambio de devengo contable más grande, no algo para meter antes de entregar.

## Fuera de alcance

- Fase 3 (pantalla de registro de pagos) y Fase 4 (retiro del código viejo): sin cambios.
- El resto de `getDashboardContable()` (ingresos, gastos, saldos de caja/banco): no toca
  `pago_periodos`, no se toca.
- `ReporteRepository.getHistorialPagos()`: ya migrado en una sesión anterior, no depende de
  `pago_periodos`.
- Cualquier ajuste a las cifras de las 13 cuentas con diferencia documentada: si el cambio de
  fuente mueve alguna, se documenta igual que las demás, nunca se ajusta para que cuadre.

## Verificación antes de aceptar

Mismo método que ya funcionó dos veces esta sesión: comparar las 318 cuentas reales, cifra
vieja contra cifra nueva, **antes** de aceptar el cambio -- no después.

Se extiende `scripts/decommission-modelo-viejo/` con un script nuevo,
`comparar-mora-reportes.js`, que para cada una de las 318 cuentas calcula en paralelo (sin
pasar por las funciones ya modificadas, para no comparar una función contra sí misma):
- `meses_mora`/estado (al día vs en mora) viejo (`MAX(pago_periodos)`) vs nuevo (`cubiertoHasta`
  **más** `deudaAntes2024 > 0`)
- a qué rango de `getCartedaPorEdades` cae con cada uno, y el `valor_estimado` de cada uno
  (incluyendo `deudaAntes2024` en el nuevo)
- el total de `getCuentasPorCobrarEstimado` viejo vs
  `deudaAntes2024 + deudaExigible + deudaPuntoConexion` nuevo, con el desglose de cuánto de la
  diferencia viene de cada bucket (para que quede claro cuánto es "de verdad" corrección de la
  cifra vieja y cuánto es simplemente dinero que antes no se contaba en ningún lado)
- el total de saldo a favor ($5.824.000, 92 cuentas) que va a aparecer por primera vez en el
  Balance -- no hay "viejo" con qué compararlo, se reporta el número y de dónde sale

Imprime, igual que `comparar-siguiente-periodo.js`: cuántas sin cambio, cuántas suben, cuántas
bajan, y el detalle completo de las que cambian (código, valor viejo, valor nuevo) para que se
revisen dos o tres a mano antes de aceptar -- mismo criterio que R012/S044/S050.

**No hay un número esperado de antemano** (a diferencia del próximo período sugerido, donde
sabíamos que debían ser ~58 avanzando y 0 retrocediendo real): acá pueden moverse en ambas
direcciones, para cuentas distintas, y eso es correcto -- el objetivo es que la cifra nueva sea
la real, no que se parezca a la vieja. Cada cuenta que cambie se revisa por qué, no se
descarta.

**Se esperan diferencias grandes, y eso no es señal de alarma por sí solo:** el viejo cuenta
meses de mora, el nuevo cuenta dinero -- y ahora además suma la apertura opaca, que el viejo
nunca contó como bucket separado. Ya se vieron brechas de cientos de miles de pesos en cuentas
individuales al hacer esta misma comparación para el próximo período sugerido. El criterio para
aceptar no es "que la diferencia sea chica", es que cada diferencia grande tenga una explicación
concreta al revisarla a mano (igual que S048, R0947 o S050 la tuvieron).

## Testing

- Tests unitarios para el nuevo cálculo de `meses_mora`/`cuentasMora` basado en `cubiertoHasta`
  en `ReporteRepository.test.js` y `DashboardRepository.test.js` (crear si no existen): caso
  con hueco viejo ya superado (reproduce S050 -- debe SEGUIR contando como mora, a diferencia
  del próximo período sugerido), caso al día real, caso sin ningún `CargoMensual` causado.
- Caso específico para la deuda anterior a 2024: cuenta con `deudaAntes2024 > 0` y meses 2024+
  totalmente al día -- debe contar como "en mora" (consulta 1/3), caer en el rango "+12 meses"
  con su `valor_estimado` correcto (consulta 2), y sumar en "cuentas por cobrar"/`carteraPendiente`
  (consultas 4/5) aunque su `deudaExigible` sea 0.
- Test de regresión para `DashboardService.getStats()`: `carteraPendiente` ya no debe depender
  de `PagoService`/`getEstadoCuenta` en absoluto -- si el test falla al eliminar el mock/spy de
  `PagoService`, algo sigue acoplado.
- Caso para el punto de conexión: cuenta con `deudaPuntoConexion > 0` y todo lo demás en 0 --
  debe sumar en "cuentas por cobrar"/`carteraPendiente` (consultas 4/5), pero NO debe aparecer
  en "Cuentas en Mora" (consulta 1) ni en "Cartera por Edades" (consulta 2).
  `reporteBalanceGeneral` debe mostrar sus tres líneas desglosadas ("Deuda anterior al corte" /
  "Deuda desde 2024" / "Deuda de conexión") además del total.
- Caso para el saldo a favor: `reporteBalanceGeneral` debe incluir la nueva sección
  "Saldo a Favor de Asociados", y su total no debe restarse de ninguna otra sección -- test
  explícito de que `totalActivos`/`totalPasivos`/`totalPatrimonio` (los tres derivados de
  `AsientoContableService.getBalancePrueba`) no cambian por la presencia de esta sección nueva.
- Antes de aceptar: correr `comparar-mora-reportes.js` contra las 318 cuentas reales y revisar
  el detalle junto con el usuario.
