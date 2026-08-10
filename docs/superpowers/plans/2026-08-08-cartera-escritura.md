# Conectar la Escritura del Motor de Cartera — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `PagoService.registrarPagoSostenimiento` -- el único punto de entrada real para registrar un pago hoy -- escriba también en el motor de cartera nuevo (`cartera_movimientos` / `cartera_imputaciones`), en la MISMA transacción que sus escrituras de siempre, para que la pantalla de solo lectura "Cartera (nuevo modelo)" empiece a reflejar pagos reales en vez de solo los datos de la carga inicial.

**Architecture:** Doble escritura dentro de una sola transacción de better-sqlite3 (que soporta anidamiento vía SAVEPOINT). `PagoService` sigue siendo la única puerta de entrada para el operador y sigue escribiendo `pago_periodos`/`cuenta_creditos`/`movimientos`/asientos contables exactamente igual que hoy; al final de esa misma transacción llama a `CarteraService` para (1) causar los `CargoMensual` que falten hasta el mes pagado y (2) registrar el abono -- en efectivo y, si aplicó saldo a favor, también esa porción -- contra esos mismos meses. Si cualquier parte de cartera falla, TODA la transacción revierte: nunca puede quedar un recibo viejo sin su espejo nuevo, ni al revés.

**Tech Stack:** Electron 38, better-sqlite3 (síncrono), `node:test` + `node:assert/strict`. Sin dependencias nuevas.

**Spec:** [docs/superpowers/specs/2026-07-29-cartera-cuenta-corriente-design.md](../specs/2026-07-29-cartera-cuenta-corriente-design.md); motor construido en [2026-07-29-cartera-motor.md](2026-07-29-cartera-motor.md); carga inicial en [2026-07-30-cartera-carga-inicial.md](2026-07-30-cartera-carga-inicial.md).

**Fuera de alcance de este plan** (decisiones ya tomadas, no indecisión):

- **El abono a punto de conexión** (`abonoConexion`/`nuevoPuntoRepository` en `PagoService`). `nuevos_puntos`/`nuevo_punto_abonos` ya es una única tabla compartida por el modelo viejo y el nuevo -- no hay dos sistemas en paralelo ahí, así que no hay ninguna escritura que conectar.
- **Exponer por IPC los demás métodos de escritura de `CarteraService`** (`recategorizar`, `suspender`, `reactivar`, `ajustarDeuda`, `reclasificarAbono`, o `redimirCredito` como acción de pantalla independiente de un pago). Son acciones administrativas, no parte del flujo diario de `registrarPagoSostenimiento`. Próximo plan.
- **Refactor de `ReciboRepository.anular()`** para que reutilice `CarteraRepository`/`CarteraService` en vez de su SQL propio. Ya escribe correctamente en `cartera_movimientos`/`cartera_imputaciones` hoy (se agregó en el mismo commit que este motor, a propósito, para no dejar cartera desincronizada mientras no hubiera escritura nueva) -- solo duplica lógica. Limpieza, no una funcionalidad faltante.
- **Retirar `pago_periodos`/`PagoRepository`, o migrar `DashboardRepository`/`ReporteRepository`** a leer de `cartera_movimientos`. Eso es "apagar el sistema viejo" -- el tercer paso grande, no este.

## Global Constraints

