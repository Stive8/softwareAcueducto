# Coordenadas GPS en Cuentas (acometida y vivienda) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar dos coordenadas GPS opcionales por cuenta (acometida = punto de conexión del agua, y vivienda = punto de la casa del lote) al modelo de datos, al formulario y al detalle de Cuentas, y al reporte "Cuentas y Propietarios".

**Architecture:** Sigue el patrón existente Migración → Repository → Service → IPC (`main.js`/`preload.js`) → Renderer, extendiendo archivos ya existentes con columnas/campos nuevos (nunca reemplazando nada). Se agrega un único canal IPC genérico nuevo (`sistema:abrirEnlaceExterno`) porque el renderer de Electron no puede abrir un navegador externo por sí mismo.

**Tech Stack:** Electron 38, better-sqlite3, JS vanilla (renderer), `node:test`/`node:assert` (vía `npm test`, que ejecuta `electron --test` con `ELECTRON_RUN_AS_NODE=1`).

## Global Constraints

- Todas las columnas nuevas son `REAL` y **nullable** — ninguna cuenta existente debe requerir backfill ni romperse.
- No se agrega ningún mapa interactivo ni librería de mapas — solo un enlace externo a Google Maps vía `shell.openExternal`.
- No se toca `nuevos_puntos`, `plan_cuentas`, ni ningún dato de Modo de Pruebas/`DevToolsService`.
- Captura por 2 campos numéricos separados (latitud, longitud) por punto — no un solo campo de texto libre a parsear.
- Validación de coordenadas: pareja completa o ninguna (no se permite media coordenada); rango genérico lat `[-90, 90]` / lon `[-180, 180]`; rango adicional de Colombia lat `[-4.3, 13.5]` / lon `[-82, -66]` para atrapar lat/lon invertidos.
- Nomenclatura: columnas/variables usan `acometida` (no `conexion`, que ya significa "cargo financiero de Nuevo Punto" en este código) y `vivienda`.
- Migraciones nunca se editan después de mergeadas — la nueva es `034_coordenadas_cuentas.sql` (la última existente es `033_periodo_bloqueo_anterior.sql`).
- Spec completa: `docs/superpowers/specs/2026-07-16-coordenadas-cuentas-design.md`.

---

### Task 1: Migración 034 — columnas de coordenadas en `cuentas`

**Files:**
- Create: `src/database/migrations/034_coordenadas_cuentas.sql`
- Test: `src/database/migrations/034_coordenadas_cuentas.test.js`

**Interfaces:**
- Consumes: nada (primera pieza del feature).
- Produces: columnas `lat_acometida`, `lon_acometida`, `lat_vivienda`, `lon_vivienda` (todas `REAL`, nullable) en la tabla `cuentas`. Tareas siguientes (Repository) las usan por nombre exacto.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/database/migrations/034_coordenadas_cuentas.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

