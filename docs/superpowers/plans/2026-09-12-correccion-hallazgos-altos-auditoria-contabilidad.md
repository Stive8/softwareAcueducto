# Corrección de hallazgos Alto (A1-A4) — Auditoría de Contabilidad 2026-09-11

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los 4 hallazgos de severidad Alto de la auditoría de contabilidad del 2026-09-11 (A1-A4), cada uno confirmado con repro real contra una base de datos temporal.

**Architecture:** Cuatro correcciones independientes entre sí, cada una acotada a su propio módulo (Caja, Configuración, Mapeo Contable, Gastos). No se toca el motor de plantillas (`MotorContabilizacionService`) ni el núcleo de `AsientoContableService.crear()`/`revertir()`: los cuatro fixes trabajan con las piezas que ya existen (asientos manuales, transacciones de `better-sqlite3`, migraciones numeradas).

**Tech Stack:** Node.js, Electron, better-sqlite3, `node:test` + `node:assert/strict` (runner propio en `scripts/test.js`, se invoca con `npm test`).

**Spec:** No hay spec separado — este plan implementa directamente los 4 hallazgos A1-A4 reportados por el agente de auditoría "Integración contabilidad-módulos de negocio" (2026-09-11), resumidos abajo en cada task con cita de archivo:línea del código actual.

## Global Constraints

- Todo monto es un entero en pesos colombianos, sin decimales (ver comentario de `TOLERANCIA` en `AsientoContableService.js:9-11`) — no introducir redondeos nuevos.
- Los repositorios comparten una única conexión `better-sqlite3` (`DatabaseService.getDb()`); `db.transaction(fn)()` anidado entre repositorios distintos ya es un patrón establecido (ver `AsientoContableRepository.transaccion`, usado dentro de `AsientoContableService.crear()` que a su vez se llama desde dentro de otras transacciones) — better-sqlite3 soporta anidar transacciones vía SAVEPOINT automáticamente, no hace falta nada especial.
- Todo test nuevo usa `crearDbTemporal()`/`cerrarDbTemporal()` de `src/testUtils/dbTemporal.js` (aplica todas las migraciones reales sobre una BD SQLite desechable) — nunca tocar `data/acueducto.db` desde un test.
- Correr la suite completa con `npm test` antes de cada commit, no solo el archivo nuevo: los cuatro fixes tocan código compartido (`AsientoContableService`, `GastoRepository`) que ya tiene tests existentes que no deben romperse.
- Mensajes de commit en español, formato `tipo(alcance): descripción`, terminados con la línea de atribución exacta que use el resto del repo.

---

## File Structure

- `src/services/AsientoContableService.js` — se agrega `getSaldoDoblePartida(clave)` (Task 1) y se corrigen los dos `return null` silenciosos de `sincronizarAperturaSaldoInicial` (Task 2).
- `src/services/CajaService.js` — `regularizarSaldos()`/`_crearAsientoAjuste()` pasan a cerrar también la divergencia previa entre libro simple y doble partida (Task 1).
- `src/repositories/ConfiguracionRepository.js` — se agrega `transaccion(fn)` (Task 2).
- `src/services/ConfiguracionService.js` — `actualizar()` pasa a ser atómico (Task 2).
- `src/database/migrations/044_mapeo_abono_deuda_anterior.sql` (nuevo) — mapea `RecibosDetalle/AbonoDeudaAnterior` a la cuenta de Sostenimiento (Task 3).
- `src/repositories/GastoRepository.js` — `actualizarMetodoPago()` gana un parámetro `cajaEfectivoId` (Task 4).
- `src/services/GastoService.js` — se extrae `_resolverCajaEfectivoId()` (reutilizada por `create()` y `corregirMetodoPago()`) (Task 4).

---

### Task 1: `CajaService.regularizarSaldos()` también cierra la doble partida, no solo el libro simple (A1)

**Qué está mal hoy:** `CajaService.js:106-107` calcula la diferencia del arqueo contra `this.repository.getSaldoCaja()`/`getSaldoBanco()` — el **libro simple** (tabla `movimientos`, lo que muestra el Dashboard/Caja). Ese cálculo está bien para su propósito original (llevar lo que ve la tesorera al valor real), y así lo confirman los tests ya existentes de `CajaService.regularizarSaldos.test.js`. El problema es que si el libro simple y la doble partida (Balance de Prueba) ya venían desincronizados ANTES del arqueo (exactamente lo que reportó el agente de auditoría: una fila de `movimientos` sin asiento contable detrás, el mismo patrón que el commit `797c4e7` tuvo que reparar a mano para 50 recibos), el ajuste deja el libro simple en el valor real pero la doble partida se queda arrastrando esa misma desincronización — y puede terminar **negativa**. Repro confirmado por el agente: con una divergencia previa de $300.000, un arqueo a $250.000 deja libro simple en $250.000 (correcto) pero doble partida en -$50.000 (incorrecto).

**Files:**
- Modify: `src/services/AsientoContableService.js:289` (insertar método nuevo justo después de `sincronizarLineaConCajaBanco`, antes del comentario de `verificarConciliacionCajaBanco`)
- Modify: `src/services/CajaService.js:96-158` (`regularizarSaldos` y `_crearAsientoAjuste`)
- Test: `src/services/CajaService.regularizarSaldos.test.js`

**Interfaces:**
- Produces: `AsientoContableService.getSaldoDoblePartida(claveCuentaAutomatica: 'CAJA'|'BANCO') -> number` — saldo acumulado en la doble partida (Libro Mayor, incluidas subcuentas) de esa cuenta automática. Devuelve `0` si la cuenta automática no está configurada.
- `CajaService._crearAsientoAjuste` gana un 6º parámetro posicional `sincronizarLedgerSimple` (boolean, sin default — todo llamador debe pasarlo explícito).

- [ ] **Step 1: Escribir el test que reproduce el hallazgo A1 (debe fallar con el código actual)**

