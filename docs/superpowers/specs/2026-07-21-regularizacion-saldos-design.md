# Diseño: Ajuste / Regularización de saldos de Caja y Banco

**Fecha:** 2026-07-21
**Estado:** Aprobado (diseño) — pendiente plan de implementación

## Problema

Los datos operativos del acueducto son reales y de producción (pagos desde 2017, gastos
desde 2022), pero el registro histórico es incompleto: muchos movimientos reales ocurrieron
y nunca se registraron. Como consecuencia, el saldo que calcula el sistema para Caja y Banco
no coincide con la realidad física:

- **Saldo calculado por el sistema (Dashboard):** ~$129.000.000
- **Saldo real:** ~$3.000.000 en caja (arqueo físico) + ~$50.000.000 en banco (extracto) ≈ $53.000.000
- **Diferencia:** ~$76.000.000 de "saldo fantasma" por egresos ocurridos y no registrados.

El objetivo del usuario es establecer un **checkpoint / línea de corte** (ej. 31/12/2025 →
enero 2026 limpio): de esa fecha en adelante los saldos son 100% confiables. Para lograrlo sin
reconstruir el pasado desordenado, se reconoce el hueco de forma **explícita, fechada y
documentada** mediante un asiento de regularización — el procedimiento contable estándar de
"saldo de apertura / regularización", más transparente que falsificar registros o dejar un
saldo irreal en el Dashboard.

### Por qué NO usar el campo "Saldo inicial" de Configuración

Era la idea intuitiva del usuario, pero es la herramienta equivocada para este caso:
- Como se conservan **todos** los movimientos históricos, el campo `saldo_caja_inicial` /
  `saldo_banco_inicial` solo desplaza el saldo por una constante (habría que poner un número
  raro/negativo) y **distorsiona el saldo histórico de todas las fechas intermedias**.
- Es **opaco**: no queda fechado ni explicado. Un asiento de regularización sí deja rastro
  auditable de qué pasó y por qué — que es exactamente la transparencia buscada.

## Cómo el sistema calcula los saldos (contexto verificado)

- **Dashboard / módulo de Caja:** `CajaRepository.getSaldo(cuenta)` =
  `saldo_inicial (de configuracion) + Σ(todos los movimientos históricos de esa cuenta)`,
  **sin filtro de fecha** (`src/repositories/CajaRepository.js:19-36`). Por eso, insertar una
  fila en `movimientos` cambia inmediatamente el saldo mostrado.
- **Contabilidad de doble partida:** tabla `asientos_contables`, en paralelo. Los dos libros
  deben mantenerse conciliados (`AsientoContableService.verificarConciliacionCajaBanco()`).

## Enfoque elegido: capa delgada sobre `crearManual`

La maquinaria contable correcta **ya existe y está probada**. `AsientoContableService.crearManual()`
(`src/services/AsientoContableService.js:376`) crea un asiento manual y, con
`sincronizarLedgerSimple: true` (su valor por defecto), sincroniza **ambos libros a la vez**:
inserta el asiento de doble partida **y** la fila correspondiente en `movimientos` (vía
`sincronizarLineaConCajaBanco`), que es lo que mueve el Dashboard. Además valida el período
contable (`validarFechaPermitida`). El propio comentario del código cita este caso de uso:
*"registrar el saldo inicial al migrar al sistema, o un ajuste por una comisión bancaria"*
(`AsientoContableService.js:210`). Ya usa Patrimonio `3105` como contrapartida en
`sincronizarAperturaSaldoInicial` (`AsientoContableService.js:353`).

Alternativas descartadas:
- **Servicio nuevo desde cero** (armar movimiento + asiento a mano): duplica lógica ya
  existente, más superficie de error.
- **Script único de BD**: descartado por el usuario en favor de una función dentro de la app
  (funcionalidad vendible: toda asociación la necesita al migrar y después).

## Decisiones de diseño (confirmadas con el usuario)

1. **Alcance:** función **reutilizable** ("Ajuste / Regularización de saldos"), no un asistente
   de un solo uso. Sirve para el arranque ahora y para correcciones futuras (comisión bancaria
   no registrada, diferencia de arqueo, etc.).
2. **Ubicación:** módulo de **Caja**, botón "Ajustar saldos" junto a "Consignación". Solo
   Administrador.
3. **Contrapartida:** **Patrimonio `3105` fijo** (consistente con el saldo inicial; el operador
   no elige cuenta, evita errores contables).
4. **Estructura:** **dos asientos separados** — uno para Caja, otro para Banco, cada uno contra
   Patrimonio. Más legibles y revertibles por separado.

## Comportamiento

### UI (módulo de Caja)

Botón "Ajustar saldos" → modal con:
- **Fecha del ajuste** (por defecto hoy; para el arranque el usuario pondrá `2025-12-31`).
- **Saldo real de Caja** (input de moneda).
- **Saldo real de Banco** (input de moneda).
- **Motivo** (texto, obligatorio).
- **Tabla comparativa en vivo:** por cada cuenta muestra *saldo calculado por el sistema* vs
  *saldo real ingresado* vs *diferencia a registrar*, para que el usuario vea exactamente qué
  se va a asentar antes de confirmar.

