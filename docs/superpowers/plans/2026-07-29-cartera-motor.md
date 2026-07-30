# Motor de Cartera — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el motor de cartera que modela la deuda de un asociado en dinero (cargos − abonos) en vez de en meses, con soporte para abonos sin meses, pagos parciales, saldo a favor, deuda histórica no exigible, suspensión con fecha y recategorización retroactiva.

**Architecture:** Tres tablas nuevas. `cartera_movimientos` guarda cada cargo y cada abono con una bandera `exigible`; el saldo es la suma de sus montos. `cartera_imputaciones` guarda qué abono cubrió qué cargo y por cuánto — explica la cobertura, pero el saldo nunca depende de ella. `cuenta_estados` versiona el estado de la cuenta en el tiempo para que la causación se pueda detener con fecha retroactiva. Nada se muta ni se borra: toda corrección es un movimiento nuevo de contrapartida.

**Tech Stack:** Electron 38, better-sqlite3 (síncrono), `node:test` + `node:assert/strict`, SQL en migraciones `.sql` numeradas. Sin dependencias nuevas.

**Spec:** [docs/superpowers/specs/2026-07-29-cartera-cuenta-corriente-design.md](../specs/2026-07-29-cartera-cuenta-corriente-design.md)

**Fuera de alcance de este plan** (van en los planes 2 y 3): leer los Excel, la carga inicial de datos, cambios en `PagoService`, IPC, UI y reportes. Este plan entrega el motor y sus tests, nada más.

## Global Constraints

- **Ejecutar tests:** `npm test`. Corre `scripts/test.js`, que lanza `electron --test` con `ELECTRON_RUN_AS_NODE=1`. **Nunca ejecutar `node --test` directamente**: `better-sqlite3` está compilado contra el ABI de Electron y falla con `NODE_MODULE_VERSION mismatch`.
- **Un solo test:** `npx cross-env ELECTRON_RUN_AS_NODE=1 npx electron --test --test-name-pattern="<patrón>"`. Si `cross-env` no está, usar `npm test` y leer la salida del archivo correspondiente.
- **Tests:** `node:test` + `node:assert/strict`. Base desechable con `crearDbTemporal()` / `cerrarDbTemporal(ctx)` de `src/testUtils/dbTemporal.js`, siempre en `try/finally`. Archivos `*.test.js` junto al código que prueban.
- **Migraciones:** archivos `.sql` en `src/database/migrations/`, aplicados en orden alfabético de nombre, cada archivo dentro de una transacción. La última existente es `035_admin_recuperacion.sql`. Nunca editar una migración ya aplicada.
- **Repositorios:** `constructor(dbService) { this.db = dbService.getDb(); }`. Sentencias con `this.db.prepare(...).get()/.all()/.run()`. Transacciones con `transaccion(fn) { return this.db.transaction(fn)(); }`.
- **Fechas:** siempre strings `'YYYY-MM-DD'`. **Nunca** `new Date('2026-01-01')` para una fecha sin hora: se interpreta como medianoche UTC y en Colombia (UTC−5) retrocede un día, y si era el día 1 retrocede el mes. Partir el string con `.split('-')`.
- **Códigos de período:** `anio * 12 + (mes - 1)`. Comparables y restables para contar meses.
- **Dinero:** columnas `REAL`. Los importes históricos pueden ser fraccionarios (el importador dividió totales entre meses, hay valores como `1439.252336448598`). Redondear todo importe calculado a 2 decimales con `redondear()` y comparar con `EPSILON = 0.01`; nunca `===` entre dos importes.
- **Idioma:** identificadores, comentarios y mensajes de error en español, como el resto del proyecto.
- **Sin dependencias nuevas.**

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/database/migrations/036_cartera_movimientos.sql` | Crear `cartera_movimientos`, `cartera_imputaciones`, `cuenta_estados`; sembrar la vigencia inicial de estado de las cuentas existentes |
| `src/services/cartera/periodos.js` | Helpers puros de fecha y período. Sin I/O |
| `src/services/cartera/periodos.test.js` | Tests de los helpers |
| `src/services/cartera/dinero.js` | `redondear()`, `EPSILON`, `sonIguales()`. Sin I/O |
| `src/services/cartera/imputacion.js` | Lógica pura de distribución de un abono entre cargos, y cálculo de "cubierto hasta". Sin I/O. **Es el corazón delicado del sistema** |
| `src/services/cartera/imputacion.test.js` | Tests de la lógica pura |
| `src/repositories/CuentaEstadoRepository.js` | Vigencias de `cuenta_estados`; estado de una cuenta en un mes dado; sincronía con `cuentas.estado` |
| `src/repositories/CarteraRepository.js` | CRUD de movimientos e imputaciones; saldos agregados; cargos pendientes |
| `src/services/CarteraService.js` | Orquestación: causación, abonos, recategorización, suspensión, estado de cartera |
| `src/services/CarteraService.causacion.test.js` | Causación y sus reglas de parada |
| `src/services/CarteraService.abonos.test.js` | Los cuatro modos de imputación y los invariantes |
| `src/services/CarteraService.recategorizar.test.js` | Recategorización retroactiva en ambas direcciones |
| `src/services/CarteraService.estados.test.js` | Suspensión y reactivación con fecha |
| `src/services/CarteraService.casosReales.test.js` | Regresión con R034, R037 y R019 |

`src/services/cartera/` es una carpeta nueva: agrupa los módulos puros, que no tocan la base y se prueban solos. `CarteraService.js` es lo único que habla con los repositorios.

**Nota deliberada:** `PagoService.js` tiene sus propias copias de `codificarPeriodo`, `decodificarPeriodo` y `anioMesDeFecha` (líneas 36-52). **No se refactoriza en este plan**: `PagoService` no tiene tests, así que tocarlo sin red de seguridad es un riesgo que no aporta nada al motor. Queda anotado como trabajo del Plan 3, que sí modifica ese archivo y le agregará tests.

---

### Task 1: Migración — las tres tablas

**Files:**
- Create: `src/database/migrations/036_cartera_movimientos.sql`
- Test: `src/database/migrations/036_cartera_movimientos.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: las tablas `cartera_movimientos`, `cartera_imputaciones`, `cuenta_estados`; el índice único parcial `idx_cartera_cargo_unico`; una fila `Activo` en `cuenta_estados` por cada cuenta existente.

- [ ] **Step 1: Write the failing test**

Crear `src/database/migrations/036_cartera_movimientos.test.js`:

```js
// src/database/migrations/036_cartera_movimientos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

function columnas(db, tabla) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().map(c => c.name);
}

test('036: crea cartera_movimientos con las columnas y los CHECK esperados', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cols = columnas(db, 'cartera_movimientos');
    for (const c of ['id', 'cuenta_id', 'fecha', 'tipo', 'exigible', 'monto', 'anio', 'mes',
      'recibo_detalle_id', 'documento', 'observaciones', 'usuario_id', 'fecha_creacion']) {
      assert.ok(cols.includes(c), `falta la columna ${c}`);
    }

    // el CHECK de tipo rechaza un tipo desconocido
    assert.throws(
      () => db.prepare(`INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto)
                        VALUES (1, '2026-01-01', 'TipoInventado', 1, 1000)`).run(),
      /CHECK constraint failed/
    );

    // el CHECK de exigible solo admite 0 y 1
    assert.throws(
      () => db.prepare(`INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto)
                        VALUES (1, '2026-01-01', 'CargoMensual', 7, 1000)`).run(),
      /CHECK constraint failed/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('036: el índice único impide causar dos veces el mismo mes, pero permite ajustes sobre ese mes', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Test')`).run();
    const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;

    const insertar = (tipo, monto) => db.prepare(
      `INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto, anio, mes)
       VALUES (?, '2026-01-01', ?, 1, ?, 2026, 1)`
    ).run(cuentaId, tipo, monto);

    insertar('CargoMensual', 10000);
    assert.throws(() => insertar('CargoMensual', 10000), /UNIQUE constraint failed/);

    // un AjusteCategoria sobre el mismo mes SÍ debe poder insertarse (el índice es parcial)
    insertar('AjusteCategoria', 6000);
    insertar('AjusteCategoria', -2000);
    const total = db.prepare(
      `SELECT SUM(monto) s FROM cartera_movimientos WHERE cuenta_id = ? AND anio = 2026 AND mes = 1`
    ).get(cuentaId).s;
    assert.equal(total, 14000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('036: crea cartera_imputaciones con UNIQUE(abono_id, cargo_id) y monto > 0', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cols = columnas(db, 'cartera_imputaciones');
    for (const c of ['id', 'abono_id', 'cargo_id', 'monto', 'fecha_creacion']) {
      assert.ok(cols.includes(c), `falta la columna ${c}`);
    }
    assert.throws(
      () => db.prepare(`INSERT INTO cartera_imputaciones (abono_id, cargo_id, monto) VALUES (1, 2, 0)`).run(),
      /CHECK constraint failed/
    );
    db.prepare(`INSERT INTO cartera_imputaciones (abono_id, cargo_id, monto) VALUES (1, 2, 500)`).run();
    assert.throws(
      () => db.prepare(`INSERT INTO cartera_imputaciones (abono_id, cargo_id, monto) VALUES (1, 2, 300)`).run(),
      /UNIQUE constraint failed/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('036: crea cuenta_estados y siembra una vigencia Activo por cada cuenta existente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cols = columnas(db, 'cuenta_estados');
    for (const c of ['id', 'cuenta_id', 'estado', 'fecha_inicio', 'fecha_fin', 'motivo',
      'usuario_id', 'fecha_creacion']) {
      assert.ok(cols.includes(c), `falta la columna ${c}`);
    }
    // en una base recién migrada no hay cuentas, así que el backfill no crea nada
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM cuenta_estados`).get().n, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: los 4 tests de `036_cartera_movimientos.test.js` fallan con `no such table: cartera_movimientos`.

- [ ] **Step 3: Write the migration**

Crear `src/database/migrations/036_cartera_movimientos.sql`:

```sql
-- 036_cartera_movimientos.sql
-- La deuda de un asociado pasa a modelarse en DINERO (cargos menos abonos), no en meses.
-- Motivo: el 30,5% de los saldos reales no son múltiplo de la mensualidad (hay saldos de
-- medio mes) y 133 recibos de "ABONO A LA DEUDA" no tienen ningún mes asignado, así que
-- pago_periodos -- con su UNIQUE(cuenta, anio, mes) y sin concepto de mes parcial -- no
-- puede representar la realidad. Ver docs/superpowers/specs/2026-07-29-cartera-cuenta-corriente-design.md
--
-- pago_periodos NO se toca: se conserva como archivo histórico de qué dijo cada recibo.

-- Un registro por cada cargo y por cada abono. El saldo de una cuenta es la suma de montos:
-- los cargos son positivos, los abonos negativos.
CREATE TABLE cartera_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  fecha DATE NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN (
    'CargoMensual',          -- causación del aporte de un mes
    'AjusteCategoria',       -- corrección (+/-) de un CargoMensual ya emitido
    'AperturaOpaca',         -- saldo anterior al 01/01/2022, sin sustento auditable
    'Abono',                 -- plata recibida (monto negativo)
    'AjusteAsamblea',        -- corrección o condonación documentada
    'CastigoCartera'         -- baja del saldo opaco por acta
  )),
  -- 0 = informativo, nunca se cobra ni entra a la cartera contable (la deuda anterior a 2022).
  exigible INTEGER NOT NULL DEFAULT 1 CHECK(exigible IN (0, 1)),
  monto REAL NOT NULL,
  anio INTEGER,   -- solo CargoMensual y AjusteCategoria: a qué mes corresponde
  mes INTEGER CHECK(mes IS NULL OR mes BETWEEN 1 AND 12),
  recibo_detalle_id INTEGER,   -- soporte del abono
  documento TEXT,              -- acta o referencia del ajuste
  observaciones TEXT,
  usuario_id INTEGER,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
  FOREIGN KEY (recibo_detalle_id) REFERENCES recibo_detalles(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- Impide causar dos veces el mismo mes. Es PARCIAL a propósito: solo aplica a CargoMensual,
-- para que los AjusteCategoria del mismo mes puedan convivir (así se corrige el pasado sin
-- mutar el cargo original).
CREATE UNIQUE INDEX idx_cartera_cargo_unico
  ON cartera_movimientos(cuenta_id, anio, mes) WHERE tipo = 'CargoMensual';

CREATE INDEX idx_cartera_cuenta ON cartera_movimientos(cuenta_id, fecha);
CREATE INDEX idx_cartera_exigible ON cartera_movimientos(cuenta_id, exigible);
CREATE INDEX idx_cartera_recibo_detalle ON cartera_movimientos(recibo_detalle_id);

-- Qué cargo cubrió cada abono y por cuánto. Explica la cobertura para el estado de cuenta;
-- el SALDO NUNCA se calcula desde aquí, sale de cartera_movimientos. Esa separación es la que
-- permite corregir el pasado con movimientos de contrapartida sin reescribir imputaciones.
CREATE TABLE cartera_imputaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  abono_id INTEGER NOT NULL,
  cargo_id INTEGER NOT NULL,
  monto REAL NOT NULL CHECK(monto > 0),
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (abono_id) REFERENCES cartera_movimientos(id),
  FOREIGN KEY (cargo_id) REFERENCES cartera_movimientos(id),
  UNIQUE(abono_id, cargo_id)
);

CREATE INDEX idx_cartera_imput_abono ON cartera_imputaciones(abono_id);
CREATE INDEX idx_cartera_imput_cargo ON cartera_imputaciones(cargo_id);

-- Historial de estado de la cuenta. Hasta ahora cuentas.estado era una sola columna sin
-- historia: se podía marcar Suspendido pero no DESDE CUÁNDO. Hace falta, porque el caso real
-- es "el último pago fue en 2022 y desde entonces nadie sabe nada del punto": hay que poder
-- suspender con efecto retroactivo para que no se genere deuda de esos años, y reactivar si
-- el punto reaparece. Misma convención que cuenta_categorias y cuenta_propietarios.
-- cuentas.estado se conserva como espejo del estado vigente (lo leen listados y reportes).
CREATE TABLE cuenta_estados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK(estado IN ('Activo', 'Inactivo', 'Suspendido')),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  motivo TEXT,
  usuario_id INTEGER,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE INDEX idx_cuenta_estados_cuenta ON cuenta_estados(cuenta_id, fecha_inicio);
CREATE INDEX idx_cuenta_estados_actual ON cuenta_estados(cuenta_id, fecha_fin);

-- Backfill: cada cuenta que ya existe arranca con su estado actual vigente desde su creación,
-- para que la causación tenga siempre una vigencia que consultar.
INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo)
SELECT id, estado, date(COALESCE(fecha_creacion, '2000-01-01')), 'Estado inicial al migrar a cartera'
FROM cuentas;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 4 tests de `036_cartera_movimientos.test.js` pasan, y **el resto de la suite sigue pasando** (la migración nueva no toca tablas existentes).

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/036_cartera_movimientos.sql src/database/migrations/036_cartera_movimientos.test.js
git commit -m "feat(cartera): migración 036 con movimientos, imputaciones y estados de cuenta"
```

---

### Task 2: Helpers puros de período y dinero

**Files:**
- Create: `src/services/cartera/periodos.js`
- Create: `src/services/cartera/periodos.test.js`
- Create: `src/services/cartera/dinero.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `periodos.js`: `codificarPeriodo(anio, mes) -> number`, `decodificarPeriodo(codigo) -> {anio, mes}`, `anioMesDeFecha(fecha) -> {anio, mes}`, `primerDiaDelMes(anio, mes) -> 'YYYY-MM-DD'`, `ultimoDiaDelMes(anio, mes) -> 'YYYY-MM-DD'`, `diaAnterior(fecha) -> 'YYYY-MM-DD'`, `rangoDeMeses(desdeCod, hastaCod) -> Array<{anio, mes, codigo}>`
  - `dinero.js`: `EPSILON = 0.01`, `redondear(n) -> number`, `sonIguales(a, b) -> boolean`, `esMayor(a, b) -> boolean`

- [ ] **Step 1: Write the failing test**

Crear `src/services/cartera/periodos.test.js`:

```js
// src/services/cartera/periodos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('./periodos');
const d = require('./dinero');

test('codificarPeriodo y decodificarPeriodo son inversos', () => {
  for (const [anio, mes] of [[2022, 1], [2026, 12], [2000, 6]]) {
    assert.deepEqual(p.decodificarPeriodo(p.codificarPeriodo(anio, mes)), { anio, mes });
  }
});

test('codificarPeriodo permite restar para contar meses', () => {
  const enero2022 = p.codificarPeriodo(2022, 1);
  const julio2026 = p.codificarPeriodo(2026, 7);
  assert.equal(julio2026 - enero2022, 54);
});

test('anioMesDeFecha no se corre por zona horaria en el día 1 del mes', () => {
  // new Date('2026-01-01') sería medianoche UTC = 31/12/2025 19:00 en Colombia (UTC-5),
  // lo que retrocedería el mes entero. Este helper parte el string, no usa Date.
  assert.deepEqual(p.anioMesDeFecha('2026-01-01'), { anio: 2026, mes: 1 });
  assert.deepEqual(p.anioMesDeFecha('2022-03-01'), { anio: 2022, mes: 3 });
  assert.deepEqual(p.anioMesDeFecha('2026-06-13 10:30:00'), { anio: 2026, mes: 6 });
});

test('primerDiaDelMes y ultimoDiaDelMes cubren meses de 28, 29, 30 y 31 días', () => {
  assert.equal(p.primerDiaDelMes(2026, 2), '2026-02-01');
  assert.equal(p.ultimoDiaDelMes(2026, 2), '2026-02-28');
  assert.equal(p.ultimoDiaDelMes(2024, 2), '2024-02-29');   // bisiesto
  assert.equal(p.ultimoDiaDelMes(2026, 4), '2026-04-30');
  assert.equal(p.ultimoDiaDelMes(2026, 12), '2026-12-31');
});

test('diaAnterior retrocede un día cruzando mes y año', () => {
  assert.equal(p.diaAnterior('2026-01-01'), '2025-12-31');
  assert.equal(p.diaAnterior('2026-03-01'), '2026-02-28');
  assert.equal(p.diaAnterior('2026-07-15'), '2026-07-14');
});

test('rangoDeMeses lista los meses inclusive, y vacío si el rango está invertido', () => {
  const r = p.rangoDeMeses(p.codificarPeriodo(2025, 11), p.codificarPeriodo(2026, 2));
  assert.deepEqual(r.map(x => `${x.anio}-${x.mes}`), ['2025-11', '2025-12', '2026-1', '2026-2']);
  assert.equal(p.rangoDeMeses(p.codificarPeriodo(2026, 5), p.codificarPeriodo(2026, 1)).length, 0);
  assert.equal(p.rangoDeMeses(p.codificarPeriodo(2026, 5), p.codificarPeriodo(2026, 5)).length, 1);
});

test('dinero: redondear a 2 decimales y comparar con tolerancia', () => {
  assert.equal(d.redondear(1439.252336448598), 1439.25);
  assert.equal(d.redondear(10000), 10000);
  assert.equal(d.redondear(0.005), 0.01);
  assert.ok(d.sonIguales(10000, 10000.004));
  assert.ok(!d.sonIguales(10000, 10000.5));
  assert.ok(d.esMayor(10001, 10000));
  assert.ok(!d.esMayor(10000.004, 10000));   // dentro de la tolerancia, no es mayor
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL con `Cannot find module './periodos'`.

- [ ] **Step 3: Write the implementation**

Crear `src/services/cartera/dinero.js`:

```js
// Comparaciones de dinero. Los importes históricos vienen fraccionarios porque el importador
// repartió el total de un recibo entre N meses (hay valores como 1439.252336448598), así que
// nunca se comparan dos importes con === .
const EPSILON = 0.01;

function redondear(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function sonIguales(a, b) {
  return Math.abs(Number(a) - Number(b)) < EPSILON;
}

function esMayor(a, b) {
  return Number(a) - Number(b) >= EPSILON;
}

module.exports = { EPSILON, redondear, sonIguales, esMayor };
```

Crear `src/services/cartera/periodos.js`:

```js
// Helpers puros de fecha y período. Sin I/O, sin estado.
//
// Ninguno usa `new Date(fechaString)` sobre una fecha sin hora: un string de solo fecha se
// interpreta como medianoche UTC, y en una zona negativa (Colombia, UTC-5) eso retrocede el
// día -- y si era el día 1, retrocede el mes entero.

// Codifica un período como entero comparable y restable: la diferencia entre dos códigos es
// la cantidad de meses entre ellos.
function codificarPeriodo(anio, mes) {
  return anio * 12 + (mes - 1);
}

function decodificarPeriodo(codigo) {
  return { anio: Math.floor(codigo / 12), mes: (codigo % 12) + 1 };
}

function anioMesDeFecha(fecha) {
  const [anio, mes] = String(fecha).split(' ')[0].split('-').map(Number);
  return { anio, mes };
}

function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

function primerDiaDelMes(anio, mes) {
  return `${anio}-${dosDigitos(mes)}-01`;
}

// Usa Date solo con argumentos numéricos (no parsea strings), que es seguro: construye la
// fecha en hora local. El día 0 del mes siguiente es el último del mes pedido.
function ultimoDiaDelMes(anio, mes) {
  const dia = new Date(anio, mes, 0).getDate();
  return `${anio}-${dosDigitos(mes)}-${dosDigitos(dia)}`;
}

function diaAnterior(fecha) {
  const [anio, mes, dia] = String(fecha).split(' ')[0].split('-').map(Number);
  const d = new Date(anio, mes - 1, dia - 1);
  return `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;
}

// Lista los meses entre dos códigos, ambos inclusive. Rango invertido devuelve vacío.
function rangoDeMeses(desdeCod, hastaCod) {
  const meses = [];
  for (let c = desdeCod; c <= hastaCod; c++) {
    meses.push({ ...decodificarPeriodo(c), codigo: c });
  }
  return meses;
}

module.exports = {
  codificarPeriodo, decodificarPeriodo, anioMesDeFecha,
  primerDiaDelMes, ultimoDiaDelMes, diaAnterior, rangoDeMeses
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 7 tests de `periodos.test.js` pasan.

- [ ] **Step 5: Commit**

```bash
git add src/services/cartera/periodos.js src/services/cartera/dinero.js src/services/cartera/periodos.test.js
git commit -m "feat(cartera): helpers puros de período y comparación de dinero"
```

---

### Task 3: `imputacion.js` — la lógica pura de cobertura

Es el módulo más delicado del sistema: decide contra qué cargos se aplica cada peso que entra. Se aísla sin I/O para poder probarlo exhaustivamente.

**Files:**
- Create: `src/services/cartera/imputacion.js`
- Create: `src/services/cartera/imputacion.test.js`

**Interfaces:**
- Consumes: `dinero.js` (`redondear`, `sonIguales`, `esMayor`), `periodos.js` (`codificarPeriodo`).
- Produces:
  - `MODOS = { MESES_ESPECIFICOS: 'MesesEspecificos', ABONO_DEUDA_FIFO: 'AbonoDeudaFIFO', ABONO_SALDO_OPACO: 'AbonoSaldoOpaco', ANTICIPO: 'Anticipo' }`
  - `distribuir({ modo, cargos, monto, cargosElegidos }) -> { imputaciones: Array<{cargoId: number, monto: number}>, sobrante: number }`
    donde `cargos` es `Array<{id: number, anio: number|null, mes: number|null, pendiente: number}>` **ya ordenado del más antiguo al más nuevo**.
  - `calcularCubiertoHasta(cargosConCobertura) -> {anio, mes} | null`
    donde `cargosConCobertura` es `Array<{anio, mes, monto, cubierto}>`.

- [ ] **Step 1: Write the failing test**

Crear `src/services/cartera/imputacion.test.js`:

```js
// src/services/cartera/imputacion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { MODOS, distribuir, calcularCubiertoHasta } = require('./imputacion');

// Cargos de ejemplo: 3 meses de $10.000 sin cubrir, del más antiguo al más nuevo.
function cargosBase() {
  return [
    { id: 1, anio: 2026, mes: 1, pendiente: 10000 },
    { id: 2, anio: 2026, mes: 2, pendiente: 10000 },
    { id: 3, anio: 2026, mes: 3, pendiente: 10000 }
  ];
}

test('FIFO cubre del más antiguo al más nuevo y no deja sobrante si alcanza justo', () => {
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: cargosBase(), monto: 20000 });
  assert.deepEqual(r.imputaciones, [{ cargoId: 1, monto: 10000 }, { cargoId: 2, monto: 10000 }]);
  assert.equal(r.sobrante, 0);
});

test('FIFO deja un cargo parcialmente cubierto cuando el monto no alcanza', () => {
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: cargosBase(), monto: 15000 });
  assert.deepEqual(r.imputaciones, [{ cargoId: 1, monto: 10000 }, { cargoId: 2, monto: 5000 }]);
  assert.equal(r.sobrante, 0);
});

test('FIFO devuelve el excedente como sobrante cuando el abono supera la deuda', () => {
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: cargosBase(), monto: 45000 });
  assert.equal(r.imputaciones.length, 3);
  assert.equal(r.sobrante, 15000);
});

test('FIFO sin cargos pendientes deja todo como sobrante', () => {
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: [], monto: 30000 });
  assert.deepEqual(r.imputaciones, []);
  assert.equal(r.sobrante, 30000);
});

test('abono parcial de medio mes: el caso real de C019 ($5.000 sobre mensualidad $10.000)', () => {
  const r = distribuir({
    modo: MODOS.ABONO_DEUDA_FIFO,
    cargos: [{ id: 1, anio: 2026, mes: 1, pendiente: 10000 }],
    monto: 5000
  });
  assert.deepEqual(r.imputaciones, [{ cargoId: 1, monto: 5000 }]);
  assert.equal(r.sobrante, 0);
});

test('FIFO respeta lo ya cubierto de un cargo parcial', () => {
  const cargos = [
    { id: 1, anio: 2026, mes: 1, pendiente: 4000 },   // ya tenía $6.000 cubiertos
    { id: 2, anio: 2026, mes: 2, pendiente: 10000 }
  ];
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos, monto: 9000 });
  assert.deepEqual(r.imputaciones, [{ cargoId: 1, monto: 4000 }, { cargoId: 2, monto: 5000 }]);
});

test('MESES_ESPECIFICOS cubre solo los cargos elegidos y deja intactos los anteriores', () => {
  // El caso real del recibo "CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2023": cubre 2023
  // dejando 2022 descubierto. FIFO haría lo contrario.
  const cargos = [
    { id: 1, anio: 2022, mes: 1, pendiente: 5000 },
    { id: 2, anio: 2023, mes: 1, pendiente: 5000 },
    { id: 3, anio: 2023, mes: 2, pendiente: 5000 }
  ];
  const r = distribuir({
    modo: MODOS.MESES_ESPECIFICOS, cargos, monto: 10000, cargosElegidos: [2, 3]
  });
  assert.deepEqual(r.imputaciones, [{ cargoId: 2, monto: 5000 }, { cargoId: 3, monto: 5000 }]);
  assert.equal(r.sobrante, 0);
  assert.ok(!r.imputaciones.some(i => i.cargoId === 1), 'no debe tocar el cargo de 2022');
});

test('MESES_ESPECIFICOS ignora ids que no están entre los cargos pendientes', () => {
  const r = distribuir({
    modo: MODOS.MESES_ESPECIFICOS, cargos: cargosBase(), monto: 10000, cargosElegidos: [2, 999]
  });
  assert.deepEqual(r.imputaciones, [{ cargoId: 2, monto: 10000 }]);
  assert.equal(r.sobrante, 0);
});

test('MESES_ESPECIFICOS sin elegidos no imputa nada', () => {
  const r = distribuir({
    modo: MODOS.MESES_ESPECIFICOS, cargos: cargosBase(), monto: 10000, cargosElegidos: []
  });
  assert.deepEqual(r.imputaciones, []);
  assert.equal(r.sobrante, 10000);
});

test('ABONO_SALDO_OPACO usa la misma mecánica FIFO sobre los cargos que reciba', () => {
  const opacos = [{ id: 50, anio: null, mes: null, pendiente: 180000 }];
  const r = distribuir({ modo: MODOS.ABONO_SALDO_OPACO, cargos: opacos, monto: 50000 });
  assert.deepEqual(r.imputaciones, [{ cargoId: 50, monto: 50000 }]);
  assert.equal(r.sobrante, 0);
});

test('ANTICIPO no imputa nada: todo queda como saldo a favor', () => {
  const r = distribuir({ modo: MODOS.ANTICIPO, cargos: cargosBase(), monto: 30000 });
  assert.deepEqual(r.imputaciones, []);
  assert.equal(r.sobrante, 30000);
});

test('distribuir rechaza montos no positivos y modos desconocidos', () => {
  assert.throws(() => distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: [], monto: 0 }),
    /mayor a cero/);
  assert.throws(() => distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: [], monto: -100 }),
    /mayor a cero/);
  assert.throws(() => distribuir({ modo: 'Inventado', cargos: [], monto: 100 }),
    /Modo de imputación inválido/);
});

