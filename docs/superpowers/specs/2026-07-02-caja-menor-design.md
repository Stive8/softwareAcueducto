# Caja Menor (Petty Cash) + fix de cuentas de agrupación mal usadas como imputables — Design

## Contexto y motivación

Hoy el software solo tiene una cuenta de efectivo (`1105 Caja`). Todos los gastos y aportes en efectivo se contabilizan contra esa única cuenta. La organización quiere separar un fondo de **Caja Menor** para gastos pequeños (ej. mano de obra ocasional, ferretería menor, refrigerios) del efectivo general (recaudo de aportes, consignaciones al banco), para poder responder:

- ¿Cuánto se gastó por Caja Menor este mes?
- ¿Quién es el responsable / quién legalizó la Caja Menor?
- ¿Cuánto efectivo debería haber físicamente en la Caja Menor en este momento?

El motor de contabilización (plantillas de asiento, cuentas automáticas, mapeo de conceptos — introducido en migraciones 022/025/026) ya está diseñado para resolver cuentas dinámicamente por contexto, así que esta separación se implementa extendiendo mecanismos existentes, no construyendo un sistema paralelo.

Durante el diseño de este trabajo se descubrió un **bug preexistente y no relacionado** que se corrige en la misma migración por compartir la causa raíz exacta (ver sección "Bug preexistente" más abajo).

## Alcance

**Incluido:**
- Split contable de `1105 Caja` en `110505 Caja General` / `110510 Caja Menor`.
- Selector "¿de cuál caja sale?" en el formulario de **Gastos** (solo Gastos, no Aportes/Recibos).
- Sistema de "saldo objetivo" (no fondo fijo inmutable): un monto configurable al que se repone la Caja Menor cuando se reembolsa.
- Registro de un responsable de Caja Menor (uno solo activo a la vez), con historial de cambios.
- Interruptor Activa/Inactiva para toda la funcionalidad de Caja Menor.
- Acción de "Reembolsar Caja Menor" en la pantalla de Caja, que traslada fondos de Caja General a Caja Menor hasta el saldo objetivo, adjuntando el responsable vigente como tercero del asiento.
- **Fix del bug preexistente**: `BANCO` y `CARTERA_USUARIOS` (cuentas automáticas) y los mapeos de conceptos `Movimiento/Caja`, `Movimiento/Banco`, `RecibosDetalle/AplicacionSaldoFavor` y `RecibosDetalle/AbonoSaldoFavor` apuntan hoy a cuentas de agrupación (no imputables), lo que hace fallar la generación del asiento contable en escenarios reales (pago por transferencia, aplicación de saldo a favor). Se reasignan a subcuentas hoja.

**Explícitamente fuera de alcance (YAGNI por ahora):**
- Generación de "Acta de Entrega" (documento/PDF) al cambiar de responsable. El modelo de datos no lo bloquea (responsable + fecha + tercero ya quedan registrados), pero no se construye el documento en este trabajo.
- Módulo de "Arqueo de Caja" (conteo físico y conciliación). El saldo contable de 110510 ya permite comparar "cuánto debería haber", pero un flujo de conteo físico formal es una funcionalidad aparte.
- Selector de caja en el formulario de Aportes/Recibos — se decidió que los aportes en efectivo siempre entran a Caja General.
- Más de un responsable activo simultáneamente (ej. titular + suplente).
- Soporte para más de una cuenta bancaria activa en los flujos automáticos de Gasto/Recibo por Banco (`BANCO` sigue resolviendo a una única cuenta por defecto, `111005 Cuenta de Ahorros`; usar `111010 Cuenta Corriente` para un movimiento específico seguiría requiriendo una Nota Contable manual, igual que hoy).

## Diseño

### 1. Plan de cuentas y cuentas automáticas

- `1105 Caja` deja de ser imputable (nivel 3, pasa a ser agrupadora) con dos subcuentas nivel 4:
  - `110505 Caja General`
  - `110510 Caja Menor`