### Cálculo del ajuste

Por cada cuenta (Caja, Banco): `diferencia = saldo_real − saldo_calculado_actual`.
- `diferencia == 0` → esa cuenta no se toca (no se crea asiento).
- `diferencia < 0` (realidad menor — el caso actual) → **Crédito** a Caja/Banco por `|diferencia|`,
  **Débito** a Patrimonio 3105.
- `diferencia > 0` (realidad mayor) → **Débito** a Caja/Banco por `diferencia`, **Crédito** a
  Patrimonio 3105.

### Cuentas usadas

- Caja: `CuentaAutomaticaRepository.getCuentaIdByClave('CAJA')`.
- Banco: `getCuentaIdByClave('BANCO')`.
- Contrapartida: `PlanCuentaRepository.findByCodigo('3105')`.

(Las mismas cuentas que ya usa `sincronizarAperturaSaldoInicial`, cuya viabilidad como líneas
imputables está confirmada por la funcionalidad de saldo inicial ya probada.)

## Código nuevo

### `CajaService.regularizarSaldos({ fecha, saldoRealCaja, saldoRealBanco, motivo, usuarioId, opId })`

- Valida: `saldoRealCaja` y `saldoRealBanco` numéricos ≥ 0; `motivo` no vacío; `fecha` presente;
  al menos una cuenta con diferencia ≠ 0 (si ambas diferencias son 0, error "no hay nada que
  ajustar").
- Idempotencia por `opId` (protección doble-clic, igual que los demás formularios financieros —
  hallazgo de la auditoría de Contabilidad sobre doble contabilización).
- Para cada cuenta con diferencia ≠ 0, llama a
  `AsientoContableService.crearManual({ fecha, concepto, tipoComprobante: 'Regularización de Saldos', lineas, usuarioId })`
  con `sincronizarLedgerSimple: true`.
  - `concepto`: `"Regularización de saldo de {Caja|Banco} al {fecha}: {motivo}"`.
  - `lineas`: las dos líneas (cuenta Caja/Banco ↔ Patrimonio) con débito/crédito según el signo
    de la diferencia.
- Todo dentro de una transacción, de modo que si el segundo asiento falla no queda el primero
  a medias.
- Retorna un resumen: `{ ajusteCaja, ajusteBanco, saldoFinalCaja, saldoFinalBanco }`.

### IPC / cableado

- Canal `caja:regularizarSaldos` en `main.js`, agregado a `CANALES_SOLO_ADMIN`, con idempotencia
  por `opId` como los demás canales financieros.
- Expuesto en `preload.js` (`window.api.caja.regularizarSaldos` o equivalente al patrón actual).
- Consumido en `src/renderer/js/caja.js` con `App.protegerEnvioDoble`.

## Trazabilidad y reversibilidad

- Cada ajuste queda como asiento con concepto explícito, visible en Libro Diario, Balance de
  Prueba y como movimiento en el módulo de Caja.
- **Reversible** desde el módulo de Contabilidad (`revertirManual`, que ya soporta asientos
  manuales): la reversión mueve **ambos** libros de vuelta.
- **Reutilizable / incremental:** cada ejecución lleva del saldo calculado actual al nuevo saldo
  real ingresado; no bloquea futuras ejecuciones.

## Fuera de alcance (paso operativo separado)

- **Congelar el pasado** (cerrar/bloquear períodos hasta dic-2025) se hace con el **módulo de
  Períodos que ya existe**, después de la regularización. No es código nuevo de esta feature; se
  documenta como paso operativo del checkpoint.
- **Conciliación bancaria real** (contra extracto mensual) y **arqueo de caja** formal: no
  existen hoy y no forman parte de esta feature. Son mejoras futuras deseables para la disciplina
  mensual de enero-2026 en adelante.

## Interacción con períodos contables

`crearManual` → `crear` → `validarFechaPermitida(fecha)`. Actualmente la tabla `periodos_contables`
está vacía (nunca se ha cerrado un período), así que asentar con fecha 31/12/2025 no está
bloqueado. **Orden operativo correcto:** primero regularizar (fecha 31/12/2025), *después* cerrar/
bloquear los períodos. Si se invierte el orden (cerrar 2025 y luego intentar regularizar en esa
fecha), el asiento será rechazado — comportamiento correcto y deseable; el mensaje de error debe
ser claro al respecto.

## Testing

Tests unitarios de `CajaService.regularizarSaldos`:
- Diferencia negativa (reduce saldo), positiva (aumenta), y cero (no crea asiento) por cuenta.
- Ambas cuentas con diferencia; una sola cuenta con diferencia.
- Motivo vacío → error; ambas diferencias cero → error "nada que ajustar".
- Idempotencia por `opId` (segunda llamada con el mismo `opId` no duplica asientos).
- **Post-condición clave:** tras el ajuste, `getSaldoCaja()` / `getSaldoBanco()` devuelven
  exactamente el saldo real ingresado.
- **Conciliación:** `verificarConciliacionCajaBanco()` sigue reportando `conciliado: true` para
  Caja y Banco después del ajuste (ambos libros cuadran).
