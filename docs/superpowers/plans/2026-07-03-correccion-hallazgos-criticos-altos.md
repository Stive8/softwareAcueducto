# Corrección de hallazgos Críticos y Altos (auditoría de Contabilidad) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los 13 hallazgos Críticos (4) y Altos (9) de la auditoría de Contabilidad del 2026-07-03, implementando exactamente las soluciones propuestas en ese informe, con pruebas automatizadas que demuestren que cada defecto ya no ocurre y que nada existente se rompe.

**Architecture:** Cada hallazgo se corrige en la capa donde vive el defecto (esquema/migración, repositorio, servicio, IPC o frontend), reutilizando siempre los mecanismos que la auditoría confirmó como correctos (transacciones de `better-sqlite3`, validación de cuadre en `AsientoContableService.crear()`, `PeriodoContableService`, etc.) en vez de crear caminos paralelos. No se introduce ningún framework ni dependencia nueva.

**Tech Stack:** Electron 38 + Node (vía Electron) + `better-sqlite3` (SQL crudo) + `node:test`/`node:assert` (test runner nativo de Node, sin dependencias nuevas) + SQLite (migraciones secuenciales en `src/database/migrations/*.sql`).

## Global Constraints

- **Los tests deben ejecutarse con el runtime de Node embebido en Electron, nunca con `node` del sistema.** `better-sqlite3` está compilado contra el ABI de Electron (ver `package.json` → `"rebuild": "electron-rebuild -f -w better-sqlite3"`); un `node` de sistema distinto revienta con `NODE_MODULE_VERSION` mismatch al hacer `require('better-sqlite3')`. El comando correcto es `electron --test` con `ELECTRON_RUN_AS_NODE=1` (ver Task 0).
- **Cero dependencias npm nuevas.** El proyecto no tiene ningún framework de pruebas instalado; se usa `node:test` (nativo desde Node 18, disponible en el Node de Electron 38) para no tocar `package-lock.json` ni arriesgar el empaquetado con `electron-builder`.
- **Los montos son siempre pesos colombianos enteros, sin decimales.** No introducir manejo de centavos/decimales en código nuevo.
- **Fechas nuevas en zona horaria local (Colombia, UTC-5), nunca `new Date().toISOString()`.** Ese patrón desplaza un día cerca de medianoche (hallazgo Bajo B-1 de la auditoría); todo código nuevo que necesite "la fecha de hoy" como `YYYY-MM-DD` debe usar `date.toLocaleDateString('en-CA')`, que sí respeta la zona horaria local del sistema.
- **Ninguna migración existente (001–030) se modifica ni se reordena.** Las correcciones de esquema se añaden como migraciones nuevas (031, 032, 033), nunca editando el histórico — la propia auditoría (hallazgo Medio M-5) señala que mutar migraciones ya aplicadas erosiona la garantía de inmutabilidad.
- **`data/acueducto.db` (el archivo real de la app) nunca se toca durante el desarrollo ni las pruebas.** Todo test crea su propia base de datos temporal desechable (ver `crearDbTemporal` en Task 0) y la borra al terminar.
- Los datos actuales en `data/acueducto.db` son de prueba y se borrarán antes de producción (ver memoria del proyecto) — por eso la migración de reconciliación de Task 2 es sobre todo una salvaguarda de buenas prácticas y una plantilla reutilizable si alguna vez hace falta, no una operación urgente sobre datos reales a preservar.

---

## Mapa hallazgo → task

| # | Hallazgo | Task |
|---|---|---|
| Crítico C-1 | $210.666.500 contabilizados contra la cuenta de agrupación `1105` | Task 2 |
| Crítico C-2 | Doble contabilización por falta de protección ante doble envío | Task 13 + Task 14 |
| Crítico C-3 | Dashboard de Contabilidad calcula su propio saldo, incorrecto | Task 7 |
| Crítico C-4 | Migraciones no atómicas | Task 1 |
| Alto A-1 | Editar una plantilla borra en silencio sus impuestos asignados | Task 9 |
| Alto A-2 | Impuestos sin vigencia temporal | Task 10 |
| Alto A-3 | Control de período cerrado eludible (backdating) | Task 11 |
| Alto A-4 | Partir una cuenta con movimientos no re-valida ni migra (causa raíz de C-1) | Task 3 |
| Alto A-5 | Ruptura de la detección por prefijo de Caja/Banco | Task 4 |
| Alto A-6 | Sin `app.requestSingleInstanceLock()` | Task 12 |
| Alto A-7 | Sin validación de saldo suficiente para un gasto en efectivo | Task 8 |
| Alto A-8 | La UI permite revertir directamente asientos automáticos | Task 5 |
| Alto A-9 | Dos ledgers de efectivo sin conciliación automática | Task 6 |

**Orden recomendado:** los tasks están numerados en el orden en que deben ejecutarse. Task 0 (infraestructura de pruebas) y Task 1 (migraciones atómicas) son prerrequisito de todo lo demás. Task 3 (A-4) debe ir antes o junto con Task 2 (C-1) porque es la causa raíz que evita que C-1 se repita. El resto de los tasks son independientes entre sí y pueden ejecutarse en cualquier orden una vez completados 0–4.

---

## Task 0: Infraestructura de pruebas

**Files:**
- Create: `scripts/test.js`
- Create: `src/testUtils/dbTemporal.js`
- Create: `src/testUtils/dbTemporal.test.js`
- Modify: `package.json` (añadir script `"test"`)

**Interfaces:**
- Produces: `crearDbTemporal(): { dbService: DatabaseService, baseDir: string }`, `cerrarDbTemporal({ dbService, baseDir }): void` — usados por **todos** los tasks siguientes que escriben tests.

- [ ] **Step 1: Crear el runner de pruebas**

```js
// scripts/test.js
// Lanza los tests con el runtime de Node embebido en Electron. Es necesario porque
// better-sqlite3 está compilado contra el ABI de Electron (ver "rebuild" en package.json),
// no contra el del Node del sistema: requerirlo desde un `node` normal falla con
// "NODE_MODULE_VERSION mismatch". ELECTRON_RUN_AS_NODE=1 hace que electron.exe se comporte
// como un proceso Node normal (sin abrir ninguna ventana), así que node:test funciona igual
// que en Node puro.
const { spawnSync } = require('child_process');
const electronPath = require('electron');

const resultado = spawnSync(electronPath, ['--test', '--test-reporter=spec'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});

process.exit(resultado.status === null ? 1 : resultado.status);
```

- [ ] **Step 2: Añadir el script al package.json**

Modificar `package.json`, dentro de `"scripts"` (junto a `"start"`, `"dev"`, etc.):

```json
    "test": "node scripts/test.js",
```

- [ ] **Step 3: Crear el helper de base de datos temporal**

```js
// src/testUtils/dbTemporal.js
// Crea una base de datos SQLite temporal y desechable con las migraciones ya aplicadas
// (incluye todo el plan de cuentas, cuentas automáticas, plantillas y mapeo que las propias
// migraciones siembran), para que un test ejercite servicios reales sin tocar
// data/acueducto.db. El llamador SIEMPRE debe cerrar con cerrarDbTemporal() al terminar
// (ideal: en un try/finally o en el hook `after` del test).
const os = require('os');
const fs = require('fs');
const path = require('path');
const DatabaseService = require('../database/DatabaseService');

function crearDbTemporal() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-test-'));
  const dbService = new DatabaseService(baseDir);
  dbService.initialize();
  return { dbService, baseDir };
}

function cerrarDbTemporal({ dbService, baseDir }) {
  dbService.close();
  fs.rmSync(baseDir, { recursive: true, force: true });
}

module.exports = { crearDbTemporal, cerrarDbTemporal };
```

- [ ] **Step 4: Escribir el test que verifica el helper (y de paso, que las 30 migraciones reales corren limpias)**

```js
// src/testUtils/dbTemporal.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('./dbTemporal');

test('crearDbTemporal aplica todas las migraciones y siembra el plan de cuentas', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const totalCuentas = db.prepare('SELECT COUNT(*) as c FROM plan_cuentas').get().c;
    assert.ok(totalCuentas > 100, `Se esperaban >100 cuentas sembradas, hubo ${totalCuentas}`);

    const totalMigraciones = db.prepare('SELECT COUNT(*) as c FROM migrations').get().c;
    assert.equal(totalMigraciones, 29, 'Deben quedar registradas las 29 migraciones (001, 003-030)');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('cerrarDbTemporal borra el directorio temporal', () => {
  const ctx = crearDbTemporal();
  const { baseDir } = ctx;
  cerrarDbTemporal(ctx);
  const fs = require('fs');
  assert.equal(fs.existsSync(baseDir), false);
});
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: `# pass 2`, `# fail 0` (ambos tests de este archivo en verde; es el primer archivo `*.test.js` del proyecto, así que node:test no debería encontrar ningún otro).

- [ ] **Step 6: Commit**

```bash
git add scripts/test.js src/testUtils/dbTemporal.js src/testUtils/dbTemporal.test.js package.json
git commit -m "test: agregar infraestructura de pruebas con node:test y BD temporal"
```

---

## Task 1: [Crítico C-4] Migraciones atómicas

**Files:**
- Modify: `src/database/DatabaseService.js`
- Test: `src/database/DatabaseService.test.js`

**Interfaces:**
- Produces: `new DatabaseService(baseDir, migrationsDir?)` — segundo parámetro opcional, solo usado por tests; todo el código de producción (`main.js`) sigue llamando `new DatabaseService(baseDirDb)` sin cambios.

- [ ] **Step 1: Escribir el test que falla (atomicidad de una migración rota)**

