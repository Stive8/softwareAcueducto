# Deuda técnica conocida — auditoría de entrega (2026-08-11)

Inventario de los hallazgos de la auditoría de entrega del 2026-08-11 que **no** se corrigieron
en esa ronda. Clasificación heredada del reporte original:

- **IMPORTANTE**: hay que arreglarlo pronto, no impide entregar.
- **MENOR**: limpieza, deuda técnica, mejora.

## Ya corregido en esta ronda (para referencia, no repetir)

Los 4 hallazgos que bloqueaban entrega y 3 importantes que se subieron de categoría ya están
corregidos y commiteados por separado:

1. Restauración de backup sin respaldo previo ni validación de esquema/versión.
2. Causación de deuda antes de 2024 (rompía el corte del 31/12/2023).
3. "Pagado Hasta"/"Aportado hasta" podía esconder un hueco real de deuda (PDF, banner, detalle).
4. Anular un recibo con crédito ya redimido podía dejar el saldo a favor negativo.
5. `nuevospuntos:create`/`registrarAbono` sin protección contra doble clic.
6. Dos fórmulas de "en mora" divergentes entre Dashboard/Cuentas y Reportes/Pagos.

De paso, el fix de restauración (punto 1) también resolvió el hallazgo, antes listado aparte,
de que el runner de migraciones no validaba si un `.db` restaurado era de una versión más nueva
que la app instalada: `BackupService.validarArchivoRestauracion` ahora lo rechaza explícitamente
en los tres caminos de restauración (manual, actualizar desde la nube, actualización silenciosa).

## Conteo pedido: cuentas afectadas hoy por `mesesSinTarifa` invisible

Se contó, en modo solo lectura contra `data/acueducto.db`, cuántas de las 287 cuentas activas
tienen hoy al menos un mes en `mesesSinTarifa` (mes sin categoría/tarifa vigente que
`calcularAPagar` excluye de "a pagar" sin ningún aviso en pantalla, ver hallazgo IMPORTANTE
abajo): **0 cuentas**. No sube de categoría por ahora, pero sigue siendo un problema latente —
basta con que una cuenta quede sin tarifa vigente en el futuro (categoría vencida, o asignada a
"Sin clasificar") para que vuelva a ocurrir en silencio.

---

## IMPORTANTE

### `mesesSinTarifa` se calcula pero nunca llega a la pantalla
`CarteraService.calcularAPagar`/`getEstadoCartera` (`src/services/CarteraService.js`, alrededor de
la línea 380) calculan `mesesSinTarifa` y emiten un `console.warn`, pero ningún archivo de
`src/renderer/js/` lee ese campo. Una cuenta sin tarifa vigente para algún mes muestra un "a
pagar" menor al real, sin aviso visible para quien cobra. 0 cuentas afectadas hoy (ver arriba),
pero el mecanismo de aviso sigue faltando.

### `registrarAbono` en modo FIFO no llama `asegurarCausacion` antes de imputar
`CarteraService.registrarAbono` — nota de código ya agregada en el propio archivo, junto a la
función. No conectado a IPC todavía: no es explotable hoy, pero hay que corregirlo antes de
conectarlo (mismo patrón que ya se corrigió en `redimirCredito`, caso real R007).

### `ajustarDeuda` no rechaza `NaN`/`Infinity`/strings no numéricos en `monto`
`CarteraService.ajustarDeuda` — nota de código ya agregada, junto a la función. Solo rechaza
`undefined`/`null`/`0` exacto. No conectado a IPC todavía.

### No hay CHECK/trigger que impida que la suma de imputaciones supere el cargo o el abono
`cartera_imputaciones` (migración `036_cartera_movimientos.sql`) solo tiene
`CHECK(monto > 0)` y `UNIQUE(abono_id, cargo_id)`. El invariante "suma de imputaciones ≤ monto
del cargo/abono" hoy se sostiene únicamente porque todo el código de escritura pasa por
`distribuir()` (`src/services/cartera/imputacion.js`). Una función futura, o un script de
corrección manual, que inserte en `cartera_imputaciones` sin pasar por ese tope no sería
detectada por la base de datos — el único síntoma sería un saldo incorrecto descubierto después.

### `generarHTML` de recibos no lee la corrección vigente
`ReciboService.generarHTML` — nota de código ya agregada, junto a la función. Hoy es inofensivo
porque `corregirCampo` no está conectado a la UI. Corregir antes de exponer esa función, no
después.

