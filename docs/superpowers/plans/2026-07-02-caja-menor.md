# Caja Menor (Fondo de Caja Menor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `1105 Caja` into `110505 Caja General` / `110510 Caja Menor`, let Gastos in efectivo choose which one they came from, add a saldo-objetivo/responsable/reembolso workflow for Caja Menor, and fix a pre-existing bug where `BANCO` and `CARTERA_USUARIOS` point at grouping (non-imputable) accounts.

**Architecture:** Extends the existing Motor de Contabilización (plantillas de asiento, cuentas automáticas, mapeo de conceptos) rather than building a parallel system. The Caja Menor reembolso bypasses the plantilla/`movimientos` simple-ledger machinery entirely (see Task 7) because it is an internal Caja→Caja transfer that must not touch the Dashboard's "Saldo en Caja" figure.

**Tech Stack:** Electron + better-sqlite3 (synchronous SQLite), vanilla JS renderer (no framework), no automated test runner in this repo (no jest/mocha) — verification is done via small Node scripts run through `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd <script>` (required because `better-sqlite3` is built against Electron's Node ABI) plus manual UI checks in the running app.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-caja-menor-design.md` — every task below implements a section of it; read it first if anything here is ambiguous.
- No automated test framework exists in this repo. Every backend task ends with a Node verification script (see Task 1 for the reusable pattern), not a `jest`/`mocha` test file. Do not add a test framework as part of this work — out of scope.
- Renderer→backend payload fields are **camelCase** (`fechaGasto`, `metodoPago`); DB columns and the asiento-motor "contexto" object are **snake_case** (`fecha_gasto`, `metodo_pago`). Keep this split consistent in every new field added.
- IPC channel prefix for configuration is **`config:`**, not `configuracion:`.
- `git commit` after every task (see step template). Do not `push` until Task 12 (final verification) passes — the user asked to push once everything is implemented and tested, not per-task.
- The live database is `C:\Users\Brayhan\Documents\softwareAcueducto\data\acueducto.db`. Migrations apply automatically on next app start, but every task's verification script applies pending migrations explicitly via `DatabaseService.initialize()` (same pattern used to apply migration 028 earlier in this project) so you don't have to launch the full Electron UI to verify backend tasks.

---

## Task 1: Migration 029 — accounts, cuentas automáticas fix, Caja Menor tables/config, plantilla v2

**Files:**
- Create: `src/database/migrations/029_caja_menor_y_fix_cuentas_agrupacion.sql`
- Test: ad-hoc Node script in the scratchpad directory (not part of the repo)

**Interfaces:**
- Produces: accounts `110505` (Caja General), `110510` (Caja Menor) under `1105`; `cuentas_automaticas` rows `CAJA→110505`, `BANCO→111005`, `CARTERA_USUARIOS→130505`; `mapeo_conceptos_contables` rows `(Movimiento,Caja)→110505`, `(Movimiento,Banco)→111005`, `(RecibosDetalle,AplicacionSaldoFavor)→130505`, `(RecibosDetalle,AbonoSaldoFavor)→130505`; table `caja_menor_responsables(id, tercero_id, fecha_inicio, fecha_fin, observaciones, fecha_creacion)`; `configuracion` rows `caja_menor_activa='false'`, `caja_menor_saldo_objetivo='0'`; `gastos.caja_efectivo_id` column; `plantillas_contabilizacion` row `GASTO_EFECTIVO` version 2 (with its 2 `plantillas_lineas`), v1 closed via `fecha_hasta`.
- Consumes: nothing (first task).

- [ ] **Step 1: Write the migration file**

```sql
-- 029_caja_menor_y_fix_cuentas_agrupacion.sql
-- Separa 1105 Caja en Caja General / Caja Menor (para poder responder "cuánto se gastó por
-- Caja Menor", "quién es el responsable", "cuánto debería haber físicamente"), y de paso corrige
-- un bug preexistente: BANCO y CARTERA_USUARIOS (en cuentas_automaticas) y varios mapeos en
-- mapeo_conceptos_contables apuntan a cuentas de agrupación (1110, 1305), lo que hace fallar
-- AsientoContableService.crear() ("cuenta de agrupación, no admite movimientos directos") para
-- cualquier Gasto/Recibo pagado por Banco o cualquier aplicación de saldo a favor.

-- ============================================
-- 1. Split de Caja
-- ============================================
INSERT INTO plan_cuentas (codigo, nombre, tipo, naturaleza, nivel, padre_id) VALUES
  ('110505', 'Caja General', 'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1105')),
  ('110510', 'Caja Menor',   'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1105'));

-- ============================================
-- 2. Reasignar cuentas automáticas a subcuentas hoja
-- ============================================
UPDATE cuentas_automaticas SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '110505'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE clave = 'CAJA';
UPDATE cuentas_automaticas SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '111005'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE clave = 'BANCO';
UPDATE cuentas_automaticas SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '130505'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE clave = 'CARTERA_USUARIOS';

-- ============================================
-- 3. Reasignar mapeos de conceptos a subcuentas hoja
-- ============================================
UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '110505'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE modulo = 'Movimiento' AND concepto = 'Caja';
UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '111005'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE modulo = 'Movimiento' AND concepto = 'Banco';
UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '130505'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE modulo = 'RecibosDetalle' AND concepto = 'AplicacionSaldoFavor';
UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '130505'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE modulo = 'RecibosDetalle' AND concepto = 'AbonoSaldoFavor';

-- ============================================
-- 4. Configuración y responsable de Caja Menor
-- ============================================
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('caja_menor_activa', 'false', 'Si está en "true", habilita el selector de Caja Menor en Gastos y la tarjeta de Caja Menor en la pantalla de Caja.'),
  ('caja_menor_saldo_objetivo', '0', 'Monto al que se repone la Caja Menor al reembolsar. Editable libremente, no es un fondo fijo inmutable.');

CREATE TABLE caja_menor_responsables (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tercero_id     INTEGER NOT NULL REFERENCES terceros(id),
  fecha_inicio   DATE NOT NULL,
  fecha_fin      DATE,              -- NULL = responsable actual
  observaciones  TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_caja_menor_responsables_actual ON caja_menor_responsables(fecha_fin);

-- ============================================
-- 5. Columna de Gastos para saber de cuál caja salió el efectivo
-- ============================================
ALTER TABLE gastos ADD COLUMN caja_efectivo_id INTEGER REFERENCES plan_cuentas(id);

-- ============================================
-- 6. Versionar GASTO_EFECTIVO a v2: la línea de crédito deja de ser la automática CAJA fija y
-- pasa a resolverse desde gastos.caja_efectivo_id (ya completado en Caja General o Caja Menor
-- al crear el gasto). v1 se cierra (fecha_hasta) y sigue vigente para fechas anteriores a hoy.
-- ============================================
UPDATE plantillas_contabilizacion
SET fecha_hasta = date('now', '-1 day'), fecha_actualizacion = CURRENT_TIMESTAMP
WHERE codigo = 'GASTO_EFECTIVO' AND version = 1 AND fecha_hasta IS NULL;

INSERT INTO plantillas_contabilizacion (codigo, version, nombre, descripcion, modulo, subtipo, fecha_desde, activo, es_sistema) VALUES
  ('GASTO_EFECTIVO', 2, 'Gasto pagado en Efectivo (Caja General o Caja Menor)', 'Débito a cuenta de gasto, crédito a la subcuenta de efectivo elegida al registrar el gasto', 'Gasto', 'Efectivo', date('now'), 1, 1);

INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_contexto_campo, tipo_monto, monto_campo, lado, incluir_tercero_id, incluir_snapshot_nombre, descripcion_linea)
  VALUES ((SELECT id FROM plantillas_contabilizacion WHERE codigo = 'GASTO_EFECTIVO' AND version = 2), 1, 'cuenta_contable_id', 'Campo', 'valor', 'Debito', 1, 1, 'Cuenta del tipo de gasto');
INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_contexto_campo, tipo_monto, monto_campo, lado, descripcion_linea)
  VALUES ((SELECT id FROM plantillas_contabilizacion WHERE codigo = 'GASTO_EFECTIVO' AND version = 2), 2, 'caja_efectivo_id', 'Campo', 'valor', 'Credito', 'Salida de Caja General o Caja Menor');
```

- [ ] **Step 2: Apply the migration and verify with a Node script**

Create `C:\Users\Brayhan\AppData\Local\Temp\claude\c--Users-Brayhan-Documents-softwareAcueducto\580e22ab-1ee3-4c4f-9c75-06937555aa0a\scratchpad\verify_029.js` (adjust the temp path to your own session's scratchpad if different):

```js
const path = require('path');
const projectDir = 'C:\\Users\\Brayhan\\Documents\\softwareAcueducto';
const DatabaseService = require(path.join(projectDir, 'src', 'database', 'DatabaseService'));
const svc = new DatabaseService(projectDir);
svc.initialize();

const cuentas = svc.db.prepare("SELECT codigo, nombre, padre_id FROM plan_cuentas WHERE codigo IN ('1105','110505','110510') ORDER BY codigo").all();
console.log('Cuentas:', JSON.stringify(cuentas, null, 2));

const automaticas = svc.db.prepare(`
  SELECT ca.clave, pc.codigo FROM cuentas_automaticas ca JOIN plan_cuentas pc ON pc.id = ca.cuenta_contable_id
`).all();
console.log('Automaticas:', JSON.stringify(automaticas, null, 2));

function tieneHijos(codigo) {
  const row = svc.db.prepare('SELECT id FROM plan_cuentas WHERE codigo = ?').get(codigo);
  const r = svc.db.prepare('SELECT COUNT(*) c FROM plan_cuentas WHERE padre_id = ?').get(row.id);
  return r.c > 0;
}
console.log('BANCO (111005) tieneHijos:', tieneHijos('111005'), '- debe ser false');
console.log('CARTERA_USUARIOS (130505) tieneHijos:', tieneHijos('130505'), '- debe ser false');

const config = svc.db.prepare("SELECT clave, valor FROM configuracion WHERE clave LIKE 'caja_menor%'").all();
console.log('Config:', JSON.stringify(config, null, 2));

const plantillas = svc.db.prepare("SELECT id, version, fecha_desde, fecha_hasta FROM plantillas_contabilizacion WHERE codigo = 'GASTO_EFECTIVO' ORDER BY version").all();
console.log('Plantillas GASTO_EFECTIVO:', JSON.stringify(plantillas, null, 2));

const lineasV2 = svc.db.prepare(`
  SELECT orden, cuenta_contexto_campo, lado FROM plantillas_lineas WHERE plantilla_id = (SELECT id FROM plantillas_contabilizacion WHERE codigo='GASTO_EFECTIVO' AND version=2) ORDER BY orden
`).all();
console.log('Lineas v2:', JSON.stringify(lineasV2, null, 2));

const tablaResponsables = svc.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='caja_menor_responsables'").get();
console.log('Tabla caja_menor_responsables existe:', !!tablaResponsables);

svc.db.close();
```

Run: `cd "C:/Users/Brayhan/Documents/softwareAcueducto" && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron.cmd "<ruta al script>"`

Expected output:
- `Cuentas`: 3 rows — `1105` with some `padre_id`, `110505`/`110510` both with `padre_id` equal to `1105`'s row id.
- `Automaticas`: `CAJA→110505`, `BANCO→111005`, `CARTERA_USUARIOS→130505`.
- Both `tieneHijos` checks print `false`.
- `Config`: two rows, `caja_menor_activa=false`, `caja_menor_saldo_objetivo=0`.
- `Plantillas GASTO_EFECTIVO`: version 1 with a non-null `fecha_hasta` (yesterday's date), version 2 with `fecha_hasta = null` and `fecha_desde` = today.
- `Lineas v2`: 2 rows, `cuenta_contexto_campo` = `cuenta_contable_id` (Debito) and `caja_efectivo_id` (Credito).
- `Tabla caja_menor_responsables existe: true`.

If any value doesn't match, fix the migration SQL and re-run — do NOT hand-patch the live DB directly; the migration must be correct since it will also run on every other install.

- [ ] **Step 3: Commit**

```bash
git add src/database/migrations/029_caja_menor_y_fix_cuentas_agrupacion.sql
git commit -m "$(cat <<'EOF'
Separar Caja en General/Menor y corregir automaticas BANCO/CARTERA_USUARIOS mal apuntadas

BANCO y CARTERA_USUARIOS apuntaban a cuentas de agrupacion (1110, 1305),
lo que hacia fallar la generacion del asiento contable para cualquier
Gasto/Recibo por Banco o aplicacion de saldo a favor. Se reasignan a
subcuentas hoja. De paso se crea 110505 Caja General / 110510 Caja Menor
y se prepara la version 2 de la plantilla GASTO_EFECTIVO.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `AsientoContableRepository` + `AsientoContableService` — expose `caja_efectivo_id`, allow opting out of ledger sync

**Files:**
- Modify: `src/repositories/AsientoContableRepository.js` (`obtenerGastoParaAsiento`, around line 20-30)
- Modify: `src/services/AsientoContableService.js` (`crearManual`, around line 279-281)

**Interfaces:**
- Consumes: nothing new from earlier tasks.
- Produces: `obtenerGastoParaAsiento(gastoId)` now returns a `caja_efectivo_id` field; `crearManual({ fecha, concepto, tipoComprobante, lineas, usuarioId, sincronizarLedgerSimple })` — new optional param, default `true` (unchanged default behavior for existing callers).

- [ ] **Step 1: Add `caja_efectivo_id` to the gasto→asiento query**

In `src/repositories/AsientoContableRepository.js`, find:

```js
  obtenerGastoParaAsiento(gastoId) {
    return this.db.prepare(`
      SELECT g.id, g.fecha_gasto as fecha, g.concepto, g.valor, g.metodo_pago, g.cuenta_contable_id,
        g.tercero_id,
        COALESCE(t.nombre_razon_social, g.proveedor) as tercero_nombre,
        COALESCE(t.numero_identificacion, g.nit_cedula) as tercero_identificacion
      FROM gastos g
      LEFT JOIN terceros t ON t.id = g.tercero_id
      WHERE g.id = ?
    `).get(gastoId);
  }
```

Replace with:

```js
  obtenerGastoParaAsiento(gastoId) {
    return this.db.prepare(`
      SELECT g.id, g.fecha_gasto as fecha, g.concepto, g.valor, g.metodo_pago, g.cuenta_contable_id,
        g.caja_efectivo_id, g.tercero_id,
        COALESCE(t.nombre_razon_social, g.proveedor) as tercero_nombre,
        COALESCE(t.numero_identificacion, g.nit_cedula) as tercero_identificacion
      FROM gastos g
      LEFT JOIN terceros t ON t.id = g.tercero_id
      WHERE g.id = ?
    `).get(gastoId);
  }
```

- [ ] **Step 2: Let `crearManual` opt out of ledger sync**

In `src/services/AsientoContableService.js`, find:

```js
  crearManual({ fecha, concepto, tipoComprobante = 'Asiento Contable', lineas, usuarioId = null }) {
    return this.crear({ fecha, concepto, tipoOrigen: 'Manual', tipoComprobante, usuarioId, lineas, sincronizarLedgerSimple: true });
  }
```

Replace with:

```js
  crearManual({ fecha, concepto, tipoComprobante = 'Asiento Contable', lineas, usuarioId = null, sincronizarLedgerSimple = true }) {
    return this.crear({ fecha, concepto, tipoOrigen: 'Manual', tipoComprobante, usuarioId, lineas, sincronizarLedgerSimple });
  }
```

- [ ] **Step 3: Verify with a Node script**

```js
const path = require('path');
const projectDir = 'C:\\Users\\Brayhan\\Documents\\softwareAcueducto';
const DatabaseService = require(path.join(projectDir, 'src', 'database', 'DatabaseService'));
const AsientoContableService = require(path.join(projectDir, 'src', 'services', 'AsientoContableService'));
const svc = new DatabaseService(projectDir);
svc.initialize();

const asientos = new AsientoContableService(svc);

// crearManual sin sincronizarLedgerSimple no debe insertar en `movimientos`
const antes = svc.db.prepare('SELECT COUNT(*) c FROM movimientos').get().c;
const cajaGeneral = svc.db.prepare("SELECT id FROM plan_cuentas WHERE codigo='110505'").get();
const cajaMenor = svc.db.prepare("SELECT id FROM plan_cuentas WHERE codigo='110510'").get();

const asientoId = asientos.crearManual({
  fecha: new Date().toISOString().split('T')[0],
  concepto: 'Prueba plan Task 2 - no debe afectar movimientos',
  lineas: [
    { cuentaContableId: cajaMenor.id, debito: 1000 },
    { cuentaContableId: cajaGeneral.id, credito: 1000 }
  ],
  sincronizarLedgerSimple: false
});
const despues = svc.db.prepare('SELECT COUNT(*) c FROM movimientos').get().c;
console.log('asientoId:', asientoId, '- movimientos antes/despues:', antes, despues, '(deben ser iguales)');

// limpieza: revertir el asiento de prueba para no dejar basura contable
asientos.revertir(asientoId, 'Limpieza de verificacion Task 2');
svc.db.close();
```

Expected: `asientoId` es un número, y `movimientos antes/despues` son iguales (el conteo NO cambió).

- [ ] **Step 4: Commit**

```bash
git add src/repositories/AsientoContableRepository.js src/services/AsientoContableService.js
git commit -m "$(cat <<'EOF'
Exponer caja_efectivo_id en el contexto de asiento de Gasto y permitir asientos manuales sin sincronizar el ledger simple

Necesario para que un traslado interno Caja General <-> Caja Menor (que no
cambia el efectivo total) no genere una fila fantasma en `movimientos`.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `GastoRepository` — persist `caja_efectivo_id`

**Files:**
- Modify: `src/repositories/GastoRepository.js` (`create`, around line 156-176)

**Interfaces:**
- Consumes: nothing new.
- Produces: `create(gasto)` now also accepts `gasto.cajaEfectivoId` (nullable integer) and persists it.

- [ ] **Step 1: Update the INSERT**

Find:

```js
  create(gasto) {
    const cuentaContableId = this.resolverCuentaContable('Gasto', gasto.tipoGasto || '__default__');

    const result = this.db.prepare(`
      INSERT INTO gastos (fecha_gasto, concepto, tipo_gasto, tipo_operacion, tercero_id, valor, metodo_pago, observaciones, ruta_soporte, cuenta_contable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      gasto.fechaGasto,
      gasto.concepto,
      gasto.tipoGasto || null,
      gasto.tipoOperacion,
      gasto.terceroId,
      gasto.valor,
      gasto.metodoPago,
      gasto.observaciones || null,
      gasto.rutaSoporte || null,
      cuentaContableId
    );

    return result.lastInsertRowid;
  }
```

Replace with:

```js
  create(gasto) {
    const cuentaContableId = this.resolverCuentaContable('Gasto', gasto.tipoGasto || '__default__');

    const result = this.db.prepare(`
      INSERT INTO gastos (fecha_gasto, concepto, tipo_gasto, tipo_operacion, tercero_id, valor, metodo_pago, observaciones, ruta_soporte, cuenta_contable_id, caja_efectivo_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      gasto.fechaGasto,
      gasto.concepto,
      gasto.tipoGasto || null,
      gasto.tipoOperacion,
      gasto.terceroId,
      gasto.valor,
      gasto.metodoPago,
      gasto.observaciones || null,
      gasto.rutaSoporte || null,
      cuentaContableId,
      gasto.cajaEfectivoId || null
    );

    return result.lastInsertRowid;
  }
```

- [ ] **Step 2: Verify with a Node script**

```js
const path = require('path');
const projectDir = 'C:\\Users\\Brayhan\\Documents\\softwareAcueducto';
const DatabaseService = require(path.join(projectDir, 'src', 'database', 'DatabaseService'));
const GastoRepository = require(path.join(projectDir, 'src', 'repositories', 'GastoRepository'));
const svc = new DatabaseService(projectDir);
svc.initialize();

const repo = new GastoRepository(svc);
const cajaMenor = svc.db.prepare("SELECT id FROM plan_cuentas WHERE codigo='110510'").get();
const unTercero = svc.db.prepare("SELECT id FROM terceros LIMIT 1").get();

const id = repo.create({
  fechaGasto: new Date().toISOString().split('T')[0],
  concepto: 'Prueba plan Task 3',
  tipoGasto: 'Gastos Diversos',
  tipoOperacion: 'Compra directa',
  terceroId: unTercero.id,
  valor: 5000,
  metodoPago: 'Efectivo',
  cajaEfectivoId: cajaMenor.id
});

const row = svc.db.prepare('SELECT caja_efectivo_id FROM gastos WHERE id = ?').get(id);
console.log('caja_efectivo_id guardado:', row.caja_efectivo_id, '- debe ser', cajaMenor.id);

svc.db.prepare('DELETE FROM gastos WHERE id = ?').run(id); // limpieza, no genera asiento
svc.db.close();
```

Expected: el valor guardado coincide con el id de `110510`.

- [ ] **Step 3: Commit**

```bash
git add src/repositories/GastoRepository.js
git commit -m "$(cat <<'EOF'
Persistir caja_efectivo_id al crear un Gasto

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `GastoService` — resolve Caja General/Menor before saving

**Files:**
- Modify: `src/services/GastoService.js` (imports, constructor, `create`)

**Interfaces:**
- Consumes: `GastoRepository.create` now accepts `cajaEfectivoId` (Task 3); `configuracion` key `caja_menor_activa` (Task 1).
- Produces: `create(gastoData, usuarioId)` now also accepts `gastoData.cajaEfectivo` (`'General'` | `'Menor'`, optional, default `'General'`). Ignored (forced to `'General'`) unless `caja_menor_activa === 'true'`.

- [ ] **Step 1: Add the new dependencies**

Find:

```js
const GastoRepository = require('../repositories/GastoRepository');
const AsientoContableService = require('./AsientoContableService');
const DashboardRepository = require('../repositories/DashboardRepository');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');
```

Replace with:

```js
const GastoRepository = require('../repositories/GastoRepository');
const AsientoContableService = require('./AsientoContableService');
const DashboardRepository = require('../repositories/DashboardRepository');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');
```

Find:

```js
  constructor(dbService) {
    this.repository = new GastoRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
    this.dashboardRepo = new DashboardRepository(dbService);
    this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService));
  }
```

Replace with:

```js
  constructor(dbService) {
    this.repository = new GastoRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
    this.dashboardRepo = new DashboardRepository(dbService);
    this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService));
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
    this.configuracionRepository = new ConfiguracionRepository(dbService);
  }