- La cuenta automática `CAJA` (tabla `cuentas_automaticas`) se reconfigura para apuntar a `110505`. Esto preserva el comportamiento actual de Aportes/Recibos y de cualquier Gasto en efectivo que no elija explícitamente Caja Menor, sin tocar su código.
- El mapeo `mapeo_conceptos_contables` (`Movimiento`, `Caja`) se actualiza de `1105` → `110505` (usado por Notas Contables manuales que afectan Caja; hasta ahora apuntaba a una cuenta que, tras el split, sería de agrupación).

### 2. Configuración de Caja Menor

Tres claves nuevas en la tabla `configuracion` (clave/valor, ya existente):
- `caja_menor_activa` — `'true'`/`'false'`, default `'false'`. Controla si el selector de caja aparece en Gastos y si la tarjeta de Caja Menor aparece en la pantalla de Caja. Al desactivarse, el histórico de movimientos ya registrados en 110510 permanece intacto y consultable; solo se oculta la funcionalidad hacia adelante.
- `caja_menor_saldo_objetivo` — monto numérico, default `'0'`. No es un "fondo fijo" inmutable: la organización puede cambiarlo cuando quiera (ej. de $300.000 a $500.000), y el próximo reembolso repone hasta el valor vigente en ese momento.

Nueva tabla `caja_menor_responsables` (para poder responder "responsable actual" e "historial de cambios"):

