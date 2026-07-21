# Ajuste / Regularización de Saldos de Caja y Banco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al Administrador una función reutilizable para ajustar el saldo de Caja y/o Banco al valor real (arqueo físico / extracto bancario), registrando la diferencia como un asiento contable auditable contra Patrimonio.

**Architecture:** Capa delgada sobre la maquinaria contable ya existente (`AsientoContableService.crearManual`), expuesta como un nuevo método de `CajaService`, un canal IPC protegido (solo Administrador + idempotente), y un modal en el módulo de Caja del renderer.

**Tech Stack:** Node.js + Electron, better-sqlite3, `node:test`/`node:assert/strict` para pruebas de servicio (sin framework de testing de UI en este proyecto).

## Global Constraints

- Los montos son siempre pesos colombianos sin decimales — comparar con igualdad exacta (`!== 0`, `===`), no con tolerancia de redondeo.
- Solo el rol Administrador puede ejecutar este ajuste — el canal IPC debe estar en `CANALES_SOLO_ADMIN` (`main.js`).
- Es una operación financiera que crea documentos — debe protegerse contra doble envío: `opId` en `CANALES_IDEMPOTENTES` (`main.js`) + `App.protegerEnvioDoble` en el formulario (frontend).
- La contrapartida contable es siempre la cuenta de Patrimonio `3105` — el usuario nunca elige cuenta.
- Se generan **dos asientos separados** por ajuste (uno para Caja, otro para Banco), no uno combinado — cada uno independientemente revertible.
- Reutiliza `AsientoContableService.crearManual` con `sincronizarLedgerSimple: true` (su valor por defecto) — nunca insertar directamente en `movimientos` o `asientos_contables` a mano.

Spec completo: `docs/superpowers/specs/2026-07-21-regularizacion-saldos-design.md`

---

## Task 1: `CajaService.regularizarSaldos()` — lógica de negocio

**Files:**
- Modify: `src/services/CajaService.js:1-8` (imports + constructor), y agregar métodos nuevos antes de la línea `module.exports = CajaService;` (línea 53 en el archivo actual).
- Test: `src/services/CajaService.regularizarSaldos.test.js` (nuevo).

**Interfaces:**
- Consumes: `CajaRepository.getSaldoCaja()` / `getSaldoBanco()` / `transaccion(fn)` (ya existen, `src/repositories/CajaRepository.js`); `CuentaAutomaticaRepository.getCuentaIdByClave(clave)` (`src/repositories/CuentaAutomaticaRepository.js:40`); `PlanCuentaRepository.findByCodigo(codigo)` (`src/repositories/PlanCuentaRepository.js:30`); `AsientoContableService.crearManual({ fecha, concepto, tipoComprobante, usuarioId, lineas })` (`src/services/AsientoContableService.js:376`).
- Produces: `CajaService.regularizarSaldos({ fecha, saldoRealCaja, saldoRealBanco, motivo, usuarioId = null })` → `{ ajusteCaja: number|null, ajusteBanco: number|null, saldoFinalCaja: number, saldoFinalBanco: number }`. Este es el método que consumirá Task 2 (IPC).

- [ ] **Step 1: Escribir el archivo de tests (falla porque `regularizarSaldos` no existe aún)**