- **Ejecutar tests:** `npm test`. Corre `scripts/test.js`, que lanza `electron --test` con `ELECTRON_RUN_AS_NODE=1`. **Nunca ejecutar `node --test` directamente**: `better-sqlite3` está compilado contra el ABI de Electron y falla con `NODE_MODULE_VERSION mismatch`.
- **Tests:** `node:test` + `node:assert/strict`. Base desechable con `crearDbTemporal()` / `cerrarDbTemporal(ctx)` de `src/testUtils/dbTemporal.js`, siempre en `try/finally`. Archivos `*.test.js` junto al código que prueban.
- **Fechas:** siempre strings `'YYYY-MM-DD'`. Nunca `new Date('2026-01-01')` para una fecha sin hora.
- **Dinero:** redondear con `redondear()` de `src/services/cartera/dinero.js`, comparar con `esMayor()`/`sonIguales()`, nunca `===` entre dos importes calculados.
- **Idioma:** identificadores, comentarios y mensajes de error en español, como el resto del proyecto.
- **Nunca silenciar una divergencia entre el modelo viejo y el nuevo.** Si `CarteraService.asegurarCausacion` no puede causar alguno de los meses que `PagoService` ya validó y va a cobrar, la transacción completa debe fallar con un error explícito -- no queda "cobrado en el viejo, sin reflejo en el nuevo" en silencio (ver Task 2, Step 3).
- **Sin dependencias nuevas.**

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/services/CarteraService.js` | Se agrega `aplicarCreditoAMeses(...)` (nuevo método, junto a `redimirCredito`) |
| `src/services/CarteraService.aplicarCredito.test.js` | Tests del método nuevo, aislado |
| `src/services/PagoService.js` | `registrarPagoSostenimiento` gana la doble escritura: causación + abono en efectivo + aplicación de crédito, todo dentro de su transacción existente |
| `src/services/PagoService.cartera.test.js` | Primeros tests de `PagoService` (hoy no tiene ninguno), acotados a esta integración |

---

### Task 1: `CarteraService.aplicarCreditoAMeses`

Aplica un saldo a favor -- ya validado por quien llama -- contra cargos elegidos, dejando el mismo rastro que `redimirCredito` (un `Abono` real en `cartera_movimientos` + sus `cartera_imputaciones` + una fila `'Aplicado'` en `cuenta_creditos`). Existe aparte de `redimirCredito` porque esa función es una ACCIÓN independiente de pantalla (el operador elige cuánto crédito redimir y contra qué); acá el destino (los meses del recibo que se está registrando en `PagoService`) ya está decidido, y el saldo disponible ya lo validó el llamador contra la MISMA tabla compartida `cuenta_creditos` (una sola tabla para los dos modelos, ver migración `041_credito_trazabilidad.sql`) -- no hace falta volver a consultarlo ni descontarlo dos veces.

**Files:**
- Modify: `src/services/CarteraService.js` (agregar método después de `redimirCredito`, línea ~224)
- Create: `src/services/CarteraService.aplicarCredito.test.js`

**Interfaces:**
- Consumes: `this.repository.getCargosPendientes(cuentaId, 1)`, `distribuir` / `MODOS.MESES_ESPECIFICOS` de `./cartera/imputacion`, `this.repository.crearMovimiento`, `this.repository.crearImputacion`, `this.repository.crearCredito` (todo ya existente, mismo patrón que `redimirCredito`).
- Produces: `aplicarCreditoAMeses({ cuentaId, monto, cargosElegidos, fecha, reciboDetalleId, usuarioId }) -> { abonoId: number, creditoId: number, aplicado: number, sobrante: number }`. Usado por Task 3.

- [ ] **Step 1: Write the failing test**

Crear `src/services/CarteraService.aplicarCredito.test.js`:

```js
// src/services/CarteraService.aplicarCredito.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');