```

- [ ] **Step 2: Resolve `caja_efectivo_id` in `create`**

Find:

```js
    gastoData.tipoOperacion = gastoData.tipoOperacion || 'Compra directa';
    if (!TIPOS_OPERACION_VALIDOS.includes(gastoData.tipoOperacion)) throw new Error('Tipo de operación inválido');

    // Valida que el período contable de la fecha del gasto esté Abierto.
    // Si no existe aún, se crea automáticamente como Abierto (primer movimiento del mes).
    this.periodoContableService.validarFechaPermitida(gastoData.fechaGasto);
```

Replace with:

```js
    gastoData.tipoOperacion = gastoData.tipoOperacion || 'Compra directa';
    if (!TIPOS_OPERACION_VALIDOS.includes(gastoData.tipoOperacion)) throw new Error('Tipo de operación inválido');

    // Resuelve de cuál subcuenta de efectivo sale el gasto. 'Menor' solo se respeta si Caja
    // Menor está activa; en cualquier otro caso (incluyendo pago por Transferencia) se usa
    // Caja General, igual que el comportamiento previo a esta funcionalidad.
    let cajaEfectivoId = null;
    if (gastoData.metodoPago === 'Efectivo') {
      const config = this.configuracionRepository.getAll();
      const usarCajaMenor = config.caja_menor_activa === 'true' && gastoData.cajaEfectivo === 'Menor';
      const codigoCaja = usarCajaMenor ? '110510' : '110505';
      const cuentaCaja = this.planCuentaRepository.findByCodigo(codigoCaja);
      if (!cuentaCaja) throw new Error(`No se encontró la cuenta contable ${codigoCaja}; verifique el plan de cuentas`);
      cajaEfectivoId = cuentaCaja.id;
    }
    gastoData.cajaEfectivoId = cajaEfectivoId;

    // Valida que el período contable de la fecha del gasto esté Abierto.
    // Si no existe aún, se crea automáticamente como Abierto (primer movimiento del mes).
    this.periodoContableService.validarFechaPermitida(gastoData.fechaGasto);