```javascript
// src/services/CajaService.regularizarSaldos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CajaService = require('./CajaService');
const AsientoContableService = require('./AsientoContableService');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

function seedSaldoCaja(dbService, monto) {
  new ConfiguracionRepository(dbService).actualizar('saldo_caja_inicial', String(monto));
}

function seedSaldoBanco(dbService, monto) {
  new ConfiguracionRepository(dbService).actualizar('saldo_banco_inicial', String(monto));
}

test('regularizarSaldos() reduce el saldo de Caja cuando el saldo real es menor al calculado (egresos históricos no registrados)', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    const service = new CajaService(ctx.dbService);
    assert.equal(service.repository.getSaldoCaja(), 129000000);

    const resultado = service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Regularización de arranque: arqueo físico de caja'
    });

    assert.equal(resultado.saldoFinalCaja, 3000000);
    assert.ok(resultado.ajusteCaja, 'Debe haber creado un asiento de ajuste para Caja');
    assert.equal(resultado.ajusteBanco, null, 'No debe tocar Banco si no hay diferencia');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() aumenta el saldo de Banco cuando el saldo real es mayor al calculado', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBanco(ctx.dbService, 10000000);
    const service = new CajaService(ctx.dbService);

    const resultado = service.regularizarSaldos({
      fecha: '2026-01-15',
      saldoRealCaja: service.repository.getSaldoCaja(),
      saldoRealBanco: 15000000,
      motivo: 'Se encontró un rendimiento financiero no registrado'
    });

    assert.equal(resultado.saldoFinalBanco, 15000000);
    assert.ok(resultado.ajusteBanco);
    assert.equal(resultado.ajusteCaja, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() ajusta Caja y Banco a la vez, en dos asientos separados, cuando ambos difieren', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    seedSaldoBanco(ctx.dbService, 0);
    const service = new CajaService(ctx.dbService);

    const resultado = service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: 50000000,
      motivo: 'Regularización de arranque al 31/12/2025 (arqueo + extracto)'
    });

    assert.equal(resultado.saldoFinalCaja, 3000000);
    assert.equal(resultado.saldoFinalBanco, 50000000);
    assert.ok(resultado.ajusteCaja);
    assert.ok(resultado.ajusteBanco);
    assert.notEqual(resultado.ajusteCaja, resultado.ajusteBanco, 'Deben ser dos asientos separados');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() deja el libro simple y la doble partida conciliados después del ajuste', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    const service = new CajaService(ctx.dbService);
    const asientoContableService = new AsientoContableService(ctx.dbService);

    service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Regularización de arranque'
    });

    const conciliacion = asientoContableService.verificarConciliacionCajaBanco();
    const caja = conciliacion.find(f => f.cuenta === 'Caja');
    assert.equal(caja.saldoLedgerSimple, 3000000);
    assert.equal(caja.saldoDoblePartida, 3000000);
    assert.equal(caja.conciliado, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() rechaza el ajuste si los saldos reales ya coinciden con los calculados', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.regularizarSaldos({ fecha: '2026-01-01', saldoRealCaja: 0, saldoRealBanco: 0, motivo: 'No debería crear nada' }),
      /No hay ninguna diferencia/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() exige un motivo no vacío', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.regularizarSaldos({ fecha: '2026-01-01', saldoRealCaja: 5000, saldoRealBanco: 0, motivo: '   ' }),
      /motivo/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() rechaza saldos negativos', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.regularizarSaldos({ fecha: '2026-01-01', saldoRealCaja: -100, saldoRealBanco: 0, motivo: 'x' }),
      /mayor o igual a cero/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() es reutilizable: un segundo ajuste posterior no se acumula con el anterior', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    const service = new CajaService(ctx.dbService);

    service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Ajuste de arranque'
    });

    const resultado = service.regularizarSaldos({
      fecha: '2026-03-31',
      saldoRealCaja: 2500000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Diferencia por comisión bancaria no registrada'
    });

    assert.equal(resultado.saldoFinalCaja, 2500000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Ejecutar los tests y confirmar que fallan**

Run: `npm test -- --test-name-pattern=regularizarSaldos` (o simplemente `npm test`, que corre toda la suite)
Expected: FAIL — `TypeError: service.regularizarSaldos is not a function` en los 8 tests del archivo nuevo.

- [ ] **Step 3: Implementar `regularizarSaldos()` en `CajaService`**

Reemplazar el contenido completo de `src/services/CajaService.js` por:

```javascript
const CajaRepository = require('../repositories/CajaRepository');
const AsientoContableService = require('./AsientoContableService');
const CuentaAutomaticaRepository = require('../repositories/CuentaAutomaticaRepository');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');

