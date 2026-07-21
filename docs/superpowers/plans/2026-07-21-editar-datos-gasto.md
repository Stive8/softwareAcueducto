# Editar Concepto y Observaciones de un Gasto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir editar el concepto y las observaciones de un Gasto ya registrado, sin tocar contabilidad ni exigir que el período esté abierto.

**Architecture:** Espejo de `corregirMetodoPago` (mismo módulo, mismas validaciones de "gasto existe"/"no anulado"), pero sin la parte contable: un `UPDATE` directo a la tabla `gastos`, sin transacción, sin revertir/regenerar ningún asiento, sin validar período contable — porque estos dos campos nunca se copian a las líneas de un asiento.

**Tech Stack:** Node.js + Electron, better-sqlite3, `node:test`/`node:assert/strict` para pruebas de servicio (sin framework de testing de UI en este proyecto).

## Global Constraints

- Bloqueado si el gasto está `Anulado` — mensaje: "No se puede editar un gasto anulado".
- Concepto obligatorio (no vacío ni solo espacios) — mismo criterio que `GastoService.create()`.
- Observaciones es opcional; una cadena vacía se guarda como `NULL`.
- **No** se valida el período contable de la fecha del gasto (`PeriodoContableService.validarFechaPermitida`) — a propósito, porque estos campos no tienen efecto contable. Debe funcionar aunque el período esté Cerrado.
- **No** se toca `asientos_contables`/`movimientos_contables` ni `movimientos` — cero interacción con `AsientoContableService`.
- El canal IPC recibe **un solo objeto** `{ id, concepto, observaciones }` (no argumentos posicionales) para que la auditoría automática de `main.js` capture el detalle completo del cambio.
- **No** va en `CANALES_SOLO_ADMIN` (mismo nivel de permiso que `gastos:create`/`gastos:anular`/`gastos:corregirMetodoPago`, ninguno de los cuales está ahí).
- **No** va en `CANALES_IDEMPOTENTES` — es un `UPDATE` puro, no crea un documento financiero nuevo; un doble envío produce el mismo estado final.

Spec completo: `docs/superpowers/specs/2026-07-21-editar-datos-gasto-design.md`

---

## Task 1: `GastoService.actualizarDatos()` — lógica de negocio

**Files:**
- Modify: `src/repositories/GastoRepository.js` — agregar `actualizarDatos(id, { concepto, observaciones })`, justo después de `actualizarMetodoPago` (línea 195-201 del archivo actual) y antes de `anular` (línea 203).
- Modify: `src/services/GastoService.js` — agregar el método nuevo `actualizarDatos`, justo después de `corregirMetodoPago` (cierra en línea 173 del archivo actual) y antes del comentario de `adjuntarSoporte` (línea 175).
- Test: `src/services/GastoService.actualizarDatos.test.js` (nuevo).

**Interfaces:**
- Consumes: `GastoRepository.findById(id)` (ya existe); `GastoRepository.actualizarDatos(id, {concepto, observaciones})` (nuevo, este mismo task).
- Produces: `GastoService.actualizarDatos(id, { concepto, observaciones })` (sin retorno de interés). Este es el método que consumirá Task 2 (IPC).

- [ ] **Step 1: Agregar `actualizarDatos` al repositorio**

En `src/repositories/GastoRepository.js`, ubicar (línea 195-201):

```javascript
  actualizarMetodoPago(id, metodoPago, motivo) {
    this.db.prepare(`
      UPDATE gastos
      SET metodo_pago = ?, fecha_correccion_pago = CURRENT_TIMESTAMP, motivo_correccion_pago = ?
      WHERE id = ?
    `).run(metodoPago, motivo, id);
  }
```

Agregar inmediatamente después:

```javascript

  actualizarDatos(id, { concepto, observaciones }) {
    this.db.prepare(`
      UPDATE gastos SET concepto = ?, observaciones = ? WHERE id = ?
    `).run(concepto, observaciones || null, id);
  }
```

- [ ] **Step 2: Escribir el archivo de tests (falla porque `GastoService.actualizarDatos` no existe aún)**

