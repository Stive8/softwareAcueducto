# Eliminación del modelo viejo de pagos — Fase 1: cortar dependencias inversas

## Contexto

El sistema tiene hoy dos modelos de cartera conviviendo:

- **Modelo viejo**: `PagoService`/`PagoRepository`, tabla `pago_periodos` (ledger mes-a-mes).
- **Modelo nuevo**: `CarteraService`/`CarteraRepository`, tablas `cartera_movimientos`/`cartera_imputaciones`.

Actualmente `PagoService.registrarPagoSostenimiento` hace "doble escritura": escribe en
`pago_periodos` (su ledger de siempre) y, dentro de la misma transacción, también en cartera.
Esta doble escritura demostró ser frágil: un recibo importado durante la carga inicial
directo a `cartera_movimientos` sin fila equivalente en `pago_periodos` dejó desactualizada
la sugerencia de "próximo período" del modelo viejo para **58 de 318 cuentas** (hasta 24 meses
de desfase en algún caso), y ese desfase disparó un rechazo real al intentar registrar un pago
para la cuenta R001. Mantener dos ledgers permite que se desincronicen; la solución de raíz es
dejar de tener dos.

Importante: el rechazo de R001 **no fue una falla** — fue el guardián de la doble escritura
(`PagoService.registrarPagoSostenimiento`, guarda `cargosDeEstePago.length !== periodos.length`)
funcionando exactamente como se diseñó, deteniendo un cobro antes de que se registrara con datos
inconsistentes entre los dos modelos. Es la evidencia concreta de que mantener dos fuentes de
verdad para la misma cartera produce esta clase de fragilidad, y es lo que justifica esta
eliminación en vez de seguir parcheando el puente dual-write.

Un mapeo exhaustivo del código (ver mensaje de auditoría del 2026-08-09, no repetido acá)
confirmó que el acople entre los dos modelos **no es de un solo sentido**: además del
dual-write (viejo → nuevo), el modelo nuevo (`CarteraService`) depende hoy de dos piezas del
modelo viejo:

1. `PagoRepository.getCategoriaTarifaParaMes(cuentaId, anio, mes)` — usado por
   `CarteraService.asegurarCausacion` y por la recategorización de cargos ya causados.
2. Una lectura directa a `pago_periodos` dentro de `CarteraService.getFechaInicioFacturacion`,
   como repliegue (tier 2 de 4) para cuentas que todavía no tienen ningún `CargoMensual`
   causado.

Esta Fase 1 corta esas dos dependencias — o las deja explícitamente documentadas como
aceptables — para que `CarteraService` quede autónomo del modelo viejo. Es el prerrequisito de
las fases siguientes (2: reportes/dashboard a cartera; 3: pantalla de registro de pagos a
cartera; 4: retiro del código viejo).

## Decisión sobre `pago_periodos`

`pago_periodos` **no se elimina ni se migra**. Queda en la base como archivo histórico
congelado: después de que la Fase 3 corte la escritura dual, nada vuelve a insertar filas ahí.
Sigue siendo legible — en particular por el fallback de `getFechaInicioFacturacion` — porque es
una lectura de un archivo inerte, no un acople activo con un sistema en desarrollo.

## Alcance

### 1. Mover `getCategoriaTarifaParaMes` a `CarteraRepository`

No depende de `pago_periodos` (consulta `cuenta_categorias`/`categoria_tarifas`); vive en
`PagoRepository` solo por herencia histórica. Hoy la usan tres puntos, todos ya del lado de
cartera:

- `CarteraService.asegurarCausacion` (`src/services/CarteraService.js:117`)
- La recategorización de cargos ya causados (`src/services/CarteraService.js:339`)
- `scripts/import-cartera/aplicar-causacion-abonos.js:46`

Se mueve el método completo a `CarteraRepository`, se actualizan los tres call sites para usar
`this.repository.getCategoriaTarifaParaMes(...)` en vez de `this.pagoRepository...`, y se borra
el método (y su lógica) de `PagoRepository`. No se crea una abstracción nueva (ej. un
`TarifaRepository` separado): hoy el 100% de los consumidores son de cartera, así que
`CarteraRepository` es el hogar correcto sin especular con usos futuros.

