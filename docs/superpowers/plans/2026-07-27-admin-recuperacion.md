# Cuenta de Administrador de Recuperación Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sembrar una cuenta `Administrador` de recuperación (`recuperacion`) protegida contra desactivación/edición desde la app, con una contraseña generada al azar en el primer arranque y mostrada una única vez, para que el cliente nunca quede sin ningún acceso Administrador.

**Architecture:** Todo vive en capas que ya existen — una migración SQL siembra la fila con un marcador de contraseña; `AuthService` gana un método para generarla y chequeos de protección en los métodos que ya existen (`login`, `toggleActivoUsuario`, `resetearPassword`, `cambiarPassword`, `crearUsuario`); `UsuarioRepository.findAll()` la excluye del listado; `main.js` llama al generador una vez al arrancar y muestra el resultado con el diálogo nativo de Electron. Sin tablas, servicios, pantallas ni canales IPC nuevos.

**Tech Stack:** Node.js (`crypto` nativo), better-sqlite3, Electron (`dialog.showMessageBox`), `node:test` + `node:assert/strict`.

## Global Constraints

- Sin dependencias nuevas — todo con `crypto` nativo de Node y funciones que ya existen (`hashPassword`).
- El marcador de contraseña pendiente es el literal `__PENDIENTE_GENERAR__`, exportado como la constante `PASSWORD_PENDIENTE_GENERAR` en `AuthService.js` — debe coincidir carácter por carácter con el valor insertado por la migración SQL.
- El nombre de usuario de la cuenta es literal `recuperacion` (minúsculas, sin tilde).
- La migración es el archivo número `035` (siguiente disponible tras `034_coordenadas_cuentas.sql`).
- La contraseña generada usa `crypto.randomBytes(12).toString('base64url')`.
- Los tests siguen el patrón ya establecido en el repo: `node:test` + `node:assert/strict`, ubicados junto al código que prueban, usando `crearDbTemporal()`/`cerrarDbTemporal()` de `src/testUtils/dbTemporal.js` para servicios, o el helper `migrarHasta()` (replicado de `017_terceros_no_informado_y_roles.test.js`) para tests de migración. Se corren con `npm test`.

---

## Task 1: Migración 035 — esquema y semilla de la cuenta de recuperación

**Files:**
- Create: `src/database/migrations/035_admin_recuperacion.sql`
- Test: `src/database/migrations/035_admin_recuperacion.test.js`

**Interfaces:**
- Produces: columna `usuarios.es_recuperacion` (`INTEGER NOT NULL DEFAULT 0`) y una fila `usuarios` con `usuario = 'recuperacion'`, `password = '__PENDIENTE_GENERAR__'`, `rol = 'Administrador'`, `es_recuperacion = 1`. Todas las tareas siguientes dependen de que esta columna y esta fila existan.

- [ ] **Step 1: Escribir el test de la migración (debe fallar primero porque el archivo `.sql` todavía no existe)**