```

- [ ] **Step 3: Verify with a Node script (covers both the General default and the Menor override, plus the inactive-guard)**

```js
const path = require('path');
const projectDir = 'C:\\Users\\Brayhan\\Documents\\softwareAcueducto';
const DatabaseService = require(path.join(projectDir, 'src', 'database', 'DatabaseService'));
const GastoService = require(path.join(projectDir, 'src', 'services', 'GastoService'));
const svc = new DatabaseService(projectDir);
svc.initialize();

const gastoService = new GastoService(svc);
const unTercero = svc.db.prepare("SELECT id FROM terceros LIMIT 1").get();
const idCajaGeneral = svc.db.prepare("SELECT id FROM plan_cuentas WHERE codigo='110505'").get().id;
const idCajaMenor = svc.db.prepare("SELECT id FROM plan_cuentas WHERE codigo='110510'").get().id;

function crear(cajaEfectivo) {
  const id = gastoService.create({
    fechaGasto: new Date().toISOString().split('T')[0],
    concepto: 'Prueba plan Task 4',
    tipoGasto: 'Gastos Diversos',
    tipoOperacion: 'Compra directa',
    terceroId: unTercero.id,
    valor: 3000,
    metodoPago: 'Efectivo',
    cajaEfectivo
  }, null);
  const row = svc.db.prepare('SELECT caja_efectivo_id FROM gastos WHERE id = ?').get(id);
  return { id, cajaEfectivoId: row.caja_efectivo_id };
}

// 1) Caja Menor todavia inactiva (default de la migracion 029) -> debe forzar Caja General
console.log('Caja Menor inactiva, pidiendo Menor:', crear('Menor'), '- caja_efectivo_id debe ser', idCajaGeneral);

// 2) Activar Caja Menor y repetir
svc.db.prepare("UPDATE configuracion SET valor='true' WHERE clave='caja_menor_activa'").run();
console.log('Caja Menor activa, pidiendo Menor:', crear('Menor'), '- caja_efectivo_id debe ser', idCajaMenor);
console.log('Caja Menor activa, sin elegir (default General):', crear(undefined), '- caja_efectivo_id debe ser', idCajaGeneral);

// limpieza
svc.db.prepare("UPDATE configuracion SET valor='false' WHERE clave='caja_menor_activa'").run();
svc.db.prepare("DELETE FROM movimientos_contables WHERE asiento_id IN (SELECT id FROM asientos_contables WHERE concepto LIKE 'Gasto: Prueba plan Task 4')").run();
svc.db.prepare("DELETE FROM asientos_contables WHERE concepto LIKE 'Gasto: Prueba plan Task 4'").run();
svc.db.prepare("DELETE FROM movimientos WHERE concepto LIKE 'Gasto: Prueba plan Task 4'").run();
svc.db.prepare("DELETE FROM gastos WHERE concepto = 'Prueba plan Task 4'").run();
svc.db.close();
```

Expected: the three printed `caja_efectivo_id` values match the comments exactly. This also exercises `AsientoContableService.generarDesdeGasto` end-to-end through `GASTO_EFECTIVO` v2 (via `GastoService.create` → `asientoContableService.generarDesdeGasto`), so if the plantilla from Task 1 is wrong this script will throw instead of printing — that's expected signal, not a bug in this script.

- [ ] **Step 4: Commit**

```bash
git add src/services/GastoService.js
git commit -m "$(cat <<'EOF'
Resolver Caja General/Menor al registrar un Gasto en efectivo