```javascript
// src/services/GastoService.actualizarDatos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const GastoService = require('./GastoService');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');
const TerceroRepository = require('../repositories/TerceroRepository');

function crearTerceroDePrueba(dbService) {
  const repo = new TerceroRepository(dbService);
  return repo.create({
    tipoIdentificacion: 'Cédula de Ciudadanía', numeroIdentificacion: '123456', nombreRazonSocial: 'Proveedor de prueba',
    esProveedor: true
  });
}

// Gasto por Transferencia (no requiere saldo de efectivo previo, ver GastoService.saldo.test.js).
function crearGastoDePrueba(dbService, overrides = {}) {
  const service = new GastoService(dbService);
  const terceroId = crearTerceroDePrueba(dbService);
  const gastoId = service.create({
    fechaGasto: '2026-01-15', concepto: 'Concepto original', tipoGasto: 'Gastos Diversos',
    valor: 100000, metodoPago: 'Transferencia', terceroId, observaciones: 'Obs original',
    ...overrides
  }, null);
  return { service, gastoId };
}

test('actualizarDatos() rechaza un gasto inexistente', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new GastoService(ctx.dbService);
    assert.throws(() => service.actualizarDatos(9999, { concepto: 'x', observaciones: '' }), /no encontrado/i);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() rechaza editar un gasto anulado', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);
    service.anular(gastoId, 'Anulado para la prueba', null);

    assert.throws(
      () => service.actualizarDatos(gastoId, { concepto: 'Nuevo concepto', observaciones: '' }),
      /anulado/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() rechaza un concepto vacío o solo espacios', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);
    assert.throws(() => service.actualizarDatos(gastoId, { concepto: '   ', observaciones: '' }), /concepto es obligatorio/i);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() actualiza concepto y observaciones', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);

    service.actualizarDatos(gastoId, { concepto: 'Concepto corregido', observaciones: 'Observación nueva' });

    const gasto = service.getById(gastoId);
    assert.equal(gasto.concepto, 'Concepto corregido');
    assert.equal(gasto.observaciones, 'Observación nueva');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() permite dejar observaciones vacías (se guarda como NULL)', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);

    service.actualizarDatos(gastoId, { concepto: 'Concepto corregido', observaciones: '' });

    const gasto = service.getById(gastoId);
    assert.equal(gasto.observaciones, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() no toca el asiento contable del gasto (no crea reversión ni asiento nuevo)', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);
    const db = ctx.dbService.getDb();

    const asientoAntes = db.prepare(`SELECT id, estado FROM asientos_contables WHERE referencia_tipo = 'Gasto' AND referencia_id = ?`).get(gastoId);
    assert.ok(asientoAntes, 'Debe existir un asiento vinculado al gasto');
    assert.equal(asientoAntes.estado, 'Activo');

    service.actualizarDatos(gastoId, { concepto: 'Concepto corregido', observaciones: '' });

    const asientosDespues = db.prepare(`SELECT id, estado FROM asientos_contables WHERE referencia_tipo = 'Gasto' AND referencia_id = ?`).all(gastoId);
    assert.equal(asientosDespues.length, 1, 'No debe crearse ningún asiento nuevo (ni de reversión)');
    assert.equal(asientosDespues[0].id, asientoAntes.id);
    assert.equal(asientosDespues[0].estado, 'Activo');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('actualizarDatos() funciona aunque el período contable de la fecha del gasto ya esté Cerrado', () => {
  const ctx = crearDbTemporal();
  try {
    const { service, gastoId } = crearGastoDePrueba(ctx.dbService);

    const periodoContableService = new PeriodoContableService(new PeriodoContableRepository(ctx.dbService), ctx.dbService);
    const periodo = periodoContableService.validarFechaPermitida('2026-01-15');
    periodoContableService.cerrar(periodo.id, 1, 'Cierre de prueba');

    assert.doesNotThrow(() => service.actualizarDatos(gastoId, { concepto: 'Editado con período cerrado', observaciones: '' }));

    const gasto = service.getById(gastoId);
    assert.equal(gasto.concepto, 'Editado con período cerrado');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 3: Ejecutar los tests y confirmar que fallan**

Run: `npm test`
Expected: FAIL — los 7 tests nuevos de `GastoService.actualizarDatos.test.js` fallan con `TypeError: service.actualizarDatos is not a function`.

- [ ] **Step 4: Implementar `actualizarDatos()` en `GastoService`**

En `src/services/GastoService.js`, ubicar el final de `corregirMetodoPago` (línea 168-173):

```javascript
      this.repository.actualizarMetodoPago(id, nuevoMetodoPago, motivo);

      this.asientoContableService.revertirPorReferencia('Gasto', id, `Corrección método de pago: ${motivo}`, usuarioId);
      this.asientoContableService.generarDesdeGasto(id, usuarioId);
    });
  }

  // Adjuntar un soporte es solo metadata (referencia a Drive): no toca movimientos ni asientos
