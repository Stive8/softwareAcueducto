# Registrar Retiro (Banco → Caja) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al módulo de Caja un botón guiado "Registrar Retiro" que mueva dinero de Banco a Caja, espejo exacto de "Registrar Consignación" con la dirección invertida.

**Architecture:** Mismo patrón end-to-end que `registrarConsignacion`: `CajaService` crea un movimiento `Traslado` (origen Banco, destino Caja) y llama a `AsientoContableService.generarDesdeMovimientoTraslado` — sin ningún cambio en el motor de plantillas, que ya resuelve la cuenta dinámicamente desde `origen`/`destino` (confirmado en el spec).

**Tech Stack:** Node.js + Electron, better-sqlite3, `node:test`/`node:assert/strict` para pruebas de servicio (sin framework de testing de UI en este proyecto).

## Global Constraints

- Los montos son siempre pesos colombianos sin decimales — comparar con igualdad exacta, no con tolerancia de redondeo.
- **Permisos:** mismo nivel que Consignación — cualquier rol Usuario o Administrador (no Consulta). El canal `caja:registrarRetiro` **no** va en `CANALES_SOLO_ADMIN`.
- Es una operación financiera que crea un documento — debe protegerse contra doble envío: `opId` en `CANALES_IDEMPOTENTES` (`main.js`) + `App.protegerEnvioDoble` en el formulario (frontend).
- No se modifica `AsientoContableService`, `MotorContabilizacionService`, ninguna plantilla ni migración — el motor ya soporta esta dirección (plantilla `TRASLADO_CAJA_BANCO`, `plantilla_id=5`, resuelve cuenta vía `cuenta_mapeo_campo: 'origen'/'destino'`).
- Reutiliza `AsientoContableService.generarDesdeMovimientoTraslado(movimientoId, usuarioId)` — nunca insertar directamente en `movimientos` o `asientos_contables` a mano.

Spec completo: `docs/superpowers/specs/2026-07-21-registrar-retiro-design.md`

---

## Task 1: `CajaService.registrarRetiro()` — lógica de negocio

**Files:**
- Modify: `src/services/CajaService.js` — agregar el método nuevo, justo después de `registrarConsignacion` (línea 56 del archivo actual) y antes del comentario de `regularizarSaldos` (línea 58).
- Test: `src/services/CajaService.registrarRetiro.test.js` (nuevo).

**Interfaces:**
- Consumes: `CajaRepository.getSaldoBanco()` / `crearMovimiento(...)` / `transaccion(fn)` (ya existen, `src/repositories/CajaRepository.js`); `AsientoContableService.generarDesdeMovimientoTraslado(movimientoId, usuarioId)` (ya existe, `src/services/AsientoContableService.js:436-453`, sin modificar).
- Produces: `CajaService.registrarRetiro({ monto, fecha, observaciones }, usuarioId = null)` → `movimientoId` (number). Este es el método que consumirá Task 2 (IPC).

- [ ] **Step 1: Escribir el archivo de tests (falla porque `registrarRetiro` no existe aún)**