Agregar al final de `src/services/CajaService.regularizarSaldos.test.js`:

```javascript
test('regularizarSaldos() también cierra una divergencia previa entre libro simple y doble partida (hallazgo Alto A1, auditoría 2026-09-11)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    const asientoContableService = new AsientoContableService(ctx.dbService);

    // Divergencia previa: una fila de libro simple ($300.000 de Ingreso en Caja) sin ningún
    // asiento contable detrás -- el mismo patrón que el commit 797c4e7 tuvo que reparar a mano
    // para 50 recibos reales. La doble partida queda en 0 mientras el libro simple ya tiene 300.000.
    service.repository.crearMovimiento({
      tipo: 'Ingreso', origen: 'Caja', monto: 300000,
      concepto: 'Ingreso sin asiento (divergencia simulada)', fechaMovimiento: '2025-06-01'
    });
    assert.equal(service.repository.getSaldoCaja(), 300000);
    assert.equal(
      asientoContableService.verificarConciliacionCajaBanco().find(f => f.cuenta === 'Caja').saldoDoblePartida,
      0
    );

    const resultado = service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 250000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Arqueo físico de caja'
    });

    assert.equal(resultado.saldoFinalCaja, 250000);
    const caja = asientoContableService.verificarConciliacionCajaBanco().find(f => f.cuenta === 'Caja');
    assert.equal(caja.saldoLedgerSimple, 250000);
    assert.equal(caja.saldoDoblePartida, 250000, 'La doble partida debe terminar en el valor real, no en -50.000');
    assert.equal(caja.conciliado, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() no crea un asiento adicional si el libro simple y la doble partida ya estaban sincronizados', () => {
  const ctx = crearDbTemporal();
  try {
    const asientoContableService = new AsientoContableService(ctx.dbService);
    const configuracionService = new ConfiguracionService(ctx.dbService, asientoContableService);
    // Sembrar por el camino que sí mantiene ambos libros sincronizados desde el arranque (ver
    // ConfiguracionService.aperturaSaldoInicial.test.js), a diferencia de seedSaldoCaja() de
    // arriba (que solo toca el libro simple, a propósito, para los tests que no necesitan la
    // doble partida).
    configuracionService.actualizar({ saldo_caja_inicial: 129000000 }, 1);
    const service = new CajaService(ctx.dbService);

    const antes = asientoContableService.getAll({ limit: 1000 }).data.length;
    service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Arqueo físico de caja'
    });
    const despues = asientoContableService.getAll({ limit: 1000 }).data.length;

    // La apertura (ya contada en "antes") + exactamente 1 asiento de ajuste de Caja; ningún
    // segundo asiento de cierre de divergencia, porque no había ninguna divergencia que cerrar.
    assert.equal(despues - antes, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr los tests nuevos y confirmar que fallan**

Run: `npm test -- --test-name-pattern "regularizarSaldos"`
Expected: FAIL — el primer test nuevo debe mostrar `caja.saldoDoblePartida` en `-50000`, no `250000` (reproduce exactamente el hallazgo A1).

- [ ] **Step 3: Agregar `AsientoContableService.getSaldoDoblePartida()`**

En `src/services/AsientoContableService.js`, insertar este método nuevo inmediatamente después del cierre de `sincronizarLineaConCajaBanco()` (línea 289, justo antes del bloque de comentario que empieza "// Compara, para Caja y para Banco..." de `verificarConciliacionCajaBanco`):

```javascript
  // Saldo acumulado en la doble partida (Libro Mayor, incluidas subcuentas) de la cuenta
  // automática de Caja o Banco -- a diferencia de CajaRepository.getSaldoCaja()/getSaldoBanco()
  // (el libro simple que alimenta el Dashboard), este es el saldo que muestra el Balance de
  // Prueba. CajaService.regularizarSaldos() lo necesita por separado del libro simple para poder
  // cerrar una divergencia previa entre los dos libros, no solo llevar el libro simple al valor
  // real -- hallazgo Alto A1 de la auditoría de Contabilidad (2026-09-11).
  getSaldoDoblePartida(claveCuentaAutomatica) {
    const cuentaId = this.cuentaAutomaticaRepository.getCuentaIdByClave(claveCuentaAutomatica);
    if (!cuentaId) return 0;
    return this.repository.getSaldoConSubcuentas(cuentaId);
  }
