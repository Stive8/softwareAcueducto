# Import histórico de Gastos desde Excel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir una herramienta de línea de comandos que cargue el histórico real de gastos (2022-2026) de `Gastos Totales.xlsx` a la BD, pasando por `GastoService.create()` (el código real del formulario), con fase de revisión humana antes de escribir.

**Architecture:** Módulos puros y testeables (mapeo de columnas, normalización, clasificación, resolución de terceros) más dos CLIs de orquestación: `preview.js` (propone, no escribe) y `commit.js` (backup + escribe vía servicios reales). Idempotencia por marcador `[import:<hoja>#<fila>]` en `observaciones`. Todo corre con Electron en modo Node (`ELECTRON_RUN_AS_NODE=1`) porque usa `better-sqlite3`.

**Tech Stack:** Node.js (CommonJS), `exceljs` (ya instalado), `better-sqlite3` vía `DatabaseService`, `node:test` + `node:assert/strict`, servicios existentes en `src/services` y `src/repositories`.

**Spec:** [docs/superpowers/specs/2026-07-18-import-gastos-excel-design.md](../specs/2026-07-18-import-gastos-excel-design.md)

## Global Constraints

- **Nunca INSERT directo a `gastos`**: toda escritura de gastos pasa por `GastoService.create(gastoData, usuarioId)` con campos **camelCase** (`fechaGasto`, `concepto`, `tipoGasto`, `valor`, `metodoPago`, `terceroId`, `tipoOperacion`, `observaciones`).
- **Fecha siempre `YYYY-MM-DD`** (string de 10 chars). Un ISO con hora rompe `PeriodoContableService.validarFechaPermitida` (`new Date(fecha+'T00:00:00')` → `NaN`).
- **Terceros vía `TerceroService.create(data)`** con `esProveedor: true` y número que cumpla `^\d{3,13}$` (NIT sin `-DV`). El tercero "No informado" es `id=1` y **nunca** se re-crea.
- **Auditoría**: `AuditoriaService.registrar({ usuarioId: 1, accion: 'create', tabla: 'gastos', registroId, datosNuevos })` (usuario `admin` id=1, FK válida).
- **Todos los archivos nuevos van en `scripts/import-gastos/`.** Tests junto al código como `*.test.js` (convención del repo).
- **Comando de test** (correr un archivo): definir una vez por sesión de shell
  ```bash
  ELECTRON=$(node -e "process.stdout.write(require('electron'))")
  ```
  y luego `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec <archivo.test.js>`.
- **Suite completa**: `npm test`.
- **Datos de referencia verificados contra la BD real** (para preflight y reconciliación): Caja General = cuenta código `110505`; saldo actual $210.645.500; total a importar ~$125.834.226; tercero Vicencio existente `id=2` con cédula `93238699` (typo) → canónica `93328699`.

---

### Task 1: Scaffold + mapeo de columnas por hoja

**Files:**
- Create: `scripts/import-gastos/config-hojas.js`
- Test: `scripts/import-gastos/config-hojas.test.js`

**Interfaces:**
- Produces:
  - `CONFIG_HOJAS`: objeto keyed por año (`'2022'`…`'2026'`). Cada entrada `{ headerRow: number, cols: { fecha, nombre, id, concepto, valor }, truncarTodoDespuesDe?: { col: string, patron: RegExp } }`. Los valores de `cols` son índices **0-based**; `id` puede ser `null` (hoja sin columna de identificación).
  - `ORDEN_PROCESAMIENTO`: `['2026','2025','2024','2023','2022']`.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/import-gastos/config-hojas.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG_HOJAS, ORDEN_PROCESAMIENTO } = require('./config-hojas');

test('CONFIG_HOJAS tiene las 5 hojas con mapeo de columnas', () => {
  assert.deepEqual(Object.keys(CONFIG_HOJAS).sort(), ['2022', '2023', '2024', '2025', '2026']);
  for (const anio of Object.keys(CONFIG_HOJAS)) {
    const c = CONFIG_HOJAS[anio];
    assert.equal(typeof c.headerRow, 'number');
    assert.equal(typeof c.cols.fecha, 'number');
    assert.equal(typeof c.cols.concepto, 'number');
    assert.equal(typeof c.cols.valor, 'number');
  }
});

test('2022 no tiene columna de identificación (id = null)', () => {
  assert.equal(CONFIG_HOJAS['2022'].cols.id, null);
});

test('2023 define truncado en "RETIROS DE LA CUENTA"', () => {
  assert.match('RETIROS DE LA CUENTA'.toUpperCase(), CONFIG_HOJAS['2023'].truncarTodoDespuesDe.patron);
});

test('ORDEN_PROCESAMIENTO va de la hoja más nueva a la más vieja', () => {
  assert.deepEqual(ORDEN_PROCESAMIENTO, ['2026', '2025', '2024', '2023', '2022']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/config-hojas.test.js`
Expected: FAIL con `Cannot find module './config-hojas'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/import-gastos/config-hojas.js
// Mapeo de columnas por hoja del archivo "Gastos Totales.xlsx". Los índices son 0-based sobre
// el array de valores de cada fila (ver leer-excel.js). Difieren entre hojas porque el archivo
// se llevó a mano durante años: 2022 no tiene columna de identificación (su 3a columna es
// CANTIDAD), 2023 arrastra una tabla de conciliación en columnas 6-13 que se ignora leyendo
// solo 0-4, y todas las hojas traen filas de título/total que se excluyen en leer-excel.js.
const CONFIG_HOJAS = {
  '2026': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 } },
  '2025': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 } },
  '2024': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 } },
  '2023': {
    headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 },
    // La sección "RETIROS DE LA CUENTA" al final no son gastos individuales sino un resumen
    // aparte: esa fila y todas las siguientes se descartan como bloque.
    truncarTodoDespuesDe: { col: 'nombre', patron: /RETIROS DE LA CUENTA/i },
  },
  '2022': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: null, concepto: 3, valor: 4 } },
};

// De la más nueva (más limpia) a la más vieja: se valida el proceso completo en 2026 antes de
// arriesgar las hojas sucias, y para cuando se llega a 2022 (sin IDs) el catálogo de terceros
// ya está poblado por los años posteriores, habilitando el match por nombre.
const ORDEN_PROCESAMIENTO = ['2026', '2025', '2024', '2023', '2022'];

module.exports = { CONFIG_HOJAS, ORDEN_PROCESAMIENTO };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/config-hojas.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-gastos/config-hojas.js scripts/import-gastos/config-hojas.test.js
git commit -m "feat(import-gastos): mapeo de columnas por hoja del Excel"
```

---

### Task 2: Lectura/escritura CSV (RFC-4180 mínimo)

**Files:**
- Create: `scripts/import-gastos/csv.js`
- Test: `scripts/import-gastos/csv.test.js`

**Interfaces:**
- Produces:
  - `stringifyCsv(headers: string[], rows: object[]): string` — cada row es un objeto keyed por header; escapa comillas/comas.
  - `parseCsv(texto: string): object[]` — devuelve array de objetos keyed por la fila de headers. Asume sin saltos de línea embebidos dentro de un campo (los conceptos se normalizan colapsando `\n` antes de escribir).

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/import-gastos/csv.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { stringifyCsv, parseCsv } = require('./csv');

test('stringify + parse recupera los datos, incluso con comas y comillas', () => {
  const headers = ['a', 'b', 'c'];
  const rows = [
    { a: '1', b: 'texto con, coma', c: 'dijo "hola"' },
    { a: '2', b: 'simple', c: '' },
  ];
  const csv = stringifyCsv(headers, rows);
  const back = parseCsv(csv);
  assert.deepEqual(back, rows);
});

test('parseCsv respeta campos vacíos y espacios', () => {
  const csv = 'x,y\n"",  hola  \n1,2';
  const back = parseCsv(csv);
  assert.deepEqual(back, [{ x: '', y: '  hola  ' }, { x: '1', y: '2' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/csv.test.js`