```js
// src/database/migrations/035_admin_recuperacion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const DatabaseService = require('../DatabaseService');

// Aplica, en orden, todas las migraciones de este directorio cuyo nombre sea anterior a
// `limiteExcluido` (p.ej. '035_...') — replica el loop de DatabaseService.runMigrations() pero
// detenido justo antes de la migración bajo prueba, para poder sembrar datos intermedios.
function migrarHasta(dbService, limiteExcluido) {
  const db = dbService.getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (file >= limiteExcluido) break;
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    })();
  }
}

test('la migración 035 agrega la cuenta de recuperación sin afectar usuarios existentes', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-test-035-'));
  const dbService = new DatabaseService(baseDir);
  try {
    migrarHasta(dbService, '035_admin_recuperacion.sql');

    const db = dbService.getDb();
    // Reproduce una base de datos de cliente real: ya tiene un usuario operativo propio (además
    // del `admin` sembrado por 001) antes de llegar a esta migración.
    db.prepare(`
      INSERT INTO usuarios (usuario, password, nombre_completo, rol)
      VALUES ('operador1', 'hashPlaceholder', 'Operador de Prueba', 'Usuario')
    `).run();

    assert.doesNotThrow(() => dbService.runMigrations());

    const columnas = db.prepare(`PRAGMA table_info(usuarios)`).all();
    const colRecuperacion = columnas.find(c => c.name === 'es_recuperacion');
    assert.ok(colRecuperacion, 'falta la columna es_recuperacion en usuarios');
    assert.equal(colRecuperacion.notnull, 1);

    const recuperacion = db.prepare(`SELECT * FROM usuarios WHERE usuario = 'recuperacion'`).get();
    assert.ok(recuperacion, 'falta la fila de la cuenta de recuperación');
    assert.equal(recuperacion.rol, 'Administrador');
    assert.equal(recuperacion.es_recuperacion, 1);
    assert.equal(recuperacion.password, '__PENDIENTE_GENERAR__');
    assert.equal(recuperacion.activo, 1);

    // El usuario preexistente y el admin sembrado por 001 deben sobrevivir intactos.
    const operador = db.prepare(`SELECT * FROM usuarios WHERE usuario = 'operador1'`).get();
    assert.ok(operador);
    assert.equal(operador.es_recuperacion, 0);
    const admin = db.prepare(`SELECT * FROM usuarios WHERE usuario = 'admin'`).get();
    assert.ok(admin);
    assert.equal(admin.es_recuperacion, 0);
  } finally {
    dbService.close();
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `npm test`
Expected: FAIL — `dbService.runMigrations()` no encuentra ningún archivo `035_admin_recuperacion.sql`, o la fila `recuperacion` no existe (el `assert.ok(recuperacion, ...)` revienta).

- [ ] **Step 3: Crear la migración**

```sql
-- src/database/migrations/035_admin_recuperacion.sql
-- Cuenta de Administrador de recuperación: inmutable desde la app (ver AuthService), para que
-- el cliente nunca quede sin ningún acceso Administrador aunque desactive o pierda el resto de
-- sus cuentas. La contraseña real se genera al azar en el primer arranque posterior a esta
-- migración (AuthService.generarCredencialRecuperacionSiHaceFalta) y se muestra una única vez;
-- el valor de abajo es solo un marcador que nunca funciona como contraseña real.
ALTER TABLE usuarios ADD COLUMN es_recuperacion INTEGER NOT NULL DEFAULT 0;

INSERT INTO usuarios (usuario, password, nombre_completo, rol, es_recuperacion)
VALUES ('recuperacion', '__PENDIENTE_GENERAR__', 'Cuenta de Recuperación', 'Administrador', 1);
```

- [ ] **Step 4: Correr el test para confirmar que pasa**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/035_admin_recuperacion.sql src/database/migrations/035_admin_recuperacion.test.js
git commit -m "feat(auth): agregar migración 035 con la cuenta de Administrador de recuperación"
```

---

## Task 2: Generar la contraseña real de la cuenta de recuperación

**Files:**
- Modify: `src/services/AuthService.js:1-34` (imports, constante nueva, método `login`)
- Test: `src/services/AuthService.recuperacion.test.js` (nuevo)

**Interfaces:**
- Consumes: columna `usuarios.es_recuperacion` y fila `recuperacion` con password `__PENDIENTE_GENERAR__` (Task 1). `UsuarioRepository.findByUsuario`, `findById`, `updatePassword` (ya existen, sin cambios de firma). `hashPassword` de `src/utils/passwordHasher.js` (ya existe).
- Produces: `AuthService.generarCredencialRecuperacionSiHaceFalta()` → `string | null` (la contraseña en texto plano la primera vez, `null` en llamadas posteriores). Constante `PASSWORD_PENDIENTE_GENERAR = '__PENDIENTE_GENERAR__'` en el módulo `AuthService.js`, usada también por Tasks 3 y 4.

- [ ] **Step 1: Escribir los tests (deben fallar porque el método todavía no existe)**