class CajaService {
  constructor(dbService) {
    this.repository = new CajaRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
    this.cuentaAutomaticaRepository = new CuentaAutomaticaRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
  }

  getSaldos() {
    return {
      saldoCaja: this.repository.getSaldoCaja(),
      saldoBanco: this.repository.getSaldoBanco()
    };
  }

  getMovimientos(params) {
    return this.repository.findAllMovimientos(params);
  }

  getResumenPeriodo(fechaDesde, fechaHasta) {
    return this.repository.getResumenPeriodo(fechaDesde, fechaHasta);
  }

  // Consignación: el dinero recaudado en efectivo se deposita en el banco.
  // Disminuye caja, aumenta banco (un único movimiento de tipo Traslado).
  registrarConsignacion({ monto, fecha, observaciones }, usuarioId = null) {
    if (!monto || monto <= 0) throw new Error('El monto a consignar debe ser mayor a cero');
    if (!fecha) throw new Error('La fecha es obligatoria');

    const saldoCaja = this.repository.getSaldoCaja();
    if (monto > saldoCaja) {
      throw new Error(`El monto a consignar ($${monto}) supera el saldo disponible en caja ($${saldoCaja})`);
    }

    return this.repository.transaccion(() => {
      const movimientoId = this.repository.crearMovimiento({
        tipo: 'Traslado',
        origen: 'Caja',
        destino: 'Banco',
        monto,
        concepto: 'Consignación de caja a banco',
        referenciaTipo: 'Consignacion',
        fechaMovimiento: fecha,
        observaciones
      });

      this.asientoContableService.generarDesdeMovimientoTraslado(movimientoId, usuarioId);

      return movimientoId;
    });
  }

  // Ajusta el saldo de Caja y/o Banco al valor real (arqueo físico / extracto bancario),
  // registrando la diferencia como un asiento de "Regularización de Saldos" contra Patrimonio
  // (3105). Reutiliza AsientoContableService.crearManual con sincronizarLedgerSimple (su valor
  // por defecto), que sincroniza a la vez la doble partida y el libro simple `movimientos` que
  // alimenta el Dashboard. Reutilizable: cada llamada lleva del saldo calculado actual al nuevo
  // saldo real indicado, sin acumular con ajustes anteriores.
  regularizarSaldos({ fecha, saldoRealCaja, saldoRealBanco, motivo, usuarioId = null }) {
    if (!fecha) throw new Error('La fecha del ajuste es obligatoria');
    if (typeof saldoRealCaja !== 'number' || Number.isNaN(saldoRealCaja) || saldoRealCaja < 0) {
      throw new Error('El saldo real de Caja debe ser un número mayor o igual a cero');
    }
    if (typeof saldoRealBanco !== 'number' || Number.isNaN(saldoRealBanco) || saldoRealBanco < 0) {
      throw new Error('El saldo real de Banco debe ser un número mayor o igual a cero');
    }
    if (!motivo || !motivo.trim()) throw new Error('Debe indicar el motivo del ajuste');

    const diferenciaCaja = saldoRealCaja - this.repository.getSaldoCaja();
    const diferenciaBanco = saldoRealBanco - this.repository.getSaldoBanco();

    if (diferenciaCaja === 0 && diferenciaBanco === 0) {
      throw new Error('No hay ninguna diferencia que ajustar: los saldos ya coinciden con los valores ingresados');
    }

    return this.repository.transaccion(() => {
      const ajusteCaja = diferenciaCaja !== 0
        ? this._crearAsientoAjuste('CAJA', 'Caja', diferenciaCaja, fecha, motivo, usuarioId)
        : null;
      const ajusteBanco = diferenciaBanco !== 0
        ? this._crearAsientoAjuste('BANCO', 'Banco', diferenciaBanco, fecha, motivo, usuarioId)
        : null;

      return {
        ajusteCaja,
        ajusteBanco,
        saldoFinalCaja: this.repository.getSaldoCaja(),
        saldoFinalBanco: this.repository.getSaldoBanco()
      };
    });
  }