```

Reemplazar por (inserta el nuevo método entre ambos):

```javascript
      this.repository.actualizarMetodoPago(id, nuevoMetodoPago, motivo);

      this.asientoContableService.revertirPorReferencia('Gasto', id, `Corrección método de pago: ${motivo}`, usuarioId);
      this.asientoContableService.generarDesdeGasto(id, usuarioId);
    });
  }

  // Corrige el concepto y/o las observaciones de un gasto, sin tocar contabilidad: estos dos
  // campos nunca se copian a las líneas de un asiento (MotorContabilizacionService solo copia
  // cuenta_contable_id, montos y datos de tercero), así que no hace falta revertir/regenerar
  // nada. Por eso tampoco pasa por validarFechaPermitida: a diferencia de corregirMetodoPago,
  // esto funciona aunque el período contable de la fecha del gasto ya esté Cerrado.
  actualizarDatos(id, { concepto, observaciones }) {
    const gasto = this.repository.findById(id);
    if (!gasto) throw new Error('Gasto no encontrado');
    if (gasto.estado === 'Anulado') throw new Error('No se puede editar un gasto anulado');
    if (!concepto || !concepto.trim()) throw new Error('El concepto es obligatorio');

    this.repository.actualizarDatos(id, { concepto, observaciones });
  }

  // Adjuntar un soporte es solo metadata (referencia a Drive): no toca movimientos ni asientos
```

- [ ] **Step 5: Ejecutar los tests y confirmar que pasan**

Run: `npm test`
Expected: PASS — todos los tests existentes de la suite siguen en verde, más los 7 nuevos de `GastoService.actualizarDatos.test.js`.

- [ ] **Step 6: Commit**

```bash
git add src/repositories/GastoRepository.js src/services/GastoService.js src/services/GastoService.actualizarDatos.test.js
git commit -m "$(cat <<'EOF'
feat(gastos): agregar GastoService.actualizarDatos (concepto/observaciones)

Permite corregir el concepto y las observaciones de un gasto ya registrado
sin tocar contabilidad: un UPDATE directo, sin transacción, sin revertir ni
regenerar ningún asiento, y sin exigir que el período contable esté abierto
(estos campos nunca se copian a las líneas de un asiento).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Canal IPC `gastos:actualizarDatos` + exposición en preload

**Files:**
- Modify: `main.js:143-146` (**no** se toca — confirmar que `gastos:actualizarDatos` no se agrega ni a `CANALES_SOLO_ADMIN` ni a `CANALES_IDEMPOTENTES`), `main.js:1337-1344` (nuevo handler, después de `gastos:corregirMetodoPago`).
- Modify: `preload.js:70-81` (agregar `actualizarDatos` al objeto `gastos`).

**Interfaces:**
- Consumes: `GastoService.actualizarDatos(id, { concepto, observaciones })` (Task 1).
- Produces: `window.api.gastos.actualizarDatos({ id, concepto, observaciones })` → `Promise<{ success: true } | { success: false, error: string }>`. Este es el punto de entrada que consumirá Task 3 (frontend).

No hay test automatizado para `main.js`/`preload.js` en este proyecto (no existe suite de IPC/Electron main process). Este task se verifica end-to-end en Task 3.