Expected: FAIL con `Cannot find module './csv'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/import-gastos/csv.js
// CSV mínimo (RFC-4180) suficiente para el flujo preview→revisión→commit. Los conceptos traen
// comas y comillas, así que hay que citar/escapar; NO se soportan saltos de línea dentro de un
// campo (leer-excel.js los colapsa antes de escribir), lo que permite parsear por líneas.
function escaparCampo(valor) {
  const s = valor == null ? '' : String(valor);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function stringifyCsv(headers, rows) {
  const lineas = [headers.map(escaparCampo).join(',')];
  for (const row of rows) {
    lineas.push(headers.map((h) => escaparCampo(row[h])).join(','));
  }
  return lineas.join('\n');
}

// Parseo de una línea CSV en campos, respetando comillas dobles y "" como comilla escapada.
function parsearLinea(linea) {
  const campos = [];
  let campo = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (enComillas) {
      if (ch === '"' && linea[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') { enComillas = false; }
      else { campo += ch; }
    } else {
      if (ch === '"') { enComillas = true; }
      else if (ch === ',') { campos.push(campo); campo = ''; }
      else { campo += ch; }
    }
  }
  campos.push(campo);
  return campos;
}

function parseCsv(texto) {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lineas.length === 0) return [];
  const headers = parsearLinea(lineas[0]);
  return lineas.slice(1).map((linea) => {
    const campos = parsearLinea(linea);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = campos[i] ?? ''; });
    return obj;
  });
}

module.exports = { stringifyCsv, parseCsv };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/csv.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-gastos/csv.js scripts/import-gastos/csv.test.js
git commit -m "feat(import-gastos): lectura/escritura CSV para preview y commit"
```

---

### Task 3: Normalización de fila (fecha, concepto, exclusiones)

**Files:**
- Create: `scripts/import-gastos/normalizar.js`
- Test: `scripts/import-gastos/normalizar.test.js`

**Interfaces:**
- Consumes: `CONFIG_HOJAS` de Task 1 (una entrada `config`).
- Produces:
  - `normalizarFecha(v): string | null` — Date/ISO/string → `YYYY-MM-DD` o `null` si inválida.
  - `normalizarTexto(s): string` — colapsa saltos de línea y espacios repetidos, hace trim.
  - `clasificarFila(rawRow: any[], config, filaExcel: number)` → uno de:
    - `{ tipo: 'truncar' }` (coincide `truncarTodoDespuesDe` → cortar aquí en adelante)
    - `{ tipo: 'excluida', motivo: string }`
    - `{ tipo: 'dato', fila: { filaExcel, fecha, nombre, identificacion, concepto, valor } }`

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/import-gastos/normalizar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarFecha, normalizarTexto, clasificarFila } = require('./normalizar');
const { CONFIG_HOJAS } = require('./config-hojas');

test('normalizarFecha convierte Date UTC-midnight a YYYY-MM-DD sin corrimiento', () => {
  assert.equal(normalizarFecha(new Date('2025-01-31T00:00:00.000Z')), '2025-01-31');
});

test('normalizarFecha acepta string ISO y string YYYY-MM-DD', () => {
  assert.equal(normalizarFecha('2022-02-08T00:00:00.000Z'), '2022-02-08');
  assert.equal(normalizarFecha('2024-06-15'), '2024-06-15');
});

test('normalizarFecha devuelve null para basura', () => {
  assert.equal(normalizarFecha(''), null);
  assert.equal(normalizarFecha(null), null);
  assert.equal(normalizarFecha('no es fecha'), null);
});

test('normalizarTexto colapsa saltos de línea y espacios', () => {
  assert.equal(normalizarTexto('SERVICIO\n  HONORARIOS   CONTADOR'), 'SERVICIO HONORARIOS CONTADOR');
});

test('clasificarFila marca dato válido de 2025', () => {
  const cfg = CONFIG_HOJAS['2025'];
  const raw = [new Date('2025-02-14T00:00:00.000Z'), 'EDWARD HERRERA', 93412203, 'APOYO A CAMBIO DE TUBERIA', 300000];
  const r = clasificarFila(raw, cfg, 12);
  assert.equal(r.tipo, 'dato');
  assert.equal(r.fila.fecha, '2025-02-14');
  assert.equal(r.fila.valor, 300000);
  assert.equal(r.fila.identificacion, '93412203');
  assert.equal(r.fila.filaExcel, 12);
});

test('clasificarFila excluye filas TOTAL, sin valor y sin fecha', () => {
  const cfg = CONFIG_HOJAS['2024'];
  assert.equal(clasificarFila([null, null, null, 'TOTAL GASTOS 2024', 27060081], cfg, 80).tipo, 'excluida');
  assert.equal(clasificarFila([new Date('2024-01-01T00:00:00Z'), 'X', 1, 'CONCEPTO', null], cfg, 5).tipo, 'excluida');
  assert.equal(clasificarFila(['no-fecha', 'X', 1, 'CONCEPTO', 5000], cfg, 6).motivo, 'fecha inválida');
});

test('clasificarFila corta en RETIROS DE LA CUENTA (2023)', () => {
  const cfg = CONFIG_HOJAS['2023'];
  const raw = [null, 'RETIROS DE LA CUENTA', null, 'RETIROS - RECAUDOS', 5777000];
  assert.equal(clasificarFila(raw, cfg, 315).tipo, 'truncar');
});

