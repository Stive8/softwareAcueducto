# Formatos de Impresión de Recibo (Carta + Térmica 80mm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir imprimir/exportar un recibo en formato Carta (actual) o Térmica 80mm (nuevo), desde el mismo modelo de datos, con un formato predeterminado configurable y override puntual al momento de imprimir.

**Architecture:** Se separa la construcción de datos (`ReciboService.obtenerDatosParaImprimir`) de la presentación (`src/services/recibos/plantillas.js`, un registro `{ carta, termico_80mm }` de funciones puras). `ReciboService.generarHTML(id, formato)` queda como orquestador delgado. La UI agrega un `<select>` de formato en los 3 puntos donde hoy se imprime/exporta, y Configuración → General gana un nuevo campo para el formato predeterminado.

**Tech Stack:** Electron (proceso principal + renderer vanilla JS), better-sqlite3, node:test para pruebas de backend.

**Spec:** `docs/superpowers/specs/2026-08-20-formatos-impresion-recibo-design.md`

## Global Constraints

- Valores válidos del formato: `'carta'` (default) y `'termico_80mm'`. Cualquier otro valor debe rechazarse en `ConfiguracionService.actualizar()`.
- 80mm de ancho = 80000 micrones (unidad que usa `pageSize` de Electron).
- El formato térmico es **solo texto** institucional (nombre, NIT, dirección, teléfono) — nunca logo.
- El formato carta sí puede incluir logo si `configuracion.logo_path` tiene un archivo válido; si no hay logo, el HTML de carta debe quedar exactamente igual al actual (sin insertar contenedores vacíos).
- El selector de formato al imprimir/exportar aplica en los 3 puntos de entrada: tabla de recibos, modal de detalle, modal de confirmación tras pago.
- Exportar PDF y el botón Imprimir comparten el mismo parámetro `formato` y la misma resolución de "usar predeterminado".
- No se toca `PagoService`, `NuevoPuntoService`, la numeración de recibos, ni se conecta `corregirCampo` a IPC (sigue fuera de alcance).
- `generarHTML` (ambos formatos) debe reflejar el **valor vigente** de `numero_recibo`, `fecha_recibo`, `concepto` y `valor`, no el original de la columna, usando `ReciboRepository.getValorVigente()` (ya existente).

---

### Task 1: Extraer helper compartido `obtenerLogoBase64` y refactorizar `PlantillaReporteService`

**Files:**
- Create: `src/services/shared/logoBase64.js`
- Create: `src/services/shared/logoBase64.test.js`
- Modify: `src/services/PlantillaReporteService.js:1-58`

**Interfaces:**
- Produces: `obtenerLogoBase64(dataDir: string, logoPath: string|null|undefined): string|null` — devuelve una data URI `data:image/png;base64,...` o `data:image/jpeg;base64,...`, o `null` si `logoPath` está vacío o el archivo no existe. Usado por `PlantillaReporteService` (Task 1) y por `ReciboService` (Task 6).

- [ ] **Step 1: Escribir el test que falla**

```javascript
// src/services/shared/logoBase64.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { obtenerLogoBase64 } = require('./logoBase64');

test('obtenerLogoBase64: devuelve null si logoPath está vacío', () => {
  assert.equal(obtenerLogoBase64('/cualquier/dir', ''), null);
  assert.equal(obtenerLogoBase64('/cualquier/dir', null), null);
  assert.equal(obtenerLogoBase64('/cualquier/dir', undefined), null);
});

test('obtenerLogoBase64: devuelve null si el archivo no existe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-test-'));
  try {
    assert.equal(obtenerLogoBase64(dir, 'no-existe.png'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('obtenerLogoBase64: codifica un PNG como data URI image/png', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-test-'));
  try {
    const archivo = path.join(dir, 'logo.png');
    fs.writeFileSync(archivo, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const resultado = obtenerLogoBase64(dir, 'logo.png');
    assert.match(resultado, /^data:image\/png;base64,/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('obtenerLogoBase64: codifica un JPG como data URI image/jpeg', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-test-'));
  try {
    const archivo = path.join(dir, 'logo.jpg');
    fs.writeFileSync(archivo, Buffer.from([0xff, 0xd8, 0xff]));

    const resultado = obtenerLogoBase64(dir, 'logo.jpg');
    assert.match(resultado, /^data:image\/jpeg;base64,/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test src/services/shared/logoBase64.test.js`
Expected: FAIL — `Cannot find module './logoBase64'`

- [ ] **Step 3: Implementar el helper**

```javascript
// src/services/shared/logoBase64.js
const fs = require('fs');
const path = require('path');

// Reconstruye el logo institucional (guardado como solo el NOMBRE del archivo en
// configuracion.logo_path) a una data URI embebible en HTML, para no depender de una ruta
// absoluta que cambia entre equipos. Compartido por cualquier plantilla que muestre el logo
// (reportes en PDF/Excel, recibo en formato carta).
function obtenerLogoBase64(dataDir, logoPath) {
  if (!logoPath) return null;

  const logoFile = path.join(dataDir, logoPath);
  if (!fs.existsSync(logoFile)) return null;

  const ext = path.extname(logoFile).toLowerCase().replace('.', '');
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(logoFile).toString('base64')}`;
}

module.exports = { obtenerLogoBase64 };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test src/services/shared/logoBase64.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Refactorizar `PlantillaReporteService` para usar el helper**

En `src/services/PlantillaReporteService.js`, reemplazar las líneas 49-58 (bloque `let logoBase64 = null; if (config.logo_path) {...}`) por una llamada al helper nuevo, y quitar el `require('fs')`/`require('path')` que ya no hagan falta directamente en este archivo si dejan de usarse en otro lado (verificar con `grep -n "fs\.\|path\." src/services/PlantillaReporteService.js` antes de quitar los requires — `path.dirname` en el constructor todavía los necesita, así que `path` se queda; `fs` puede que ya no se use en ningún otro punto del archivo).

```javascript
const { obtenerLogoBase64 } = require('./shared/logoBase64');
// ... (mantener el require de path; quitar el de fs si ya no se usa en el resto del archivo)

  obtenerConfiguracionInstitucional() {
    const config = this.configuracionRepository.getAll();
    const logoBase64 = obtenerLogoBase64(this.dataDir, config.logo_path);

    return {
      nombreAsociacion: config.nombre_asociacion || 'Acueducto Veredal',
      nit: config.nit || '',
      direccion: config.direccion || '',
      ciudad: config.ciudad || '',
      telefono: config.telefono || '',
      email: config.email || '',
      logoBase64
    };
  }
```

- [ ] **Step 6: Correr la suite completa de `PlantillaReporteService` (y cualquier test que dependa de reportes con logo) para verificar que no hay regresión**