test('la migración 034 agrega las columnas de coordenadas a cuentas, todas opcionales', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const columnas = db.prepare(`PRAGMA table_info(cuentas)`).all().map(c => c.name);

    assert.ok(columnas.includes('lat_acometida'), 'falta lat_acometida');
    assert.ok(columnas.includes('lon_acometida'), 'falta lon_acometida');
    assert.ok(columnas.includes('lat_vivienda'), 'falta lat_vivienda');
    assert.ok(columnas.includes('lon_vivienda'), 'falta lon_vivienda');

    // Un INSERT sin las columnas nuevas no debe fallar por NOT NULL: deben admitir NULL.
    const result = db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('C-TEST-034', 'Dirección de prueba')`).run();
    const fila = db.prepare(`SELECT * FROM cuentas WHERE id = ?`).get(result.lastInsertRowid);

    assert.equal(fila.lat_acometida, null);
    assert.equal(fila.lon_acometida, null);
    assert.equal(fila.lat_vivienda, null);
    assert.equal(fila.lon_vivienda, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL en `034_coordenadas_cuentas.test.js` porque el archivo de migración `034_coordenadas_cuentas.sql` todavía no existe (o porque las columnas no existen en `cuentas`).

- [ ] **Step 3: Crear la migración**

Crear `src/database/migrations/034_coordenadas_cuentas.sql`:

```sql
-- Coordenadas GPS de la cuenta: dos puntos porque la acometida (punto de conexión del agua) y
-- la vivienda a veces no coinciden dentro del mismo lote. Ambas parejas son opcionales; no todas
-- las cuentas van a tener este dato de inmediato.
ALTER TABLE cuentas ADD COLUMN lat_acometida REAL;
ALTER TABLE cuentas ADD COLUMN lon_acometida REAL;
ALTER TABLE cuentas ADD COLUMN lat_vivienda REAL;
ALTER TABLE cuentas ADD COLUMN lon_vivienda REAL;
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS — `la migración 034 agrega las columnas de coordenadas a cuentas, todas opcionales` aparece en verde en el reporter.

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/034_coordenadas_cuentas.sql src/database/migrations/034_coordenadas_cuentas.test.js
git commit -m "feat(cuentas): agregar columnas de coordenadas GPS de acometida y vivienda"
```

---

### Task 2: `CuentaRepository` — guardar y leer las coordenadas

**Files:**
- Modify: `src/repositories/CuentaRepository.js:107-149` (métodos `create` y `update`)
- Test: `src/repositories/CuentaRepository.coordenadas.test.js`

**Interfaces:**
- Consumes: columnas de Task 1 (`lat_acometida`, `lon_acometida`, `lat_vivienda`, `lon_vivienda`).
- Produces: `create(cuenta)` y `update(id, cuenta)` aceptan esas 4 claves opcionales en el objeto `cuenta` (valor `null` si no vienen). `findById(id)` ya las devuelve sin cambios (usa `SELECT c.*`).

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/repositories/CuentaRepository.coordenadas.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CuentaRepository = require('./CuentaRepository');

function obtenerCategoriaId(dbService) {
  return dbService.getDb().prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;
}

test('create() guarda las coordenadas de acometida y vivienda, y findById() las devuelve', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-001',
      direccion: 'Vereda El Progreso',
      categoria_id: categoriaId,
      lat_acometida: 4.60971,
      lon_acometida: -74.08175,
      lat_vivienda: 4.60980,
      lon_vivienda: -74.08190
    });

    const cuenta = repo.findById(cuentaId);

    assert.equal(cuenta.lat_acometida, 4.60971);
    assert.equal(cuenta.lon_acometida, -74.08175);
    assert.equal(cuenta.lat_vivienda, 4.60980);
    assert.equal(cuenta.lon_vivienda, -74.08190);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() guarda NULL en las coordenadas cuando no se informan', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-002',
      direccion: 'Vereda La Esperanza',
      categoria_id: categoriaId
    });

    const cuenta = repo.findById(cuentaId);

    assert.equal(cuenta.lat_acometida, null);
    assert.equal(cuenta.lon_acometida, null);
    assert.equal(cuenta.lat_vivienda, null);
    assert.equal(cuenta.lon_vivienda, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('update() actualiza las coordenadas de una cuenta existente', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new CuentaRepository(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const cuentaId = repo.create({
      codigo: 'C-003',
      direccion: 'Vereda San José',
      categoria_id: categoriaId
    });

    repo.update(cuentaId, {
      codigo: 'C-003',
      direccion: 'Vereda San José',
      lat_acometida: 5.0,
      lon_acometida: -75.0,
      lat_vivienda: 5.0,
      lon_vivienda: -75.0
    });

    const cuenta = repo.findById(cuentaId);
    assert.equal(cuenta.lat_acometida, 5.0);
    assert.equal(cuenta.lon_acometida, -75.0);
    assert.equal(cuenta.lat_vivienda, 5.0);
    assert.equal(cuenta.lon_vivienda, -75.0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — `assert.equal(cuenta.lat_acometida, 4.60971)` falla porque `create`/`update` todavía no insertan/actualizan esas columnas (quedan `undefined`).

- [ ] **Step 3: Implementar el cambio en `CuentaRepository.js`**

Reemplazar el método `create` completo (actualmente `src/repositories/CuentaRepository.js:107-133`):

```js
  create(cuenta) {
    const ejecutar = this.db.transaction(() => {
      const result = this.db.prepare(`
        INSERT INTO cuentas (codigo, direccion, estado, observaciones, lat_acometida, lon_acometida, lat_vivienda, lon_vivienda)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cuenta.codigo,
        cuenta.direccion,
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

Reemplazar el método `update` completo (actualmente `src/repositories/CuentaRepository.js:135-149`):

```js
  update(id, cuenta) {
    const stmt = this.db.prepare(`
      UPDATE cuentas 
      SET codigo = ?, direccion = ?, observaciones = ?,
          lat_acometida = ?, lon_acometida = ?, lat_vivienda = ?, lon_vivienda = ?,
          fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    stmt.run(
      cuenta.codigo,
      cuenta.direccion,
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
Expected: PASS — los 3 tests de `CuentaRepository.coordenadas.test.js` en verde.

- [ ] **Step 5: Commit**

```bash
git add src/repositories/CuentaRepository.js src/repositories/CuentaRepository.coordenadas.test.js
git commit -m "feat(cuentas): persistir coordenadas de acometida y vivienda en CuentaRepository"
```

---

### Task 3: `CuentaService` — validación de coordenadas

**Files:**
- Modify: `src/services/CuentaService.js` (agregar helpers al inicio del archivo, y una línea en `create` y en `update`)
- Test: `src/services/CuentaService.coordenadas.test.js`

**Interfaces:**
- Consumes: `CuentaRepository.create`/`update` de Task 2.
- Produces: `CuentaService.create(cuentaData)` y `CuentaService.update(id, cuentaData)` lanzan `Error` con mensaje descriptivo si las coordenadas son inválidas; no lanzan nada si son válidas o si están completamente vacías.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/CuentaService.coordenadas.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CuentaService = require('./CuentaService');

function obtenerCategoriaId(dbService) {
  return dbService.getDb().prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;
}

function datosBase(categoriaId, codigo) {
  return { codigo, direccion: 'Vereda Test', categoria_id: categoriaId };
}

test('create() permite una cuenta sin ninguna coordenada', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const id = service.create(datosBase(categoriaId, 'C-100'));
    assert.ok(id > 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() permite una cuenta con ambos puntos completos y válidos', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    const id = service.create({
      ...datosBase(categoriaId, 'C-101'),
      lat_acometida: 4.60971, lon_acometida: -74.08175,
      lat_vivienda: 4.60980, lon_vivienda: -74.08190
    });
    assert.ok(id > 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() rechaza cuando solo se informa la latitud de un punto (falta la longitud)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    assert.throws(
      () => service.create({ ...datosBase(categoriaId, 'C-102'), lat_acometida: 4.60971 }),
      /tanto la latitud como la longitud/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() rechaza coordenadas no numéricas', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    assert.throws(
      () => service.create({ ...datosBase(categoriaId, 'C-103'), lat_acometida: 'abc', lon_acometida: -74.0 }),
      /deben ser números/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() rechaza coordenadas fuera del rango genérico de latitud/longitud', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    assert.throws(
      () => service.create({ ...datosBase(categoriaId, 'C-104'), lat_acometida: 200, lon_acometida: -74.0 }),
      /rango válido/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('create() rechaza coordenadas fuera de Colombia (probable lat/lon invertidos)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);

    assert.throws(
      () => service.create({ ...datosBase(categoriaId, 'C-105'), lat_acometida: 40.0, lon_acometida: -74.0 }),
      /fuera de Colombia/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('update() valida las coordenadas igual que create()', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CuentaService(ctx.dbService);
    const categoriaId = obtenerCategoriaId(ctx.dbService);
    const id = service.create(datosBase(categoriaId, 'C-106'));

    assert.throws(
      () => service.update(id, { codigo: 'C-106', direccion: 'Vereda Test', lat_vivienda: 4.6 }),
      /tanto la latitud como la longitud/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test`
Expected: FAIL — los tests de rechazo (`assert.throws`) fallan porque `create`/`update` todavía no lanzan ningún error de validación de coordenadas.

- [ ] **Step 3: Implementar la validación en `CuentaService.js`**

Agregar al inicio de `src/services/CuentaService.js`, justo después de las dos líneas `require` existentes (antes de `class CuentaService`):

```js
// Rango aproximado de Colombia: existe solo para atrapar el error de digitación más común
// (invertir latitud y longitud al copiar desde un mapa), no para validar un polígono exacto.
const COLOMBIA_LAT_MIN = -4.3;
const COLOMBIA_LAT_MAX = 13.5;
const COLOMBIA_LON_MIN = -82;
const COLOMBIA_LON_MAX = -66;

const PARES_COORDENADAS = [
  { lat: 'lat_acometida', lon: 'lon_acometida', etiqueta: 'la acometida' },
  { lat: 'lat_vivienda', lon: 'lon_vivienda', etiqueta: 'la vivienda' }
];

function estaInformado(valor) {
  return valor !== null && valor !== undefined && valor !== '';
}

// Cada pareja (acometida, vivienda) es independiente: o vienen ambas coordenadas completas y
// válidas, o no viene ninguna. Nunca se permite guardar media coordenada.
function validarCoordenadas(cuentaData) {
  for (const { lat, lon, etiqueta } of PARES_COORDENADAS) {
    const tieneLat = estaInformado(cuentaData[lat]);
    const tieneLon = estaInformado(cuentaData[lon]);

    if (!tieneLat && !tieneLon) continue;

    if (tieneLat !== tieneLon) {
      throw new Error(`Debe indicar tanto la latitud como la longitud de ${etiqueta}, o dejar ambas en blanco`);
    }

    const latNum = Number(cuentaData[lat]);
    const lonNum = Number(cuentaData[lon]);

    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
      throw new Error(`Las coordenadas de ${etiqueta} deben ser números`);
    }

    if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      throw new Error(`Las coordenadas de ${etiqueta} están fuera del rango válido de latitud/longitud`);
    }

    if (latNum < COLOMBIA_LAT_MIN || latNum > COLOMBIA_LAT_MAX || lonNum < COLOMBIA_LON_MIN || lonNum > COLOMBIA_LON_MAX) {
      throw new Error(`Las coordenadas de ${etiqueta} parecen estar fuera de Colombia; verifique que la latitud y la longitud no estén invertidas`);
    }
  }
}
```

Luego, en el método `create(cuentaData)` (`src/services/CuentaService.js:29-48`), agregar la validación justo antes del `return this.repository.create(cuentaData);` final:

```js
  create(cuentaData) {
    if (!cuentaData.codigo || !cuentaData.codigo.trim()) {
      throw new Error('El código de cuenta es obligatorio');
    }

    if (!cuentaData.direccion || !cuentaData.direccion.trim()) {
      throw new Error('La dirección es obligatoria');
    }

    if (!cuentaData.categoria_id) {
      throw new Error('La categoría es obligatoria');
    }

    const existente = this.repository.findByCodigo(cuentaData.codigo);
    if (existente) {
      throw new Error('Ya existe una cuenta con ese código');
    }

    validarCoordenadas(cuentaData);

    return this.repository.create(cuentaData);
  }
```

Y en el método `update(id, cuentaData)` (`src/services/CuentaService.js:50-72`), agregar la misma validación justo antes de `this.repository.update(id, cuentaData);`:

```js
  update(id, cuentaData) {
    if (!cuentaData.codigo || !cuentaData.codigo.trim()) {
      throw new Error('El código de cuenta es obligatorio');
    }

    if (!cuentaData.direccion || !cuentaData.direccion.trim()) {
      throw new Error('La dirección es obligatoria');
    }

    const cuenta = this.repository.findById(id);
    if (!cuenta) {
      throw new Error('Cuenta no encontrada');
    }

    if (cuenta.codigo !== cuentaData.codigo) {
      const existente = this.repository.findByCodigo(cuentaData.codigo);
      if (existente) {
        throw new Error('Ya existe otra cuenta con ese código');
      }
    }

    validarCoordenadas(cuentaData);

    this.repository.update(id, cuentaData);
  }
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS — los 7 tests de `CuentaService.coordenadas.test.js` en verde.

- [ ] **Step 5: Commit**

```bash
git add src/services/CuentaService.js src/services/CuentaService.coordenadas.test.js
git commit -m "feat(cuentas): validar coordenadas de acometida y vivienda en CuentaService"
```

---

### Task 4: Canal IPC `sistema:abrirEnlaceExterno`

**Files:**
- Modify: `main.js:1` (require de `electron`), `main.js:117-120` (`CANALES_PERMITIDOS_CONSULTA`), `main.js:2018-2026` (nuevo handler antes del cierre de `setupIpcHandlers`)
- Modify: `preload.js` (nuevo bloque `sistema`, después del bloque `devtools`)

**Interfaces:**
- Consumes: `electron.shell.openExternal` (ya usado en `src/services/CloudBackupService.js:153`, mismo mecanismo, ahora expuesto al renderer).
- Produces: `window.api.sistema.abrirEnlaceExterno(url)` → `Promise<{ success: true } | { success: false, error: string }>`. Lo usa Task 6.

No hay test automatizado para este paso: el proyecto no tiene arnés de pruebas para `main.js`/canales IPC (todos los `*.test.js` existentes prueban `Service`/`Repository` directamente, nunca `ipcMain`). Se verifica manualmente con la consola de DevTools de la app.

- [ ] **Step 1: Agregar `shell` al require de `electron` en `main.js`**

En `main.js:1`, cambiar:

```js
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
```

por:

```js
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
```

- [ ] **Step 2: Permitir este canal para el rol Consulta**

En `main.js:111-120`, el bloque `CANALES_PERMITIDOS_CONSULTA` actual es:

```js
const CANALES_PERMITIDOS_CONSULTA = new Set([
  'cloudBackup:conectar', 'cloudBackup:desconectar', 'cloudBackup:actualizarDesdeNube',
  'cloudBackup:configurarEquipo', 'cloudBackup:actualizarSiHayNuevo'
]);
```

Reemplazarlo por (agrega `sistema:abrirEnlaceExterno` con su propio comentario, sin tocar el comentario de los canales de nube):

```js
const CANALES_PERMITIDOS_CONSULTA = new Set([
  'cloudBackup:conectar', 'cloudBackup:desconectar', 'cloudBackup:actualizarDesdeNube',
  'cloudBackup:configurarEquipo', 'cloudBackup:actualizarSiHayNuevo',
  // Abrir un enlace en el navegador externo no modifica ningún dato del sistema (es
  // funcionalmente una lectura), así que Consulta tampoco debe quedar bloqueado aquí aunque el
  // nombre del canal no empiece por un prefijo de lectura.
  'sistema:abrirEnlaceExterno'
]);
```

- [ ] **Step 3: Registrar el handler en `setupIpcHandlers()`**

En `main.js`, el final de `setupIpcHandlers()` (alrededor de la línea 2018-2027) es:

```js
  // Herramientas de prueba (solo datos de ejemplo, nunca se ejecutan automáticamente)
  envolverHandle('devtools:tieneDatosOperativos', async () => {
    try {
      return { success: true, data: devToolsService.tieneDatosOperativos() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

}
```

Reemplazarlo por (agrega el nuevo handler antes del cierre `}` de la función):

```js
  // Herramientas de prueba (solo datos de ejemplo, nunca se ejecutan automáticamente)
  envolverHandle('devtools:tieneDatosOperativos', async () => {
    try {
      return { success: true, data: devToolsService.tieneDatosOperativos() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Utilidades generales de sistema
  envolverHandle('sistema:abrirEnlaceExterno', async (event, url) => {
    try {
      // Solo se permite https: evita que este canal genérico se use para abrir esquemas
      // arbitrarios (file:, javascript:, etc.) si algún día recibe una URL no controlada.
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
        throw new Error('Enlace externo inválido');
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

}
```

- [ ] **Step 4: Exponer el canal en `preload.js`**

En `preload.js`, el bloque `devtools` actual es:

```js
  devtools: {
    tieneDatosOperativos: () => ipcRenderer.invoke('devtools:tieneDatosOperativos')
  },
  cloudBackup: {
```

Reemplazarlo por (agrega el bloque `sistema` entre `devtools` y `cloudBackup`):

```js
  devtools: {
    tieneDatosOperativos: () => ipcRenderer.invoke('devtools:tieneDatosOperativos')
  },
  sistema: {
    abrirEnlaceExterno: (url) => ipcRenderer.invoke('sistema:abrirEnlaceExterno', url)
  },
  cloudBackup: {
```

- [ ] **Step 5: Verificación manual**

Run: `npm start` (o `npm run dev` para que se abran las DevTools automáticamente; si usas `npm start`, abre las DevTools manualmente con Ctrl+Shift+I una vez cargada la app).

1. Inicia sesión con cualquier usuario.
2. En la consola de DevTools, ejecuta:
   ```js
   await window.api.sistema.abrirEnlaceExterno('https://www.google.com/maps?q=4.6097,-74.0817')
   ```
3. Expected: se abre tu navegador por defecto (Chrome/Edge) en Google Maps sobre ese punto, y la consola muestra `{ success: true }`. La ventana de la app permanece intacta.
4. Ejecuta también `await window.api.sistema.abrirEnlaceExterno('javascript:alert(1)')` y confirma que devuelve `{ success: false, error: 'Enlace externo inválido' }` sin abrir nada.

- [ ] **Step 6: Commit**

```bash
git add main.js preload.js
git commit -m "feat(sistema): agregar canal IPC para abrir enlaces externos desde el renderer"
```

---

### Task 5: Formulario de Cuenta — captura de coordenadas

**Files:**
- Modify: `src/renderer/js/cuentas.js` (`showFormModal` y `saveCuenta`)

**Interfaces:**
- Consumes: nada nuevo de otras tareas (el formulario ya envía `formData` a `window.api.cuentas.create`/`update`, cuyo backend ya acepta las 4 claves desde Task 2/3).
- Produces: el payload enviado por `saveCuenta` incluye `lat_acometida`, `lon_acometida`, `lat_vivienda`, `lon_vivienda`.

No hay test automatizado para este paso: no existe arnés de pruebas de UI/DOM en este proyecto (ningún archivo bajo `src/renderer/` tiene test). Se verifica manualmente ejecutando la app.

- [ ] **Step 1: Agregar la sección "Ubicación" al formulario**

En `src/renderer/js/cuentas.js`, dentro de `showFormModal`, el `<form id="cuentaForm">` actual empieza así (`src/renderer/js/cuentas.js:499-509`):

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

Justo después de ese segundo `form-group` (Dirección) y antes del bloque `${!id ? ... }` (que empieza la sección exclusiva de creación), insertar:

```html
        <h3 style="color: #1e40af; font-size: 16px; margin: 24px 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0;">Ubicación (Coordenadas GPS)</h3>
        <small style="color: #64748b; font-size: 0.875rem; display: block; margin-bottom: 12px;">
          Opcional. Para copiarlas desde Google Maps: mantenga presionado el punto exacto en el mapa, toque las coordenadas que aparecen arriba y péguelas aquí (un número en cada campo).
        </small>

        <div class="form-group">
          <label>Punto de Conexión de Agua (Acometida)</label>
          <div style="display: flex; gap: 12px;">
            <input type="number" step="any" id="lat_acometida" placeholder="Latitud" value="${cuenta?.lat_acometida ?? ''}">
            <input type="number" step="any" id="lon_acometida" placeholder="Longitud" value="${cuenta?.lon_acometida ?? ''}">
          </div>
        </div>

        <div class="form-group">
          <label style="display: flex; align-items: center; gap: 8px; font-weight: normal;">
            <input type="checkbox" id="mismo_punto" style="width: auto;" ${cuenta && cuenta.lat_acometida != null && cuenta.lat_acometida === cuenta.lat_vivienda && cuenta.lon_acometida === cuenta.lon_vivienda ? 'checked' : ''}>
            El punto de la vivienda es el mismo que la acometida
          </label>
        </div>

        <div class="form-group" id="grupoPuntoVivienda" style="${cuenta && cuenta.lat_acometida != null && cuenta.lat_acometida === cuenta.lat_vivienda && cuenta.lon_acometida === cuenta.lon_vivienda ? 'display: none;' : ''}">
          <label>Punto de la Vivienda</label>
          <div style="display: flex; gap: 12px;">
            <input type="number" step="any" id="lat_vivienda" placeholder="Latitud" value="${cuenta?.lat_vivienda ?? ''}">
            <input type="number" step="any" id="lon_vivienda" placeholder="Longitud" value="${cuenta?.lon_vivienda ?? ''}">
          </div>
        </div>
```

- [ ] **Step 2: Conectar el checkbox "mismo punto"**

En `src/renderer/js/cuentas.js`, dentro de `showFormModal`, después de `App.openModal(content);` (línea 596) y del bloque `if (!id) { ... }` (líneas 598-601), agregar el listener del checkbox antes de la línea `document.getElementById('cuentaForm').addEventListener('submit', ...)`:

```js
    document.getElementById('mismo_punto').addEventListener('change', (e) => {
      document.getElementById('grupoPuntoVivienda').style.display = e.target.checked ? 'none' : 'block';
    });

    document.getElementById('cuentaForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveCuenta(id);
    });
```

- [ ] **Step 3: Leer los campos de coordenadas en `saveCuenta`**

En `src/renderer/js/cuentas.js`, el inicio de `saveCuenta(id)` actual (`src/renderer/js/cuentas.js:664-678`) es:

```js
  async saveCuenta(id) {
    const formData = {
      codigo: document.getElementById('codigo').value.trim(),
      direccion: document.getElementById('direccion').value.trim(),
      observaciones: document.getElementById('observaciones').value.trim()
    };

    let valorConexion = 0;
    if (id) {
      formData.estado = document.getElementById('estado').value;
    } else {
      formData.categoria_id = document.getElementById('categoria_id').value;
      formData.categoria_fecha_inicio = document.getElementById('categoria_fecha_inicio').value;
      valorConexion = App.parseMoneyValue(document.getElementById('valor_conexion').value);
    }
```

Reemplazarlo por (agrega la lectura de coordenadas justo después de construir `formData` y antes del `let valorConexion = 0;`):

```js
  async saveCuenta(id) {
    const formData = {
      codigo: document.getElementById('codigo').value.trim(),
      direccion: document.getElementById('direccion').value.trim(),
      observaciones: document.getElementById('observaciones').value.trim()
    };

    const latAcometida = document.getElementById('lat_acometida').value.trim();
    const lonAcometida = document.getElementById('lon_acometida').value.trim();
    formData.lat_acometida = latAcometida === '' ? null : parseFloat(latAcometida);
    formData.lon_acometida = lonAcometida === '' ? null : parseFloat(lonAcometida);

    if (document.getElementById('mismo_punto').checked) {
      formData.lat_vivienda = formData.lat_acometida;
      formData.lon_vivienda = formData.lon_acometida;
    } else {
      const latVivienda = document.getElementById('lat_vivienda').value.trim();
      const lonVivienda = document.getElementById('lon_vivienda').value.trim();
      formData.lat_vivienda = latVivienda === '' ? null : parseFloat(latVivienda);
      formData.lon_vivienda = lonVivienda === '' ? null : parseFloat(lonVivienda);
    }

    let valorConexion = 0;
    if (id) {
      formData.estado = document.getElementById('estado').value;
    } else {
      formData.categoria_id = document.getElementById('categoria_id').value;
      formData.categoria_fecha_inicio = document.getElementById('categoria_fecha_inicio').value;
      valorConexion = App.parseMoneyValue(document.getElementById('valor_conexion').value);
    }
```

- [ ] **Step 4: Verificación manual**

Run: `npm start`

1. Inicia sesión, ve a **Cuentas → + Nueva Cuenta**.
2. Confirma que aparece la sección "Ubicación (Coordenadas GPS)" con los 4 campos y el checkbox, sin marcar por defecto.
3. Llena Código, Dirección, Categoría, y en Acometida escribe latitud `4.6097` y longitud `-74.0817`. Marca el checkbox "mismo punto" y confirma que el bloque de Vivienda se oculta.
4. Guarda la cuenta. Debe crearse sin error.
5. Vuelve a editarla (botón "Editar"): confirma que los 4 valores se precargan correctamente y que, como acometida y vivienda quedaron iguales, el checkbox aparece **ya marcado** y el bloque de Vivienda oculto.
6. Desmarca el checkbox, cambia manualmente los valores de Vivienda a algo distinto, guarda, y vuelve a abrir en modo edición: confirma que esta vez el checkbox NO aparece marcado (porque ya no coinciden) y se ven los valores distintos de cada punto.
7. Prueba un caso de error: en una cuenta nueva, llena solo la Latitud de Acometida y deja la Longitud vacía. Al guardar debe mostrarse el mensaje de error "Debe indicar tanto la latitud como la longitud de la acometida, o dejar ambas en blanco" (viene de Task 3) sin cerrar el modal.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/cuentas.js
git commit -m "feat(cuentas): capturar coordenadas de acometida y vivienda en el formulario"
```

---

### Task 6: Detalle de Cuenta — mostrar coordenadas y "Ver en mapa"

**Files:**
- Modify: `src/renderer/js/cuentas.js` (`showDetailModal`, y un método nuevo `verEnMapa`)

**Interfaces:**
- Consumes: `window.api.sistema.abrirEnlaceExterno(url)` de Task 4.
- Produces: nada consumido por otras tareas (es la última pieza visible de UI).

No hay test automatizado para este paso (mismo motivo que Task 5). Se verifica manualmente.

- [ ] **Step 1: Agregar la sección "Ubicación" al detalle**

En `src/renderer/js/cuentas.js`, dentro de `showDetailModal`, la sección "Información General" cierra y sigue "Historial de Propietarios" así (`src/renderer/js/cuentas.js:242-250`):

```html
            ${cuenta.observaciones ? `
              <div class="detail-row">
                <div class="detail-label">Observaciones:</div>
                <div class="detail-value">${cuenta.observaciones}</div>
              </div>
            ` : ''}
          </div>

          <div class="detail-section">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3>Historial de Propietarios</h3>
```

Insertar una nueva `detail-section` de Ubicación justo después del cierre `</div>` de "Información General" y antes de la sección de "Historial de Propietarios":

```html
            ${cuenta.observaciones ? `
              <div class="detail-row">
                <div class="detail-label">Observaciones:</div>
                <div class="detail-value">${cuenta.observaciones}</div>
              </div>
            ` : ''}
          </div>

          <div class="detail-section">
            <h3>Ubicación</h3>
            <div class="detail-row">
              <div class="detail-label">Acometida (conexión de agua):</div>
              <div class="detail-value">
                ${cuenta.lat_acometida != null ? `
                  ${cuenta.lat_acometida}, ${cuenta.lon_acometida}
                  <button type="button" class="btn btn-secondary btn-icon" onclick="Cuentas.verEnMapa(${cuenta.lat_acometida}, ${cuenta.lon_acometida})">Ver en mapa</button>
                ` : '<em>Sin coordenadas registradas</em>'}
              </div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Vivienda:</div>
              <div class="detail-value">
                ${cuenta.lat_vivienda != null ? `
                  ${cuenta.lat_vivienda}, ${cuenta.lon_vivienda}
                  <button type="button" class="btn btn-secondary btn-icon" onclick="Cuentas.verEnMapa(${cuenta.lat_vivienda}, ${cuenta.lon_vivienda})">Ver en mapa</button>
                ` : '<em>Sin coordenadas registradas</em>'}
              </div>
            </div>
          </div>

          <div class="detail-section">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3>Historial de Propietarios</h3>
```

- [ ] **Step 2: Agregar el método `verEnMapa`**

En `src/renderer/js/cuentas.js`, agregar este método al objeto `Cuentas` (por ejemplo, justo antes de `formatDate` cerca del final del archivo):

```js
  async verEnMapa(lat, lon) {
    const url = `https://www.google.com/maps?q=${lat},${lon}`;
    const response = await window.api.sistema.abrirEnlaceExterno(url);
    if (!response.success) {
      App.toast('No se pudo abrir el mapa: ' + response.error, 'error');
    }
  },

```

(quedando justo antes de `formatDate(dateString) { ... }`).

- [ ] **Step 3: Verificación manual**

Run: `npm start`

1. Abre el detalle de la cuenta que dejaste con coordenadas en Task 5 (botón "Ver").
2. Confirma la sección "Ubicación" con ambos puntos y sus botones "Ver en mapa".
3. Haz clic en "Ver en mapa" de Acometida: debe abrirse tu navegador por defecto en Google Maps sobre ese punto exacto.
4. Abre el detalle de una cuenta SIN coordenadas (una creada antes de este trabajo, o una nueva sin llenarlas): confirma que ambas filas muestran "Sin coordenadas registradas" y no hay botón.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/js/cuentas.js
git commit -m "feat(cuentas): mostrar ubicacion y enlace a Google Maps en el detalle de cuenta"
```

---

### Task 7: Reporte "Cuentas y Propietarios" — incluir coordenadas

**Files:**
- Modify: `src/repositories/ReporteRepository.js:16-34` (`getCuentas`)
- Modify: `src/services/ReporteService.js:83-100` (`reporteCuentas`)
- Test: `src/services/ReporteService.cuentas.test.js`

**Interfaces:**
- Consumes: columnas de Task 1 y `CuentaRepository.create` de Task 2 (para sembrar una cuenta de prueba con coordenadas).
- Produces: `ReporteRepository.getCuentas(estado)` incluye `lat_acometida`, `lon_acometida`, `lat_vivienda`, `lon_vivienda` en cada fila. `ReporteService.reporteCuentas({estado})` incluye esas 4 claves en `columnas`. Como `PlantillaReporteService` reutiliza `{columnas, filas}` para pantalla, PDF y Excel, ningún otro archivo necesita cambios.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/ReporteService.cuentas.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CuentaRepository = require('../repositories/CuentaRepository');
const ReporteService = require('./ReporteService');

test('reporteCuentas() incluye las coordenadas de acometida y vivienda, en columnas y filas', () => {
  const ctx = crearDbTemporal();
  try {
    const cuentaRepo = new CuentaRepository(ctx.dbService);
    const categoriaId = ctx.dbService.getDb().prepare(`SELECT id FROM categorias WHERE nombre = 'Finca'`).get().id;

    cuentaRepo.create({
      codigo: 'C-200',
      direccion: 'Vereda El Roble',
      categoria_id: categoriaId,
      lat_acometida: 4.1, lon_acometida: -74.1,
      lat_vivienda: 4.2, lon_vivienda: -74.2
    });

    const service = new ReporteService(ctx.dbService);
    const reporte = service.reporteCuentas({});

    const keysColumnas = reporte.columnas.map(c => c.key);
    assert.ok(keysColumnas.includes('lat_acometida'));
    assert.ok(keysColumnas.includes('lon_acometida'));
    assert.ok(keysColumnas.includes('lat_vivienda'));
    assert.ok(keysColumnas.includes('lon_vivienda'));

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

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL — `keysColumnas.includes('lat_acometida')` es `false` y/o `fila.lat_acometida` es `undefined`, porque ni el `SELECT` ni la definición de `columnas` incluyen todavía esos campos.

- [ ] **Step 3: Agregar las columnas al `SELECT` de `ReporteRepository.getCuentas`**

En `src/repositories/ReporteRepository.js:16-34`, el método actual es:

```js
  getCuentas(estado = '') {
    let query = `
      SELECT c.codigo, c.direccion, cat.nombre as categoria, p.nombre_completo as propietario,
             c.estado, c.fecha_creacion
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

Reemplazarlo por (agrega las 4 columnas al `SELECT`, sin tocar el resto):

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

- [ ] **Step 4: Agregar las columnas a `ReporteService.reporteCuentas`**

En `src/services/ReporteService.js:83-100`, el método actual es:

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
        { key: 'fecha_creacion', label: 'Fecha Creación', tipo: 'fecha' }
      ],
      filas
    };
  }
```

Reemplazarlo por (agrega las 4 columnas de coordenadas al final de `columnas`):

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

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS — `reporteCuentas() incluye las coordenadas de acometida y vivienda, en columnas y filas` en verde.

- [ ] **Step 6: Verificación manual del PDF/Excel**

Run: `npm start`

1. Inicia sesión, ve a **Reportes → Cuentas**, genera la vista previa: confirma que aparecen las 4 columnas nuevas al final de la tabla.
2. Exporta a Excel (botón correspondiente) y abre el archivo: confirma que las 4 columnas nuevas están presentes con sus encabezados.

- [ ] **Step 7: Commit**

```bash
git add src/repositories/ReporteRepository.js src/services/ReporteService.js src/services/ReporteService.cuentas.test.js
git commit -m "feat(reportes): incluir coordenadas de acometida y vivienda en Cuentas y Propietarios"
```

---

## Resumen de verificación final

Después de completar las 7 tareas:

- [ ] `npm test` corre sin fallos (suite completa).
- [ ] Flujo manual completo: crear una cuenta nueva con coordenadas → editarla → verla en detalle → hacer clic en "Ver en mapa" → generar el reporte de Cuentas y confirmar las columnas nuevas en pantalla y en el Excel exportado.
- [ ] Una cuenta ya existente (de antes de este trabajo, sin coordenadas) se sigue viendo y editando sin errores, mostrando "Sin coordenadas registradas" en su detalle.