```js
// src/services/AuthService.recuperacion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const AuthService = require('./AuthService');

test('generarCredencialRecuperacionSiHaceFalta() genera y guarda una contraseña la primera vez', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AuthService(ctx.dbService);

    const password = service.generarCredencialRecuperacionSiHaceFalta();

    assert.ok(password, 'debe devolver la contraseña generada');
    assert.ok(password.length >= 12, 'la contraseña generada debe ser suficientemente larga');
    assert.doesNotThrow(() => service.login('recuperacion', password));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('generarCredencialRecuperacionSiHaceFalta() no genera una segunda vez', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AuthService(ctx.dbService);

    const primera = service.generarCredencialRecuperacionSiHaceFalta();
    const segunda = service.generarCredencialRecuperacionSiHaceFalta();

    assert.ok(primera);
    assert.equal(segunda, null);
    // La primera contraseña generada sigue siendo válida (no se regeneró por debajo).
    assert.doesNotThrow(() => service.login('recuperacion', primera));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('login() rechaza el marcador __PENDIENTE_GENERAR__ como si fuera la contraseña', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AuthService(ctx.dbService);
    // Sin llamar a generarCredencialRecuperacionSiHaceFalta(): la cuenta sigue con el marcador
    // sembrado por la migración 035.
    assert.throws(
      () => service.login('recuperacion', '__PENDIENTE_GENERAR__'),
      /Usuario o contraseña incorrectos/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `npm test`
Expected: FAIL — `service.generarCredencialRecuperacionSiHaceFalta is not a function`.

- [ ] **Step 3: Agregar la constante, el import de `crypto`, y el método nuevo**

Reemplazar las líneas 1-4 de `src/services/AuthService.js`:

```js
const crypto = require('crypto');
const UsuarioRepository = require('../repositories/UsuarioRepository');
const { hashPassword, verifyPassword, isHashed } = require('../utils/passwordHasher');

const ROLES_VALIDOS = ['Administrador', 'Usuario', 'Consulta'];

// Marcador de la contraseña de la cuenta 'recuperacion' antes de que
// generarCredencialRecuperacionSiHaceFalta() la reemplace por una generada al azar (ver
// migración 035_admin_recuperacion.sql, que siembra la fila con este mismo valor literal).
const PASSWORD_PENDIENTE_GENERAR = '__PENDIENTE_GENERAR__';
```

Reemplazar el método `login` (líneas 11-34 del archivo original) por:

```js
  login(usuario, password) {
    if (!usuario || !usuario.trim() || !password) {
      throw new Error('Usuario y contraseña son obligatorios');
    }

    const user = this.repository.findByUsuario(usuario.trim());
    if (!user || !user.activo) {
      throw new Error('Usuario o contraseña incorrectos');
    }

    // La cuenta de recuperación todavía no tiene una contraseña real generada (ver
    // generarCredencialRecuperacionSiHaceFalta) — se rechaza con el mismo mensaje genérico,
    // para no revelar que la cuenta existe ni que el marcador es tratable como valor especial.
    if (user.es_recuperacion && user.password === PASSWORD_PENDIENTE_GENERAR) {
      throw new Error('Usuario o contraseña incorrectos');
    }

    if (!verifyPassword(password, user.password)) {
      throw new Error('Usuario o contraseña incorrectos');
    }

    // Migración silenciosa: la contraseña inicial de la Fase 1 estaba en texto plano.
    // Al validarse correctamente una vez, se cifra de inmediato para no dejarla expuesta.
    if (!isHashed(user.password)) {
      this.repository.updatePassword(user.id, hashPassword(password));
    }

    this.repository.updateUltimoAcceso(user.id);

    return { id: user.id, usuario: user.usuario, nombreCompleto: user.nombre_completo, rol: user.rol };
  }

  // Genera y guarda la contraseña real de la cuenta de recuperación la primera vez que se llama
  // tras la migración 035 (mientras siga con el marcador PASSWORD_PENDIENTE_GENERAR). Se llama
  // una única vez al arrancar la app (ver main.js) y devuelve la contraseña en texto plano SOLO
  // esa vez, para mostrarla al usuario; llamadas posteriores devuelven null porque ya no hay
  // nada pendiente.
  generarCredencialRecuperacionSiHaceFalta() {
    const cuenta = this.repository.findByUsuario('recuperacion');
    if (!cuenta || cuenta.password !== PASSWORD_PENDIENTE_GENERAR) {
      return null;
    }

    const passwordGenerada = crypto.randomBytes(12).toString('base64url');
    this.repository.updatePassword(cuenta.id, hashPassword(passwordGenerada));
    return passwordGenerada;
  }