### No hay mensaje de reserva genérico para errores no contemplados
~40 sitios en `src/renderer/js/` (pagos.js, cuentas.js, gastos.js, caja.js, categorias.js,
reportes.js) muestran `response.error` (= `error.message` crudo) directo al usuario. Funciona
porque los servicios lanzan mensajes en español por disciplina, pero un bug real o una
restricción SQLite no prevista mostraría texto técnico a un operador de junta comunal. Falta un
mensaje de reserva en `envolverHandle` (`main.js`) para cualquier error que no calce con el
patrón de mensaje-de-negocio conocido.

### Botón "Reembolsar Caja Menor" se deshabilita sin explicar por qué
`src/renderer/js/caja.js`, alrededor de la línea 161-176: `puedeReembolsar` no distingue "no hay
nada que reembolsar todavía" (normal) de "falta asignar un responsable" (algo por corregir en
otra pantalla). Sin `title` ni texto de ayuda.

### `PlanCuentaService.update()` permite cambiar tipo/naturaleza de una cuenta con movimientos
`src/services/PlanCuentaService.js`, método `update()`: a diferencia de `toggleActivo()` (que sí
llama `tieneMovimientos()` antes de bloquear), `update()` no valida. Cambiar `naturaleza` de una
cuenta contable que ya tiene asientos invierte silenciosamente el signo de todo el histórico en
Libro Mayor/Balance de Prueba.

### `MotorContabilizacionService` puede generar una línea de asiento con débito/crédito negativo
`_aplicarImpuestos()` resta cada impuesto de la primera línea con `debito`/`credito` > 0 del
mismo lado, sin validar que el resultado sea ≥ 0. Si se configuran impuestos que en conjunto
superan el 100% de la base en el mismo lado, una línea queda negativa sin que el chequeo de
balance de `AsientoContableService.crear()` lo detecte (el agregado sigue cuadrando). Requiere
una configuración de impuestos poco común, no confirmada en uso actual.

### `CloudBackupOrchestratorService.respaldarAhora()` avanza `secuenciaLocal` antes de confirmar éxito
Si `cloud.subirRespaldo()` falla (sin internet, por ejemplo) a mitad de camino, el contador local
ya avanzó — puede silenciar la detección de conflictos entre equipos en un respaldo futuro
genuino de otro equipo.

---

## MENOR

- **Movimientos "Abono" de contrapartida** (reclasificación/anulación) quedan sin imputaciones
  por diseño (correcto), pero eso no está señalado explícitamente en el detalle de pantalla —
  riesgo de falso diagnóstico en una auditoría futura.
- **`cuenta_creditos.abono_movimiento_id`** (migración `041_credito_trazabilidad.sql`) no tiene
  FK explícita hacia `cartera_movimientos`, rompiendo la simetría con el resto del esquema.
- **`PagoRepository.crearMovimientoCredito`** es código muerto sin ninguna validación de monto —
  ya no lo llama nadie (reemplazado, ver comentario en `PagoService.js` línea ~429). Candidato a
  eliminar.
- **`ReciboRepository.anular`** no se auto-envuelve en su propia transacción; depende de que el
  caller lo haga (hoy `ReciboService.anular` lo hace correctamente, pero es un footgun para
  llamadores futuros — comparar con `CuentaEstadoRepository.cambiarEstado`, que sí se
  auto-envuelve).
- **`PagoService.registrarPagoSostenimiento`** con `cantidadMeses` no numérico (string) produce
  un `TypeError` interno en vez de un mensaje de validación claro. Sin pérdida de datos (rollback
  automático), pero mala UX de error.
- **`getSaldoCredito`/`getSaldoCreditoDisponible`** duplican la misma consulta en
  `PagoRepository.js` y `CarteraRepository.js` sin compartir código — riesgo de desincronización
  si una futura corrección se aplica en un solo lugar.
- **Columna "Cartera nueva"** de la tabla de Pagos repite con iconos información que ya muestran
  las columnas "Saldo a Favor" y "Conexión" de la misma fila. El tooltip "modelo nuevo de
  cartera (en validación...)" también suena desactualizado.
- **Confirmación de restauración es única, no doble** como afirma `docs/guia-instalacion.md`. El
  diálogo actual ya incluye más contexto (ruta del respaldo previo, cantidad de cuentas, avisos
  de migración pendiente) pero sigue siendo un solo diálogo de confirmación, no dos.
- **`PropietarioRepository.asignarACuenta`** no valida orden cronológico de fechas al reasignar
  — puede generar un registro con `fecha_fin < fecha_inicio` en el historial de propiedad.
- **Formularios de anulación en Gastos/Recibos** (método de pago, anulación general) no usan
  `App.protegerEnvioDoble` — sin riesgo real de duplicado (el backend re-valida el estado antes
  de anular), pero un doble clic puede lanzar un error de UI evitable.
- **Respaldo automático** (`BackupService.ejecutarSiCorresponde`) solo corre una vez al iniciar
  la app, no en un temporizador periódico durante sesiones largas.