cajaEfectivo='Menor' solo se respeta si caja_menor_activa='true'; en
cualquier otro caso se fuerza Caja General, igual que el comportamiento
anterior a esta funcionalidad.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `ConfiguracionService` — whitelist the two new config keys

**Files:**
- Modify: `src/services/ConfiguracionService.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `actualizar(datos)` now accepts `datos.caja_menor_activa` and `datos.caja_menor_saldo_objetivo`.

- [ ] **Step 1: Add the two keys to `CLAVES_EDITABLES`**

Find:

```js
const CLAVES_EDITABLES = [
  'nombre_asociacion', 'nit', 'direccion', 'ciudad', 'telefono', 'email',
  'consecutivo_recibos', 'valor_nuevo_punto', 'saldo_caja_inicial', 'saldo_banco_inicial',
  'respaldo_nube_dias_retencion'
];
```

Replace with:

```js
const CLAVES_EDITABLES = [
  'nombre_asociacion', 'nit', 'direccion', 'ciudad', 'telefono', 'email',
  'consecutivo_recibos', 'valor_nuevo_punto', 'saldo_caja_inicial', 'saldo_banco_inicial',
  'respaldo_nube_dias_retencion', 'caja_menor_activa', 'caja_menor_saldo_objetivo'
];
```

- [ ] **Step 2: Add a validation guard for `caja_menor_saldo_objetivo`**

Find:

```js
    // El consecutivo de recibos nunca puede retroceder por debajo de un recibo ya emitido,
    // de lo contrario se generarían números de recibo duplicados.
    if (datos.consecutivo_recibos !== undefined) {
```

Insert immediately **before** that block:

```js
    if (datos.caja_menor_saldo_objetivo !== undefined) {
      const valor = Number(datos.caja_menor_saldo_objetivo);
      if (!Number.isFinite(valor) || valor < 0) {
        throw new Error('El saldo objetivo de Caja Menor debe ser un número mayor o igual a cero');
      }
    }

```

- [ ] **Step 3: Verify with a Node script**

```js
const path = require('path');
const projectDir = 'C:\\Users\\Brayhan\\Documents\\softwareAcueducto';
const DatabaseService = require(path.join(projectDir, 'src', 'database', 'DatabaseService'));
const ConfiguracionService = require(path.join(projectDir, 'src', 'services', 'ConfiguracionService'));
const svc = new DatabaseService(projectDir);
svc.initialize();

const config = new ConfiguracionService(svc);
config.actualizar({ caja_menor_activa: 'true', caja_menor_saldo_objetivo: '300000' });
console.log('Guardado:', JSON.stringify(config.getAll().caja_menor_activa), JSON.stringify(config.getAll().caja_menor_saldo_objetivo));

let fallo = false;
try { config.actualizar({ caja_menor_saldo_objetivo: '-5' }); } catch (e) { fallo = true; console.log('Rechazo esperado:', e.message); }
console.log('Rechazo negativo funciono:', fallo, '- debe ser true');

config.actualizar({ caja_menor_activa: 'false', caja_menor_saldo_objetivo: '0' }); // deja el estado por defecto
svc.db.close();
```

Expected: primer log muestra `"true" "300000"`; segundo log muestra el mensaje de error; `Rechazo negativo funciono: true`.

- [ ] **Step 4: Commit**

```bash
git add src/services/ConfiguracionService.js
git commit -m "$(cat <<'EOF'
Permitir editar caja_menor_activa y caja_menor_saldo_objetivo desde Configuracion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `CajaMenorRepository` — responsables CRUD

**Files:**
- Create: `src/repositories/CajaMenorRepository.js`

**Interfaces:**
- Consumes: table `caja_menor_responsables` (Task 1).
- Produces: `getResponsableActual()`, `getHistorialResponsables()`, `asignarResponsable(terceroId, fechaInicio, observaciones)` — used by `CajaMenorService` in Task 7.

- [ ] **Step 1: Write the repository**

```js
class CajaMenorRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  getResponsableActual() {
    return this.db.prepare(`
      SELECT cmr.*, t.nombre_razon_social, t.numero_identificacion
      FROM caja_menor_responsables cmr
      INNER JOIN terceros t ON t.id = cmr.tercero_id
      WHERE cmr.fecha_fin IS NULL
    `).get();
  }

  getHistorialResponsables() {
    return this.db.prepare(`
      SELECT cmr.*, t.nombre_razon_social, t.numero_identificacion
      FROM caja_menor_responsables cmr
      INNER JOIN terceros t ON t.id = cmr.tercero_id
      ORDER BY cmr.fecha_inicio DESC
    `).all();
  }

  // Mismo patrón que PropietarioRepository.asignarACuenta: cierra el responsable activo (un día
  // antes del nuevo inicio, sin solapamiento) e inserta el nuevo, en una sola transacción.
  asignarResponsable(terceroId, fechaInicio, observaciones = null) {
    const ejecutar = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE caja_menor_responsables
        SET fecha_fin = date(?, '-1 day')
        WHERE fecha_fin IS NULL
      `).run(fechaInicio);

      const result = this.db.prepare(`
        INSERT INTO caja_menor_responsables (tercero_id, fecha_inicio, observaciones)
        VALUES (?, ?, ?)
      `).run(terceroId, fechaInicio, observaciones);

      return result.lastInsertRowid;
    });

    return ejecutar();
  }
}

module.exports = CajaMenorRepository;
```

- [ ] **Step 2: Verify with a Node script**

```js
const path = require('path');
const projectDir = 'C:\\Users\\Brayhan\\Documents\\softwareAcueducto';
const DatabaseService = require(path.join(projectDir, 'src', 'database', 'DatabaseService'));
const CajaMenorRepository = require(path.join(projectDir, 'src', 'repositories', 'CajaMenorRepository'));
const svc = new DatabaseService(projectDir);
svc.initialize();

const repo = new CajaMenorRepository(svc);
const terceros = svc.db.prepare('SELECT id FROM terceros LIMIT 2').all();

console.log('Responsable actual antes:', repo.getResponsableActual(), '- debe ser undefined');

repo.asignarResponsable(terceros[0].id, '2026-01-01', 'Primer responsable de prueba');
console.log('Responsable actual tras asignar #1:', repo.getResponsableActual()?.tercero_id, '- debe ser', terceros[0].id);

repo.asignarResponsable(terceros[1].id, '2026-06-01', 'Cambio de prueba');
const actual = repo.getResponsableActual();
console.log('Responsable actual tras asignar #2:', actual.tercero_id, '- debe ser', terceros[1].id);

const historial = repo.getHistorialResponsables();
console.log('Historial tiene 2 filas:', historial.length === 2);
console.log('Primera fila (mas reciente) tiene fecha_fin null:', historial[0].fecha_fin === null);
console.log('Segunda fila tiene fecha_fin 2026-05-31:', historial[1].fecha_fin);

// limpieza
svc.db.prepare("DELETE FROM caja_menor_responsables WHERE observaciones IN ('Primer responsable de prueba','Cambio de prueba')").run();
svc.db.close();
```

Expected: todos los comentarios `- debe ser ...` coinciden con el valor impreso justo antes; `historial[1].fecha_fin` imprime `2026-05-31` (un día antes del `2026-06-01` del segundo responsable).

- [ ] **Step 3: Commit**

```bash
git add src/repositories/CajaMenorRepository.js
git commit -m "$(cat <<'EOF'
Agregar CajaMenorRepository para el historial de responsables

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `CajaMenorService` — estado, asignación de responsable y reembolso

**Files:**
- Create: `src/services/CajaMenorService.js`

**Interfaces:**
- Consumes: `CajaMenorRepository` (Task 6), `ConfiguracionRepository`/`PlanCuentaRepository` (existing), `AsientoContableService.getLibroMayor`/`crearManual` (existing + Task 2), `TerceroRepository.findById` (existing), `PeriodoContableService.validarFechaPermitida` (existing).
- Produces: `getEstado()` → `{ activa, saldoObjetivo, saldoActual, responsable, montoReembolso }`; `asignarResponsable(terceroId, fechaInicio, observaciones)`; `getHistorialResponsables()`; `reembolsar({ fecha, observaciones, usuarioId })` → asiento id. These four methods are what Task 8 wires to IPC.

- [ ] **Step 1: Write the service**