```javascript
// src/services/CajaService.registrarRetiro.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CajaService = require('./CajaService');
const AsientoContableService = require('./AsientoContableService');
const ConfiguracionService = require('./ConfiguracionService');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

function seedSaldoBanco(dbService, monto) {
  new ConfiguracionRepository(dbService).actualizar('saldo_banco_inicial', String(monto));
}

// A diferencia de seedSaldoBanco() (que solo alimenta el libro simple vía un UPDATE crudo a
// `configuracion`), este helper sincroniza TAMBIÉN la doble partida, igual que el camino real de
// producción (Configuración -> ConfiguracionService.actualizar -> AsientoContableService.
// sincronizarAperturaSaldoInicial). Es obligatorio para cualquier test que vaya a verificar
// verificarConciliacionCajaBanco(): si el saldo inicial se siembra solo con seedSaldoBanco(), la
// doble partida arranca en 0 mientras el libro simple arranca en el monto sembrado, y los dos
// libros ya están desconciliados ANTES de que el test haga nada (mismo hallazgo que en
// CajaService.regularizarSaldos.test.js, ver commit 69016e9 en la rama de esa feature).
function seedSaldoBancoConciliado(dbService, monto) {
  const asientoContableService = new AsientoContableService(dbService);
  new ConfiguracionService(dbService, asientoContableService).actualizar({ saldo_banco_inicial: monto }, 1);
}

test('registrarRetiro() rechaza un monto de cero o negativo', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.registrarRetiro({ monto: 0, fecha: '2026-01-01', observaciones: '' }),
      /El monto a retirar debe ser mayor a cero/
    );
    assert.throws(
      () => service.registrarRetiro({ monto: -500, fecha: '2026-01-01', observaciones: '' }),
      /El monto a retirar debe ser mayor a cero/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarRetiro() exige una fecha', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBanco(ctx.dbService, 1000000);
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.registrarRetiro({ monto: 100000, fecha: '', observaciones: '' }),
      /La fecha es obligatoria/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarRetiro() rechaza un monto mayor al saldo disponible en Banco', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBanco(ctx.dbService, 500000);
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.registrarRetiro({ monto: 600000, fecha: '2026-01-01', observaciones: '' }),
      /supera el saldo disponible en banco/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarRetiro() aumenta el saldo de Caja y disminuye el saldo de Banco por el mismo monto', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBanco(ctx.dbService, 5000000);
    const service = new CajaService(ctx.dbService);

    const saldoCajaAntes = service.repository.getSaldoCaja();
    const saldoBancoAntes = service.repository.getSaldoBanco();

    service.registrarRetiro({ monto: 800000, fecha: '2026-01-15', observaciones: 'Retiro para pago de mantenimiento' });

    assert.equal(service.repository.getSaldoCaja(), saldoCajaAntes + 800000);
    assert.equal(service.repository.getSaldoBanco(), saldoBancoAntes - 800000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarRetiro() genera el asiento contable correcto: débito Caja (110505), crédito Banco (111005)', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBanco(ctx.dbService, 5000000);
    const service = new CajaService(ctx.dbService);
    const asientoContableService = new AsientoContableService(ctx.dbService);

    const movimientoId = service.registrarRetiro({ monto: 800000, fecha: '2026-01-15', observaciones: '' }, 1);
    assert.ok(movimientoId, 'Debe devolver el id del movimiento creado');

    const db = ctx.dbService.getDb();
    const movimiento = db.prepare('SELECT * FROM movimientos WHERE id = ?').get(movimientoId);
    assert.equal(movimiento.tipo, 'Traslado');
    assert.equal(movimiento.origen, 'Banco');
    assert.equal(movimiento.destino, 'Caja');
    assert.equal(movimiento.monto, 800000);

    const asiento = db.prepare(`
      SELECT a.id FROM asientos_contables a WHERE a.referencia_tipo = 'Movimiento' AND a.referencia_id = ?
    `).get(movimientoId);
    assert.ok(asiento, 'Debe existir un asiento contable vinculado al movimiento');

    const lineas = asientoContableService.getById(asiento.id).lineas;
    const lineaCaja = lineas.find(l => l.cuenta_codigo === '110505');
    const lineaBanco = lineas.find(l => l.cuenta_codigo === '111005');
    assert.ok(lineaCaja && lineaBanco, 'El asiento debe tener una línea contra Caja (110505) y otra contra Banco (111005)');
    assert.equal(lineaCaja.debito, 800000, 'Caja recibe: débito');
    assert.equal(lineaCaja.credito, 0);
    assert.equal(lineaBanco.credito, 800000, 'Banco entrega: crédito');
    assert.equal(lineaBanco.debito, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('registrarRetiro() deja el libro simple y la doble partida conciliados después del retiro', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBancoConciliado(ctx.dbService, 5000000);
    const service = new CajaService(ctx.dbService);
    const asientoContableService = new AsientoContableService(ctx.dbService);

    service.registrarRetiro({ monto: 800000, fecha: '2026-01-15', observaciones: '' });

    const conciliacion = asientoContableService.verificarConciliacionCajaBanco();
    for (const fila of conciliacion) {
      assert.equal(fila.conciliado, true, `${fila.cuenta} debía estar conciliado`);
    }
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar los tests y confirmar que fallan**

Run: `npm test`
Expected: FAIL — los 6 tests nuevos de `CajaService.registrarRetiro.test.js` fallan con `TypeError: service.registrarRetiro is not a function`.

- [ ] **Step 3: Implementar `registrarRetiro()` en `CajaService`**

En `src/services/CajaService.js`, insertar el método nuevo inmediatamente después del cierre de `registrarConsignacion` (después de la línea `}` que cierra ese método, línea 56 del archivo actual) y antes del comentario `// Ajusta el saldo de Caja y/o Banco...` (línea 58):