```

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/AuthService.js src/services/AuthService.recuperacion.test.js
git commit -m "feat(auth): generar contraseña de la cuenta de recuperación al primer arranque"
```

---

## Task 3: Proteger la cuenta de recuperación contra edición

**Files:**
- Modify: `src/services/AuthService.js` (métodos `toggleActivoUsuario`, `resetearPassword`, `cambiarPassword`)
- Test: `src/services/AuthService.recuperacion.test.js` (agregar tests)

**Interfaces:**
- Consumes: `PASSWORD_PENDIENTE_GENERAR` y `generarCredencialRecuperacionSiHaceFalta()` de Task 2 (para poder loguearse como `recuperacion` en el test de `cambiarPassword`). Columna `usuarios.es_recuperacion` de Task 1.
- Produces: `toggleActivoUsuario`, `resetearPassword` y `cambiarPassword` lanzan `Error` si el usuario objetivo tiene `es_recuperacion = 1`. Ninguna firma cambia.

- [ ] **Step 1: Agregar los tests (deben fallar porque todavía no hay protección)**

Agregar al final de `src/services/AuthService.recuperacion.test.js`:

```js
test('toggleActivoUsuario() rechaza desactivar la cuenta de recuperación', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AuthService(ctx.dbService);
    const recuperacion = ctx.dbService.getDb().prepare(`SELECT id FROM usuarios WHERE usuario = 'recuperacion'`).get();

    assert.throws(
      () => service.toggleActivoUsuario(recuperacion.id, false, 999),
      /La cuenta de recuperación no se puede desactivar/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('resetearPassword() rechaza modificar la cuenta de recuperación', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AuthService(ctx.dbService);
    const recuperacion = ctx.dbService.getDb().prepare(`SELECT id FROM usuarios WHERE usuario = 'recuperacion'`).get();

    assert.throws(
      () => service.resetearPassword(recuperacion.id, 'otraClave123'),
      /La cuenta de recuperación no se puede modificar desde aquí/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('cambiarPassword() rechaza que la propia cuenta de recuperación cambie su contraseña', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AuthService(ctx.dbService);
    const passwordGenerada = service.generarCredencialRecuperacionSiHaceFalta();
    const recuperacion = ctx.dbService.getDb().prepare(`SELECT id FROM usuarios WHERE usuario = 'recuperacion'`).get();

    assert.throws(
      () => service.cambiarPassword(recuperacion.id, passwordGenerada, 'otraClave123'),
      /La cuenta de recuperación no se puede modificar desde aquí/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `npm test`
Expected: FAIL — las tres operaciones tienen éxito hoy en vez de lanzar error (ningún `assert.throws` se cumple).

- [ ] **Step 3: Agregar el chequeo de protección a los tres métodos**

Reemplazar `cambiarPassword` en `src/services/AuthService.js`:

```js
  cambiarPassword(usuarioId, passwordActual, passwordNueva) {
    if (!passwordNueva || passwordNueva.length < 4) {
      throw new Error('La nueva contraseña debe tener al menos 4 caracteres');
    }

    const user = this.repository.findById(usuarioId);
    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    if (user.es_recuperacion) {
      throw new Error('La cuenta de recuperación no se puede modificar desde aquí');
    }

    if (!verifyPassword(passwordActual, user.password)) {
      throw new Error('La contraseña actual es incorrecta');
    }

    this.repository.updatePassword(usuarioId, hashPassword(passwordNueva));
  }
