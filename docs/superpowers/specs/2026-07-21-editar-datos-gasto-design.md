# Diseño: Editar Concepto y Observaciones de un Gasto

**Fecha:** 2026-07-21
**Estado:** Aprobado (diseño) — pendiente plan de implementación

## Problema

Hoy un Gasto ya creado no se puede editar libremente. Las únicas operaciones existentes son
`create`, `anular` (revierte el efecto en caja/banco, nunca borra) y `corregirMetodoPago`
(revierte y regenera el asiento contable para cambiar entre Efectivo/Transferencia). No hay forma
de corregir un error de tipeo en el concepto o agregar/editar una observación sin ese aparato
contable, que en este caso no hace falta.

El usuario priorizó específicamente estos dos campos porque son de más bajo riesgo: no tienen
ningún efecto contable (no participan en `generarDesdeGasto`, no se copian a las líneas del
asiento, no afectan saldos de Caja/Banco ni cartera de terceros). El resto de campos (tercero,
tipo de gasto, valor, fecha, método de pago) requerirían revertir y regenerar el asiento contable
— quedan fuera de alcance de este spec, para abordarse después como incrementos separados.

## Decisión de diseño (confirmada con el usuario)

Espejar el patrón ya existente (`corregirMetodoPago`), pero **sin** la parte contable, porque
concepto y observaciones no la necesitan:
- Un solo método nuevo, `actualizarDatos`, para ambos campos juntos (no dos acciones separadas).
- Mismo nivel de permiso que crear/anular/corregir un gasto (cualquier rol Usuario o
  Administrador, no restringido a Administrador).
- Bloqueado si el gasto está `Anulado` (mismo criterio que `corregirMetodoPago`).

## Comportamiento

### Backend — `GastoService.actualizarDatos(id, { concepto, observaciones }, usuarioId)`

- Busca el gasto por `id`; si no existe, error.
- Si `gasto.estado === 'Anulado'`, error ("No se puede editar un gasto anulado").
- Si `concepto` viene vacío o solo espacios, error (mismo criterio que `create`).
- `observaciones` puede quedar vacío (opcional, igual que en `create`).
- Llama a `GastoRepository.actualizarDatos(id, { concepto, observaciones })` — un `UPDATE`
  directo a la tabla `gastos`, **sin transacción** (no hay nada más que coordinar), **sin tocar**
  `movimientos` ni `asientos_contables`, **sin pasar por**
  `PeriodoContableService.validarFechaPermitida`. Esta es la diferencia clave con todo el resto
  del módulo: como estos dos campos no tienen efecto contable, no hay razón para que un período
  cerrado bloquee la edición — de hecho es justo el tipo de corrección que un cierre de período
  no debería impedir (un error de tipeo en el concepto de un gasto de un mes ya cerrado hoy no se
  puede corregir de ninguna forma).
- No requiere revertir/regenerar ningún asiento, porque ningún asiento referencia estos campos
  (confirmado: `MotorContabilizacionService` solo copia `cuenta_contable_id`, montos y datos de
  tercero a las líneas del asiento de un Gasto — nunca `concepto` ni `observaciones`).
- Retorna sin valor de interés (o `true`), igual que `actualizarMetodoPago`.

### Repositorio — `GastoRepository.actualizarDatos(id, { concepto, observaciones })`

```sql
UPDATE gastos SET concepto = ?, observaciones = ? WHERE id = ?
```

### IPC — canal `gastos:actualizarDatos`

- Recibe **un solo objeto** como primer argumento: `{ id, concepto, observaciones }` — a
  diferencia de `gastos:corregirMetodoPago` (que usa argumentos posicionales `(id,
  nuevoMetodoPago, motivo)`, por lo que la auditoría automática de `main.js` solo captura el
  `id` en `datosNuevos`, no el resto del cambio). Con un solo objeto, la auditoría genérica
  (`envolverHandle`, que hace `datosNuevos = JSON.stringify(args[0])`) captura el detalle
  completo del cambio sin ningún código adicional.
- **No** se agrega a `CANALES_SOLO_ADMIN` (mismo nivel de permiso que `gastos:create`/
  `gastos:anular`/`gastos:corregirMetodoPago`, ninguno de los cuales está ahí).
- **No** se agrega a `CANALES_IDEMPOTENTES`. A diferencia de los canales que crean un documento
  financiero nuevo (donde un doble envío crearía dos registros/asientos), esta operación es un
  `UPDATE` puro: reenviar el mismo `{concepto, observaciones}` dos veces produce el mismo estado
  final. La protección de doble envío del lado del cliente (`App.protegerEnvioDoble`) es
  suficiente como higiene de UX; no hace falta la infraestructura de `opId`.

### UI — modal de detalle del gasto (`showDetailModal`)

Botón "Editar" junto a "Corregir Método de Pago", visible solo si `gasto.estado !== 'Anulado'`.
Abre un modal simple con dos campos precargados (`concepto` como input de texto requerido,
`observaciones` como textarea opcional) y los botones Cancelar/Guardar, siguiendo exactamente el
mismo patrón visual e interacción que `showCorregirMetodoPagoModal`. Al guardar con éxito: cierra
el modal, refresca la lista de gastos y las stats, muestra un toast, y (si el detalle sigue
abierto en el flujo) refleja el cambio.

## Fuera de alcance

- Editar tercero, tipo de gasto, valor, fecha o método de pago — todos requieren revertir y
  regenerar el asiento contable (patrón ya existente vía `corregirMetodoPago`), y en el caso de
  tipo de gasto y valor, validaciones adicionales (re-resolución de cuenta contable, saldo
  disponible en efectivo). Quedan para un incremento futuro, a diseñarse por separado.
- Ningún cambio a `AsientoContableService`, `MotorContabilizacionService`, reportes, soportes
  adjuntos, ni al modelo de auditoría — todos siguen funcionando sin modificación porque no leen
  ni dependen de que `concepto`/`observaciones` sean inmutables.

## Testing

Tests unitarios de `GastoService.actualizarDatos`:
- Gasto no encontrado → error.
- Gasto anulado → error.
- Concepto vacío o solo espacios → error.
- Caso feliz: actualiza `concepto` y `observaciones`, y `GastoRepository.findById` refleja los
  valores nuevos.
- Observaciones puede quedar vacío/null.
- **Verificación de que NO se toca contabilidad**: después de `actualizarDatos`, el asiento
  contable original del gasto (`AsientoContableService.getById`) sigue siendo el mismo (mismo
  id, mismo estado `Activo`, mismas líneas) — no se creó ningún asiento de reversión ni uno
  nuevo.
- **Verificación de que funciona con un período cerrado**: crear un gasto, cerrar el período
  contable de su fecha (`PeriodoContableService`), y confirmar que `actualizarDatos` de todas
  formas tiene éxito (a diferencia de lo que pasaría hoy con `corregirMetodoPago` en el mismo
  escenario).