```js
// src/database/DatabaseService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const DatabaseService = require('./DatabaseService');

function crearMigrationsDirTemporal(archivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-migrations-'));
  for (const [nombre, sql] of Object.entries(archivos)) {
    fs.writeFileSync(path.join(dir, nombre), sql, 'utf8');
  }
  return dir;
}

test('una migración que falla a mitad de camino no deja rastro (todo o nada)', () => {
  const migrationsDir = crearMigrationsDirTemporal({
    '001_ok.sql': `CREATE TABLE previa (id INTEGER PRIMARY KEY);`,
    '002_rota.sql': `
      CREATE TABLE tabla_parcial (id INTEGER PRIMARY KEY);
      INSERT INTO tabla_inexistente (id) VALUES (1);
    `
  });
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-test-db-'));

  const dbService = new DatabaseService(baseDir, migrationsDir);
  dbService.createMigrationsTable();

  assert.throws(() => dbService.runMigrations(), /no such table: tabla_inexistente/);

  const db = dbService.getDb();

  // La primera migración (buena) sí debe haber quedado aplicada y registrada.
  const previaExiste = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='previa'`).get();
  assert.ok(previaExiste, 'La migración 001_ok.sql debía quedar aplicada');
  const registro001 = db.prepare(`SELECT name FROM migrations WHERE name = '001_ok.sql'`).get();
  assert.ok(registro001, '001_ok.sql debía quedar registrada como ejecutada');

  // La segunda migración (rota) NO debe haber dejado la tabla a medias, ni haberse marcado como ejecutada.
  const tablaParcialExiste = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tabla_parcial'`).get();
  assert.equal(tablaParcialExiste, undefined, 'tabla_parcial no debía existir: la migración rota debió revertirse por completo');
  const registro002 = db.prepare(`SELECT name FROM migrations WHERE name = '002_rota.sql'`).get();
  assert.equal(registro002, undefined, '002_rota.sql no debía quedar marcada como ejecutada');

  dbService.close();
  fs.rmSync(baseDir, { recursive: true, force: true });
  fs.rmSync(migrationsDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL — con el código actual, `DatabaseService` no acepta un segundo parámetro `migrationsDir` (usa siempre `path.join(__dirname, 'migrations')`), así que el test corre contra las 30 migraciones reales del proyecto en vez de las de prueba, y además `tabla_parcial` SÍ queda creada (falta la transacción), por lo que la aserción de `tablaParcialExiste` falla.

- [ ] **Step 3: Implementar el fix**

Reemplazar el contenido completo de `src/database/DatabaseService.js`:

```js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseService {
  // baseDir: carpeta donde vivirá data/acueducto.db. En la app empaquetada debe ser
  // app.getPath('userData') (ej. %APPDATA%/acueducto-admin), nunca process.cwd():
  // una vez instalada en "Program Files", process.cwd() no es escribible por el usuario.
  //
  // migrationsDir: solo para pruebas automatizadas (permite apuntar a un directorio de
  // migraciones falso). En producción siempre es undefined y se usa la carpeta real.
  constructor(baseDir, migrationsDir) {
    this.dbPath = path.join(baseDir || process.cwd(), 'data', 'acueducto.db');
    const dbDir = path.dirname(this.dbPath);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.migrationsDir = migrationsDir || path.join(__dirname, 'migrations');
  }

  getDbPath() {
    return this.dbPath;
  }

  // Copia de seguridad en caliente (segura con WAL activo) hacia un archivo destino
  backup(destinoPath) {
    return this.db.backup(destinoPath);
  }

  initialize() {
    this.createMigrationsTable();
    this.runMigrations();
  }

  createMigrationsTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  runMigrations() {
    if (!fs.existsSync(this.migrationsDir)) {
      fs.mkdirSync(this.migrationsDir, { recursive: true });
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const executed = this.db.prepare('SELECT name FROM migrations').all();
    const executedNames = executed.map(m => m.name);

    // Cada migración se aplica en una única transacción junto con su propio registro en
    // `migrations`: si cualquier sentencia del archivo falla, TODO el archivo se revierte y no
    // queda marcado como ejecutado, así que el siguiente arranque puede reintentarlo desde cero
    // sin toparse con "ya existe" a mitad de camino. (Antes de este cambio, db.exec() confirmaba
    // cada sentencia por separado en autocommit: un fallo a mitad de archivo podía dejar la base
    // a medias sin que el archivo quedara ni pendiente de forma segura ni aplicado del todo.)
    //
    // Nota para migraciones futuras: dentro de esta transacción, `PRAGMA foreign_keys = OFF/ON`
    // NO tiene efecto (SQLite ignora cambios a foreign_keys mientras hay una transacción activa).
    // Si una migración necesita desactivar temporalmente las FK para recrear una tabla, use
    // `PRAGMA defer_foreign_keys = ON` en su lugar (sí respeta la transacción: aplaza la
    // verificación de FK hasta el COMMIT).
    const aplicarMigracion = this.db.transaction((file, sql) => {
      this.db.exec(sql);
      this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    });

    for (const file of files) {
      if (!executedNames.includes(file)) {
        console.log(`Ejecutando migración: ${file}`);
        const sql = fs.readFileSync(path.join(this.migrationsDir, file), 'utf8');

        aplicarMigracion(file, sql);

        console.log(`Migración ${file} ejecutada con éxito`);
      }
    }
  }

  getDb() {
    return this.db;
  }

  close() {
    this.db.close();
  }
}

module.exports = DatabaseService;
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: `# pass 3` (los 2 de Task 0 + este), `# fail 0`.

- [ ] **Step 5: Verificar que la app real sigue arrancando igual**

Run: `npm start` (o `npm run dev`), confirmar en consola: `Migración 001_create_initial_tables.sql ejecutada con éxito` ... hasta `030_fix_mapeo_gastos_diversos.sql` si es la primera vez, o ningún mensaje de migración si `data/acueducto.db` ya existe (las 29 ya están registradas). La app debe abrir normalmente al login.

- [ ] **Step 6: Commit**

```bash
git add src/database/DatabaseService.js src/database/DatabaseService.test.js
git commit -m "fix(critico): envolver cada migracion en una transaccion atomica"
```

---

## Task 2: [Crítico C-1] Migración de reconciliación de la cuenta de agrupación 1105

**Files:**
- Create: `src/database/migrations/031_reconciliar_movimientos_caja_agrupacion.sql`
- Test: `src/database/migrations/031_reconciliar_movimientos_caja_agrupacion.test.js`

**Interfaces:**
- Consumes: el mecanismo de migraciones de Task 1 (debe aplicarse dentro de una transacción real).
- Produces: ningún movimiento en `movimientos_contables` queda apuntando a una cuenta con hijos.

**Precondición:** Task 1 debe estar mergeado (esta migración se beneficia de la atomicidad, aunque al ser puro SQL sin `PRAGMA foreign_keys`, funcionaría igual sin Task 1 — pero es la primera migración nueva que se escribe, así que valida el mecanismo).

- [ ] **Step 1: Escribir el test que falla**

```js
// src/database/migrations/031_reconciliar_movimientos_caja_agrupacion.test.js
//
// Reproduce exactamente el escenario del hallazgo C-1: un movimiento contable quedó posteado
// contra una cuenta ('1105', Caja) que luego se convirtió en cuenta de agrupación al insertar
// '110505' Caja General como hija suya — el mismo mecanismo que produjo el defecto real
// (ver migración 029). La migración 031 debe reasignar ese movimiento a la hoja correcta.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

test('031 reasigna a Caja General los movimientos que quedaron contra la cuenta padre 1105', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();

    const cuenta1105 = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '1105'`).get();
    const cuenta110505 = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();
    assert.ok(cuenta1105 && cuenta110505, 'El plan de cuentas sembrado debe traer 1105 y 110505');

    // Simula el defecto histórico: un movimiento contable directo contra el padre.
    const asientoId = db.prepare(`
      INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen, referencia_tipo, referencia_id)
      VALUES (9001, '2020-01-01', 'Movimiento de prueba pre-fix', 'Gasto', 'Gasto', 1)
    `).run().lastInsertRowid;
    db.prepare(`
      INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id)
      VALUES ('2020-01-01', ?, 0, 50000, 'Salida de caja (defecto simulado)', ?)
    `).run(cuenta1105.id, asientoId);

    assert.equal(
      db.prepare(`SELECT COUNT(*) as c FROM movimientos_contables WHERE cuenta_id = ?`).get(cuenta1105.id).c,
      1,
      'Precondición: el movimiento simulado debe existir contra 1105 antes de la migración'
    );

    // Aplica solo la migración 031 (ya se aplicaron todas las demás en crearDbTemporal()).
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(
      path.join(__dirname, '031_reconciliar_movimientos_caja_agrupacion.sql'), 'utf8'
    );
    db.exec(sql);

    const enPadreDespues = db.prepare(`SELECT COUNT(*) as c FROM movimientos_contables WHERE cuenta_id = ?`).get(cuenta1105.id).c;
    assert.equal(enPadreDespues, 0, 'Tras la migración, 1105 no debe tener ningún movimiento directo');

    const enHojaDespues = db.prepare(`SELECT COUNT(*) as c, SUM(credito) as total FROM movimientos_contables WHERE cuenta_id = ?`).get(cuenta110505.id);
    assert.equal(enHojaDespues.c, 1, 'El movimiento debe haberse reasignado a 110505 Caja General');
    assert.equal(enHojaDespues.total, 50000, 'El monto debe preservarse exactamente');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('031 es segura de re-ejecutar si ya no hay movimientos contra cuentas con hijos', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(
      path.join(__dirname, '031_reconciliar_movimientos_caja_agrupacion.sql'), 'utf8'
    );
    // No debe lanzar ni cambiar nada al ejecutarse sobre una BD que ya está limpia.
    assert.doesNotThrow(() => db.exec(sql));
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL con `ENOENT: no such file or directory` al leer `031_reconciliar_movimientos_caja_agrupacion.sql` (el archivo todavía no existe).

- [ ] **Step 3: Escribir la migración**

```sql
-- src/database/migrations/031_reconciliar_movimientos_caja_agrupacion.sql
--
-- Corrige el hallazgo Crítico C-1 de la auditoría de Contabilidad (2026-07-03): la migración 029
-- dividió la cuenta '1105' Caja (que hasta entonces era una hoja imputable) en '110505' Caja
-- General y '110510' Caja Menor, y repuntó la cuenta automática CAJA hacia adelante, pero nunca
-- reescribió los movimientos_contables que ya habían quedado posteados contra '1105'. Desde ese
-- momento '1105' es una cuenta de agrupación (tiene hijas), y el propio sistema ya no permite
-- postear contra ella (ver AsientoContableService.crear(), validación tieneHijos) — pero los
-- movimientos históricos seguían ahí, invisibles para el Libro Mayor de "Caja General" y
-- mostrados como una fila fantasma en el Balance de Prueba.
--
-- Sigue el mismo patrón ya usado con éxito en la migración 016 (reclasificación de gastos):
-- reasignar movimientos_contables ya contabilizados con un UPDATE directo, documentado y
-- acotado por WHERE. Todo movimiento contra '1105' es anterior a que existiera Caja Menor
-- (que solo nace en la migración 029), así que reasignar el 100% a Caja General es correcto:
-- no hubo forma de que un movimiento contra '1105' fuera "en realidad" de Caja Menor.
--
-- Es idempotente: tras la primera ejecución, el WHERE no vuelve a encontrar filas.
UPDATE movimientos_contables
SET cuenta_id = (SELECT id FROM plan_cuentas WHERE codigo = '110505')
WHERE cuenta_id = (SELECT id FROM plan_cuentas WHERE codigo = '1105');
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Aplicar sobre la base de datos real y verificar el resultado**

Esto SÍ toca `data/acueducto.db` — es la única vez en todo este plan que se justifica, porque es exactamente la migración que la auditoría recomendó para los datos reales. Antes de ejecutar, confirmar con el usuario que se puede arrancar la app normalmente (la migración corre automáticamente al iniciar, dentro de `dbService.initialize()`).

Run: `npm start`, dejar que la app aplique la migración 031 automáticamente, cerrar la app.

Verificar con una consulta de solo lectura (mismo patrón usado durante la auditoría, con `ELECTRON_RUN_AS_NODE=1`):
```bash
ELECTRON_RUN_AS_NODE=1 "./node_modules/electron/dist/electron.exe" -e "
const Database = require('better-sqlite3');
const db = new Database('./data/acueducto.db', { readonly: true });
console.log(db.prepare(\`SELECT COUNT(*) as c FROM movimientos_contables mc JOIN plan_cuentas pc ON pc.id = mc.cuenta_id WHERE EXISTS (SELECT 1 FROM plan_cuentas h WHERE h.padre_id = pc.id)\`).get());
db.close();
"
```
Expected: `{ c: 0 }` — ningún movimiento contable queda contra una cuenta que tiene hijas.

- [ ] **Step 6: Commit**

```bash
git add src/database/migrations/031_reconciliar_movimientos_caja_agrupacion.sql src/database/migrations/031_reconciliar_movimientos_caja_agrupacion.test.js
git commit -m "fix(critico): reconciliar movimientos historicos de la cuenta de agrupacion 1105 a Caja General"
```

---

## Task 3: [Alto A-4] Bloquear partir una cuenta que ya tiene movimientos

**Files:**
- Modify: `src/services/PlanCuentaService.js`
- Test: `src/services/PlanCuentaService.test.js`

**Interfaces:**
- Consumes: `PlanCuentaRepository.tieneMovimientos(id)` (ya existe, sin cambios).
- Produces: `PlanCuentaService.create(cuentaData)` lanza si `padreId` ya tiene movimientos.

- [ ] **Step 1: Escribir el test que falla**

```js
// src/services/PlanCuentaService.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const PlanCuentaService = require('./PlanCuentaService');

test('create() rechaza crear una subcuenta bajo un padre que ya tiene movimientos contables', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new PlanCuentaService(ctx.dbService);

    // Cuenta hoja de nivel 4 con un movimiento contable real (simula el escenario de C-1: una
    // cuenta que hoy es hoja y en uso, antes de que alguien intente partirla en subcuentas).
    const padreId = service.create({
      codigo: '999901', nombre: 'Cuenta de prueba con movimiento', tipo: 'Activo', naturaleza: 'Debito'
    });
    const asientoId = db.prepare(`
      INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen)
      VALUES (9002, '2026-01-01', 'Asiento de prueba', 'Manual')
    `).run().lastInsertRowid;
    db.prepare(`
      INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id)
      VALUES ('2026-01-01', ?, 10000, 0, 'Movimiento de prueba', ?)
    `).run(padreId, asientoId);

    assert.throws(
      () => service.create({ codigo: '99990101', nombre: 'Subcuenta', tipo: 'Activo', naturaleza: 'Debito', padreId }),
      /ya tiene movimientos/i
    );

    // La cuenta padre no debe haber quedado con hijas a medio crear.
    const hijos = db.prepare('SELECT COUNT(*) as c FROM plan_cuentas WHERE padre_id = ?').get(padreId).c;
    assert.equal(hijos, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() sigue permitiendo crear una subcuenta bajo un padre SIN movimientos (caso normal)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new PlanCuentaService(ctx.dbService);
    const padreId = service.create({
      codigo: '999902', nombre: 'Cuenta de prueba sin movimiento', tipo: 'Activo', naturaleza: 'Debito'
    });
    const hijoId = service.create({
      codigo: '99990201', nombre: 'Subcuenta válida', tipo: 'Activo', naturaleza: 'Debito', padreId
    });
    assert.ok(hijoId > 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL en el primer test — `assert.throws` no recibe ninguna excepción porque hoy `create()` no valida movimientos del padre.

- [ ] **Step 3: Implementar el fix**

En `src/services/PlanCuentaService.js`, modificar el método `create` (reemplazar el bloque completo del método, líneas actuales 27-49):

```js
  create(cuentaData) {
    const { codigo, nombre, tipo, naturaleza, padreId } = cuentaData;

    if (!codigo || !codigo.trim()) throw new Error('El código de la cuenta es obligatorio');
    if (!nombre || !nombre.trim()) throw new Error('El nombre de la cuenta es obligatorio');
    if (!TIPOS_VALIDOS.includes(tipo)) throw new Error('Tipo de cuenta inválido');
    if (!NATURALEZA_VALIDA.includes(naturaleza)) throw new Error('Naturaleza de cuenta inválida');

    if (this.repository.findByCodigo(codigo.trim())) {
      throw new Error('Ya existe una cuenta con ese código');
    }

    let nivel = 1;
    if (padreId) {
      const padre = this.repository.findById(padreId);
      if (!padre) throw new Error('La cuenta padre no existe');
      if (padre.nivel >= 5) throw new Error('No se pueden crear cuentas debajo de un auxiliar (nivel máximo alcanzado)');
      if (padre.tipo !== tipo) throw new Error('La cuenta debe tener el mismo tipo que su cuenta padre');
      // Convertir una cuenta que ya tiene movimientos en una cuenta de agrupación deja esos
      // movimientos "huérfanos": el sistema ya no admite postear contra una cuenta con hijas
      // (ver AsientoContableService.crear()), pero los movimientos ya contabilizados se quedan
      // apuntando a ella sin que nada los detecte ni los migre. Este fue exactamente el
      // mecanismo del hallazgo Crítico C-1 (la cuenta '1105' Caja, con nueve años de historia,
      // convertida en agrupación por la migración 029 sin reasignar sus movimientos). En vez de
      // repetir ese defecto, se bloquea la operación: quien necesite reorganizar una cuenta en
      // uso debe hacerlo con una migración de datos explícita (ver 031 como plantilla), que
      // reasigne los movimientos existentes en la misma operación.
      if (this.repository.tieneMovimientos(padreId)) {
        throw new Error(
          `No se puede crear una subcuenta bajo "${padre.nombre}" porque esa cuenta ya tiene movimientos registrados. ` +
          `Convertirla en cuenta de agrupación dejaría esos movimientos huérfanos. Si necesita reorganizar el plan de ` +
          `cuentas, contacte a soporte técnico para una migración de datos que reasigne el histórico primero.`
        );
      }
      nivel = padre.nivel + 1;
    }

    return this.repository.create({ codigo: codigo.trim(), nombre: nombre.trim(), tipo, naturaleza, nivel, padreId: padreId || null });
  }
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/PlanCuentaService.js src/services/PlanCuentaService.test.js
git commit -m "fix(alto): bloquear crear subcuentas bajo una cuenta que ya tiene movimientos"
```

---

## Task 4: [Alto A-5] Corregir la detección de Caja/Banco por ancestro de nivel 3

**Files:**
- Modify: `src/repositories/PlanCuentaRepository.js`
- Modify: `src/services/AsientoContableService.js`
- Test: `src/services/AsientoContableService.sincronizacion.test.js`

**Interfaces:**
- Produces: `PlanCuentaRepository.getAncestroHastaNivel(id, nivelMax): cuenta | null` — nuevo método.
- Modifica el comportamiento interno de `AsientoContableService._getCodigosCajaBanco()` (privado, sin cambio de firma pública).

- [ ] **Step 1: Escribir el test que falla**

```js
// src/services/AsientoContableService.sincronizacion.test.js
//
// Reproduce el hallazgo A-5: tras la migración 029, la cuenta automática CAJA apunta a la hoja
// '110505' (Caja General), así que un asiento manual contra '110510' (Caja Menor) —hermana de
// '110505', ambas bajo el padre '1105'— debía reflejarse en el ledger simple `movimientos` (es
// dinero de "Caja" igual) pero la detección por prefijo de código no la reconocía.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const AsientoContableService = require('./AsientoContableService');

test('un asiento manual contra Caja Menor (110510) se refleja en el ledger simple `movimientos`', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    const cajaMenor = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110510'`).get();
    const gastosDiversos = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();
    assert.ok(cajaMenor && gastosDiversos, 'El plan de cuentas sembrado debe traer 110510 y 519599');

    service.crearManual({
      fecha: '2026-07-03',
      concepto: 'Ajuste manual de Caja Menor (prueba)',
      lineas: [
        { cuentaContableId: gastosDiversos.id, debito: 15000 },
        { cuentaContableId: cajaMenor.id, credito: 15000 }
      ]
    });

    const enLedgerSimple = db.prepare(`
      SELECT COUNT(*) as c FROM movimientos WHERE origen = 'Caja' AND concepto LIKE '%Ajuste manual de Caja Menor%'
    `).get().c;
    assert.equal(enLedgerSimple, 1, 'El movimiento contra Caja Menor debía replicarse en la tabla `movimientos`');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL — `enLedgerSimple` es `0`: la detección actual por prefijo (`'110510'.startsWith('110505')` es `false`) no reconoce Caja Menor como "Caja".

- [ ] **Step 3: Añadir el método al repositorio**

En `src/repositories/PlanCuentaRepository.js`, añadir este método (después de `tieneMovimientos`, antes de `create`):

```js
  // Sube por la jerarquía padre_id hasta encontrar un ancestro de nivel <= nivelMax (o hasta la
  // raíz si la cuenta ya está en un nivel <= nivelMax). Se usa para agrupar todas las subcuentas
  // de una "familia" (p.ej. Caja General y Caja Menor comparten el mismo ancestro de nivel 3,
  // '1105' Caja) sin depender de que sus códigos compartan un prefijo de longitud fija.
  getAncestroHastaNivel(id, nivelMax) {
    let cuenta = this.findById(id);
    while (cuenta && cuenta.nivel > nivelMax && cuenta.padre_id) {
      cuenta = this.findById(cuenta.padre_id);
    }
    return cuenta || null;
  }
```

- [ ] **Step 4: Reescribir la detección en AsientoContableService**

En `src/services/AsientoContableService.js`, reemplazar el método `_getCodigosCajaBanco` (líneas actuales 41-49):

```js
  // Códigos PUC del ancestro de nivel 3 de Caja y de Banco, cacheados para la sesión (evitar un
  // SELECT por cada línea en sincronizarLineaConCajaBanco). Se resuelven a partir del ANCESTRO
  // de nivel 3 de la cuenta automática configurada (no del código exacto de esa cuenta): así,
  // sin importar cuántas subcuentas de detalle existan bajo Caja o Banco (Caja General, Caja
  // Menor, Cuenta Corriente, Cuenta de Ahorros...), todas se reconocen como la misma "familia"
  // de efectivo. Esto es justamente lo que se perdió cuando la migración 029 movió la cuenta
  // automática CAJA del nodo padre '1105' a la hoja '110505': antes, cualquier subcuenta nueva
  // bajo '1105' quedaba cubierta automáticamente por el prefijo; ahora se recalcula subiendo la
  // jerarquía en vez de depender de que el código de la automática sea justo el prefijo correcto.
  // Se invalidan con _codigosCajaBancoCache = null.
  _getCodigosCajaBanco() {
    if (!this._codigosCajaBancoCache) {
      const cajaId = this.cuentaAutomaticaRepository.getCuentaIdByClave('CAJA');
      const bancoId = this.cuentaAutomaticaRepository.getCuentaIdByClave('BANCO');
      const ancestroCaja = cajaId ? this.planCuentaRepository.getAncestroHastaNivel(cajaId, 3) : null;
      const ancestroBanco = bancoId ? this.planCuentaRepository.getAncestroHastaNivel(bancoId, 3) : null;
      this._codigosCajaBancoCache = {
        caja: ancestroCaja ? ancestroCaja.codigo : null,
        banco: ancestroBanco ? ancestroBanco.codigo : null
      };
    }
    return this._codigosCajaBancoCache;
  }
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 6: Verificar que Banco (Cuenta de Ahorros / Cuenta Corriente) sigue funcionando igual**

Añadir un test adicional al mismo archivo, antes de cerrar el paso:

```js
test('un asiento manual contra Cuenta de Ahorros (111005) se sigue reflejando en `movimientos` como Banco', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    const cuentaAhorros = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '111005'`).get();
    const gastosDiversos = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();

    service.crearManual({
      fecha: '2026-07-03',
      concepto: 'Comisión bancaria (prueba)',
      lineas: [
        { cuentaContableId: gastosDiversos.id, debito: 5000 },
        { cuentaContableId: cuentaAhorros.id, credito: 5000 }
      ]
    });

    const enLedgerSimple = db.prepare(`
      SELECT COUNT(*) as c FROM movimientos WHERE origen = 'Banco' AND concepto LIKE '%Comisión bancaria%'
    `).get().c;
    assert.equal(enLedgerSimple, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

Run: `npm test`
Expected: `# pass 9`, `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/repositories/PlanCuentaRepository.js src/services/AsientoContableService.js src/services/AsientoContableService.sincronizacion.test.js
git commit -m "fix(alto): detectar Caja/Banco por ancestro de nivel 3 en vez de prefijo de codigo"
```

---

## Task 5: [Alto A-8] Restringir la reversión directa a asientos manuales

> **Corrección post-revisión (2026-07-03):** la primera versión de este task ponía la restricción directamente dentro de `revertir()`. Un revisor de Task Reviewer detectó — y reprodujo con un test real — que `revertir()` también es el método que usa internamente `revertirPorReferencia()`, al que llaman `GastoService.anular()`/`ReciboService.anular()` (y sus `corregirMetodoPago()`) como parte de su propio flujo, ya correctamente coordinado. Poner la restricción ahí rompía por completo la anulación de gastos y recibos. La versión de abajo ya corrige esto: `revertir()` vuelve a quedar sin restricción (uso interno, vía `revertirPorReferencia`), y se agrega `revertirManual()` como punto de entrada restringido, que es al que debe apuntar el canal IPC `asientos:revertir` en `main.js`. Sigue el mismo patrón que ya usa el código (`crear()` interno / `crearManual()` público).

**Files:**
- Modify: `src/services/AsientoContableService.js`
- Modify: `main.js`
- Modify: `src/renderer/js/contabilidad.js`
- Test: `src/services/AsientoContableService.revertir.test.js`

**Interfaces:**
- `AsientoContableService.revertir(asientoId, motivo, usuarioId)`: **sin cambios de comportamiento** — sigue sin restricción por `tipo_origen`, para no romper el uso interno vía `revertirPorReferencia()`.
- Nuevo: `AsientoContableService.revertirManual(asientoId, motivo, usuarioId)`: valida que `asiento.tipo_origen === 'Manual'` y solo entonces delega en `revertir()`. Es el único punto de entrada que debe usar el canal IPC `asientos:revertir`.

- [ ] **Step 1: Escribir el test que falla**

```js
// src/services/AsientoContableService.revertir.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const AsientoContableService = require('./AsientoContableService');

test('revertirManual() rechaza un asiento automático (tipo_origen=Gasto): debe anularse el documento origen', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    const cuentaGasto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();
    const cuentaCaja = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();

    const asientoId = service.crear({
      fecha: '2026-07-03',
      concepto: 'Gasto simulado',
      tipoOrigen: 'Gasto',
      referenciaId: 999,
      referenciaTipo: 'Gasto',
      lineas: [
        { cuentaContableId: cuentaGasto.id, debito: 20000 },
        { cuentaContableId: cuentaCaja.id, credito: 20000 }
      ]
    });

    assert.throws(
      () => service.revertirManual(asientoId, 'Intento de reversión directa'),
      /debe anularse desde el módulo|no se puede revertir directamente/i
    );

    const asiento = service.getById(asientoId);
    assert.equal(asiento.estado, 'Activo', 'El asiento automático no debe quedar Anulado por una reversión directa rechazada');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('revertirManual() sigue permitiendo revertir un asiento Manual', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    const cuentaGasto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();
    const cuentaCaja = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();

    const asientoId = service.crearManual({
      fecha: '2026-07-03',
      concepto: 'Nota manual',
      lineas: [
        { cuentaContableId: cuentaGasto.id, debito: 8000 },
        { cuentaContableId: cuentaCaja.id, credito: 8000 }
      ]
    });

    const reversionId = service.revertirManual(asientoId, 'Corrección de prueba');
    assert.ok(reversionId > 0);

    const original = service.getById(asientoId);
    assert.equal(original.estado, 'Anulado');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('revertirPorReferencia() (usado por GastoService.anular/ReciboService.anular) sigue revirtiendo un asiento automático SIN restricción de tipo_origen', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    const cuentaGasto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();
    const cuentaCaja = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();

    service.crear({
      fecha: '2026-07-03',
      concepto: 'Gasto simulado',
      tipoOrigen: 'Gasto',
      referenciaId: 777,
      referenciaTipo: 'Gasto',
      lineas: [
        { cuentaContableId: cuentaGasto.id, debito: 12000 },
        { cuentaContableId: cuentaCaja.id, credito: 12000 }
      ]
    });

    // Este es exactamente el camino interno que usan GastoService.anular()/ReciboService.anular()
    // (y sus corregirMetodoPago()): NO debe verse afectado por la restricción de
    // revertirManual(), o la anulación de gastos/recibos quedaría completamente rota.
    const reversionId = service.revertirPorReferencia('Gasto', 777, 'Anulación de gasto de prueba');
    assert.ok(reversionId > 0, 'revertirPorReferencia debe seguir funcionando para asientos automáticos, sin restricción');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL en los primeros dos tests con `service.revertirManual is not a function` (el método todavía no existe). El tercer test debe PASAR ya (`revertirPorReferencia`/`revertir` no tienen restricción hoy) — así queda documentado desde el principio que ese camino no se puede romper.

- [ ] **Step 3: Implementar el fix en el backend**

En `src/services/AsientoContableService.js`, **NO modificar el método `revertir()` existente** (líneas actuales 369-413): debe quedar exactamente como está, sin ninguna restricción por `tipo_origen`, porque `revertirPorReferencia()` (líneas 362-367, tampoco se toca) depende de que siga aceptando cualquier asiento activo.

Añadir el nuevo método `revertirManual`, inmediatamente después del cierre de `revertir()` (después de la línea 413, antes del cierre de la clase):

```js
  // Punto de entrada directo (usado por la pantalla de Asientos / canal IPC asientos:revertir):
  // a diferencia de revertir(), SOLO acepta revertir notas contables manuales. Un asiento
  // generado automáticamente (Gasto/Recibo/Movimiento) o uno que ya es en sí mismo una reversión
  // debe deshacerse desde su propio módulo (anular el gasto/recibo/traslado, que internamente
  // llama a revertir() vía revertirPorReferencia() y sí coordina correctamente TANTO la doble
  // partida como el libro simple `movimientos` y el estado del documento origen). Revertir aquí
  // directamente un asiento automático solo actualizaba la doble partida, dejando el "Saldo en
  // Caja/Banco" del Dashboard sin revertir y el documento origen con estado "Activo" pese a que
  // su único asiento quedaba "Anulado" (hallazgo Alto A-8 de la auditoría de Contabilidad,
  // 2026-07-03). La restricción vive aquí y NO en revertir() para no bloquear el uso interno de
  // revertirPorReferencia() que GastoService.anular()/ReciboService.anular() sí necesitan.
  revertirManual(asientoId, motivo, usuarioId = null) {
    const asiento = this.repository.findById(asientoId);
    if (!asiento) throw new Error('Asiento no encontrado');
    if (asiento.tipo_origen !== 'Manual') {
      const nombreModulo = { Gasto: 'Gastos', Recibo: 'Recibos', Movimiento: 'Caja', Reversion: null }[asiento.tipo_origen];
      throw new Error(
        nombreModulo
          ? `Este asiento se generó automáticamente y debe anularse desde el módulo de ${nombreModulo}, no revertirse aquí directamente.`
          : `Un asiento de Reversión no se puede revertir directamente; si necesita deshacer su efecto, anule el documento original.`
      );
    }
    return this.revertir(asientoId, motivo, usuarioId);
  }
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: todos los tests en verde, incluidos los 3 nuevos de este task.

- [ ] **Step 5: Apuntar el canal IPC al nuevo método restringido**

En `main.js`, el handler `asientos:revertir` (busca `envolverHandle('asientos:revertir'`) hoy llama a `asientoContableService.revertir(id, motivo, sesionActual.id)`. Cambiarlo para que llame a `revertirManual`:

```js
  envolverHandle('asientos:revertir', async (event, id, motivo) => {
    try {
      const reversionId = asientoContableService.revertirManual(id, motivo, sesionActual.id);
      return { success: true, data: { id: reversionId } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
```

(Es el único cambio en `main.js`: mismo nombre de canal, misma firma, mismo manejo de errores — solo cambia qué método del servicio se invoca.)

- [ ] **Step 6: Ajustar el frontend para no ofrecer el botón cuando no aplica**

En `src/renderer/js/contabilidad.js`, línea 960, reemplazar:

```js
          ${asiento.estado === 'Activo' ? `<button class="btn btn-warning" onclick="App.closeModal(); Contabilidad.showRevertirAsientoModal(${asiento.id})">Revertir</button>` : ''}
```

por:

```js
          ${asiento.estado === 'Activo' && asiento.tipo_origen === 'Manual' ? `<button class="btn btn-warning" onclick="App.closeModal(); Contabilidad.showRevertirAsientoModal(${asiento.id})">Revertir</button>` : ''}
          ${asiento.estado === 'Activo' && asiento.tipo_origen !== 'Manual' ? `<p style="font-size: 0.8rem; color: #64748b;">Este asiento se generó automáticamente. Para revertirlo, anule el documento que lo originó desde su propio módulo (Gastos, Recibos o Caja).</p>` : ''}
```

- [ ] **Step 7: Verificación manual en la app**

Run: `npm start`, iniciar sesión como Administrador, ir a Contabilidad → Asientos, abrir un asiento con `tipo_origen` distinto de Manual (por ejemplo uno generado por un Gasto real) → confirmar que ya no aparece el botón "Revertir" sino el mensaje explicativo. Abrir un asiento manual (o crear uno con "Nueva Nota Contable") → confirmar que "Revertir" sigue funcionando igual que antes. Por separado, anular un Gasto real desde el módulo de Gastos → confirmar que la anulación sigue funcionando (este es exactamente el flujo que la primera versión de este task rompía).

- [ ] **Step 8: Commit**

```bash
git add src/services/AsientoContableService.js main.js src/renderer/js/contabilidad.js src/services/AsientoContableService.revertir.test.js
git commit -m "fix(alto): restringir la reversion directa de asientos a solo tipo Manual"
```

---

## Task 6: [Alto A-9] Verificación de conciliación entre el libro simple y la doble partida

> **Corrección post-revisión (2026-07-03):** la primera versión de este task nombraba el canal IPC `asientos:verificarConciliacion`. `main.js` clasifica un canal como solo-lectura (accesible al rol Consulta) únicamente si su verbo empieza por uno de `PREFIJOS_LECTURA = ['get','find','simular','tiene','imprimir','exportar','generar']` — `verificarConciliacion` no matchea ninguno, así que quedaba clasificado como escritura y el rol Consulta era rechazado, exactamente lo contrario de lo que pedía esta misma sección ("solo lectura, cualquier rol autenticado"). Se corrige renombrando el canal IPC y el método expuesto en `preload.js` a `asientos:getConciliacionCajaBanco` (el método del servicio, `verificarConciliacionCajaBanco()`, no cambia — la clasificación por prefijo solo mira el nombre del canal IPC, no el del método interno).

**Files:**
- Modify: `src/repositories/AsientoContableRepository.js`
- Modify: `src/services/AsientoContableService.js`
- Modify: `main.js`
- Modify: `preload.js`
- Test: `src/services/AsientoContableService.conciliacion.test.js`

**Interfaces:**
- Produces: `AsientoContableRepository.getSaldoConSubcuentas(cuentaId): number`, `AsientoContableService.verificarConciliacionCajaBanco(): Array<{cuenta, saldoLedgerSimple, saldoDoblePartida, diferencia, conciliado}>`.
- Produces: canal IPC `asientos:getConciliacionCajaBanco` (solo lectura, cualquier rol autenticado — es información de diagnóstico, no un dato operativo sensible; el nombre empieza por `get` a propósito para que `main.js` lo clasifique como lectura).

- [ ] **Step 1: Escribir el test que falla**

```js
// src/services/AsientoContableService.conciliacion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const AsientoContableService = require('./AsientoContableService');

test('verificarConciliacionCajaBanco() reporta conciliado=true en una BD recién sembrada (sin movimientos)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AsientoContableService(ctx.dbService);
    const resultado = service.verificarConciliacionCajaBanco();

    assert.equal(resultado.length, 2, 'Debe reportar Caja y Banco');
    for (const fila of resultado) {
      assert.equal(fila.saldoLedgerSimple, 0);
      assert.equal(fila.saldoDoblePartida, 0);
      assert.equal(fila.conciliado, true, `${fila.cuenta} debía estar conciliado`);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('verificarConciliacionCajaBanco() detecta una diferencia real entre los dos libros', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new AsientoContableService(ctx.dbService);

    // Inserta un movimiento SOLO en la doble partida, simulando una desincronización
    // (algo que, tras Task 4, ya no debería ocurrir para asientos manuales, pero esta prueba
    // verifica que la propia verificación de conciliación sabe detectarlo si volviera a pasar).
    const cuentaCaja = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();
    const cuentaGasto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();
    const asientoId = db.prepare(`
      INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen)
      VALUES (9003, '2026-07-03', 'Desincronizado a propósito', 'Manual')
    `).run().lastInsertRowid;
    db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2026-07-03', ?, 30000, 0, 'x', ?)`).run(cuentaGasto.id, asientoId);
    db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2026-07-03', ?, 0, 30000, 'x', ?)`).run(cuentaCaja.id, asientoId);

    const resultado = service.verificarConciliacionCajaBanco();
    const caja = resultado.find(f => f.cuenta === 'Caja');
    assert.equal(caja.conciliado, false);
    assert.equal(caja.diferencia, 30000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL — `service.verificarConciliacionCajaBanco is not a function`.

- [ ] **Step 3: Añadir el método al repositorio**

En `src/repositories/AsientoContableRepository.js`, añadir (después de `getLibroDiario`, antes del cierre de la clase):

```js
  // Suma débito-crédito en movimientos_contables para una cuenta y TODAS sus cuentas
  // descendientes (recursivo por padre_id). Se usa para conciliar contra el libro simple
  // `movimientos`, que no distingue entre Caja General y Caja Menor: ambas deben sumarse juntas
  // para comparar peras con peras.
  getSaldoConSubcuentas(cuentaId) {
    const row = this.db.prepare(`
      WITH RECURSIVE subcuentas(id) AS (
        SELECT id FROM plan_cuentas WHERE id = ?
        UNION ALL
        SELECT pc.id FROM plan_cuentas pc INNER JOIN subcuentas s ON pc.padre_id = s.id
      )
      SELECT COALESCE(SUM(mc.debito - mc.credito), 0) as saldo
      FROM movimientos_contables mc
      WHERE mc.cuenta_id IN (SELECT id FROM subcuentas)
    `).get(cuentaId);
    return row.saldo;
  }
```

- [ ] **Step 4: Añadir el método al servicio**

En `src/services/AsientoContableService.js`:

1. Añadir el `require` al principio del archivo (junto a los demás):
```js
const CajaRepository = require('../repositories/CajaRepository');
```

2. En el constructor (líneas actuales 31-37), añadir la nueva dependencia:
```js
  constructor(dbService) {
    this.repository = new AsientoContableRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
    this.cuentaAutomaticaRepository = new CuentaAutomaticaRepository(dbService);
    this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService));
    this.motorService = new MotorContabilizacionService(dbService);
    this.cajaRepository = new CajaRepository(dbService);
  }
```

3. Añadir los métodos nuevos, después de `sincronizarLineaConCajaBanco` (después de la línea actual 275):
```js
  // Compara, para Caja y para Banco, el saldo del libro simple (tabla `movimientos`, la fuente
  // del Dashboard y de la pantalla de Caja) contra el saldo de la cuenta de doble partida
  // correspondiente (incluidas todas sus subcuentas). Si difieren, algo quedó desincronizado
  // entre los dos libros — ver hallazgo Alto A-9 de la auditoría de Contabilidad (2026-07-03).
  // Pensado para invocarse desde una pantalla de diagnóstico o, como aquí, desde pruebas
  // automatizadas que protejan contra que el defecto vuelva a aparecer.
  verificarConciliacionCajaBanco() {
    const { caja: codigoCaja, banco: codigoBanco } = this._getCodigosCajaBanco();
    const resultado = [];

    if (codigoCaja) {
      const cuentaCaja = this.planCuentaRepository.findByCodigo(codigoCaja);
      resultado.push(this._compararSaldoLedgers(
        'Caja',
        this.cajaRepository.getSaldoCaja(),
        this.repository.getSaldoConSubcuentas(cuentaCaja.id)
      ));
    }
    if (codigoBanco) {
      const cuentaBanco = this.planCuentaRepository.findByCodigo(codigoBanco);
      resultado.push(this._compararSaldoLedgers(
        'Banco',
        this.cajaRepository.getSaldoBanco(),
        this.repository.getSaldoConSubcuentas(cuentaBanco.id)
      ));
    }
    return resultado;
  }

  _compararSaldoLedgers(nombreCuenta, saldoLedgerSimple, saldoDoblePartida) {
    const diferencia = Math.round((saldoLedgerSimple - saldoDoblePartida) * 100) / 100;
    return {
      cuenta: nombreCuenta,
      saldoLedgerSimple,
      saldoDoblePartida,
      diferencia,
      conciliado: Math.abs(diferencia) < 1
    };
  }
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: `# pass 13`, `# fail 0`.

- [ ] **Step 6: Exponer el canal IPC**

En `main.js`, buscar el bloque de handlers de `asientos:getBalancePrueba` (línea actual 904-909) y añadir justo después:

```js
  envolverHandle('asientos:getConciliacionCajaBanco', async () => {
    try {
      return { success: true, data: asientoContableService.verificarConciliacionCajaBanco() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
```

En `preload.js`, dentro del bloque `asientos: { ... }` (líneas 147-156), añadir:

```js
    getConciliacionCajaBanco: () => ipcRenderer.invoke('asientos:getConciliacionCajaBanco'),
```

- [ ] **Step 7: Verificación manual del canal IPC**

Run: `npm start`, iniciar sesión (probar con un usuario de rol Consulta además de Administrador, para confirmar que el canal ya no lo rechaza), abrir la consola de DevTools (`--dev`) y ejecutar en la consola del renderer:
```js
await window.api.asientos.getConciliacionCajaBanco()
```
Expected: `{ success: true, data: [ { cuenta: 'Caja', saldoLedgerSimple: ..., saldoDoblePartida: ..., diferencia: 0, conciliado: true }, { cuenta: 'Banco', ... conciliado: true } ] }` — sobre la base de datos real, después de aplicar la migración 031 de Task 2, ambas cuentas deben quedar conciliadas.

- [ ] **Step 8: Commit**

```bash
git add src/repositories/AsientoContableRepository.js src/services/AsientoContableService.js main.js preload.js src/services/AsientoContableService.conciliacion.test.js
git commit -m "feat(alto): agregar verificacion de conciliacion entre libro simple y doble partida"
```

---

## Task 7: [Crítico C-3] El Dashboard de Contabilidad reutiliza CajaRepository

**Files:**
- Modify: `src/repositories/ReporteRepository.js`
- Test: `src/repositories/ReporteRepository.dashboard.test.js`

**Interfaces:**
- Modifica `ReporteRepository.getDashboardContable()`: `saldoCaja`/`saldoBanco` ahora vienen de `CajaRepository.getSaldoCaja()`/`getSaldoBanco()`.

- [ ] **Step 1: Escribir el test que falla**

```js
// src/repositories/ReporteRepository.dashboard.test.js
//
// Reproduce el hallazgo Crítico C-3: la fórmula propia de getDashboardContable() ignora el
// saldo inicial configurado y pierde el dinero movido en traslados internos (Caja<->Banco).
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ReporteRepository = require('./ReporteRepository');
const CajaRepository = require('./CajaRepository');

test('getDashboardContable().saldoCaja coincide con CajaRepository.getSaldoCaja() (incluye saldo inicial y traslados)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`UPDATE configuracion SET valor = '100000' WHERE clave = 'saldo_caja_inicial'`).run();

    // Un traslado Banco -> Caja: debe SUMAR a Caja y RESTAR de Banco.
    db.prepare(`
      INSERT INTO movimientos (tipo, origen, destino, monto, concepto, fecha_movimiento)
      VALUES ('Traslado', 'Banco', 'Caja', 25000, 'Retiro de banco a caja (prueba)', '2026-07-03')
    `).run();

    const reporteRepository = new ReporteRepository(ctx.dbService);
    const cajaRepository = new CajaRepository(ctx.dbService);

    const dashboard = reporteRepository.getDashboardContable();

    assert.equal(dashboard.saldoCaja, cajaRepository.getSaldoCaja());
    assert.equal(dashboard.saldoCaja, 125000, 'saldo inicial 100.000 + 25.000 entrantes por traslado');
    assert.equal(dashboard.saldoBanco, cajaRepository.getSaldoBanco());
    assert.equal(dashboard.saldoBanco, -25000, '0 inicial - 25.000 salientes por traslado');
    assert.equal(dashboard.saldoDisponible, dashboard.saldoCaja + dashboard.saldoBanco);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL — con la fórmula actual, `dashboard.saldoCaja` es `0` (no suma el saldo inicial ni el traslado entrante), distinto de `cajaRepository.getSaldoCaja()` que sí vale `125000`.

- [ ] **Step 3: Implementar el fix**

En `src/repositories/ReporteRepository.js`:

1. Añadir el `require` al principio del archivo:
```js
const CajaRepository = require('./CajaRepository');
```

2. Modificar el constructor (líneas actuales 8-11):
```js
class ReporteRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
    this.cajaRepository = new CajaRepository(dbService);
  }
```

3. Reemplazar el cálculo de `saldoCaja`/`saldoBanco` dentro de `getDashboardContable()` (líneas actuales 272-286):
```js
    // Reutiliza EXACTAMENTE la misma fórmula que ya usan correctamente el Dashboard general y
    // la pantalla de Caja (CajaRepository.getSaldo): saldo inicial configurado + ingresos -
    // egresos/traslados salientes + traslados entrantes. Antes, este método reimplementaba su
    // propia fórmula que ignoraba el saldo inicial y solo miraba `origen`, nunca `destino`, así
    // que cualquier traslado interno (consignación, retiro) hacía "desaparecer" ese dinero del
    // tablero — hallazgo Crítico C-3 de la auditoría de Contabilidad (2026-07-03).
    const saldoCaja = this.cajaRepository.getSaldoCaja();
    const saldoBanco = this.cajaRepository.getSaldoBanco();
```

(Las variables `saldoCaja`/`saldoBanco` se siguen usando exactamente igual más abajo en el `return`, sin más cambios.)

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: `# pass 14`, `# fail 0`.

- [ ] **Step 5: Verificación manual en la app**

Run: `npm start`, ir a Configuración y confirmar el `saldo_caja_inicial`/`saldo_banco_inicial` actuales; ir a Contabilidad → Dashboard y a Caja, comparar "Saldo Disponible"/"Saldo en Caja"/"Saldo en Banco" en ambas pantallas — deben coincidir exactamente.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/ReporteRepository.js src/repositories/ReporteRepository.dashboard.test.js
git commit -m "fix(critico): dashboard de contabilidad reutiliza CajaRepository.getSaldo"
```

---

## Task 8: [Alto A-7] Validar saldo suficiente antes de un gasto en efectivo

> **Corrección post-revisión (2026-07-03):** la primera versión del Step 5 mostraba el aviso de saldo SIEMPRE bajo la etiqueta "Saldo actual en Caja Menor", sin importar si el selector tenía elegida "Caja General" o "Caja Menor" — un reviewer lo señaló como potencialmente engañoso (aunque puramente informativo: la validación real y vinculante del Step 3, en el backend, sí distingue correctamente ambas cajas). Se corrige para que el aviso solo se muestre cuando el selector tiene "Caja Menor" elegida (es la única subcuenta para la que existe hoy una consulta de saldo específica vía `cajaMenor.getEstado()`); para "Caja General" simplemente no se muestra nada, en vez de mostrar un número que podría no corresponder.

**Files:**
- Modify: `src/services/GastoService.js`
- Modify: `src/renderer/js/gastos.js`
- Test: `src/services/GastoService.saldo.test.js`

**Interfaces:**
- Consumes: `AsientoContableService.getLibroMayor(cuentaId).saldoFinal` (ya existe, mismo patrón que usa `CajaMenorService.getEstado()`).
- Modifica `GastoService.create(gastoData, usuarioId)`: lanza si `gastoData.valor` supera el saldo disponible de la caja elegida.

- [ ] **Step 1: Escribir el test que falla**

```js
// src/services/GastoService.saldo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const GastoService = require('./GastoService');
const TerceroRepository = require('../repositories/TerceroRepository');

function crearTerceroDePrueba(dbService) {
  const repo = new TerceroRepository(dbService);
  return repo.create({
    tipoIdentificacion: 'Cédula de Ciudadanía', numeroIdentificacion: '123456', nombreRazonSocial: 'Proveedor de prueba',
    esProveedor: true
  });
}

test('create() rechaza un gasto en efectivo mayor al saldo disponible de Caja General', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    // Caja General arranca en 0 (sin saldo inicial configurado ni movimientos previos):
    // cualquier gasto en efectivo mayor a 0 debe rechazarse.
    assert.throws(
      () => service.create({
        fechaGasto: '2026-07-03', concepto: 'Gasto sin saldo', tipoGasto: 'Gastos Diversos',
        valor: 50000, metodoPago: 'Efectivo', terceroId
      }, null),
      /saldo insuficiente/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() permite un gasto en efectivo cuando SÍ hay saldo suficiente', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`UPDATE configuracion SET valor = '100000' WHERE clave = 'saldo_caja_inicial'`).run();

    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    const gastoId = service.create({
      fechaGasto: '2026-07-03', concepto: 'Gasto con saldo', tipoGasto: 'Gastos Diversos',
      valor: 50000, metodoPago: 'Efectivo', terceroId
    }, null);

    assert.ok(gastoId > 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() NO valida saldo para gastos por Transferencia (no salen de una caja de efectivo)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    const gastoId = service.create({
      fechaGasto: '2026-07-03', concepto: 'Gasto por transferencia', tipoGasto: 'Gastos Diversos',
      valor: 500000, metodoPago: 'Transferencia', terceroId
    }, null);

    assert.ok(gastoId > 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL en el primer test — hoy `create()` no valida saldo, así que el gasto de $50.000 sin saldo se crea sin lanzar.

- [ ] **Step 3: Implementar el fix en el backend**

En `src/services/GastoService.js`:

1. Añadir el `require` al principio del archivo:
```js
const AsientoContableService = require('./AsientoContableService');
```
(Ya está importado en la línea 2 del archivo actual — no duplicar el require si ya existe; solo confirmar que sigue ahí.)

2. Modificar el bloque de resolución de `cajaEfectivoId` (líneas actuales 55-67):
```js
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

      // Un gasto en efectivo no puede dejar la caja física en negativo: eso sería un faltante
      // de efectivo que el sistema debe advertir en el momento de la captura, no descubrirse
      // después en un arqueo. Compara contra el saldo contable de esa subcuenta específica
      // (Caja General o Caja Menor según corresponda), con el mismo método que ya usa
      // CajaMenorService.getEstado() para calcular el monto de reembolso — hallazgo Alto A-7
      // de la auditoría de Contabilidad (2026-07-03).
      const saldoDisponible = this.asientoContableService.getLibroMayor(cajaEfectivoId).saldoFinal;
      if (gastoData.valor > saldoDisponible) {
        throw new Error(
          `Saldo insuficiente en ${usarCajaMenor ? 'Caja Menor' : 'Caja General'}: disponible $${saldoDisponible.toLocaleString('es-CO')}, ` +
          `se requieren $${Number(gastoData.valor).toLocaleString('es-CO')}.`
        );
      }
    }
    gastoData.cajaEfectivoId = cajaEfectivoId;
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: `# pass 17`, `# fail 0`.

- [ ] **Step 5: Reflejar el saldo disponible en el frontend**

En `src/renderer/js/gastos.js`, dentro de `actualizarVisibilidadCajaEfectivo` (líneas actuales 492-497), añadir la consulta de saldo y mostrarla junto al selector:

```js
    const actualizarVisibilidadCajaEfectivo = async () => {
      const esEfectivo = document.getElementById('metodo_pago').value === 'Efectivo';
      const grupo = document.getElementById('cajaEfectivoGroup');
      grupo.style.display = (esEfectivo && cajaMenorActiva) ? 'block' : 'none';
      if (esEfectivo && cajaMenorActiva) {
        await actualizarAvisoSaldoCaja();
      }
    };

    const actualizarAvisoSaldoCaja = async () => {
      const avisoId = 'avisoSaldoCajaEfectivo';
      let aviso = document.getElementById(avisoId);
      const cajaSeleccionada = document.getElementById('caja_efectivo').value;

      // Solo mostramos el aviso para Caja Menor: es la única subcuenta de efectivo para la que
      // hoy existe una consulta de saldo específica y precisa (cajaMenor.getEstado()). Para
      // "Caja General" no hay un canal que devuelva SOLO su saldo (caja:getSaldos devuelve el
      // total combinado del libro simple, que también incluiría lo que hay en Caja Menor) —
      // mostrar ese número bajo la etiqueta "Caja General" sería tan engañoso como el defecto
      // que este aviso corrige, así que se prefiere no mostrar nada antes que mostrar un dato
      // que no corresponde exactamente a la caja seleccionada.
      if (cajaSeleccionada !== 'Menor') {
        if (aviso) aviso.remove();
        return;
      }

      if (!aviso) {
        aviso = document.createElement('p');
        aviso.id = avisoId;
        aviso.style.cssText = 'font-size: 0.8rem; color: #64748b; margin-top: 4px;';
        document.getElementById('cajaEfectivoGroup').appendChild(aviso);
      }
      const response = await window.api.cajaMenor.getEstado();
      if (response.success) {
        aviso.textContent = `Saldo actual en Caja Menor: $${this.formatNumber(response.data.saldoActual)}`;
      }
    };
    document.getElementById('caja_efectivo').addEventListener('change', actualizarAvisoSaldoCaja);
    document.getElementById('metodo_pago').addEventListener('change', actualizarVisibilidadCajaEfectivo);
    actualizarVisibilidadCajaEfectivo();
```

(Reemplaza el bloque original de líneas 492-497, que solo tenía la función sin el aviso de saldo. `Gastos.formatNumber` ya existe en `gastos.js:946` y se usa así en el resto del archivo — por eso `this.formatNumber(...)` funciona sin más cambios. Nota: esta pieza del frontend es un aviso informativo, no una validación — la validación real y vinculante vive en el backend del Step 3.)

- [ ] **Step 6: Verificación manual en la app**

Run: `npm start`, activar Caja Menor en Configuración con un saldo objetivo pequeño (p.ej. $50.000), ir a Gastos → Nuevo Gasto, método Efectivo, caja Menor, intentar registrar un gasto mayor al saldo disponible → debe rechazarse con el mensaje de saldo insuficiente. Registrar uno menor → debe funcionar igual que antes.

- [ ] **Step 7: Commit**

```bash
git add src/services/GastoService.js src/renderer/js/gastos.js src/services/GastoService.saldo.test.js
git commit -m "fix(alto): validar saldo suficiente antes de registrar un gasto en efectivo"
```

---

## Task 9: [Alto A-1] Copiar impuestos asignados al versionar una plantilla

**Files:**
- Modify: `src/repositories/ImpuestoRepository.js`
- Modify: `src/services/PlantillaContabilizacionService.js`
- Test: `src/services/PlantillaContabilizacionService.impuestos.test.js`

**Interfaces:**
- Produces: `ImpuestoRepository.copiarAsignaciones(plantillaIdOrigen, plantillaIdDestino): void`.

- [ ] **Step 1: Escribir el test que falla**

```js
// src/services/PlantillaContabilizacionService.impuestos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const PlantillaContabilizacionService = require('./PlantillaContabilizacionService');
const ImpuestoRepository = require('../repositories/ImpuestoRepository');

test('actualizarLineas() conserva los impuestos ya asignados en la nueva versión de la plantilla', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new PlantillaContabilizacionService(ctx.dbService);
    const impuestoRepository = new ImpuestoRepository(ctx.dbService);

    const cuentaImpuesto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '2408'`).get()
      || db.prepare(`SELECT id FROM plan_cuentas WHERE nivel = (SELECT MAX(nivel) FROM plan_cuentas WHERE tipo = 'Pasivo')`).get();
    const impuestoId = impuestoRepository.create({
      codigo: 'IVA_PRUEBA', nombre: 'IVA de prueba', tipo: 'IVA', porcentaje: 19,
      cuentaId: cuentaImpuesto.id, ladoAjuste: 'Debito', baseCampo: 'valor'
    });

    const plantillaOriginal = db.prepare(`SELECT id FROM plantillas_contabilizacion WHERE codigo = 'GASTO_EFECTIVO' ORDER BY version DESC LIMIT 1`).get();
    impuestoRepository.asignarAPlantilla(plantillaOriginal.id, impuestoId, 100);

    assert.equal(impuestoRepository.findByPlantillaId(plantillaOriginal.id).length, 1, 'Precondición: el impuesto debe estar asignado a la versión original');

    const actual = service.getById(plantillaOriginal.id);
    const nuevaVersion = service.actualizarLineas(plantillaOriginal.id, actual.lineas.map(l => ({ ...l, descripcion_linea: 'editada' })));

    const impuestosEnNuevaVersion = impuestoRepository.findByPlantillaId(nuevaVersion.id);
    assert.equal(impuestosEnNuevaVersion.length, 1, 'El impuesto debía copiarse a la nueva versión');
    assert.equal(impuestosEnNuevaVersion[0].id, impuestoId);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL — `impuestosEnNuevaVersion.length` es `0`: hoy `actualizarLineas()` no copia `plantilla_impuestos`.

- [ ] **Step 3: Añadir el método al repositorio**

En `src/repositories/ImpuestoRepository.js`, añadir después de `quitarDePlantilla` (antes de `getPlantillasAsignadas`):

```js
  // Copia todas las asignaciones de impuestos de una plantilla a otra, preservando el orden.
  // Se usa al versionar una plantilla (PlantillaContabilizacionService.actualizarLineas): la
  // versión nueva tiene un id distinto, así que sin esto pierde en silencio todos los impuestos
  // que tuviera configurados la versión anterior — hallazgo Alto A-1 de la auditoría de
  // Contabilidad (2026-07-03).
  copiarAsignaciones(plantillaIdOrigen, plantillaIdDestino) {
    const asignaciones = this.db.prepare(`
      SELECT impuesto_id, orden FROM plantilla_impuestos WHERE plantilla_id = ?
    `).all(plantillaIdOrigen);
    for (const a of asignaciones) {
      this.asignarAPlantilla(plantillaIdDestino, a.impuesto_id, a.orden);
    }
  }
```

- [ ] **Step 4: Usar el método al versionar**

En `src/services/PlantillaContabilizacionService.js`:

1. Añadir el `require` al principio del archivo:
```js
const ImpuestoRepository = require('../repositories/ImpuestoRepository');
```

2. Modificar el constructor (líneas actuales 6-10):
```js
class PlantillaContabilizacionService {
  constructor(dbService) {
    this.repository = new PlantillaContabilizacionRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
    this.impuestoRepository = new ImpuestoRepository(dbService);
    this.motor = new MotorContabilizacionService(dbService);
  }
```

3. En `actualizarLineas`, añadir la copia justo después de `reemplazarLineas` (línea actual 60, dentro de la transacción):
```js
      this.repository.reemplazarLineas(nuevoId, nuevasLineas);
      this.impuestoRepository.copiarAsignaciones(id, nuevoId);

      return this.repository.findById(nuevoId);
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: `# pass 18`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/ImpuestoRepository.js src/services/PlantillaContabilizacionService.js src/services/PlantillaContabilizacionService.impuestos.test.js
git commit -m "fix(alto): copiar impuestos asignados al crear una nueva version de plantilla"
```

---

## Task 10: [Alto A-2] Vigencia temporal de las tasas de impuestos

> **Corrección post-revisión (2026-07-03):** el reviewer reprodujo empíricamente que dos ediciones de la misma tasa en el mismo día calendario escriben una fila de historial con `fecha_desde > fecha_hasta` (invertida): la primera edición cierra el tramo anterior con `fecha_hasta = ayer`, pero la segunda edición ese mismo día lee `fecha_vigencia_desde = hoy` (ya actualizado por la primera) y sigue calculando `fecha_hasta = ayer`, que ahora es ANTERIOR a `fecha_desde = hoy`. No afecta el cálculo de impuestos en documentos reales (la resolución es por día, y "hoy" siempre resuelve contra la fila actual, no contra el historial), pero corrompe en silencio la fila de auditoría del tramo intermedio — justo lo que esta tabla existe para evitar. Se corrige el Step 4 acotando `fecha_hasta` a nunca ser anterior a `fecha_desde`.

**Files:**
- Create: `src/database/migrations/032_vigencia_impuestos.sql`
- Modify: `src/repositories/ImpuestoRepository.js`
- Modify: `src/services/MotorContabilizacionService.js`
- Test: `src/repositories/ImpuestoRepository.vigencia.test.js`
- Test: `src/services/MotorContabilizacionService.impuestos.test.js`

**Interfaces:**
- Produces: `ImpuestoRepository.getPorcentajeVigente(impuestoId, fechaISO): number`.
- Modifica `MotorContabilizacionService._aplicarImpuestos` para resolver el porcentaje según la fecha del documento, no el porcentaje actual.

**Diseño:** en vez de versionar `impuestos` con filas nuevas (como las plantillas, lo que exigiría relajar el `UNIQUE(codigo)` actual y recrear la tabla), se añade una columna aditiva `fecha_vigencia_desde` y una tabla de historial append-only `impuesto_historial_porcentaje` que registra cada cambio de tarifa con su rango de vigencia anterior. Es un cambio de esquema más simple y seguro (solo `ALTER TABLE ADD COLUMN` + `CREATE TABLE`, sin tocar la tabla existente) para una funcionalidad que hoy no tiene ningún dato real en producción.

- [ ] **Step 1: Escribir el test del repositorio que falla**

```js
// src/repositories/ImpuestoRepository.vigencia.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ImpuestoRepository = require('./ImpuestoRepository');

function crearImpuestoDePrueba(dbService, repo) {
  const db = dbService.getDb();
  const cuenta = db.prepare(`SELECT id FROM plan_cuentas WHERE tipo = 'Pasivo' AND NOT EXISTS (SELECT 1 FROM plan_cuentas h WHERE h.padre_id = plan_cuentas.id) LIMIT 1`).get();
  return repo.create({ codigo: 'RETE_PRUEBA', nombre: 'Retención de prueba', tipo: 'ReteFuente', porcentaje: 2.5, cuentaId: cuenta.id, ladoAjuste: 'Credito', baseCampo: 'valor' });
}

test('update() cambia el porcentaje vigente hacia adelante sin alterar la tasa histórica', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new ImpuestoRepository(ctx.dbService);
    const id = crearImpuestoDePrueba(ctx.dbService, repo);

    const hoy = new Date().toLocaleDateString('en-CA');
    assert.equal(repo.getPorcentajeVigente(id, hoy), 2.5, 'Antes de editar, la tasa vigente hoy debe ser la original');

    repo.update(id, { nombre: 'Retención de prueba', tipo: 'ReteFuente', porcentaje: 3.5, cuentaId: repo.findById(id).cuenta_id, ladoAjuste: 'Credito', baseCampo: 'valor' });

    assert.equal(repo.getPorcentajeVigente(id, hoy), 3.5, 'Hoy debe regir la tasa nueva');
    assert.equal(repo.getPorcentajeVigente(id, '2020-01-01'), 2.5, 'Una fecha pasada debe seguir usando la tasa que regía entonces');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL — `repo.getPorcentajeVigente is not a function`.

- [ ] **Step 3: Escribir la migración**

```sql
-- src/database/migrations/032_vigencia_impuestos.sql
--
-- Corrige el hallazgo Alto A-2 de la auditoría de Contabilidad (2026-07-03): la tabla
-- `impuestos` guardaba un único `porcentaje` mutable, así que editar una tasa afectaba también
-- la re-contabilización de documentos con fecha anterior al cambio. Se añade `fecha_vigencia_desde`
-- (aditivo, sin tocar la tabla existente) y una tabla de historial append-only con cada tramo de
-- vigencia anterior, para poder reconstruir qué tasa regía en cualquier fecha pasada.
ALTER TABLE impuestos ADD COLUMN fecha_vigencia_desde DATE NOT NULL DEFAULT '2000-01-01';

CREATE TABLE impuesto_historial_porcentaje (
  id             INTEGER  PRIMARY KEY AUTOINCREMENT,
  impuesto_id    INTEGER  NOT NULL REFERENCES impuestos(id),
  porcentaje     REAL     NOT NULL,
  fecha_desde    DATE     NOT NULL,
  fecha_hasta    DATE     NOT NULL,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_impuesto_historial_vigencia ON impuesto_historial_porcentaje(impuesto_id, fecha_desde, fecha_hasta);
```

- [ ] **Step 4: Implementar el fix en el repositorio**

En `src/repositories/ImpuestoRepository.js`, reemplazar el método `update` (líneas actuales 47-54):

```js
  update(id, { nombre, tipo, porcentaje, cuentaId, ladoAjuste, baseCampo }) {
    const actual = this.db.prepare('SELECT porcentaje, fecha_vigencia_desde FROM impuestos WHERE id = ?').get(id);
    if (!actual) throw new Error('Impuesto no encontrado');

    // Si la tarifa cambia, se cierra el tramo de vigencia anterior en el historial ANTES de
    // sobreescribir impuestos.porcentaje, para poder reconstruir qué tasa regía en fechas
    // pasadas sin alterar el resultado de asientos ya generados con la tasa anterior.
    if (Number(actual.porcentaje) !== Number(porcentaje)) {
      const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
      const hoy = new Date().toLocaleDateString('en-CA');

      // fecha_hasta nunca puede ser anterior a fecha_desde (actual.fecha_vigencia_desde). Si la
      // tasa ya se había editado hoy mismo (fecha_vigencia_desde == hoy), "ayer" quedaría antes
      // que su propia fecha_desde e invertiría el rango, corrompiendo la fila de historial de
      // ese tramo intermedio de menos de un día. En ese caso se cierra el mismo día que empezó
      // (un tramo de duración cero pero con un rango válido) en vez de invertirlo.
      const fechaHastaHistorial = ayer > actual.fecha_vigencia_desde ? ayer : actual.fecha_vigencia_desde;

      this.db.prepare(`
        INSERT INTO impuesto_historial_porcentaje (impuesto_id, porcentaje, fecha_desde, fecha_hasta)
        VALUES (?, ?, ?, ?)
      `).run(id, actual.porcentaje, actual.fecha_vigencia_desde, fechaHastaHistorial);

      this.db.prepare(`
        UPDATE impuestos
        SET nombre = ?, tipo = ?, porcentaje = ?, cuenta_id = ?, lado_ajuste = ?,
            base_campo = ?, fecha_vigencia_desde = ?, fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nombre, tipo, porcentaje, cuentaId, ladoAjuste, baseCampo, hoy, id);
    } else {
      this.db.prepare(`
        UPDATE impuestos
        SET nombre = ?, tipo = ?, porcentaje = ?, cuenta_id = ?, lado_ajuste = ?,
            base_campo = ?, fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nombre, tipo, porcentaje, cuentaId, ladoAjuste, baseCampo, id);
    }
  }

  // Porcentaje que regía para este impuesto en una fecha dada. Si la fecha es igual o posterior
  // a la última vigencia registrada, se usa la tarifa ACTUAL; si es anterior, se busca en el
  // historial de cambios. Si no hay ningún tramo histórico que cubra esa fecha (p. ej. el
  // impuesto se creó después), se usa la tarifa actual como mejor aproximación disponible.
  getPorcentajeVigente(impuestoId, fechaISO) {
    const actual = this.db.prepare('SELECT porcentaje, fecha_vigencia_desde FROM impuestos WHERE id = ?').get(impuestoId);
    if (!actual) return null;
    if (fechaISO >= actual.fecha_vigencia_desde) return actual.porcentaje;

    const historico = this.db.prepare(`
      SELECT porcentaje FROM impuesto_historial_porcentaje
      WHERE impuesto_id = ? AND fecha_desde <= ? AND fecha_hasta >= ?
      ORDER BY fecha_desde DESC LIMIT 1
    `).get(impuestoId, fechaISO, fechaISO);
    return historico ? historico.porcentaje : actual.porcentaje;
  }
```

- [ ] **Step 5: Ejecutar y verificar que pasa el test del repositorio**

Run: `npm test`
Expected: `# pass 19`, `# fail 0`.

- [ ] **Step 6: Escribir el test del motor que falla**

```js
// src/services/MotorContabilizacionService.impuestos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const MotorContabilizacionService = require('./MotorContabilizacionService');
const ImpuestoRepository = require('../repositories/ImpuestoRepository');
const PlantillaContabilizacionRepository = require('../repositories/PlantillaContabilizacionRepository');

test('generarLineas() aplica la tasa de impuesto vigente en la fecha del documento, no la actual', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const impuestoRepository = new ImpuestoRepository(ctx.dbService);
    const plantillaRepository = new PlantillaContabilizacionRepository(ctx.dbService);
    const motor = new MotorContabilizacionService(ctx.dbService);

    const cuentaImpuesto = db.prepare(`SELECT id FROM plan_cuentas WHERE tipo = 'Pasivo' AND NOT EXISTS (SELECT 1 FROM plan_cuentas h WHERE h.padre_id = plan_cuentas.id) LIMIT 1`).get();
    const impuestoId = impuestoRepository.create({ codigo: 'RETE_MOTOR', nombre: 'Retención motor', tipo: 'ReteFuente', porcentaje: 2, cuentaId: cuentaImpuesto.id, ladoAjuste: 'Credito', baseCampo: 'valor' });

    const plantillaGastoEfectivo = plantillaRepository.findVigente('Gasto', 'Efectivo', new Date().toLocaleDateString('en-CA'));
    impuestoRepository.asignarAPlantilla(plantillaGastoEfectivo.id, impuestoId, 100);

    // Sube la tasa al 5% HOY.
    impuestoRepository.update(impuestoId, { nombre: 'Retención motor', tipo: 'ReteFuente', porcentaje: 5, cuentaId: cuentaImpuesto.id, ladoAjuste: 'Credito', baseCampo: 'valor' });

    const cuentaGasto = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '519599'`).get();

    // Documento con fecha de AYER (antes del cambio de tasa): debe usar el 2%, no el 5% actual.
    const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
    const lineasAyer = motor.generarLineas(plantillaGastoEfectivo, {
      fecha: ayer, valor: 100000, cuenta_contable_id: cuentaGasto.id, caja_efectivo_id: cuentaGasto.id
    });
    const lineaImpuestoAyer = lineasAyer.find(l => l.cuentaContableId === cuentaImpuesto.id);
    assert.equal(lineaImpuestoAyer.credito, 2000, 'Con fecha de ayer debía aplicarse el 2% (200.000 * 0.02 = 2.000... con base 100.000 = 2.000)');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 7: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL — `lineaImpuestoAyer.credito` es `5000` (5% actual), no `2000` (2% vigente ayer): el motor todavía usa `imp.porcentaje` directo.

- [ ] **Step 8: Implementar el fix en el motor**

En `src/services/MotorContabilizacionService.js`, reemplazar el método `_aplicarImpuestos` (líneas actuales 213-229):

```js
  _aplicarImpuestos(lineas, impuestos, contexto) {
    for (const imp of impuestos) {
      const base = Number(contexto[imp.base_campo] || 0);
      // Usa la tasa vigente en la FECHA DEL DOCUMENTO, no la tasa actual del impuesto: así, un
      // documento retroactivo o una re-contabilización de un documento antiguo no cambian de
      // resultado si la tarifa se actualizó después — hallazgo Alto A-2 de la auditoría de
      // Contabilidad (2026-07-03).
      const porcentajeVigente = this.impuestoRepository.getPorcentajeVigente(imp.id, contexto.fecha);
      const montoImp = Math.round(base * porcentajeVigente / 100);
      if (montoImp === 0) continue;

      if (imp.lado_ajuste === 'Debito') {
        const lineaBase = lineas.find(l => (l.debito  || 0) > 0 && l.cuentaContableId !== imp.cuenta_id);
        if (lineaBase) lineaBase.debito  -= montoImp;
        lineas.push({ cuentaContableId: imp.cuenta_id, debito:  montoImp });
      } else {
        const lineaBase = lineas.find(l => (l.credito || 0) > 0 && l.cuentaContableId !== imp.cuenta_id);
        if (lineaBase) lineaBase.credito -= montoImp;
        lineas.push({ cuentaContableId: imp.cuenta_id, credito: montoImp });
      }
    }
  }
```

- [ ] **Step 9: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: `# pass 20`, `# fail 0`.

- [ ] **Step 10: Commit**

```bash
git add src/database/migrations/032_vigencia_impuestos.sql src/repositories/ImpuestoRepository.js src/services/MotorContabilizacionService.js src/repositories/ImpuestoRepository.vigencia.test.js src/services/MotorContabilizacionService.impuestos.test.js
git commit -m "fix(alto): aplicar la tasa de impuesto vigente en la fecha del documento, no la actual"
```

---

## Task 11: [Alto A-3] Bloquear contabilización retroactiva más allá de un límite configurable

**Files:**
- Create: `src/database/migrations/033_periodo_bloqueo_anterior.sql`
- Modify: `src/services/ConfiguracionService.js`
- Modify: `src/services/PeriodoContableService.js`
- Test: `src/services/PeriodoContableService.bloqueo.test.js`

**Interfaces:**
- Produces: nueva clave de configuración `periodo_bloqueo_anterior_a` (fecha `YYYY-MM-DD` o cadena vacía = sin restricción).
- Modifica `PeriodoContableService.validarFechaPermitida(fechaISO)`: ahora también rechaza fechas anteriores a esa clave, exista o no ya un período para ese mes.

- [ ] **Step 1: Escribir el test que falla**

```js
// src/services/PeriodoContableService.bloqueo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');

test('validarFechaPermitida() rechaza una fecha anterior al límite configurado, aunque nunca haya existido un período para ese mes', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`UPDATE configuracion SET valor = '2024-01-01' WHERE clave = 'periodo_bloqueo_anterior_a'`).run();

    const service = new PeriodoContableService(new PeriodoContableRepository(ctx.dbService));

    // 2020-03 nunca tuvo actividad: sin el fix, se auto-crearía como Abierto y se permitiría.
    assert.throws(() => service.validarFechaPermitida('2020-03-15'), /bloqueado|no se permite contabilizar/i);

    const periodoCreado = db.prepare(`SELECT * FROM periodos_contables WHERE anio = 2020 AND mes = 3`).get();
    assert.equal(periodoCreado, undefined, 'No debe crearse un período para una fecha rechazada por el límite');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('validarFechaPermitida() sigue permitiendo fechas posteriores al límite, creando el período si hace falta', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`UPDATE configuracion SET valor = '2024-01-01' WHERE clave = 'periodo_bloqueo_anterior_a'`).run();

    const service = new PeriodoContableService(new PeriodoContableRepository(ctx.dbService));
    const periodo = service.validarFechaPermitida('2026-07-03');
    assert.equal(periodo.estado, 'Abierto');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('validarFechaPermitida() no restringe nada si periodo_bloqueo_anterior_a está vacío (comportamiento por defecto, compatible con lo actual)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new PeriodoContableService(new PeriodoContableRepository(ctx.dbService));
    const periodo = service.validarFechaPermitida('2018-01-01');
    assert.equal(periodo.estado, 'Abierto');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL con `SqliteError: no such column: periodo_bloqueo_anterior_a` o similar (la clave de configuración todavía no existe) en el primer `UPDATE configuracion`.

- [ ] **Step 3: Escribir la migración**

```sql
-- src/database/migrations/033_periodo_bloqueo_anterior.sql
--
-- Corrige el hallazgo Alto A-3 de la auditoría de Contabilidad (2026-07-03): un mes sin ninguna
-- actividad previa se auto-creaba como período 'Abierto' la primera vez que se le intentaba
-- contabilizar algo, sin importar qué tan retroactiva fuera la fecha — el control de "período
-- cerrado" solo protegía meses que ya habían sido tocados y cerrados explícitamente. Esta clave,
-- vacía por defecto (sin restricción, igual que el comportamiento actual), permite a un
-- Administrador fijar una fecha límite: nada anterior a ella podrá contabilizarse jamás, exista
-- o no ya un período para ese mes.
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('periodo_bloqueo_anterior_a', '', 'Fecha (AAAA-MM-DD) antes de la cual no se permite registrar ni corregir ningún movimiento contable. Vacío = sin restricción.');
```

- [ ] **Step 4: Habilitar la clave en Configuración**

En `src/services/ConfiguracionService.js`, añadir `'periodo_bloqueo_anterior_a'` a `CLAVES_EDITABLES` (línea actual 5-9):

```js
const CLAVES_EDITABLES = [
  'nombre_asociacion', 'nit', 'direccion', 'ciudad', 'telefono', 'email',
  'consecutivo_recibos', 'valor_nuevo_punto', 'saldo_caja_inicial', 'saldo_banco_inicial',
  'respaldo_nube_dias_retencion', 'caja_menor_activa', 'caja_menor_saldo_objetivo',
  'periodo_bloqueo_anterior_a'
];
```

Y añadir su validación de formato dentro de `actualizar()` (después del bloque de `consecutivo_recibos`, línea actual 47, antes del `for`):

```js
    if (datos.periodo_bloqueo_anterior_a !== undefined && datos.periodo_bloqueo_anterior_a !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.periodo_bloqueo_anterior_a)) {
        throw new Error('La fecha límite de bloqueo debe tener el formato AAAA-MM-DD, o quedar vacía para no restringir');
      }
    }
```

- [ ] **Step 5: Implementar el fix en PeriodoContableService**

En `src/services/PeriodoContableService.js`:

1. Añadir el `require` al principio del archivo:
```js
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');
```

2. Modificar el constructor (línea actual 2-4) para aceptar el `dbService` (necesario para leer configuración; hoy el constructor solo recibe el repositorio ya construido):
```js
class PeriodoContableService {
  constructor(periodoContableRepository, dbService) {
    this.repository = periodoContableRepository;
    this.configuracionRepository = dbService ? new ConfiguracionRepository(dbService) : null;
  }
```

3. Modificar `validarFechaPermitida` (líneas actuales 21-45):
```js
  // Valida que la fecha ISO (YYYY-MM-DD) pertenece a un período Abierto y que no cae antes del
  // límite de bloqueo configurado (si hay uno). Crea el período automáticamente si no existe
  // (la primera operación del mes lo abre). Lanza un error descriptivo si el período está
  // Cerrado, Bloqueado, o la fecha cae antes del límite configurado.
  validarFechaPermitida(fechaISO) {
    if (!fechaISO) throw new Error('La fecha del movimiento es requerida.');

    if (this.configuracionRepository) {
      const limite = this.configuracionRepository.getAll().periodo_bloqueo_anterior_a;
      if (limite && fechaISO < limite) {
        throw new Error(
          `No se permite contabilizar en fechas anteriores a ${limite}: ese rango quedó bloqueado ` +
          `desde Configuración. Si necesita registrar un movimiento en esa fecha, un administrador ` +
          `debe ajustar el límite en Configuración → Períodos primero.`
        );
      }
    }

    const d = new Date(fechaISO + 'T00:00:00');
    const anio = d.getFullYear();
    const mes = d.getMonth() + 1;

    const periodo = this.repository.crearSiNoExiste(anio, mes);

    if (periodo.estado === 'Cerrado') {
      const nombreMes = this._nombreMes(mes);
      throw new Error(
        `El período ${nombreMes} ${anio} está Cerrado y no admite nuevos movimientos. ` +
        `Si necesita registrar un movimiento en ese período, un administrador debe reabrirlo primero.`
      );
    }
    if (periodo.estado === 'Bloqueado') {
      const nombreMes = this._nombreMes(mes);
      throw new Error(
        `El período ${nombreMes} ${anio} está Bloqueado definitivamente y no puede reabrirse.`
      );
    }

    return periodo;
  }
```

- [ ] **Step 6: Actualizar los 5 puntos donde se instancia `PeriodoContableService` para pasar `dbService`**

Confirmado por `grep -rn "new PeriodoContableService(" src/ main.js`: existen exactamente 5 instancias, todas con la forma `new PeriodoContableService(new PeriodoContableRepository(dbService))`, sin segundo argumento. Añadir `dbService` como segundo argumento en cada una:

- `src/services/AsientoContableService.js:35` → `this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService), dbService);`
- `src/services/CajaMenorService.js:15` → `this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService), dbService);`
- `src/services/GastoService.js:18` → `this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService), dbService);`
- `src/services/PagoService.js:61` → `this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService), dbService);`
- `main.js:239` → `periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService), dbService);`

No hay ninguna otra instancia (`ReciboService.js` y `NuevoPuntoService.js` no crean su propio `PeriodoContableService`; reutilizan la validación a través de `AsientoContableService`/`PagoService`).

**Nota de compatibilidad:** el segundo parámetro es opcional (`dbService ? ... : null`) precisamente para que, si algún test o código existente sigue instanciando sin él, el servicio siga funcionando exactamente como antes (sin restricción de bloqueo) en vez de fallar.

- [ ] **Step 7: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: `# pass 23`, `# fail 0`.

- [ ] **Step 8: Verificación manual en la app**

Run: `npm start`, ir a Configuración, confirmar que aparece el nuevo campo (si no hay un campo de UI dedicado en este primer paso, se puede probar directamente vía consola de DevTools: `await window.api.config.actualizar({ periodo_bloqueo_anterior_a: '2024-01-01' })`), luego intentar registrar un gasto con fecha `2020-01-01` → debe rechazarse con el mensaje de bloqueo.

- [ ] **Step 9: Commit**

```bash
git add src/database/migrations/033_periodo_bloqueo_anterior.sql src/services/ConfiguracionService.js src/services/PeriodoContableService.js src/services/AsientoContableService.js src/services/GastoService.js src/services/CajaMenorService.js src/services/PagoService.js main.js src/services/PeriodoContableService.bloqueo.test.js
git commit -m "fix(alto): permitir bloquear contabilizacion retroactiva mas alla de una fecha limite"
```

---

## Task 12: [Alto A-6] `app.requestSingleInstanceLock()`

**Files:**
- Modify: `main.js`

**Interfaces:** ninguna (cambio de arranque de proceso, no afecta servicios ni IPC).

Este task no tiene una prueba automatizada razonable con `node:test` (requiere lanzar dos procesos Electron reales con GUI y observar el evento `second-instance`), así que se verifica manualmente. Es deliberadamente el único task de este plan sin TDD, por esa limitación práctica, no por ser menos importante.

> **Corrección post-revisión:** la primera versión de este task (commit `06bef3c`) insertaba el guard
> `if (!app.requestSingleInstanceLock()) { app.quit(); }` sin un `else`, dejando el resto del archivo
> — incluyendo `app.whenReady().then(...)`, que abre la conexión SQLite, corre migraciones,
> registra los handlers IPC y crea la ventana — como alcanzable incondicionalmente. `app.quit()`
> es asíncrono/advisory: no detiene la ejecución del resto del script. En la práctica, la
> instancia perdedora igual llegaba a inicializar `DatabaseService`/correr migraciones
> concurrentemente con la instancia ganadora sobre el mismo `data/acueducto.db` — reproduciendo
> parcialmente la misma condición de carrera que este hallazgo (A-6) buscaba cerrar — y podía
> mostrar brevemente una ventana antes de cerrarse, contradiciendo el propio criterio de
> verificación manual del Step 2 ("sin abrir ventana"). El reviewer lo encontró leyendo el
> control de flujo real de `main.js`, no solo el diff. Se corrige seleccionando el resultado de
> `requestSingleInstanceLock()` en una constante y envolviendo TODO el bloque de inicialización
> (`app.whenReady().then(...)` y los tres `app.on(...)` que le siguen: `before-quit`,
> `window-all-closed`, `activate`) dentro de un `else`, siguiendo el patrón oficial documentado
> por Electron para esta API.

- [ ] **Step 1: Implementar el fix**

En `main.js`, inmediatamente después de la línea 1 (`const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');`) y antes del resto de los `require`, insertar:

```js
// Esta es una app de escritorio monousuario sobre un único archivo SQLite
// (data/acueducto.db). Sin este candado, abrir el ejecutable dos veces crea dos procesos
// completamente independientes -dos conexiones SQLite, dos sesiones de usuario- escribiendo
// sobre el mismo archivo; los consecutivos (número de asiento, número de recibo) se calculan
// como "leer el máximo actual, sumar uno" y podrían leerse el mismo valor desde ambos procesos
// casi al mismo tiempo -hallazgo Alto A-6 de la auditoría de Contabilidad (2026-07-03)-. Si ya
// hay una instancia corriendo, esta nueva se cierra de inmediato y le pide a la primera que
// traiga su ventana al frente, en vez de dejar ambas abiertas. app.quit() es asíncrono: por sí
// solo NO detiene la ejecución del resto de este archivo, así que todo el arranque real
// (app.whenReady + los listeners de before-quit/window-all-closed/activate) debe quedar dentro
// del "else" para que la instancia perdedora nunca llegue a abrir la base de datos ni una
// ventana.
const tieneCandadoUnico = app.requestSingleInstanceLock();
if (!tieneCandadoUnico) {
  app.quit();
}
```

Luego, envolver TODO el bloque que va desde `app.whenReady().then(() => { ... })` hasta el final del
`app.on('activate', ...)` (línea actual 221 a 322: `app.whenReady().then(...)`, `app.on('before-quit', ...)`,
`app.on('window-all-closed', ...)` y `app.on('activate', ...)` — las cuatro llamadas de nivel superior que
siguen inmediatamente a `createWindow()`, antes de `function setupIpcHandlers() {`) dentro de un
`else { ... }` que sigue directamente al `if` de arriba:

```js
} else {
  app.whenReady().then(() => {
    // ... (contenido existente sin cambios)
  });

  app.on('before-quit', async (event) => {
    // ... (contenido existente sin cambios)
  });

  app.on('window-all-closed', () => {
    // ... (contenido existente sin cambios)
  });

  app.on('activate', () => {
    // ... (contenido existente sin cambios)
  });
}
```

No es necesario reescribir el contenido interior de esos bloques — solo envolverlos, moviendo la
llave de cierre `}` de cada uno una unidad de indentación hacia adentro si se opta por reindentar
por legibilidad (opcional; lo único obligatorio es que el `else {` abra inmediatamente después del
`if` del guard y el `}` de cierre quede justo antes de `function setupIpcHandlers() {`).

Y, dentro de `app.whenReady().then(() => { ... })`, justo después de `createWindow();` (buscar esa
línea dentro del bloque — es la única llamada a `createWindow()` seguida por
`backupService.ejecutarSiCorresponde();`), añadir:

```js
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
```

- [ ] **Step 2: Verificación manual**

Run: `npm start` (deja la primera instancia abierta). En una segunda terminal, `npm start` de nuevo.
Expected: la segunda instancia se cierra sola casi de inmediato (sin abrir ventana), y la ventana de la primera instancia pasa al frente. Solo debe quedar UN proceso `electron.exe`/`Acueducto Admin` corriendo (verificar en el Administrador de Tareas de Windows).

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "fix(alto): evitar dos instancias simultaneas sobre la misma base de datos"
```

---

## Task 13: [Crítico C-2, parte 1/2] Idempotencia de operaciones financieras en main.js

**Files:**
- Modify: `main.js`
- Modify: `preload.js`

**Interfaces:**
- Produces: cada canal de `CANALES_IDEMPOTENTES` acepta opcionalmente `payload.opId` (string); si se repite, el segundo envío obtiene el mismo resultado sin re-ejecutar la operación.

**Nota sobre pruebas:** este task modifica el wrapper de IPC de Electron (`ipcMain.handle`), que solo se registra dentro de un proceso Electron real con `app.whenReady()` ya resuelto — no es practicable probarlo con `node:test` sin levantar toda la app. Se verifica con una prueba manual reproducible paso a paso (Step 3), que es exactamente el escenario que motivó el hallazgo.

- [ ] **Step 1: Implementar la deduplicación en `envolverHandle`**

En `main.js`, añadir estas constantes justo después de `const CANALES_SIN_SESION = new Set([...]);` (línea actual 116, antes de `function esCanalDeLectura`):

```js
// Canales que crean un documento financiero nuevo: doble clic o un reintento de red podían
// dispararlos dos veces, produciendo dos gastos/asientos/consignaciones/reembolsos idénticos
// (hallazgo Crítico C-2 de la auditoría de Contabilidad, 2026-07-03). El frontend envía un
// `opId` (uuid) generado al abrir el formulario, dentro del propio payload; ver Task 14 para el
// lado del renderer.
const CANALES_IDEMPOTENTES = new Set([
  'asientos:crearManual', 'gastos:create', 'caja:registrarConsignacion',
  'cajaMenor:reembolsar', 'pagos:registrarPagoSostenimiento'
]);

// opId -> Promise, mientras la operación sigue en curso (protege contra dos IPC casi
// simultáneos, el caso real de un doble clic).
const operacionesEnCurso = new Map();
// opId -> { resultado, expira }, solo para operaciones que YA terminaron con éxito. Un TTL
// corto es suficiente: solo hace falta cubrir la ventana de un doble clic o un reintento
// inmediato, no reintentos deliberados minutos después (que si fallaron por una validación de
// negocio, el usuario corrige el formulario y debe poder reenviar con normalidad).
const TTL_OPERACION_EXITOSA_MS = 30000;
const operacionesCompletadas = new Map();

function limpiarOperacionesCompletadasExpiradas() {
  const ahora = Date.now();
  for (const [opId, entry] of operacionesCompletadas) {
    if (entry.expira <= ahora) operacionesCompletadas.delete(opId);
  }
}
```

Luego, dentro de `function envolverHandle(canal, fn) { ipcMain.handle(canal, async (event, ...args) => { ... }) }`, reemplazar la línea `const resultado = await fn(event, ...args);` (línea actual 164) por:

```js
    let opId = null;
    if (CANALES_IDEMPOTENTES.has(canal) && args[0] && typeof args[0] === 'object' && args[0].opId) {
      opId = args[0].opId;
      delete args[0].opId; // no debe llegar a la capa de servicio

      limpiarOperacionesCompletadasExpiradas();

      const completada = operacionesCompletadas.get(opId);
      if (completada) return completada.resultado;

      const enCurso = operacionesEnCurso.get(opId);
      if (enCurso) return enCurso;
    }

    const promesaResultado = (async () => {
      const r = await fn(event, ...args);
      if (opId && r && r.success) {
        operacionesCompletadas.set(opId, { resultado: r, expira: Date.now() + TTL_OPERACION_EXITOSA_MS });
      }
      return r;
    })();

    if (opId) operacionesEnCurso.set(opId, promesaResultado);
    const resultado = await promesaResultado;
    if (opId) operacionesEnCurso.delete(opId);
```

(El resto del método —el bloque de auditoría y el `return resultado;` finales— queda exactamente igual, ahora usando este `resultado`.)

- [ ] **Step 2: Aceptar `opId` en preload.js**

En `preload.js`, los 5 canales ya reciben un único objeto `payload`/`datos`/`gastoData` que se reenvía tal cual con `ipcRenderer.invoke`, así que **no hace falta ningún cambio en `preload.js`**: `opId` viaja dentro de ese mismo objeto sin que el bridge necesite saberlo. (Se documenta este paso explícitamente para que quien ejecute el plan no se quede buscando un cambio que no existe.)

- [ ] **Step 3: Verificación manual del comportamiento de deduplicación**

Run: `npm start --dev`, iniciar sesión, abrir la consola de DevTools y ejecutar dos veces seguidas, con el mismo `opId`, una creación de gasto (usando un tercero real que ya exista en la BD de prueba):

```js
const opId = crypto.randomUUID();
const payload = { fechaGasto: '2026-07-03', concepto: 'Prueba idempotencia', tipoGasto: 'Gastos Diversos', valor: 1000, metodoPago: 'Transferencia', terceroId: 2, opId };
const r1 = await window.api.gastos.create(payload);
const r2 = await window.api.gastos.create({ ...payload, opId }); // mismo opId, "doble clic" simulado
console.log(r1, r2);
```

Expected: `r1.data.id === r2.data.id` (el mismo gasto, no dos). Confirmar además en la pantalla de Gastos que solo aparece **una** fila nueva, no dos.

Luego, sin `opId` (payload viejo, como cualquier pantalla que todavía no se haya actualizado en Task 14), confirmar que sigue funcionando exactamente igual que antes (crea normalmente, sin bloquear nada):
```js
const r3 = await window.api.gastos.create({ fechaGasto: '2026-07-03', concepto: 'Sin opId', tipoGasto: 'Gastos Diversos', valor: 1000, metodoPago: 'Transferencia', terceroId: 2 });
console.log(r3);
```
Expected: `r3.success === true`, un gasto nuevo y distinto.

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "fix(critico): agregar deduplicacion por opId en operaciones financieras de main.js"
```

---

## Task 14: [Crítico C-2, parte 2/2] Proteger los formularios financieros contra doble envío

**Files:**
- Modify: `src/renderer/js/app.js`
- Modify: `src/renderer/js/contabilidad.js`
- Modify: `src/renderer/js/gastos.js`
- Modify: `src/renderer/js/caja.js`

**Interfaces:**
- Produces: `App.protegerEnvioDoble(form, fn)` — helper reutilizable para cualquier formulario financiero futuro.
- Consumes: `crypto.randomUUID()` (API del navegador/Chromium, disponible en el renderer sin pasar por `preload.js`).

**Precondición:** Task 13 debe estar mergeado (el `opId` que este task genera y envía solo tiene efecto si el backend ya sabe deduplicarlo).

Este task es puramente de interfaz (deshabilitar un botón, generar un id) y no tiene lógica de negocio verificable con `node:test` (no hay DOM en el runner de Node). Se verifica manualmente, reproduciendo exactamente el escenario de doble clic que describe el hallazgo C-2.

- [ ] **Step 1: Añadir el helper reutilizable en app.js**

En `src/renderer/js/app.js`, añadir este método dentro del objeto `App` (junto a `openModal`/`closeModal`, por ejemplo justo después de `closeModal`):

```js
  // Evita que un formulario financiero se envíe dos veces (doble clic, doble Enter, o un
  // segundo clic mientras la primera petición IPC todavía no responde): deshabilita el botón de
  // submit apenas se dispara el evento, y lo restaura solo si el formulario sigue en pantalla al
  // terminar (si fn() cierra el modal con éxito, el botón ya no existe y no hay nada que
  // restaurar). fn recibe el evento con preventDefault() ya aplicado.
  //
  // Complementa —no sustituye— la deduplicación por opId del lado del servidor (ver main.js,
  // envolverHandle): esto es la primera línea de defensa (evita la petición duplicada por
  // completo), y el opId es la segunda (si igual llegaran dos peticiones, el servidor las
  // reduce a una sola). Hallazgo Crítico C-2 de la auditoría de Contabilidad (2026-07-03).
  protegerEnvioDoble(form, fn) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const boton = form.querySelector('button[type="submit"]');
      if (boton && boton.disabled) return; // ya hay un envío en curso
      const textoOriginal = boton ? boton.textContent : null;
      if (boton) boton.disabled = true;
      try {
        await fn(e);
      } finally {
        if (boton && document.body.contains(boton)) {
          boton.disabled = false;
          boton.textContent = textoOriginal;
        }
      }
    });
  },
```

- [ ] **Step 2: Aplicar el helper al asiento manual**

En `src/renderer/js/contabilidad.js`, reemplazar el bloque `document.getElementById('asientoManualForm').addEventListener('submit', async (e) => { ... });` completo (líneas actuales 1107-1137) por:

```js
    App.protegerEnvioDoble(document.getElementById('asientoManualForm'), async () => {
      const lineas = Array.from(document.querySelectorAll('#lineasAsientoBody tr')).map(fila => ({
        cuentaContableId: parseInt(fila.querySelector('.linea-cuenta').value, 10),
        debito: App.parseMoneyValue(fila.querySelector('.linea-debito').value),
        credito: App.parseMoneyValue(fila.querySelector('.linea-credito').value),
        terceroIdentificacion: fila.querySelector('.linea-tercero-id').value.trim() || null,
        terceroNombre: fila.querySelector('.linea-tercero-nombre').value.trim() || null
      }));

      try {
        const response = await window.api.asientos.crearManual({
          fecha: document.getElementById('am_fecha').value,
          tipoComprobante: document.getElementById('am_tipo_comprobante').value,
          concepto: document.getElementById('am_concepto').value.trim(),
          lineas,
          opId: crypto.randomUUID()
        });

        if (response.success) {
          App.closeModal();
          this.loadListaAsientos();
          App.toast('Asiento manual creado con éxito');
        } else {
          document.getElementById('formError').innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        document.getElementById('formError').innerHTML = '<div class="error-message">Error al guardar el asiento</div>';
      }
    });
```

- [ ] **Step 3: Aplicar el helper al formulario de Gasto**

En `src/renderer/js/gastos.js`:

1. Reemplazar el listener de submit (líneas actuales 516-519):
```js
    App.protegerEnvioDoble(document.getElementById('gastoForm'), () => this.saveGasto());
```

2. Modificar `saveGasto` (líneas actuales 522-553) para generar y enviar el `opId`:
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
      observaciones: document.getElementById('observaciones').value.trim(),
      opId: crypto.randomUUID()
    };

    try {
      const response = await window.api.gastos.create(formData);

      if (response.success) {
        App.closeModal();
        this.loadStats();
        this.loadGastos();
        App.toast('Gasto registrado con éxito');
      } else {
        const errorDiv = document.getElementById('formError');
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      const errorDiv = document.getElementById('formError');
      errorDiv.innerHTML = `<div class="error-message">Error al registrar el gasto</div>`;
    }
  },
```

- [ ] **Step 4: Aplicar el helper a Consignación y a Reembolso de Caja Menor**

En `src/renderer/js/caja.js`:

1. Reemplazar el listener de consignación (líneas actuales 371-..., hasta el cierre de ese `addEventListener`):
```js
    App.protegerEnvioDoble(document.getElementById('consignacionForm'), async () => {
      const monto = App.parseMoneyValue(document.getElementById('monto_consignacion').value);
      const fecha = document.getElementById('fecha_consignacion').value;
      const observaciones = document.getElementById('observaciones_consignacion').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.caja.registrarConsignacion({ monto, fecha, observaciones, opId: crypto.randomUUID() });

        if (response.success) {
          App.closeModal();
          this.loadSaldos();
          this.loadMovimientos();
          App.toast('Consignación registrada con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = '<div class="error-message">Error al registrar la consignación</div>';
      }
    });
```

2. Reemplazar el listener de reembolso (líneas actuales 204-225):
```js
    App.protegerEnvioDoble(document.getElementById('reembolsoCajaMenorForm'), async () => {
      const fecha = document.getElementById('fecha_reembolso').value;
      const observaciones = document.getElementById('observaciones_reembolso').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.cajaMenor.reembolsar({ fecha, observaciones, opId: crypto.randomUUID() });

        if (response.success) {
          App.closeModal();
          this.loadCajaMenor();
          App.toast('Reembolso de Caja Menor registrado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = '<div class="error-message">Error al registrar el reembolso</div>';
      }
    });
```

- [ ] **Step 5: Verificación manual — el escenario exacto del hallazgo**

Run: `npm start`, iniciar sesión. Para cada uno de los 4 formularios tocados (Nueva Nota Contable en Asientos, Nuevo Gasto, Registrar Consignación, Reembolsar Caja Menor):
1. Abrir el modal, llenar los datos válidos.
2. Hacer doble clic rápido (o clic + Enter) sobre el botón de submit.
3. Confirmar que el botón queda visualmente deshabilitado tras el primer clic (no se puede volver a pulsar).
4. Confirmar que solo se crea **un** registro (revisar el listado correspondiente después).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/js/app.js src/renderer/js/contabilidad.js src/renderer/js/gastos.js src/renderer/js/caja.js
git commit -m "fix(critico): proteger formularios financieros contra doble envio"
```

---

## Task 15: [Crítico C-2, complemento] Completar la protección contra doble envío: quinto formulario y `opId` estable por apertura

> **Añadido tras la revisión final de todo el branch.** El reviewer final encontró dos huecos reales
> en el cierre del hallazgo C-2:
>
> 1. Task 13 ya incluía `pagos:registrarPagoSostenimiento` en `CANALES_IDEMPOTENTES` (`main.js`),
>    pero Task 14 solo protegió 4 de los 5 formularios — el de Aporte de Sostenimiento
>    (`pagos.js`) quedó con un listener crudo y sin `opId`, así que un doble clic ahí sigue
>    creando dos pagos/recibos duplicados (una instancia real y reproducible del propio hallazgo
>    Crítico que este branch existe para cerrar).
> 2. En los 4 formularios que Task 14 sí protegió, el `opId` se genera DENTRO del envío (en el
>    momento del submit), no al ABRIR el formulario como dice el propio comentario de Task 13 en
>    `main.js` ("generado al abrir el formulario"). Como `protegerEnvioDoble` ya bloquea el
>    segundo clic deshabilitando el botón, solo llega a enviarse UNA petición por apertura de
>    formulario — así que el `opId` nunca se repite y la deduplicación del servidor (Task 13)
>    queda inerte. El escenario real que debía cubrir (la respuesta del primer envío se
>    pierde/tarda, el botón se reactiva, y el usuario reintenta manualmente) sigue generando un
>    documento duplicado, porque el reintento manual genera un `opId` nuevo en vez de reutilizar
>    el de la operación original.
>
> Este task corrige ambos huecos. No toca `main.js` (el canal ya estaba listo desde Task 13).

**Files:**
- Modify: `src/renderer/js/pagos.js`
- Modify: `src/renderer/js/contabilidad.js`
- Modify: `src/renderer/js/gastos.js`
- Modify: `src/renderer/js/caja.js`

**Precondición:** Tasks 13 y 14 ya mergeados.

Igual que Task 14, este task es de interfaz (generar y reutilizar un id, deshabilitar un botón)
y no tiene lógica de negocio verificable con `node:test` (no hay DOM en el runner de Node). Se
verifica manualmente, igual que en Task 14.

- [ ] **Step 1: `pagos.js` — proteger el formulario de Aporte de Sostenimiento**

Reemplazar `setupRegistrarPagoModal` completo (líneas actuales 569-582):

```js
  setupRegistrarPagoModal(cuentaId, conexionPendiente) {
    if (conexionPendiente) {
      App.attachMoneyInput(document.getElementById('abono_conexion'));
    }

    document.getElementById('btnSimular').addEventListener('click', async () => {
      await this.simularPago(cuentaId);
    });

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('sostenimientoForm'), () => this.registrarPago(cuentaId, conexionPendiente, opId));
  },
```

Modificar `registrarPago` (líneas actuales 617-647) para aceptar y enviar `opId`:

```js
  async registrarPago(cuentaId, conexionPendiente, opId) {
    const mesInicio = parseInt(document.getElementById('mes_inicio').value, 10);
    const anioInicio = parseInt(document.getElementById('anio_inicio').value, 10);
    const cantidadMeses = parseInt(document.getElementById('cantidad_meses').value, 10);
    const fechaPago = document.getElementById('fecha_pago_sost').value;
    const metodoPago = document.getElementById('metodo_pago_sost').value;
    const observaciones = document.getElementById('observaciones_sost').value.trim();
    const errorDiv = document.getElementById('formError');

    const abonoConexionInput = document.getElementById('abono_conexion');
    const abonoConexion = abonoConexionInput ? App.parseMoneyValue(abonoConexionInput.value) : 0;

    try {
      const response = await window.api.pagos.registrarPagoSostenimiento({
        cuentaId, anioInicio, mesInicio, cantidadMeses, fechaPago, metodoPago, observaciones,
        nuevoPuntoId: abonoConexion > 0 && conexionPendiente ? conexionPendiente.id : null,
        abonoConexion,
        opId
      });

      if (response.success) {
        App.closeModal();
        this.loadCuentas();
        App.toast(`Aporte registrado con éxito. Recibo No. ${response.data.numeroRecibo}`);
      } else {
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al registrar el aporte</div>`;
    }
  },
```

- [ ] **Step 2: `contabilidad.js` — `opId` estable en el Asiento Manual**

Reemplazar el bloque que empieza en `App.protegerEnvioDoble(document.getElementById('asientoManualForm')...` (líneas actuales 1108-1137) por:

```js
    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('asientoManualForm'), async () => {
      const lineas = Array.from(document.querySelectorAll('#lineasAsientoBody tr')).map(fila => ({
        cuentaContableId: parseInt(fila.querySelector('.linea-cuenta').value, 10),
        debito: App.parseMoneyValue(fila.querySelector('.linea-debito').value),
        credito: App.parseMoneyValue(fila.querySelector('.linea-credito').value),
        terceroIdentificacion: fila.querySelector('.linea-tercero-id').value.trim() || null,
        terceroNombre: fila.querySelector('.linea-tercero-nombre').value.trim() || null
      }));

      try {
        const response = await window.api.asientos.crearManual({
          fecha: document.getElementById('am_fecha').value,
          tipoComprobante: document.getElementById('am_tipo_comprobante').value,
          concepto: document.getElementById('am_concepto').value.trim(),
          lineas,
          opId
        });

        if (response.success) {
          App.closeModal();
          this.loadListaAsientos();
          App.toast('Asiento manual creado con éxito');
        } else {
          document.getElementById('formError').innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        document.getElementById('formError').innerHTML = '<div class="error-message">Error al guardar el asiento</div>';
      }
    });
```

- [ ] **Step 3: `gastos.js` — `opId` estable en el Gasto**

`saveGasto()` es un método separado de la función que abre el modal (`showFormModal`), así que el
`opId` se guarda como propiedad de instancia para que sobreviva entre ambas. Reemplazar la línea
`App.protegerEnvioDoble(document.getElementById('gastoForm'), () => this.saveGasto());` (línea
actual 550) por:

```js
    this.opIdActual = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('gastoForm'), () => this.saveGasto());
```

Y en `saveGasto` (líneas actuales 553-566), reemplazar `opId: crypto.randomUUID()` por
`opId: this.opIdActual`:

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
      observaciones: document.getElementById('observaciones').value.trim(),
      opId: this.opIdActual
    };

    try {
      const response = await window.api.gastos.create(formData);

      if (response.success) {
        App.closeModal();
        this.loadStats();
        this.loadGastos();
        App.toast('Gasto registrado con éxito');
      } else {
        const errorDiv = document.getElementById('formError');
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      const errorDiv = document.getElementById('formError');
      errorDiv.innerHTML = `<div class="error-message">Error al registrar el gasto</div>`;
    }
  },
```

- [ ] **Step 4: `caja.js` — `opId` estable en Consignación y en Reembolso de Caja Menor**

Para el reembolso (líneas actuales 202-223), insertar `const opId = crypto.randomUUID();` entre
`App.openModal(content);` y `App.protegerEnvioDoble(...)`, y usar `opId` en vez de
`crypto.randomUUID()` dentro del payload:

```js
    App.openModal(content);

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('reembolsoCajaMenorForm'), async () => {
      const fecha = document.getElementById('fecha_reembolso').value;
      const observaciones = document.getElementById('observaciones_reembolso').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.cajaMenor.reembolsar({ fecha, observaciones, opId });

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
```

Para la consignación (líneas actuales 366-390), el mismo patrón:

```js
    App.openModal(content);
    App.attachMoneyInput(document.getElementById('monto_consignacion'));

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('consignacionForm'), async () => {
      const monto = App.parseMoneyValue(document.getElementById('monto_consignacion').value);
      const fecha = document.getElementById('fecha_consignacion').value;
      const observaciones = document.getElementById('observaciones_consignacion').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.caja.registrarConsignacion({ monto, fecha, observaciones, opId });

        if (response.success) {
          App.closeModal();
          this.loadSaldos();
          this.loadMovimientos();
          App.toast('Consignación registrada con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar la consignación</div>`;
      }
    });
```

- [ ] **Step 5: Verificación manual**

Run: `npm start`, iniciar sesión. Repetir la prueba de doble clic del Task 14 (Step 5) en los 4
formularios ya protegidos (deben seguir comportándose igual) y AHORA TAMBIÉN en el formulario de
Aporte de Sostenimiento (Cuentas → una cuenta con conexión activa → Registrar Aporte): doble clic
rápido sobre "Registrar Aporte y Generar Recibo" debe crear **un solo** pago/recibo, con el botón
visualmente deshabilitado tras el primer clic.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/js/pagos.js src/renderer/js/contabilidad.js src/renderer/js/gastos.js src/renderer/js/caja.js
git commit -m "fix(critico): proteger el formulario de aportes y estabilizar opId por apertura de formulario"
```

---

## Task 16: [Alto A-9, complemento] Asiento de apertura para el saldo inicial configurado de Caja/Banco

> **Añadido tras la revisión final de todo el branch.** El reviewer final encontró que
> `verificarConciliacionCajaBanco()` (Task 6) compara el saldo del libro simple —que SÍ incluye
> `saldo_caja_inicial`/`saldo_banco_inicial` de Configuración, ver `CajaRepository.getSaldo()`—
> contra el saldo en partida doble, que no tiene ningún asiento que registre ese saldo inicial.
> Cualquier organización con un saldo inicial distinto de cero vería `conciliado: false`
> permanentemente, con una `diferencia` igual al saldo inicial configurado: un falso positivo
> constante que resta confianza al diagnóstico de A-9. El usuario decidió resolverlo sembrando un
> asiento de apertura real en la doble partida (Debita Caja/Banco, Acredita `3105` "Capital o
> Patrimonio Inicial") cada vez que se configura o cambia el saldo inicial, en vez de excluir ese
> saldo de la comparación o solo documentar la limitación.

**Files:**
- Modify: `src/services/AsientoContableService.js`
- Modify: `src/services/ConfiguracionService.js`
- Modify: `main.js`
- Test: `src/services/ConfiguracionService.aperturaSaldoInicial.test.js`

**Interfaces:**
- Produces: `AsientoContableService.sincronizarAperturaSaldoInicial(claveCuentaAutomatica, monto, usuarioId)` — crea/reemplaza el asiento de apertura de `'CAJA'` o `'BANCO'`.
- Modifica: `ConfiguracionService` constructor ahora acepta un segundo parámetro opcional `asientoContableService` (mismo patrón ya usado por `PeriodoContableService` en Task 11: si se omite, el comportamiento es exactamente el de antes de este task, sin sincronizar ningún asiento).
- Modifica: `ConfiguracionService.actualizar(datos, usuarioId)` ahora acepta un segundo parámetro opcional `usuarioId`.

**Contexto de diseño (para quien implemente):** `CajaRepository.getSaldo()` sigue calculando el
saldo simple exactamente igual que antes de este task (config + movimientos de la tabla
`movimientos`) — no se toca. Lo que se agrega es la contrapartida en la doble partida.
El asiento de apertura se crea con `sincronizarLedgerSimple: false` a propósito: si sincronizara,
`sincronizarLineaConCajaBanco` insertaría una fila en `movimientos` con el mismo monto, y como
`CajaRepository.getSaldo()` YA suma `saldo_caja_inicial`/`saldo_banco_inicial` directamente desde
`configuracion`, el saldo simple quedaría contado DOS VECES. Por la misma razón, la reversión de
este asiento (cuando el saldo inicial configurado cambia) tampoco debe sincronizarse con el libro
simple — igual que ya ocurre con el Reembolso de Caja Menor (ver el comentario existente en
`revertir()`), así que este task generaliza esa excepción en vez de duplicarla.

- [ ] **Step 1: Escribir el test que falla**

```js
// src/services/ConfiguracionService.aperturaSaldoInicial.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ConfiguracionService = require('./ConfiguracionService');
const AsientoContableService = require('./AsientoContableService');

test('actualizar() siembra un asiento de apertura cuando se configura un saldo inicial de Caja distinto de cero', () => {
  const ctx = crearDbTemporal();
  try {
    const asientoContableService = new AsientoContableService(ctx.dbService);
    const service = new ConfiguracionService(ctx.dbService, asientoContableService);

    service.actualizar({ saldo_caja_inicial: 500000 }, 1);

    const conciliacion = asientoContableService.verificarConciliacionCajaBanco();
    const caja = conciliacion.find(f => f.cuenta === 'Caja');
    assert.equal(caja.saldoLedgerSimple, 500000, 'El libro simple debe reflejar el saldo inicial configurado');
    assert.equal(caja.saldoDoblePartida, 500000, 'La doble partida debe tener ahora la misma contrapartida');
    assert.equal(caja.conciliado, true, 'Ya no debe reportar una diferencia falsa por el saldo inicial');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizar() reemplaza (revierte el anterior y crea uno nuevo) si el saldo inicial de Banco cambia otra vez', () => {
  const ctx = crearDbTemporal();
  try {
    const asientoContableService = new AsientoContableService(ctx.dbService);
    const service = new ConfiguracionService(ctx.dbService, asientoContableService);

    service.actualizar({ saldo_banco_inicial: 200000 }, 1);
    service.actualizar({ saldo_banco_inicial: 750000 }, 1);

    const conciliacion = asientoContableService.verificarConciliacionCajaBanco();
    const banco = conciliacion.find(f => f.cuenta === 'Banco');
    assert.equal(banco.saldoLedgerSimple, 750000);
    assert.equal(banco.saldoDoblePartida, 750000, 'Debe reflejar el valor NUEVO, no la suma de ambos');
    assert.equal(banco.conciliado, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizar() no crea ningún asiento si saldo_caja_inicial no viene en los datos, o si es 0', () => {
  const ctx = crearDbTemporal();
  try {
    const asientoContableService = new AsientoContableService(ctx.dbService);
    const service = new ConfiguracionService(ctx.dbService, asientoContableService);

    service.actualizar({ nombre_asociacion: 'Acueducto de Prueba' }, 1);
    service.actualizar({ saldo_caja_inicial: 0 }, 1);

    const conciliacion = asientoContableService.verificarConciliacionCajaBanco();
    for (const fila of conciliacion) {
      assert.equal(fila.saldoDoblePartida, 0);
      assert.equal(fila.conciliado, true);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizar() sin asientoContableService inyectado se comporta exactamente igual que antes de este task (retrocompatible)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new ConfiguracionService(ctx.dbService); // sin segundo argumento
    assert.doesNotThrow(() => service.actualizar({ saldo_caja_inicial: 999000 }, 1));
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `npm test`
Expected: FAIL — `ConfiguracionService` constructor todavía no acepta un segundo argumento y
`actualizar()` no sincroniza ningún asiento, así que la primera prueba falla en el `assert.equal`
de `saldoDoblePartida` (queda en 0, no 500000).

- [ ] **Step 3: Generalizar la excepción de sincronización en `revertir()`**

En `src/services/AsientoContableService.js`, dentro de `revertir()` (líneas actuales 429-467),
reemplazar la variable `esReversionDeReembolsoCajaMenor` y su comentario por una versión que
también cubra el nuevo tipo de comprobante:

```js
      // Si el asiento original era una nota contable manual que afectaba Caja/Banco, su reversión
      // también debe reflejarse ahí (ver crear()). Si era de Gasto/Recibo/Movimiento, el Service
      // que pidió la reversión (GastoService.anular, ReciboService.anular) ya crea su propia
      // contrapartida en `movimientos`, así que no se duplica aquí.
      //
      // Excepción: hay notas manuales cuyo efecto en el libro simple NO viene de sincronizarLineaConCajaBanco
      // sino de otra fuente, así que sincronizar su reversión duplicaría el efecto en vez de neutralizarlo:
      //   - 'Reembolso Caja Menor': es un traslado interno Caja General <-> Caja Menor que ya se creó
      //     con sincronizarLedgerSimple=false (ver comentario histórico de este caso más abajo).
      //   - 'Apertura Saldo Inicial': su contrapartida en el libro simple es el propio valor de
      //     saldo_caja_inicial/saldo_banco_inicial en `configuracion` (ver CajaRepository.getSaldo()),
      //     no una fila en `movimientos` — sincronizar la reversión insertaría una fila que no debe existir.
      const TIPOS_MANUAL_SIN_SINCRONIZAR_EN_REVERSION = ['Reembolso Caja Menor', 'Apertura Saldo Inicial'];
      const noDebeSincronizarReversion = asiento.tipo_origen === 'Manual' && TIPOS_MANUAL_SIN_SINCRONIZAR_EN_REVERSION.includes(asiento.tipo_comprobante);
      const reversionId = this.crear({
        fecha: new Date().toISOString().split('T')[0],
        concepto: `Reversión: ${asiento.concepto}`,
        tipoOrigen: 'Reversion',
        tipoComprobante: asiento.tipo_comprobante,
        referenciaId: asiento.id,
        referenciaTipo: 'Asiento',
        usuarioId,
        sincronizarLedgerSimple: asiento.tipo_origen === 'Manual' && !noDebeSincronizarReversion,
        lineas: asiento.lineas.map(l => ({
          cuentaContableId: l.cuenta_id,
          debito: l.credito,
          credito: l.debito,
          terceroIdentificacion: l.tercero_identificacion,
          terceroNombre: l.tercero_nombre,
          terceroId: l.tercero_id || null,
          propietarioId: l.propietario_id || null
        }))
      });
```

(Solo cambia el nombre de la variable y la lista de tipos que cubre; el resto de `revertir()` queda igual.)

- [ ] **Step 4: Añadir `sincronizarAperturaSaldoInicial` a `AsientoContableService`**

Añadir este método a `src/services/AsientoContableService.js` (por ejemplo, justo antes de
`crearManual`):

```js
  // Sincroniza (crea/reemplaza) el asiento de apertura que representa, en la contabilidad de
  // doble partida, el saldo inicial configurado en Configuración para Caja o Banco. Sin este
  // asiento, verificarConciliacionCajaBanco() (Task 6 / hallazgo A-9) siempre reportaba una
  // diferencia igual al saldo inicial, porque el libro simple (`movimientos`, vía
  // CajaRepository.getSaldo) SÍ lo incluye pero la doble partida no tenía ninguna contrapartida.
  // sincronizarLedgerSimple se deja en false a propósito (ver comentario en revertir()): el
  // libro simple ya cuenta este saldo directamente desde `configuracion`, sincronizar aquí lo
  // duplicaría.
  sincronizarAperturaSaldoInicial(claveCuentaAutomatica, monto, usuarioId = null) {
    const referenciaTipo = 'ConfiguracionSaldoInicial';
    const referenciaId = claveCuentaAutomatica === 'CAJA' ? 1 : 2;

    const asientoPrevio = this.repository.findByReferenciaActiva(referenciaTipo, referenciaId);
    if (asientoPrevio) {
      this.revertir(asientoPrevio.id, 'Saldo inicial actualizado desde Configuración', usuarioId);
    }

    if (!monto || monto <= 0) return null;

    const cuentaId = this.cuentaAutomaticaRepository.getCuentaIdByClave(claveCuentaAutomatica);
    if (!cuentaId) return null; // cuenta automática no configurada; nada que sincronizar todavía

    const patrimonio = this.planCuentaRepository.findByCodigo('3105');
    if (!patrimonio) return null; // no debería pasar: '3105' se siembra en la migración 006

    const nombreCuenta = claveCuentaAutomatica === 'CAJA' ? 'Caja' : 'Bancos';

    return this.crear({
      fecha: new Date().toLocaleDateString('en-CA'),
      concepto: `Saldo inicial de ${nombreCuenta} (configurado en Configuración)`,
      tipoOrigen: 'Manual',
      tipoComprobante: 'Apertura Saldo Inicial',
      referenciaId,
      referenciaTipo,
      usuarioId,
      sincronizarLedgerSimple: false,
      lineas: [
        { cuentaContableId: cuentaId, debito: monto, credito: 0 },
        { cuentaContableId: patrimonio.id, debito: 0, credito: monto }
      ]
    });
  }
```

- [ ] **Step 5: Inyectar `AsientoContableService` en `ConfiguracionService`**

En `src/services/ConfiguracionService.js`, modificar el constructor:

```js
  constructor(dbService, asientoContableService = null) {
    this.repository = new ConfiguracionRepository(dbService);
    this.asientoContableService = asientoContableService;
  }
```

Y modificar `actualizar(datos)` para que reciba `usuarioId` y sincronice el asiento de apertura
DESPUÉS de guardar los cambios (para que, si algo en la sincronización fallara, la configuración
ya haya quedado guardada de forma consistente con lo que el usuario pidió; y para poder comparar
el valor "antes" contra el "después" antes de sobreescribir):

```js
  actualizar(datos, usuarioId = null) {
    if (datos.nombre_asociacion !== undefined && !datos.nombre_asociacion.trim()) {
      throw new Error('El nombre de la asociación es obligatorio');
    }

    if (datos.caja_menor_saldo_objetivo !== undefined) {
      const valor = Number(datos.caja_menor_saldo_objetivo);
      if (!Number.isFinite(valor) || valor < 0) {
        throw new Error('El saldo objetivo de Caja Menor debe ser un número mayor o igual a cero');
      }
    }

    // El consecutivo de recibos nunca puede retroceder por debajo de un recibo ya emitido,
    // de lo contrario se generarían números de recibo duplicados.
    if (datos.consecutivo_recibos !== undefined) {
      const nuevoConsecutivo = parseInt(datos.consecutivo_recibos, 10);
      if (!Number.isInteger(nuevoConsecutivo) || nuevoConsecutivo < 1) {
        throw new Error('El consecutivo de recibos debe ser un número entero mayor a cero');
      }

      const maxExistente = this.repository.getMaxNumeroRecibo();
      if (nuevoConsecutivo <= maxExistente) {
        throw new Error(`El consecutivo debe ser mayor al último recibo ya emitido (No. ${maxExistente})`);
      }
    }

    if (datos.periodo_bloqueo_anterior_a !== undefined && datos.periodo_bloqueo_anterior_a !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.periodo_bloqueo_anterior_a)) {
        throw new Error('La fecha límite de bloqueo debe tener el formato AAAA-MM-DD, o quedar vacía para no restringir');
      }
    }

    const actualAntes = this.repository.getAll();
    const cambiosSaldoInicial = [];
    if (datos.saldo_caja_inicial !== undefined && Number(datos.saldo_caja_inicial) !== Number(actualAntes.saldo_caja_inicial || 0)) {
      cambiosSaldoInicial.push({ clave: 'CAJA', monto: Number(datos.saldo_caja_inicial) });
    }
    if (datos.saldo_banco_inicial !== undefined && Number(datos.saldo_banco_inicial) !== Number(actualAntes.saldo_banco_inicial || 0)) {
      cambiosSaldoInicial.push({ clave: 'BANCO', monto: Number(datos.saldo_banco_inicial) });
    }

    for (const clave of CLAVES_EDITABLES) {
      if (datos[clave] !== undefined) {
        this.repository.actualizar(clave, datos[clave]);
      }
    }

    if (this.asientoContableService) {
      for (const cambio of cambiosSaldoInicial) {
        this.asientoContableService.sincronizarAperturaSaldoInicial(cambio.clave, cambio.monto, usuarioId);
      }
    }
  }
```

- [ ] **Step 6: Ejecutar y verificar que pasa**

Run: `npm test`
Expected: todos los tests en verde, incluidos los 4 nuevos de este task.

- [ ] **Step 7: Conectar en `main.js`**

`ConfiguracionService` se instancia ANTES que `AsientoContableService` (línea actual 296 vs 306),
así que hay que mover esa línea después, y pasarle la instancia. Reemplazar:

```js
  authService = new AuthService(dbService);
  configuracionService = new ConfiguracionService(dbService);
  backupService = new BackupService(dbService);
```

por:

```js
  authService = new AuthService(dbService);
  backupService = new BackupService(dbService);
```

Y más abajo, reemplazar:

```js
  asientoContableService = new AsientoContableService(dbService);
  cajaMenorService = new CajaMenorService(dbService);
```

por:

```js
  asientoContableService = new AsientoContableService(dbService);
  configuracionService = new ConfiguracionService(dbService, asientoContableService);
  cajaMenorService = new CajaMenorService(dbService);
```

(Nada entre las líneas 297-306 originales lee `configuracionService`, así que moverla más abajo
en el mismo bloque síncrono de `app.whenReady().then(...)` es seguro — confírmelo con
`grep -n "configuracionService" main.js` antes de mover la línea, para descartar cualquier uso
intermedio que se le haya escapado a este plan.)

Y en el handler `config:actualizar` (línea actual ~1543), pasar `sesionActual.id`:

```js
  envolverHandle('config:actualizar', async (event, datos) => {
    try {
      configuracionService.actualizar(datos, sesionActual.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
```

- [ ] **Step 8: Ejecutar toda la suite una vez más**

Run: `npm test`
Expected: todos los tests en verde (incluida la infraestructura existente; este task no cambia
ninguna migración ni el conteo de migraciones).

- [ ] **Step 9: Commit**

```bash
git add src/services/AsientoContableService.js src/services/ConfiguracionService.js main.js src/services/ConfiguracionService.aperturaSaldoInicial.test.js
git commit -m "fix(alto): sembrar asiento de apertura para el saldo inicial configurado de Caja/Banco"
```

---

## Verificación final de todo el plan

Después de completar los 16 tasks:

- [ ] **Run:** `npm test` — Expected: todos los tests en verde (≈23 tests entre Task 0 y Task 11, más las verificaciones manuales de los Tasks 12-15, más los nuevos de Task 16).
- [ ] **Run:** `npm start` — la app debe arrancar, aplicar las migraciones 031/032/033 sobre `data/acueducto.db` la primera vez, y permitir iniciar sesión y navegar por Contabilidad, Gastos y Caja con normalidad.
- [ ] Repetir la consulta de conciliación del Task 6 (`window.api.asientos.getConciliacionCajaBanco()`) y confirmar `conciliado: true` en Caja y Banco.
- [ ] Releer el informe de auditoría original (Artifact publicado el 2026-07-03) y tachar mentalmente los 13 hallazgos Crítico/Alto contra lo implementado aquí — ninguno debe quedar sin una línea clara de "esto se corrigió en el Task N".