  // Un asiento por cuenta: si la diferencia es negativa (saldo real menor al calculado, el caso
  // típico de egresos históricos no registrados), se acredita Caja/Banco y se debita Patrimonio.
  // Si es positiva, al revés.
  _crearAsientoAjuste(claveCuentaAutomatica, nombreCuenta, diferencia, fecha, motivo, usuarioId) {
    const cuentaId = this.cuentaAutomaticaRepository.getCuentaIdByClave(claveCuentaAutomatica);
    if (!cuentaId) throw new Error(`No hay una cuenta automática configurada para ${nombreCuenta}`);

    const patrimonio = this.planCuentaRepository.findByCodigo('3105');
    if (!patrimonio) throw new Error('No se encontró la cuenta de Patrimonio (3105) para registrar el ajuste');

    const monto = Math.abs(diferencia);
    const lineas = diferencia > 0
      ? [
          { cuentaContableId: cuentaId, debito: monto, credito: 0 },
          { cuentaContableId: patrimonio.id, debito: 0, credito: monto }
        ]
      : [
          { cuentaContableId: patrimonio.id, debito: monto, credito: 0 },
          { cuentaContableId: cuentaId, debito: 0, credito: monto }
        ];

    return this.asientoContableService.crearManual({
      fecha,
      concepto: `Regularización de saldo de ${nombreCuenta} al ${fecha}: ${motivo}`,
      tipoComprobante: 'Regularización de Saldos',
      usuarioId,
      lineas
    });
  }
}

module.exports = CajaService;
```

- [ ] **Step 4: Ejecutar los tests y confirmar que pasan**

Run: `npm test`
Expected: PASS — todos los tests existentes de la suite siguen en verde, más los 8 nuevos de `CajaService.regularizarSaldos.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/services/CajaService.js src/services/CajaService.regularizarSaldos.test.js
git commit -m "$(cat <<'EOF'
feat(caja): agregar CajaService.regularizarSaldos para ajustar saldos a la realidad

Permite llevar el saldo de Caja y/o Banco al valor real (arqueo físico /
extracto bancario) mediante un asiento de regularización contra Patrimonio
(3105), reutilizando AsientoContableService.crearManual. Genera dos asientos
separados (uno por cuenta) cuando ambas difieren.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Canal IPC `caja:regularizarSaldos` + exposición en preload

**Files:**
- Modify: `main.js:95-109` (agregar a `CANALES_SOLO_ADMIN`), `main.js:141-144` (agregar a `CANALES_IDEMPOTENTES`), `main.js:1420-1427` (nuevo handler, después de `caja:registrarConsignacion`).
- Modify: `preload.js:82-87` (agregar `regularizarSaldos` al objeto `caja`).

**Interfaces:**
- Consumes: `CajaService.regularizarSaldos({ fecha, saldoRealCaja, saldoRealBanco, motivo, usuarioId })` (Task 1).
- Produces: `window.api.caja.regularizarSaldos({ fecha, saldoRealCaja, saldoRealBanco, motivo, opId })` → `Promise<{ success: true, data: { ajusteCaja, ajusteBanco, saldoFinalCaja, saldoFinalBanco } } | { success: false, error: string }>`. Este es el punto de entrada que consumirá Task 3 (frontend).

No hay test automatizado para `main.js`/`preload.js` en este proyecto (no hay suite de IPC ni de Electron main process — verificado: cero archivos `*.test.js` fuera de `src/` y `scripts/import-gastos/`). Este task se verifica end-to-end en Task 3, ejecutando la app real.

- [ ] **Step 1: Agregar el canal a `CANALES_SOLO_ADMIN` en `main.js`**

Ubicar (línea 95-109):

```javascript
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
  'cloudBackup:respaldarAhora',
  'cajaMenor:asignarResponsable', 'cajaMenor:reembolsar'
]);
```

Reemplazar la línea `'asientos:crearManual', 'asientos:revertir',` por:

```javascript
  'asientos:crearManual', 'asientos:revertir',
  'caja:regularizarSaldos',
```

- [ ] **Step 2: Agregar el canal a `CANALES_IDEMPOTENTES` en `main.js`**

Ubicar (línea 141-144):

```javascript
const CANALES_IDEMPOTENTES = new Set([
  'asientos:crearManual', 'gastos:create', 'caja:registrarConsignacion',
  'cajaMenor:reembolsar', 'pagos:registrarPagoSostenimiento'
]);
```

Reemplazar por:

```javascript
const CANALES_IDEMPOTENTES = new Set([
  'asientos:crearManual', 'gastos:create', 'caja:registrarConsignacion',
  'cajaMenor:reembolsar', 'pagos:registrarPagoSostenimiento', 'caja:regularizarSaldos'
]);
```

- [ ] **Step 3: Agregar el handler en `main.js`, después de `caja:registrarConsignacion`**

Ubicar (línea 1420-1427):

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

  envolverHandle('caja:regularizarSaldos', async (event, payload) => {
    try {
      const resultado = cajaService.regularizarSaldos({ ...payload, usuarioId: sesionActual.id });
      return { success: true, data: resultado };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
```

- [ ] **Step 4: Exponer el canal en `preload.js`**

Ubicar (línea 82-87):

```javascript
  caja: {
    getSaldos: () => ipcRenderer.invoke('caja:getSaldos'),
    getMovimientos: (params) => ipcRenderer.invoke('caja:getMovimientos', params),
    registrarConsignacion: (payload) => ipcRenderer.invoke('caja:registrarConsignacion', payload),
    getResumenPeriodo: (fechaDesde, fechaHasta) => ipcRenderer.invoke('caja:getResumenPeriodo', fechaDesde, fechaHasta)
  },
```

Reemplazar por:

```javascript
  caja: {
    getSaldos: () => ipcRenderer.invoke('caja:getSaldos'),
    getMovimientos: (params) => ipcRenderer.invoke('caja:getMovimientos', params),
    registrarConsignacion: (payload) => ipcRenderer.invoke('caja:registrarConsignacion', payload),
    regularizarSaldos: (payload) => ipcRenderer.invoke('caja:regularizarSaldos', payload),
    getResumenPeriodo: (fechaDesde, fechaHasta) => ipcRenderer.invoke('caja:getResumenPeriodo', fechaDesde, fechaHasta)
  },
```

- [ ] **Step 5: Verificar que la suite de tests de servicio sigue pasando (no debe haberse roto nada)**

Run: `npm test`
Expected: PASS — estos cambios no tocan código bajo test directo, pero confirma que no hay errores de sintaxis en `main.js`/`preload.js` que rompan el arranque usado indirectamente por otros tests.

- [ ] **Step 6: Commit**

```bash
git add main.js preload.js
git commit -m "$(cat <<'EOF'
feat(caja): exponer canal IPC caja:regularizarSaldos (solo Administrador)

Cablea CajaService.regularizarSaldos como canal IPC protegido: requiere rol
Administrador (CANALES_SOLO_ADMIN) y está protegido contra doble envío por
opId (CANALES_IDEMPOTENTES), igual que los demás formularios financieros.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Modal "Ajustar saldos" en el módulo de Caja (frontend)

**Files:**
- Modify: `src/renderer/js/caja.js` — template de `load()` (líneas 40-58, agregar botón condicionado a Administrador), `setupEventListeners()` (líneas 74-104, agregar listener condicional), `loadSaldos()` (líneas 106-126, guardar `this.saldoCaja`/`this.saldoBanco`), y agregar el método nuevo `showRegularizarSaldosModal()` después de `showConsignacionModal()` (antes de `formatNumber`, actualmente línea 395).

**Interfaces:**
- Consumes: `window.api.caja.regularizarSaldos({ fecha, saldoRealCaja, saldoRealBanco, motivo, opId })` (Task 2); `App.currentUser.rol` (patrón ya usado en `src/renderer/js/configuracion.js:19`); `App.protegerEnvioDoble(form, fn)` (`src/renderer/js/app.js:276`); `App.attachMoneyInput(input)` / `App.parseMoneyValue(value)` (`src/renderer/js/app.js:433-449`); `App.openModal(content)` / `App.closeModal()` / `App.toast(message)`.
- Produces: UI final del feature — no hay más tasks después de este.

No hay suite de UI/e2e en este proyecto (confirmado en Task 2). Este task se verifica manualmente en la app real, siguiendo el flujo completo.

- [ ] **Step 1: Agregar el botón "Ajustar saldos", visible solo para Administrador**

En `src/renderer/js/caja.js`, dentro de `load()`, ubicar (dentro del template de "Historial de Movimientos"):

```javascript
            <input type="date" id="fechaDesdeFilter" class="filter-select" title="Desde" value="${this.fechaDesde}">
            <input type="date" id="fechaHastaFilter" class="filter-select" title="Hasta" value="${this.fechaHasta}">
            <button class="btn btn-primary" id="btnConsignacion">+ Registrar Consignación</button>
          </div>
```

Reemplazar por:

```javascript
            <input type="date" id="fechaDesdeFilter" class="filter-select" title="Desde" value="${this.fechaDesde}">
            <input type="date" id="fechaHastaFilter" class="filter-select" title="Hasta" value="${this.fechaHasta}">
            <button class="btn btn-primary" id="btnConsignacion">+ Registrar Consignación</button>
            ${App.currentUser.rol === 'Administrador' ? '<button class="btn btn-secondary" id="btnRegularizarSaldos">Ajustar saldos</button>' : ''}
          </div>
```

- [ ] **Step 2: Enlazar el listener del botón (condicional, porque el botón puede no existir para roles no-Administrador)**

En `setupEventListeners()`, ubicar:

```javascript
    document.getElementById('btnConsignacion').addEventListener('click', () => {
      this.showConsignacionModal();
    });
  },
```

Reemplazar por:

```javascript
    document.getElementById('btnConsignacion').addEventListener('click', () => {
      this.showConsignacionModal();
    });

    const btnRegularizarSaldos = document.getElementById('btnRegularizarSaldos');
    if (btnRegularizarSaldos) {
      btnRegularizarSaldos.addEventListener('click', () => this.showRegularizarSaldosModal());
    }
  },
```

- [ ] **Step 3: Guardar los saldos actuales en `loadSaldos()` para poder pre-llenar el modal**

Ubicar:

```javascript
  async loadSaldos() {
    try {
      const response = await window.api.caja.getSaldos();
      const saldosGrid = document.getElementById('saldosGrid');

      if (!response.success) {
        saldosGrid.innerHTML = `<p style="color: #ef4444;">Error al cargar saldos: ${response.error}</p>`;
        return;
      }

      const { saldoCaja, saldoBanco } = response.data;

      saldosGrid.innerHTML = App.renderStatsGrid([
        { titulo: 'Saldo en Caja', valor: `$${this.formatNumber(saldoCaja)}`, icono: 'wallet' },
        { titulo: 'Saldo en Banco', valor: `$${this.formatNumber(saldoBanco)}`, icono: 'landmark' },
        { titulo: 'Total Disponible', valor: `$${this.formatNumber(saldoCaja + saldoBanco)}`, icono: 'barChart' }
      ]);
    } catch (error) {
      console.error('Error:', error);
    }
  },
```

Reemplazar por:

```javascript
  async loadSaldos() {
    try {
      const response = await window.api.caja.getSaldos();
      const saldosGrid = document.getElementById('saldosGrid');

      if (!response.success) {
        saldosGrid.innerHTML = `<p style="color: #ef4444;">Error al cargar saldos: ${response.error}</p>`;
        return;
      }

      const { saldoCaja, saldoBanco } = response.data;
      this.saldoCaja = saldoCaja;
      this.saldoBanco = saldoBanco;

      saldosGrid.innerHTML = App.renderStatsGrid([
        { titulo: 'Saldo en Caja', valor: `$${this.formatNumber(saldoCaja)}`, icono: 'wallet' },
        { titulo: 'Saldo en Banco', valor: `$${this.formatNumber(saldoBanco)}`, icono: 'landmark' },
        { titulo: 'Total Disponible', valor: `$${this.formatNumber(saldoCaja + saldoBanco)}`, icono: 'barChart' }
      ]);
    } catch (error) {
      console.error('Error:', error);
    }
  },
```

- [ ] **Step 4: Agregar el método `showRegularizarSaldosModal()`**

En `src/renderer/js/caja.js`, ubicar el final de `showConsignacionModal()`:

```javascript
        errorDiv.innerHTML = `<div class="error-message">Error al registrar la consignación</div>`;
      }
    });
  },

  formatNumber(num) {
```

Reemplazar por (inserta el nuevo método entre ambos):

```javascript
        errorDiv.innerHTML = `<div class="error-message">Error al registrar la consignación</div>`;
      }
    });
  },

  showRegularizarSaldosModal() {
    const hoy = new Date().toISOString().split('T')[0];
    const saldoCajaActual = this.saldoCaja || 0;
    const saldoBancoActual = this.saldoBanco || 0;

    const content = `
      <div class="modal-header">
        <h2>Ajustar Saldos de Caja y Banco</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          Usa esto cuando el saldo real (arqueo físico de caja / extracto bancario) no coincide con el
          saldo que calcula el sistema. La diferencia se registra como un asiento contable fechado y con
          motivo contra la cuenta de Patrimonio — no borra ni reemplaza los movimientos históricos.
        </p>
      </div>

      <div id="formError"></div>

      <form id="regularizarSaldosForm">
        <div class="form-group">
          <label for="fecha_ajuste">Fecha del ajuste <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_ajuste" name="fecha_ajuste" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="saldo_real_caja">Saldo real de Caja <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="saldo_real_caja" name="saldo_real_caja" value="${this.formatNumber(saldoCajaActual)}" required>
          </div>
          <small>Saldo calculado por el sistema: $${this.formatNumber(saldoCajaActual)}</small>
        </div>

        <div class="form-group">
          <label for="saldo_real_banco">Saldo real de Banco <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="saldo_real_banco" name="saldo_real_banco" value="${this.formatNumber(saldoBancoActual)}" required>
          </div>
          <small>Saldo calculado por el sistema: $${this.formatNumber(saldoBancoActual)}</small>
        </div>

        <div id="previewAjusteSaldos" style="margin: 12px 0; font-size: 0.875rem; color: #64748b;"></div>

        <div class="form-group">
          <label for="motivo_ajuste">Motivo <span style="color: #ef4444;">*</span></label>
          <textarea id="motivo_ajuste" name="motivo_ajuste" required placeholder="Ej: Regularización de saldos por registros históricos incompletos anteriores a 2026"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Ajuste</button>
        </div>
      </form>
    `;

    App.openModal(content);

    const inputCaja = document.getElementById('saldo_real_caja');
    const inputBanco = document.getElementById('saldo_real_banco');
    App.attachMoneyInput(inputCaja);
    App.attachMoneyInput(inputBanco);

    const actualizarPreview = () => {
      const diferenciaCaja = App.parseMoneyValue(inputCaja.value) - saldoCajaActual;
      const diferenciaBanco = App.parseMoneyValue(inputBanco.value) - saldoBancoActual;
      const preview = document.getElementById('previewAjusteSaldos');
      const partes = [];
      if (diferenciaCaja !== 0) {
        partes.push(`Caja: ${diferenciaCaja > 0 ? '+' : '-'}$${this.formatNumber(Math.abs(diferenciaCaja))}`);
      }
      if (diferenciaBanco !== 0) {
        partes.push(`Banco: ${diferenciaBanco > 0 ? '+' : '-'}$${this.formatNumber(Math.abs(diferenciaBanco))}`);
      }
      preview.textContent = partes.length > 0 ? `Se registrará un ajuste de: ${partes.join(' | ')}` : 'No hay ninguna diferencia que ajustar.';
    };

    inputCaja.addEventListener('input', actualizarPreview);
    inputBanco.addEventListener('input', actualizarPreview);
    actualizarPreview();

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('regularizarSaldosForm'), async () => {
      const fecha = document.getElementById('fecha_ajuste').value;
      const saldoRealCaja = App.parseMoneyValue(inputCaja.value);
      const saldoRealBanco = App.parseMoneyValue(inputBanco.value);
      const motivo = document.getElementById('motivo_ajuste').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.caja.regularizarSaldos({ fecha, saldoRealCaja, saldoRealBanco, motivo, opId });

        if (response.success) {
          App.closeModal();
          this.loadSaldos();
          this.loadMovimientos();
          App.toast('Ajuste de saldos registrado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el ajuste de saldos</div>`;
      }
    });
  },

  formatNumber(num) {
```

- [ ] **Step 5: Verificar manualmente en la app (no hay suite de UI automatizada)**

Run: `npm run dev`

Checklist a verificar en la ventana de la app:
1. Iniciar sesión como Administrador → ir a "Caja y Bancos" → confirmar que aparece el botón "Ajustar saldos" junto a "+ Registrar Consignación".
2. Iniciar sesión como un usuario con rol distinto de Administrador → ir a "Caja y Bancos" → confirmar que el botón "Ajustar saldos" **no aparece**.
3. Como Administrador, clic en "Ajustar saldos": el modal debe pre-llenar ambos campos con el saldo actual calculado.
4. Cambiar "Saldo real de Caja" a un valor menor → confirmar que el texto de vista previa bajo los campos muestra la diferencia negativa en tiempo real (ej. "Caja: -$126.000.000").
5. Dejar el motivo vacío y enviar → el formulario HTML5 (`required`) debe bloquear el envío.
6. Completar motivo y enviar con una diferencia real (ej. saldo real de Caja = 3.000.000, con saldo calculado de prueba distinto) → confirmar: el modal se cierra, aparece el toast "Ajuste de saldos registrado con éxito", y la tarjeta "Saldo en Caja" del Dashboard de Caja se actualiza al nuevo valor inmediatamente.
7. Ir a "Contabilidad" → "Asientos" → confirmar que aparece un nuevo asiento con concepto `Regularización de saldo de Caja al <fecha>: <motivo>`, tipo de comprobante "Regularización de Saldos", balanceado (débito = crédito).
8. Reabrir el modal "Ajustar saldos" sin cambiar ningún valor y enviar → debe fallar con el mensaje "No hay ninguna diferencia que ajustar: los saldos ya coinciden con los valores ingresados".
9. Doble clic rápido en "Registrar Ajuste" con una diferencia real → confirmar que solo se crea **un** asiento (no dos), verificando en "Contabilidad" → "Asientos".

Expected: los 9 puntos se cumplen sin errores en consola (F12 → Console).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/js/caja.js
git commit -m "$(cat <<'EOF'
feat(caja): agregar modal "Ajustar saldos" al módulo de Caja

Botón visible solo para Administrador, junto a "Registrar Consignación".
Permite ingresar el saldo real de Caja y Banco (arqueo físico / extracto),
muestra la diferencia a registrar en vivo, y llama a
caja:regularizarSaldos al confirmar.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Fuera de alcance de este plan

Recordatorio del spec: una vez ejecutado este feature para el checkpoint real (fecha de corte, saldos verificados por arqueo/extracto), el siguiente paso operativo — **no de código** — es cerrar/bloquear los períodos contables hasta la fecha de corte desde el módulo de Contabilidad → Períodos (funcionalidad ya existente). Ese paso se hace después de correr el ajuste, nunca antes (si el período ya está cerrado, `regularizarSaldos` fallará al intentar asentar en esa fecha — comportamiento correcto).
