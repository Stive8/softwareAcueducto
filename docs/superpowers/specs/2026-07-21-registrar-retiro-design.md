# Diseño: Registrar Retiro (Banco → Caja)

**Fecha:** 2026-07-21
**Estado:** Aprobado (diseño) — pendiente plan de implementación

## Problema

El módulo de Caja solo tiene un botón guiado para "Consignación" (Caja → Banco: cuando se
recauda efectivo y se deposita en el banco). No existe el camino inverso — un "Retiro" (Banco →
Caja: cuando se saca efectivo del banco para tener caja disponible), pese a ser una operación
igual de rutinaria en la vida real de la asociación.

Hoy, la única forma de registrar un retiro es entrar a Contabilidad → Asientos → Nuevo Asiento
Manual y armarlo a mano (débito a Caja, crédito a Banco), lo cual exige conocimiento de partida
doble que un administrador operativo no necesariamente tiene. Registrarlo como "Gasto" sería
incorrecto: un retiro no es un gasto real (no reduce el patrimonio, solo mueve dinero entre
cuentas propias) y contaminaría los reportes de Ingresos/Gastos del período.

## Hallazgo clave que simplifica el diseño

La plantilla contable `TRASLADO_CAJA_BANCO` (migración `025_plantillas_contabilizacion.sql`,
`plantilla_id=5`) **ya es genérica por dirección**: sus dos líneas resuelven la cuenta
dinámicamente vía `cuenta_mapeo_campo: 'destino'` (Débito) y `cuenta_mapeo_campo: 'origen'`
(Crédito), leyendo esos valores del contexto del movimiento — no tiene la dirección Caja→Banco
fija. Por lo tanto, `AsientoContableService.generarDesdeMovimientoTraslado(movimientoId, usuarioId)`
ya funciona correctamente para un traslado en cualquier sentido, **sin ningún cambio** en el
motor de plantillas, `AsientoContableService` ni `MotorContabilizacionService`. El único código
nuevo necesario es el mismo patrón que `registrarConsignacion`, con la dirección invertida.

## Decisión de diseño (confirmada con el usuario)

**Permisos:** mismo nivel que Consignación — cualquier rol Usuario o Administrador (no Consulta),
**no** restringido a Administrador. Es una operación rutinaria de manejo de caja, a diferencia de
"Ajustar saldos" (que sí es una corrección contable y quedó reservada a Administrador).

## Comportamiento

### Backend — `CajaService.registrarRetiro({ monto, fecha, observaciones }, usuarioId)`

Espejo exacto de `registrarConsignacion` (`src/services/CajaService.js`), con la dirección
invertida:
- Valida `monto > 0` y `fecha` obligatoria (mismos mensajes de error, adaptados).
- Valida `monto <= saldoBanco` (en vez de `saldoCaja`) — no se puede retirar más de lo que hay en
  el banco.
- Dentro de una transacción (`this.repository.transaccion`): crea un movimiento
  `{ tipo: 'Traslado', origen: 'Banco', destino: 'Caja', monto, concepto: 'Retiro de banco a caja', referenciaTipo: 'Retiro', fechaMovimiento: fecha, observaciones }`
  vía `this.repository.crearMovimiento(...)`.
- Llama a `this.asientoContableService.generarDesdeMovimientoTraslado(movimientoId, usuarioId)`
  (sin modificar esa función — ya es genérica, ver hallazgo arriba).
- Retorna el `movimientoId`.

### IPC — canal `caja:registrarRetiro`

- Agregado a `CANALES_IDEMPOTENTES` en `main.js` (con `opId`, protección de doble envío —
  crea un documento financiero, igual que `caja:registrarConsignacion`).
- **No** agregado a `CANALES_SOLO_ADMIN` (decisión de permisos arriba).
- Handler: mismo shape que `caja:registrarConsignacion` — `{ success: true }` /
  `{ success: false, error: error.message }`.
- Expuesto en `preload.js` como `window.api.caja.registrarRetiro(payload)`.

### UI — módulo de Caja

Botón "Registrar Retiro" junto a "Registrar Consignación", en el mismo toolbar de "Historial de
Movimientos" (visible para cualquier rol autenticado con permiso de escritura, sin gate de
`App.currentUser.rol === 'Administrador'`). Modal idéntico en estructura al de Consignación
(mismo `App.attachMoneyInput`/`App.parseMoneyValue`, mismo `App.protegerEnvioDoble` + `opId`),
con el texto de ayuda: *"Disminuye el saldo de Banco y aumenta el saldo de Caja por el mismo
monto."* Al confirmar: cierra el modal, refresca saldos y movimientos, muestra
`App.toast('Retiro registrado con éxito')`.

## Fuera de alcance

- No se toca `AsientoContableService`, `MotorContabilizacionService`, ninguna plantilla ni
  migración — el motor ya soporta esta dirección.
- No se agrega validación de período contable adicional — ya la hereda automáticamente
  `AsientoContableService.crear()` vía `validarFechaPermitida`, igual que Consignación.

## Testing

Tests unitarios de `CajaService.registrarRetiro` (mismo patrón que
`CajaService.regularizarSaldos.test.js` / lo ya probado para `registrarConsignacion`):
- Monto ≤ 0 → error.
- Fecha faltante → error.
- Monto mayor al saldo disponible en Banco → error.
- Caso feliz: crea el movimiento (`origen: 'Banco', destino: 'Caja'`) y el asiento contable
  correspondiente; verificar que el asiento generado debita Caja (110505) y acredita Banco
  (111005) por el monto correcto (mismo tipo de aserción de auditabilidad agregada a
  `regularizarSaldos` en la feature anterior).
- Verificar que `getSaldoCaja()` aumenta y `getSaldoBanco()` disminuye exactamente por el monto
  retirado, y que ambos libros (simple y doble partida) quedan conciliados
  (`verificarConciliacionCajaBanco()`).