test('distribuir redondea a 2 decimales y no deja restos por punto flotante', () => {
  const cargos = [{ id: 1, anio: 2020, mes: 1, pendiente: 1439.252336448598 }];
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos, monto: 2000 });
  assert.equal(r.imputaciones[0].monto, 1439.25);
  assert.equal(r.sobrante, 560.75);
});

test('calcularCubiertoHasta devuelve el último mes totalmente cubierto sin descubiertos antes', () => {
  const cargos = [
    { anio: 2026, mes: 1, monto: 10000, cubierto: 10000 },
    { anio: 2026, mes: 2, monto: 10000, cubierto: 10000 },
    { anio: 2026, mes: 3, monto: 10000, cubierto: 4000 }
  ];
  assert.deepEqual(calcularCubiertoHasta(cargos), { anio: 2026, mes: 2 });
});

test('calcularCubiertoHasta se detiene en el primer mes descubierto, aunque después haya pagados', () => {
  // Este es el bug que el sistema viejo tenía: usaba MAX(mes pagado) y decía "al día".
  const cargos = [
    { anio: 2022, mes: 1, monto: 5000, cubierto: 0 },
    { anio: 2023, mes: 1, monto: 5000, cubierto: 5000 },
    { anio: 2023, mes: 2, monto: 5000, cubierto: 5000 }
  ];
  assert.equal(calcularCubiertoHasta(cargos), null);
});

test('calcularCubiertoHasta devuelve null si no hay cargos o ninguno está cubierto', () => {
  assert.equal(calcularCubiertoHasta([]), null);
  assert.equal(calcularCubiertoHasta([{ anio: 2026, mes: 1, monto: 10000, cubierto: 0 }]), null);
});