El test que cubre este método hoy vive en
`src/database/migrations/042_tarifas_historicas.test.js`, instanciando `PagoRepository`
directamente. Se actualiza para instanciar `CarteraRepository` en su lugar; los casos de
prueba (huecos históricos de vigencia de tarifa) no cambian.

Tras este movimiento, `CarteraService` deja de necesitar `require('../repositories/PagoRepository')`
ni instanciarlo en su constructor.

`scripts/import-cartera/aplicar-causacion-abonos.js` es parte del pipeline de carga inicial y
**todavía no se ha corrido contra la base de producción**. Después de mover el método hay que
correrlo contra una copia real de datos (no solo tests unitarios) y confirmar que sigue
causando los mismos cargos que antes del movimiento — no basta con que los tests pasen, porque
este script no tiene su propia suite dedicada a `getCategoriaTarifaParaMes`.

### 2. Documentar (sin cambiar) el fallback de `getFechaInicioFacturacion`

Se verificó la cadena de prioridad completa (`src/services/CarteraService.js:49-72`):

1. Primer `CargoMensual` en `cartera_movimientos`.
2. Período más antiguo en `pago_periodos` (el fallback en cuestión).
3. Primer recibo no anulado (`recibos.fecha_recibo`).
4. `fecha_creacion` de la cuenta.

Para una cuenta dada de alta **después** de que `pago_periodos` quede congelada (Fase 3), el
tier 2 nunca va a encontrar filas — la cadena cae automáticamente al tier 3 (su primer recibo,
que si es una cuenta nueva sí va a existir apenas se le cobre algo) o al tier 4 (fecha de
creación, si todavía no se le ha facturado nada). Es decir: **la cadena ya cubre correctamente
a las cuentas nuevas sin necesitar el tier 2**, sin ningún cambio de código.

Esta fase se limita a reescribir el comentario de cabecera de `getFechaInicioFacturacion` para
dejar explícito que:

- El tier 2 es una lectura de un archivo histórico congelado (no un acople activo).
- Solo puede producir resultado para cuentas que ya tenían actividad en el modelo viejo antes
  del corte; toda cuenta creada después cae en el tier 3 o el tier 4 sin pasar por ahí.

No hay cambio de comportamiento en esta parte — es documentación para que la próxima persona
que lea el archivo no interprete esta lectura como una dependencia viva que hay que romper.

## Fuera de alcance de esta fase

- Fases 2 (reportes/dashboard), 3 (pantalla de registro de pagos) y 4 (retiro del código
  viejo) — cada una con su propio spec/plan cuando llegue su turno.
- Cualquier cambio a `pago_periodos` como tabla (no se toca su esquema ni sus datos).
- El fix ya aplicado por separado de mostrar el período cubierto por un Abono en el detalle de
  movimientos (`CarteraRepository.getPeriodosDeAbono`) — no forma parte de esta fase, era un
  gap de UI preexistente sin relación con el modelo viejo.

## Testing

- Tests existentes de `CarteraService` y `CarteraRepository` deben seguir pasando sin
  modificación de expectativas (el comportamiento no cambia, solo la ubicación del código).
- `042_tarifas_historicas.test.js` se actualiza para instanciar `CarteraRepository` en vez de
  `PagoRepository`; sus aserciones no cambian. Esa actualización ya es la cobertura de
  `getCategoriaTarifaParaMes` en su nueva ubicación — no hace falta duplicarla en
  `CarteraRepository.test.js`.
- Al terminar la fase (todos los pasos anteriores aplicados), correr la conciliación completa
  del pipeline de carga inicial (`scripts/import-cartera`) y confirmar que el resultado sigue
  siendo **282/295 cuentas cuadran, 13 con diferencia documentada**. Esta fase es un refactor
  puro — mueve código, no cambia lógica — así que cualquier cifra que se mueva es señal de que
  algo se rompió al mover `getCategoriaTarifaParaMes`, no una mejora.