```javascript
  // Retiro: se saca efectivo del banco para tener caja disponible.
  // Aumenta caja, disminuye banco (un único movimiento de tipo Traslado). Espejo de
  // registrarConsignacion con la dirección invertida — reutiliza el mismo motor de
  // plantillas (TRASLADO_CAJA_BANCO ya resuelve la cuenta dinámicamente desde
  // origen/destino, no hace falta ningún cambio ahí).
  registrarRetiro({ monto, fecha, observaciones }, usuarioId = null) {
    if (!monto || monto <= 0) throw new Error('El monto a retirar debe ser mayor a cero');
    if (!fecha) throw new Error('La fecha es obligatoria');

    const saldoBanco = this.repository.getSaldoBanco();
    if (monto > saldoBanco) {
      throw new Error(`El monto a retirar ($${monto}) supera el saldo disponible en banco ($${saldoBanco})`);
    }

    return this.repository.transaccion(() => {
      const movimientoId = this.repository.crearMovimiento({
        tipo: 'Traslado',
        origen: 'Banco',
        destino: 'Caja',
        monto,
        concepto: 'Retiro de banco a caja',
        referenciaTipo: 'Retiro',
        fechaMovimiento: fecha,
        observaciones
      });

      this.asientoContableService.generarDesdeMovimientoTraslado(movimientoId, usuarioId);

      return movimientoId;
    });
  }

```

- [ ] **Step 4: Ejecutar los tests y confirmar que pasan**

