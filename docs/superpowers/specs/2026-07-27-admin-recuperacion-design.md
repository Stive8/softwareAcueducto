# Diseño: Cuenta de Administrador de Recuperación

**Fecha:** 2026-07-27
**Estado:** Aprobado (diseño) — pendiente plan de implementación

## Problema

Hoy, si el personal del cliente desactiva o pierde el acceso de todas sus cuentas
Administrador (por error, olvido de contraseñas, etc.), no hay ninguna forma de recuperar el
acceso desde la propia aplicación — habría que intervenir la base de datos directamente.
Además, `AuthService.toggleActivoUsuario` (líneas 74-79) solo impide que un usuario se
autodesactive; un Administrador sí puede desactivar a *otro* Administrador, incluso si es el
único que queda, dejando el sistema sin ningún admin activo.

Solicitado el 2026-07-22 (ver `docs/guia-instalacion.md` §14). No confundir con el
`admin`/`admin123` sembrado por `001_create_initial_tables.sql` (líneas 318-320): esa es una
cuenta operativa normal, editable/desactivable como cualquier otra — no sirve como mecanismo de
recuperación.

## Contexto de negocio (define el diseño)

El plan actual es vender el sistema a una sola asociación, pero no se descarta venderlo a otra
en el futuro (existe `docs/ficha-tecnica-comercial-2026-07.md`, pensado como insumo para una
propuesta comercial a más clientes). Por eso la credencial de recuperación **no puede ser un
valor literal idéntico en todas las instalaciones**: un Electron `.asar` se desempaqueta en
segundos, así que cualquier string fijo en el código fuente es efectivamente público — si
alguna vez hay una segunda instalación, ese string sería una puerta trasera compartida entre
todos los clientes. La solución es generarla al azar en cada instalación, lo cual cuesta muy
poco código adicional (una llamada a una función que ya existe) y deja el diseño correcto sin
importar cuántos clientes termine teniendo el producto.

## Decisión de diseño (confirmada con el usuario)

Una cuenta `recuperacion` sembrada por migración, con rol `Administrador`, protegida a nivel de
`AuthService` para que nadie —ni un Administrador legítimo— pueda desactivarla, resetear su
contraseña, ni crear un usuario que la suplante. Sin pantallas nuevas, sin canales IPC nuevos,
sin tabla nueva: todo vive en el esquema de `usuarios` y en los métodos que ya existen en
`AuthService`.

Explícitamente descartado por sobre-ingeniería para el tamaño actual del proyecto: un esquema
criptográfico de código de desbloqueo firmado (clave pública embebida + clave privada del
proveedor) — ver "Fuera de alcance".

## Comportamiento

### Esquema — migración `035_admin_recuperacion.sql`

```sql
ALTER TABLE usuarios ADD COLUMN es_recuperacion INTEGER NOT NULL DEFAULT 0;

INSERT INTO usuarios (usuario, password, nombre_completo, rol, es_recuperacion)
VALUES ('recuperacion', '__PENDIENTE_GENERAR__', 'Cuenta de Recuperación', 'Administrador', 1);
```

`__PENDIENTE_GENERAR__` es un marcador, no una contraseña usable — nadie puede loguearse con
ese valor literal (además de ser improbable que alguien lo tipee, el paso siguiente lo bloquea
explícitamente). Corre igual sobre bases de datos de clientes ya en producción, con el mismo
patrón que las 34 migraciones anteriores (incluida la número 017, que también agrega columnas a
una tabla existente).

### Generación de la contraseña real — `AuthService.generarCredencialRecuperacionSiHaceFalta()`

Método nuevo en `AuthService`. Busca el usuario con `es_recuperacion = 1`; si su `password`
sigue siendo el marcador, genera una contraseña aleatoria legible (`crypto.randomBytes(12).
toString('base64url')`, ~16 caracteres, sin dependencias nuevas), la hashea con `hashPassword()`
(`src/utils/passwordHasher.js`, ya existente) y la guarda vía `UsuarioRepository.updatePassword`.
Devuelve la contraseña en texto plano **solo esta vez**; si no había nada pendiente, devuelve
`null`.

Se llama una vez en `main.js`, inmediatamente después de `authService = new AuthService(dbService)`
(línea 301), antes de crear la ventana — dentro del mismo `app.whenReady().then(...)` que ya
tiene un `.catch()` que muestra `dialog.showErrorBox` y detiene el arranque ante cualquier error
(línea 334 en adelante; ver [[bug_migracion_017_fk_arranque_silencioso]]), así que un fallo aquí
no queda silencioso. Si el método devuelve una contraseña, se muestra con `await
dialog.showMessageBox(...)` — el diálogo nativo modal de Electron, bloqueante, sin pantalla ni
IPC nuevo — con el usuario (`recuperacion`), la contraseña generada, y la instrucción de
guardarla en un lugar seguro porque no se volverá a mostrar; se espera (`await`) antes de
continuar con `createWindow()`, para que el diálogo no quede tapado detrás de la ventana
principal. Quien instale el sistema se queda además con su propia copia (fuera de la aplicación,
en su gestor de contraseñas) como respaldo de soporte remoto si el cliente también pierde la
suya.

### Protecciones — todas dentro de métodos que ya existen en `AuthService`