Run: `node --test src/services/PlantillaReporteService*.test.js`
Expected: PASS (mismo resultado que antes del refactor)

- [ ] **Step 7: Commit**

```bash
git add src/services/shared/logoBase64.js src/services/shared/logoBase64.test.js src/services/PlantillaReporteService.js
git commit -m "refactor(recibos): extraer helper compartido para embeber el logo en base64"
```

---

### Task 2: Extender `ReciboRepository` — logo en `getConfiguracionAsociacion` + formato predeterminado

**Files:**
- Modify: `src/repositories/ReciboRepository.js:263-272`
- Create: `src/repositories/ReciboRepository.formatoImpresion.test.js`

**Interfaces:**
- Consumes: nada nuevo (solo la tabla `configuracion` ya existente).
- Produces: `ReciboRepository.getConfiguracionAsociacion()` ahora incluye `logo_path` en el objeto devuelto. Nuevo método `ReciboRepository.getFormatoImpresionPredeterminado(): string` — devuelve el valor de `configuracion.formato_impresion_recibo`, o `'carta'` si la fila no existe todavía (para no romper si este task se prueba antes de correr la migración 043 del Task 3). Usado por `ReciboService.generarHTML` (Task 6).

- [ ] **Step 1: Escribir el test que falla**

```javascript
// src/repositories/ReciboRepository.formatoImpresion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ReciboRepository = require('./ReciboRepository');

test('getConfiguracionAsociacion incluye logo_path', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`UPDATE configuracion SET valor = 'logo.png' WHERE clave = 'logo_path'`).run();

    const repo = new ReciboRepository(ctx.dbService);
    const config = repo.getConfiguracionAsociacion();

    assert.equal(config.logo_path, 'logo.png');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getFormatoImpresionPredeterminado devuelve "carta" por defecto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`DELETE FROM configuracion WHERE clave = 'formato_impresion_recibo'`).run();

    const repo = new ReciboRepository(ctx.dbService);
    assert.equal(repo.getFormatoImpresionPredeterminado(), 'carta');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getFormatoImpresionPredeterminado devuelve el valor configurado', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    db.prepare(`
      INSERT INTO configuracion (clave, valor) VALUES ('formato_impresion_recibo', 'termico_80mm')
      ON CONFLICT(clave) DO UPDATE SET valor = 'termico_80mm'
    `).run();

    const repo = new ReciboRepository(ctx.dbService);
    assert.equal(repo.getFormatoImpresionPredeterminado(), 'termico_80mm');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test src/repositories/ReciboRepository.formatoImpresion.test.js`
Expected: FAIL — `logo_path` es `undefined` en el primer test, y `repo.getFormatoImpresionPredeterminado is not a function` en los otros dos.

- [ ] **Step 3: Implementar los cambios**

En `src/repositories/ReciboRepository.js`, reemplazar el método `getConfiguracionAsociacion` (líneas 263-272):

```javascript
  getConfiguracionAsociacion() {
    const rows = this.db.prepare(`
      SELECT clave, valor FROM configuracion
      WHERE clave IN ('nombre_asociacion', 'nit', 'direccion', 'telefono', 'email', 'logo_path')
    `).all();

    const config = {};
    rows.forEach(r => { config[r.clave] = r.valor; });
    return config;
  }

  // 'carta' si la clave todavía no existe en esta base (p. ej. antes de correr la migración 043,
  // o en un test que la borra a propósito) -- mismo patrón defensivo que getConsecutivoRecibo.
  getFormatoImpresionPredeterminado() {
    const row = this.db.prepare("SELECT valor FROM configuracion WHERE clave = 'formato_impresion_recibo'").get();
    return row?.valor || 'carta';
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test src/repositories/ReciboRepository.formatoImpresion.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Correr la suite de `ReciboRepository` completa para verificar que no hay regresión**

Run: `node --test src/repositories/ReciboRepository*.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/repositories/ReciboRepository.js src/repositories/ReciboRepository.formatoImpresion.test.js
git commit -m "feat(recibos): logo_path en configuración institucional + getFormatoImpresionPredeterminado"
```

---

### Task 3: Migración `043_formato_impresion_recibo`

**Files:**
- Create: `src/database/migrations/043_formato_impresion_recibo.sql`
- Create: `src/database/migrations/043_formato_impresion_recibo.test.js`

**Interfaces:**
- Produces: fila `configuracion.formato_impresion_recibo = 'carta'` presente en toda base de datos nueva o migrada. Consumida por `ReciboRepository.getFormatoImpresionPredeterminado()` (Task 2) y editada por `ConfiguracionService` (Task 4) / `configuracion.js` (Task 11).

- [ ] **Step 1: Escribir el test que falla**

```javascript
// src/database/migrations/043_formato_impresion_recibo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');