```

- [ ] **Step 4: Reescribir `regularizarSaldos()` y `_crearAsientoAjuste()` en `CajaService.js`**

Reemplazar el método `regularizarSaldos` completo (líneas 96-128 del archivo actual):

```javascript
  // Ajusta el saldo de Caja y/o Banco al valor real (arqueo físico / extracto bancario),
  // registrando la diferencia como un asiento de "Regularización de Saldos" contra Patrimonio
  // (3105). Reutiliza AsientoContableService.crearManual con sincronizarLedgerSimple (su valor
  // por defecto), que sincroniza a la vez la doble partida y el libro simple `movimientos` que
  // alimenta el Dashboard. Reutilizable: cada llamada lleva del saldo calculado actual al nuevo
  // saldo real indicado, sin acumular con ajustes anteriores.
  //
  // Además, si el libro simple y la doble partida ya venían desincronizados ANTES de este ajuste
  // (p. ej. una fila de `movimientos` sin asiento detrás -- ver commit 797c4e7), el ajuste de
  // arriba por sí solo deja el libro simple en el valor real pero la doble partida arrastra esa
  // misma desincronización (puede quedar negativa). Se cierra aparte con un segundo asiento SOLO
  // de doble partida (sincronizarLedgerSimple=false), para no volver a tocar el libro simple que
  // el primer asiento ya dejó correcto -- hallazgo Alto A1 de la auditoría de Contabilidad
  // (2026-09-11).
  regularizarSaldos({ fecha, saldoRealCaja, saldoRealBanco, motivo, usuarioId = null }) {
    if (!fecha) throw new Error('La fecha del ajuste es obligatoria');
    if (typeof saldoRealCaja !== 'number' || Number.isNaN(saldoRealCaja) || saldoRealCaja < 0) {
      throw new Error('El saldo real de Caja debe ser un número mayor o igual a cero');
    }
    if (typeof saldoRealBanco !== 'number' || Number.isNaN(saldoRealBanco) || saldoRealBanco < 0) {
      throw new Error('El saldo real de Banco debe ser un número mayor o igual a cero');
    }
    if (!motivo || !motivo.trim()) throw new Error('Debe indicar el motivo del ajuste');

    const saldoLedgerSimpleCajaAntes = this.repository.getSaldoCaja();
    const saldoLedgerSimpleBancoAntes = this.repository.getSaldoBanco();
    const diferenciaCaja = saldoRealCaja - saldoLedgerSimpleCajaAntes;
    const diferenciaBanco = saldoRealBanco - saldoLedgerSimpleBancoAntes;

    if (diferenciaCaja === 0 && diferenciaBanco === 0) {
      throw new Error('No hay ninguna diferencia que ajustar: los saldos ya coinciden con los valores ingresados');
    }

    const divergenciaPreviaCaja = saldoLedgerSimpleCajaAntes - this.asientoContableService.getSaldoDoblePartida('CAJA');
    const divergenciaPreviaBanco = saldoLedgerSimpleBancoAntes - this.asientoContableService.getSaldoDoblePartida('BANCO');

    return this.repository.transaccion(() => {
      const ajusteCaja = diferenciaCaja !== 0
        ? this._crearAsientoAjuste('CAJA', 'Caja', diferenciaCaja, fecha, motivo, usuarioId, true)
        : null;
      const ajusteBanco = diferenciaBanco !== 0
        ? this._crearAsientoAjuste('BANCO', 'Banco', diferenciaBanco, fecha, motivo, usuarioId, true)
        : null;

      if (divergenciaPreviaCaja !== 0) {
        this._crearAsientoAjuste(
          'CAJA', 'Caja', divergenciaPreviaCaja, fecha,
          `Cierre de divergencia previa entre libro simple y doble partida (ajuste relacionado: ${motivo})`,
          usuarioId, false
        );
      }
      if (divergenciaPreviaBanco !== 0) {
        this._crearAsientoAjuste(
          'BANCO', 'Banco', divergenciaPreviaBanco, fecha,
          `Cierre de divergencia previa entre libro simple y doble partida (ajuste relacionado: ${motivo})`,
          usuarioId, false
        );
      }

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
  // Si es positiva, al revés. sincronizarLedgerSimple=false se usa para el segundo asiento de
  // cierre de divergencia de regularizarSaldos() (arriba): ese solo debe tocar la doble partida.
  _crearAsientoAjuste(claveCuentaAutomatica, nombreCuenta, diferencia, fecha, motivo, usuarioId, sincronizarLedgerSimple) {
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
      lineas,
      sincronizarLedgerSimple
    });
  }
```

- [ ] **Step 5: Correr los tests y confirmar que TODOS pasan (los nuevos y los 8 ya existentes del archivo)**

Run: `npm test -- --test-name-pattern "regularizarSaldos"`
Expected: PASS (10 tests: 8 existentes sin cambios de comportamiento + 2 nuevos)

- [ ] **Step 6: Correr la suite completa**

Run: `npm test`
Expected: PASS — en particular, confirmar que no se rompió nada en `AsientoContableService.*.test.js` (el nuevo método es puramente aditivo) ni en `ConfiguracionService.aperturaSaldoInicial.test.js`.

- [ ] **Step 7: Commit**

```bash
git add src/services/AsientoContableService.js src/services/CajaService.js src/services/CajaService.regularizarSaldos.test.js
git commit -m "$(cat <<'EOF'
fix(caja): regularizarSaldos cierra tambien la divergencia previa con la doble partida

El ajuste de saldos (arqueo) solo corregia el libro simple que ve el
Dashboard; si ya venia desincronizado de la doble partida (una fila de
movimientos sin asiento detras), el Balance de Prueba quedaba con la
misma desincronizacion o incluso en negativo. Ahora un segundo asiento,
solo de doble partida, cierra esa brecha -- hallazgo Alto A1 de la
auditoria de contabilidad (2026-09-11).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `ConfiguracionService.actualizar()` es atómico; `sincronizarAperturaSaldoInicial()` ya no falla en silencio (A2)

**Qué está mal hoy:** `ConfiguracionService.js:73-83` escribe cada clave de configuración (incluido `saldo_caja_inicial`/`saldo_banco_inicial`) en statements sueltos, y DESPUÉS, fuera de cualquier transacción, intenta crear el asiento de apertura. Si eso falla (p. ej. el período contable de la fecha de hoy está Cerrado — `AsientoContableService.js:358` → `crear()` → `validarFechaPermitida()`), la configuración ya quedó escrita pero el asiento no se creó: el usuario ve solo el mensaje de período cerrado y asume que nada se guardó, cuando en realidad sí. Además, `AsientoContableService.js:351` y `:354` devuelven `null` en silencio si falta la cuenta automática de Caja/Banco o la cuenta de Patrimonio (3105), en vez de avisar con un error.

**Files:**
- Modify: `src/repositories/ConfiguracionRepository.js` (agregar `transaccion`)
- Modify: `src/services/ConfiguracionService.js:73-83` (envolver en transacción)
- Modify: `src/services/AsientoContableService.js:339-372` (`sincronizarAperturaSaldoInicial`: lanzar en vez de `return null`)
- Test: `src/services/ConfiguracionService.aperturaSaldoInicial.test.js`

**Interfaces:**
- Produces: `ConfiguracionRepository.transaccion(fn) -> any` — mismo patrón que `this.db.transaction(fn)()` ya usado en `AsientoContableRepository`, `GastoRepository`, etc.
- `AsientoContableService.sincronizarAperturaSaldoInicial()` ya no devuelve `null` cuando falta la cuenta automática o la cuenta de Patrimonio: lanza `Error` en su lugar. Sigue devolviendo `null` cuando `monto <= 0` (caso normal, no es un error).

- [ ] **Step 1: Escribir los tests que reproducen el hallazgo A2 (deben fallar con el código actual)**

Agregar al final de `src/services/ConfiguracionService.aperturaSaldoInicial.test.js` (y agregar los imports que faltan arriba del archivo: `PeriodoContableRepository` y `PeriodoContableService`):

```javascript
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');

test('actualizar() no deja ningún cambio escrito si la sincronización del asiento de apertura falla (atómico)', () => {
  const ctx = crearDbTemporal();
  try {
    const asientoContableService = new AsientoContableService(ctx.dbService);
    const service = new ConfiguracionService(ctx.dbService, asientoContableService);
    const periodoContableService = new PeriodoContableService(new PeriodoContableRepository(ctx.dbService), ctx.dbService);

    const hoyISO = new Date().toISOString().split('T')[0];
    const periodo = periodoContableService.validarFechaPermitida(hoyISO);
    periodoContableService.cerrar(periodo.id, 1, 'Cierre de prueba');

    const antes = service.getAll();

    assert.throws(
      () => service.actualizar({ nombre_asociacion: 'Nuevo Nombre', saldo_caja_inicial: 500000 }, 1),
      /Cerrado/
    );

    const despues = service.getAll();
    assert.deepEqual(despues, antes, 'Ningún valor de configuración debe quedar escrito si el asiento de apertura no se pudo crear');
    assert.equal(
      asientoContableService.verificarConciliacionCajaBanco().find(f => f.cuenta === 'Caja').saldoDoblePartida,
      0
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('sincronizarAperturaSaldoInicial() lanza un error claro si falta la cuenta automática, en vez de fallar en silencio', () => {
  const ctx = crearDbTemporal();
  try {
    const asientoContableService = new AsientoContableService(ctx.dbService);
    // Ninguna instalación real queda así (las migraciones siempre siembran CAJA/BANCO), pero
    // reproduce una instalación a medio configurar sin tener que borrar migraciones.
    ctx.dbService.getDb().prepare(`DELETE FROM cuentas_automaticas WHERE clave = 'CAJA'`).run();

    assert.throws(
      () => asientoContableService.sincronizarAperturaSaldoInicial('CAJA', 500000, 1),
      /cuenta automática/i
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr los tests nuevos y confirmar que fallan**

Run: `npm test -- --test-name-pattern "aperturaSaldoInicial|sincronizarAperturaSaldoInicial"`
Expected: FAIL — el primer test nuevo debe mostrar que `despues.nombre_asociacion` SÍ cambió a `'Nuevo Nombre'` (la escritura no es atómica hoy); el segundo debe mostrar que la llamada devuelve `null` en vez de lanzar.

- [ ] **Step 3: Agregar `transaccion()` a `ConfiguracionRepository`**

En `src/repositories/ConfiguracionRepository.js`, agregar este método (mismo patrón que el resto de repositorios del proyecto):

```javascript
  transaccion(fn) {
    return this.db.transaction(fn)();
  }
```

- [ ] **Step 4: Envolver `ConfiguracionService.actualizar()` en una transacción**

Reemplazar, en `src/services/ConfiguracionService.js`, las líneas 73-83 (desde `for (const clave of CLAVES_EDITABLES)` hasta el cierre del `if (this.asientoContableService)`):

```javascript
    // Atómico: si sincronizarAperturaSaldoInicial() falla más abajo (p. ej. el período contable
    // de hoy está Cerrado), ninguna clave de configuración debe quedar escrita -- antes de este
    // fix, la configuración se guardaba igual aunque el asiento de apertura no se pudiera crear,
    // dejando el libro simple y la doble partida desincronizados sin ningún aviso real del
    // problema (hallazgo Alto A2 de la auditoría de Contabilidad, 2026-09-11).
    this.repository.transaccion(() => {
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
    });
```

- [ ] **Step 5: Hacer que `sincronizarAperturaSaldoInicial()` lance en vez de devolver `null` en silencio**

En `src/services/AsientoContableService.js`, reemplazar (dentro de `sincronizarAperturaSaldoInicial`, líneas 350-356 del archivo actual):

```javascript
    const cuentaId = this.cuentaAutomaticaRepository.getCuentaIdByClave(claveCuentaAutomatica);
    if (!cuentaId) return null; // cuenta automática no configurada; nada que sincronizar todavía

    const patrimonio = this.planCuentaRepository.findByCodigo('3105');
    if (!patrimonio) return null; // no debería pasar: '3105' se siembra en la migración 006

    const nombreCuenta = claveCuentaAutomatica === 'CAJA' ? 'Caja' : 'Bancos';
```

por:

```javascript
    const nombreCuenta = claveCuentaAutomatica === 'CAJA' ? 'Caja' : 'Bancos';

    // Antes devolvían null en silencio: Configuración guardaba el monto sin avisar que el
    // asiento de apertura no se pudo crear, dejando el libro simple y la doble partida
    // desincronizados sin ningún error visible -- hallazgo Alto A2 de la auditoría de
    // Contabilidad (2026-09-11). Ahora con actualizar() atómico (ver ConfiguracionService.js),
    // este error revierte también las claves de configuración que se iban a guardar junto con el
    // saldo inicial.
    const cuentaId = this.cuentaAutomaticaRepository.getCuentaIdByClave(claveCuentaAutomatica);
    if (!cuentaId) {
      throw new Error(`No se encontró la cuenta automática de ${nombreCuenta}; configúrela en Contabilidad > Cuentas Automáticas antes de fijar el saldo inicial.`);
    }

    const patrimonio = this.planCuentaRepository.findByCodigo('3105');
    if (!patrimonio) {
      throw new Error('No se encontró la cuenta de Patrimonio (3105) en el plan de cuentas; no se puede registrar el asiento de apertura.');
    }
```

- [ ] **Step 6: Correr los tests y confirmar que TODOS pasan**

Run: `npm test -- --test-name-pattern "aperturaSaldoInicial|sincronizarAperturaSaldoInicial"`
Expected: PASS (6 tests: 4 existentes sin cambios de comportamiento + 2 nuevos)

- [ ] **Step 7: Correr la suite completa**

Run: `npm test`
Expected: PASS — revisar en particular que ningún otro caller de `sincronizarAperturaSaldoInicial()` dependiera del `return null` silencioso (búsqueda: `grep -rn "sincronizarAperturaSaldoInicial" src/` antes de este step, para confirmar que el único caller es `ConfiguracionService.actualizar()`).

- [ ] **Step 8: Commit**

```bash
git add src/repositories/ConfiguracionRepository.js src/services/ConfiguracionService.js src/services/AsientoContableService.js src/services/ConfiguracionService.aperturaSaldoInicial.test.js
git commit -m "$(cat <<'EOF'
fix(configuracion): actualizar() es atomico con el asiento de apertura

Si sincronizarAperturaSaldoInicial() fallaba (periodo contable cerrado,
o falta alguna cuenta automatica/Patrimonio), la configuracion quedaba
escrita de todos modos -- el usuario veia el error y asumia que nada se
habia guardado. Ahora todo el cambio es una sola transaccion, y las dos
causas de fallo que antes devolvian null en silencio ahora lanzan un
error explicito. Hallazgo Alto A2 de la auditoria de contabilidad
(2026-09-11).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Mapear `RecibosDetalle/AbonoDeudaAnterior` a Sostenimiento, no a Ingresos Diversos (A3)

**Qué está mal hoy:** `PagoService.js:481` y `:563` clasifican el abono a deuda anterior al corte con `tipoConceptoContable: 'AbonoDeudaAnterior'`, pero no existe ninguna fila `('RecibosDetalle', 'AbonoDeudaAnterior', ...)` en `mapeo_conceptos_contables` (la semilla está en `src/database/migrations/006_plan_de_cuentas.sql:235-240`). `MapeoContableRepository.resolverCuentaContableId()` cae entonces al `__default__` de `RecibosDetalle`, que es `4295` "Ingresos Diversos" — así que el recaudo real de cuotas atrasadas se contabiliza como un ingreso no operacional. Lo correcto es la misma cuenta que usa `Sostenimiento` normal: `413505`.

**Files:**
- Create: `src/database/migrations/044_mapeo_abono_deuda_anterior.sql`
- Create: `src/database/migrations/044_mapeo_abono_deuda_anterior.test.js`

**Interfaces:**
- Consumes: nada nuevo — usa la tabla `mapeo_conceptos_contables` y `MapeoContableRepository.resolverCuentaContableId('RecibosDetalle', 'AbonoDeudaAnterior')` ya existentes.
- Produces: una fila nueva en `mapeo_conceptos_contables`, visible y editable desde la pantalla de Mapeo Contable (`MapeoContableRepository.findAll()` ya la va a listar automáticamente al existir la fila).

- [ ] **Step 1: Escribir el test de la migración (debe fallar con el código actual, porque el archivo .sql todavía no existe)**

Crear `src/database/migrations/044_mapeo_abono_deuda_anterior.test.js`:

```javascript
// src/database/migrations/044_mapeo_abono_deuda_anterior.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../../testUtils/dbTemporal');
const MapeoContableRepository = require('../../repositories/MapeoContableRepository');

test('044: AbonoDeudaAnterior se mapea a 413505 (Sostenimiento Mensual), no al __default__ de RecibosDetalle', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new MapeoContableRepository(ctx.dbService);
    const cuentaId = repo.resolverCuentaContableId('RecibosDetalle', 'AbonoDeudaAnterior');

    const db = ctx.dbService.getDb();
    const cuenta = db.prepare('SELECT codigo, nombre FROM plan_cuentas WHERE id = ?').get(cuentaId);
    const cuentaSostenimiento = db.prepare('SELECT id FROM plan_cuentas WHERE codigo = ?').get('413505');

    assert.equal(cuenta.codigo, '413505');
    assert.equal(cuentaId, cuentaSostenimiento.id);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('044: AbonoDeudaAnterior aparece como fila propia en el Mapeo Contable (no solo resuelto vía __default__)', () => {
  const ctx = crearDbTemporal();
  try {
    const repo = new MapeoContableRepository(ctx.dbService);
    const filas = repo.findAll('RecibosDetalle');
    const fila = filas.find(f => f.concepto === 'AbonoDeudaAnterior');

    assert.ok(fila, 'Debe existir una fila explícita para AbonoDeudaAnterior, visible en la pantalla de Mapeo Contable');
    assert.equal(fila.cuenta_codigo, '413505');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- --test-name-pattern "044:"`
Expected: FAIL con `cuenta` siendo `undefined` (o `cuenta.codigo` igual a `4295`, el `__default__`), porque la migración 044 todavía no existe.

- [ ] **Step 3: Crear la migración**

Crear `src/database/migrations/044_mapeo_abono_deuda_anterior.sql`:

```sql
-- 044_mapeo_abono_deuda_anterior.sql
-- PagoService.registrarPagoSostenimiento/registrarAbonoDeudaAnterior clasifican el abono a deuda
-- anterior al corte (2024) como tipoConceptoContable='AbonoDeudaAnterior' (ver PagoService.js,
-- crearReciboDetalle), pero nunca existió una fila ('RecibosDetalle', 'AbonoDeudaAnterior', ...)
-- en mapeo_conceptos_contables -- la semilla de 006_plan_de_cuentas.sql solo cubre Sostenimiento,
-- AbonoPuntoNuevo, AplicacionSaldoFavor y AbonoSaldoFavor. Sin una fila propia, el recaudo caía en
-- el __default__ de RecibosDetalle (4295 "Ingresos Diversos", una cuenta de ingreso NO
-- operacional) en vez de la cuenta real de Sostenimiento -- hallazgo Alto A3 de la auditoría de
-- Contabilidad (2026-09-11). Se mapea a la misma cuenta que Sostenimiento (413505): es el mismo
-- tipo de ingreso (cuota de sostenimiento), solo que de un período anterior al corte.
INSERT INTO mapeo_conceptos_contables (modulo, concepto, cuenta_contable_id) VALUES
  ('RecibosDetalle', 'AbonoDeudaAnterior', (SELECT id FROM plan_cuentas WHERE codigo = '413505'));
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test -- --test-name-pattern "044:"`
Expected: PASS

- [ ] **Step 5: Correr la suite completa**

Run: `npm test`
Expected: PASS. Nota: esto NO reclasifica ningún recibo ya contabilizado en producción contra `data/acueducto.db` (los asientos pasados quedan como están); si se quiere corregir el histórico real, es una corrección de datos aparte, fuera del alcance de este fix de código.

- [ ] **Step 6: Commit**

```bash
git add src/database/migrations/044_mapeo_abono_deuda_anterior.sql src/database/migrations/044_mapeo_abono_deuda_anterior.test.js
git commit -m "$(cat <<'EOF'
fix(contabilidad): mapear AbonoDeudaAnterior a Sostenimiento, no a Ingresos Diversos

PagoService ya clasificaba el abono a deuda anterior al corte con
tipoConceptoContable='AbonoDeudaAnterior', pero nunca existio la fila de
mapeo correspondiente en mapeo_conceptos_contables -- caia en el
__default__ de RecibosDetalle (4295 Ingresos Diversos), contabilizando
recaudo real de cuotas atrasadas como ingreso no operacional. Hallazgo
Alto A3 de la auditoria de contabilidad (2026-09-11).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Corregir método de pago de Transferencia a Efectivo ya no falla (A4)

**Qué está mal hoy:** `GastoRepository.actualizarMetodoPago(id, metodoPago, motivo)` (`GastoRepository.js:195-201`) solo actualiza `metodo_pago`, nunca `caja_efectivo_id`. Ese campo solo se llena en `create()` (`GastoService.js:58-81`), y solo cuando el gasto nace en efectivo. Al corregir un gasto de Transferencia hacia Efectivo, `caja_efectivo_id` se queda en `null`, y la plantilla vigente `GASTO_EFECTIVO` v2 (que resuelve su segunda línea vía `cuenta_contexto_campo` apuntando a ese campo, `migrations/029...sql:66-69`) no puede resolver la cuenta — `MotorContabilizacionService._resolverCuenta()` devuelve `null` y `_agregarLineaSimple()` lanza `"No se pudo resolver la cuenta para la línea..."`. La transacción revierte limpio (no hay datos huérfanos), pero la corrección Transferencia→Efectivo es inusable.

**Files:**
- Modify: `src/repositories/GastoRepository.js:195-201`
- Modify: `src/services/GastoService.js:43-81` (extraer `_resolverCajaEfectivoId`) y `:137-173` (`corregirMetodoPago`)
- Test: `src/services/GastoService.corregirMetodoPago.test.js` (nuevo)

**Interfaces:**
- Produces: `GastoRepository.actualizarMetodoPago(id, metodoPago, motivo, cajaEfectivoId = null)` — 4º parámetro nuevo, opcional con default `null` (retrocompatible con cualquier otro caller que no lo pase).
- Produces: `GastoService._resolverCajaEfectivoId(valor: number, cajaEfectivo?: 'Menor'|undefined) -> number` (id de cuenta contable) — lanza si no encuentra la cuenta o si el valor supera el saldo disponible. Reemplaza el bloque de resolución que hoy vive inline dentro de `create()`.

- [ ] **Step 1: Escribir el test que reproduce el hallazgo A4 (debe fallar con el código actual)**

Crear `src/services/GastoService.corregirMetodoPago.test.js`:

```javascript
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

function sembrarSaldoCaja(dbService, monto, codigoCuenta = '110505') {
  const db = dbService.getDb();
  const cuentaCaja = db.prepare('SELECT id FROM plan_cuentas WHERE codigo = ?').get(codigoCuenta);
  const cuentaCapital = db.prepare('SELECT id FROM plan_cuentas WHERE codigo = ?').get('3105');
  const asientoId = db.prepare(`
    INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen) VALUES (9001, '2026-01-01', 'Saldo inicial', 'Manual')
  `).run().lastInsertRowid;
  db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2026-01-01', ?, ?, 0, 'Saldo inicial', ?)`).run(cuentaCaja.id, monto, asientoId);
  db.prepare(`INSERT INTO movimientos_contables (fecha, cuenta_id, debito, credito, concepto, asiento_id) VALUES ('2026-01-01', ?, 0, ?, 'Saldo inicial', ?)`).run(cuentaCapital.id, monto, asientoId);
}

test('corregirMetodoPago() de Transferencia a Efectivo genera el asiento correctamente (hallazgo Alto A4, auditoría 2026-09-11)', () => {
  const ctx = crearDbTemporal();
  try {
    sembrarSaldoCaja(ctx.dbService, 200000);
    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    const gastoId = service.create({
      fechaGasto: '2026-01-15', concepto: 'Gasto por transferencia', tipoGasto: 'Gastos Diversos',
      valor: 30000, metodoPago: 'Transferencia', terceroId
    }, null);

    assert.doesNotThrow(() => service.corregirMetodoPago(gastoId, 'Efectivo', 'Se pagó en efectivo, no por transferencia', 1));

    const gasto = service.getById(gastoId);
    assert.equal(gasto.metodo_pago, 'Efectivo');

    const db = ctx.dbService.getDb();
    const cajaEfectivoId = db.prepare('SELECT caja_efectivo_id FROM gastos WHERE id = ?').get(gastoId).caja_efectivo_id;
    const cuentaCajaGeneral = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110505'`).get();
    assert.equal(cajaEfectivoId, cuentaCajaGeneral.id, 'caja_efectivo_id debe quedar resuelto a Caja General');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('corregirMetodoPago() de Transferencia a Efectivo rechaza si no hay saldo suficiente en Caja General', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    const gastoId = service.create({
      fechaGasto: '2026-01-15', concepto: 'Gasto por transferencia', tipoGasto: 'Gastos Diversos',
      valor: 30000, metodoPago: 'Transferencia', terceroId
    }, null);

    // Caja General arranca en 0: corregir a Efectivo debe rechazarse igual que create().
    assert.throws(
      () => service.corregirMetodoPago(gastoId, 'Efectivo', 'Se pagó en efectivo', 1),
      /saldo insuficiente/i
    );

    const gasto = service.getById(gastoId);
    assert.equal(gasto.metodo_pago, 'Transferencia', 'No debe haber cambiado nada si la corrección se rechaza');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('corregirMetodoPago() de Efectivo a Transferencia limpia caja_efectivo_id', () => {
  const ctx = crearDbTemporal();
  try {
    sembrarSaldoCaja(ctx.dbService, 200000);
    const service = new GastoService(ctx.dbService);
    const terceroId = crearTerceroDePrueba(ctx.dbService);

    const gastoId = service.create({
      fechaGasto: '2026-01-15', concepto: 'Gasto en efectivo', tipoGasto: 'Gastos Diversos',
      valor: 30000, metodoPago: 'Efectivo', terceroId
    }, null);

    service.corregirMetodoPago(gastoId, 'Transferencia', 'Se pagó por transferencia, no en efectivo', 1);

    const db = ctx.dbService.getDb();
    const cajaEfectivoId = db.prepare('SELECT caja_efectivo_id FROM gastos WHERE id = ?').get(gastoId).caja_efectivo_id;
    assert.equal(cajaEfectivoId, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npm test -- --test-name-pattern "corregirMetodoPago"`
Expected: FAIL — el primer test debe fallar con el mismo error que reportó el agente de auditoría: `"No se pudo resolver la cuenta para la línea 2 de la plantilla..."`.

- [ ] **Step 3: Extraer `_resolverCajaEfectivoId()` y usarlo en `create()`**

En `src/services/GastoService.js`, reemplazar dentro de `create()` (líneas 55-81 del archivo actual, desde el comentario "// Resuelve de cuál subcuenta de efectivo sale el gasto." hasta `gastoData.cajaEfectivoId = cajaEfectivoId;`):

```javascript
    gastoData.cajaEfectivoId = gastoData.metodoPago === 'Efectivo'
      ? this._resolverCajaEfectivoId(gastoData.valor, gastoData.cajaEfectivo)
      : null;
```

Y agregar el método nuevo, por ejemplo justo debajo de `create()`:

```javascript
  // Resuelve de cuál subcuenta de efectivo sale/entra un gasto ('Menor' solo se respeta si Caja
  // Menor está activa; en cualquier otro caso se usa Caja General), y valida que no deje la caja
  // física en negativo. Compartido por create() y corregirMetodoPago() (antes duplicado solo en
  // create(), lo que dejó a corregirMetodoPago() sin esta validación -- hallazgo Alto A4 de la
  // auditoría de Contabilidad, 2026-09-11).
  _resolverCajaEfectivoId(valor, cajaEfectivo) {
    const config = this.configuracionRepository.getAll();
    const usarCajaMenor = config.caja_menor_activa === 'true' && cajaEfectivo === 'Menor';
    const codigoCaja = usarCajaMenor ? '110510' : '110505';
    const cuentaCaja = this.planCuentaRepository.findByCodigo(codigoCaja);
    if (!cuentaCaja) throw new Error(`No se encontró la cuenta contable ${codigoCaja}; verifique el plan de cuentas`);

    // Un gasto en efectivo no puede dejar la caja física en negativo: eso sería un faltante de
    // efectivo que el sistema debe advertir en el momento de la captura, no descubrirse después
    // en un arqueo -- hallazgo Alto A-7 de la auditoría de Contabilidad (2026-07-03).
    const saldoDisponible = this.asientoContableService.getLibroMayor(cuentaCaja.id).saldoFinal;
    if (valor > saldoDisponible) {
      throw new Error(
        `Saldo insuficiente en ${usarCajaMenor ? 'Caja Menor' : 'Caja General'}: disponible $${saldoDisponible.toLocaleString('es-CO')}, ` +
        `se requieren $${Number(valor).toLocaleString('es-CO')}.`
      );
    }
    return cuentaCaja.id;
  }
```

- [ ] **Step 4: Actualizar `GastoRepository.actualizarMetodoPago()`**

En `src/repositories/GastoRepository.js`, reemplazar (líneas 195-201):

```javascript
  actualizarMetodoPago(id, metodoPago, motivo, cajaEfectivoId = null) {
    this.db.prepare(`
      UPDATE gastos
      SET metodo_pago = ?, caja_efectivo_id = ?, fecha_correccion_pago = CURRENT_TIMESTAMP, motivo_correccion_pago = ?
      WHERE id = ?
    `).run(metodoPago, cajaEfectivoId, motivo, id);
  }
```

- [ ] **Step 5: Actualizar `GastoService.corregirMetodoPago()`**

En `src/services/GastoService.js`, reemplazar el método completo (líneas 137-173 del archivo actual):

```javascript
  // Corrige a qué cuenta (Caja/Banco) quedó asociado el dinero de un gasto, sin anularlo: el
  // número, fecha, valor y tercero quedan intactos. Revierte el asiento activo y genera uno
  // nuevo (generarDesdeGasto relee metodo_pago/caja_efectivo_id ya actualizados), y crea su
  // propia contrapartida en el ledger simple `movimientos` porque revertirPorReferencia no lo
  // hace por sí sola.
  //
  // Al corregir hacia Efectivo, caja_efectivo_id debe resolverse igual que en create() -- sin
  // esto, GASTO_EFECTIVO (que lo usa como cuenta_contexto_campo) no podía generar el asiento y la
  // corrección fallaba siempre con un error incomprensible -- hallazgo Alto A4 de la auditoría de
  // Contabilidad (2026-09-11). Siempre resuelve contra Caja General (no ofrece elegir Caja
  // Menor): mismo comportamiento por defecto que ya tenía create() antes de que existiera Caja
  // Menor.
  corregirMetodoPago(id, nuevoMetodoPago, motivo, usuarioId = null) {
    const gasto = this.repository.findById(id);
    if (!gasto) throw new Error('Gasto no encontrado');
    if (gasto.estado === 'Anulado') throw new Error('No se puede corregir el método de pago de un gasto anulado');
    if (!METODOS_PAGO_VALIDOS.includes(nuevoMetodoPago)) throw new Error('Método de pago inválido');
    if (nuevoMetodoPago === gasto.metodo_pago) throw new Error('El método de pago indicado es igual al actual');
    if (!motivo || !motivo.trim()) throw new Error('Debe indicar el motivo de la corrección');

    const cajaEfectivoId = nuevoMetodoPago === 'Efectivo'
      ? this._resolverCajaEfectivoId(gasto.valor)
      : null;

    return this.repository.transaccion(() => {
      this.repository.crearMovimiento({
        tipo: 'Ingreso',
        origen: gasto.metodo_pago === 'Efectivo' ? 'Caja' : 'Banco',
        monto: gasto.valor,
        concepto: `Corrección método de pago (reversión): ${gasto.concepto}`,
        referenciaId: id,
        referenciaTipo: 'Gasto',
        fechaMovimiento: new Date().toISOString().split('T')[0],
        observaciones: motivo
      });

      this.repository.crearMovimiento({
        tipo: 'Egreso',
        origen: nuevoMetodoPago === 'Efectivo' ? 'Caja' : 'Banco',
        monto: gasto.valor,
        concepto: `Corrección método de pago: ${gasto.concepto}`,
        referenciaId: id,
        referenciaTipo: 'Gasto',
        fechaMovimiento: new Date().toISOString().split('T')[0],
        observaciones: motivo
      });

      this.repository.actualizarMetodoPago(id, nuevoMetodoPago, motivo, cajaEfectivoId);

      this.asientoContableService.revertirPorReferencia('Gasto', id, `Corrección método de pago: ${motivo}`, usuarioId);
      this.asientoContableService.generarDesdeGasto(id, usuarioId);
    });
  }
```

Nota: `_resolverCajaEfectivoId(gasto.valor)` se llama ANTES de `this.repository.transaccion(...)`, igual que la validación de saldo en `create()` hoy — así, si no hay saldo suficiente, se lanza antes de tocar nada (no hace falta que la transacción revierta nada).

- [ ] **Step 6: Correr los tests nuevos y confirmar que pasan**

Run: `npm test -- --test-name-pattern "corregirMetodoPago"`
Expected: PASS (3 tests nuevos)

- [ ] **Step 7: Correr la suite completa**

Run: `npm test`
Expected: PASS — revisar en particular `GastoService.saldo.test.js` y `GastoService.actualizarDatos.test.js` (no deben cambiar de comportamiento, `_resolverCajaEfectivoId` es una extracción, no un cambio de lógica para `create()`), y `AsientoContableService.revertir.test.js` (ya cubre `corregirMetodoPago` indirectamente).

- [ ] **Step 8: Commit**

```bash
git add src/repositories/GastoRepository.js src/services/GastoService.js src/services/GastoService.corregirMetodoPago.test.js
git commit -m "$(cat <<'EOF'
fix(gastos): corregir metodo de pago de Transferencia a Efectivo ya no falla

actualizarMetodoPago() nunca completaba caja_efectivo_id, campo que
GASTO_EFECTIVO necesita para resolver su segunda linea -- la correccion
Transferencia->Efectivo siempre terminaba en un error de plantilla
incomprensible. Se extrajo la resolucion (+ validacion de saldo) que ya
tenia create() a un metodo compartido, usado ahora tambien por
corregirMetodoPago(). Hallazgo Alto A4 de la auditoria de contabilidad
(2026-09-11).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:** los 4 hallazgos (A1, A2, A3, A4) tienen cada uno su Task con cita de archivo:línea del código actual, el problema exacto, y un test que reproduce el repro del agente de auditoría antes de corregirlo.

**Placeholder scan:** ningún paso usa "TBD"/"similar a"/"agregar validación apropiada" — cada step trae el código completo a escribir.

**Type consistency:** `_crearAsientoAjuste` se usa con 7 argumentos posicionales en los 4 call sites de Task 1 (consistente); `_resolverCajaEfectivoId(valor, cajaEfectivo)` se llama con 1 argumento desde `corregirMetodoPago` (cajaEfectivo `undefined` → default a Caja General, comportamiento documentado) y 2 desde `create()` (sin cambios de firma respecto al código ya existente); `actualizarMetodoPago(id, metodoPago, motivo, cajaEfectivoId)` tiene default `null` en el 4º parámetro, así que cualquier otro caller no listado en este plan (no se encontró ninguno fuera de `GastoService.corregirMetodoPago`) seguiría funcionando sin cambios.

Los 4 tasks son independientes entre sí y se pueden ejecutar y mergear en cualquier orden.