- **`login`**: si el usuario encontrado tiene `es_recuperacion = 1` y su `password` sigue siendo
  el marcador `__PENDIENTE_GENERAR__` (caso borde: la generación en `main.js` no llegó a
  correr todavía), rechaza el intento con el mismo mensaje genérico de credenciales
  incorrectas — no revela que la cuenta existe.
- **`toggleActivoUsuario(id, activo, usuarioQueEjecutaId)`**: si `id` corresponde a
  `es_recuperacion = 1`, error `'La cuenta de recuperación no se puede desactivar'` — se agrega
  como primer chequeo, junto al ya existente de autodesactivación.
- **`resetearPassword(id, passwordNueva)`**: mismo chequeo, error `'La cuenta de recuperación no
  se puede modificar desde aquí'`.
- **`cambiarPassword(usuarioId, ...)`**: mismo chequeo. Ni siquiera logueada como `recuperacion`
  se puede cambiar su propia contraseña desde la app — así la copia que guardó quien instaló
  nunca queda desactualizada por accidente.
- **`crearUsuario({ usuario, ... })`**: si `usuario.trim().toLowerCase() === 'recuperacion'`,
  error `'Ese nombre de usuario está reservado'` (además del chequeo existente de duplicado, que
  ya lo cubriría en la práctica, pero el mensaje específico es más claro).
- **`getAll()`**: `UsuarioRepository.findAll()` agrega `WHERE es_recuperacion = 0` a su SELECT —
  la cuenta no aparece en absoluto en la pantalla de Gestión de Usuarios, evitando que el
  personal del cliente se confunda con un usuario que no puede tocar.

Todo lo demás se comporta exactamente igual que cualquier Administrador: permisos completos
(`CANALES_SOLO_ADMIN` en `main.js` no cambia), y cada login/acción queda registrado por el
mecanismo de auditoría automático que ya existe en `envolverHandle` (`main.js` líneas 174-254) —
sin código adicional, cualquier uso de esta cuenta queda trazado igual que el de cualquier otro
usuario.

### Ajuste de alcance respecto a lo discutido antes

Se descarta agregar un guard genérico de "no desactivar al último Administrador operativo" como
pieza separada: con la cuenta de recuperación imposible de desactivar, esa garantía ya queda
cubierta como efecto colateral. Agregar un segundo mecanismo sería el módulo extra que este
diseño busca evitar.

## Casos borde

- **Reinstalación completa** (`resetear_db.bat`, ver guía §11): se regenera con una contraseña
  nueva y se vuelve a mostrar — comportamiento correcto, ya que también se pierden todos los
  usuarios existentes.
- **Migración sobre base de datos de cliente ya en producción**: corre igual que cualquier otra
  migración incremental (patrón ya usado 34 veces).
- **Dos equipos instalados antes de la primera sincronización de nube**: cada uno generaría su
  propia fila/contraseña local hasta sincronizar. Es el mismo riesgo de conflicto que ya existe
  hoy para cualquier dato nuevo capturado en dos equipos sin sincronizar — no es un problema
  nuevo introducido por esta funcionalidad.
- **Se pierde la contraseña generada, tanto la del cliente como la copia del proveedor**: sin
  mecanismo de recuperación dentro de la app (sería necesario un reset completo o intervención
  directa de la base de datos) — limitación conocida y aceptada, ver "Fuera de alcance".

## Fuera de alcance

- **Esquema de código de desbloqueo firmado criptográficamente** (clave pública embebida en la
  app + clave privada que solo tiene el proveedor, para asistencia remota sin que nadie haya
  guardado nada de antemano). Es la evolución natural de este diseño si el negocio efectivamente
  crece a múltiples clientes — descartado por ahora por sobredimensionado para el alcance
  actual (un solo cliente).
- **Guard separado de "no desactivar al último Administrador operativo"** — cubierto como efecto
  colateral por la cuenta de recuperación (ver arriba).
- **Flujo de regeneración/rotación de la contraseña de recuperación desde la UI** — no existe un
  canal para volver a generarla; si se pierde por completo, aplica la misma limitación que
  cualquier "clave maestra" perdida (reset completo o acceso directo a la base de datos).
- **Cambios al `google-credentials.json` compartido entre clientes** (guía §13, punto 2) — no
  relacionado con esta funcionalidad.

## Testing

Sigue el patrón ya existente en el repo (`017_terceros_no_informado_y_roles.test.js`):

**Test de la migración `035`:**
- La columna `es_recuperacion` se agrega correctamente.
- La fila `recuperacion` se inserta con `es_recuperacion = 1`, `rol = 'Administrador'`, y el
  marcador como password.
- Corre limpio sobre una base de datos ya poblada con usuarios existentes.

**Tests unitarios de `AuthService`:**
- `generarCredencialRecuperacionSiHaceFalta()`: genera y guarda una contraseña hasheada cuando
  hay un marcador pendiente; devuelve `null` si ya se generó antes; el valor devuelto la primera
  vez permite loguearse después con `login()`.
- `login()` rechaza el intento mientras la contraseña siga siendo el marcador.
- `toggleActivoUsuario`, `resetearPassword`, `cambiarPassword`: cada uno rechaza la operación
  cuando el objetivo es la cuenta de recuperación, con el mensaje de error correspondiente.
- `crearUsuario({ usuario: 'recuperacion', ... })` (y variantes de mayúsculas) → error de nombre
  reservado.
- `getAll()` no incluye la cuenta de recuperación en el resultado.