test('043: siembra formato_impresion_recibo = carta por defecto', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const fila = db.prepare(`SELECT valor FROM configuracion WHERE clave = 'formato_impresion_recibo'`).get();
    assert.ok(fila, 'la fila debe existir tras correr las migraciones');
    assert.equal(fila.valor, 'carta');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test src/database/migrations/043_formato_impresion_recibo.test.js`
Expected: FAIL — `fila` es `undefined` (la clave no existe todavía)

- [ ] **Step 3: Crear la migración**

```sql
-- 043_formato_impresion_recibo.sql
-- Formato de impresión predeterminado para recibos: 'carta' (diseño actual, con logo si hay
-- uno configurado) o 'termico_80mm' (nuevo, solo texto, pensado para impresoras POS de rollo
-- continuo). El usuario puede igual elegir un formato distinto al momento de imprimir o exportar
-- (ver el selector en recibos.js/pagos.js): este valor solo aplica cuando elige "Usar
-- predeterminado". Ver docs/superpowers/specs/2026-08-20-formatos-impresion-recibo-design.md.
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('formato_impresion_recibo', 'carta', 'Formato de impresión predeterminado de recibos: carta o termico_80mm');
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test src/database/migrations/043_formato_impresion_recibo.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/043_formato_impresion_recibo.sql src/database/migrations/043_formato_impresion_recibo.test.js
git commit -m "feat(config): migración para formato de impresión predeterminado de recibos"
```

---

### Task 4: `ConfiguracionService` — clave editable y validación

**Files:**
- Modify: `src/services/ConfiguracionService.js:5-10,25-77`
- Create: `src/services/ConfiguracionService.formatoImpresionRecibo.test.js`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `ConfiguracionService.actualizar({ formato_impresion_recibo: 'carta' | 'termico_80mm' })` ahora acepta y valida esta clave; rechaza cualquier otro valor. Usado por `configuracion.js` (Task 11).

- [ ] **Step 1: Escribir el test que falla**

```javascript
// src/services/ConfiguracionService.formatoImpresionRecibo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ConfiguracionService = require('./ConfiguracionService');

test('actualizar() guarda un formato_impresion_recibo válido', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new ConfiguracionService(ctx.dbService);
    service.actualizar({ formato_impresion_recibo: 'termico_80mm' });

    const config = service.getAll();
    assert.equal(config.formato_impresion_recibo, 'termico_80mm');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizar() rechaza un formato_impresion_recibo inválido', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new ConfiguracionService(ctx.dbService);
    assert.throws(
      () => service.actualizar({ formato_impresion_recibo: 'termico_58mm' }),
      /Formato de impresión de recibo inválido/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test src/services/ConfiguracionService.formatoImpresionRecibo.test.js`
Expected: FAIL — el primer test falla porque `formato_impresion_recibo` no está en `CLAVES_EDITABLES` (no se persiste); el segundo falla porque no hay ninguna validación que lance ese error (no lanza nada).

- [ ] **Step 3: Implementar los cambios**

En `src/services/ConfiguracionService.js`, agregar la clave a `CLAVES_EDITABLES` (línea 5-10) y una constante + validación en `actualizar()`:

```javascript
const CLAVES_EDITABLES = [
  'nombre_asociacion', 'nit', 'direccion', 'ciudad', 'telefono', 'email',
  'consecutivo_recibos', 'valor_nuevo_punto', 'saldo_caja_inicial', 'saldo_banco_inicial',
  'respaldo_nube_dias_retencion', 'caja_menor_activa', 'caja_menor_saldo_objetivo',
  'periodo_bloqueo_anterior_a', 'formato_impresion_recibo'
];

const FORMATOS_IMPRESION_RECIBO_VALIDOS = ['carta', 'termico_80mm'];
```

Y dentro de `actualizar(datos, usuarioId = null)`, junto a las demás validaciones puntuales (antes del bucle `for (const clave of CLAVES_EDITABLES)`):

```javascript
    if (datos.formato_impresion_recibo !== undefined
      && !FORMATOS_IMPRESION_RECIBO_VALIDOS.includes(datos.formato_impresion_recibo)) {
      throw new Error('Formato de impresión de recibo inválido');
    }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test src/services/ConfiguracionService.formatoImpresionRecibo.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Correr la suite completa de `ConfiguracionService` para verificar que no hay regresión**

Run: `node --test src/services/ConfiguracionService*.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/ConfiguracionService.js src/services/ConfiguracionService.formatoImpresionRecibo.test.js
git commit -m "feat(config): validar y persistir el formato de impresión predeterminado de recibos"
```

---

### Task 5: Módulo de plantillas — `renderCarta` (con logo) y `renderTermico80mm`

**Files:**
- Create: `src/services/recibos/plantillas.js`
- Create: `src/services/recibos/plantillas.test.js`

**Interfaces:**
- Consumes: un objeto `datos` con esta forma (producido por `ReciboService.obtenerDatosParaImprimir` en el Task 6, pero este task se prueba con un fixture propio, sin depender de esa función):
  ```
  {
    numero_recibo, fecha_recibo, metodo_pago, cuenta_codigo, cuenta_direccion,
    propietario_nombre, propietario_identificacion, estado, motivo_anulacion,
    observaciones, total,
    detalles: [{ concepto, periodo_desde, periodo_hasta, valor }, ...],
    config: { nombre_asociacion, nit, direccion, telefono, email, logoBase64 }
  }
  ```
- Produces: `PLANTILLAS = { carta: (datos) => string, termico_80mm: (datos) => string }`. Consumido por `ReciboService.generarHTML` (Task 6).

- [ ] **Step 1: Escribir los tests que fallan**

```javascript
// src/services/recibos/plantillas.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { PLANTILLAS } = require('./plantillas');

function datosFixture(overrides = {}) {
  return {
    numero_recibo: 1773,
    fecha_recibo: '2026-08-20',
    metodo_pago: 'Efectivo',
    cuenta_codigo: 'A001',
    cuenta_direccion: 'Vereda El Progreso',
    propietario_nombre: 'Juan Pérez',
    propietario_identificacion: '123456789',
    estado: 'Activo',
    motivo_anulacion: null,
    observaciones: '',
    total: 30000,
    detalles: [
      { concepto: 'CUOTA DE SOSTENIMIENTO DE ENERO A DICIEMBRE 2024', periodo_desde: '2024-01', periodo_hasta: '2024-12', valor: 30000 }
    ],
    config: {
      nombre_asociacion: 'Acueducto Veredal El Progreso',
      nit: '900123456-1',
      direccion: 'Vereda El Progreso, Km 3',
      telefono: '3001234567',
      email: 'acueducto@example.com',
      logoBase64: null
    },
    ...overrides
  };
}

test('carta: sin logoBase64, no inserta ningún contenedor de logo', () => {
  const html = PLANTILLAS.carta(datosFixture());
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Recibo No\. 1773/);
  assert.match(html, /Acueducto Veredal El Progreso/);
});

test('carta: con logoBase64, inserta la imagen del logo', () => {
  const html = PLANTILLAS.carta(datosFixture({ config: { ...datosFixture().config, logoBase64: 'data:image/png;base64,ABC' } }));
  assert.match(html, /<img[^>]+src="data:image\/png;base64,ABC"/);
});

test('carta: escapa HTML en campos de texto libre (observaciones, concepto)', () => {
  const html = PLANTILLAS.carta(datosFixture({
    observaciones: '<script>alert(1)</script>',
    detalles: [{ concepto: '<b>malicioso</b>', periodo_desde: null, periodo_hasta: null, valor: 5000 }]
  }));
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>malicioso<\/b>/);
});

test('termico_80mm: nunca incluye logo aunque logoBase64 venga presente', () => {
  const html = PLANTILLAS.termico_80mm(datosFixture({ config: { ...datosFixture().config, logoBase64: 'data:image/png;base64,ABC' } }));
  assert.doesNotMatch(html, /<img/);
});

test('termico_80mm: incluye número de recibo, total y concepto largo completo', () => {
  const html = PLANTILLAS.termico_80mm(datosFixture());
  assert.match(html, /1773/);
  assert.match(html, /30\.000|30000/);
  assert.match(html, /CUOTA DE SOSTENIMIENTO DE ENERO A DICIEMBRE 2024/);
});

test('termico_80mm: usa @page de 80mm de ancho', () => {
  const html = PLANTILLAS.termico_80mm(datosFixture());
  assert.match(html, /@page\s*\{[^}]*80mm/);
});

test('termico_80mm: escapa HTML en campos de texto libre', () => {
  const html = PLANTILLAS.termico_80mm(datosFixture({ observaciones: '<script>alert(1)</script>' }));
  assert.doesNotMatch(html, /<script>/);
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test src/services/recibos/plantillas.test.js`
Expected: FAIL — `Cannot find module './plantillas'`

- [ ] **Step 3: Implementar el módulo**

```javascript
// src/services/recibos/plantillas.js
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(num) {
  return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatFecha(fechaString) {
  const fecha = new Date(fechaString);
  return fecha.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatPeriodo(d) {
  if (!d.periodo_desde) return '-';
  return escapeHtml(d.periodo_desde) + (d.periodo_hasta && d.periodo_hasta !== d.periodo_desde ? ' - ' + escapeHtml(d.periodo_hasta) : '');
}

// Diseño original del recibo, sin cambios respecto al que existía antes de separar datos y
// presentación -- la única adición es el logo institucional (opcional, ausente = idéntico al
// HTML anterior byte a byte salvo por este comentario).
function renderCarta(datos) {
  const config = datos.config;

  const filasDetalle = datos.detalles.map(d => `
    <tr>
      <td>${escapeHtml(d.concepto)}</td>
      <td>${formatPeriodo(d)}</td>
      <td class="text-right">$${formatNumber(d.valor)}</td>
    </tr>
  `).join('');

  const bloqueTexto = `
    <h1>${escapeHtml(config.nombre_asociacion || 'Acueducto Veredal')}</h1>
    ${config.nit ? `<p>NIT: ${escapeHtml(config.nit)}</p>` : ''}
    ${config.direccion ? `<p>${escapeHtml(config.direccion)}</p>` : ''}
    ${config.telefono ? `<p>Tel: ${escapeHtml(config.telefono)}</p>` : ''}
  `;

  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Recibo No. ${datos.numero_recibo}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 32px; color: #1f2937; }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #1e40af; padding-bottom: 16px; }
  .header-flex { display: flex; align-items: center; justify-content: center; gap: 16px; }
  .header-logo { max-height: 64px; max-width: 140px; object-fit: contain; }
  .header-texto { text-align: left; }
  .header h1 { color: #1e40af; font-size: 22px; margin: 0 0 6px 0; }
  .header p { font-size: 12px; color: #475569; margin: 2px 0; }
  .recibo-numero { text-align: right; font-size: 18px; font-weight: bold; color: #1e40af; margin-bottom: 20px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 24px; font-size: 13px; }
  .info-grid div span { font-weight: bold; color: #334155; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #cbd5e1; padding: 10px 12px; font-size: 13px; text-align: left; }
  th { background: #f1f5f9; color: #334155; }
  .total-row td { font-weight: bold; font-size: 14px; background: #eff6ff; }
  .text-right { text-align: right; }
  .footer { margin-top: 32px; font-size: 11px; color: #64748b; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    ${config.logoBase64 ? `
    <div class="header-flex">
      <img class="header-logo" src="${config.logoBase64}" alt="Logo">
      <div class="header-texto">${bloqueTexto}</div>
    </div>
    ` : bloqueTexto}
  </div>

  <div class="recibo-numero">Recibo No. ${datos.numero_recibo}${datos.estado === 'Anulado' ? ' <span style="color:#dc2626;">— ANULADO</span>' : ''}</div>
  ${datos.estado === 'Anulado' ? `<p style="color:#dc2626; font-size: 12px; text-align: center; margin: -12px 0 16px 0;">Este recibo fue anulado${datos.motivo_anulacion ? ': ' + escapeHtml(datos.motivo_anulacion) : ''}</p>` : ''}

  <div class="info-grid">
    <div>Fecha: <span>${formatFecha(datos.fecha_recibo)}</span></div>
    <div>Método de pago: <span>${escapeHtml(datos.metodo_pago)}</span></div>
    <div>Cuenta: <span>${escapeHtml(datos.cuenta_codigo)}</span></div>
    <div>Dirección: <span>${escapeHtml(datos.cuenta_direccion)}</span></div>
    <div>Propietario: <span>${escapeHtml(datos.propietario_nombre)}</span></div>
    <div>Identificación: <span>${escapeHtml(datos.propietario_identificacion || '-')}</span></div>
  </div>

  <table>
    <thead>
      <tr><th>Concepto</th><th>Período</th><th class="text-right">Valor</th></tr>
    </thead>
    <tbody>
      ${filasDetalle}
      <tr class="total-row"><td colspan="2">TOTAL</td><td class="text-right">$${formatNumber(datos.total)}</td></tr>
    </tbody>
  </table>

  ${datos.observaciones ? `<p style="font-size:13px;"><strong>Observaciones:</strong> ${escapeHtml(datos.observaciones)}</p>` : ''}

  <div class="footer">Documento generado por el sistema administrativo del acueducto. Gracias por su pago.</div>
</body>
</html>
  `;
}

// Diseño propio para impresoras térmicas POS de 80mm: una sola columna, sin tablas, tipografía
// más grande para el número de recibo y el total (lo más visible del ticket), texto envuelto por
// palabra para que conceptos largos ("CUOTA DE SOSTENIMIENTO DE ENERO A DICIEMBRE 2024") no
// rompan el layout. Sin logo a propósito (ver decisión del spec) -- solo texto institucional.
function renderTermico80mm(datos) {
  const config = datos.config;

  const bloquesDetalle = datos.detalles.map(d => `
    <div class="detalle">
      <div class="detalle-concepto">${escapeHtml(d.concepto)}</div>
      <div class="detalle-periodo">${formatPeriodo(d)}</div>
      <div class="detalle-valor">$${formatNumber(d.valor)}</div>
    </div>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Recibo No. ${datos.numero_recibo}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: 80mm auto; margin: 3mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111827; width: 74mm; margin: 0; padding: 0; }
  .centro { text-align: center; }
  .separador { border: none; border-top: 1px dashed #111827; margin: 6px 0; }
  .nombre-asociacion { font-size: 13px; font-weight: bold; margin: 0 0 2px 0; }
  .dato-institucional { font-size: 10px; margin: 1px 0; color: #374151; }
  .recibo-numero { font-size: 15px; font-weight: bold; margin: 6px 0 0 0; }
  .recibo-fecha { font-size: 11px; margin: 2px 0 0 0; }
  .anulado { color: #dc2626; font-weight: bold; font-size: 11px; }
  .campo { margin: 3px 0; word-wrap: break-word; overflow-wrap: break-word; }
  .campo-etiqueta { font-weight: bold; }
  .detalle { margin: 6px 0; word-wrap: break-word; overflow-wrap: break-word; }
  .detalle-concepto { font-size: 11px; }
  .detalle-periodo { font-size: 10px; color: #374151; }
  .detalle-valor { font-size: 11px; text-align: right; font-weight: bold; }
  .total-bloque { margin: 8px 0; padding: 6px; border: 1px solid #111827; text-align: center; }
  .total-etiqueta { font-size: 11px; font-weight: bold; }
  .total-valor { font-size: 18px; font-weight: bold; }
  .observaciones { font-size: 10px; word-wrap: break-word; overflow-wrap: break-word; margin: 4px 0; }
  .pie { font-size: 9px; color: #6b7280; text-align: center; margin-top: 8px; }
</style>
</head>
<body>
  <div class="centro">
    <p class="nombre-asociacion">${escapeHtml(config.nombre_asociacion || 'Acueducto Veredal')}</p>
    ${config.nit ? `<p class="dato-institucional">NIT: ${escapeHtml(config.nit)}</p>` : ''}
    ${config.direccion ? `<p class="dato-institucional">${escapeHtml(config.direccion)}</p>` : ''}
    ${config.telefono ? `<p class="dato-institucional">Tel: ${escapeHtml(config.telefono)}</p>` : ''}
  </div>

  <hr class="separador">

  <div class="centro">
    <p class="recibo-numero">RECIBO No. ${datos.numero_recibo}</p>
    <p class="recibo-fecha">${formatFecha(datos.fecha_recibo)}</p>
    ${datos.estado === 'Anulado' ? `<p class="anulado">ANULADO${datos.motivo_anulacion ? ': ' + escapeHtml(datos.motivo_anulacion) : ''}</p>` : ''}
  </div>

  <hr class="separador">

  <div class="campo"><span class="campo-etiqueta">Cuenta:</span> ${escapeHtml(datos.cuenta_codigo)}</div>
  <div class="campo"><span class="campo-etiqueta">Dirección:</span> ${escapeHtml(datos.cuenta_direccion)}</div>
  <div class="campo"><span class="campo-etiqueta">Propietario:</span> ${escapeHtml(datos.propietario_nombre)}</div>
  <div class="campo"><span class="campo-etiqueta">Identificación:</span> ${escapeHtml(datos.propietario_identificacion || '-')}</div>

  <hr class="separador">

  ${bloquesDetalle}

  <div class="total-bloque">
    <div class="total-etiqueta">TOTAL</div>
    <div class="total-valor">$${formatNumber(datos.total)}</div>
  </div>

  <div class="campo"><span class="campo-etiqueta">Método de pago:</span> ${escapeHtml(datos.metodo_pago)}</div>
  ${datos.observaciones ? `<div class="observaciones"><span class="campo-etiqueta">Obs:</span> ${escapeHtml(datos.observaciones)}</div>` : ''}

  <hr class="separador">

  <p class="pie">Documento generado por el sistema administrativo del acueducto.<br>Gracias por su pago.</p>
</body>
</html>
  `;
}

const PLANTILLAS = {
  carta: renderCarta,
  termico_80mm: renderTermico80mm
};

module.exports = { PLANTILLAS };
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test src/services/recibos/plantillas.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/recibos/plantillas.js src/services/recibos/plantillas.test.js
git commit -m "feat(recibos): plantillas de impresión separadas por formato (carta + térmica 80mm)"
```

---

### Task 6: `ReciboService` — `obtenerDatosParaImprimir` + `generarHTML` reescrito

**Files:**
- Modify: `src/services/ReciboService.js`
- Create: `src/services/ReciboService.generarHTML.test.js`

**Interfaces:**
- Consumes: `PLANTILLAS` de `src/services/recibos/plantillas.js` (Task 5), `obtenerLogoBase64` de `src/services/shared/logoBase64.js` (Task 1), `this.repository.getConfiguracionAsociacion()` y `this.repository.getFormatoImpresionPredeterminado()` (Task 2), `this.repository.getValorVigente(reciboId, campo, reciboDetalleId)` (ya existente).
- Produces: `ReciboService.obtenerDatosParaImprimir(id): object` (forma documentada en el Task 5). `ReciboService.generarHTML(id, formatoOverride?): string` — firma nueva, con segundo parámetro opcional. Consumido por `main.js` (Task 7).

- [ ] **Step 1: Escribir los tests que fallan**

```javascript
// src/services/ReciboService.generarHTML.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const ReciboService = require('./ReciboService');

function sembrarRecibo(db) {
  db.prepare(`INSERT INTO cuentas (codigo, direccion) VALUES ('T001', 'Vereda Test')`).run();
  const cuentaId = db.prepare(`SELECT id FROM cuentas WHERE codigo = 'T001'`).get().id;
  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES ('Propietario Test')`).run();
  const propietarioId = db.prepare(`SELECT id FROM propietarios WHERE nombre_completo = 'Propietario Test'`).get().id;

  const reciboId = db.prepare(`
    INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago)
    VALUES (6001, ?, ?, '2024-01-15', 10000, 'Efectivo')
  `).run(cuentaId, propietarioId).lastInsertRowid;
  const detalleId = db.prepare(`
    INSERT INTO recibo_detalles (recibo_id, concepto, valor) VALUES (?, 'Cuota enero 2024', 10000)
  `).run(reciboId).lastInsertRowid;

  return { reciboId, detalleId };
}

test('generarHTML(id, "carta") usa la plantilla carta', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId } = sembrarRecibo(db);
    const service = new ReciboService(ctx.dbService);

    const html = service.generarHTML(reciboId, 'carta');
    assert.match(html, /Recibo No\. 6001/);
    assert.match(html, /info-grid/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('generarHTML(id, "termico_80mm") usa la plantilla térmica', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId } = sembrarRecibo(db);
    const service = new ReciboService(ctx.dbService);

    const html = service.generarHTML(reciboId, 'termico_80mm');
    assert.match(html, /RECIBO No\. 6001/);
    assert.match(html, /80mm/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('generarHTML(id) sin formato usa el predeterminado de configuración', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId } = sembrarRecibo(db);
    db.prepare(`
      INSERT INTO configuracion (clave, valor) VALUES ('formato_impresion_recibo', 'termico_80mm')
      ON CONFLICT(clave) DO UPDATE SET valor = 'termico_80mm'
    `).run();
    const service = new ReciboService(ctx.dbService);

    const html = service.generarHTML(reciboId);
    assert.match(html, /80mm/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('generarHTML refleja el valor VIGENTE (post-corrección), no el original', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const { reciboId, detalleId } = sembrarRecibo(db);
    const service = new ReciboService(ctx.dbService);

    service.corregirCampo({
      reciboId, reciboDetalleId: detalleId, campo: 'concepto',
      valorNuevo: 'Cuota enero 2024 (corregido: era febrero)', motivo: 'Mes mal escrito'
    });

    const html = service.generarHTML(reciboId, 'carta');
    assert.match(html, /Cuota enero 2024 \(corregido: era febrero\)/);
    assert.doesNotMatch(html, />Cuota enero 2024</);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('obtenerDatosParaImprimir lanza si el recibo no existe', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new ReciboService(ctx.dbService);
    assert.throws(() => service.obtenerDatosParaImprimir(999999), /Recibo no encontrado/);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `node --test src/services/ReciboService.generarHTML.test.js`
Expected: FAIL — `generarHTML` actual no acepta un segundo parámetro (ignora el formato, siempre genera carta) y no refleja la corrección del concepto (usa el valor original).

- [ ] **Step 3: Implementar los cambios**

En `src/services/ReciboService.js`:

1. Agregar los `require` nuevos al inicio del archivo y quitar los helpers de formateo que se mudan a `plantillas.js`:

```javascript
const path = require('path');
const ReciboRepository = require('../repositories/ReciboRepository');
const AsientoContableService = require('./AsientoContableService');
const { esMayor } = require('./cartera/dinero');
const { obtenerLogoBase64 } = require('./shared/logoBase64');
const { PLANTILLAS } = require('./recibos/plantillas');
```

Quitar las funciones `escapeHtml`, `formatNumber` y `formatFecha` (líneas 5-21 del archivo original) — ya viven en `plantillas.js`.

2. En el constructor, guardar `dataDir` (mismo patrón que `PlantillaReporteService`):

```javascript
  constructor(dbService) {
    this.repository = new ReciboRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
    this.dataDir = path.dirname(dbService.getDbPath());
  }
```

3. Reemplazar el método `generarHTML` completo (incluyendo el comentario de deuda técnica que ya no aplica) por:

```javascript
  // Junta los datos vigentes de un recibo (aplicando cualquier corrección posterior, ver
  // getValorVigente) con la información institucional, en un único objeto formato-agnóstico
  // que consumen las plantillas de src/services/recibos/plantillas.js.
  obtenerDatosParaImprimir(id) {
    const recibo = this.getById(id);
    if (!recibo) throw new Error('Recibo no encontrado');

    const numeroRecibo = this.repository.getValorVigente(id, 'numero_recibo') ?? recibo.numero_recibo;
    const fechaRecibo = this.repository.getValorVigente(id, 'fecha_recibo') ?? recibo.fecha_recibo;

    const detalles = recibo.detalles.map(d => ({
      ...d,
      concepto: this.repository.getValorVigente(id, 'concepto', d.id) ?? d.concepto,
      valor: this.repository.getValorVigente(id, 'valor', d.id) ?? d.valor
    }));

    const configBase = this.repository.getConfiguracionAsociacion();
    const logoBase64 = obtenerLogoBase64(this.dataDir, configBase.logo_path);

    return {
      ...recibo,
      numero_recibo: numeroRecibo,
      fecha_recibo: fechaRecibo,
      detalles,
      config: { ...configBase, logoBase64 }
    };
  }

  // Genera el documento HTML imprimible de un recibo, en el formato pedido (usado tanto para
  // imprimir como para exportar a PDF). formatoOverride ausente/vacío = usar el predeterminado
  // configurado para el acueducto (configuracion.formato_impresion_recibo).
  generarHTML(id, formatoOverride) {
    const datos = this.obtenerDatosParaImprimir(id);
    const formato = formatoOverride || this.repository.getFormatoImpresionPredeterminado();
    const render = PLANTILLAS[formato] || PLANTILLAS.carta;
    return render(datos);
  }
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `node --test src/services/ReciboService.generarHTML.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Correr toda la suite de `ReciboService`/`ReciboRepository` para verificar que no hay regresión**

Run: `node --test src/services/ReciboService*.test.js src/repositories/ReciboRepository*.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/ReciboService.js src/services/ReciboService.generarHTML.test.js
git commit -m "feat(recibos): generarHTML soporta formato carta/térmica y usa el valor vigente"
```

---

### Task 7: `main.js` — IPC con parámetro `formato` + tamaño de página dinámico para térmica

**Files:**
- Modify: `main.js:1375-1433`

**Interfaces:**
- Consumes: `reciboService.generarHTML(id, formato)` (Task 6).
- Produces: canal IPC `recibos:imprimir(id, formato)` y `recibos:exportarPDF(id, formato)` — `formato` es opcional (string vacío/`undefined`/`null` = predeterminado). Consumido por `preload.js` (Task 8).

Este task no tiene test automatizado propio: `main.js` no tiene suite de tests (usa BrowserWindow real de Electron), así que la verificación es manual, descrita en el Step 3.

- [ ] **Step 1: Agregar la función auxiliar de tamaño de página térmico**

En `main.js`, justo antes del handler `recibos:imprimir` (línea 1375), agregar:

```javascript
// Chromium exige alto Y ancho fijos en pageSize (no hay "alto automático" como en una impresora
// térmica física de papel continuo). Como el recibo térmico varía de largo según cuántos
// conceptos tenga, se mide el contenido ya cargado en la ventana oculta y se calcula el alto en
// micrones a partir de eso, en vez de asumir un tamaño fijo que podría cortar el recibo o
// desperdiciar papel.
const ANCHO_TERMICO_MICRONES = 80000; // 80mm
const MARGEN_ALTURA_TERMICO_MICRONES = 10000; // 10mm de margen de seguridad
const MICRONES_POR_PX = 25400 / 96; // 1 CSS px = 1/96 pulgada = 25400/96 micrones

async function calcularPageSizeTermico(ventana) {
  const alturaPx = await ventana.webContents.executeJavaScript('document.body.scrollHeight');
  const alturaMicrones = Math.round(alturaPx * MICRONES_POR_PX) + MARGEN_ALTURA_TERMICO_MICRONES;
  return { width: ANCHO_TERMICO_MICRONES, height: alturaMicrones };
}
```

- [ ] **Step 2: Actualizar los handlers de impresión y exportación**

Reemplazar los handlers `recibos:imprimir` y `recibos:exportarPDF` (líneas 1375-1433) por:

```javascript
  envolverHandle('recibos:imprimir', async (event, id, formato) => {
    let ventanaImpresion;
    try {
      const html = reciboService.generarHTML(id, formato);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const opcionesImpresion = { silent: false };
      if (formato === 'termico_80mm') {
        opcionesImpresion.pageSize = await calcularPageSizeTermico(ventanaImpresion);
      }

      return await new Promise((resolve) => {
        ventanaImpresion.webContents.print(opcionesImpresion, (success, errorType) => {
          ventanaImpresion.close();
          // El diálogo nativo de impresión deja a veces el foco de teclado sin volver
          // correctamente a la ventana principal; se restaura explícitamente.
          if (mainWindow) mainWindow.focus();
          if (success) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: errorType || 'No se pudo imprimir el recibo' });
          }
        });
      });
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:exportarPDF', async (event, id, formato) => {
    let ventanaImpresion;
    try {
      const recibo = reciboService.getById(id);
      if (!recibo) {
        return { success: false, error: 'Recibo no encontrado' };
      }

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar Recibo como PDF',
        defaultPath: `Recibo_${recibo.numero_recibo}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const html = reciboService.generarHTML(id, formato);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const opcionesPDF = {};
      if (formato === 'termico_80mm') {
        opcionesPDF.pageSize = await calcularPageSizeTermico(ventanaImpresion);
      }

      const pdfBuffer = await ventanaImpresion.webContents.printToPDF(opcionesPDF);
      fs.writeFileSync(filePath, pdfBuffer);
      ventanaImpresion.close();
      if (mainWindow) mainWindow.focus();

      return { success: true, filePath };
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });
```

- [ ] **Step 3: Verificación manual**

Con la app en modo desarrollo (`npm start` o el script equivalente del proyecto):
1. Ir a Recibos, exportar un recibo existente a PDF sin tocar el nuevo selector todavía (el Task 9 lo agrega) — confirmar que sigue generando el PDF en carta exactamente igual que antes (sin `pageSize`, formato `undefined` → carta).
2. No debería haber errores en la consola del proceso principal (`electron` log) al exportar.

Esto se vuelve a verificar de punta a punta en el Task 9, una vez exista el selector en la UI para pasar `'termico_80mm'` explícitamente.

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "feat(recibos): IPC de imprimir/exportar recibe formato y calcula pageSize térmico"
```

---

### Task 8: `preload.js` — exponer el parámetro `formato`

**Files:**
- Modify: `preload.js:79-80`

**Interfaces:**
- Consumes: canales IPC `recibos:imprimir`/`recibos:exportarPDF` (Task 7).
- Produces: `window.api.recibos.imprimir(id, formato)` / `window.api.recibos.exportarPDF(id, formato)`. Consumido por `recibos.js` (Task 9) y `pagos.js` (Task 10).

- [ ] **Step 1: Actualizar las firmas**

En `preload.js`, reemplazar las líneas 79-80:

```javascript
    imprimir: (id, formato) => ipcRenderer.invoke('recibos:imprimir', id, formato),
    exportarPDF: (id, formato) => ipcRenderer.invoke('recibos:exportarPDF', id, formato)
```

- [ ] **Step 2: Verificación manual**

No hay test automatizado de `preload.js` en este proyecto. Verificar que la app arranca sin errores (`npm start`) y que la consola de DevTools no muestra ningún error de `window.api.recibos.imprimir is not a function` al cargar el módulo de Recibos.

- [ ] **Step 3: Commit**

```bash
git add preload.js
git commit -m "feat(recibos): exponer parámetro formato en window.api.recibos.imprimir/exportarPDF"
```

---

### Task 9: `recibos.js` — selector de formato en tabla y modal de detalle

**Files:**
- Modify: `src/renderer/js/recibos.js`

**Interfaces:**
- Consumes: `window.api.recibos.imprimir(id, formato)` / `.exportarPDF(id, formato)` (Task 8).
- Produces: `Recibos.renderSelectorFormato(idPrefix): string` (HTML del `<select>`), `Recibos.leerFormatoSeleccionado(idPrefix): string`. Reutilizado por `pagos.js` (Task 10).

- [ ] **Step 1: Agregar la lista de formatos y los helpers de selector**

En `src/renderer/js/recibos.js`, agregar cerca del inicio del objeto `Recibos` (junto a `currentPage`/`limit`/`search`):

```javascript
  FORMATOS_IMPRESION: [
    { value: '', label: 'Usar predeterminado' },
    { value: 'carta', label: 'Carta' },
    { value: 'termico_80mm', label: 'Térmica 80mm' }
  ],

  renderSelectorFormato(idPrefix) {
    return `
      <select id="formato_${idPrefix}" class="selector-formato-recibo" style="padding: 4px 6px; font-size: 0.8rem; border: 1px solid #cbd5e1; border-radius: 4px;">
        ${this.FORMATOS_IMPRESION.map(f => `<option value="${f.value}">${f.label}</option>`).join('')}
      </select>
    `;
  },

  leerFormatoSeleccionado(idPrefix) {
    const el = document.getElementById(`formato_${idPrefix}`);
    return el ? el.value : '';
  },
```

- [ ] **Step 2: Wiring en la tabla (`renderTable`)**

Reemplazar el bloque de acciones (líneas 217-224 del archivo original):

```javascript
              <td>
                <div class="table-actions">
                  <button class="btn btn-primary btn-icon" onclick="Recibos.showDetailModal(${r.id})">Ver</button>
                  ${this.renderSelectorFormato(`fila_${r.id}`)}
                  <button class="btn btn-secondary btn-icon" onclick="Recibos.imprimir(${r.id}, Recibos.leerFormatoSeleccionado('fila_${r.id}'))">Imprimir</button>
                  <button class="btn btn-success btn-icon" onclick="Recibos.exportarPDF(${r.id}, Recibos.leerFormatoSeleccionado('fila_${r.id}'))">PDF</button>
                  ${r.estado !== 'Anulado' ? `<button class="btn btn-warning btn-icon" onclick="Recibos.showAnularModal(${r.id})">Anular</button>` : ''}
                </div>
              </td>
```

- [ ] **Step 3: Wiring en el modal de detalle (`showDetailModal`)**

Reemplazar el bloque de acciones del modal (líneas 329-335 del archivo original):

```javascript
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          ${this.renderSelectorFormato(`modal_${recibo.id}`)}
          <button class="btn btn-secondary" onclick="Recibos.imprimir(${recibo.id}, Recibos.leerFormatoSeleccionado('modal_${recibo.id}'))">Imprimir</button>
          <button class="btn btn-success" onclick="Recibos.exportarPDF(${recibo.id}, Recibos.leerFormatoSeleccionado('modal_${recibo.id}'))">Exportar PDF</button>
          ${recibo.estado !== 'Anulado' ? `<button class="btn btn-secondary" onclick="Recibos.showCorregirMetodoPagoModal(${recibo.id}, '${recibo.metodo_pago}')">Corregir Método de Pago</button>` : ''}
          ${recibo.estado !== 'Anulado' ? `<button class="btn btn-warning" onclick="App.closeModal(); Recibos.showAnularModal(${recibo.id})">Anular</button>` : ''}
        </div>
```

- [ ] **Step 4: Actualizar `imprimir`/`exportarPDF` para reenviar `formato`**

Reemplazar los métodos (líneas 457-482 del archivo original):

```javascript
  async imprimir(id, formato) {
    try {
      const response = await window.api.recibos.imprimir(id, formato);
      if (!response.success && !response.canceled) {
        App.toast('Error al imprimir: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al imprimir el recibo', 'error');
    }
  },

  async exportarPDF(id, formato) {
    try {
      const response = await window.api.recibos.exportarPDF(id, formato);
      if (response.canceled) return;
      if (response.success) {
        App.toast('PDF guardado en: ' + response.filePath);
      } else {
        App.toast('Error al exportar PDF: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al exportar el recibo a PDF', 'error');
    }
  },
```

- [ ] **Step 5: Verificación manual**

Con la app corriendo (`npm start`):
1. Ir a Recibos, en la tabla elegir "Térmica 80mm" en el selector de una fila y hacer clic en "PDF" — confirmar que el PDF resultante es angosto (80mm), sin cortar el contenido, y que conceptos largos aparecen en varias líneas.
2. Repetir con "Carta" — confirmar que el PDF es idéntico al que generaba la app antes de este cambio.
3. Repetir con "Usar predeterminado" (opción por defecto) — confirmar que usa el valor configurado en `configuracion.formato_impresion_recibo` (por ahora `'carta'`, hasta el Task 11).
4. Repetir los 3 casos desde el botón "Imprimir" (revisar el diálogo nativo de impresión — confirmar que no lanza error).
5. Repetir todo lo anterior desde el modal de detalle ("Ver").

- [ ] **Step 6: Commit**

```bash
git add src/renderer/js/recibos.js
git commit -m "feat(recibos): selector de formato de impresión en tabla y modal de detalle"
```

---

### Task 10: `pagos.js` — selector de formato en la confirmación tras registrar un pago

**Files:**
- Modify: `src/renderer/js/pagos.js:962-983`

**Interfaces:**
- Consumes: `Recibos.renderSelectorFormato`/`leerFormatoSeleccionado` (Task 9), `Recibos.imprimir`/`exportarPDF` (Task 9).

- [ ] **Step 1: Wiring del selector en `mostrarConfirmacionRecibo`**

Reemplazar el método completo (líneas 968-983 del archivo original):

```javascript
  mostrarConfirmacionRecibo(reciboId, numeroRecibo, mensaje, alCerrar = null) {
    const content = `
      <div class="modal-header"><h2>✓ ${mensaje}</h2></div>
      <p style="margin-bottom: 24px; color: #334155; font-size: 14px;">
        Recibo No. <strong>${numeroRecibo}</strong>
      </p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
        ${Recibos.renderSelectorFormato(`confirmacion_${reciboId}`)}
        <button type="button" class="btn btn-secondary btn-icon" onclick="Recibos.imprimir(${reciboId}, Recibos.leerFormatoSeleccionado('confirmacion_${reciboId}'))">Imprimir Recibo</button>
        <button type="button" class="btn btn-success btn-icon" onclick="Recibos.exportarPDF(${reciboId}, Recibos.leerFormatoSeleccionado('confirmacion_${reciboId}'))">Descargar PDF</button>
      </div>
    `;

    App.openModal(content);
    if (alCerrar) App.alCerrarModalSinResolver = alCerrar;
  },
```

- [ ] **Step 2: Verificación manual**

Con la app corriendo: registrar un aporte de sostenimiento (o un abono de conexión) desde Pagos, y en el modal de confirmación que aparece, probar el selector con "Carta" y "Térmica 80mm" en ambos botones (Imprimir Recibo / Descargar PDF) — confirmar que genera el recibo correcto para el pago recién registrado, en el formato elegido, sin crear un segundo recibo ni cambiar el número.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/js/pagos.js
git commit -m "feat(pagos): selector de formato de impresión en la confirmación tras registrar un pago"
```

---

### Task 11: `configuracion.js` — formato de impresión predeterminado en Configuración → General

**Files:**
- Modify: `src/renderer/js/configuracion.js:124-158,374-386`

**Interfaces:**
- Consumes: `window.api.config.getAll()` / `window.api.config.actualizar()` (ya existentes, ahora validan `formato_impresion_recibo` gracias al Task 4).

- [ ] **Step 1: Agregar el campo al formulario**

En `renderTabGeneral()`, dentro de la sección "Parámetros Generales" (después del bloque de `consecutivo_recibos`, líneas 126-130 del archivo original, antes de `valor_nuevo_punto`):

```javascript
            <div class="form-group">
              <label for="formato_impresion_recibo">Formato de Impresión de Recibos</label>
              <select id="formato_impresion_recibo" name="formato_impresion_recibo">
                <option value="carta" ${config.formato_impresion_recibo !== 'termico_80mm' ? 'selected' : ''}>Carta</option>
                <option value="termico_80mm" ${config.formato_impresion_recibo === 'termico_80mm' ? 'selected' : ''}>Térmica 80mm</option>
              </select>
              <small style="color: #64748b; font-size: 0.875rem;">Formato que se usa al elegir "Usar predeterminado" al imprimir o exportar un recibo. Se puede cambiar puntualmente en cada recibo sin afectar esta configuración.</small>
            </div>
```

- [ ] **Step 2: Incluirlo en `guardarConfiguracion()`**

En el objeto `datos` de `guardarConfiguracion()` (líneas 375-386 del archivo original), agregar:

```javascript
      formato_impresion_recibo: document.getElementById('formato_impresion_recibo').value,
```

- [ ] **Step 3: Verificación manual**

Con la app corriendo, como usuario Administrador: ir a Configuración → General, cambiar "Formato de Impresión de Recibos" a "Térmica 80mm", guardar, recargar la página de Configuración y confirmar que el valor persiste seleccionado. Luego ir a Recibos y usar "Usar predeterminado" en el selector de un recibo — confirmar que ahora genera el formato térmico sin necesidad de elegirlo explícitamente. Volver a poner "Carta" y repetir para confirmar que también persiste y vuelve a ser el predeterminado.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/js/configuracion.js
git commit -m "feat(configuracion): campo para el formato de impresión predeterminado de recibos"
```

---

## Verificación final de la suite completa

Tras completar los 11 tasks:

```bash
node --test --experimental-test-coverage src/**/*.test.js
```

(o el comando de test configurado en `package.json` si difiere — revisar `npm test`). Debe pasar sin regresiones en ningún archivo, no solo en los nuevos.