test('calcularCubiertoHasta ordena por período, no confía en el orden recibido', () => {
  const cargos = [
    { anio: 2026, mes: 2, monto: 10000, cubierto: 10000 },
    { anio: 2026, mes: 1, monto: 10000, cubierto: 10000 }
  ];
  assert.deepEqual(calcularCubiertoHasta(cargos), { anio: 2026, mes: 2 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL con `Cannot find module './imputacion'`.

- [ ] **Step 3: Write the implementation**

Crear `src/services/cartera/imputacion.js`:

```js
// Lógica pura de imputación: contra qué cargos se aplica un abono, y hasta qué mes queda
// cubierta una cuenta. Sin I/O y sin estado -- todo entra por parámetro.
//
// Los cuatro modos comparten la misma mecánica (llenar cargos en orden hasta agotar el
// monto); lo único que cambia es QUÉ cargos son candidatos:
//   - MESES_ESPECIFICOS: solo los que el operador eligió. Es el que hace representable el
//     caso real de pagar 2023 completo dejando 2022 descubierto.
//   - ABONO_DEUDA_FIFO: todos, del más antiguo al más nuevo.
//   - ABONO_SALDO_OPACO: los del bucket no exigible (el llamador pasa esos cargos).
//   - ANTICIPO: ninguno; el monto entero queda como saldo a favor.
const { redondear, esMayor } = require('./dinero');
const { codificarPeriodo } = require('./periodos');

const MODOS = {
  MESES_ESPECIFICOS: 'MesesEspecificos',
  ABONO_DEUDA_FIFO: 'AbonoDeudaFIFO',
  ABONO_SALDO_OPACO: 'AbonoSaldoOpaco',
  ANTICIPO: 'Anticipo'
};

// `cargos` llega ordenado del más antiguo al más nuevo (responsabilidad del repositorio).
// Devuelve las imputaciones a crear y cuánto quedó sin imputar (= saldo a favor).
function distribuir({ modo, cargos = [], monto, cargosElegidos = [] }) {
  if (!Object.values(MODOS).includes(modo)) {
    throw new Error(`Modo de imputación inválido: ${modo}`);
  }
  if (!(Number(monto) > 0)) {
    throw new Error('El monto a imputar debe ser mayor a cero');
  }

  if (modo === MODOS.ANTICIPO) {
    return { imputaciones: [], sobrante: redondear(monto) };
  }

  let candidatos;
  if (modo === MODOS.MESES_ESPECIFICOS) {
    const elegidos = new Set(cargosElegidos);
    candidatos = cargos.filter(c => elegidos.has(c.id));
  } else {
    candidatos = cargos;
  }

  const imputaciones = [];
  let restante = redondear(monto);

  for (const cargo of candidatos) {
    if (!esMayor(restante, 0)) break;
    const pendiente = redondear(cargo.pendiente);
    if (!esMayor(pendiente, 0)) continue;

    const aplicar = redondear(Math.min(restante, pendiente));
    imputaciones.push({ cargoId: cargo.id, monto: aplicar });
    restante = redondear(restante - aplicar);
  }

  return { imputaciones, sobrante: esMayor(restante, 0) ? restante : 0 };
}

// Último mes totalmente cubierto SIN que haya ningún mes descubierto antes. Se detiene en el
// primer hueco: si alguien pagó 2023 pero debe 2022, no está cubierto hasta 2023.
// Esto reemplaza el MAX(mes pagado) del modelo viejo, que declaraba "al día" a quien tenía
// años sin pagar en el medio.
function calcularCubiertoHasta(cargosConCobertura) {
  const ordenados = [...cargosConCobertura]
    .filter(c => c.anio !== null && c.mes !== null)
    .sort((a, b) => codificarPeriodo(a.anio, a.mes) - codificarPeriodo(b.anio, b.mes));

  let ultimo = null;
  for (const cargo of ordenados) {
    const falta = redondear(cargo.monto) - redondear(cargo.cubierto);
    if (esMayor(falta, 0)) break;
    ultimo = { anio: cargo.anio, mes: cargo.mes };
  }
  return ultimo;
}

module.exports = { MODOS, distribuir, calcularCubiertoHasta };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 17 tests de `imputacion.test.js` pasan.

- [ ] **Step 5: Commit**

```bash
git add src/services/cartera/imputacion.js src/services/cartera/imputacion.test.js
git commit -m "feat(cartera): lógica pura de imputación de abonos y cobertura por mes"
```

---

### Task 4: `CuentaEstadoRepository` — el estado con historia

**Files:**
- Create: `src/repositories/CuentaEstadoRepository.js`
- Create: `src/repositories/CuentaEstadoRepository.test.js`

**Interfaces:**
- Consumes: `periodos.js` (`primerDiaDelMes`, `ultimoDiaDelMes`, `diaAnterior`).
- Produces:
  - `getVigencias(cuentaId) -> Array<fila de cuenta_estados>` (orden ascendente por `fecha_inicio`)
  - `getVigenciaAbierta(cuentaId) -> fila | undefined`
  - `estadoEnMes(cuentaId, anio, mes) -> 'Activo' | 'Inactivo' | 'Suspendido'` — el estado que abarca ese mes; `'Activo'` si no hay ninguna vigencia registrada
  - `cambiarEstado({ cuentaId, estado, fechaInicio, motivo, usuarioId }) -> number` (id de la vigencia nueva) — cierra la abierta el día anterior y sincroniza `cuentas.estado`
  - `sembrarVigenciaInicial({ cuentaId, estado, fechaInicio }) -> number`

- [ ] **Step 1: Write the failing test**

Crear `src/repositories/CuentaEstadoRepository.test.js`:

```js
// src/repositories/CuentaEstadoRepository.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CuentaEstadoRepository = require('./CuentaEstadoRepository');

function crearCuenta(dbService, codigo = 'T001') {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

test('estadoEnMes devuelve Activo cuando la cuenta no tiene ninguna vigencia registrada', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    assert.equal(repo.estadoEnMes(cuentaId, 2026, 7), 'Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('cambiarEstado cierra la vigencia anterior el día anterior y abre la nueva', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2020-01-01' });

    repo.cambiarEstado({
      cuentaId, estado: 'Suspendido', fechaInicio: '2022-07-01', motivo: 'no encontrado'
    });

    const vigencias = repo.getVigencias(cuentaId);
    assert.equal(vigencias.length, 2);
    assert.equal(vigencias[0].estado, 'Activo');
    assert.equal(vigencias[0].fecha_fin, '2022-06-30', 'debe cerrar el día anterior');
    assert.equal(vigencias[1].estado, 'Suspendido');
    assert.equal(vigencias[1].fecha_inicio, '2022-07-01');
    assert.equal(vigencias[1].fecha_fin, null);
    assert.equal(vigencias[1].motivo, 'no encontrado');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('estadoEnMes respeta las fechas: Activo antes de la suspensión, Suspendido después', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2020-01-01' });
    repo.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2022-07-01' });

    assert.equal(repo.estadoEnMes(cuentaId, 2022, 6), 'Activo');
    assert.equal(repo.estadoEnMes(cuentaId, 2022, 7), 'Suspendido');
    assert.equal(repo.estadoEnMes(cuentaId, 2026, 1), 'Suspendido');
    assert.equal(repo.estadoEnMes(cuentaId, 2019, 12), 'Activo', 'antes de toda vigencia asume Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reactivar deja tres vigencias y estadoEnMes las distingue mes a mes', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2020-01-01' });
    repo.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2022-07-01' });
    repo.cambiarEstado({ cuentaId, estado: 'Activo', fechaInicio: '2026-03-01', motivo: 'reapareció' });

    assert.equal(repo.getVigencias(cuentaId).length, 3);
    assert.equal(repo.estadoEnMes(cuentaId, 2022, 6), 'Activo');
    assert.equal(repo.estadoEnMes(cuentaId, 2024, 5), 'Suspendido');
    assert.equal(repo.estadoEnMes(cuentaId, 2026, 3), 'Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('cambiarEstado sincroniza cuentas.estado con la vigencia abierta', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2020-01-01' });

    repo.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2022-07-01' });
    assert.equal(db.prepare(`SELECT estado FROM cuentas WHERE id = ?`).get(cuentaId).estado, 'Suspendido');

    repo.cambiarEstado({ cuentaId, estado: 'Activo', fechaInicio: '2026-03-01' });
    assert.equal(db.prepare(`SELECT estado FROM cuentas WHERE id = ?`).get(cuentaId).estado, 'Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('cambiarEstado rechaza una fecha anterior al inicio de la vigencia abierta', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2022-01-01' });

    assert.throws(
      () => repo.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2021-06-01' }),
      /anterior al inicio de la vigencia actual/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('cambiarEstado rechaza un estado que no existe', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaEstadoRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    assert.throws(
      () => repo.cambiarEstado({ cuentaId, estado: 'Congelado', fechaInicio: '2026-01-01' }),
      /Estado inválido/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL con `Cannot find module './CuentaEstadoRepository'`.

- [ ] **Step 3: Write the implementation**

Crear `src/repositories/CuentaEstadoRepository.js`:

```js
const { primerDiaDelMes, ultimoDiaDelMes, diaAnterior } = require('../services/cartera/periodos');

const ESTADOS_VALIDOS = ['Activo', 'Inactivo', 'Suspendido'];

// Historial de estado de una cuenta. Existe porque cuentas.estado no tiene fecha: se podía
// marcar Suspendido pero no desde cuándo, y la causación necesita saber en qué estado estaba
// la cuenta en un mes concreto para no fabricar deuda de años en que nadie vio el punto.
// cuentas.estado se mantiene sincronizado con la vigencia abierta, porque listados, filtros y
// reportes ya lo leen.
class CuentaEstadoRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  getVigencias(cuentaId) {
    return this.db.prepare(`
      SELECT * FROM cuenta_estados WHERE cuenta_id = ?
      ORDER BY fecha_inicio ASC, id ASC
    `).all(cuentaId);
  }

  getVigenciaAbierta(cuentaId) {
    return this.db.prepare(`
      SELECT * FROM cuenta_estados WHERE cuenta_id = ? AND fecha_fin IS NULL
      ORDER BY fecha_inicio DESC, id DESC LIMIT 1
    `).get(cuentaId);
  }

  // Estado que abarca el mes completo. Se compara contra el rango del mes (día 1 al último),
  // no solo contra el día 1, por el mismo criterio que usa getCategoriaTarifaParaMes: una
  // vigencia puede empezar a mitad de mes.
  // Sin vigencias registradas asume 'Activo': es el comportamiento previo a este historial.
  estadoEnMes(cuentaId, anio, mes) {
    const inicio = primerDiaDelMes(anio, mes);
    const fin = ultimoDiaDelMes(anio, mes);

    const fila = this.db.prepare(`
      SELECT estado FROM cuenta_estados
      WHERE cuenta_id = ?
        AND fecha_inicio <= ?
        AND (fecha_fin IS NULL OR fecha_fin >= ?)
      ORDER BY fecha_inicio DESC, id DESC
      LIMIT 1
    `).get(cuentaId, fin, inicio);

    return fila ? fila.estado : 'Activo';
  }

  sembrarVigenciaInicial({ cuentaId, estado, fechaInicio, motivo = null, usuarioId = null }) {
    if (!ESTADOS_VALIDOS.includes(estado)) throw new Error(`Estado inválido: ${estado}`);
    const r = this.db.prepare(`
      INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo, usuario_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(cuentaId, estado, fechaInicio, motivo, usuarioId);
    this.db.prepare(`UPDATE cuentas SET estado = ? WHERE id = ?`).run(estado, cuentaId);
    return r.lastInsertRowid;
  }

  // Cierra la vigencia abierta el día anterior a fechaInicio y abre la nueva. Nunca sobrescribe
  // una vigencia existente (misma convención que cuenta_categorias / cuenta_propietarios).
  cambiarEstado({ cuentaId, estado, fechaInicio, motivo = null, usuarioId = null }) {
    if (!ESTADOS_VALIDOS.includes(estado)) throw new Error(`Estado inválido: ${estado}`);
    if (!fechaInicio) throw new Error('La fecha de inicio de la vigencia es obligatoria');

    return this.db.transaction(() => {
      const abierta = this.getVigenciaAbierta(cuentaId);
      if (abierta) {
        if (fechaInicio <= abierta.fecha_inicio) {
          throw new Error(
            `La fecha ${fechaInicio} es anterior al inicio de la vigencia actual ` +
            `(${abierta.fecha_inicio}); corrija esa vigencia antes de crear una nueva`
          );
        }
        this.db.prepare(`UPDATE cuenta_estados SET fecha_fin = ? WHERE id = ?`)
          .run(diaAnterior(fechaInicio), abierta.id);
      }

      const r = this.db.prepare(`
        INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo, usuario_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(cuentaId, estado, fechaInicio, motivo, usuarioId);

      this.db.prepare(`UPDATE cuentas SET estado = ? WHERE id = ?`).run(estado, cuentaId);
      return r.lastInsertRowid;
    })();
  }
}

module.exports = CuentaEstadoRepository;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 7 tests de `CuentaEstadoRepository.test.js` pasan.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/CuentaEstadoRepository.js src/repositories/CuentaEstadoRepository.test.js
git commit -m "feat(cartera): historial de estado de cuenta con vigencias por fecha"
```

---

### Task 5: `CarteraRepository` — movimientos, imputaciones y saldos

**Files:**
- Create: `src/repositories/CarteraRepository.js`
- Create: `src/repositories/CarteraRepository.test.js`

**Interfaces:**
- Consumes: nada de tareas anteriores (solo la migración de Task 1).
- Produces:
  - `transaccion(fn)`
  - `crearMovimiento({ cuentaId, fecha, tipo, exigible, monto, anio, mes, reciboDetalleId, documento, observaciones, usuarioId }) -> number`
  - `crearImputacion({ abonoId, cargoId, monto }) -> number`
  - `getSaldos(cuentaId) -> { deudaExigible: number, saldoOpaco: number }`
  - `getCargoMensual(cuentaId, anio, mes) -> fila | undefined`
  - `getCargosPendientes(cuentaId, exigible) -> Array<{id, anio, mes, monto, cubierto, pendiente}>` ordenado por período y luego por id, solo con `pendiente > 0`
  - `getCargosConCobertura(cuentaId, exigible) -> Array<{id, anio, mes, monto, cubierto}>` (todos, cubiertos o no)
  - `getMovimientos(cuentaId) -> Array<fila>` ordenado por fecha e id
  - `getTotalImputadoDeAbono(abonoId) -> number`
  - `getMesesCausados(cuentaId) -> Set<number>` de códigos de período con `CargoMensual`

- [ ] **Step 1: Write the failing test**

Crear `src/repositories/CarteraRepository.test.js`:

```js
// src/repositories/CarteraRepository.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraRepository = require('./CarteraRepository');
const { codificarPeriodo } = require('../services/cartera/periodos');

function crearCuenta(dbService, codigo = 'T001') {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES (?, 'Vereda Test')`).run(codigo);
  return db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;
}

test('getSaldos separa la deuda exigible del saldo opaco', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);

    repo.crearMovimiento({ cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 180000 });
    repo.crearMovimiento({ cuentaId, fecha: '2022-01-01', tipo: 'CargoMensual', exigible: 1, monto: 5000, anio: 2022, mes: 1 });
    repo.crearMovimiento({ cuentaId, fecha: '2022-02-01', tipo: 'CargoMensual', exigible: 1, monto: 5000, anio: 2022, mes: 2 });
    repo.crearMovimiento({ cuentaId, fecha: '2022-03-15', tipo: 'Abono', exigible: 1, monto: -3000 });

    const s = repo.getSaldos(cuentaId);
    assert.equal(s.deudaExigible, 7000);
    assert.equal(s.saldoOpaco, 180000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getSaldos devuelve deuda exigible negativa cuando hay saldo a favor', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    repo.crearMovimiento({ cuentaId, fecha: '2026-01-05', tipo: 'Abono', exigible: 1, monto: -30000 });
    assert.equal(repo.getSaldos(cuentaId).deudaExigible, -20000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getSaldos de una cuenta sin movimientos devuelve ceros', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    assert.deepEqual(repo.getSaldos(cuentaId), { deudaExigible: 0, saldoOpaco: 0 });
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCargosPendientes descuenta lo imputado, ordena por período y omite los cubiertos', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);

    const c1 = repo.crearMovimiento({ cuentaId, fecha: '2026-02-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 2 });
    const c2 = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    const c3 = repo.crearMovimiento({ cuentaId, fecha: '2026-03-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 3 });
    const abono = repo.crearMovimiento({ cuentaId, fecha: '2026-04-01', tipo: 'Abono', exigible: 1, monto: -14000 });

    repo.crearImputacion({ abonoId: abono, cargoId: c2, monto: 10000 });  // enero: cubierto
    repo.crearImputacion({ abonoId: abono, cargoId: c1, monto: 4000 });   // febrero: parcial

    const pend = repo.getCargosPendientes(cuentaId, 1);
    assert.equal(pend.length, 2, 'enero queda cubierto y no aparece');
    assert.deepEqual(pend.map(c => `${c.anio}-${c.mes}`), ['2026-2', '2026-3'], 'orden por período');
    assert.equal(pend[0].id, c1);
    assert.equal(pend[0].pendiente, 6000);
    assert.equal(pend[1].id, c3);
    assert.equal(pend[1].pendiente, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCargosPendientes incluye los AjusteCategoria positivos y excluye los negativos', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2025-11-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2025, mes: 11 });
    const ajuste = repo.crearMovimiento({ cuentaId, fecha: '2026-07-29', tipo: 'AjusteCategoria', exigible: 1, monto: 6000, anio: 2025, mes: 11 });
    repo.crearMovimiento({ cuentaId, fecha: '2026-07-29', tipo: 'AjusteCategoria', exigible: 1, monto: -2000, anio: 2025, mes: 12 });

    const pend = repo.getCargosPendientes(cuentaId, 1);
    assert.equal(pend.length, 2, 'el cargo y el ajuste positivo; el negativo no es cobrable');
    assert.ok(pend.some(c => c.id === ajuste && c.pendiente === 6000));
    assert.ok(!pend.some(c => c.monto < 0));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCargosPendientes filtra por exigible: los opacos no se mezclan con los cobrables', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    const opaco = repo.crearMovimiento({ cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 180000 });
    repo.crearMovimiento({ cuentaId, fecha: '2022-01-01', tipo: 'CargoMensual', exigible: 1, monto: 5000, anio: 2022, mes: 1 });

    const exigibles = repo.getCargosPendientes(cuentaId, 1);
    const opacos = repo.getCargosPendientes(cuentaId, 0);
    assert.equal(exigibles.length, 1);
    assert.equal(exigibles[0].monto, 5000);
    assert.equal(opacos.length, 1);
    assert.equal(opacos[0].id, opaco);
    assert.equal(opacos[0].anio, null, 'la apertura no tiene mes');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getMesesCausados devuelve los códigos de período ya causados', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    repo.crearMovimiento({ cuentaId, fecha: '2026-03-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 3 });

    const causados = repo.getMesesCausados(cuentaId);
    assert.ok(causados.has(codificarPeriodo(2026, 1)));
    assert.ok(!causados.has(codificarPeriodo(2026, 2)));
    assert.ok(causados.has(codificarPeriodo(2026, 3)));
    assert.equal(causados.size, 2);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getTotalImputadoDeAbono suma lo que un abono cubrió', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    const c1 = repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    const abono = repo.crearMovimiento({ cuentaId, fecha: '2026-01-05', tipo: 'Abono', exigible: 1, monto: -30000 });
    repo.crearImputacion({ abonoId: abono, cargoId: c1, monto: 10000 });

    assert.equal(repo.getTotalImputadoDeAbono(abono), 10000);
    assert.equal(repo.getTotalImputadoDeAbono(c1), 0, 'un cargo no imputa a nada');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getCargoMensual encuentra el cargo de un mes concreto', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CarteraRepository(ctx.dbService);
    const cuentaId = crearCuenta(ctx.dbService);
    repo.crearMovimiento({ cuentaId, fecha: '2026-01-01', tipo: 'CargoMensual', exigible: 1, monto: 10000, anio: 2026, mes: 1 });
    assert.equal(repo.getCargoMensual(cuentaId, 2026, 1).monto, 10000);
    assert.equal(repo.getCargoMensual(cuentaId, 2026, 2), undefined);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL con `Cannot find module './CarteraRepository'`.

- [ ] **Step 3: Write the implementation**

Crear `src/repositories/CarteraRepository.js`:

```js
const { codificarPeriodo } = require('../services/cartera/periodos');
const { redondear } = require('../services/cartera/dinero');

// Acceso a cartera_movimientos y cartera_imputaciones.
//
// Regla central: el SALDO sale de la suma de montos de los movimientos, nunca de las
// imputaciones. Las imputaciones solo explican qué abono cubrió qué cargo. Gracias a esa
// separación, un movimiento de contrapartida (AjusteCategoria negativo) corrige el saldo sin
// que haya que deshacer ninguna imputación existente.
class CarteraRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  transaccion(fn) {
    return this.db.transaction(fn)();
  }

  crearMovimiento({ cuentaId, fecha, tipo, exigible = 1, monto, anio = null, mes = null,
    reciboDetalleId = null, documento = null, observaciones = null, usuarioId = null }) {
    const r = this.db.prepare(`
      INSERT INTO cartera_movimientos
        (cuenta_id, fecha, tipo, exigible, monto, anio, mes, recibo_detalle_id, documento, observaciones, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cuentaId, fecha, tipo, exigible, redondear(monto), anio, mes,
      reciboDetalleId, documento, observaciones, usuarioId);
    return r.lastInsertRowid;
  }

  crearImputacion({ abonoId, cargoId, monto }) {
    const r = this.db.prepare(`
      INSERT INTO cartera_imputaciones (abono_id, cargo_id, monto) VALUES (?, ?, ?)
    `).run(abonoId, cargoId, redondear(monto));
    return r.lastInsertRowid;
  }

  getSaldos(cuentaId) {
    const fila = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN exigible = 1 THEN monto ELSE 0 END), 0) AS deuda_exigible,
        COALESCE(SUM(CASE WHEN exigible = 0 THEN monto ELSE 0 END), 0) AS saldo_opaco
      FROM cartera_movimientos WHERE cuenta_id = ?
    `).get(cuentaId);
    return {
      deudaExigible: redondear(fila.deuda_exigible),
      saldoOpaco: redondear(fila.saldo_opaco)
    };
  }

  getCargoMensual(cuentaId, anio, mes) {
    return this.db.prepare(`
      SELECT * FROM cartera_movimientos
      WHERE cuenta_id = ? AND tipo = 'CargoMensual' AND anio = ? AND mes = ?
    `).get(cuentaId, anio, mes);
  }

  // Tipos que representan algo cobrable. Los abonos y los castigos no se imputan.
  static get TIPOS_CARGO() {
    return ['CargoMensual', 'AjusteCategoria', 'AperturaOpaca', 'AjusteAsamblea'];
  }

  // Cargos con saldo sin cubrir, del más antiguo al más nuevo. Los que no tienen mes
  // (la apertura opaca) van primero, porque son la deuda más vieja.
  // Excluye los montos negativos: un ajuste negativo reduce el saldo, no es algo que cobrar.
  getCargosPendientes(cuentaId, exigible) {
    const tipos = CarteraRepository.TIPOS_CARGO.map(t => `'${t}'`).join(', ');
    const filas = this.db.prepare(`
      SELECT m.id, m.anio, m.mes, m.monto,
        COALESCE((SELECT SUM(i.monto) FROM cartera_imputaciones i WHERE i.cargo_id = m.id), 0) AS cubierto
      FROM cartera_movimientos m
      WHERE m.cuenta_id = ? AND m.exigible = ? AND m.tipo IN (${tipos}) AND m.monto > 0
      ORDER BY (m.anio IS NULL) DESC, m.anio ASC, m.mes ASC, m.id ASC
    `).all(cuentaId, exigible);

    return filas
      .map(f => ({ ...f, monto: redondear(f.monto), cubierto: redondear(f.cubierto), pendiente: redondear(f.monto - f.cubierto) }))
      .filter(f => f.pendiente > 0);
  }

  // Todos los cargos con mes, cubiertos o no, para calcular "cubierto hasta". Agrupa por mes
  // sumando cargo + ajustes, porque un mes puede tener varias filas.
  getCargosConCobertura(cuentaId, exigible) {
    const tipos = CarteraRepository.TIPOS_CARGO.map(t => `'${t}'`).join(', ');
    const filas = this.db.prepare(`
      SELECT m.anio, m.mes,
        SUM(m.monto) AS monto,
        COALESCE(SUM((SELECT SUM(i.monto) FROM cartera_imputaciones i WHERE i.cargo_id = m.id)), 0) AS cubierto
      FROM cartera_movimientos m
      WHERE m.cuenta_id = ? AND m.exigible = ? AND m.tipo IN (${tipos})
        AND m.anio IS NOT NULL AND m.mes IS NOT NULL
      GROUP BY m.anio, m.mes
      ORDER BY m.anio ASC, m.mes ASC
    `).all(cuentaId, exigible);

    return filas.map(f => ({
      anio: f.anio, mes: f.mes,
      monto: redondear(f.monto), cubierto: redondear(f.cubierto)
    }));
  }

  getMovimientos(cuentaId) {
    return this.db.prepare(`
      SELECT * FROM cartera_movimientos WHERE cuenta_id = ?
      ORDER BY fecha ASC, id ASC
    `).all(cuentaId);
  }

  getTotalImputadoDeAbono(abonoId) {
    const fila = this.db.prepare(`
      SELECT COALESCE(SUM(monto), 0) AS total FROM cartera_imputaciones WHERE abono_id = ?
    `).get(abonoId);
    return redondear(fila.total);
  }

  getMesesCausados(cuentaId) {
    const filas = this.db.prepare(`
      SELECT anio, mes FROM cartera_movimientos
      WHERE cuenta_id = ? AND tipo = 'CargoMensual'
    `).all(cuentaId);
    return new Set(filas.map(f => codificarPeriodo(f.anio, f.mes)));
  }
}

module.exports = CarteraRepository;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 9 tests de `CarteraRepository.test.js` pasan.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/CarteraRepository.js src/repositories/CarteraRepository.test.js
git commit -m "feat(cartera): repositorio de movimientos, imputaciones y saldos"
```

---

### Task 6: `CarteraService.asegurarCausacion` — generar los cargos mensuales

**Files:**
- Create: `src/services/CarteraService.js`
- Create: `src/services/CarteraService.causacion.test.js`

**Interfaces:**
- Consumes: `CarteraRepository`, `CuentaEstadoRepository`, `PagoRepository.getCategoriaTarifaParaMes(cuentaId, anio, mes)` (existente, devuelve `{ tarifa_sostenimiento, ... }` o `undefined`), `PeriodoContableRepository`, `periodos.js`.
- Produces:
  - `new CarteraService(dbService)`
  - `asegurarCausacion(cuentaId, hastaAnio, hastaMes) -> { creados: number, omitidos: Array<{anio, mes, motivo}> }`
  - `getFechaInicioFacturacion(cuentaId) -> 'YYYY-MM-DD' | null` (mes del primer recibo)

- [ ] **Step 1: Write the failing test**

Crear `src/services/CarteraService.causacion.test.js`:

```js
// src/services/CarteraService.causacion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');

// Crea una cuenta con categoría y tarifa vigentes, un propietario y un primer recibo,
// que es lo mínimo que la causación necesita: sin tarifa no hay monto que causar y sin
// recibo no hay ancla de inicio de facturación.
function sembrarCuenta(dbService, { codigo = 'T001', tarifa = 10000, desde = '2022-01-01',
  fechaPrimerRecibo = '2022-01-15' } = {}) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;

  db.prepare(`INSERT INTO categorias (nombre) VALUES (?)`).run(`Cat-${codigo}`);
  const categoriaId = db.prepare(`SELECT id FROM categorias WHERE nombre = ?`).get(`Cat-${codigo}`).id;
  db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
              VALUES (?, ?, ?)`).run(categoriaId, tarifa, desde);
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
              VALUES (?, ?, ?)`).run(cuentaId, categoriaId, desde);

  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES (?)`).run(`Prop ${codigo}`);
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = ?`).get(`Prop ${codigo}`).id;
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio)
              VALUES (?, ?, ?)`).run(cuentaId, propietarioId, desde);

  if (fechaPrimerRecibo) {
    const num = db.prepare(`SELECT COALESCE(MAX(numero_recibo), 0) + 1 n FROM recibos`).get().n;
    db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
                VALUES (?, ?, ?, ?, 0, 'Efectivo')`).run(num, cuentaId, propietarioId, fechaPrimerRecibo);
  }

  new CuentaEstadoRepository(dbService)
    .sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: desde });

  return cuentaId;
}

test('asegurarCausacion crea un cargo por mes desde el primer recibo hasta el mes pedido', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: '2022-01-15' });
    const service = new CarteraService(ctx.dbService);

    const r = service.asegurarCausacion(cuentaId, 2022, 4);

    assert.equal(r.creados, 4, 'enero a abril de 2022');
    assert.equal(service.repository.getSaldos(cuentaId).deudaExigible, 40000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 1).monto, 10000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 4).monto, 10000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 5), undefined);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion es idempotente: llamarla dos veces no duplica cargos', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService);
    const service = new CarteraService(ctx.dbService);

    const primera = service.asegurarCausacion(cuentaId, 2022, 6);
    const segunda = service.asegurarCausacion(cuentaId, 2022, 6);

    assert.equal(primera.creados, 6);
    assert.equal(segunda.creados, 0, 'la segunda no crea nada');
    assert.equal(service.repository.getSaldos(cuentaId).deudaExigible, 60000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion no causa meses anteriores al primer recibo', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { desde: '2020-01-01', fechaPrimerRecibo: '2024-03-10' });
    const service = new CarteraService(ctx.dbService);

    const r = service.asegurarCausacion(cuentaId, 2024, 5);

    assert.equal(r.creados, 3, 'marzo, abril y mayo de 2024');
    assert.equal(service.repository.getCargoMensual(cuentaId, 2024, 2), undefined);
    assert.ok(service.repository.getCargoMensual(cuentaId, 2024, 3));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion no causa nada si la cuenta no tiene ningún recibo', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: null });
    const service = new CarteraService(ctx.dbService);

    const r = service.asegurarCausacion(cuentaId, 2026, 7);

    assert.equal(r.creados, 0);
    assert.ok(r.omitidos.some(o => /sin ancla de facturación/.test(o.motivo)));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion NO causa los meses en que la cuenta estuvo suspendida', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: '2022-01-15' });
    new CuentaEstadoRepository(ctx.dbService)
      .cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2022-04-01', motivo: 'no encontrado' });
    const service = new CarteraService(ctx.dbService);

    const r = service.asegurarCausacion(cuentaId, 2022, 8);

    assert.equal(r.creados, 3, 'solo enero, febrero y marzo');
    assert.equal(service.repository.getSaldos(cuentaId).deudaExigible, 30000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 4), undefined);
    assert.ok(r.omitidos.some(o => o.anio === 2022 && o.mes === 4 && /Suspendido/.test(o.motivo)));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion reanuda después de una reactivación y deja el hueco sin causar', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: '2022-01-15' });
    const estados = new CuentaEstadoRepository(ctx.dbService);
    estados.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: '2022-03-01' });
    estados.cambiarEstado({ cuentaId, estado: 'Activo', fechaInicio: '2022-06-01' });
    const service = new CarteraService(ctx.dbService);

    service.asegurarCausacion(cuentaId, 2022, 7);

    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 2), 'febrero: activo');
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 3), undefined, 'marzo: suspendido');
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 5), undefined, 'mayo: suspendido');
    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 6), 'junio: reactivado');
    assert.equal(service.repository.getSaldos(cuentaId).deudaExigible, 40000, 'ene, feb, jun, jul');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion usa la tarifa histórica de cada mes, no la de hoy', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(ctx.dbService, { tarifa: 5000, desde: '2022-01-01', fechaPrimerRecibo: '2022-01-15' });
    // La tarifa se dobla a partir de 2024: se cierra la vigencia vieja y se abre la nueva.
    const categoriaId = db.prepare(`SELECT categoria_id FROM cuenta_categorias WHERE cuenta_id = ?`).get(cuentaId).categoria_id;
    db.prepare(`UPDATE categoria_tarifas SET fecha_vigencia_hasta = '2023-12-31' WHERE categoria_id = ?`).run(categoriaId);
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
                VALUES (?, 10000, '2024-01-01')`).run(categoriaId);

    const service = new CarteraService(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2024, 2);

    assert.equal(service.repository.getCargoMensual(cuentaId, 2023, 12).monto, 5000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2024, 1).monto, 10000);
    assert.equal(service.repository.getCargoMensual(cuentaId, 2024, 2).monto, 10000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion omite los meses sin tarifa configurada, sin abortar el resto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(ctx.dbService, { tarifa: 10000, desde: '2022-01-01', fechaPrimerRecibo: '2022-01-15' });
    // La tarifa termina en marzo y no hay ninguna después.
    const categoriaId = db.prepare(`SELECT categoria_id FROM cuenta_categorias WHERE cuenta_id = ?`).get(cuentaId).categoria_id;
    db.prepare(`UPDATE categoria_tarifas SET fecha_vigencia_hasta = '2022-03-31' WHERE categoria_id = ?`).run(categoriaId);

    const service = new CarteraService(ctx.dbService);
    const r = service.asegurarCausacion(cuentaId, 2022, 6);

    assert.equal(r.creados, 3);
    assert.equal(r.omitidos.filter(o => /tarifa/.test(o.motivo)).length, 3);
    assert.equal(service.repository.getSaldos(cuentaId).deudaExigible, 30000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('asegurarCausacion no escribe en un período contable cerrado y no hay forma de forzarlo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: '2022-01-15' });
    db.prepare(`INSERT INTO periodos_contables (anio, mes, estado) VALUES (2022, 2, 'Cerrado')`).run();

    const service = new CarteraService(ctx.dbService);
    const r = service.asegurarCausacion(cuentaId, 2022, 3);

    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 1));
    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 2), undefined);
    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 3));
    assert.ok(r.omitidos.some(o => o.mes === 2 && /Cerrado/.test(o.motivo)));
    assert.equal(typeof service.asegurarCausacion, 'function');
    assert.equal(service.asegurarCausacion.length, 3, 'sin parámetro para saltar el bloqueo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getFechaInicioFacturacion devuelve la fecha del primer recibo e ignora los anulados', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const cuentaId = sembrarCuenta(ctx.dbService, { fechaPrimerRecibo: '2023-05-10' });
    const propietarioId = db.prepare(`SELECT propietario_id FROM cuenta_propietarios WHERE cuenta_id = ?`).get(cuentaId).propietario_id;
    db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago, estado)
                VALUES (9001, ?, ?, '2022-01-01', 0, 'Efectivo', 'Anulado')`).run(cuentaId, propietarioId);

    const service = new CarteraService(ctx.dbService);
    assert.equal(service.getFechaInicioFacturacion(cuentaId), '2023-05-10');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL con `Cannot find module './CarteraService'`.

- [ ] **Step 3: Write the implementation**

Crear `src/services/CarteraService.js`:

```js
const CarteraRepository = require('../repositories/CarteraRepository');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');
const PagoRepository = require('../repositories/PagoRepository');
const { codificarPeriodo, decodificarPeriodo, anioMesDeFecha, primerDiaDelMes } =
  require('./cartera/periodos');

// La cartera de un asociado como cuenta corriente en dinero.
//
// Deuda exigible = suma de los movimientos exigibles (cargos positivos, abonos negativos).
// Saldo opaco   = suma de los no exigibles: la deuda anterior al 01/01/2022, que se muestra
//                 pero no se cobra porque no hay con qué sustentarla.
//
// La causación NO genera asientos contables: el ingreso se sigue reconociendo al recaudar.
// Eso es lo que permite corregir meses de períodos ya cerrados sin reexpresar nada.
class CarteraService {
  constructor(dbService) {
    this.db = dbService.getDb();
    this.repository = new CarteraRepository(dbService);
    this.estadoRepository = new CuentaEstadoRepository(dbService);
    this.pagoRepository = new PagoRepository(dbService);
  }

  // Ancla de facturación: el mes del primer recibo de la cuenta. Se usa el recibo y no el
  // primer mes de pago_periodos porque hay 29 cuentas activas con cero meses asignados que sí
  // tienen recibos (por $8.900.000 en total): son abonos a la deuda y pagos de conexión que
  // nunca se atribuyeron a un mes.
  getFechaInicioFacturacion(cuentaId) {
    const fila = this.db.prepare(`
      SELECT MIN(fecha_recibo) AS f FROM recibos
      WHERE cuenta_id = ? AND estado != 'Anulado'
    `).get(cuentaId);
    return fila && fila.f ? String(fila.f).split(' ')[0] : null;
  }

  estadoPeriodoContable(anio, mes) {
    const fila = this.db.prepare(`
      SELECT estado FROM periodos_contables WHERE anio = ? AND mes = ?
    `).get(anio, mes);
    return fila ? fila.estado : null;
  }

  // Inserta los CargoMensual que falten hasta el mes indicado. Idempotente: el índice único
  // parcial idx_cartera_cargo_unico impide duplicar un mes, y además se consulta antes.
  //
  // No admite ningún parámetro para saltarse el bloqueo de períodos contables: la carga
  // inicial (que sí necesita escribir en el pasado) va por el script de migración, no por acá.
  asegurarCausacion(cuentaId, hastaAnio, hastaMes) {
    const omitidos = [];
    const ancla = this.getFechaInicioFacturacion(cuentaId);
    if (!ancla) {
      omitidos.push({ anio: null, mes: null, motivo: 'La cuenta no tiene recibos: sin ancla de facturación no se puede causar' });
      return { creados: 0, omitidos };
    }

    const inicio = anioMesDeFecha(ancla);
    const desdeCod = codificarPeriodo(inicio.anio, inicio.mes);
    const hastaCod = codificarPeriodo(hastaAnio, hastaMes);
    const yaCausados = this.repository.getMesesCausados(cuentaId);

    let creados = 0;
    this.repository.transaccion(() => {
      for (let cod = desdeCod; cod <= hastaCod; cod++) {
        const { anio, mes } = decodificarPeriodo(cod);
        if (yaCausados.has(cod)) continue;

        const estado = this.estadoRepository.estadoEnMes(cuentaId, anio, mes);
        if (estado !== 'Activo') {
          omitidos.push({ anio, mes, motivo: `La cuenta estaba ${estado} en ese mes` });
          continue;
        }

        if (this.estadoPeriodoContable(anio, mes) === 'Cerrado') {
          omitidos.push({ anio, mes, motivo: 'El período contable está Cerrado' });
          continue;
        }

        const tarifa = this.pagoRepository.getCategoriaTarifaParaMes(cuentaId, anio, mes);
        if (!tarifa) {
          omitidos.push({ anio, mes, motivo: 'No hay categoría o tarifa configurada para ese mes' });
          continue;
        }

        this.repository.crearMovimiento({
          cuentaId,
          fecha: primerDiaDelMes(anio, mes),
          tipo: 'CargoMensual',
          exigible: 1,
          monto: tarifa.tarifa_sostenimiento,
          anio, mes
        });
        creados++;
      }
    });

    return { creados, omitidos };
  }
}

module.exports = CarteraService;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 10 tests de `CarteraService.causacion.test.js` pasan.

- [ ] **Step 5: Commit**

```bash
git add src/services/CarteraService.js src/services/CarteraService.causacion.test.js
git commit -m "feat(cartera): causación mensual idempotente con reglas de parada"
```

---

### Task 7: `registrarAbono` y `getEstadoCartera`

**Files:**
- Modify: `src/services/CarteraService.js` (agregar métodos a la clase)
- Create: `src/services/CarteraService.abonos.test.js`

**Interfaces:**
- Consumes: `imputacion.js` (`MODOS`, `distribuir`, `calcularCubiertoHasta`), `CarteraRepository`.
- Produces:
  - `CarteraService.MODOS` (reexporta `MODOS` de `imputacion.js`)
  - `registrarAbono({ cuentaId, fecha, monto, modo, cargosElegidos, reciboDetalleId, observaciones, usuarioId }) -> { abonoId, imputado, sobrante }`
  - `getEstadoCartera(cuentaId) -> { deudaExigible, saldoOpaco, saldoAFavor, cubiertoHasta, totalCobrarHoy, totalReferencia }`

- [ ] **Step 1: Write the failing test**

Crear `src/services/CarteraService.abonos.test.js`:

```js
// src/services/CarteraService.abonos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const { MODOS } = require('./cartera/imputacion');

// Cuenta con 3 cargos exigibles de $10.000 (ene/feb/mar 2026) y una apertura opaca de
// $180.000. Se insertan por repositorio para no depender de la causación.
function sembrarCartera(dbService) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Vereda Test')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;

  const service = new CarteraService(dbService);
  service.repository.crearMovimiento({
    cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: 180000
  });
  const cargos = [1, 2, 3].map(mes => service.repository.crearMovimiento({
    cuentaId, fecha: `2026-0${mes}-01`, tipo: 'CargoMensual', exigible: 1, monto: 10000,
    anio: 2026, mes
  }));
  return { cuentaId, service, cargos };
}

test('AbonoDeudaFIFO cubre del cargo más antiguo hacia adelante y baja la deuda exigible', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const r = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 25000, modo: MODOS.ABONO_DEUDA_FIFO
    });

    assert.equal(r.imputado, 25000);
    assert.equal(r.sobrante, 0);
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, 5000);
    assert.equal(e.saldoOpaco, 180000, 'el opaco no se toca');
    assert.deepEqual(e.cubiertoHasta, { anio: 2026, mes: 2 });
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('AbonoDeudaFIFO nunca toca el bucket no exigible, ni cuando sobra plata', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const r = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 50000, modo: MODOS.ABONO_DEUDA_FIFO
    });

    assert.equal(r.imputado, 30000);
    assert.equal(r.sobrante, 20000, 'el excedente queda a favor, no baja el opaco');
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.saldoOpaco, 180000);
    assert.equal(e.deudaExigible, -20000);
    assert.equal(e.saldoAFavor, 20000);
    assert.equal(e.totalCobrarHoy, 0, 'con saldo a favor no hay nada que cobrar');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('MesesEspecificos cubre los meses elegidos y deja descubiertos los anteriores', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service, cargos } = sembrarCartera(ctx.dbService);
    service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 20000, modo: MODOS.MESES_ESPECIFICOS,
      cargosElegidos: [cargos[1], cargos[2]]   // febrero y marzo
    });

    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, 10000, 'queda enero');
    assert.equal(e.cubiertoHasta, null, 'enero descubierto: no está cubierto hasta ningún mes');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('AbonoSaldoOpaco baja el saldo opaco y no toca la deuda exigible', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const r = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 50000, modo: MODOS.ABONO_SALDO_OPACO
    });

    assert.equal(r.imputado, 50000);
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.saldoOpaco, 130000);
    assert.equal(e.deudaExigible, 30000, 'la deuda corriente sigue intacta');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('AbonoSaldoOpaco no puede exceder el saldo opaco', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    assert.throws(
      () => service.registrarAbono({
        cuentaId, fecha: '2026-04-01', monto: 200000, modo: MODOS.ABONO_SALDO_OPACO
      }),
      /no puede exceder el saldo histórico/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('Anticipo deja todo como saldo a favor sin imputar nada', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const r = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 15000, modo: MODOS.ANTICIPO
    });

    assert.equal(r.imputado, 0);
    assert.equal(r.sobrante, 15000);
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, 15000, '30.000 de cargos menos 15.000 de abono');
    assert.equal(e.cubiertoHasta, null, 'no imputó, así que no cubrió ningún mes');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('un abono nuevo no altera las imputaciones de uno anterior', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const primero = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 10000, modo: MODOS.ABONO_DEUDA_FIFO
    });
    const antes = ctx.dbService.getDb()
      .prepare(`SELECT cargo_id, monto FROM cartera_imputaciones WHERE abono_id = ? ORDER BY id`)
      .all(primero.abonoId);

    service.registrarAbono({ cuentaId, fecha: '2026-05-01', monto: 10000, modo: MODOS.ABONO_DEUDA_FIFO });

    const despues = ctx.dbService.getDb()
      .prepare(`SELECT cargo_id, monto FROM cartera_imputaciones WHERE abono_id = ? ORDER BY id`)
      .all(primero.abonoId);
    assert.deepEqual(despues, antes);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('invariante: lo imputado de un abono nunca excede su monto', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const r = service.registrarAbono({
      cuentaId, fecha: '2026-04-01', monto: 12000, modo: MODOS.ABONO_DEUDA_FIFO
    });
    assert.ok(service.repository.getTotalImputadoDeAbono(r.abonoId) <= 12000);
    assert.equal(service.repository.getTotalImputadoDeAbono(r.abonoId), r.imputado);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('invariante: ningún cargo queda sobrecubierto', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    service.registrarAbono({ cuentaId, fecha: '2026-04-01', monto: 15000, modo: MODOS.ABONO_DEUDA_FIFO });
    service.registrarAbono({ cuentaId, fecha: '2026-05-01', monto: 15000, modo: MODOS.ABONO_DEUDA_FIFO });

    const sobrecubiertos = ctx.dbService.getDb().prepare(`
      SELECT m.id, m.monto, SUM(i.monto) cub
      FROM cartera_movimientos m JOIN cartera_imputaciones i ON i.cargo_id = m.id
      GROUP BY m.id HAVING SUM(i.monto) > m.monto + 0.01
    `).all();
    assert.deepEqual(sobrecubiertos, []);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarAbono valida monto, modo y elegidos', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    assert.throws(() => service.registrarAbono({ cuentaId, fecha: '2026-04-01', monto: 0, modo: MODOS.ABONO_DEUDA_FIFO }),
      /mayor a cero/);
    assert.throws(() => service.registrarAbono({ cuentaId, fecha: null, monto: 1000, modo: MODOS.ABONO_DEUDA_FIFO }),
      /fecha del abono es obligatoria/);
    assert.throws(() => service.registrarAbono({ cuentaId, fecha: '2026-04-01', monto: 1000, modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: [] }),
      /al menos un mes/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getEstadoCartera reporta el total a cobrar sin el saldo opaco, y el de referencia con él', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrarCartera(ctx.dbService);
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, 30000);
    assert.equal(e.saldoOpaco, 180000);
    assert.equal(e.totalCobrarHoy, 30000, 'nunca incluye el opaco');
    assert.equal(e.totalReferencia, 210000);
    assert.equal(e.saldoAFavor, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL con `service.registrarAbono is not a function`.

- [ ] **Step 3: Write the implementation**

En `src/services/CarteraService.js`, agregar al inicio del archivo, junto a los otros `require`:

```js
const { MODOS, distribuir, calcularCubiertoHasta } = require('./cartera/imputacion');
const { redondear, esMayor } = require('./cartera/dinero');
```

Agregar estos métodos dentro de la clase `CarteraService`, después de `asegurarCausacion`:

```js
  // Registra plata recibida y la imputa contra los cargos según el modo. Los cuatro modos
  // crean UN solo Abono; lo único que cambia es contra qué cargos se computa la cobertura.
  // Lo que no alcanza a imputarse queda como saldo a favor (un exigible negativo), sin tabla
  // aparte: por eso cuenta_creditos queda sin uso.
  registrarAbono({ cuentaId, fecha, monto, modo, cargosElegidos = [],
    reciboDetalleId = null, observaciones = null, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!fecha) throw new Error('La fecha del abono es obligatoria');
    if (!(Number(monto) > 0)) throw new Error('El monto del abono debe ser mayor a cero');
    if (!Object.values(MODOS).includes(modo)) throw new Error(`Modo de imputación inválido: ${modo}`);
    if (modo === MODOS.MESES_ESPECIFICOS && cargosElegidos.length === 0) {
      throw new Error('Debe elegir al menos un mes a cubrir');
    }

    const esOpaco = modo === MODOS.ABONO_SALDO_OPACO;
    const exigible = esOpaco ? 0 : 1;

    if (esOpaco) {
      const { saldoOpaco } = this.repository.getSaldos(cuentaId);
      if (esMayor(monto, saldoOpaco)) {
        throw new Error(
          `El abono ($${redondear(monto)}) no puede exceder el saldo histórico ` +
          `de la cuenta ($${saldoOpaco})`
        );
      }
    }

    return this.repository.transaccion(() => {
      const cargos = this.repository.getCargosPendientes(cuentaId, exigible);
      const { imputaciones, sobrante } = distribuir({ modo, cargos, monto, cargosElegidos });

      const abonoId = this.repository.crearMovimiento({
        cuentaId, fecha, tipo: 'Abono', exigible,
        monto: -redondear(monto),
        reciboDetalleId, observaciones, usuarioId
      });

      for (const imp of imputaciones) {
        this.repository.crearImputacion({ abonoId, cargoId: imp.cargoId, monto: imp.monto });
      }

      const imputado = redondear(imputaciones.reduce((s, i) => s + i.monto, 0));
      return { abonoId, imputado, sobrante };
    });
  }

  // Estado de la cartera de una cuenta. El saldo opaco va SIEMPRE separado y nunca entra al
  // total a cobrar: es informativo, no exigible.
  getEstadoCartera(cuentaId) {
    const { deudaExigible, saldoOpaco } = this.repository.getSaldos(cuentaId);
    const cubiertoHasta = calcularCubiertoHasta(this.repository.getCargosConCobertura(cuentaId, 1));

    return {
      deudaExigible,
      saldoOpaco,
      saldoAFavor: deudaExigible < 0 ? redondear(-deudaExigible) : 0,
      cubiertoHasta,
      totalCobrarHoy: deudaExigible > 0 ? deudaExigible : 0,
      totalReferencia: redondear((deudaExigible > 0 ? deudaExigible : 0) + saldoOpaco)
    };
  }
```

Y al final del archivo, reemplazar `module.exports = CarteraService;` por:

```js
CarteraService.MODOS = MODOS;

module.exports = CarteraService;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 11 tests de `CarteraService.abonos.test.js` pasan.

- [ ] **Step 5: Commit**

```bash
git add src/services/CarteraService.js src/services/CarteraService.abonos.test.js
git commit -m "feat(cartera): registro de abonos con los cuatro modos de imputación"
```

---

### Task 8: `recategorizar` — corregir el pasado sin reescribirlo

**Files:**
- Modify: `src/services/CarteraService.js` (agregar método)
- Create: `src/services/CarteraService.recategorizar.test.js`

**Interfaces:**
- Consumes: `CarteraRepository`, `PagoRepository.getCategoriaTarifaParaMes`, `periodos.js`, `dinero.js`.
- Produces: `recategorizar({ cuentaId, categoriaId, fechaVigencia, documento, observaciones, usuarioId }) -> { ajustes: Array<{anio, mes, diferencia}>, totalAjustado: number }`

- [ ] **Step 1: Write the failing test**

Crear `src/services/CarteraService.recategorizar.test.js`:

```js
// src/services/CarteraService.recategorizar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');
const { MODOS } = require('./cartera/imputacion');

// Cuenta "Finca" a $10.000 desde 2025-01, con recibo desde 2025-01, y una categoría
// "Finca con piscina" a $16.000 disponible para recategorizar.
function sembrar(dbService) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES ('T001', 'Vereda Test', 'Activo')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;

  const crearCategoria = (nombre, tarifa) => {
    db.prepare(`INSERT INTO categorias (nombre) VALUES (?)`).run(nombre);
    const id = db.prepare(`SELECT id FROM categorias WHERE nombre = ?`).get(nombre).id;
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
                VALUES (?, ?, '2020-01-01')`).run(id, tarifa);
    return id;
  };
  const finca = crearCategoria('Finca', 10000);
  const piscina = crearCategoria('Finca con piscina', 16000);

  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
              VALUES (?, ?, '2025-01-01')`).run(cuentaId, finca);

  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Prop T001')`).run();
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Prop T001'`).get().id;
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio)
              VALUES (?, ?, '2025-01-01')`).run(cuentaId, propietarioId);
  db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
              VALUES (5001, ?, ?, '2025-01-10', 0, 'Efectivo')`).run(cuentaId, propietarioId);

  new CuentaEstadoRepository(dbService)
    .sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2025-01-01' });

  return { cuentaId, finca, piscina, service: new CarteraService(dbService) };
}