```js
const CajaMenorRepository = require('../repositories/CajaMenorRepository');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');
const TerceroRepository = require('../repositories/TerceroRepository');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');
const AsientoContableService = require('./AsientoContableService');

class CajaMenorService {
  constructor(dbService) {
    this.repository = new CajaMenorRepository(dbService);
    this.configuracionRepository = new ConfiguracionRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
    this.terceroRepository = new TerceroRepository(dbService);
    this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService));
    this.asientoContableService = new AsientoContableService(dbService);
  }

  getEstado() {
    const config = this.configuracionRepository.getAll();
    const activa = config.caja_menor_activa === 'true';
    const saldoObjetivo = Number(config.caja_menor_saldo_objetivo || 0);

    const cuentaCajaMenor = this.planCuentaRepository.findByCodigo('110510');
    const saldoActual = cuentaCajaMenor
      ? this.asientoContableService.getLibroMayor(cuentaCajaMenor.id).saldoFinal
      : 0;

    const responsable = this.repository.getResponsableActual() || null;
    const montoReembolso = Math.max(0, saldoObjetivo - saldoActual);

    return { activa, saldoObjetivo, saldoActual, responsable, montoReembolso };
  }

  getHistorialResponsables() {
    return this.repository.getHistorialResponsables();
  }

  asignarResponsable(terceroId, fechaInicio, observaciones = null) {
    if (!terceroId) throw new Error('Debe seleccionar un tercero responsable');
    const tercero = this.terceroRepository.findById(terceroId);
    if (!tercero) throw new Error('El tercero seleccionado no existe');
    if (!fechaInicio) throw new Error('La fecha de inicio es obligatoria');

    return this.repository.asignarResponsable(terceroId, fechaInicio, observaciones);
  }

  // Traslada Caja General -> Caja Menor hasta el saldo objetivo vigente. Se contabiliza como
  // asiento manual de dos líneas fijas, sin pasar por el motor de plantillas (no hace falta para
  // dos líneas con cuentas conocidas), y con sincronizarLedgerSimple=false porque es un traslado
  // interno dentro de "Caja": el efectivo total de la organización no cambia, así que no debe
  // tocar el ledger simple que alimenta "Saldo en Caja" del Dashboard.
  reembolsar({ fecha, observaciones = null, usuarioId = null }) {
    if (!fecha) throw new Error('La fecha es obligatoria');

    const config = this.configuracionRepository.getAll();
    if (config.caja_menor_activa !== 'true') throw new Error('Caja Menor no está activa');

    const cuentaCajaMenor = this.planCuentaRepository.findByCodigo('110510');
    const cuentaCajaGeneral = this.planCuentaRepository.findByCodigo('110505');
    if (!cuentaCajaMenor || !cuentaCajaGeneral) {
      throw new Error('No se encontraron las cuentas de Caja Menor / Caja General en el plan de cuentas');
    }

    const saldoObjetivo = Number(config.caja_menor_saldo_objetivo || 0);
    const saldoActual = this.asientoContableService.getLibroMayor(cuentaCajaMenor.id).saldoFinal;
    const monto = saldoObjetivo - saldoActual;
    if (monto <= 0) {
      throw new Error('La Caja Menor ya tiene el saldo objetivo o más; no hay nada que reembolsar');
    }

    const responsable = this.repository.getResponsableActual();
    if (!responsable) {
      throw new Error('No hay un responsable de Caja Menor asignado. Configúralo en Configuración → Caja Menor antes de reembolsar.');
    }

    this.periodoContableService.validarFechaPermitida(fecha);

    const lineas = [
      {
        cuentaContableId: cuentaCajaMenor.id,
        debito: monto,
        terceroId: responsable.tercero_id,
        terceroNombre: responsable.nombre_razon_social,
        terceroIdentificacion: responsable.numero_identificacion
      },
      { cuentaContableId: cuentaCajaGeneral.id, credito: monto }
    ];

    return this.asientoContableService.crearManual({
      fecha,
      concepto: `Reembolso de Caja Menor a ${responsable.nombre_razon_social}`,
      tipoComprobante: 'Reembolso Caja Menor',
      lineas,
      usuarioId,
      sincronizarLedgerSimple: false
    });
  }
}

module.exports = CajaMenorService;
```

- [ ] **Step 2: Verify with a Node script**

```js
const path = require('path');
const projectDir = 'C:\\Users\\Brayhan\\Documents\\softwareAcueducto';
const DatabaseService = require(path.join(projectDir, 'src', 'database', 'DatabaseService'));
const CajaMenorService = require(path.join(projectDir, 'src', 'services', 'CajaMenorService'));
const svc = new DatabaseService(projectDir);
svc.initialize();

const service = new CajaMenorService(svc);
const hoy = new Date().toISOString().split('T')[0];

// 1) Sin responsable, Caja Menor inactiva -> getEstado no debe fallar
console.log('Estado inicial:', JSON.stringify(service.getEstado()));

// 2) reembolsar() sin estar activa -> debe rechazar
try { service.reembolsar({ fecha: hoy }); console.log('FALLO: debio rechazar por inactiva'); }
catch (e) { console.log('Rechazo esperado (inactiva):', e.message); }

// 3) Activar + saldo objetivo, sin responsable -> debe rechazar por falta de responsable
svc.db.prepare("UPDATE configuracion SET valor='true' WHERE clave='caja_menor_activa'").run();
svc.db.prepare("UPDATE configuracion SET valor='300000' WHERE clave='caja_menor_saldo_objetivo'").run();
try { service.reembolsar({ fecha: hoy }); console.log('FALLO: debio rechazar por falta de responsable'); }
catch (e) { console.log('Rechazo esperado (sin responsable):', e.message); }

// 4) Asignar responsable y reembolsar de verdad
const unTercero = svc.db.prepare('SELECT id FROM terceros LIMIT 1').get();
service.asignarResponsable(unTercero.id, hoy, 'Prueba plan Task 7');
const estadoPrevio = service.getEstado();
console.log('Monto a reembolsar antes:', estadoPrevio.montoReembolso, '- debe ser 300000 (saldo actual 0)');

const asientoId = service.reembolsar({ fecha: hoy, observaciones: 'Prueba plan Task 7' });
console.log('Asiento de reembolso creado:', asientoId);

const estadoTrasReembolso = service.getEstado();
console.log('Saldo actual tras reembolso:', estadoTrasReembolso.saldoActual, '- debe ser 300000');
console.log('Monto a reembolsar tras reembolso:', estadoTrasReembolso.montoReembolso, '- debe ser 0');

// 5) Reembolsar de nuevo sin necesitarlo -> debe rechazar
try { service.reembolsar({ fecha: hoy }); console.log('FALLO: debio rechazar, ya esta al saldo objetivo'); }
catch (e) { console.log('Rechazo esperado (ya al objetivo):', e.message); }

// limpieza
const asiento = svc.db.prepare("SELECT id FROM asientos_contables WHERE id = ?").get(asientoId);
if (asiento) {
  svc.db.prepare('DELETE FROM movimientos_contables WHERE asiento_id = ?').run(asientoId);
  svc.db.prepare('DELETE FROM asientos_contables WHERE id = ?').run(asientoId);
}
svc.db.prepare("DELETE FROM caja_menor_responsables WHERE observaciones = 'Prueba plan Task 7'").run();
svc.db.prepare("UPDATE configuracion SET valor='false' WHERE clave='caja_menor_activa'").run();
svc.db.prepare("UPDATE configuracion SET valor='0' WHERE clave='caja_menor_saldo_objetivo'").run();
svc.db.close();
```

Expected: los 3 rechazos imprimen su mensaje esperado (no "FALLO"); el monto a reembolsar antes es `300000`; tras el reembolso el saldo actual es `300000` y el monto a reembolsar es `0`.

- [ ] **Step 3: Commit**

```bash
git add src/services/CajaMenorService.js
git commit -m "$(cat <<'EOF'
Agregar CajaMenorService: estado, responsable y reembolso de Caja Menor

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: IPC wiring — `main.js` + `preload.js`

**Files:**
- Modify: `main.js` (require + `let` declaration + instantiation + `CANALES_SOLO_ADMIN` + handlers)
- Modify: `preload.js` (`cajaMenor` namespace)

**Interfaces:**
- Consumes: `CajaMenorService` (Task 7).
- Produces: `window.api.cajaMenor.{getEstado, getHistorialResponsables, asignarResponsable, reembolsar}` — used by Tasks 9-11.

- [ ] **Step 1: Require + declare + instantiate in `main.js`**

Find (near the other service requires, e.g. right after the `AsientoContableService` require around line 24):

```js
const AsientoContableService = require('./src/services/AsientoContableService');
```

Insert immediately after:

```js
const CajaMenorService = require('./src/services/CajaMenorService');
```

Find:

```js
let asientoContableService;
```

Insert immediately after:

```js
let cajaMenorService;
```

Find (inside `app.whenReady().then(() => { ... })`):

```js
  asientoContableService = new AsientoContableService(dbService);
```

Insert immediately after:

```js
  cajaMenorService = new CajaMenorService(dbService);