test('clasificarFila en 2022 (sin columna id) deja identificacion null', () => {
  const cfg = CONFIG_HOJAS['2022'];
  const raw = [new Date('2022-03-01T00:00:00Z'), 'VICENCIO HERRERA', 3 /*cantidad, se ignora*/, 'PAGO FONTANERO', 617000];
  const r = clasificarFila(raw, cfg, 31);
  assert.equal(r.tipo, 'dato');
  assert.equal(r.fila.identificacion, null);
  assert.equal(r.fila.nombre, 'VICENCIO HERRERA');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/normalizar.test.js`
Expected: FAIL con `Cannot find module './normalizar'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/import-gastos/normalizar.js
// Normaliza los valores crudos de una fila del Excel a un formato uniforme y decide si la fila
// es un gasto real, una fila a excluir (título/total/sin datos) o el corte de una sección.

function normalizarTexto(s) {
  if (s == null) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}

// Devuelve 'YYYY-MM-DD' o null. Las celdas de fecha de exceljs llegan como Date a medianoche
// UTC; a medianoche UTC, toISOString().slice(0,10) no corre el día. Obligatorio para no romper
// PeriodoContableService.validarFechaPermitida (hace new Date(fecha+'T00:00:00')).
function normalizarFecha(v) {
  if (v == null || v === '') return null;
  let d;
  if (v instanceof Date) d = v;
  else if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    d = new Date(v);
  } else return null;
  if (isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function clasificarFila(rawRow, config, filaExcel) {
  const { cols, truncarTodoDespuesDe } = config;
  const nombre = normalizarTexto(rawRow[cols.nombre]);
  const conceptoRaw = rawRow[cols.concepto];
  const valorRaw = rawRow[cols.valor];

  // Corte de sección (ej. "RETIROS DE LA CUENTA" en 2023): esta fila y todas las siguientes fuera.
  if (truncarTodoDespuesDe) {
    const campo = normalizarTexto(rawRow[cols[truncarTodoDespuesDe.col]]);
    if (truncarTodoDespuesDe.patron.test(campo)) return { tipo: 'truncar' };
  }

  const concepto = normalizarTexto(conceptoRaw);
  if (!concepto) return { tipo: 'excluida', motivo: 'sin concepto' };
  if (/^TOTAL/i.test(concepto)) return { tipo: 'excluida', motivo: 'fila de total' };

  if (valorRaw == null || valorRaw === '' || typeof valorRaw !== 'number' || !(valorRaw > 0)) {
    return { tipo: 'excluida', motivo: 'valor vacío o no numérico' };
  }

  const fecha = normalizarFecha(rawRow[cols.fecha]);
  if (!fecha) return { tipo: 'excluida', motivo: 'fecha inválida' };

  // 2022 no tiene columna de identificación (cols.id === null) → identificacion null.
  let identificacion = null;
  if (cols.id != null) {
    const idRaw = rawRow[cols.id];
    identificacion = idRaw == null || idRaw === '' ? null : String(idRaw).trim();
  }

  return { tipo: 'dato', fila: { filaExcel, fecha, nombre, identificacion, concepto, valor: valorRaw } };
}

module.exports = { normalizarFecha, normalizarTexto, clasificarFila };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/normalizar.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-gastos/normalizar.js scripts/import-gastos/normalizar.test.js
git commit -m "feat(import-gastos): normalización de fecha/concepto y exclusión de filas"
```

---

### Task 4: Lectura de hoja con exceljs (I/O)

**Files:**
- Create: `scripts/import-gastos/leer-excel.js`
- Test: `scripts/import-gastos/leer-excel.test.js`

**Interfaces:**
- Consumes: `CONFIG_HOJAS` (Task 1), `clasificarFila` (Task 3), `exceljs`.
- Produces:
  - `async leerHoja(filePath, hojaNombre, config)` → `{ filas: [...], excluidas: [{ filaExcel, motivo }] }`. Aplica `clasificarFila` desde `config.headerRow + 1` en adelante; al primer `truncar`, deja de leer.
  - `async abrirLibro(filePath)` → workbook exceljs (helper reutilizado por preview).

- [ ] **Step 1: Write the failing test** (genera un `.xlsx` de fixture en memoria/temp y lo lee)

```javascript
// scripts/import-gastos/leer-excel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { leerHoja } = require('./leer-excel');
const { CONFIG_HOJAS } = require('./config-hojas');

async function crearFixture() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GASTOS GENERALES 2025');
  for (let i = 1; i <= 6; i++) ws.addRow([]); // filas 1-6 de título/vacías
  ws.addRow(['FECHA', 'N RECIBO', 'CEDULA / NIT', 'CONCEPTO', 'VALOR']); // fila 7 header
  ws.addRow([new Date('2025-02-14T00:00:00.000Z'), 'EDWARD HERRERA', 93412203, 'APOYO A CAMBIO DE TUBERIA', 300000]); // 8
  ws.addRow([new Date('2025-02-15T00:00:00.000Z'), 'FERRETERIA', null, 'UNION DE 1/2', 8000]); // 9 sin id
  ws.addRow([null, null, null, 'TOTAL GASTOS 2025', 999999]); // 10 excluida
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-')), 'f.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

test('leerHoja devuelve filas de datos y excluye la de TOTAL', async () => {
  const file = await crearFixture();
  const { filas, excluidas } = await leerHoja(file, 'GASTOS GENERALES 2025', CONFIG_HOJAS['2025']);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].concepto, 'APOYO A CAMBIO DE TUBERIA');
  assert.equal(filas[0].fecha, '2025-02-14');
  assert.equal(filas[1].identificacion, null);
  assert.equal(excluidas.length, 1);
  assert.equal(excluidas[0].motivo, 'fila de total');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/leer-excel.test.js`
Expected: FAIL con `Cannot find module './leer-excel'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/import-gastos/leer-excel.js
const ExcelJS = require('exceljs');
const { clasificarFila } = require('./normalizar');

// Extrae el valor "plano" de una celda exceljs (resuelve fórmulas y rich-text a su valor final).
function valorCelda(cell) {
  let v = cell.value;
  if (v && typeof v === 'object' && v.error !== undefined) return { __error: v.error };
  if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
  if (v && typeof v === 'object' && v.text !== undefined) v = v.text;
  return v;
}

function filaComoArray(row, maxCol) {
  const arr = [];
  for (let c = 1; c <= maxCol; c++) arr[c - 1] = valorCelda(row.getCell(c));
  return arr;
}

async function abrirLibro(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return wb;
}

async function leerHoja(filePath, hojaNombre, config) {
  const wb = await abrirLibro(filePath);
  const ws = wb.getWorksheet(hojaNombre);
  if (!ws) throw new Error(`No se encontró la hoja "${hojaNombre}" en ${filePath}`);

  const maxCol = Math.max(config.cols.fecha, config.cols.nombre, config.cols.id ?? 0, config.cols.concepto, config.cols.valor) + 1;
  const filas = [];
  const excluidas = [];

  for (let r = config.headerRow + 1; r <= ws.rowCount; r++) {
    const raw = filaComoArray(ws.getRow(r), maxCol);
    // Celda con error de fórmula en cualquier columna relevante → excluida (no se adivina).
    if (raw.some((v) => v && typeof v === 'object' && v.__error !== undefined)) {
      excluidas.push({ filaExcel: r, motivo: `error de fórmula (${raw.find((v) => v && v.__error).__error})` });
      continue;
    }
    const res = clasificarFila(raw, config, r);
    if (res.tipo === 'truncar') break;
    if (res.tipo === 'excluida') excluidas.push({ filaExcel: r, motivo: res.motivo });
    else filas.push(res.fila);
  }

  return { filas, excluidas };
}

module.exports = { leerHoja, abrirLibro };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/leer-excel.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-gastos/leer-excel.js scripts/import-gastos/leer-excel.test.js
git commit -m "feat(import-gastos): lectura de hoja Excel con exceljs"
```

---

### Task 5: Identidades canónicas de terceros (reconciliación de typos)

**Files:**
- Create: `scripts/import-gastos/terceros-canonicos.js`
- Test: `scripts/import-gastos/terceros-canonicos.test.js`

**Interfaces:**
- Produces:
  - `canonicalizarIdentificacion(idNormalizada: string): string` — mapea variantes con typo a la identificación canónica (Vicencio `93238699`/`933228699` → `93328699`; INGECOM `900531740` → `900351740`); si no es una variante conocida, devuelve la misma.
  - `CORRECCIONES_DB: { de: string, a: string }[]` — correcciones a aplicar sobre terceros ya guardados en la BD (para reconciliar-db.js). Contiene `{ de: '93238699', a: '93328699' }` (Vicencio id=2).

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/import-gastos/terceros-canonicos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizarIdentificacion, CORRECCIONES_DB } = require('./terceros-canonicos');

test('canonicaliza las variantes con typo de Vicencio a 93328699', () => {
  assert.equal(canonicalizarIdentificacion('93238699'), '93328699');
  assert.equal(canonicalizarIdentificacion('933228699'), '93328699');
  assert.equal(canonicalizarIdentificacion('93328699'), '93328699');
});

test('canonicaliza el NIT alterno de INGECOM (sin DV) a 900351740', () => {
  assert.equal(canonicalizarIdentificacion('900531740'), '900351740');
});

test('una identificación desconocida se devuelve igual', () => {
  assert.equal(canonicalizarIdentificacion('1007831935'), '1007831935');
});

test('CORRECCIONES_DB incluye la corrección de Vicencio en la BD', () => {
  assert.ok(CORRECCIONES_DB.some((c) => c.de === '93238699' && c.a === '93328699'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/terceros-canonicos.test.js`
Expected: FAIL con `Cannot find module './terceros-canonicos'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/import-gastos/terceros-canonicos.js
// Reconciliación de terceros duplicados por typo en la identificación (criterio: gana la
// variante más frecuente en el Excel; verificado por conteo). Ver spec, sección
// "Reconciliación de terceros duplicados". Los números aquí son SIN dígito de verificación
// (ya normalizados como los deja clasificar.normalizarIdentificacion).
const ALIAS_A_CANONICO = {
  '93238699': '93328699',   // Vicencio Herrera: cédula transpuesta en la BD (registro de prueba id=2)
  '933228699': '93328699',  // Vicencio Herrera: variante con dígito extra en 2 filas del Excel
  '900531740': '900351740', // INGECOM: NIT alterno (aparece x8) → canónico el mayoritario (x13)
};

function canonicalizarIdentificacion(idNormalizada) {
  if (idNormalizada == null) return idNormalizada;
  return ALIAS_A_CANONICO[idNormalizada] || idNormalizada;
}

// Correcciones a aplicar sobre terceros YA guardados en la BD antes de importar (reconciliar-db.js).
const CORRECCIONES_DB = [
  { de: '93238699', a: '93328699' }, // Vicencio Herrera (tercero id=2)
];

module.exports = { canonicalizarIdentificacion, CORRECCIONES_DB };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/terceros-canonicos.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-gastos/terceros-canonicos.js scripts/import-gastos/terceros-canonicos.test.js
git commit -m "feat(import-gastos): identidades canónicas de terceros (Vicencio, INGECOM)"
```

---

### Task 6: Clasificación (identificación, tipo de gasto, resolución de tercero)

**Files:**
- Create: `scripts/import-gastos/clasificar.js`
- Test: `scripts/import-gastos/clasificar.test.js`

**Interfaces:**
- Consumes: `canonicalizarIdentificacion` (Task 5).
- Produces:
  - `normalizarIdentificacion(raw: string|null): string | null` — quita espacios; si es NIT `NNNNNNNNN-N` quita `-DV`; devuelve el número canonicalizado; `null` si no hay dígitos utilizables.
  - `esNombreValido(nombre: string): boolean` — `true` si contiene letras (no es solo dígitos/espacios/guiones tipo `"FEP 10632"`).
  - `proponerTipoIdentificacion(idNormalizada, nombre): 'NIT' | 'Cédula de Ciudadanía'`.
  - `clasificarTipoGasto(concepto: string): { tipoGasto: string|null, confianza: 'alta'|'media' }` — `tipoGasto` null = "Sin clasificar".
  - `resolverTercero({ nombre, identificacion }, { terceros }): proposal` donde `terceros` es `[{ id, numero_identificacion, nombre_norm }]` y `proposal` es uno de:
    - `{ modo: 'existente', terceroId }`
    - `{ modo: 'nuevo', tipoIdentificacion, numeroIdentificacion, nombreRazonSocial }`
    - `{ modo: 'no_informado', nombreOriginal }`
    - `{ modo: 'revisar_nombre', terceroIdSugerido, nombreOriginal }`
  - `normalizarNombre(s): string` — mayúsculas, sin acentos, espacios colapsados (para match por nombre).

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/import-gastos/clasificar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarIdentificacion, esNombreValido, clasificarTipoGasto, resolverTercero, normalizarNombre,
} = require('./clasificar');

test('normalizarIdentificacion quita el DV del NIT y canonicaliza', () => {
  assert.equal(normalizarIdentificacion('900531740-2'), '900351740'); // DV quitado + canonicalizado a INGECOM mayoritario
  assert.equal(normalizarIdentificacion('93328699'), '93328699');
  assert.equal(normalizarIdentificacion('93238699'), '93328699');     // typo Vicencio → canónico
  assert.equal(normalizarIdentificacion('  80765236 '), '80765236');
});

test('normalizarIdentificacion devuelve null si no hay número usable', () => {
  assert.equal(normalizarIdentificacion(null), null);
  assert.equal(normalizarIdentificacion('__'), null);
  assert.equal(normalizarIdentificacion(''), null);
});

test('esNombreValido distingue nombres de números de factura', () => {
  assert.equal(esNombreValido('VICENCIO HERRERA'), true);
  assert.equal(esNombreValido('FEP 10632'), false);
  assert.equal(esNombreValido('1901 100207215'), false);
  assert.equal(esNombreValido('4385'), false);
});

test('clasificarTipoGasto: fontanero y cobro de cartera → Honorarios (alta)', () => {
  assert.deepEqual(clasificarTipoGasto('PAGO SERVICIO FONTANERO MES DE ENERO 2025'), { tipoGasto: 'Honorarios', confianza: 'alta' });
  assert.deepEqual(clasificarTipoGasto('SERVICIOS COBRO DE CARTERA BRAYHAN ORTEGON'), { tipoGasto: 'Honorarios', confianza: 'alta' });
});

test('clasificarTipoGasto: materiales PVC → Accesorios y Materiales (media)', () => {
  const r = clasificarTipoGasto('SEMICODO Y UNION DE 4" PVC');
  assert.equal(r.tipoGasto, 'Accesorios y Materiales');
  assert.equal(r.confianza, 'media');
});

test('clasificarTipoGasto: bono → Bonificaciones; tasa uso → Impuestos', () => {
  assert.equal(clasificarTipoGasto('BONO NAVIDEÑO').tipoGasto, 'Bonificaciones');
  assert.equal(clasificarTipoGasto('PAGO TASA USO DE AGUA CORTOLIMA').tipoGasto, 'Impuestos');
});

test('clasificarTipoGasto: concepto sin patrón → null (Sin clasificar)', () => {
  assert.equal(clasificarTipoGasto('ALGO COMPLETAMENTE INESPERADO XYZ').tipoGasto, null);
});

test('resolverTercero: id existente por identificación', () => {
  const terceros = [{ id: 2, numero_identificacion: '93328699', nombre_norm: 'VICENCIO HERRERA' }];
  const p = resolverTercero({ nombre: 'VICENCIO HERRERA', identificacion: '93328699' }, { terceros });
  assert.deepEqual(p, { modo: 'existente', terceroId: 2 });
});

test('resolverTercero: sin identificación pero nombre coincide → revisar_nombre', () => {
  const terceros = [{ id: 2, numero_identificacion: '93328699', nombre_norm: 'VICENCIO HERRERA' }];
  const p = resolverTercero({ nombre: 'VICENCIO HERRERA', identificacion: null }, { terceros });
  assert.equal(p.modo, 'revisar_nombre');
  assert.equal(p.terceroIdSugerido, 2);
});

test('resolverTercero: número de factura como nombre y sin id → no_informado', () => {
  const p = resolverTercero({ nombre: 'FEP 10632', identificacion: null }, { terceros: [] });
  assert.equal(p.modo, 'no_informado');
});

test('resolverTercero: identificación nueva con nombre válido → nuevo', () => {
  const p = resolverTercero({ nombre: 'DGV SUMINISTROS', identificacion: '80765236' }, { terceros: [] });
  assert.equal(p.modo, 'nuevo');
  assert.equal(p.numeroIdentificacion, '80765236');
  assert.equal(p.nombreRazonSocial, 'DGV SUMINISTROS');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/clasificar.test.js`
Expected: FAIL con `Cannot find module './clasificar'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/import-gastos/clasificar.js
const { canonicalizarIdentificacion } = require('./terceros-canonicos');

// Quita acentos usando el rango unicode de diacríticos combinables (escape explícito para que
// no dependa de cómo se copie/pegue el archivo).
function sinAcentos(s) {
  return String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
}

function normalizarNombre(s) {
  return sinAcentos(s).replace(/\s+/g, ' ').trim();
}

// Quita espacios; si trae DV de NIT (NNNNNNNNN-N) lo quita; devuelve el número canonicalizado o
// null si no hay dígitos usables (ej. '__', vacío). No intenta extraer cédulas embebidas en texto.
function normalizarIdentificacion(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  const conDV = s.match(/^(\d{6,12})-\d$/); // NIT con dígito de verificación
  if (conDV) s = conDV[1];
  s = s.replace(/\s+/g, '');
  if (!/^\d{3,13}$/.test(s)) return null;
  return canonicalizarIdentificacion(s);
}

function esNombreValido(nombre) {
  return /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}/.test(String(nombre || ''));
}

function proponerTipoIdentificacion(idNormalizada, nombre) {
  // Heurística simple: 9-10 dígitos con razón social de empresa suele ser NIT; si no, cédula.
  const n = normalizarNombre(nombre);
  const pareceEmpresa = /(SAS|S A S|LTDA|S\.A|SA\b|FERRETERIA|SUMINISTROS|INGECOM|COMERCIO|CIA|HIERROS|DISTRIBUIDORA)/.test(n);
  if (idNormalizada && idNormalizada.length >= 9 && pareceEmpresa) return 'NIT';
  return 'Cédula de Ciudadanía';
}

// Tabla ordenada de reglas: primera coincidencia gana. Las claves están sin acentos y en
// mayúsculas; el concepto se compara igual. confianza: 'alta' para reglas específicas, 'media'
// para las genéricas por vocabulario (materiales/labor).
const REGLAS_TIPO_GASTO = [
  { claves: ['FONTANERO'], tipo: 'Honorarios', confianza: 'alta' },
  { claves: ['COBRO DE CARTERA'], tipo: 'Honorarios', confianza: 'alta' },
  { claves: ['BONO'], tipo: 'Bonificaciones', confianza: 'alta' },
  { claves: ['HONORARIOS', 'ASESORIA', 'CONTADOR', 'DECLARACION DE RENTA', 'ESTUDIO AMBIENTAL', 'TRIBUTARIA'], tipo: 'Honorarios', confianza: 'alta' },
  { claves: ['TASA USO', 'CORTOLIMA', 'IMPUESTO', 'CAMARA DE COMERCIO'], tipo: 'Impuestos', confianza: 'alta' },
  { claves: ['REFRIGERIO', 'GASEOSA', 'AGUA BRISA', 'CAFE', 'BOLSAS DE AGUA', 'HIDRATACION', 'NOVENA'], tipo: 'Refrigerios', confianza: 'alta' },
  { claves: ['IMPRESORA', 'PORTATIL', 'MEMORIA DDR', 'EQUIPO DE COMPUTO', 'MOVIL LIBRE'], tipo: 'Equipo de Cómputo', confianza: 'alta' },
  { claves: ['RESMA', 'FOLDER', 'TALONARIO', 'COSEDORA', 'TINTA', 'PLOTER', 'PENDON', 'MULTICOPIAS'], tipo: 'Papelería', confianza: 'alta' },
  { claves: ['SILLA', 'MESA', 'MOBILIARIO', 'ARCHIVO COLGANTE'], tipo: 'Mobiliario y Equipo de Oficina', confianza: 'alta' },
  { claves: ['ENERGIA', 'ELECTRIC'], tipo: 'Energía Eléctrica', confianza: 'alta' },
  { claves: ['INTERNET'], tipo: 'Internet', confianza: 'alta' },
  { claves: ['TELEFON', 'PLAN DE DATOS'], tipo: 'Telefonía', confianza: 'alta' },
  { claves: ['TRANSPORTE', 'GASOLINA', 'VIAJE DE ARENA', 'ACARREO'], tipo: 'Transporte', confianza: 'alta' },
  { claves: ['ARRENDAMIENTO', 'ARRIENDO', 'ESCAVADORA', 'EXCAVACION', 'RETRO', 'MAQUINARIA'], tipo: 'Arrendamiento de Maquinaria', confianza: 'alta' },
  { claves: ['LIMPIEZA', 'DESINFECCION'], tipo: 'Limpieza y Desinfección', confianza: 'alta' },
  // Materiales de acueducto (genérico, confianza media)
  { claves: ['TUBO', 'TUBERIA', 'UNION', 'CODO', 'COLLAR', 'ADAPTADOR', 'REGISTRO', 'SOLDADURA', 'VALVULA', 'MANGUERA', 'PVC', 'CINTA TEFLON', 'LUBRICANTE', 'NIPLE', 'BUJE', 'SEMICODO', 'TEE', 'LLAVE'], tipo: 'Accesorios y Materiales', confianza: 'media' },
  // Mano de obra ocasional (genérico, confianza media) — evaluado después de materiales.
  { claves: ['HORAS', 'DIA DE', 'MANO DE OBRA', 'APOYO A', 'APOYO EN', 'JORNAL', 'OBRA', 'INSTALACION'], tipo: 'Mano de Obra Ocasional', confianza: 'media' },
];

function clasificarTipoGasto(concepto) {
  const c = sinAcentos(concepto);
  for (const regla of REGLAS_TIPO_GASTO) {
    if (regla.claves.some((k) => c.includes(k))) {
      return { tipoGasto: regla.tipo, confianza: regla.confianza };
    }
  }
  return { tipoGasto: null, confianza: 'media' };
}

function resolverTercero({ nombre, identificacion }, { terceros }) {
  const idNorm = normalizarIdentificacion(identificacion);
  if (idNorm) {
    const existente = terceros.find((t) => t.numero_identificacion === idNorm);
    if (existente) return { modo: 'existente', terceroId: existente.id };
    if (esNombreValido(nombre)) {
      return {
        modo: 'nuevo',
        tipoIdentificacion: proponerTipoIdentificacion(idNorm, nombre),
        numeroIdentificacion: idNorm,
        nombreRazonSocial: nombre,
      };
    }
    // Hay número pero el "nombre" no sirve (raro): mejor no inventar razón social.
    return { modo: 'no_informado', nombreOriginal: nombre };
  }

  // Sin identificación: intentar match por nombre contra el catálogo ya poblado.
  if (esNombreValido(nombre)) {
    const nn = normalizarNombre(nombre);
    const porNombre = terceros.find((t) => t.nombre_norm === nn);
    if (porNombre) return { modo: 'revisar_nombre', terceroIdSugerido: porNombre.id, nombreOriginal: nombre };
  }
  return { modo: 'no_informado', nombreOriginal: nombre };
}

module.exports = {
  normalizarIdentificacion, esNombreValido, proponerTipoIdentificacion,
  clasificarTipoGasto, resolverTercero, normalizarNombre,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/clasificar.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-gastos/clasificar.js scripts/import-gastos/clasificar.test.js
git commit -m "feat(import-gastos): clasificación de tipo de gasto y resolución de terceros"
```

---

### Task 7: Reconciliación de terceros en la BD (corrige Vicencio antes de importar)

**Files:**
- Create: `scripts/import-gastos/reconciliar-db.js`
- Test: `scripts/import-gastos/reconciliar-db.test.js`

**Interfaces:**
- Consumes: `CORRECCIONES_DB` (Task 5), `DatabaseService`.
- Produces:
  - `reconciliarIdentificaciones(dbService): { corregidos: number, detalles: string[] }` — para cada `{de, a}` en `CORRECCIONES_DB`, si existe un tercero con `numero_identificacion = de` y NO existe ya uno con `= a`, lo actualiza a `a`. Idempotente. Si ya existe uno con `a` (conflicto), lo reporta sin tocar nada.
  - CLI: `node scripts/import-gastos/reconciliar-db.js` (vía Electron) aplica sobre `data/acueducto.db`.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/import-gastos/reconciliar-db.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { reconciliarIdentificaciones } = require('./reconciliar-db');

test('corrige la cédula de Vicencio 93238699 → 93328699', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO terceros (tipo_identificacion, numero_identificacion, nombre_razon_social, es_proveedor)
                VALUES ('Cédula de Ciudadanía', '93238699', 'Vicencio Herrera', 1)`).run();

    const r = reconciliarIdentificaciones(ctx.dbService);
    assert.equal(r.corregidos, 1);

    const t = db.prepare(`SELECT numero_identificacion FROM terceros WHERE nombre_razon_social = 'Vicencio Herrera'`).get();
    assert.equal(t.numero_identificacion, '93328699');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('es idempotente: correr dos veces no falla ni duplica', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`INSERT INTO terceros (tipo_identificacion, numero_identificacion, nombre_razon_social, es_proveedor)
                VALUES ('Cédula de Ciudadanía', '93238699', 'Vicencio Herrera', 1)`).run();
    reconciliarIdentificaciones(ctx.dbService);
    const r2 = reconciliarIdentificaciones(ctx.dbService);
    assert.equal(r2.corregidos, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/reconciliar-db.test.js`
Expected: FAIL con `Cannot find module './reconciliar-db'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/import-gastos/reconciliar-db.js
const path = require('path');
const { CORRECCIONES_DB } = require('./terceros-canonicos');

// Aplica CORRECCIONES_DB sobre terceros ya guardados: corrige identificaciones con typo a su
// forma canónica, para que el import las encuentre por match exacto en vez de crear duplicados.
function reconciliarIdentificaciones(dbService) {
  const db = dbService.getDb();
  const detalles = [];
  let corregidos = 0;

  const buscar = db.prepare(`SELECT id, nombre_razon_social FROM terceros WHERE numero_identificacion = ?`);
  const actualizar = db.prepare(`UPDATE terceros SET numero_identificacion = ? WHERE id = ?`);

  for (const { de, a } of CORRECCIONES_DB) {
    const origen = buscar.get(de);
    if (!origen) continue; // ya corregido o nunca existió
    const destino = buscar.get(a);
    if (destino) {
      detalles.push(`Conflicto: ya existe un tercero con ${a} (id=${destino.id}); no se toca "${origen.nombre_razon_social}" (id=${origen.id}). Revisar manualmente.`);
      continue;
    }
    actualizar.run(a, origen.id);
    corregidos++;
    detalles.push(`Corregido "${origen.nombre_razon_social}" (id=${origen.id}): ${de} → ${a}`);
  }

  return { corregidos, detalles };
}

module.exports = { reconciliarIdentificaciones };

// --- CLI ---
if (require.main === module) {
  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();
  const r = reconciliarIdentificaciones(dbService);
  console.log(`Reconciliación de terceros: ${r.corregidos} corregido(s).`);
  r.detalles.forEach((d) => console.log('  - ' + d));
  dbService.close();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/reconciliar-db.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-gastos/reconciliar-db.js scripts/import-gastos/reconciliar-db.test.js
git commit -m "feat(import-gastos): reconciliación de identificaciones de terceros en la BD"
```

---

### Task 8: `preview.js` — genera el CSV de propuesta (no escribe en la BD)

**Files:**
- Create: `scripts/import-gastos/preview.js`
- Test: `scripts/import-gastos/preview.test.js`

**Interfaces:**
- Consumes: `leerHoja` (Task 4), `clasificarTipoGasto` + `resolverTercero` + `normalizarNombre` (Task 6), `stringifyCsv` (Task 2), `CONFIG_HOJAS` (Task 1), `DatabaseService`.
- Produces:
  - `async generarPreview({ filePath, hoja, dbService, outDir }): { csvPath, excluidasPath, resumen }` — lee terceros vivos (read-only), clasifica cada fila, escribe `<outDir>/<hoja>-preview.csv` y `<outDir>/<hoja>-excluidas.csv`.
  - Columnas del CSV (en este orden): `fila_excel, hoja, accion, fecha, tercero_modo, tercero_id, tercero_tipo_id, tercero_numero_id, tercero_nombre, tipo_gasto, confianza, valor, concepto, observaciones`.
  - Reglas de `accion`: `REVISAR` si `tipo_gasto` vacío (Sin clasificar), o `tercero_modo` ∈ {`no_informado`, `revisar_nombre`}, o `confianza = 'media'`; `IMPORTAR` en el resto.
  - CLI: `node scripts/import-gastos/preview.js <hoja> [rutaXlsx]`.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/import-gastos/preview.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { parseCsv } = require('./csv');
const { generarPreview } = require('./preview');

async function fixtureXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('GASTOS GENERALES 2026');
  for (let i = 1; i <= 6; i++) ws.addRow([]);
  ws.addRow(['FECHA', 'N RECIBO', 'CEDULA / NIT', 'CONCEPTO', 'VALOR']);
  ws.addRow([new Date('2026-01-31T00:00:00.000Z'), 'VICENCIO HERRERA', 93328699, 'PAGO SERVICIO FONTANERO MES DE ENERO 2026', 875000]);
  ws.addRow([new Date('2026-01-15T00:00:00.000Z'), 'DGV SUMINISTROS', 80765236, 'SILLA SANI 4*3 - BUJE SOLDADO PRESION 3*2', 48000]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-')), 'g.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

test('generarPreview escribe un CSV con acción y clasificación por fila', async () => {
  const ctx = crearDbTemporal();
  try {
    const filePath = await fixtureXlsx();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const { csvPath, resumen } = await generarPreview({ filePath, hoja: '2026', dbService: ctx.dbService, outDir });

    const filas = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    assert.equal(filas.length, 2);

    const fontanero = filas.find((f) => f.concepto.includes('FONTANERO'));
    assert.equal(fontanero.tipo_gasto, 'Honorarios');
    assert.equal(fontanero.tercero_modo, 'nuevo'); // no existe aún en la BD temporal
    assert.equal(fontanero.accion, 'IMPORTAR');

    const silla = filas.find((f) => f.concepto.includes('SILLA'));
    assert.equal(silla.tipo_gasto, 'Mobiliario y Equipo de Oficina');
    assert.equal(resumen.total, 2);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/preview.test.js`
Expected: FAIL con `Cannot find module './preview'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/import-gastos/preview.js
const fs = require('fs');
const path = require('path');
const { CONFIG_HOJAS } = require('./config-hojas');
const { leerHoja } = require('./leer-excel');
const { clasificarTipoGasto, resolverTercero, normalizarNombre } = require('./clasificar');
const { stringifyCsv } = require('./csv');

const COLUMNAS = [
  'fila_excel', 'hoja', 'accion', 'fecha', 'tercero_modo', 'tercero_id',
  'tercero_tipo_id', 'tercero_numero_id', 'tercero_nombre', 'tipo_gasto',
  'confianza', 'valor', 'concepto', 'observaciones',
];

function cargarTerceros(dbService) {
  const rows = dbService.getDb().prepare(`SELECT id, numero_identificacion, nombre_razon_social FROM terceros`).all();
  return rows.map((t) => ({ ...t, nombre_norm: normalizarNombre(t.nombre_razon_social) }));
}

function nombreHoja(hoja) {
  return `GASTOS GENERALES ${hoja}`;
}

async function generarPreview({ filePath, hoja, dbService, outDir }) {
  const config = CONFIG_HOJAS[hoja];
  if (!config) throw new Error(`Hoja desconocida: ${hoja}`);
  const { filas, excluidas } = await leerHoja(filePath, nombreHoja(hoja), config);
  const terceros = cargarTerceros(dbService);

  const filasCsv = filas.map((f) => {
    const { tipoGasto, confianza } = clasificarTipoGasto(f.concepto);
    const t = resolverTercero({ nombre: f.nombre, identificacion: f.identificacion }, { terceros });

    let terceroId = '', tipoId = '', numeroId = '', terceroNombre = '', observaciones = '';
    if (t.modo === 'existente') terceroId = t.terceroId;
    else if (t.modo === 'revisar_nombre') { terceroId = t.terceroIdSugerido; observaciones = `nombre Excel: ${t.nombreOriginal}`; }
    else if (t.modo === 'nuevo') { tipoId = t.tipoIdentificacion; numeroId = t.numeroIdentificacion; terceroNombre = t.nombreRazonSocial; }
    else if (t.modo === 'no_informado') observaciones = `nombre Excel: ${t.nombreOriginal}`;

    const revisar = !tipoGasto || t.modo === 'no_informado' || t.modo === 'revisar_nombre' || confianza === 'media';
    return {
      fila_excel: f.filaExcel, hoja, accion: revisar ? 'REVISAR' : 'IMPORTAR', fecha: f.fecha,
      tercero_modo: t.modo, tercero_id: terceroId, tercero_tipo_id: tipoId, tercero_numero_id: numeroId,
      tercero_nombre: terceroNombre, tipo_gasto: tipoGasto || '', confianza, valor: f.valor,
      concepto: f.concepto, observaciones,
    };
  });

  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, `${hoja}-preview.csv`);
  const excluidasPath = path.join(outDir, `${hoja}-excluidas.csv`);
  fs.writeFileSync(csvPath, stringifyCsv(COLUMNAS, filasCsv), 'utf8');
  fs.writeFileSync(excluidasPath, stringifyCsv(['fila_excel', 'motivo'], excluidas), 'utf8');

  const resumen = {
    total: filasCsv.length,
    importar: filasCsv.filter((f) => f.accion === 'IMPORTAR').length,
    revisar: filasCsv.filter((f) => f.accion === 'REVISAR').length,
    excluidas: excluidas.length,
    totalValor: filasCsv.reduce((s, f) => s + Number(f.valor), 0),
  };
  return { csvPath, excluidasPath, resumen };
}

module.exports = { generarPreview, COLUMNAS };

// --- CLI ---
if (require.main === module) {
  const DatabaseService = require('../../src/database/DatabaseService');
  const hoja = process.argv[2];
  const rutaXlsx = process.argv[3] || 'C:\\Users\\Brayhan\\Documents\\ACUEDUCTO\\Gastos Totales.xlsx';
  if (!hoja) { console.error('Uso: preview.js <hoja: 2022..2026> [rutaXlsx]'); process.exit(1); }
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();
  const outDir = path.join(__dirname, 'output');
  generarPreview({ filePath: rutaXlsx, hoja, dbService, outDir })
    .then(({ csvPath, resumen }) => {
      console.log(`Preview de ${hoja} → ${csvPath}`);
      console.log(`  Total ${resumen.total} | IMPORTAR ${resumen.importar} | REVISAR ${resumen.revisar} | excluidas ${resumen.excluidas}`);
      console.log(`  Suma valor: $${resumen.totalValor.toLocaleString('es-CO')}`);
      dbService.close();
    })
    .catch((e) => { console.error(e); dbService.close(); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/preview.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add scripts/import-gastos/preview.js scripts/import-gastos/preview.test.js
git commit -m "feat(import-gastos): preview.js genera CSV de propuesta por hoja"
```

---

### Task 9: `commit.js` — escribe los gastos vía servicios reales (con backup e idempotencia)

**Files:**
- Create: `scripts/import-gastos/commit.js`
- Test: `scripts/import-gastos/commit.test.js`

**Interfaces:**
- Consumes: `parseCsv` (Task 2), `GastoService`, `TerceroService`, `AsientoContableService`, `PlanCuentaRepository`, `AuditoriaService`, `DatabaseService`.
- Produces:
  - `ejecutarCommit({ csvPath, dbService }): { insertadas, yaImportadas, errores, log }` — procesa solo filas `accion=IMPORTAR`, con marcador de idempotencia `[import:<hoja>#<fila>]`.
  - Marcador: `marcador(hoja, filaExcel)` = `` `[import:${hoja}#${filaExcel}]` ``.
  - CLI: `node scripts/import-gastos/commit.js <hoja>` — hace backup de `data/acueducto.db`, corre preflight de saldo, procesa `output/<hoja>-preview.csv`, escribe `output/<hoja>-commit-log.json`.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/import-gastos/commit.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { crearDbTemporal, cerrarDbTemporal } = require('../../src/testUtils/dbTemporal');
const { stringifyCsv } = require('./csv');
const { COLUMNAS } = require('./preview');
const { ejecutarCommit } = require('./commit');

// Semilla: da saldo a Caja General para que los gastos en efectivo pasen la validación de saldo.
function darSaldoCaja(dbService, monto) {
  const db = dbService.getDb();
  const caja = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo='110505'`).get();
  const cap = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo='3105'`).get();
  const asiento = db.prepare(`INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen) VALUES (9500,'2025-12-31','Saldo inicial','Manual')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2025-12-31', ?, ?, 0, 'ini', ?)`).run(caja.id, monto, asiento);
  db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2025-12-31', ?, 0, ?, 'ini', ?)`).run(cap.id, monto, asiento);
}

function csvConUnaFila(outDir, hoja) {
  const fila = {
    fila_excel: 8, hoja, accion: 'IMPORTAR', fecha: '2026-01-15', tercero_modo: 'nuevo',
    tercero_id: '', tercero_tipo_id: 'NIT', tercero_numero_id: '80765236', tercero_nombre: 'DGV SUMINISTROS',
    tipo_gasto: 'Accesorios y Materiales', confianza: 'media', valor: 48000,
    concepto: 'SILLA SANI 4*3', observaciones: '',
  };
  const csvPath = path.join(outDir, `${hoja}-preview.csv`);
  fs.writeFileSync(csvPath, stringifyCsv(COLUMNAS, [fila]), 'utf8');
  return csvPath;
}

test('ejecutarCommit crea el gasto, su tercero y su asiento contable', () => {
  const ctx = crearDbTemporal();
  try {
    darSaldoCaja(ctx.dbService, 1000000);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const csvPath = csvConUnaFila(outDir, '2026');

    const r = ejecutarCommit({ csvPath, dbService: ctx.dbService });
    assert.equal(r.insertadas, 1);

    const db = ctx.dbService.getDb();
    const gasto = db.prepare(`SELECT * FROM gastos WHERE concepto = 'SILLA SANI 4*3'`).get();
    assert.ok(gasto);
    assert.match(gasto.observaciones, /\[import:2026#8\]/);
    const tercero = db.prepare(`SELECT * FROM terceros WHERE numero_identificacion = '80765236'`).get();
    assert.ok(tercero);
    const asiento = db.prepare(`SELECT COUNT(*) n FROM asientos_contables WHERE referencia_tipo='Gasto' AND referencia_id=?`).get(gasto.id);
    assert.equal(asiento.n, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('re-ejecutar el mismo CSV es idempotente (no duplica)', () => {
  const ctx = crearDbTemporal();
  try {
    darSaldoCaja(ctx.dbService, 1000000);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'));
    const csvPath = csvConUnaFila(outDir, '2026');

    ejecutarCommit({ csvPath, dbService: ctx.dbService });
    const r2 = ejecutarCommit({ csvPath, dbService: ctx.dbService });
    assert.equal(r2.insertadas, 0);
    assert.equal(r2.yaImportadas, 1);

    const n = ctx.dbService.getDb().prepare(`SELECT COUNT(*) n FROM gastos WHERE concepto='SILLA SANI 4*3'`).get().n;
    assert.equal(n, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/commit.test.js`
Expected: FAIL con `Cannot find module './commit'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// scripts/import-gastos/commit.js
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./csv');
const GastoService = require('../../src/services/GastoService');
const TerceroService = require('../../src/services/TerceroService');
const AsientoContableService = require('../../src/services/AsientoContableService');
const PlanCuentaRepository = require('../../src/repositories/PlanCuentaRepository');
const AuditoriaService = require('../../src/services/AuditoriaService');

const USUARIO_IMPORT = 1; // admin (FK válida en auditoria.usuario_id)
const CODIGO_CAJA_GENERAL = '110505';

function marcador(hoja, filaExcel) {
  return `[import:${hoja}#${filaExcel}]`;
}

// Suma de valores a importar (todas en Efectivo) vs saldo actual de Caja General. Aborta ANTES
// de escribir si no alcanza (defensa; con los datos reales nunca se dispara).
function preflightSaldo(dbService, filas) {
  const planRepo = new PlanCuentaRepository(dbService);
  const asientoSvc = new AsientoContableService(dbService);
  const caja = planRepo.findByCodigo(CODIGO_CAJA_GENERAL);
  if (!caja) throw new Error(`No se encontró la cuenta ${CODIGO_CAJA_GENERAL}`);
  const saldo = asientoSvc.getLibroMayor(caja.id).saldoFinal;
  const suma = filas.reduce((s, f) => s + Number(f.valor), 0);
  if (suma > saldo) {
    throw new Error(`Preflight de saldo: la suma a importar ($${suma.toLocaleString('es-CO')}) supera el saldo de Caja General ($${saldo.toLocaleString('es-CO')}). Import abortado.`);
  }
  return { saldo, suma };
}

function ejecutarCommit({ csvPath, dbService }) {
  const filas = parseCsv(fs.readFileSync(csvPath, 'utf8')).filter((f) => f.accion === 'IMPORTAR');
  const db = dbService.getDb();
  const gastoService = new GastoService(dbService);
  const terceroService = new TerceroService(dbService);
  const auditoria = new AuditoriaService(dbService);
  const yaExiste = db.prepare(`SELECT 1 FROM gastos WHERE observaciones LIKE ?`);
  const cacheNuevos = new Map(); // numeroIdentificacion → terceroId (evita duplicar dentro de la corrida)

  preflightSaldo(dbService, filas);

  const log = [];
  let insertadas = 0, yaImportadas = 0, errores = 0;

  for (const f of filas) {
    const marca = marcador(f.hoja, f.fila_excel);
    if (yaExiste.get(`%${marca}%`)) { yaImportadas++; log.push({ fila: f.fila_excel, estado: 'YA_IMPORTADA' }); continue; }

    try {
      // Resolver tercero
      let terceroId;
      if (f.tercero_modo === 'no_informado') terceroId = 1;
      else if (f.tercero_modo === 'existente' || f.tercero_modo === 'revisar_nombre') terceroId = Number(f.tercero_id);
      else if (f.tercero_modo === 'nuevo') {
        if (cacheNuevos.has(f.tercero_numero_id)) terceroId = cacheNuevos.get(f.tercero_numero_id);
        else {
          const yaTercero = db.prepare(`SELECT id FROM terceros WHERE numero_identificacion = ?`).get(f.tercero_numero_id);
          terceroId = yaTercero ? yaTercero.id : terceroService.create({
            tipoIdentificacion: f.tercero_tipo_id, numeroIdentificacion: f.tercero_numero_id,
            nombreRazonSocial: f.tercero_nombre, esProveedor: true,
          });
          cacheNuevos.set(f.tercero_numero_id, terceroId);
        }
      } else throw new Error(`tercero_modo inválido: ${f.tercero_modo}`);

      const obsBase = f.observaciones ? `${f.observaciones} ` : '';
      const gastoData = {
        fechaGasto: f.fecha, concepto: f.concepto, tipoGasto: f.tipo_gasto, valor: Number(f.valor),
        metodoPago: 'Efectivo', tipoOperacion: 'Compra directa', terceroId,
        observaciones: `${obsBase}${marca}`,
      };
      const gastoId = gastoService.create(gastoData, USUARIO_IMPORT);
      auditoria.registrar({ usuarioId: USUARIO_IMPORT, accion: 'create', tabla: 'gastos', registroId: gastoId, datosNuevos: JSON.stringify(gastoData) });

      insertadas++;
      log.push({ fila: f.fila_excel, estado: 'INSERTADA', gastoId, terceroId });
    } catch (e) {
      errores++;
      log.push({ fila: f.fila_excel, estado: 'ERROR', mensaje: e.message });
    }
  }

  return { insertadas, yaImportadas, errores, log };
}

module.exports = { ejecutarCommit, marcador };

// --- CLI ---
if (require.main === module) {
  const DatabaseService = require('../../src/database/DatabaseService');
  const hoja = process.argv[2];
  if (!hoja) { console.error('Uso: commit.js <hoja: 2022..2026>'); process.exit(1); }
  const raizProyecto = path.join(__dirname, '..', '..');
  const dbService = new DatabaseService(raizProyecto);
  dbService.initialize();

  // Backup en caliente antes de escribir.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(raizProyecto, 'backups_automaticos');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `pre_import_gastos_${hoja}_${stamp}.db`);
  dbService.backup(backupPath).then(() => {
    console.log(`Backup: ${backupPath}`);
    const csvPath = path.join(__dirname, 'output', `${hoja}-preview.csv`);
    const r = ejecutarCommit({ csvPath, dbService });
    const logPath = path.join(__dirname, 'output', `${hoja}-commit-log.json`);
    fs.writeFileSync(logPath, JSON.stringify(r, null, 2), 'utf8');
    console.log(`Commit ${hoja}: insertadas ${r.insertadas} | ya importadas ${r.yaImportadas} | errores ${r.errores}`);
    console.log(`Log: ${logPath}`);
    dbService.close();
  }).catch((e) => { console.error(e); dbService.close(); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" --test --test-reporter=spec scripts/import-gastos/commit.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npm test`
Expected: todos los tests del repo en verde (incluidos los 9 nuevos archivos).

- [ ] **Step 6: Commit**

```bash
git add scripts/import-gastos/commit.js scripts/import-gastos/commit.test.js
git commit -m "feat(import-gastos): commit.js escribe gastos vía servicios reales con backup e idempotencia"
```

---

## Operación (tras construir la herramienta — se hace contigo, no es parte del build)

Una vez las 9 tasks estén en verde, la carga real es interactiva y por hoja:

1. `node scripts/import-gastos/reconciliar-db.js` (una sola vez): corrige la cédula de Vicencio en la BD real.
2. Por cada hoja en orden `2026, 2025, 2024, 2023, 2022`:
   a. `node scripts/import-gastos/preview.js <hoja>` → genera `output/<hoja>-preview.csv` y `<hoja>-excluidas.csv`.
   b. **Revisión humana**: abrir el CSV, verificar `tipo_gasto`, terceros y sobre todo las filas `REVISAR`; corregir lo necesario, cambiar `accion` a `IMPORTAR` en las que queden bien, dejar en `REVISAR` (o borrar la fila) las que no.
   c. `node scripts/import-gastos/commit.js <hoja>` → backup + escribe las filas `IMPORTAR`; revisar `output/<hoja>-commit-log.json`.
   d. Verificar en la app (o por SQL) que los totales de la hoja cuadran antes de pasar a la siguiente.
3. Las filas ambiguas de 2023 (sección "RETIROS DE LA CUENTA", valores vacíos) y el préstamo de Alberto Arciniegas se cargan a mano por el formulario si el usuario lo decide.

(Los comandos `node ...` reales se ejecutan vía el runner de Electron: `ELECTRON_RUN_AS_NODE=1 "$ELECTRON" scripts/import-gastos/<script>.js ...`.)

## Self-Review

- **Cobertura del spec**: mapeo por hoja (T1), exclusiones/fecha (T3/T4), CSV (T2), canónicos+reconciliación (T5/T7), clasificación tipo_gasto + resolución de tercero incl. NIT sin DV, No informado id=1, match por nombre (T6), preview con acción REVISAR (T8), commit con preflight de saldo, idempotencia por marcador, auditoría usuario=1, backup (T9). ✅
- **Sin placeholders**: cada step trae código y comando reales. ✅
- **Consistencia de tipos/nombres**: `clasificarFila`, `leerHoja`, `resolverTercero` (`modo`/`terceroId`/`terceroIdSugerido`/`numeroIdentificacion`), `COLUMNAS`, `marcador(hoja, filaExcel)`, `ejecutarCommit`/`generarPreview` coinciden entre tasks. ✅