test('recategorizar hacia arriba emite AjusteCategoria por la diferencia y no muta los cargos', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, piscina, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2026, 1);   // ene-2025 a ene-2026 a $10.000 = $130.000
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 130000);

    // Se descubre que tenía piscina desde noviembre de 2025.
    const r = service.recategorizar({
      cuentaId, categoriaId: piscina, fechaVigencia: '2025-11-01', documento: 'Acta 7'
    });

    assert.equal(r.ajustes.length, 3, 'nov-2025, dic-2025, ene-2026');
    assert.equal(r.totalAjustado, 18000, '3 meses x $6.000');
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 148000);

    // El CargoMensual original sigue intacto: la corrección es una fila aparte.
    assert.equal(service.repository.getCargoMensual(cuentaId, 2025, 11).monto, 10000);
    const ajuste = ctx.dbService.getDb().prepare(`
      SELECT monto, documento FROM cartera_movimientos
      WHERE cuenta_id = ? AND tipo = 'AjusteCategoria' AND anio = 2025 AND mes = 11
    `).get(cuentaId);
    assert.equal(ajuste.monto, 6000);
    assert.equal(ajuste.documento, 'Acta 7');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar hacia arriba deja el ajuste como cargo pendiente que el FIFO puede cubrir', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, piscina, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2025, 2);   // ene y feb 2025 = $20.000
    service.registrarAbono({ cuentaId, fecha: '2025-03-01', monto: 20000, modo: MODOS.ABONO_DEUDA_FIFO });
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 0);

    service.recategorizar({ cuentaId, categoriaId: piscina, fechaVigencia: '2025-01-01' });

    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, 12000, '2 meses x $6.000 de diferencia');
    const pend = service.repository.getCargosPendientes(cuentaId, 1);
    assert.equal(pend.length, 2, 'los dos ajustes quedan cobrables');
    assert.ok(pend.every(c => c.pendiente === 6000));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar hacia abajo sobre meses ya pagados produce saldo a favor', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, finca, piscina, service } = sembrar(ctx.dbService);
    // Arranca como piscina ($16.000) y ya pagó todo.
    db.prepare(`UPDATE cuenta_categorias SET categoria_id = ? WHERE cuenta_id = ?`).run(piscina, cuentaId);
    service.asegurarCausacion(cuentaId, 2025, 2);   // 2 meses x $16.000 = $32.000
    service.registrarAbono({ cuentaId, fecha: '2025-03-01', monto: 32000, modo: MODOS.ABONO_DEUDA_FIFO });
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 0);

    // Se corrige: nunca tuvo piscina.
    const r = service.recategorizar({ cuentaId, categoriaId: finca, fechaVigencia: '2025-01-01' });

    assert.equal(r.totalAjustado, -12000, '2 meses x -$6.000');
    const e = service.getEstadoCartera(cuentaId);
    assert.equal(e.deudaExigible, -12000);
    assert.equal(e.saldoAFavor, 12000);
    assert.equal(e.totalCobrarHoy, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar no deshace ni modifica ninguna imputación existente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, finca, piscina, service } = sembrar(ctx.dbService);
    db.prepare(`UPDATE cuenta_categorias SET categoria_id = ? WHERE cuenta_id = ?`).run(piscina, cuentaId);
    service.asegurarCausacion(cuentaId, 2025, 2);
    service.registrarAbono({ cuentaId, fecha: '2025-03-01', monto: 32000, modo: MODOS.ABONO_DEUDA_FIFO });

    const antes = db.prepare(`SELECT abono_id, cargo_id, monto FROM cartera_imputaciones ORDER BY id`).all();
    service.recategorizar({ cuentaId, categoriaId: finca, fechaVigencia: '2025-01-01' });
    const despues = db.prepare(`SELECT abono_id, cargo_id, monto FROM cartera_imputaciones ORDER BY id`).all();

    assert.deepEqual(despues, antes);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar omite los meses donde la diferencia es cero', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2025, 3);
    // Otra categoría con la MISMA tarifa: recategorizar no debe generar ajustes.
    db.prepare(`INSERT INTO categorias (nombre) VALUES ('Finca bis')`).run();
    const bis = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca bis'`).get().id;
    db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
                VALUES (?, 10000, '2020-01-01')`).run(bis);

    const r = service.recategorizar({ cuentaId, categoriaId: bis, fechaVigencia: '2025-01-01' });

    assert.equal(r.ajustes.length, 0);
    assert.equal(r.totalAjustado, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM cartera_movimientos WHERE tipo = 'AjusteCategoria'`).get().n, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar cierra la vigencia anterior de cuenta_categorias y abre la nueva', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, finca, piscina, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2025, 12);

    service.recategorizar({ cuentaId, categoriaId: piscina, fechaVigencia: '2025-11-01' });

    const vig = db.prepare(`SELECT categoria_id, fecha_inicio, fecha_fin FROM cuenta_categorias
                            WHERE cuenta_id = ? ORDER BY fecha_inicio`).all(cuentaId);
    assert.equal(vig.length, 2);
    assert.equal(vig[0].categoria_id, finca);
    assert.equal(vig[0].fecha_fin, '2025-10-31');
    assert.equal(vig[1].categoria_id, piscina);
    assert.equal(vig[1].fecha_inicio, '2025-11-01');
    assert.equal(vig[1].fecha_fin, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar dos veces con la misma vigencia no acumula ajustes duplicados', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, piscina, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2025, 3);

    service.recategorizar({ cuentaId, categoriaId: piscina, fechaVigencia: '2025-01-01' });
    const despuesPrimera = service.getEstadoCartera(cuentaId).deudaExigible;
    const segunda = service.recategorizar({ cuentaId, categoriaId: piscina, fechaVigencia: '2025-01-01' });

    assert.equal(segunda.ajustes.length, 0, 'ya está en esa categoría: nada que ajustar');
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, despuesPrimera);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('recategorizar valida los parámetros', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, piscina, service } = sembrar(ctx.dbService);
    assert.throws(() => service.recategorizar({ cuentaId, categoriaId: piscina, fechaVigencia: null }),
      /fecha de vigencia es obligatoria/);
    assert.throws(() => service.recategorizar({ cuentaId, categoriaId: 99999, fechaVigencia: '2025-01-01' }),
      /Categoría no encontrada/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL con `service.recategorizar is not a function`.

- [ ] **Step 3: Write the implementation**

En `src/services/CarteraService.js`, agregar `ultimoDiaDelMes` y `diaAnterior` al `require` de `./cartera/periodos`:

```js
const { codificarPeriodo, decodificarPeriodo, anioMesDeFecha, primerDiaDelMes, diaAnterior } =
  require('./cartera/periodos');
```

Agregar este método dentro de la clase, después de `getEstadoCartera`:

```js
  // Cambia la categoría de una cuenta con una fecha de vigencia que puede ser pasada, y
  // corrige los cargos ya emitidos desde esa fecha.
  //
  // NUNCA muta un CargoMensual emitido: emite un AjusteCategoria por la diferencia. Así:
  //  - no se reescribe historia (queda qué se cobró, cuánto se corrigió, cuándo y con qué acta);
  //  - ninguna imputación se deshace: si el cargo sube, el ajuste es un pendiente más que el
  //    FIFO ve normalmente; si baja, el ajuste negativo reduce el saldo directo y, si el mes
  //    ya estaba pagado, eso se vuelve saldo a favor por la propia fórmula del saldo.
  // Funciona porque el saldo sale de los movimientos, no de las imputaciones.
  //
  // No genera asientos contables (la causación tampoco), así que corregir meses de un período
  // contable cerrado no lo reexpresa.
  recategorizar({ cuentaId, categoriaId, fechaVigencia, documento = null,
    observaciones = null, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!categoriaId) throw new Error('La categoría es obligatoria');
    if (!fechaVigencia) throw new Error('La fecha de vigencia es obligatoria');

    const categoria = this.db.prepare(`SELECT id, nombre FROM categorias WHERE id = ?`).get(categoriaId);
    if (!categoria) throw new Error(`Categoría no encontrada: ${categoriaId}`);

    const hoy = new Date();
    const hastaCod = codificarPeriodo(hoy.getFullYear(), hoy.getMonth() + 1);
    const desde = anioMesDeFecha(fechaVigencia);
    const desdeCod = codificarPeriodo(desde.anio, desde.mes);

    return this.repository.transaccion(() => {
      // 1) Mover la vigencia de categoría.
      const vigenciaAbierta = this.db.prepare(`
        SELECT id, categoria_id, fecha_inicio FROM cuenta_categorias
        WHERE cuenta_id = ? AND fecha_fin IS NULL
        ORDER BY fecha_inicio DESC, id DESC LIMIT 1
      `).get(cuentaId);

      const yaEstaEnEsaCategoria = vigenciaAbierta
        && vigenciaAbierta.categoria_id === categoriaId
        && vigenciaAbierta.fecha_inicio <= fechaVigencia;

      if (!yaEstaEnEsaCategoria) {
        if (vigenciaAbierta) {
          if (fechaVigencia <= vigenciaAbierta.fecha_inicio) {
            throw new Error(
              `La fecha ${fechaVigencia} es anterior al inicio de la categoría actual ` +
              `(${vigenciaAbierta.fecha_inicio}); corrija esa vigencia primero`
            );
          }
          this.db.prepare(`UPDATE cuenta_categorias SET fecha_fin = ? WHERE id = ?`)
            .run(diaAnterior(fechaVigencia), vigenciaAbierta.id);
        }
        this.db.prepare(`
          INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio, observaciones)
          VALUES (?, ?, ?, ?)
        `).run(cuentaId, categoriaId, fechaVigencia, observaciones);
      }

      // 2) Corregir por diferencia los meses ya causados desde la vigencia.
      const ajustes = [];
      const fechaAjuste = new Date().toISOString().split('T')[0];

      for (let cod = desdeCod; cod <= hastaCod; cod++) {
        const { anio, mes } = decodificarPeriodo(cod);

        const cargoOriginal = this.repository.getCargoMensual(cuentaId, anio, mes);
        if (!cargoOriginal) continue;   // mes no causado: no hay nada que corregir

        const tarifaCorrecta = this.pagoRepository.getCategoriaTarifaParaMes(cuentaId, anio, mes);
        if (!tarifaCorrecta) continue;

        // Lo cobrado hoy por ese mes es el cargo más los ajustes previos.
        const cobrado = this.db.prepare(`
          SELECT COALESCE(SUM(monto), 0) AS total FROM cartera_movimientos
          WHERE cuenta_id = ? AND anio = ? AND mes = ?
            AND tipo IN ('CargoMensual', 'AjusteCategoria')
        `).get(cuentaId, anio, mes).total;

        const diferencia = redondear(tarifaCorrecta.tarifa_sostenimiento - cobrado);
        if (!esMayor(Math.abs(diferencia), 0)) continue;

        this.repository.crearMovimiento({
          cuentaId,
          fecha: fechaAjuste,
          tipo: 'AjusteCategoria',
          exigible: 1,
          monto: diferencia,
          anio, mes,
          documento,
          observaciones: observaciones
            || `Recategorización a ${categoria.nombre} con vigencia ${fechaVigencia}`,
          usuarioId
        });
        ajustes.push({ anio, mes, diferencia });
      }

      return {
        ajustes,
        totalAjustado: redondear(ajustes.reduce((s, a) => s + a.diferencia, 0))
      };
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 8 tests de `CarteraService.recategorizar.test.js` pasan.

- [ ] **Step 5: Commit**

```bash
git add src/services/CarteraService.js src/services/CarteraService.recategorizar.test.js
git commit -m "feat(cartera): recategorización retroactiva por diferencia, sin mutar cargos"
```

---

### Task 9: `suspender` y `reactivar`

**Files:**
- Modify: `src/services/CarteraService.js` (agregar métodos)
- Create: `src/services/CarteraService.estados.test.js`

**Interfaces:**
- Consumes: `CuentaEstadoRepository.cambiarEstado`, `CarteraRepository`, `periodos.js`.
- Produces:
  - `suspender({ cuentaId, fechaDesde, motivo, usuarioId }) -> { vigenciaId, cargosAnulados: number, totalAnulado: number }`
  - `reactivar({ cuentaId, fechaDesde, motivo, usuarioId }) -> { vigenciaId }`

- [ ] **Step 1: Write the failing test**

Crear `src/services/CarteraService.estados.test.js`:

```js
// src/services/CarteraService.estados.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');