```

- [ ] **Step 2: Restrict write actions to Administrador**

Find:

```js
const CANALES_SOLO_ADMIN = new Set([
  'usuarios:getAll', 'usuarios:crear', 'usuarios:toggleActivo', 'usuarios:resetearPassword',
  'config:actualizar', 'config:subirLogo', 'config:quitarLogo', 'backup:restaurar',
  'auditoria:getAll',
  'plancuentas:create', 'plancuentas:update', 'plancuentas:toggleActivo',
  'mapeocontable:actualizar', 'mapeocontable:crear',
  'asientos:crearManual', 'asientos:revertir',
  'cuentasautomaticas:actualizar',
  'periodos:cerrar', 'periodos:bloquear', 'periodos:reabrir', 'periodos:actualizarNotas',
  'plantillas:actualizarLineas',
  'impuestos:create', 'impuestos:update', 'impuestos:toggleActivo',
  'impuestos:asignarAPlantilla', 'impuestos:quitarDePlantilla',
  'cloudBackup:respaldarAhora'
]);
```

Replace the closing bracket line with:

```js
  'cloudBackup:respaldarAhora',
  'cajaMenor:asignarResponsable', 'cajaMenor:reembolsar'
]);
```

(i.e. add `'cajaMenor:asignarResponsable', 'cajaMenor:reembolsar'` as two new entries in the set, keeping every existing entry unchanged.)

- [ ] **Step 3: Add the 4 handlers**

Find the `// Caja y Bancos` block (around line 1309-1341, ends with the `caja:getResumenPeriodo` handler's closing `});`). Insert immediately after that block, before `// Autenticación`:

```js
  // Caja Menor
  envolverHandle('cajaMenor:getEstado', async () => {
    try {
      return { success: true, data: cajaMenorService.getEstado() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cajaMenor:getHistorialResponsables', async () => {
    try {
      return { success: true, data: cajaMenorService.getHistorialResponsables() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cajaMenor:asignarResponsable', async (event, terceroId, fechaInicio, observaciones) => {
    try {
      cajaMenorService.asignarResponsable(terceroId, fechaInicio, observaciones);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cajaMenor:reembolsar', async (event, payload) => {
    try {
      const id = cajaMenorService.reembolsar({ ...payload, usuarioId: sesionActual.id });
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
```

- [ ] **Step 4: Expose in `preload.js`**

Find:

```js
  caja: {
    getSaldos: () => ipcRenderer.invoke('caja:getSaldos'),
    getMovimientos: (params) => ipcRenderer.invoke('caja:getMovimientos', params),
    registrarConsignacion: (payload) => ipcRenderer.invoke('caja:registrarConsignacion', payload),
    getResumenPeriodo: (fechaDesde, fechaHasta) => ipcRenderer.invoke('caja:getResumenPeriodo', fechaDesde, fechaHasta)
  },
```

Replace with:

```js
  caja: {
    getSaldos: () => ipcRenderer.invoke('caja:getSaldos'),
    getMovimientos: (params) => ipcRenderer.invoke('caja:getMovimientos', params),
    registrarConsignacion: (payload) => ipcRenderer.invoke('caja:registrarConsignacion', payload),
    getResumenPeriodo: (fechaDesde, fechaHasta) => ipcRenderer.invoke('caja:getResumenPeriodo', fechaDesde, fechaHasta)
  },
  cajaMenor: {
    getEstado: () => ipcRenderer.invoke('cajaMenor:getEstado'),
    getHistorialResponsables: () => ipcRenderer.invoke('cajaMenor:getHistorialResponsables'),
    asignarResponsable: (terceroId, fechaInicio, observaciones) => ipcRenderer.invoke('cajaMenor:asignarResponsable', terceroId, fechaInicio, observaciones),
    reembolsar: (payload) => ipcRenderer.invoke('cajaMenor:reembolsar', payload)
  },
```

- [ ] **Step 5: Verify by launching the app**

Run: `cd "C:/Users/Brayhan/Documents/softwareAcueducto" && npm start`

In DevTools console (View → Toggle Developer Tools, or `--dev` flag), after logging in, run:

```js
await window.api.cajaMenor.getEstado()
```