- [ ] **Step 1: Agregar el handler en `main.js`, después de `gastos:corregirMetodoPago`**

Ubicar (línea 1337-1344):

```javascript
  envolverHandle('gastos:corregirMetodoPago', async (event, id, nuevoMetodoPago, motivo) => {
    try {
      gastoService.corregirMetodoPago(id, nuevoMetodoPago, motivo, sesionActual.id);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
```

Agregar inmediatamente después:

```javascript

  envolverHandle('gastos:actualizarDatos', async (event, payload) => {
    try {
      const { id, concepto, observaciones } = payload;
      gastoService.actualizarDatos(id, { concepto, observaciones });
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
```

**No** se toca `CANALES_SOLO_ADMIN` (línea 95-109) ni `CANALES_IDEMPOTENTES` (línea 142-146) — `gastos:actualizarDatos` debe quedar fuera de ambos, según el spec (mismo permiso que `gastos:create`; no crea un documento financiero nuevo, así que no necesita `opId`).

- [ ] **Step 2: Exponer el canal en `preload.js`**

Ubicar (línea 70-81):

```javascript
  gastos: {
    getAll: (params) => ipcRenderer.invoke('gastos:getAll', params),
    getStats: (params) => ipcRenderer.invoke('gastos:getStats', params),
    getById: (id) => ipcRenderer.invoke('gastos:getById', id),
    getTiposGasto: () => ipcRenderer.invoke('gastos:getTiposGasto'),
    create: (gastoData) => ipcRenderer.invoke('gastos:create', gastoData),
    anular: (id, motivo) => ipcRenderer.invoke('gastos:anular', id, motivo),
    corregirMetodoPago: (id, nuevoMetodoPago, motivo) => ipcRenderer.invoke('gastos:corregirMetodoPago', id, nuevoMetodoPago, motivo),
    adjuntarSoporte: (gastoId, tipoSoporte) => ipcRenderer.invoke('gastos:adjuntarSoporte', gastoId, tipoSoporte),
    getSoportes: (gastoId) => ipcRenderer.invoke('gastos:getSoportes', gastoId),
    getSoporte: (gastoId, soporteId) => ipcRenderer.invoke('gastos:getSoporte', gastoId, soporteId)
  },
```

Reemplazar por:

```javascript
  gastos: {
    getAll: (params) => ipcRenderer.invoke('gastos:getAll', params),
    getStats: (params) => ipcRenderer.invoke('gastos:getStats', params),
    getById: (id) => ipcRenderer.invoke('gastos:getById', id),
    getTiposGasto: () => ipcRenderer.invoke('gastos:getTiposGasto'),
    create: (gastoData) => ipcRenderer.invoke('gastos:create', gastoData),
    anular: (id, motivo) => ipcRenderer.invoke('gastos:anular', id, motivo),
    corregirMetodoPago: (id, nuevoMetodoPago, motivo) => ipcRenderer.invoke('gastos:corregirMetodoPago', id, nuevoMetodoPago, motivo),
    actualizarDatos: (payload) => ipcRenderer.invoke('gastos:actualizarDatos', payload),
    adjuntarSoporte: (gastoId, tipoSoporte) => ipcRenderer.invoke('gastos:adjuntarSoporte', gastoId, tipoSoporte),
    getSoportes: (gastoId) => ipcRenderer.invoke('gastos:getSoportes', gastoId),
    getSoporte: (gastoId, soporteId) => ipcRenderer.invoke('gastos:getSoporte', gastoId, soporteId)
  },
```

- [ ] **Step 3: Verificar que la suite de tests de servicio sigue pasando**

Run: `npm test`
Expected: PASS — sin regresión.

- [ ] **Step 4: Commit**