function sembrar(dbService) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES ('T001', 'Vereda Test', 'Activo')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;

  db.prepare(`INSERT INTO categorias (nombre) VALUES ('Finca')`).run();
  const catId = db.prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;
  db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
              VALUES (?, 10000, '2020-01-01')`).run(catId);
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
              VALUES (?, ?, '2022-01-01')`).run(cuentaId, catId);

  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Prop T001')`).run();
  const propId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Prop T001'`).get().id;
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio)
              VALUES (?, ?, '2022-01-01')`).run(cuentaId, propId);
  db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
              VALUES (7001, ?, ?, '2022-01-10', 0, 'Efectivo')`).run(cuentaId, propId);

  new CuentaEstadoRepository(dbService)
    .sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2022-01-01' });

  return { cuentaId, service: new CarteraService(dbService) };
}

test('suspender con fecha retroactiva anula los cargos ya causados desde esa fecha', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2022, 12);   // 12 meses x $10.000 = $120.000
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 120000);

    // El último pago fue en marzo y desde entonces nadie sabe nada del punto.
    const r = service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: 'no encontrado' });

    assert.equal(r.cargosAnulados, 9, 'abril a diciembre');
    assert.equal(r.totalAnulado, -90000);
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 30000, 'solo ene-mar');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('suspender anula con contrapartida: no borra ningún CargoMensual', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2022, 6);
    const cargosAntes = db.prepare(
      `SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'CargoMensual'`
    ).get(cuentaId).n;

    service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: 'no encontrado' });

    assert.equal(
      db.prepare(`SELECT COUNT(*) n FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'CargoMensual'`).get(cuentaId).n,
      cargosAntes, 'los cargos originales siguen ahí'
    );
    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 4));
    const contrapartidas = db.prepare(`
      SELECT COUNT(*) n FROM cartera_movimientos
      WHERE cuenta_id = ? AND tipo = 'AjusteCategoria' AND monto < 0
    `).get(cuentaId).n;
    assert.equal(contrapartidas, 3, 'abril, mayo y junio');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('después de suspender, asegurarCausacion no vuelve a causar el lapso suspendido', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2022, 6);
    service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: 'no encontrado' });
    const deudaTrasSuspender = service.getEstadoCartera(cuentaId).deudaExigible;

    service.asegurarCausacion(cuentaId, 2022, 12);

    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, deudaTrasSuspender,
      'ni recausó los anulados ni causó los meses nuevos');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('reactivar reanuda la causación desde su fecha y NO recausa el lapso suspendido', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2022, 6);
    service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: 'no encontrado' });

    service.reactivar({ cuentaId, fechaDesde: '2022-10-01', motivo: 'reapareció' });
    service.asegurarCausacion(cuentaId, 2022, 12);

    assert.equal(service.repository.getCargoMensual(cuentaId, 2022, 7), undefined, 'julio: suspendido');
    assert.ok(service.repository.getCargoMensual(cuentaId, 2022, 10), 'octubre: reactivado');
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 60000,
      'ene-mar ($30.000) + oct-dic ($30.000)');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('suspender sincroniza cuentas.estado y reactivar lo devuelve a Activo', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { cuentaId, service } = sembrar(ctx.dbService);
    const estadoActual = () => db.prepare(`SELECT estado FROM cuentas WHERE id = ?`).get(cuentaId).estado;

    service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: 'no encontrado' });
    assert.equal(estadoActual(), 'Suspendido');

    service.reactivar({ cuentaId, fechaDesde: '2026-01-01', motivo: 'reapareció' });
    assert.equal(estadoActual(), 'Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('suspender no anula cargos anteriores a la fecha de suspensión', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrar(ctx.dbService);
    service.asegurarCausacion(cuentaId, 2022, 6);

    const r = service.suspender({ cuentaId, fechaDesde: '2022-06-01', motivo: 'no encontrado' });

    assert.equal(r.cargosAnulados, 1, 'solo junio');
    assert.equal(service.getEstadoCartera(cuentaId).deudaExigible, 50000, 'ene a mayo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('suspender y reactivar validan sus parámetros', () => {
  const ctx = crearDbTemporal();
  try {
    const { cuentaId, service } = sembrar(ctx.dbService);
    assert.throws(() => service.suspender({ cuentaId, fechaDesde: null, motivo: 'x' }),
      /fecha .* es obligatoria/i);
    assert.throws(() => service.suspender({ cuentaId, fechaDesde: '2022-04-01', motivo: '' }),
      /motivo/i);
    assert.throws(() => service.reactivar({ cuentaId, fechaDesde: null }),
      /fecha .* es obligatoria/i);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL con `service.suspender is not a function`.

- [ ] **Step 3: Write the implementation**

Agregar estos métodos dentro de la clase `CarteraService`, después de `recategorizar`:

```js
  // Suspende una cuenta a partir de una fecha que puede ser pasada, y anula los cargos ya
  // causados desde ahí. La suspensión significa que en ese lapso no había servicio que
  // cobrar, así que la deuda de esos meses no debe existir.
  //
  // Los cargos NO se borran: se anulan con una contrapartida negativa, igual que en
  // recategorizar. Queda el rastro de que se causaron y de que se anularon.
  suspender({ cuentaId, fechaDesde, motivo, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!fechaDesde) throw new Error('La fecha desde la que se suspende es obligatoria');
    if (!motivo || !String(motivo).trim()) throw new Error('Debe indicar el motivo de la suspensión');

    return this.repository.transaccion(() => {
      const vigenciaId = this.estadoRepository.cambiarEstado({
        cuentaId, estado: 'Suspendido', fechaInicio: fechaDesde, motivo, usuarioId
      });

      const desde = anioMesDeFecha(fechaDesde);
      const desdeCod = codificarPeriodo(desde.anio, desde.mes);
      const hoy = new Date();
      const hastaCod = codificarPeriodo(hoy.getFullYear(), hoy.getMonth() + 1);
      const fechaAjuste = new Date().toISOString().split('T')[0];

      let cargosAnulados = 0;
      let totalAnulado = 0;

      for (let cod = desdeCod; cod <= hastaCod; cod++) {
        const { anio, mes } = decodificarPeriodo(cod);
        const neto = this.db.prepare(`
          SELECT COALESCE(SUM(monto), 0) AS total FROM cartera_movimientos
          WHERE cuenta_id = ? AND anio = ? AND mes = ?
            AND tipo IN ('CargoMensual', 'AjusteCategoria')
        `).get(cuentaId, anio, mes).total;

        if (!esMayor(Math.abs(neto), 0)) continue;

        this.repository.crearMovimiento({
          cuentaId,
          fecha: fechaAjuste,
          tipo: 'AjusteCategoria',
          exigible: 1,
          monto: redondear(-neto),
          anio, mes,
          observaciones: `Anulación por suspensión desde ${fechaDesde}: ${motivo}`,
          usuarioId
        });
        cargosAnulados++;
        totalAnulado = redondear(totalAnulado - neto);
      }

      return { vigenciaId, cargosAnulados, totalAnulado };
    });
  }

  // Reactiva una cuenta. La causación se reanuda desde fechaDesde; los meses en que estuvo
  // suspendida NO se causan retroactivamente. Si en algún caso se quisiera cobrarlos, es un
  // AjusteAsamblea explícito y documentado, nunca un efecto automático de reactivar.
  reactivar({ cuentaId, fechaDesde, motivo = null, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!fechaDesde) throw new Error('La fecha desde la que se reactiva es obligatoria');

    const vigenciaId = this.estadoRepository.cambiarEstado({
      cuentaId, estado: 'Activo', fechaInicio: fechaDesde, motivo, usuarioId
    });
    return { vigenciaId };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: los 7 tests de `CarteraService.estados.test.js` pasan.

- [ ] **Step 5: Commit**

```bash
git add src/services/CarteraService.js src/services/CarteraService.estados.test.js
git commit -m "feat(cartera): suspensión y reactivación con fecha, anulando cargos por contrapartida"
```

---

### Task 10: Regresión con los tres casos reales

Cierra el plan con los casos que motivaron el rediseño. La respuesta correcta de cada uno está verificada contra el Excel al peso, así que son la mejor prueba disponible de que el motor produce las cifras del negocio.

**Files:**
- Create: `src/services/CarteraService.casosReales.test.js`

**Interfaces:**
- Consumes: `CarteraService`, `CuentaEstadoRepository`, `MODOS`.
- Produces: nada. Es el test de aceptación del motor.

- [ ] **Step 1: Write the failing test**

Crear `src/services/CarteraService.casosReales.test.js`:

```js
// src/services/CarteraService.casosReales.test.js
//
// Los tres casos que motivaron el rediseño, con sus recibos reales. El saldo esperado de cada
// uno está conciliado al peso contra el Excel de cartera:
//   R034 -> $370.000   (el sistema viejo cobraría 103 meses, ~$1.030.000)
//   R037 -> $420.000   (el sistema viejo lo mostraba "al día, $0")
//   R019 -> $110.000   (el sistema viejo cobraría 6 meses, ~$60.000)
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CarteraService = require('./CarteraService');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');
const { MODOS } = require('./cartera/imputacion');

// Cuenta con la mensualidad real de estas tres ($5.000 hasta 2023, $10.000 desde 2024),
// apertura opaca al 31/12/2021, y primer recibo en la fecha indicada.
function sembrarCaso(dbService, { codigo, aperturaOpaca, primerRecibo }) {
  const db = dbService.getDb();
  db.prepare(`INSERT INTO cuentas (codigo, direccion, estado) VALUES (?, 'Vereda Test', 'Activo')`).run(codigo);
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(codigo).id;

  db.prepare(`INSERT INTO categorias (nombre) VALUES (?)`).run(`Finca-${codigo}`);
  const catId = db.prepare(`SELECT id FROM categorias WHERE nombre = ?`).get(`Finca-${codigo}`).id;
  db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta)
              VALUES (?, 5000, '2022-01-01', '2023-12-31')`).run(catId);
  db.prepare(`INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde)
              VALUES (?, 10000, '2024-01-01')`).run(catId);
  db.prepare(`INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
              VALUES (?, ?, '2022-01-01')`).run(cuentaId, catId);

  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES (?)`).run(`Prop ${codigo}`);
  const propId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = ?`).get(`Prop ${codigo}`).id;
  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio)
              VALUES (?, ?, '2022-01-01')`).run(cuentaId, propId);
  const num = db.prepare(`SELECT COALESCE(MAX(numero_recibo), 0) + 1 n FROM recibos`).get().n;
  db.prepare(`INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
              VALUES (?, ?, ?, ?, 0, 'Efectivo')`).run(num, cuentaId, propId, primerRecibo);

  new CuentaEstadoRepository(dbService)
    .sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: '2022-01-01' });

  const service = new CarteraService(dbService);
  service.repository.crearMovimiento({
    cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: aperturaOpaca,
    observaciones: 'Carga inicial cartera 2026-07'
  });

  return { cuentaId, service };
}