Run: `npm test`
Expected: PASS — todos los tests existentes de la suite siguen en verde, más los 6 nuevos de `CajaService.registrarRetiro.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/services/CajaService.js src/services/CajaService.registrarRetiro.test.js
git commit -m "$(cat <<'EOF'
feat(caja): agregar CajaService.registrarRetiro (Banco a Caja)

Espejo de registrarConsignacion con la dirección invertida: aumenta Caja,
disminuye Banco. Reutiliza AsientoContableService.generarDesdeMovimientoTraslado
sin cambios — la plantilla TRASLADO_CAJA_BANCO ya resuelve la cuenta
dinámicamente desde origen/destino.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Canal IPC `caja:registrarRetiro` + exposición en preload

**Files:**
- Modify: `main.js:142-144` (agregar a `CANALES_IDEMPOTENTES`; **no** tocar `CANALES_SOLO_ADMIN`), `main.js:1421-1428` (nuevo handler, después de `caja:registrarConsignacion`).
- Modify: `preload.js:82-88` (agregar `registrarRetiro` al objeto `caja`).

**Interfaces:**
- Consumes: `CajaService.registrarRetiro({ monto, fecha, observaciones }, usuarioId)` (Task 1).
- Produces: `window.api.caja.registrarRetiro({ monto, fecha, observaciones, opId })` → `Promise<{ success: true } | { success: false, error: string }>` (mismo shape que `registrarConsignacion`, sin `data`). Este es el punto de entrada que consumirá Task 3 (frontend).

No hay test automatizado para `main.js`/`preload.js` en este proyecto (confirmado: no existe suite de IPC/Electron main process). Este task se verifica end-to-end en Task 3.

- [ ] **Step 1: Agregar el canal a `CANALES_IDEMPOTENTES` en `main.js`**

Ubicar (línea 142-144):

```javascript
const CANALES_IDEMPOTENTES = new Set([
  'asientos:crearManual', 'gastos:create', 'caja:registrarConsignacion',
  'cajaMenor:reembolsar', 'pagos:registrarPagoSostenimiento', 'caja:regularizarSaldos'
]);
```

Reemplazar por:

```javascript
const CANALES_IDEMPOTENTES = new Set([
  'asientos:crearManual', 'gastos:create', 'caja:registrarConsignacion',
  'cajaMenor:reembolsar', 'pagos:registrarPagoSostenimiento', 'caja:regularizarSaldos',
  'caja:registrarRetiro'
]);
```

**No** se toca `CANALES_SOLO_ADMIN` (línea 95-109) — `caja:registrarRetiro` debe quedar con el mismo nivel de permiso que `caja:registrarConsignacion` (cualquier rol Usuario o Administrador), según el spec.

- [ ] **Step 2: Agregar el handler en `main.js`, después de `caja:registrarConsignacion`**

Ubicar (línea 1421-1428):

```javascript
  envolverHandle('caja:registrarConsignacion', async (event, payload) => {
    try {
      cajaService.registrarConsignacion(payload, sesionActual.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
```

Agregar inmediatamente después:

```javascript

  envolverHandle('caja:registrarRetiro', async (event, payload) => {
    try {
      cajaService.registrarRetiro(payload, sesionActual.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
```

- [ ] **Step 3: Exponer el canal en `preload.js`**

Ubicar (línea 82-88):

```javascript
  caja: {
    getSaldos: () => ipcRenderer.invoke('caja:getSaldos'),
    getMovimientos: (params) => ipcRenderer.invoke('caja:getMovimientos', params),
    registrarConsignacion: (payload) => ipcRenderer.invoke('caja:registrarConsignacion', payload),
    regularizarSaldos: (payload) => ipcRenderer.invoke('caja:regularizarSaldos', payload),
    getResumenPeriodo: (fechaDesde, fechaHasta) => ipcRenderer.invoke('caja:getResumenPeriodo', fechaDesde, fechaHasta)
  },
```

Reemplazar por:

```javascript
  caja: {
    getSaldos: () => ipcRenderer.invoke('caja:getSaldos'),
    getMovimientos: (params) => ipcRenderer.invoke('caja:getMovimientos', params),
    registrarConsignacion: (payload) => ipcRenderer.invoke('caja:registrarConsignacion', payload),
    registrarRetiro: (payload) => ipcRenderer.invoke('caja:registrarRetiro', payload),
    regularizarSaldos: (payload) => ipcRenderer.invoke('caja:regularizarSaldos', payload),
    getResumenPeriodo: (fechaDesde, fechaHasta) => ipcRenderer.invoke('caja:getResumenPeriodo', fechaDesde, fechaHasta)
  },
```

- [ ] **Step 4: Verificar que la suite de tests de servicio sigue pasando**

Run: `npm test`
Expected: PASS — sin regresión, confirma que no hay errores de sintaxis en `main.js`/`preload.js`.

- [ ] **Step 5: Commit**

```bash
git add main.js preload.js
git commit -m "$(cat <<'EOF'
feat(caja): exponer canal IPC caja:registrarRetiro

Cablea CajaService.registrarRetiro como canal IPC, protegido contra doble
envío por opId (CANALES_IDEMPOTENTES). Mismo nivel de permiso que
caja:registrarConsignacion (no restringido a Administrador): es una
operación rutinaria de manejo de caja, no una corrección contable.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Botón y modal "Registrar Retiro" en el módulo de Caja (frontend)

**Files:**
- Modify: `src/renderer/js/caja.js` — template de `load()` (línea 57, agregar botón junto a `btnConsignacion`), `setupEventListeners()` (línea 102-104, agregar listener), y agregar el método nuevo `showRetiroModal()` después de `showConsignacionModal()` (antes de `showRegularizarSaldosModal`, línea 413 del archivo actual).

**Interfaces:**
- Consumes: `window.api.caja.registrarRetiro({ monto, fecha, observaciones, opId })` (Task 2); `App.protegerEnvioDoble(form, fn)` (`src/renderer/js/app.js:276`); `App.attachMoneyInput(input)` / `App.parseMoneyValue(value)` (`src/renderer/js/app.js:433-449`); `App.openModal(content)` / `App.closeModal()` / `App.toast(message)`.
- Produces: UI final del feature — no hay más tasks después de este.

No hay suite de UI/e2e en este proyecto. Este task se verifica manualmente en la app real (`npm run dev`) — no es posible automatizar el click-through desde un entorno sin GUI.

- [ ] **Step 1: Agregar el botón "Registrar Retiro", junto a "Registrar Consignación"**

En `src/renderer/js/caja.js`, dentro de `load()`, ubicar (línea 55-59):

```javascript
            <input type="date" id="fechaDesdeFilter" class="filter-select" title="Desde" value="${this.fechaDesde}">
            <input type="date" id="fechaHastaFilter" class="filter-select" title="Hasta" value="${this.fechaHasta}">
            <button class="btn btn-primary" id="btnConsignacion">+ Registrar Consignación</button>
            ${App.currentUser.rol === 'Administrador' ? '<button class="btn btn-secondary" id="btnRegularizarSaldos">Ajustar saldos</button>' : ''}
          </div>
```

Reemplazar por (el botón de Retiro va sin gate de rol, a diferencia de "Ajustar saldos"):

```javascript
            <input type="date" id="fechaDesdeFilter" class="filter-select" title="Desde" value="${this.fechaDesde}">
            <input type="date" id="fechaHastaFilter" class="filter-select" title="Hasta" value="${this.fechaHasta}">
            <button class="btn btn-primary" id="btnConsignacion">+ Registrar Consignación</button>
            <button class="btn btn-secondary" id="btnRetiro">+ Registrar Retiro</button>
            ${App.currentUser.rol === 'Administrador' ? '<button class="btn btn-secondary" id="btnRegularizarSaldos">Ajustar saldos</button>' : ''}
          </div>
```

- [ ] **Step 2: Enlazar el listener del botón**

En `setupEventListeners()`, ubicar (línea 102-104):

```javascript
    document.getElementById('btnConsignacion').addEventListener('click', () => {
      this.showConsignacionModal();
    });
```

Reemplazar por:

```javascript
    document.getElementById('btnConsignacion').addEventListener('click', () => {
      this.showConsignacionModal();
    });

    document.getElementById('btnRetiro').addEventListener('click', () => {
      this.showRetiroModal();
    });
```

- [ ] **Step 3: Agregar el método `showRetiroModal()`**

En `src/renderer/js/caja.js`, ubicar el final de `showConsignacionModal()` (línea 410-412):

```javascript
        errorDiv.innerHTML = `<div class="error-message">Error al registrar la consignación</div>`;
      }
    });
  },

  showRegularizarSaldosModal(saldoCajaActual, saldoBancoActual) {
```

Reemplazar por (inserta el nuevo método entre ambos):

```javascript
        errorDiv.innerHTML = `<div class="error-message">Error al registrar la consignación</div>`;
      }
    });
  },

  showRetiroModal() {
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Registrar Retiro</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Nota:</strong> Disminuye el saldo de Banco y aumenta el saldo de Caja por el mismo monto.
        </p>
      </div>

      <div id="formError"></div>

      <form id="retiroForm">
        <div class="form-group">
          <label for="monto_retiro">Monto a Retirar <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="monto_retiro" name="monto_retiro" required>
          </div>
        </div>

        <div class="form-group">
          <label for="fecha_retiro">Fecha <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_retiro" name="fecha_retiro" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_retiro">Observaciones</label>
          <textarea id="observaciones_retiro" name="observaciones_retiro"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Retiro</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('monto_retiro'));

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('retiroForm'), async () => {
      const monto = App.parseMoneyValue(document.getElementById('monto_retiro').value);
      const fecha = document.getElementById('fecha_retiro').value;
      const observaciones = document.getElementById('observaciones_retiro').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.caja.registrarRetiro({ monto, fecha, observaciones, opId });

        if (response.success) {
          App.closeModal();
          this.loadSaldos();
          this.loadMovimientos();
          App.toast('Retiro registrado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el retiro</div>`;
      }
    });
  },

  showRegularizarSaldosModal(saldoCajaActual, saldoBancoActual) {
```

- [ ] **Step 4: Verificar sintaxis y ejecutar la suite (regresión)**

Run: `node --check src/renderer/js/caja.js`
Expected: sin salida (sintaxis válida).

Run: `npm test`
Expected: PASS — sin regresión.

- [ ] **Step 5: Verificar manualmente en la app**

Run: `npm run dev`

Checklist a verificar en la ventana de la app:
1. Ir a "Caja y Bancos" → confirmar que aparece el botón "+ Registrar Retiro" junto a "+ Registrar Consignación", visible para cualquier rol (a diferencia de "Ajustar saldos", que solo ve el Administrador).
2. Clic en "+ Registrar Retiro": el modal se abre con el texto de ayuda correcto ("Disminuye el saldo de Banco y aumenta el saldo de Caja").
3. Completar monto, fecha, y enviar con un monto dentro del saldo disponible en Banco → el modal se cierra, aparece el toast "Retiro registrado con éxito", y las tarjetas "Saldo en Caja" (sube) y "Saldo en Banco" (baja) se actualizan por el mismo monto.
4. Intentar un monto mayor al saldo disponible en Banco → debe mostrar el error "El monto a retirar ($X) supera el saldo disponible en banco ($Y)" sin cerrar el modal.
5. Ir a "Contabilidad" → "Asientos" → confirmar que aparece un nuevo asiento con concepto "Retiro de banco a caja", balanceado (débito Caja = crédito Banco).
6. Doble clic rápido en "Registrar Retiro" con un monto válido → confirmar que solo se crea **un** movimiento y **un** asiento (no dos).
7. Revisar la consola (F12) sin errores nuevos.

Expected: los 7 puntos se cumplen sin errores en consola.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/js/caja.js
git commit -m "$(cat <<'EOF'
feat(caja): agregar botón y modal "Registrar Retiro" (Banco a Caja)

Espejo de "Registrar Consignación" con la dirección invertida. Visible para
cualquier rol Usuario/Administrador (no restringido a Administrador, a
diferencia de "Ajustar saldos"), junto al botón de Consignación.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
