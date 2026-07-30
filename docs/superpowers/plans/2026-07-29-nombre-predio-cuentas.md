# Nombre de Predio en Cuentas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un campo opcional `nombre_predio` (ej. "Finca La Esperanza") a `cuentas`, buscable desde el listado de Cuentas, visible en el formulario/listado/detalle, e incluido en el reporte "Cuentas".

**Architecture:** Sigue el patrón existente Migración → Repository → Renderer, extendiendo archivos ya existentes con una columna nueva (nunca reemplazando nada). No hay cambios de Service (campo opcional, sin reglas de negocio) ni de IPC (los canales `cuentas:*` ya pasan objetos genéricos de un lado a otro).

**Tech Stack:** Electron 38, better-sqlite3, JS vanilla (renderer), `node:test`/`node:assert` (vía `npm test`, que ejecuta `electron --test` con `ELECTRON_RUN_AS_NODE=1`).

## Global Constraints

- La columna nueva es `TEXT` y **nullable** — ninguna cuenta existente debe requerir backfill ni romperse.
- `nombre_predio` es 100% opcional, sin validación de formato ni de unicidad (igual que `observaciones`) — no se toca `CuentaService.js`.
- No se rediseña el modelo de propietarios (una cuenta sigue teniendo un único propietario activo a la vez) — eso quedó explícitamente fuera de alcance.
- No se agrega historial de `nombre_predio` a través del tiempo (no es un dato versionado como categoría/propietario).
- Migraciones nunca se editan después de mergeadas — la nueva es `036_nombre_predio_cuentas.sql` (la última existente es `035_admin_recuperacion.sql`).
- Spec completa: `docs/superpowers/specs/2026-07-29-nombre-predio-cuentas-design.md`.

---

### Task 1: Migración 036 — columna `nombre_predio` en `cuentas`

**Files:**
- Create: `src/database/migrations/036_nombre_predio_cuentas.sql`
- Test: `src/database/migrations/036_nombre_predio_cuentas.test.js`

**Interfaces:**
- Consumes: nada (primera pieza del feature).
- Produces: columna `nombre_predio` (`TEXT`, nullable) en la tabla `cuentas`. Task 2 la usa por nombre exacto.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/database/migrations/036_nombre_predio_cuentas.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