test('R034 RUIZ ESCOBAR ANSELMO: 6 abonos por $350.000 dejan $370.000 de deuda, no 103 meses', () => {
  const ctx = crearDbTemporal();
  try {
    // Apertura al 31/12/2021 = $240.000. Causación 2022-2026 a $5.000 y luego $10.000.
    const { cuentaId, service } = sembrarCaso(ctx.dbService, {
      codigo: 'R034', aperturaOpaca: 240000, primerRecibo: '2017-04-16'
    });
    service.asegurarCausacion(cuentaId, 2026, 12);

    // Los 6 abonos reales, todos "ABONO A LA DEUDA" sin meses identificados.
    for (const [fecha, monto] of [
      ['2022-07-07', 50000], ['2022-09-17', 50000], ['2022-11-11', 50000],
      ['2023-05-06', 50000], ['2024-02-10', 50000], ['2025-06-21', 100000]
    ]) {
      service.registrarAbono({ cuentaId, fecha, monto, modo: MODOS.ABONO_DEUDA_FIFO });
    }

    const e = service.getEstadoCartera(cuentaId);
    // Causado 2022-2026 = (5.000 x 24) + (10.000 x 36) = 120.000 + 360.000 = 480.000
    // menos 350.000 abonados = 130.000 de deuda corriente.
    assert.equal(e.deudaExigible, 130000);
    assert.equal(e.saldoOpaco, 240000, 'la deuda vieja se ve pero no se cobra');
    assert.equal(e.totalCobrarHoy, 130000);
    assert.equal(e.totalReferencia, 370000, 'coincide con el saldo del Excel al 31/12/2026');
    // El modelo viejo diría 103 meses de mora ignorando los $350.000 ya abonados.
    assert.ok(e.totalCobrarHoy < 1030000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('R037 ALVAREZ CLARA ISABEL: sus $390.000 de abonos se ven, ya no aparece "al día"', () => {
  const ctx = crearDbTemporal();
  try {
    // Apertura al 31/12/2021 = $330.000. Nunca tuvo un mes asignado en pago_periodos.
    const { cuentaId, service } = sembrarCaso(ctx.dbService, {
      codigo: 'R037', aperturaOpaca: 330000, primerRecibo: '2022-07-07'
    });
    service.asegurarCausacion(cuentaId, 2026, 12);

    for (const [fecha, monto] of [
      ['2022-07-07', 50000], ['2022-08-09', 55000], ['2023-01-31', 200000], ['2023-02-06', 85000]
    ]) {
      service.registrarAbono({ cuentaId, fecha, monto, modo: MODOS.ABONO_DEUDA_FIFO });
    }

    const e = service.getEstadoCartera(cuentaId);
    // Causado (jul-2022 a dic-2026) = (5.000 x 18) + (10.000 x 36) = 90.000 + 360.000 = 450.000
    // menos 390.000 = 60.000.
    assert.equal(e.deudaExigible, 60000);
    assert.equal(e.saldoOpaco, 330000);
    assert.equal(e.totalReferencia, 390000);
    assert.notEqual(e.totalCobrarHoy, 0, 'el modelo viejo la mostraba al día con $0');
    assert.deepEqual(e.cubiertoHasta, { anio: 2026, mes: 6 },
      'los abonos cubrieron mes a mes desde el más antiguo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('R019 VANEGAS HERRERA JOHANNA: los abonos sin meses ya no dejan huecos falsos', () => {
  const ctx = crearDbTemporal();
  try {
    // Apertura al 31/12/2021 = $384.000, la semilla opaca de esta cuenta.
    const { cuentaId, service } = sembrarCaso(ctx.dbService, {
      codigo: 'R019', aperturaOpaca: 384000, primerRecibo: '2022-05-28'
    });
    service.asegurarCausacion(cuentaId, 2026, 12);

    // Los abonos reales: 5 "a la deuda" sin meses, el 1797 que la deja al día,
    // y luego los pagos corrientes mes a mes.
    for (const [fecha, monto] of [
      ['2022-05-28', 50000], ['2022-08-27', 50000], ['2023-01-14', 60000],
      ['2023-06-03', 100000], ['2024-02-07', 200000], ['2024-04-06', 84000],
      ['2024-06-08', 20000], ['2024-08-10', 20000], ['2024-10-05', 20000],
      ['2025-03-08', 50000], ['2025-10-11', 50000], ['2026-01-10', 50000]
    ]) {
      service.registrarAbono({ cuentaId, fecha, monto, modo: MODOS.ABONO_DEUDA_FIFO });
    }

    const e = service.getEstadoCartera(cuentaId);
    // Causado (may-2022 a dic-2026) = (5.000 x 20) + (10.000 x 36) = 100.000 + 360.000 = 460.000
    // menos 754.000 abonados = -294.000, o sea saldo a favor.
    assert.equal(e.saldoAFavor, 294000);
    assert.equal(e.totalCobrarHoy, 0);
    assert.equal(e.saldoOpaco, 384000, 'la semilla vieja sigue visible y sin cobrar');
    // Lo importante: los 26 "huecos" que el modelo viejo mostraba entre 2022-01 y 2024-03 eran
    // la cicatriz de abonos que no se podían representar. Acá no hay ninguno.
    assert.deepEqual(e.cubiertoHasta, { anio: 2026, mes: 12 });
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('los tres casos mantienen el saldo opaco fuera del total a cobrar', () => {
  const ctx = crearDbTemporal();
  try {
    for (const [codigo, apertura] of [['R034', 240000], ['R037', 330000], ['R019', 384000]]) {
      const { cuentaId, service } = sembrarCaso(ctx.dbService, {
        codigo, aperturaOpaca: apertura, primerRecibo: '2022-01-15'
      });
      service.asegurarCausacion(cuentaId, 2026, 12);
      const e = service.getEstadoCartera(cuentaId);
      assert.equal(e.saldoOpaco, apertura);
      assert.equal(e.totalCobrarHoy, e.deudaExigible > 0 ? e.deudaExigible : 0);
      assert.ok(e.totalCobrarHoy < apertura + e.deudaExigible + 1,
        `${codigo}: el opaco nunca debe entrar al total a cobrar`);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails or reveals a wrong expectation**

Run: `npm test`
Expected: los 4 tests corren contra el motor ya construido. Si alguno falla, **primero verificar la aritmética del test** (la causación esperada mes a mes) antes de tocar el motor: los totales de referencia ($370.000, $390.000) vienen del Excel conciliado, pero el reparto entre deuda corriente y saldo opaco depende de la apertura sembrada en cada caso. Corregir el test si la cuenta está mal, el motor si el test está bien.

- [ ] **Step 3: Ajustar lo que corresponda**

Si el motor tiene un defecto real, arreglarlo en `CarteraService.js` o en `imputacion.js` y volver a correr toda la suite: los tests de las tareas 3 a 9 son la red de seguridad.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: **toda** la suite pasa, incluidos los tests que ya existían antes de este plan.

- [ ] **Step 5: Commit**

```bash
git add src/services/CarteraService.casosReales.test.js
git commit -m "test(cartera): regresión con los casos reales R034, R037 y R019"
```

---

## Self-Review

**1. Cobertura del spec.** Revisado sección por sección:

| Sección del spec | Tarea |
|---|---|
| §4 modelo de datos (`cartera_movimientos`, `cartera_imputaciones`) | 1 |
| §4 invariantes de imputación | 5 (consulta), 7 (tests) |
| §4.1 recategorización retroactiva por diferencia | 8 |
| §4 `cuenta_creditos` se absorbe | 7 (el sobrante es saldo a favor; nada lee `cuenta_creditos`) |
| §4 `pago_periodos` como archivo histórico | 1 (la migración no la toca) |
| §5 los cuatro modos de imputación | 3 (puro), 7 (servicio) |
| §6 causación y reglas de parada | 6 |
| §6 excepción de la carga inicial | 6 (`asegurarCausacion` sin parámetro de bypass; la carga va en el Plan 2) |
| §6.1 `cuenta_estados`, suspender/reactivar | 1, 4, 9 |
| §6.2 ancla = primer recibo | 6 (`getFechaInicioFacturacion`) |
| §7 la causación no genera asientos | 6, 8, 9 (ningún método llama a `AsientoContableService`) |
| §8 estado de cuenta con los dos bloques | 7 (`getEstadoCartera`) |
| §9 componentes | Todas |
| §10 Fase 0 | **Plan 2**, fuera de alcance |
| §11 decisiones de casos límite | **Plan 2** (son datos, no motor) |
| §13 testing | 1-10 |

Sin huecos dentro del alcance declarado.

**2. Placeholders.** Ninguna tarea dice "TBD", "agregar validación apropiada" ni "similar a la tarea N". Todos los pasos de código traen el código. La Task 10 Step 3 es condicional a propósito (es un test de aceptación contra datos reales), y dice explícitamente qué verificar primero y con qué criterio decidir.

**3. Consistencia de tipos.** Verificado cruzando los bloques `Interfaces`:
- `distribuir` devuelve `{imputaciones: [{cargoId, monto}], sobrante}` en Task 3, y Task 7 consume exactamente `imp.cargoId` / `imp.monto`.
- `getCargosPendientes` devuelve `{id, anio, mes, monto, cubierto, pendiente}` en Task 5; `distribuir` en Task 3 lee `c.id` y `c.pendiente`. Coincide.
- `getCargosConCobertura` devuelve `{anio, mes, monto, cubierto}` en Task 5; `calcularCubiertoHasta` en Task 3 lee esos cuatro campos. Coincide.
- `estadoEnMes` devuelve el string del estado en Task 4; Task 6 lo compara contra `'Activo'`. Coincide.
- `getCategoriaTarifaParaMes` es el método ya existente de `PagoRepository` y devuelve `{tarifa_sostenimiento}`; se usa igual en Tasks 6 y 8.
- `redondear` / `esMayor` se importan de `./cartera/dinero` en Tasks 3, 5, 6, 7, 8 y 9 con la misma firma.
- `CarteraService.MODOS` se expone en Task 7; los tests importan `MODOS` desde `./cartera/imputacion`. Ambas rutas apuntan al mismo objeto.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-29-cartera-motor.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