function sembrarCartera(dbService) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Vereda Test')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;

  const service = new CarteraService(dbService);
  const cargos = [1, 2, 3].map(mes => service.repository.crearMovimiento({
    cuentaId, fecha: `2026-0${mes}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000,
    anio: 2026, mes
  }));
  return { cuentaId, service, cargos };
}

test('aplicarCreditoAMeses cubre exactamente los cargos elegidos y deja la traza en cuenta_creditos', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service, cargos } = sembrarCartera(ctx.dbService);

    const r = service.aplicarCreditoAMeses({
      cuentaId, monto: 20000, cargosElegidos: [cargos[0], cargos[1]], fecha: '2026-03-01'
    });

    assert.equal(r.aplicado, 20000);
    assert.equal(r.sobrante, 0);

    const estado = service.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaExigible, 10000, 'quedan 10.000 del tercer cargo, sin tocar');

    const creditos = service.repository.getCreditos(cuentaId);
    assert.equal(creditos.length, 1);
    assert.equal(creditos[0].tipo, 'Aplicado');
    assert.equal(creditos[0].monto, 20000);
    assert.equal(creditos[0].abono_movimiento_id, r.abonoId, 'debe apuntar al Abono real que dejó');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('aplicarCreditoAMeses solo imputa los cargos de la lista, aunque haya otros más viejos pendientes', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service, cargos } = sembrarCartera(ctx.dbService);

    // Elige el cargo de febrero (cargos[1]) sin tocar el de enero (cargos[0]), que es más
    // viejo -- esto es lo que un FIFO haría distinto y por lo que no se reutiliza AbonoDeudaFIFO.
    const r = service.aplicarCreditoAMeses({
      cuentaId, monto: 10000, cargosElegidos: [cargos[1]], fecha: '2026-03-01'
    });

    assert.equal(r.aplicado, 10000);
    const imputaciones = ctx.dbService.getDb()
      .prepare(`SELECT cargo_id FROM cartera_imputaciones WHERE abono_id = ?`).all(r.abonoId);
    assert.deepEqual(imputaciones.map(i => i.cargo_id), [cargos[1]]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('aplicarCreditoAMeses exige al menos un cargo elegido', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    assert.throws(
      () => service.aplicarCreditoAMeses({ cuentaId, monto: 10000, cargosElegidos: [], fecha: '2026-03-01' }),
      /Debe elegir al menos un mes/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('aplicarCreditoAMeses falla si los cargos elegidos ya no tienen nada pendiente', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service, cargos } = sembrarCartera(ctx.dbService);
    service.aplicarCreditoAMeses({ cuentaId, monto: 10000, cargosElegidos: [cargos[0]], fecha: '2026-01-01' });

    assert.throws(
      () => service.aplicarCreditoAMeses({ cuentaId, monto: 5000, cargosElegidos: [cargos[0]], fecha: '2026-02-01' }),
      /no tienen deuda pendiente/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL con `service.aplicarCreditoAMeses is not a function`.

- [ ] **Step 3: Write the implementation**

En `src/services/CarteraService.js`, agregar inmediatamente después del cierre de `redimirCredito` (después de la línea 224, antes del comentario de `calcularAPagar`):

```js
  // Aplica un saldo a favor YA VALIDADO por el llamador contra cargos elegidos: deja el mismo
  // rastro que redimirCredito (un Abono real + sus imputaciones + una fila 'Aplicado' en
  // cuenta_creditos), pero sin volver a consultar/descontar el saldo disponible -- quien llama
  // (PagoService.registrarPagoSostenimiento) ya lo hizo contra la MISMA tabla compartida
  // (cuenta_creditos no tiene una copia por modelo, ver migración 041). A diferencia de
  // redimirCredito (una acción de pantalla donde el operador elige cuánto redimir y el sistema
  // decide contra qué por FIFO), acá el destino ya está decidido: los meses de este recibo.
  aplicarCreditoAMeses({ cuentaId, monto, cargosElegidos, fecha, reciboDetalleId = null, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!fecha) throw new Error('La fecha es obligatoria');
    if (!(Number(monto) > 0)) throw new Error('El monto a aplicar debe ser mayor a cero');
    if (!cargosElegidos || cargosElegidos.length === 0) {
      throw new Error('Debe elegir al menos un mes contra el cual aplicar el crédito');
    }

    return this.repository.transaccion(() => {
      const cargos = this.repository.getCargosPendientes(cuentaId, 1);
      const { imputaciones } = distribuir({ modo: MODOS.MESES_ESPECIFICOS, cargos, monto, cargosElegidos });
      const imputado = redondear(imputaciones.reduce((s, i) => s + i.monto, 0));

      if (!esMayor(imputado, 0)) {
        throw new Error('Los meses elegidos no tienen deuda pendiente contra la cual aplicar este crédito');
      }

      const abonoId = this.repository.crearMovimiento({
        cuentaId, fecha, tipo: 'Abono', exigible: 1, monto: -imputado, reciboDetalleId, usuarioId
      });
      for (const imp of imputaciones) {
        this.repository.crearImputacion({ abonoId, cargoId: imp.cargoId, monto: imp.monto });
      }

      const creditoId = this.repository.crearCredito({
        cuentaId, tipo: 'Aplicado', monto: imputado, fecha, reciboDetalleId, abonoMovimientoId: abonoId
      });

      return { abonoId, creditoId, aplicado: imputado, sobrante: redondear(monto - imputado) };
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 4 tests de `CarteraService.aplicarCredito.test.js` pasan, y el resto de la suite sigue en verde.

- [ ] **Step 5: Commit**

```bash
git add src/services/CarteraService.js src/services/CarteraService.aplicarCredito.test.js
git commit -m "feat(cartera): aplicarCreditoAMeses, para aplicar saldo a favor ya validado por el llamador"
```

---

### Task 2: `PagoService` — causar y registrar el abono en efectivo en el motor nuevo

**Files:**
- Modify: `src/services/PagoService.js`
- Create: `src/services/PagoService.cartera.test.js`

**Interfaces:**
- Consumes: `CarteraService` (`asegurarCausacion`, `registrarAbono`, `repository.getCargosPendientes`), `MODOS` de `./cartera/imputacion`.
- Produces: nada nuevo hacia afuera -- `registrarPagoSostenimiento` sigue devolviendo lo mismo (`{ reciboId, numeroRecibo, total, creditoAplicado, estadoConexion }`); el efecto nuevo es interno (filas en `cartera_movimientos`/`cartera_imputaciones`).

- [ ] **Step 1: Write the failing test**

Crear `src/services/PagoService.cartera.test.js`. Necesita sembrar el esquema VIEJO completo (cuenta + propietario + categoría + tarifa), porque `PagoService` no tiene ningún test hoy:

```js
// src/services/PagoService.cartera.test.js
//
// Primeros tests de PagoService (no tenía ninguno). Acotados a la integración con el motor de
// cartera nuevo -- no cubren el resto de registrarPagoSostenimiento (eso es trabajo aparte,
// fuera de este plan).
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const PagoService = require('./PagoService');
const CarteraService = require('./CarteraService');

function sembrarCuentaPagable(db, { codigo = 'T001', tarifa = 10000, fechaCategoria = '2026-01-01' } = {}) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;

  const propietarioId = db.prepare(
    `INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test')`
  ).run().lastInsertRowid;
  db.prepare(
    `INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, ?)`
  ).run(cuentaId, propietarioId, fechaCategoria);

  const categoriaId = db.prepare(
    `INSERT INTO categorias (nombre) VALUES ('Finca Test')`
  ).run().lastInsertRowid;
  db.prepare(
    `INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde) VALUES (?, ?, ?)`
  ).run(categoriaId, tarifa, fechaCategoria);
  db.prepare(
    `INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio) VALUES (?, ?, ?)`
  ).run(cuentaId, categoriaId, fechaCategoria);

  return cuentaId;
}

test('registrarPagoSostenimiento en efectivo causa y abona los mismos meses en cartera_movimientos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000 });
    const pagoService = new PagoService(ctx.dbService);
    const carteraService = new CarteraService(ctx.dbService);

    const r = pagoService.registrarPagoSostenimiento({
      cuentaId, anioInicio: 2026, mesInicio: 1, cantidadMeses: 3,
      fechaPago: '2026-04-01', metodoPago: 'Efectivo', usarSaldoAFavor: false
    });

    assert.equal(r.total, 30000);

    const estado = carteraService.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaExigible, 0, 'los 3 meses quedan cubiertos en el motor nuevo también');
    assert.deepEqual(estado.cubiertoHasta, { anio: 2026, mes: 3 });

    const cargos = db.prepare(
      `SELECT anio, mes, monto FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'CargoMensual' ORDER BY mes`
    ).all(cuentaId);
    assert.equal(cargos.length, 3);
    assert.ok(cargos.every(c => c.monto === 10000));

    const abono = db.prepare(
      `SELECT monto, recibo_detalle_id FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'Abono'`
    ).get(cuentaId);
    assert.equal(abono.monto, -30000);
    assert.ok(abono.recibo_detalle_id, 'debe quedar atado al recibo_detalle del recibo viejo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarPagoSostenimiento no toca pago_periodos ni cuenta_creditos si el motor de cartera falla', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    // Tarifa vigente SOLO desde marzo -- construirPeriodos (el viejo) igual la usaría para
    // enero/febrero porque busca "la más reciente <= ese mes", así que esto no basta para
    // reproducir un desacuerdo real entre los dos validadores hoy; se deja como regresión de
    // atomicidad: si asegurarCausacion llegara a fallar por cualquier motivo futuro, nada del
    // recibo viejo debe quedar escrito.
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000, fechaCategoria: '2026-01-01' });
    const pagoService = new PagoService(ctx.dbService);

    // Fuerza el fallo: deja la cuenta Suspendida en cuenta_estados desde antes del período pagado
    // -- asegurarCausacion la respeta, construirPeriodos (viejo) no la conoce en absoluto.
    db.prepare(`
      INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio) VALUES (?, 'Suspendido', '2025-01-01')
    `).run(cuentaId);

    assert.throws(
      () => pagoService.registrarPagoSostenimiento({
        cuentaId, anioInicio: 2026, mesInicio: 1, cantidadMeses: 1,
        fechaPago: '2026-04-01', metodoPago: 'Efectivo', usarSaldoAFavor: false
      }),
      /motor de cartera/
    );

    assert.equal(db.prepare(`SELECT COUNT(*) n FROM recibos`).get().n, 0, 'la transacción completa debe revertir');
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM pago_periodos`).get().n, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: el primer test falla porque `cartera_movimientos` queda vacío (`estado.deudaExigible` es `0` por default de una cuenta sin nada, no por estar cubierta -- revisar que el assert de `cargos.length === 3` sea el que realmente falla). El segundo falla porque no hay ningún throw (`registrarPagoSostenimiento` hoy ignora `cuenta_estados` por completo).

- [ ] **Step 3: Write the implementation**

En `src/services/PagoService.js`, agregar el import y la instancia (junto a los demás, líneas 1-7 y 55-62):

```js
const CarteraService = require('./CarteraService');
const { MODOS } = require('./cartera/imputacion');
```

```js
  constructor(dbService) {
    this.repository = new PagoRepository(dbService);
    this.cuentaRepository = new CuentaRepository(dbService);
    this.propietarioRepository = new PropietarioRepository(dbService);
    this.nuevoPuntoRepository = new NuevoPuntoRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
    this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService), dbService);
    this.carteraService = new CarteraService(dbService);
  }
```

Dentro de `registrarPagoSostenimiento`, en la transacción (reemplazar el bloque desde `const grupos = this.agruparPeriodos(periodos);` hasta justo antes de `if (creditoAplicado > 0) {`):

```js
      const grupos = this.agruparPeriodos(periodos);
      let primerDetalleId = null;
      for (const grupo of grupos) {
        const primero = grupo.periodos[0];
        const ultimo = grupo.periodos[grupo.periodos.length - 1];
        const concepto = grupo.periodos.length > 1
          ? `Sostenimiento ${this.formatPeriodo(primero.anio, primero.mes)} - ${this.formatPeriodo(ultimo.anio, ultimo.mes)}`
          : `Sostenimiento ${this.formatPeriodo(primero.anio, primero.mes)}`;

        const detalleId = this.repository.crearReciboDetalle({
          reciboId,
          concepto,
          periodoDesde: this.formatPeriodo(primero.anio, primero.mes),
          periodoHasta: this.formatPeriodo(ultimo.anio, ultimo.mes),
          valor: grupo.valor
        });
        if (primerDetalleId === null) primerDetalleId = detalleId;

        for (const periodo of grupo.periodos) {
          this.repository.crearPeriodoPago(cuentaId, periodo.anio, periodo.mes, periodo.valor, detalleId, fechaPago);
        }
      }

      // Espejo en el motor de cartera nuevo: causar los meses que falten y abonarlos con la
      // porción en efectivo de este pago. MesesEspecificos (no FIFO) porque el operador ya
      // decidió, con anioInicio/mesInicio/cantidadMeses, exactamente qué meses cubre este recibo
      // -- igual criterio que ya usa paso10-imputacion.js para los recibos con período declarado.
      const ultimoPeriodo = periodos[periodos.length - 1];
      const resultadoCausacion = this.carteraService.asegurarCausacion(cuentaId, ultimoPeriodo.anio, ultimoPeriodo.mes);
      if (resultadoCausacion.omitidos.length > 0) {
        throw new Error(
          'No se pudo causar en el motor de cartera: ' +
          resultadoCausacion.omitidos.map(o => `${o.anio}-${o.mes}: ${o.motivo}`).join('; ')
        );
      }

      const cargosPendientesCartera = this.carteraService.repository.getCargosPendientes(cuentaId, 1);
      const cargosDeEstePago = cargosPendientesCartera
        .filter(c => periodos.some(p => p.anio === c.anio && p.mes === c.mes))
        .map(c => c.id);

      const montoEfectivoSostenimiento = totalACobrar - abonoConexion;
      if (montoEfectivoSostenimiento > 0 && cargosDeEstePago.length > 0) {
        this.carteraService.registrarAbono({
          cuentaId, fecha: fechaPago, monto: montoEfectivoSostenimiento,
          modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: cargosDeEstePago,
          reciboDetalleId: primerDetalleId, usuarioId
        });
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 2 tests de `PagoService.cartera.test.js` pasan. Correr la suite completa para confirmar que ningún test existente que ejercite `registrarPagoSostenimiento` (buscar con `grep -rl registrarPagoSostenimiento src`) se rompió.

- [ ] **Step 5: Commit**

```bash
git add src/services/PagoService.js src/services/PagoService.cartera.test.js
git commit -m "feat(cartera): PagoService causa y abona en el motor nuevo la porción en efectivo"
```

---

### Task 3: `PagoService` — aplicar la porción de crédito en el motor nuevo

**Files:**
- Modify: `src/services/PagoService.js`
- Modify: `src/services/PagoService.cartera.test.js`

**Interfaces:**
- Consumes: `CarteraService.aplicarCreditoAMeses` (Task 1).

- [ ] **Step 1: Write the failing test**

Agregar a `src/services/PagoService.cartera.test.js`:

```js
test('registrarPagoSostenimiento con saldo a favor aplica esa porción también en cartera_movimientos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuentaPagable(db, { tarifa: 10000 });
    const pagoService = new PagoService(ctx.dbService);
    const carteraService = new CarteraService(ctx.dbService);

    // Deja 15.000 de saldo a favor en cuenta_creditos -- misma tabla que usa PagoRepository.getSaldoCredito.
    db.prepare(
      `INSERT INTO cuenta_creditos (cuenta_id, tipo, monto, fecha) VALUES (?, 'Abono', 15000, '2026-01-01')`
    ).run(cuentaId);

    const r = pagoService.registrarPagoSostenimiento({
      cuentaId, anioInicio: 2026, mesInicio: 1, cantidadMeses: 2,
      fechaPago: '2026-04-01', metodoPago: 'Efectivo', usarSaldoAFavor: true
    });

    assert.equal(r.creditoAplicado, 15000);
    assert.equal(r.total, 5000, '20.000 de sostenimiento menos 15.000 de crédito');

    const estado = carteraService.getEstadoCartera(cuentaId);
    assert.equal(estado.deudaExigible, 0, 'los 2 meses quedan cubiertos: 5.000 en efectivo + 15.000 de crédito');
    assert.equal(estado.saldoCreditoDisponible, 0);

    const abonos = db.prepare(
      `SELECT monto FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'Abono' ORDER BY id`
    ).all(cuentaId);
    assert.equal(abonos.length, 2, 'un Abono por la porción en efectivo y otro por la porción de crédito');
    assert.deepEqual(abonos.map(a => a.monto).sort((a, b) => a - b), [-15000, -5000]);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL -- `cartera_movimientos` no tiene ningún `Abono` por la porción de crédito todavía (`abonos.length` da 1, no 2).

- [ ] **Step 3: Write the implementation**

En `src/services/PagoService.js`, reemplazar la línea que llama al viejo `crearMovimientoCredito` dentro del bloque `if (creditoAplicado > 0)`:

```js
      if (creditoAplicado > 0) {
        const detalleCreditoId = this.repository.crearReciboDetalle({
          reciboId,
          concepto: 'Aplicación de saldo a favor',
          valor: -creditoAplicado,
          tipoConceptoContable: 'AplicacionSaldoFavor'
        });
        // Reemplaza el crearMovimientoCredito('Aplicado', ...) que había antes: cuenta_creditos
        // es la MISMA tabla para los dos modelos (migración 041), así que esto no descuenta el
        // saldo dos veces -- lo descuenta igual, pero además deja la imputación contra los
        // cargos reales de cartera_movimientos, que antes no quedaba en ningún lado.
        this.carteraService.aplicarCreditoAMeses({
          cuentaId, monto: creditoAplicado, cargosElegidos: cargosDeEstePago,
          fecha: fechaPago, reciboDetalleId: detalleCreditoId, usuarioId
        });
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 3 tests de `PagoService.cartera.test.js` pasan, y la suite completa sigue en verde.

- [ ] **Step 5: Commit**

```bash
git add src/services/PagoService.js src/services/PagoService.cartera.test.js
git commit -m "feat(cartera): PagoService aplica la porción de crédito también en el motor nuevo"
```

---

### Task 4: Verificación manual en la app

No es código -- es la confirmación de que las dos escrituras se ven juntas donde un operador realmente las usaría, algo que los tests unitarios de las tareas 1-3 no prueban (ellos no pasan por IPC ni por la UI).

- [ ] **Step 1: Levantar la app**

Run: `npm start`

- [ ] **Step 2: Registrar un pago de sostenimiento real sobre una cuenta de prueba**

En el módulo de Pagos, elegir una cuenta, registrar sostenimiento de 1-2 meses, método Efectivo, sin saldo a favor. Confirmar que el recibo se genera igual que siempre (mismo comportamiento visible de hoy).

- [ ] **Step 3: Abrir la pantalla "Cartera (nuevo modelo)" de esa misma cuenta**

Confirmar que:
- `Último mes cubierto` avanzó hasta el mes que se acaba de pagar.
- `A pagar` bajó en el monto correspondiente.
- Los otros tres avisos (deuda anterior al corte, punto de conexión, saldo a favor) no cambiaron -- este pago no debía tocarlos.

- [ ] **Step 4: Repetir con un pago que use saldo a favor**

Sobre una cuenta con crédito disponible (o crear uno desde `cuenta_creditos` a mano para la prueba), registrar un pago que lo use (`usarSaldoAFavor: true`, ya es el default en la UI). Confirmar en la pantalla de cartera que `Saldo a favor disponible` bajó y `A pagar` reflejó la cobertura combinada (efectivo + crédito).

- [ ] **Step 5: Confirmar que nada del módulo viejo cambió de comportamiento**

Revisar que el recibo impreso, el historial de pagos, el estado de cuenta viejo y los asientos contables se ven exactamente igual que antes de este plan -- la doble escritura es aditiva, no debe alterar ninguna pantalla existente.

No hay commit en esta tarea (no se toca código).

---

## Self-Review

- **Cobertura del alcance declarado:** causación (Task 2), abono en efectivo (Task 2), aplicación de crédito (Task 3), verificación end-to-end (Task 4). El abono a punto de conexión, los demás métodos de escritura de `CarteraService`, el refactor de `ReciboRepository.anular()` y el retiro del modelo viejo quedan explícitamente fuera (sección de alcance arriba) -- no son un olvido.
- **Atomicidad:** las tres tareas dependen de que `CarteraService`/`CarteraRepository` usen `this.db.transaction(...)`, que better-sqlite3 anida vía SAVEPOINT dentro de la transacción ya abierta por `PagoRepository.transaccion` en `registrarPagoSostenimiento` -- una falla en cualquier punto revierte TODO, incluido el recibo viejo. El test 2 de la Task 2 verifica esto directamente.
- **Sin silenciar divergencias:** si `asegurarCausacion` no logra causar algún mes que `PagoService` ya se comprometió a cobrar, se lanza un error explícito en vez de dejar el modelo nuevo incompleto (Task 2, Step 3) -- coherente con la regla ya usada en `calcularAPagar`/`mesesSinTarifa` de no dejar pasar una brecha sin avisar.