test('la migración 036 agrega la columna nombre_predio a cuentas, opcional', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const columnas = db.prepare(`PRAGMA table_info(cuentas)`).all().map(c => c.name);

    assert.ok(columnas.includes('nombre_predio'), 'falta nombre_predio');

    // Un INSERT sin la columna nueva no debe fallar por NOT NULL: debe admitir NULL.
    const result = db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('C-TEST-036', 'Dirección de prueba')`).run();
    const fila = db.prepare(`SELECT * FROM cuentas WHERE id = ?`).get(result.lastInsertRowid);

    assert.equal(fila.nombre_predio, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL en `036_nombre_predio_cuentas.test.js` porque el archivo de migración `036_nombre_predio_cuentas.sql` todavía no existe (o porque la columna no existe en `cuentas`).

- [ ] **Step 3: Crear la migración**

Crear `src/database/migrations/036_nombre_predio_cuentas.sql`:

```sql
-- Nombre propio del predio (ej. "Finca La Esperanza"), distinto de la dirección: varios
-- propietarios identifican su predio por este nombre y no siempre coincide con la dirección
-- registrada. Opcional: no todos los predios tienen uno (ej. una tienda del pueblo).
ALTER TABLE cuentas ADD COLUMN nombre_predio TEXT;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS — `la migración 036 agrega la columna nombre_predio a cuentas, opcional` aparece en verde en el reporter.

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/036_nombre_predio_cuentas.sql src/database/migrations/036_nombre_predio_cuentas.test.js
git commit -m "feat(cuentas): agregar columna nombre_predio"
```

---

### Task 2: `CuentaRepository` — guardar, leer y buscar por `nombre_predio`

**Files:**
- Modify: `src/repositories/CuentaRepository.js:6-84` (método `findAll`)
- Modify: `src/repositories/CuentaRepository.js:107-137` (método `create`)
- Modify: `src/repositories/CuentaRepository.js:139-158` (método `update`)
- Test: `src/repositories/CuentaRepository.nombrePredio.test.js`

**Interfaces:**
- Consumes: columna de Task 1 (`nombre_predio`).
- Produces: `create(cuenta)` y `update(id, cuenta)` aceptan la clave opcional `nombre_predio` (valor `null` si no viene). `findAll(params)` incluye `nombre_predio` en cada fila y lo cubre el parámetro `search`. `findById(id)` ya la devuelve sin cambios (usa `SELECT c.*`).

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/repositories/CuentaRepository.nombrePredio.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CuentaRepository = require('./CuentaRepository');

function obtenerCategoriaId(dbService) {
  return dbService.getDb().prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;
}

test('create() guarda nombre_predio y findById() lo devuelve', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-300',
      direccion: 'Vereda El Progreso',
      categoria_id: categoriaId,
      nombre_predio: 'Finca La Esperanza'
    });

    const cuenta = repo.findById(cuentaId);
    assert.equal(cuenta.nombre_predio, 'Finca La Esperanza');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() guarda NULL en nombre_predio cuando no se informa', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-301',
      direccion: 'Vereda La Esperanza',
      categoria_id: categoriaId
    });

    const cuenta = repo.findById(cuentaId);
    assert.equal(cuenta.nombre_predio, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('update() actualiza el nombre_predio de una cuenta existente', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-302',
      direccion: 'Vereda San José',
      categoria_id: categoriaId
    });

    repo.update(cuentaId, {
      codigo: 'C-302',
      direccion: 'Vereda San José',
      nombre_predio: 'Finca San José'
    });

    const cuenta = repo.findById(cuentaId);
    assert.equal(cuenta.nombre_predio, 'Finca San José');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('findAll() incluye nombre_predio en cada fila y permite buscar por él', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    repo.create({
      codigo: 'C-303',
      direccion: 'Vereda El Roble',
      categoria_id: categoriaId,
      nombre_predio: 'Finca El Roble'
    });
    repo.create({
      codigo: 'C-304',
      direccion: 'Vereda El Guayabo',
      categoria_id: categoriaId,
      nombre_predio: 'Finca El Guayabo'
    });

    const resultado = repo.findAll({ search: 'Roble' });

    assert.equal(resultado.data.length, 1);
    assert.equal(resultado.data[0].codigo, 'C-303');
    assert.equal(resultado.data[0].nombre_predio, 'Finca El Roble');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — los `assert.equal(cuenta.nombre_predio, ...)` fallan porque `create`/`update`/`findAll` todavía no leen ni escriben esa columna (queda `undefined`), y la búsqueda por "Roble" devuelve 0 filas.

- [ ] **Step 3: Implementar el cambio en `CuentaRepository.js`**

Reemplazar el método `findAll` completo (actualmente `src/repositories/CuentaRepository.js:6-84`):

```js
  findAll(params = {}) {
    const { page = 1, limit = 10, search = '', estado = '', categoria = '' } = params;
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        c.id,
        c.codigo,
        c.direccion,
        c.nombre_predio,
        c.estado,
        c.observaciones,
        c.fecha_creacion,
        c.fecha_actualizacion,
        cat.nombre as categoria_actual,
        p.nombre_completo as propietario_actual
      FROM cuentas c
      LEFT JOIN cuenta_categorias cc ON cc.cuenta_id = c.id AND cc.fecha_fin IS NULL
      LEFT JOIN categorias cat ON cat.id = cc.categoria_id
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      WHERE 1=1
    `;
    const queryParams = [];

    // La búsqueda cubre código, dirección, nombre de predio, y el nombre/identificación de
    // CUALQUIER propietario que haya tenido la cuenta (actual o histórico): en la práctica la
    // gente rara vez recuerda su código, a veces no sabe si la cuenta sigue a nombre del
    // propietario anterior, y a veces solo tiene la cédula a mano.
    const condicionBusqueda = `(
      c.codigo LIKE ? OR c.direccion LIKE ? OR c.nombre_predio LIKE ? OR EXISTS (
        SELECT 1 FROM cuenta_propietarios cp2
        INNER JOIN propietarios p2 ON p2.id = cp2.propietario_id
        WHERE cp2.cuenta_id = c.id
          AND (p2.nombre_completo LIKE ? OR p2.numero_identificacion LIKE ?)
      )
    )`;

    if (search) {
      query += ` AND ${condicionBusqueda}`;
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (estado) {
      query += ' AND c.estado = ?';
      queryParams.push(estado);
    }

    if (categoria) {
      query += ' AND cat.nombre = ?';
      queryParams.push(categoria);
    }

    const countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM cuentas c
      LEFT JOIN cuenta_categorias cc ON cc.cuenta_id = c.id AND cc.fecha_fin IS NULL
      LEFT JOIN categorias cat ON cat.id = cc.categoria_id
      WHERE 1=1
      ${search ? ` AND ${condicionBusqueda}` : ''}
      ${estado ? ' AND c.estado = ?' : ''}
      ${categoria ? ' AND cat.nombre = ?' : ''}
    `;
    const total = this.db.prepare(countQuery).get(...queryParams).total;

    query += ' ORDER BY c.id DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const cuentas = this.db.prepare(query).all(...queryParams);

    return {
      data: cuentas,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }
```

Reemplazar el método `create` completo (actualmente `src/repositories/CuentaRepository.js:107-137`):

```js
  create(cuenta) {
    const ejecutar = this.db.transaction(() => {
      const result = this.db.prepare(`
        INSERT INTO cuentas (codigo, direccion, nombre_predio, estado, observaciones, lat_acometida, lon_acometida, lat_vivienda, lon_vivienda)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cuenta.codigo,
        cuenta.direccion,
        cuenta.nombre_predio || null,
        cuenta.estado || 'Activo',
        cuenta.observaciones || null,
        cuenta.lat_acometida ?? null,
        cuenta.lon_acometida ?? null,
        cuenta.lat_vivienda ?? null,
        cuenta.lon_vivienda ?? null
      );

      const cuentaId = result.lastInsertRowid;

      // Toda cuenta nueva inicia con un historial de categoría. Por defecto desde hoy, pero
      // puede indicarse una fecha pasada (ej. cuenta que ya existía antes de usar el sistema)
      // para poder cobrar retroactivamente meses anteriores a la fecha de registro en el sistema.
      this.db.prepare(`
        INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio)
        VALUES (?, ?, ?)
      `).run(cuentaId, cuenta.categoria_id, cuenta.categoria_fecha_inicio || new Date().toISOString().split('T')[0]);

      return cuentaId;
    });

    return ejecutar();
  }
```

Reemplazar el método `update` completo (actualmente `src/repositories/CuentaRepository.js:139-158`):

```js
  update(id, cuenta) {
    const stmt = this.db.prepare(`
      UPDATE cuentas
      SET codigo = ?, direccion = ?, nombre_predio = ?, observaciones = ?,
          lat_acometida = ?, lon_acometida = ?, lat_vivienda = ?, lon_vivienda = ?,
          fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(
      cuenta.codigo,
      cuenta.direccion,
      cuenta.nombre_predio || null,
      cuenta.observaciones || null,
      cuenta.lat_acometida ?? null,
      cuenta.lon_acometida ?? null,
      cuenta.lat_vivienda ?? null,
      cuenta.lon_vivienda ?? null,
      id
    );
  }
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS — los 4 tests de `CuentaRepository.nombrePredio.test.js` en verde, y el resto de la suite (incluyendo `CuentaRepository.coordenadas.test.js`) sigue en verde.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/CuentaRepository.js src/repositories/CuentaRepository.nombrePredio.test.js
git commit -m "feat(cuentas): persistir y buscar por nombre_predio en CuentaRepository"
```

---

### Task 3: Formulario de Cuenta — captura de `nombre_predio`

**Files:**
- Modify: `src/renderer/js/cuentas.js` (`showFormModal` y `saveCuenta`)

**Interfaces:**
- Consumes: nada nuevo de otras tareas (el formulario ya envía `formData` a `window.api.cuentas.create`/`update`, cuyo backend ya acepta `nombre_predio` desde Task 2).
- Produces: el payload enviado por `saveCuenta` incluye `nombre_predio`.

No hay test automatizado para este paso: no existe arnés de pruebas de UI/DOM en este proyecto (ningún archivo bajo `src/renderer/` tiene test). Se verifica manualmente ejecutando la app.

- [ ] **Step 1: Agregar el campo al formulario**

En `src/renderer/js/cuentas.js`, dentro de `showFormModal`, el inicio del `<form id="cuentaForm">` actual es (`src/renderer/js/cuentas.js:521-531`):

```html
      <form id="cuentaForm">
        <div class="form-group">
          <label for="codigo">Código <span style="color: #ef4444;">*</span></label>
          <input type="text" id="codigo" name="codigo" value="${cuenta ? cuenta.codigo : ''}" required>
          <small style="color: #64748b; font-size: 0.875rem;">Código manual único de la cuenta</small>
        </div>

        <div class="form-group">
          <label for="direccion">Dirección <span style="color: #ef4444;">*</span></label>
          <input type="text" id="direccion" name="direccion" value="${cuenta ? cuenta.direccion : ''}" required>
        </div>
```

Reemplazarlo por (agrega el campo `nombre_predio` justo después de Dirección):

```html
      <form id="cuentaForm">
        <div class="form-group">
          <label for="codigo">Código <span style="color: #ef4444;">*</span></label>
          <input type="text" id="codigo" name="codigo" value="${cuenta ? cuenta.codigo : ''}" required>
          <small style="color: #64748b; font-size: 0.875rem;">Código manual único de la cuenta</small>
        </div>

        <div class="form-group">
          <label for="direccion">Dirección <span style="color: #ef4444;">*</span></label>
          <input type="text" id="direccion" name="direccion" value="${cuenta ? cuenta.direccion : ''}" required>
        </div>

        <div class="form-group">
          <label for="nombre_predio">Nombre de Predio (opcional)</label>
          <input type="text" id="nombre_predio" name="nombre_predio" value="${cuenta?.nombre_predio ?? ''}" placeholder="Ej. Finca La Esperanza">
        </div>
```

- [ ] **Step 2: Leer el campo en `saveCuenta`**

En `src/renderer/js/cuentas.js`, el inicio de `saveCuenta(id)` actual (`src/renderer/js/cuentas.js:718-723`) es:

```js
  async saveCuenta(id) {
    const formData = {
      codigo: document.getElementById('codigo').value.trim(),
      direccion: document.getElementById('direccion').value.trim(),
      observaciones: document.getElementById('observaciones').value.trim()
    };
```

Reemplazarlo por (agrega `nombre_predio` a `formData`):

```js
  async saveCuenta(id) {
    const formData = {
      codigo: document.getElementById('codigo').value.trim(),
      direccion: document.getElementById('direccion').value.trim(),
      nombre_predio: document.getElementById('nombre_predio').value.trim(),
      observaciones: document.getElementById('observaciones').value.trim()
    };
```

- [ ] **Step 3: Verificación manual**

Run: `npm start`

1. Inicia sesión, ve a **Cuentas → + Nueva Cuenta**.
2. Confirma que aparece el campo "Nombre de Predio (opcional)" justo después de Dirección.
3. Llena Código, Dirección, Nombre de Predio ("Finca La Esperanza"), Categoría, y guarda. Debe crearse sin error.
4. Vuelve a editarla (botón "Editar"): confirma que "Finca La Esperanza" aparece precargado en el campo.
5. Edítala dejando el campo vacío y guarda: confirma que no da error (el campo es opcional) y que al reabrir el formulario de edición el campo queda vacío.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/js/cuentas.js
git commit -m "feat(cuentas): capturar nombre_predio en el formulario"
```

---

### Task 4: Listado de Cuentas — columna `nombre_predio`

**Files:**
- Modify: `src/renderer/js/cuentas.js` (`renderTable`)

**Interfaces:**
- Consumes: `nombre_predio` que ya viene en cada fila devuelta por `CuentaRepository.findAll` (Task 2).
- Produces: nada consumido por otras tareas.

No hay test automatizado para este paso (mismo motivo que Task 3). Se verifica manualmente.

- [ ] **Step 1: Agregar la columna a la tabla**

En `src/renderer/js/cuentas.js`, dentro de `renderTable`, el `<thead>` y la fila de cada cuenta actuales son (`src/renderer/js/cuentas.js:132-166`):

```html
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Dirección</th>
            <th>Propietario</th>
            <th>Categoría</th>
            <th>Estado</th>
            <th>Fecha Creación</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(cuenta => `
            <tr>
              <td><strong>${cuenta.codigo}</strong></td>
              <td>${cuenta.direccion}</td>
              <td>${cuenta.propietario_actual || '<em>Sin asignar</em>'}</td>
              <td>${cuenta.categoria_actual || '<em>Sin asignar</em>'}</td>
              <td><span class="badge badge-${cuenta.estado.toLowerCase()}">${cuenta.estado}</span></td>
              <td>${this.formatDate(cuenta.fecha_creacion)}</td>
              <td>
```

Reemplazarlo por (agrega la columna "Nombre de Predio" junto a Dirección):

```html
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Dirección</th>
            <th>Nombre de Predio</th>
            <th>Propietario</th>
            <th>Categoría</th>
            <th>Estado</th>
            <th>Fecha Creación</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(cuenta => `
            <tr>
              <td><strong>${cuenta.codigo}</strong></td>
              <td>${cuenta.direccion}</td>
              <td>${cuenta.nombre_predio || '-'}</td>
              <td>${cuenta.propietario_actual || '<em>Sin asignar</em>'}</td>
              <td>${cuenta.categoria_actual || '<em>Sin asignar</em>'}</td>
              <td><span class="badge badge-${cuenta.estado.toLowerCase()}">${cuenta.estado}</span></td>
              <td>${this.formatDate(cuenta.fecha_creacion)}</td>
              <td>
```

- [ ] **Step 2: Verificación manual**

Run: `npm start`

1. Ve a **Cuentas**. Confirma que la columna "Nombre de Predio" aparece junto a Dirección.
2. La cuenta creada en Task 3 con "Finca La Esperanza" debe mostrar ese valor en la columna.
3. Una cuenta sin nombre de predio (ej. una anterior a este trabajo) debe mostrar `-` en esa columna, sin romper el resto de la fila.
4. Usa el buscador con el texto "Esperanza": debe aparecer esa cuenta en los resultados (confirma la búsqueda de Task 2 end-to-end).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/js/cuentas.js
git commit -m "feat(cuentas): mostrar nombre_predio en el listado de Cuentas"
```

---

### Task 5: Detalle de Cuenta — mostrar `nombre_predio`

**Files:**
- Modify: `src/renderer/js/cuentas.js` (`showDetailModal`)

**Interfaces:**
- Consumes: `nombre_predio` que ya viene en el objeto devuelto por `CuentaRepository.findById` (Task 2, sin cambios porque usa `SELECT c.*`).
- Produces: nada consumido por otras tareas (es la última pieza visible de UI).

No hay test automatizado para este paso (mismo motivo que Task 3). Se verifica manualmente.

- [ ] **Step 1: Agregar la fila al detalle**

En `src/renderer/js/cuentas.js`, dentro de `showDetailModal`, la sección "Información General" actual empieza así (`src/renderer/js/cuentas.js:212-221`):

```html
          <div class="detail-section">
            <h3>Información General</h3>
            <div class="detail-row">
              <div class="detail-label">Código:</div>
              <div class="detail-value"><strong>${cuenta.codigo}</strong></div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Dirección:</div>
              <div class="detail-value">${cuenta.direccion}</div>
            </div>
```

Reemplazarlo por (agrega la fila "Nombre de Predio" justo después de Dirección):

```html
          <div class="detail-section">
            <h3>Información General</h3>
            <div class="detail-row">
              <div class="detail-label">Código:</div>
              <div class="detail-value"><strong>${cuenta.codigo}</strong></div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Dirección:</div>
              <div class="detail-value">${cuenta.direccion}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Nombre de Predio:</div>
              <div class="detail-value">${cuenta.nombre_predio || '<em>Sin registrar</em>'}</div>
            </div>
```

- [ ] **Step 2: Verificación manual**

Run: `npm start`

1. Abre el detalle (botón "Ver") de la cuenta con "Finca La Esperanza": confirma que aparece esa fila con el valor correcto, entre Dirección y Propietario Actual.
2. Abre el detalle de una cuenta sin nombre de predio: confirma que muestra "Sin registrar" sin romper el resto del detalle.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/js/cuentas.js
git commit -m "feat(cuentas): mostrar nombre_predio en el detalle de cuenta"
```

---

### Task 6: Reporte "Cuentas" — incluir `nombre_predio`

**Files:**
- Modify: `src/repositories/ReporteRepository.js:16-35` (`getCuentas`)
- Modify: `src/services/ReporteService.js:83-104` (`reporteCuentas`)
- Modify: `src/services/ReporteService.cuentas.test.js` (agregar un test nuevo al archivo existente)

**Interfaces:**
- Consumes: columna de Task 1 y `CuentaRepository.create` de Task 2 (para sembrar una cuenta de prueba con `nombre_predio`).
- Produces: `ReporteRepository.getCuentas(estado)` incluye `nombre_predio` en cada fila. `ReporteService.reporteCuentas({estado})` incluye esa clave en `columnas`. Como `PlantillaReporteService` reutiliza `{columnas, filas}` para pantalla, PDF y Excel, ningún otro archivo necesita cambios.

- [ ] **Step 1: Escribir el test que falla**

En `src/services/ReporteService.cuentas.test.js`, el archivo actual termina así:

```js
    const fila = reporte.filas.find(f => f.codigo === 'C-200');
    assert.equal(fila.lat_acometida, 4.1);
    assert.equal(fila.lon_acometida, -74.1);
    assert.equal(fila.lat_vivienda, 4.2);
    assert.equal(fila.lon_vivienda, -74.2);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

Agregar, al final del archivo (después de ese `});` que cierra el test existente), un nuevo test:

```js

test('reporteCuentas() incluye el nombre de predio, en columnas y filas', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaRepo = new CuentaRepository(ctx.dbService);
    const categoriaId = ctx.dbService.getDb().prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;

    cuentaRepo.create({
      codigo: 'C-201',
      direccion: 'Vereda El Guayabo',
      categoria_id: categoriaId,
      nombre_predio: 'Finca El Guayabo'
    });

    const service = new ReporteService(ctx.dbService);
    const reporte = service.reporteCuentas({});

    const keysColumnas = reporte.columnas.map(c => c.key);
    assert.ok(keysColumnas.includes('nombre_predio'));

    const fila = reporte.filas.find(f => f.codigo === 'C-201');
    assert.equal(fila.nombre_predio, 'Finca El Guayabo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL — `keysColumnas.includes('nombre_predio')` es `false` y/o `fila.nombre_predio` es `undefined`, porque ni el `SELECT` ni la definición de `columnas` incluyen todavía ese campo.

- [ ] **Step 3: Agregar la columna al `SELECT` de `ReporteRepository.getCuentas`**

En `src/repositories/ReporteRepository.js:16-35`, el método actual es:

```js
  getCuentas(estado = '') {
    let query = `
      SELECT c.codigo, c.direccion, cat.nombre as categoria, p.nombre_completo as propietario,
             c.estado, c.fecha_creacion,
             c.lat_acometida, c.lon_acometida, c.lat_vivienda, c.lon_vivienda
      FROM cuentas c
      LEFT JOIN cuenta_categorias cc ON cc.cuenta_id = c.id AND cc.fecha_fin IS NULL
      LEFT JOIN categorias cat ON cat.id = cc.categoria_id
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      WHERE 1=1
    `;
    const params = [];
    if (estado) {
      query += ' AND c.estado = ?';
      params.push(estado);
    }
    query += ' ORDER BY c.codigo ASC';
    return this.db.prepare(query).all(...params);
  }
```

Reemplazarlo por (agrega `c.nombre_predio` al `SELECT`, sin tocar el resto):

```js
  getCuentas(estado = '') {
    let query = `
      SELECT c.codigo, c.direccion, c.nombre_predio, cat.nombre as categoria, p.nombre_completo as propietario,
             c.estado, c.fecha_creacion,
             c.lat_acometida, c.lon_acometida, c.lat_vivienda, c.lon_vivienda
      FROM cuentas c
      LEFT JOIN cuenta_categorias cc ON cc.cuenta_id = c.id AND cc.fecha_fin IS NULL
      LEFT JOIN categorias cat ON cat.id = cc.categoria_id
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      WHERE 1=1
    `;
    const params = [];
    if (estado) {
      query += ' AND c.estado = ?';
      params.push(estado);
    }
    query += ' ORDER BY c.codigo ASC';
    return this.db.prepare(query).all(...params);
  }
```

- [ ] **Step 4: Agregar la columna a `ReporteService.reporteCuentas`**

En `src/services/ReporteService.js:83-104`, el método actual es:

```js
  reporteCuentas({ estado = '' } = {}) {
    const filas = this.repository.getCuentas(estado);
    return {
      tipo: 'tabla',
      titulo: estado ? `Cuentas ${estado}s` : 'Todas las Cuentas',
      periodo: null,
      filtros: estado ? [{ label: 'Estado', valor: estado }] : [],
      columnas: [
        { key: 'codigo', label: 'Código' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'categoria', label: 'Categoría' },
        { key: 'propietario', label: 'Propietario' },
        { key: 'estado', label: 'Estado' },
        { key: 'fecha_creacion', label: 'Fecha Creación', tipo: 'fecha' },
        { key: 'lat_acometida', label: 'Latitud Acometida' },
        { key: 'lon_acometida', label: 'Longitud Acometida' },
        { key: 'lat_vivienda', label: 'Latitud Vivienda' },
        { key: 'lon_vivienda', label: 'Longitud Vivienda' }
      ],
      filas
    };
  }
```

Reemplazarlo por (agrega `nombre_predio` junto a `direccion`):

```js
  reporteCuentas({ estado = '' } = {}) {
    const filas = this.repository.getCuentas(estado);
    return {
      tipo: 'tabla',
      titulo: estado ? `Cuentas ${estado}s` : 'Todas las Cuentas',
      periodo: null,
      filtros: estado ? [{ label: 'Estado', valor: estado }] : [],
      columnas: [
        { key: 'codigo', label: 'Código' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'nombre_predio', label: 'Nombre de Predio' },
        { key: 'categoria', label: 'Categoría' },
        { key: 'propietario', label: 'Propietario' },
        { key: 'estado', label: 'Estado' },
        { key: 'fecha_creacion', label: 'Fecha Creación', tipo: 'fecha' },
        { key: 'lat_acometida', label: 'Latitud Acometida' },
        { key: 'lon_acometida', label: 'Longitud Acometida' },
        { key: 'lat_vivienda', label: 'Latitud Vivienda' },
        { key: 'lon_vivienda', label: 'Longitud Vivienda' }
      ],
      filas
    };
  }
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS — `reporteCuentas() incluye el nombre de predio, en columnas y filas` en verde, y el test existente de coordenadas en el mismo archivo sigue en verde.

- [ ] **Step 6: Verificación manual del PDF/Excel**

Run: `npm start`

1. Inicia sesión, ve a **Reportes → Cuentas**, genera la vista previa: confirma que aparece la columna "Nombre de Predio" junto a Dirección.
2. Exporta a Excel (botón correspondiente) y abre el archivo: confirma que la columna nueva está presente con su encabezado y el valor correcto para la cuenta de prueba.

- [ ] **Step 7: Commit**

```bash
git add src/repositories/ReporteRepository.js src/services/ReporteService.js src/services/ReporteService.cuentas.test.js
git commit -m "feat(reportes): incluir nombre_predio en el reporte de Cuentas"
```

---

## Resumen de verificación final

Después de completar las 6 tareas:

- [ ] `npm test` corre sin fallos (suite completa).
- [ ] Flujo manual completo: crear una cuenta nueva con Nombre de Predio → editarla → verla en el listado y en el detalle → buscarla por su nombre de predio en el buscador de Cuentas → generar el reporte de Cuentas y confirmar la columna nueva en pantalla y en el Excel exportado.
- [ ] Una cuenta ya existente (de antes de este trabajo, sin nombre de predio) se sigue viendo y editando sin errores, mostrando `-` en el listado y "Sin registrar" en el detalle.