Expected: `{ success: true, data: { activa: false, saldoObjetivo: 0, saldoActual: 0, responsable: null, montoReembolso: 0 } }` (assuming no prior manual testing left state behind — if Tasks 1-7's verification scripts cleaned up after themselves, this is the expected fresh state). Close the app after checking.

- [ ] **Step 6: Commit**

```bash
git add main.js preload.js
git commit -m "$(cat <<'EOF'
Exponer CajaMenorService via IPC (cajaMenor:*)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Renderer — selector Caja General/Menor en el formulario de Gastos

**Files:**
- Modify: `src/renderer/js/gastos.js`

**Interfaces:**
- Consumes: `window.api.cajaMenor.getEstado()` (Task 8).
- Produces: `formData.cajaEfectivo` sent to `window.api.gastos.create` (consumed by `GastoService.create`, Task 4).

- [ ] **Step 1: Fetch Caja Menor's active state when opening the modal**

Find (in `showFormModal`, right after the `proveedoresResponse` block):

```js
    const proveedoresResponse = await window.api.terceros.getAll({ soloActivos: true });
    const proveedores = proveedoresResponse.success ? proveedoresResponse.data : [];
```

Replace with:

```js
    const proveedoresResponse = await window.api.terceros.getAll({ soloActivos: true });
    const proveedores = proveedoresResponse.success ? proveedoresResponse.data : [];

    const cajaMenorResponse = await window.api.cajaMenor.getEstado();
    const cajaMenorActiva = cajaMenorResponse.success && cajaMenorResponse.data.activa;
```

- [ ] **Step 2: Add the conditional selector after "Método de Pago"**

Find:

```js
        <div class="form-group">
          <label for="metodo_pago">Método de Pago <span style="color: #ef4444;">*</span></label>
          <select id="metodo_pago" name="metodo_pago" required>
            <option value="Efectivo" ${prefill?.metodo_pago === 'Efectivo' ? 'selected' : ''}>Efectivo</option>
            <option value="Transferencia" ${prefill?.metodo_pago === 'Transferencia' ? 'selected' : ''}>Transferencia</option>
          </select>
        </div>

        <div class="form-group">
          <label for="observaciones">Observaciones</label>
```

Replace with:

```js
        <div class="form-group">
          <label for="metodo_pago">Método de Pago <span style="color: #ef4444;">*</span></label>
          <select id="metodo_pago" name="metodo_pago" required>
            <option value="Efectivo" ${prefill?.metodo_pago === 'Efectivo' ? 'selected' : ''}>Efectivo</option>
            <option value="Transferencia" ${prefill?.metodo_pago === 'Transferencia' ? 'selected' : ''}>Transferencia</option>
          </select>
        </div>

        <div class="form-group" id="cajaEfectivoGroup" style="display: none;">
          <label for="caja_efectivo">¿De cuál caja sale?</label>
          <select id="caja_efectivo" name="caja_efectivo">
            <option value="General" ${(prefill?.cajaEfectivo || 'General') === 'General' ? 'selected' : ''}>Caja General</option>
            <option value="Menor" ${prefill?.cajaEfectivo === 'Menor' ? 'selected' : ''}>Caja Menor</option>
          </select>
        </div>

        <div class="form-group">
          <label for="observaciones">Observaciones</label>
```

- [ ] **Step 3: Toggle visibility based on método de pago + Caja Menor activa**

Find:

```js
    document.getElementById('tipo_gasto').addEventListener('change', (e) => {
      document.getElementById('avisoGastosDiversos').style.display = e.target.value === 'Gastos Diversos' ? 'block' : 'none';
    });
```

Insert immediately after:

```js
    const actualizarVisibilidadCajaEfectivo = () => {
      const esEfectivo = document.getElementById('metodo_pago').value === 'Efectivo';
      document.getElementById('cajaEfectivoGroup').style.display = (esEfectivo && cajaMenorActiva) ? 'block' : 'none';
    };
    document.getElementById('metodo_pago').addEventListener('change', actualizarVisibilidadCajaEfectivo);
    actualizarVisibilidadCajaEfectivo();
```

- [ ] **Step 4: Send the field on submit**

Find:

```js
  async saveGasto() {
    const formData = {
      fechaGasto: document.getElementById('fecha_gasto').value,
      concepto: document.getElementById('concepto').value.trim(),
      tipoGasto: document.getElementById('tipo_gasto').value.trim(),
      tipoOperacion: document.getElementById('tipo_operacion').value,
      terceroId: parseInt(document.getElementById('tercero_id').value, 10),
      valor: App.parseMoneyValue(document.getElementById('valor').value),
      metodoPago: document.getElementById('metodo_pago').value,
      observaciones: document.getElementById('observaciones').value.trim()
    };
```

Replace with:

```js
  async saveGasto() {
    const cajaEfectivoEl = document.getElementById('caja_efectivo');
    const formData = {
      fechaGasto: document.getElementById('fecha_gasto').value,
      concepto: document.getElementById('concepto').value.trim(),
      tipoGasto: document.getElementById('tipo_gasto').value.trim(),
      tipoOperacion: document.getElementById('tipo_operacion').value,
      terceroId: parseInt(document.getElementById('tercero_id').value, 10),
      valor: App.parseMoneyValue(document.getElementById('valor').value),
      metodoPago: document.getElementById('metodo_pago').value,
      cajaEfectivo: cajaEfectivoEl ? cajaEfectivoEl.value : 'General',
      observaciones: document.getElementById('observaciones').value.trim()
    };
```

- [ ] **Step 5: Manual verification**

Run `npm start`, log in, go to Gastos → "+ Nuevo Gasto". With Caja Menor still inactive (default), confirm the "¿De cuál caja sale?" selector never appears regardless of método de pago. Then, in Configuración → Caja Menor (not built until Task 11 — for now, activate it directly via the Task 5 verification script's pattern: run a one-off Node script that calls `new ConfiguracionService(svc).actualizar({ caja_menor_activa: 'true' })`), relaunch the app, reopen the Gastos modal, select "Efectivo" and confirm the selector appears with "Caja General"/"Caja Menor" options; select "Transferencia" and confirm it hides again.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/js/gastos.js
git commit -m "$(cat <<'EOF'
Agregar selector Caja General/Menor al formulario de Gastos

Solo visible cuando el metodo de pago es Efectivo y Caja Menor esta activa.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Renderer — tarjeta de Caja Menor y modal de Reembolso en la pantalla de Caja

**Files:**
- Modify: `src/renderer/js/caja.js`

**Interfaces:**
- Consumes: `window.api.cajaMenor.{getEstado, reembolsar}` (Task 8).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add the container div**

Find:

```js
      <div class="stats-grid" id="saldosGrid">${App.renderSkeletonStatsGrid(3)}</div>

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header">
          <h2>Resumen del Período</h2>
```

Replace with:

```js
      <div class="stats-grid" id="saldosGrid">${App.renderSkeletonStatsGrid(3)}</div>

      <div id="cajaMenorCard"></div>

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header">
          <h2>Resumen del Período</h2>
```

- [ ] **Step 2: Load it alongside the other cards**

Find:

```js
    this.setupEventListeners();
    await this.loadSaldos();
    await this.loadResumenPeriodo();
    await this.loadMovimientos();
  },
```

Replace with:

```js
    this.setupEventListeners();
    await this.loadSaldos();
    await this.loadCajaMenor();
    await this.loadResumenPeriodo();
    await this.loadMovimientos();
  },
```

- [ ] **Step 3: Add `loadCajaMenor` and `showReembolsoCajaMenorModal`**

Find:

```js
  async loadResumenPeriodo() {
```

Insert immediately **before** it:

```js
  async loadCajaMenor() {
    try {
      const response = await window.api.cajaMenor.getEstado();
      const container = document.getElementById('cajaMenorCard');
      if (!response.success || !response.data.activa) {
        container.innerHTML = '';
        return;
      }

      const estado = response.data;
      const puedeReembolsar = estado.montoReembolso > 0;

      container.innerHTML = `
        <div class="table-container" style="margin-bottom: 24px;">
          <div class="table-header"><h2>Caja Menor</h2></div>
          <div style="padding: 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
            <div>
              <p style="margin: 0; font-size: 1.5rem; font-weight: 700;">
                $${this.formatNumber(estado.saldoActual)}
                <span style="font-size: 1rem; font-weight: 400; color: #64748b;">de $${this.formatNumber(estado.saldoObjetivo)}</span>
              </p>
              <p style="margin: 4px 0 0; color: #64748b; font-size: 0.875rem;">
                Responsable: ${estado.responsable ? estado.responsable.nombre_razon_social : 'Sin asignar'}
              </p>
            </div>
            <button class="btn btn-primary" id="btnReembolsarCajaMenor" ${puedeReembolsar ? '' : 'disabled'}>+ Reembolsar Caja Menor</button>
          </div>
        </div>
      `;

      if (puedeReembolsar) {
        document.getElementById('btnReembolsarCajaMenor').addEventListener('click', () => this.showReembolsoCajaMenorModal(estado));
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  showReembolsoCajaMenorModal(estado) {
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Reembolsar Caja Menor</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          Traslada <strong>$${this.formatNumber(estado.montoReembolso)}</strong> de Caja General a Caja Menor,
          para volver al saldo objetivo de $${this.formatNumber(estado.saldoObjetivo)}.
          Responsable: <strong>${estado.responsable.nombre_razon_social}</strong>.
        </p>
      </div>

      <div id="formError"></div>

      <form id="reembolsoCajaMenorForm">
        <div class="form-group">
          <label for="fecha_reembolso">Fecha <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_reembolso" name="fecha_reembolso" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_reembolso">Observaciones</label>
          <textarea id="observaciones_reembolso" name="observaciones_reembolso"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Reembolsar</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('reembolsoCajaMenorForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const fecha = document.getElementById('fecha_reembolso').value;
      const observaciones = document.getElementById('observaciones_reembolso').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.cajaMenor.reembolsar({ fecha, observaciones });

        if (response.success) {
          App.closeModal();
          this.loadCajaMenor();
          App.toast('Reembolso de Caja Menor registrado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el reembolso</div>`;
      }
    });
  },

```

- [ ] **Step 4: Manual verification**

With Caja Menor still inactive (from Task 9's default state), open Caja y Bancos and confirm no Caja Menor card appears. Activate Caja Menor and set a saldo objetivo (e.g. $300,000) via Configuración once Task 11 exists, or via a one-off Node script in the meantime; assign a responsable via a one-off call to `CajaMenorService.asignarResponsable` if Task 11 isn't built yet. Reload Caja y Bancos: confirm the card shows `$0 de $300.000`, the responsable's name, and an enabled "+ Reembolsar Caja Menor" button. Click it, submit, confirm the card updates to `$300.000 de $300.000` and the button becomes disabled. Confirm "Saldo en Caja" (the original card) did **not** change.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/caja.js
git commit -m "$(cat <<'EOF'
Agregar tarjeta de Caja Menor y modal de reembolso a la pantalla de Caja

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Renderer — sección Caja Menor en Configuración (activa, saldo objetivo, responsable, historial)

**Files:**
- Modify: `src/renderer/js/configuracion.js`

**Interfaces:**
- Consumes: `window.api.cajaMenor.{getEstado, getHistorialResponsables, asignarResponsable}` (Task 8), `window.api.config.actualizar` (existing), `window.api.terceros.getAll` (existing).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Fetch Caja Menor's estado alongside the general config**

Find (near the top of `renderForm`):

```js
  async renderForm() {
    const esAdmin = App.currentUser.rol === 'Administrador';
    const response = await window.api.config.getAll();
    const config = response.success ? response.data : {};
    const container = document.getElementById('configContent');
```

Replace with:

```js
  async renderForm() {
    const esAdmin = App.currentUser.rol === 'Administrador';
    const response = await window.api.config.getAll();
    const config = response.success ? response.data : {};
    const container = document.getElementById('configContent');

    const cajaMenorResponse = esAdmin ? await window.api.cajaMenor.getEstado() : { success: false };
    const cajaMenorEstado = cajaMenorResponse.success
      ? cajaMenorResponse.data
      : { activa: false, saldoObjetivo: 0, saldoActual: 0, responsable: null, montoReembolso: 0 };
```

- [ ] **Step 2: Insert the "Caja Menor" section between "Datos de la Asociación" and "Seguridad"**

Find:

```js
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Guardar Configuración</button>
            </div>
          </form>
        </div>
      </div>
      ` : ''}

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header"><h2>Seguridad</h2></div>
```

Replace with:

```js
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Guardar Configuración</button>
            </div>
          </form>
        </div>
      </div>

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header"><h2>Caja Menor</h2></div>
        <div style="padding: 24px;">
          <div id="cajaMenorConfigError"></div>
          <form id="cajaMenorConfigForm">
            <div class="form-group">
              <label>
                <input type="checkbox" id="caja_menor_activa" ${cajaMenorEstado.activa ? 'checked' : ''}>
                Caja Menor activa
              </label>
            </div>

            <div class="form-group">
              <label for="caja_menor_saldo_objetivo">Saldo Objetivo</label>
              <div class="input-currency">
                <span class="currency-symbol">$</span>
                <input type="text" inputmode="numeric" id="caja_menor_saldo_objetivo" name="caja_menor_saldo_objetivo" value="${this.formatMoney(cajaMenorEstado.saldoObjetivo)}">
              </div>
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Guardar Caja Menor</button>
            </div>
          </form>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;">

          <p style="margin: 0 0 8px;"><strong>Responsable actual:</strong> ${cajaMenorEstado.responsable ? cajaMenorEstado.responsable.nombre_razon_social : 'Sin asignar'}</p>
          <div class="form-actions" style="justify-content: flex-start;">
            <button type="button" class="btn btn-secondary" id="btnCambiarResponsableCajaMenor">Cambiar Responsable</button>
            <button type="button" class="btn btn-secondary" id="btnHistorialResponsablesCajaMenor">Ver Historial de Responsables</button>
          </div>
        </div>
      </div>
      ` : ''}

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header"><h2>Seguridad</h2></div>
```

**Note:** this moves the closing `` ` : ''} `` from right after the "Datos de la Asociación" form to right after the new "Caja Menor" section — both sections are now inside the same `esAdmin ? \`...\` : ''` conditional block that was already wrapping "Datos de la Asociación". Double-check indentation/backticks match the surrounding template literal after editing (there must be exactly one opening `` esAdmin ? ` `` before "Datos de la Asociación" and one closing `` ` : ''} `` after "Caja Menor", not two of each).

- [ ] **Step 3: Wire up events**

Find:

```js
      document.getElementById('btnRestaurarBackup').addEventListener('click', () => this.restaurarBackup());
      document.getElementById('btnNuevoUsuario').addEventListener('click', () => this.showNuevoUsuarioModal());
```

Insert immediately **before** that block:

```js
      App.attachMoneyInput(document.getElementById('caja_menor_saldo_objetivo'));
      document.getElementById('cajaMenorConfigForm').addEventListener('submit', (e) => {
        e.preventDefault();
        this.guardarCajaMenorConfig();
      });
      document.getElementById('btnCambiarResponsableCajaMenor').addEventListener('click', () => {
        this.showCambiarResponsableCajaMenorModal();
      });
      document.getElementById('btnHistorialResponsablesCajaMenor').addEventListener('click', () => {
        this.showHistorialResponsablesCajaMenorModal();
      });

```

- [ ] **Step 4: Add the three new methods**

Find (the exact boundary between `guardarConfiguracion` and the next method, `cambiarPassword`):

```js
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al guardar la configuración</div>`;
    }
  },

  async cambiarPassword() {
```

Replace with (this keeps `guardarConfiguracion` unchanged, inserts the 3 new methods, then leads back into `cambiarPassword`):

```js
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al guardar la configuración</div>`;
    }
  },

  async guardarCajaMenorConfig() {
    const datos = {
      caja_menor_activa: document.getElementById('caja_menor_activa').checked ? 'true' : 'false',
      caja_menor_saldo_objetivo: String(App.parseMoneyValue(document.getElementById('caja_menor_saldo_objetivo').value))
    };

    const errorDiv = document.getElementById('cajaMenorConfigError');
    errorDiv.innerHTML = '';

    try {
      const response = await window.api.config.actualizar(datos);

      if (response.success) {
        App.toast('Configuración de Caja Menor guardada con éxito');
        await this.renderForm();
      } else {
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al guardar la configuración de Caja Menor</div>`;
    }
  },

  async showCambiarResponsableCajaMenorModal() {
    const tercerosResponse = await window.api.terceros.getAll({ soloActivos: true });
    const terceros = tercerosResponse.success ? tercerosResponse.data : [];
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Cambiar Responsable de Caja Menor</h2>
      </div>

      <div id="formError"></div>

      <form id="responsableCajaMenorForm">
        <div class="form-group">
          <label for="tercero_responsable_id">Responsable <span style="color: #ef4444;">*</span></label>
          <select id="tercero_responsable_id" required>
            <option value="">Seleccione...</option>
            ${terceros.map(t => `<option value="${t.id}">${t.nombre_razon_social}${t.numero_identificacion ? ' - ' + t.numero_identificacion : ''}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label for="fecha_inicio_responsable">Fecha de Inicio <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_inicio_responsable" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_responsable">Observaciones</label>
          <textarea id="observaciones_responsable"></textarea>
        </div>

        <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
            <strong>Nota:</strong> Si ya hay un responsable, su período se cerrará automáticamente en la fecha de inicio del nuevo.
          </p>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Asignar</button>
        </div>
      </form>
    `;

    App.openModal(content);
    Combobox.attach('tercero_responsable_id');

    document.getElementById('responsableCajaMenorForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const terceroId = parseInt(document.getElementById('tercero_responsable_id').value, 10);
      const fechaInicio = document.getElementById('fecha_inicio_responsable').value;
      const observaciones = document.getElementById('observaciones_responsable').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.cajaMenor.asignarResponsable(terceroId, fechaInicio, observaciones);

        if (response.success) {
          App.closeModal();
          App.toast('Responsable de Caja Menor asignado con éxito');
          await this.renderForm();
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al asignar el responsable</div>`;
      }
    });
  },

  async showHistorialResponsablesCajaMenorModal() {
    const response = await window.api.cajaMenor.getHistorialResponsables();
    const historial = response.success ? response.data : [];

    const content = `
      <div class="modal-header">
        <h2>Historial de Responsables de Caja Menor</h2>
      </div>

      ${historial.length === 0 ? '<p style="color: #64748b;">Sin registros todavía.</p>' : `
        <table>
          <thead>
            <tr><th>Responsable</th><th>Desde</th><th>Hasta</th><th>Observaciones</th></tr>
          </thead>
          <tbody>
            ${historial.map(h => `
              <tr>
                <td>${h.nombre_razon_social}</td>
                <td>${h.fecha_inicio}</td>
                <td>${h.fecha_fin || 'Actual'}</td>
                <td>${h.observaciones || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
      </div>
    `;

    App.openModal(content);
  },

  async cambiarPassword() {
```

- [ ] **Step 5: Manual verification**

Run `npm start`, log in as Administrador, go to Configuración. Confirm the new "Caja Menor" card appears between "Datos de la Asociación" and "Seguridad", with the checkbox unchecked and saldo objetivo $0 (fresh state). Check the box, set saldo objetivo to $300,000, click "Guardar Caja Menor" — confirm the toast appears and the page re-renders with the checkbox still checked. Click "Cambiar Responsable", pick a tercero, submit — confirm "Responsable actual" updates. Click "Ver Historial de Responsables" — confirm it lists the assignment with `fecha_fin` = "Actual". Log out, log in as a non-Administrador role, confirm the whole "Caja Menor" card is absent (same as "Datos de la Asociación" today).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/js/configuracion.js
git commit -m "$(cat <<'EOF'
Agregar seccion Caja Menor a Configuracion: activa, saldo objetivo, responsable e historial

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: End-to-end verification and push

**Files:** none (verification only).

**Interfaces:** exercises every interface produced by Tasks 1-11 together.

- [ ] **Step 1: Regression check — Gasto por Banco and saldo a favor no longer crash**

This is the bug from spec section 8 (unrelated to Caja Menor itself, fixed in Task 1). Write and run:

```js
const path = require('path');
const projectDir = 'C:\\Users\\Brayhan\\Documents\\softwareAcueducto';
const DatabaseService = require(path.join(projectDir, 'src', 'database', 'DatabaseService'));
const GastoService = require(path.join(projectDir, 'src', 'services', 'GastoService'));
const svc = new DatabaseService(projectDir);
svc.initialize();

const gastoService = new GastoService(svc);
const unTercero = svc.db.prepare('SELECT id FROM terceros LIMIT 1').get();

const id = gastoService.create({
  fechaGasto: new Date().toISOString().split('T')[0],
  concepto: 'Prueba Task 12 - gasto por banco',
  tipoGasto: 'Gastos Diversos',
  tipoOperacion: 'Compra directa',
  terceroId: unTercero.id,
  valor: 15000,
  metodoPago: 'Transferencia'
}, null);
console.log('Gasto por Banco creado sin error, id:', id, '- antes de la migracion 029 esto lanzaba "cuenta de agrupacion"');

// limpieza
svc.db.prepare("DELETE FROM movimientos_contables WHERE asiento_id IN (SELECT id FROM asientos_contables WHERE referencia_tipo='Gasto' AND referencia_id=?)").run(id);
svc.db.prepare("DELETE FROM asientos_contables WHERE referencia_tipo='Gasto' AND referencia_id=?").run(id);
svc.db.prepare("DELETE FROM movimientos WHERE referencia_tipo='Gasto' AND referencia_id=?").run(id);
svc.db.prepare('DELETE FROM gastos WHERE id = ?').run(id);
svc.db.close();
```

Expected: prints the created id with no thrown error. If it throws `"cuenta de agrupación"`, Task 1's `cuentas_automaticas.BANCO` reassignment did not apply correctly — re-check the migration.

- [ ] **Step 2: Full manual UI walkthrough**

Run `npm start` and, as Administrador:
1. Configuración → Caja Menor: activate it, set saldo objetivo $200,000, assign a responsable.
2. Gastos → Nuevo Gasto: método de pago Efectivo, elegir "Caja Menor", valor $30,000, guardar. Confirm success toast.
3. Contabilidad → Libro Mayor (or equivalent report screen), filter by cuenta `110510 Caja Menor`: confirm the $30,000 débito line from step 2 appears... wait, it should be a **crédito** (gasto sale de la cuenta) — confirm the $30,000 line is a **crédito**, and the running saldo is -$30,000 relative to a zero starting point (or $-30,000 if no prior activity).
4. Caja y Bancos: confirm the Caja Menor card shows saldo actual $-30,000 (or however the negative reads — if this looks wrong, it's expected: an unfunded Caja Menor going negative on its first gasto is a legitimate edge case, not a bug — the organization should fund it before spending; note this to the user rather than treating it as a defect) and "+ Reembolsar Caja Menor" enabled with monto $230,000.
5. Click reembolsar, confirm it. Confirm the card now shows $200,000 de $200,000, button disabled.
6. Confirm "Saldo en Caja" (the general card) only reflects the $30,000 gasto egreso — not the reembolso.
7. Contabilidad → Libro Mayor de `110510`: confirm the reembolso débito line shows the responsable's name as tercero.

- [ ] **Step 3: Confirm no regressions in existing Gasto/Aporte flows**

Register one Gasto with método de pago Efectivo and Caja Menor selector left on "Caja General" (or Caja Menor left inactive, tested earlier) — confirm it still posts against `110505` and the Dashboard's "Saldo en Caja" decreases as before. Register one Aporte (efectivo) — confirm it still works exactly as before (no selector, always Caja General).

- [ ] **Step 4: Push**

Only after all of the above pass:

```bash
git log --oneline -15
git push
```

Confirm the push output shows the new commits landing on `origin/main` (or ask the user first if `origin` isn't already configured/expected — check `git remote -v` before pushing if unsure).