```bash
git add main.js preload.js
git commit -m "$(cat <<'EOF'
feat(gastos): exponer canal IPC gastos:actualizarDatos

Cablea GastoService.actualizarDatos como canal IPC. Recibe un solo objeto
{id, concepto, observaciones} (no argumentos posicionales) para que la
auditoría automática capture el detalle completo del cambio. Mismo nivel de
permiso que gastos:create (no restringido a Administrador); no requiere
protección de doble envío (no crea un documento financiero nuevo).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Botón y modal "Editar" en el detalle de Gasto (frontend)

**Files:**
- Modify: `src/renderer/js/gastos.js` — template de `showDetailModal` (línea 314, agregar botón "Editar" junto a "Corregir Método de Pago"), y agregar el método nuevo `showEditarDatosModal(id, concepto, observaciones)` después de `showCorregirMetodoPagoModal` (antes del comentario `// --- Proveedores`, línea 701 del archivo actual).

**Interfaces:**
- Consumes: `window.api.gastos.actualizarDatos({ id, concepto, observaciones })` (Task 2); `App.protegerEnvioDoble(form, fn)` (`src/renderer/js/app.js:276`); `App.openModal(content)` / `App.closeModal()` / `App.toast(message)`.
- Produces: UI final del feature — no hay más tasks después de este.

No hay suite de UI/e2e en este proyecto. Este task se verifica manualmente en la app real (`npm run dev`) — no es posible automatizar el click-through desde un entorno sin GUI.

- [ ] **Step 1: Agregar el botón "Editar" en el detalle del gasto**

En `src/renderer/js/gastos.js`, dentro de `showDetailModal`, ubicar (línea 311-316):

```javascript
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          ${gasto.estado !== 'Anulado' ? `<button class="btn btn-secondary" onclick="Gastos.agregarSoporte(${gasto.id})">+ Agregar Soporte</button>` : ''}
          ${gasto.estado !== 'Anulado' ? `<button class="btn btn-secondary" onclick="Gastos.showCorregirMetodoPagoModal(${gasto.id}, '${gasto.metodo_pago}')">Corregir Método de Pago</button>` : ''}
          ${gasto.estado !== 'Anulado' ? `<button class="btn btn-warning" onclick="App.closeModal(); Gastos.showAnularModal(${gasto.id})">Anular</button>` : ''}
        </div>
      `;
```

Reemplazar por:

```javascript
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          ${gasto.estado !== 'Anulado' ? `<button class="btn btn-secondary" onclick="Gastos.showEditarDatosModal(${gasto.id})">Editar</button>` : ''}
          ${gasto.estado !== 'Anulado' ? `<button class="btn btn-secondary" onclick="Gastos.agregarSoporte(${gasto.id})">+ Agregar Soporte</button>` : ''}
          ${gasto.estado !== 'Anulado' ? `<button class="btn btn-secondary" onclick="Gastos.showCorregirMetodoPagoModal(${gasto.id}, '${gasto.metodo_pago}')">Corregir Método de Pago</button>` : ''}
          ${gasto.estado !== 'Anulado' ? `<button class="btn btn-warning" onclick="App.closeModal(); Gastos.showAnularModal(${gasto.id})">Anular</button>` : ''}
        </div>
      `;
```

Nota: `showEditarDatosModal` recibe **solo el `id`** (no concepto/observaciones por parámetro de `onclick`, para evitar el problema de comillas en texto libre) y hace su propia llamada a `window.api.gastos.getById(id)` para obtener los valores actuales frescos, igual que ya hace `showDetailModal` al abrirse. Esto también evita mostrar datos obsoletos si el usuario reabre el modal de edición sin cerrar el detalle.

- [ ] **Step 2: Agregar el método `showEditarDatosModal()`**

En `src/renderer/js/gastos.js`, ubicar el final de `showCorregirMetodoPagoModal` (línea 698-701):

```javascript
        errorDiv.innerHTML = `<div class="error-message">Error al corregir el método de pago</div>`;
      }
    });
  },

  // --- Proveedores (catálogo de Terceros) ---
```

Reemplazar por (inserta el nuevo método entre ambos):