```sql
CREATE TABLE caja_menor_responsables (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tercero_id     INTEGER NOT NULL REFERENCES terceros(id),
  fecha_inicio   DATE NOT NULL,
  fecha_fin      DATE,              -- NULL = responsable actual
  observaciones  TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Solo puede existir una fila con `fecha_fin IS NULL` a la vez. Al asignar un nuevo responsable, el servicio cierra (`fecha_fin`) la fila activa anterior e inserta la nueva dentro de la misma transacción — nunca hay dos responsables "actuales" simultáneos, y nunca se borra el historial.

Pantalla **Configuración → Caja Menor** (nueva sección):
- Interruptor Activa/Inactiva.
- Responsable actual: selector de terceros + botón "Cambiar Responsable" (pide fecha del cambio). Enlace a "Ver historial de responsables".
- Saldo objetivo: campo numérico editable.

### 3. Formulario de Gastos

Cuando el método de pago es "Efectivo" **y** `caja_menor_activa = 'true'`, aparece un selector adicional **Caja General / Caja Menor** (default: Caja General). Si Caja Menor está inactiva, el selector no se muestra y el comportamiento es idéntico al actual (siempre Caja General vía la automática `CAJA`).

Nueva columna `gastos.caja_efectivo_id` (nullable, `REFERENCES plan_cuentas(id)`): `GastoService.create` la llena con el id de `110505` o `110510` según lo elegido. Para gastos por Banco, o si Caja Menor está inactiva, queda en `NULL` — `GastoRepository` la completa con el id de `110505` antes de pasar el contexto al motor, para que la línea siempre resuelva a una cuenta válida.

### 4. Motor de contabilización — plantilla de Gasto en Efectivo

La plantilla `GASTO_EFECTIVO` se versiona a **v2** (código existente, `plantillas_contabilizacion.version = 2`, `fecha_desde = date('now')`), sin modificar ni eliminar la v1:
- v1 (histórica, sigue vigente para cualquier fecha anterior a esta migración): línea de crédito usa `cuenta_automatica_clave = 'CAJA'` (fija).
- v2 (vigente desde hoy en adelante): línea de crédito usa `cuenta_contexto_campo = 'caja_efectivo_id'`.

El motor ya reconstruye asientos usando la plantilla vigente en la fecha del documento (`resolverPlantilla`), así que los asientos históricos generados con v1 no cambian.

### 5. Reembolso de Caja Menor

Se modela como un **asiento manual** de dos líneas, construido directamente por `CajaService` (sin pasar por el motor de plantillas — no hace falta para un movimiento de dos líneas con cuentas fijas conocidas):

`CajaService.reembolsarCajaMenor({ fecha, observaciones, usuarioId })`:
1. Lee `caja_menor_saldo_objetivo` de `configuracion` y el saldo actual de `110510` (vía Libro Mayor / suma de `movimientos_contables`).
2. `monto = saldo_objetivo - saldo_actual`. Si `monto <= 0`, no genera nada: la UI deshabilita el botón de reembolso y el backend rechaza con `"La Caja Menor ya tiene el saldo objetivo o más; no hay nada que reembolsar"`.
3. Busca el responsable vigente en `caja_menor_responsables` (`fecha_fin IS NULL`). Si no existe, rechaza con `"No hay un responsable de Caja Menor asignado. Configúralo en Configuración → Caja Menor antes de reembolsar."`.
4. Construye las líneas directamente:
   ```js
   [
     { cuentaContableId: id_110510, debito: monto, terceroId, terceroNombre, terceroIdentificacion },
     { cuentaContableId: id_110505, credito: monto }
   ]
   ```
   El responsable va en la línea de **débito a Caja Menor** (no en la de Caja General), para que al filtrar el Libro Mayor por `110510` cada reembolso muestre quién era el responsable en ese momento (sección 7).
5. Llama a `AsientoContableService.crearManual({ fecha, concepto: 'Reembolso de Caja Menor a <responsable>', tipoComprobante: 'Reembolso Caja Menor', lineas, usuarioId, sincronizarLedgerSimple: false })`.

**Por qué `sincronizarLedgerSimple: false` y no un `Movimiento`/`Traslado` como la Consignación existente:** el ledger simple (`movimientos`, el que alimenta "Saldo en Caja" del Dashboard) tiene columnas `origen`/`destino` con `CHECK IN ('Caja','Banco')` — no puede distinguir Caja General de Caja Menor sin una migración de esquema más invasiva. Pero además, semánticamente no debería: un reembolso es un traslado *dentro* de Caja (Caja General → Caja Menor), el efectivo total en la organización no cambia, así que "Saldo en Caja" no debe moverse. Sincronizarlo igual que Consignación (Caja → Banco, que sí cambia el tipo de disponible) generaría una fila fantasma de "Egreso" sin su contraparte, descuadrando el Dashboard. Por eso el reembolso se contabiliza solo en el libro de doble partida (`movimientos_contables`, que sí distingue 110505 de 110510), y el ledger simple queda deliberadamente al margen.

Esto requiere un cambio menor en `AsientoContableService.crearManual`: agregar el parámetro opcional `sincronizarLedgerSimple = true` (hoy está fijo en `true`) para que el llamador pueda desactivarlo en este caso puntual, sin afectar el comportamiento por defecto de las Notas Contables manuales normales.

### 6. Pantalla de Caja

Si `caja_menor_activa = 'true'`, se agrega una tarjeta junto a "Saldo en Caja"/"Saldo en Banco":

```
Caja Menor
$180.000 de $300.000
Responsable: Juan Pérez
[+ Reembolsar Caja Menor]   ← deshabilitado si saldo actual ≥ objetivo
```

El botón abre un modal de confirmación: fecha, monto ya calculado (no editable — el monto lo determina el saldo objetivo, no un ajuste manual), campo opcional de observaciones.

### 7. Reportes

Sin desarrollo nuevo. "¿Cuánto se gastó por Caja Menor este mes?" y "¿cuánto debería haber?" ya se responden con **Contabilidad → Libro Mayor** (filtrando la cuenta 110510) y **Balance de Prueba**, porque Caja Menor pasa a ser una cuenta más del plan de cuentas. "¿Quién legalizó?" queda visible ahí mismo porque cada línea de reembolso lleva el tercero (responsable) adjunto.

### 8. Bug preexistente: cuentas automáticas/mapeos apuntando a cuentas de agrupación

Independiente de Caja Menor, se corrige en la misma migración porque comparte exactamente el mismo mecanismo de causa raíz (una automática o un mapeo apuntando a una cuenta con subcuentas, que `AsientoContableService.crear()` rechaza por no ser imputable):

| Mecanismo | Hoy apunta a | Problema | Se reasigna a |
|---|---|---|---|
| `cuentas_automaticas.BANCO` | `1110 Bancos` (tiene hijos) | Todo Gasto o Recibo pagado "por Banco" falla al generar su asiento | `111005 Cuenta de Ahorros` |
| `cuentas_automaticas.CARTERA_USUARIOS` | `1305 Clientes - Cartera de Usuarios` (tiene hijos) | Falla al aplicar/abonar saldo a favor | `130505 Cartera de Usuarios - Servicio de Acueducto` |
| `mapeo_conceptos_contables` (`Movimiento`,`Banco`) | `1110` | Notas Contables manuales que afectan Banco quedan con una cuenta de agrupación | `111005` |
| `mapeo_conceptos_contables` (`RecibosDetalle`,`AplicacionSaldoFavor`) | `1305` | Falla al aplicar saldo a favor en un recibo | `130505` |
| `mapeo_conceptos_contables` (`RecibosDetalle`,`AbonoSaldoFavor`) | `1305` | Falla al abonar saldo a favor en un recibo | `130505` |

Como el sistema todavía está en datos de prueba, es probable que ningún Gasto/Recibo real "por Banco" ni ninguna aplicación de saldo a favor se haya intentado contabilizar todavía — por eso no se había detectado en uso normal.

### 9. Migración y compatibilidad

Migración `029_caja_menor_y_fix_cuentas_agrupacion.sql`:
- Crea `110505 Caja General` y `110510 Caja Menor` bajo `1105`.
- Reasigna `cuentas_automaticas`: `CAJA` → `110505`, `BANCO` → `111005`, `CARTERA_USUARIOS` → `130505`.
- Actualiza `mapeo_conceptos_contables`: (`Movimiento`,`Caja`) → `110505`, (`Movimiento`,`Banco`) → `111005`, (`RecibosDetalle`,`AplicacionSaldoFavor`) → `130505`, (`RecibosDetalle`,`AbonoSaldoFavor`) → `130505`.
- Crea tabla `caja_menor_responsables`.
- Inserta en `configuracion`: `caja_menor_activa = 'false'` (no se activa sola; la organización la enciende cuando esté lista), `caja_menor_saldo_objetivo = '0'`.
- Agrega columna `gastos.caja_efectivo_id` (nullable) — gastos existentes quedan en `NULL`, sin reescribir historial.
- Versiona `GASTO_EFECTIVO` a v2 (`cuenta_contexto_campo = 'caja_efectivo_id'`), con `fecha_desde = date('now')`; v1 permanece intacta para reconstrucción histórica.

Cambio de código acompañante (no es SQL, va en el mismo trabajo): `AsientoContableService.crearManual` gana el parámetro opcional `sincronizarLedgerSimple = true`.

La migración `028_ampliar_mantenimiento_y_gastos_diversos.sql` (cuentas de Mantenimiento/Diversos + fix de `512005`) ya fue aplicada previamente y es independiente de este trabajo.

## Testing

- Migración `029` corre limpio sobre la base real; `1105` pasa a `tieneHijos()=true` y ya no admite líneas de asiento directas.
- Gasto en efectivo con Caja Menor inactiva → se comporta idéntico a hoy (crédito a `110505` vía automática `CAJA`, sin selector visible).
- Gasto en efectivo con Caja Menor activa, eligiendo "Caja Menor" → asiento credita `110510`, no `110505`.
- Reembolso con saldo actual ≥ objetivo → rechazado, sin asiento generado.
- Reembolso sin responsable configurado → rechazado con el mensaje específico.
- Reembolso válido → asiento manual `110510` (débito) / `110505` (crédito), con tercero = responsable vigente en la línea de débito, y **sin** fila nueva en `movimientos` (el "Saldo en Caja" del Dashboard no cambia).
- Cambiar responsable dos veces → `caja_menor_responsables` conserva ambas filas históricas, solo una con `fecha_fin NULL`.
- Asiento de un gasto anterior a la migración (plantilla v1) se sigue reconstruyendo igual al reimprimir/consultar — no cambia por la existencia de v2.
- Gasto pagado "por Banco" y aplicación de saldo a favor en un Recibo generan su asiento sin error (regresión del bug de la sección 8).