```

Reemplazar `toggleActivoUsuario`:

```js
  toggleActivoUsuario(id, activo, usuarioQueEjecutaId) {
    if (id === usuarioQueEjecutaId) throw new Error('No puede desactivar su propio usuario');
    const user = this.repository.findById(id);
    if (!user) throw new Error('Usuario no encontrado');
    if (user.es_recuperacion) throw new Error('La cuenta de recuperación no se puede desactivar');
    this.repository.toggleActivo(id, activo);
  }
```

Reemplazar `resetearPassword`:

```js
  resetearPassword(id, passwordNueva) {
    if (!passwordNueva || passwordNueva.length < 4) throw new Error('La nueva contraseña debe tener al menos 4 caracteres');
    const user = this.repository.findById(id);
    if (!user) throw new Error('Usuario no encontrado');
    if (user.es_recuperacion) throw new Error('La cuenta de recuperación no se puede modificar desde aquí');
    this.repository.updatePassword(id, hashPassword(passwordNueva));
  }
```

- [ ] **Step 4: Correr los tests para confirmar que pasan (incluidos los de Tasks 1 y 2, que no deben romperse)**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/AuthService.js src/services/AuthService.recuperacion.test.js
git commit -m "feat(auth): impedir desactivar, resetear o autocambiar la cuenta de recuperación"
```

---

## Task 4: Reservar el nombre de usuario y ocultar la cuenta del listado

**Files:**
- Modify: `src/services/AuthService.js` (método `crearUsuario`)
- Modify: `src/repositories/UsuarioRepository.js:14-19` (método `findAll`)
- Test: `src/services/AuthService.recuperacion.test.js` (agregar tests)

**Interfaces:**
- Consumes: columna `usuarios.es_recuperacion` (Task 1).
- Produces: `crearUsuario` lanza `Error` si `usuario.trim().toLowerCase() === 'recuperacion'`. `UsuarioRepository.findAll()` (sin cambio de firma) ya no incluye filas con `es_recuperacion = 1`; `AuthService.getAll()` hereda ese comportamiento sin cambios propios.

- [ ] **Step 1: Agregar los tests (deben fallar)**

Agregar al final de `src/services/AuthService.recuperacion.test.js`:

```js
test('crearUsuario() rechaza el nombre reservado "recuperacion" (en cualquier capitalización)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AuthService(ctx.dbService);

    assert.throws(
      () => service.crearUsuario({ usuario: 'Recuperacion', password: 'clave123', nombreCompleto: 'Alguien', rol: 'Usuario' }),
      /Ese nombre de usuario está reservado/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('getAll() no incluye la cuenta de recuperación', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AuthService(ctx.dbService);

    const usuarios = service.getAll();

    assert.ok(usuarios.length > 0, 'debe seguir listando al resto de usuarios (ej. admin)');
    assert.ok(!usuarios.some(u => u.usuario === 'recuperacion'), 'no debe incluir la cuenta de recuperación');
  } finally {
    cerrarDbTemporal(ctx);
  }
});
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `npm test`
Expected: FAIL — `crearUsuario` acepta `'Recuperacion'` hoy, y `getAll()` incluye la cuenta de recuperación en el resultado.

- [ ] **Step 3: Aplicar los cambios**

Reemplazar `crearUsuario` en `src/services/AuthService.js`:

```js
  crearUsuario({ usuario, password, nombreCompleto, rol }) {
    if (!usuario || !usuario.trim()) throw new Error('El nombre de usuario es obligatorio');
    if (usuario.trim().toLowerCase() === 'recuperacion') throw new Error('Ese nombre de usuario está reservado');
    if (!password || password.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres');
    if (!nombreCompleto || !nombreCompleto.trim()) throw new Error('El nombre completo es obligatorio');
    if (!ROLES_VALIDOS.includes(rol)) throw new Error('Rol inválido');
    if (this.repository.findByUsuario(usuario.trim())) throw new Error(`Ya existe un usuario con el nombre "${usuario}"`);

    return this.repository.create({
      usuario: usuario.trim(),
      passwordHasheado: hashPassword(password),
      nombreCompleto: nombreCompleto.trim(),
      rol
    });
  }
```

Reemplazar `findAll` en `src/repositories/UsuarioRepository.js:14-19`:

```js
  findAll() {
    return this.db.prepare(`
      SELECT id, usuario, nombre_completo, rol, activo, fecha_creacion, fecha_ultimo_acceso
      FROM usuarios WHERE es_recuperacion = 0 ORDER BY id ASC
    `).all();
  }
```

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/AuthService.js src/repositories/UsuarioRepository.js src/services/AuthService.recuperacion.test.js
git commit -m "feat(auth): reservar el usuario 'recuperacion' y excluirlo del listado de usuarios"
```

---

## Task 5: Mostrar la contraseña generada al arrancar la app

**Files:**
- Modify: `main.js:284, 301, 322-323`

**Interfaces:**
- Consumes: `AuthService.generarCredencialRecuperacionSiHaceFalta()` de Task 2.
- Produces: ninguno (tarea de wiring, es el punto final de la cadena).

No hay ningún archivo `main.js.test.js` en el proyecto (la app no tiene tests automatizados de arranque); esta tarea se verifica manualmente, siguiendo la misma convención del resto de `main.js`.

- [ ] **Step 1: Hacer async el callback de `app.whenReady()` y llamar al generador tras construir `authService`**

En `main.js:284`, cambiar:

```js
app.whenReady().then(() => {
```

por:

```js
app.whenReady().then(async () => {
```

En `main.js:301`, cambiar:

```js
  authService = new AuthService(dbService);
```

por:

```js
  authService = new AuthService(dbService);
  const passwordRecuperacionGenerada = authService.generarCredencialRecuperacionSiHaceFalta();
```

- [ ] **Step 2: Mostrar el diálogo nativo antes de crear la ventana**

En `main.js:322-323`, cambiar:

```js
  setupIpcHandlers();
  createWindow();
```

por:

```js
  if (passwordRecuperacionGenerada) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Cuenta de recuperación creada',
      message: 'Se generó una cuenta de recuperación de emergencia para este sistema.',
      detail:
        `Usuario: recuperacion\n` +
        `Contraseña: ${passwordRecuperacionGenerada}\n\n` +
        `Guarde esta contraseña en un lugar seguro (fuera de este equipo). No se volverá a ` +
        `mostrar, y sirve para recuperar el acceso si todas las demás cuentas Administrador ` +
        `quedan desactivadas o sin contraseña conocida.`
    });
  }

  setupIpcHandlers();
  createWindow();
```

- [ ] **Step 3: Verificación manual — primer arranque muestra el diálogo**

Run: `npm run dev`

Expected: antes de que aparezca la ventana de login, se muestra un diálogo nativo titulado "Cuenta de recuperación creada" con el usuario `recuperacion` y una contraseña de ejemplo (16 caracteres, letras/números/`-`/`_`). Anotar esa contraseña.

- [ ] **Step 4: Verificación manual — login con la cuenta de recuperación funciona**

Cerrar el diálogo, esperar a que cargue la pantalla de login, e iniciar sesión con usuario `recuperacion` y la contraseña anotada en el Step 3.

Expected: login exitoso, con permisos de Administrador (por ejemplo, el menú de Configuración/Usuarios está disponible).

- [ ] **Step 5: Verificación manual — el diálogo no vuelve a aparecer**

Cerrar sesión, cerrar la app por completo, y volver a correr `npm run dev`.

Expected: la app arranca directo a la pantalla de login, sin mostrar el diálogo de nuevo (la contraseña ya fue generada y guardada en el Step 1 anterior).

- [ ] **Step 6: Commit**

```bash
git add main.js
git commit -m "feat(auth): mostrar la contraseña de la cuenta de recuperación una única vez al arrancar"
```