```javascript
        errorDiv.innerHTML = `<div class="error-message">Error al corregir el método de pago</div>`;
      }
    });
  },

  async showEditarDatosModal(id) {
    const response = await window.api.gastos.getById(id);
    if (!response.success) {
      App.toast('Error al cargar el gasto: ' + response.error, 'error');
      return;
    }
    const gasto = response.data;

    const content = `
      <div class="modal-header">
        <h2>Editar Gasto</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Nota:</strong> Solo se corrige el concepto y las observaciones. El valor, la fecha, el tercero y el método de pago quedan intactos.
        </p>
      </div>

      <div id="formError"></div>

      <form id="editarDatosForm">
        <div class="form-group">
          <label for="concepto_editar">Concepto <span style="color: #ef4444;">*</span></label>
          <input type="text" id="concepto_editar" name="concepto_editar" value="${this.escapeHtml(gasto.concepto)}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_editar">Observaciones</label>
          <textarea id="observaciones_editar" name="observaciones_editar">${this.escapeHtml(gasto.observaciones || '')}</textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar Cambios</button>
        </div>
      </form>
    `;

    App.openModal(content);

    App.protegerEnvioDoble(document.getElementById('editarDatosForm'), async () => {
      const concepto = document.getElementById('concepto_editar').value.trim();
      const observaciones = document.getElementById('observaciones_editar').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.gastos.actualizarDatos({ id, concepto, observaciones });

        if (response.success) {
          App.closeModal();
          this.loadGastos();
          App.toast('Gasto actualizado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al actualizar el gasto</div>`;
      }
    });
  },

  // --- Proveedores (catálogo de Terceros) ---
```

- [ ] **Step 3: Agregar el helper `escapeHtml`**

`Gastos.escapeHtml` no existe todavía en `src/renderer/js/gastos.js` (confirmado: no hay ningún helper de este tipo en `src/renderer/js/`). Es necesario porque, a diferencia del resto del formulario (que usa `value="${hoy}"` con valores generados por el sistema), en `showEditarDatosModal` el valor pre-cargado es texto libre existente que puede contener comillas o `<`/`>`, y sin escapar rompería el atributo `value`/el contenido del `<textarea>`.

En `src/renderer/js/gastos.js`, ubicar el final del archivo (línea 979-988):

```javascript
  formatNumber(num) {
    return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  },

  formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
  }
};
```

Reemplazar por (misma lógica que `escapeHtml` en `src/services/AsientoContableService.js:13-20`):

```javascript
  formatNumber(num) {
    return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  },

  formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
  },

  escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};
```

- [ ] **Step 4: Verificar sintaxis y ejecutar la suite (regresión)**

Run: `node --check src/renderer/js/gastos.js`
Expected: sin salida (sintaxis válida).

Run: `npm test`
Expected: PASS — sin regresión.

- [ ] **Step 5: Verificar manualmente en la app**

Run: `npm run dev`

Checklist a verificar en la ventana de la app:
1. Ir a "Gastos" → abrir el detalle de un gasto Activo → confirmar que aparece el botón "Editar" junto a "Corregir Método de Pago".
2. Clic en "Editar": el modal se abre con el concepto y las observaciones actuales precargados.
3. Cambiar el concepto a un texto con una comilla simple (ej. `Pago de válvula "12"`) y guardar → confirmar que se guarda correctamente y no rompe el modal al reabrirlo (prueba directa del escape de `escapeHtml`).
4. Dejar el concepto vacío y enviar → el `required` del HTML5 debe bloquear el envío.
5. Confirmar que el listado y el detalle reflejan el nuevo concepto/observaciones inmediatamente después de guardar.
6. Abrir el detalle de un gasto **Anulado** → confirmar que el botón "Editar" **no aparece**.
7. Ir a "Contabilidad" → "Asientos" → confirmar que el asiento contable del gasto editado sigue siendo exactamente el mismo (mismo número, mismo estado Activo, sin ningún asiento de reversión nuevo).
8. Revisar la consola (F12) sin errores nuevos.

Expected: los 8 puntos se cumplen sin errores en consola.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/js/gastos.js
git commit -m "$(cat <<'EOF'
feat(gastos): agregar botón y modal "Editar" (concepto/observaciones)

Botón en el detalle del gasto, visible solo si no está Anulado. Abre un
modal simple con concepto (requerido) y observaciones (opcional)
precargados, escapando el HTML para texto libre que pueda traer comillas.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
