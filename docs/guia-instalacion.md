# Guía de Instalación — Sistema Administrativo Acueducto Veredal

**Documento técnico**, dirigido a la persona que va a instalar o desplegar el sistema en el equipo de la asociación.

_Basado en el código del repositorio a fecha 2026-07-16 (commit `2093aad`). Actualizado 2026-07-21: se agregó el §9 sobre el checkpoint contable (incluida la herramienta `scripts/import-gastos/` para el historial de gastos), a raíz de las nuevas funciones "Registrar Retiro" y "Ajustar saldos" en Caja y Bancos._

---

## 1. Qué es este sistema, en resumen técnico

- Aplicación de **escritorio Electron** (v38) para **Windows** — no es una app web, no tiene servidor ni backend propio.
- Base de datos **SQLite embebida** (`better-sqlite3`) — un solo archivo `.db`, sin necesidad de instalar ni configurar un motor de base de datos aparte.
- Funciona **100% sin internet**. Internet solo es necesario si se activa el **Respaldo en la Nube** (Google Drive), que es opcional.
- No requiere variables de entorno (`.env`) — la única configuración sensible externa es un archivo de credenciales de Google (ver §3).

---

## 2. Requisitos previos

Hay dos perfiles de instalación distintos. Identifica cuál necesitas antes de empezar.

### 2.1 Para instalar en el equipo del cliente (usando el instalador ya generado) — el caso normal

- Windows 10 u 11, **64 bits**.
- Al menos 250 MB de espacio libre en disco (el instalador pesa ~95 MB; la base de datos crece con el uso).
- **No necesita** tener Node.js, npm, ni ningún otro programa instalado. El instalador trae todo incluido.
- **No necesita conexión a internet** para el uso diario. Solo hace falta internet si la asociación va a usar el Respaldo en la Nube (Google Drive).
- Permisos de usuario normales de Windows alcanzan si se instala en una carpeta personal; si se instala en "Archivos de Programa" puede pedir permisos de administrador durante la instalación.

### 2.2 Para generar el instalador o ejecutar el código fuente (equipo del técnico que despliega)

- Windows 10/11 64 bits (el build de `electron-builder` en este proyecto solo está configurado para Windows).
- **Node.js 18 o superior** (probado en este entorno con Node 22.23.0), que incluye `npm`.
- Herramientas de compilación nativa de C++ para Windows (Visual Studio Build Tools con la carga "Desarrollo para escritorio con C++", o equivalente). Normalmente **no hace falta** porque `better-sqlite3` descarga binarios ya compilados, pero si `npm install` falla compilando, esta es la causa más común (ver §12).
- Conexión a internet durante la instalación de dependencias (`npm install` descarga paquetes de npm).
- Git, solo si vas a clonar el repositorio en vez de copiarlo manualmente (opcional).
- ~600 MB libres para el código fuente + `node_modules`.

---

## 3. Antes de empezar: archivos de configuración sensibles

Este proyecto **no usa un archivo `.env`**. Lo único sensible que hay que tener en cuenta es:

### `config/google-credentials.json`

- Son las credenciales OAuth2 (tipo "aplicación instalada") del proyecto de Google Cloud usado para el **Respaldo en la Nube**. Sin este archivo, el botón "Conectar con Google Drive" falla y esa función queda inutilizable — el resto del sistema funciona normal.
- **Ya existe en el repositorio** y **se empaqueta automáticamente dentro de cada instalador** (está listado explícitamente en `package.json → build.files`). Es decir: no hay que configurar nada para que el Respaldo en la Nube funcione, viaja incluido.
- ⚠️ **Nota de seguridad para tener en cuenta**: este archivo contiene un `client_secret` real de un proyecto de Google Cloud propiedad del desarrollador. Todos los clientes que reciban un instalador generado a partir de este repositorio **comparten el mismo proyecto de Google y, por lo tanto, la misma cuota de la API de Google Drive**. Para OAuth de "aplicación instalada" este es el modelo estándar de Google (el secreto no se considera confidencial en este tipo de flujo), así que no requiere una acción inmediata para una venta puntual — pero si el negocio va a escalar a muchas asociaciones usando el respaldo en la nube simultáneamente, conviene revisar las cuotas del proyecto en Google Cloud Console, o evaluar generar un proyecto de Google Cloud separado más adelante.

No hay ningún otro archivo de configuración ni variable de entorno que preparar antes de instalar.

---

## 4. Camino A — Instalar usando el instalador `.exe` ya generado (recomendado para entregar al cliente)

Este es el camino normal cuando ya tienes un instalador `.exe` (generado con el Camino B, más abajo, o entregado por el desarrollador).

1. Ubica el archivo `Acueducto Admin Setup <versión>.exe` (en este repositorio, la carpeta `dist/`).
2. Cópialo al equipo del cliente (memoria USB, descarga por correo/nube, etc.).
3. Haz doble clic para ejecutarlo.
4. Si Windows muestra la advertencia **"Windows protegió su PC"** (SmartScreen): esto es normal, el instalador no tiene firma digital. Haz clic en **"Más información"** y luego en **"Ejecutar de todas formas"**.
5. El instalador permite elegir la carpeta de instalación (no es de un solo clic). Puedes dejar la carpeta por defecto o cambiarla.
6. Confirma la instalación. Se crean automáticamente accesos directos en el **Escritorio** y en el **Menú Inicio**, ambos llamados **"Acueducto Admin"**.
7. Al terminar, abre la aplicación desde cualquiera de esos accesos directos y continúa con la verificación del §10.

---

## 5. Camino B — Generar el instalador desde el código fuente

Úsalo cuando necesites producir un `.exe` nuevo (por ejemplo, después de actualizar el código, o si no existe todavía un instalador reciente).

1. Copia o clona el proyecto completo en el equipo técnico.
2. Abre una terminal (PowerShell o CMD) en la carpeta raíz del proyecto.
3. Instala las dependencias:
   ```
   npm install
   ```
   (equivalente al script `instalar.bat` incluido en la raíz, que hace lo mismo con validaciones adicionales de que Node.js esté instalado).
4. Genera el instalador:
   ```
   npm run dist
   ```
   Este comando hace dos cosas en orden: primero recompila el módulo nativo `better-sqlite3` para la versión exacta de Electron que usa el proyecto (`npm run rebuild` → `electron-rebuild -f -w better-sqlite3`), y luego empaqueta la aplicación con `electron-builder` en formato NSIS para Windows x64.
5. El instalador queda en:
   ```
   dist/Acueducto Admin Setup <versión>.exe
   ```
   La versión sale del campo `version` de `package.json` (actualmente `1.0.0`).

   ⚠️ **Importante**: en este repositorio ya existe un instalador antiguo en `dist/` (generado el 22 de junio, antes de funcionalidades recientes como las coordenadas GPS de cuentas). `npm run dist` lo sobrescribe con la versión actual del código, pero **verifica la fecha del archivo generado antes de entregarlo a un cliente**, para no distribuir por error una build vieja.
6. Continúa con los pasos del Camino A para instalar ese `.exe` en el equipo del cliente.

---

## 6. Camino C — Ejecutar en modo desarrollo (sin generar instalador)

Útil solo para pruebas rápidas del propio técnico, no para entregar al cliente.

1. `npm install` (si no se ha hecho).
2. Para iniciar la app normalmente:
   ```
   npm start
   ```
   (equivalente a `ejecutar.bat`).
3. Para iniciarla con las herramientas de desarrollador de Chromium abiertas (útil para ver errores en pantalla, ya que la app no guarda un archivo de log — ver §11):
   ```
   npm run dev
   ```
4. En este modo la base de datos vive dentro del propio proyecto, en `data/acueducto.db` — no en la carpeta de datos de usuario de Windows.

---

## 7. Base de datos: no requiere pasos manuales

No hay que "crear la base de datos" ni ejecutar migraciones a mano — es automático en cualquiera de los tres caminos anteriores.

- Al primer arranque, el sistema crea la carpeta `data/` si no existe, crea el archivo `acueducto.db` vacío, y ejecuta en orden las migraciones SQL (`src/database/migrations/*.sql`, actualmente 34 archivos) que arman todas las tablas, catálogos base (categorías iniciales, Plan Único de Cuentas, mapeo de conceptos contables) y el usuario administrador inicial. Cada migración se registra en una tabla `migrations` para no volver a ejecutarse.
- Las migraciones corren dentro de una transacción: si una falla a mitad de camino, se revierte completa y el siguiente arranque puede reintentarla desde cero — no debería quedar una base de datos "a medias".
- **Usuario administrador inicial**: `admin` / `admin123`.

  🔒 **Recomendación de seguridad obligatoria**: cambia esta contraseña inmediatamente después del primer inicio de sesión (**Configuración → Seguridad**), porque es un valor público conocido (está escrito en el código fuente del sistema).

### Dónde queda el archivo de la base de datos

| Modo de ejecución | Ubicación |
|---|---|
| Modo desarrollo (`npm start` / `npm run dev`) | `<carpeta del proyecto>\data\acueducto.db` |
| Aplicación instalada (`.exe`) | `%APPDATA%\acueducto-admin\data\acueducto.db` (carpeta de datos de usuario de Windows, **no** dentro de "Archivos de Programa") |

Esta separación es intencional: una vez instalada en "Archivos de Programa", esa carpeta no es escribible por un usuario normal, así que el sistema guarda los datos en la carpeta de perfil del usuario de Windows.

---

## 8. Primer inicio de sesión y configuración inicial recomendada

1. Al abrir la app por primera vez en un equipo sin datos, aparece la pantalla **"Configuración Inicial"**, que ofrece **"Traer datos desde Google Drive"** (si la asociación ya usa el sistema en otro equipo y tiene un respaldo) o **"Continuar sin la nube"** (para un uso nuevo desde cero). Para una instalación nueva, usa "Continuar sin la nube".
2. En la pantalla de Login, ingresa `admin` / `admin123`.
3. Ve a **Configuración → Datos de la Asociación** y completa el nombre real, NIT, dirección, ciudad, teléfono, correo y logo de la asociación. Guarda.
4. Ve a **Configuración → Seguridad** y cambia la contraseña del usuario `admin` por una definitiva.
5. Ve a **Configuración → Usuarios** y crea las cuentas de usuario reales del personal que va a operar el sistema, asignando el rol correspondiente (Administrador / Usuario / Consulta).
6. Revisa **Configuración → Parámetros Generales** (próximo número de recibo, valor por defecto de nuevos puntos, saldos iniciales de caja y banco) antes de empezar a registrar operaciones reales.
7. Si la asociación va a usar Respaldo en la Nube, configúralo desde **Configuración → Respaldo en la Nube**.

---

## 9. Checkpoint contable antes de entregar al cliente (si se migran datos históricos reales)

Esta sección aplica **solo cuando la instalación va a arrancar con datos históricos reales ya cargados** (por ejemplo, migrados desde Excel u otro sistema anterior), no cuando el cliente empieza desde cero con el sistema vacío. Si ese es tu caso, el módulo de Caja y Bancos incluye dos herramientas pensadas específicamente para esto — **hacerlo antes de entregar la instalación al cliente evita que la junta reciba un sistema cuyo saldo de Caja/Banco no coincide con la plata real que tienen**.

0. **Si aún falta cargar historial de gastos desde Excel**: hazlo antes de calcular nada, con la herramienta `scripts/import-gastos/` (CLI, sin UI, se corre desde la raíz del proyecto). Flujo de dos fases por cada hoja del Excel: `node scripts/import-gastos/preview.js <hoja>` (solo lectura, propone tercero y tipo de gasto por fila con nivel de confianza, genera un CSV para revisar/corregir a mano) y, tras revisar el CSV, `node scripts/import-gastos/commit.js <hoja>` (hace un respaldo de la base de datos y escribe cada fila vía los `Service` reales de la app, con protección para poder reintentar sin duplicar si algo falla a mitad de camino). Procesar las hojas en orden del año más reciente al más antiguo, revisando el CSV de cada una antes de aprobar su `commit`.
1. **Arqueo físico de caja**: contar el efectivo real disponible a una fecha de corte (normalmente el cierre del último año/período que se va a migrar).
2. **Extracto bancario**: obtener el saldo real de la cuenta bancaria a esa misma fecha de corte.
3. Ir a **Caja y Bancos → "Ajustar saldos"** (🔒 solo Administrador) e ingresar ambos valores reales, fechados al corte, con un motivo (por ejemplo: "Regularización de saldos por registros históricos anteriores a la puesta en marcha"). El sistema calcula solo la diferencia contra lo que tiene registrado y la asienta contablemente contra Patrimonio — no se pierde ni se altera ningún movimiento ya cargado.
4. Si en algún momento hace falta trasladar dinero entre Caja y Banco para cuadrar (por ejemplo, un retiro de banco que el cliente ya hizo en la realidad pero no estaba en el sistema), usar **"+ Registrar Retiro"** (Banco→Caja) o **"+ Registrar Consignación"** (Caja→Banco) antes del ajuste final, para que la diferencia a regularizar sea la mínima posible.
5. **Después** del ajuste — nunca antes —, ir a **Contabilidad → Períodos Contables** y cerrar (o bloquear, si es definitivo) los períodos hasta la fecha de corte. Esto impide que alguien registre por error un movimiento con fecha anterior al corte una vez el sistema ya está en producción.

   ⚠️ **Orden importante**: si el período ya está Cerrado o Bloqueado antes de intentar el ajuste, "Ajustar saldos" fallará al intentar registrar en esa fecha (el sistema valida que el período esté Abierto). Haz siempre el ajuste primero y cierra/bloquea el período después.
6. De ahí en adelante, recomienda al cliente la misma disciplina mensual: arqueo + extracto + revisión de saldos + cierre del período de cada mes, para que este desfase no se repita.

Ver también el manual de usuario, sección "Caja y Bancos", para el paso a paso de cada botón desde la perspectiva del usuario final.

---

## 10. Cómo verificar que la instalación quedó funcionando correctamente

Checklist rápido:

- [ ] Doble clic en el acceso directo "Acueducto Admin" abre una ventana de aproximadamente 1400×900, sin menú superior de Archivo/Edición (está deshabilitado a propósito).
- [ ] En un equipo/instalación nueva, se ve primero la pantalla "Configuración Inicial"; al elegir "Continuar sin la nube" pasa a la pantalla de Login.
- [ ] El login acepta `admin` / `admin123` y entra directo al **Dashboard**.
- [ ] El menú lateral muestra los módulos: Dashboard, Cuentas, Propietarios, Categorías, Aportes, Recibos, Gastos, Caja/Banco, Contabilidad, Reportes, Configuración.
- [ ] Guardar cambios en **Configuración → Datos de la Asociación** muestra una notificación de éxito y el nombre se refleja en la barra lateral.
- [ ] Existe el archivo de base de datos en la ruta esperada según el modo de instalación (ver tabla del §7).
- [ ] **Configuración → Copias de Seguridad → Crear Copia de Seguridad** genera correctamente un archivo `.db` en la ubicación que elijas.
- [ ] Se cambió la contraseña del usuario `admin` por una definitiva.

---

## 11. Mantenimiento básico

- **Respaldo manual**: Configuración → Copias de Seguridad → Crear Copia de Seguridad (disponible para cualquier rol). Genera un archivo `.db` completo con todos los datos.
- **Restaurar un respaldo**: Configuración → Copias de Seguridad → Restaurar desde Archivo (🔒 solo Administrador). Pide doble confirmación porque **reemplaza todos los datos actuales sin posibilidad de deshacer**; al finalizar, la aplicación se cierra y se reabre sola.
- **Respaldo automático local**: el sistema crea uno solo cada 24 horas de uso, en la carpeta `backups_automaticos/` (al mismo nivel que `data/`), conservando siempre los últimos 7. No requiere ninguna acción; es silencioso.
- **Restablecer todo desde cero (solo para equipos de prueba/desarrollo)**: ejecutar `resetear_db.bat` borra `data\acueducto.db` (y sus archivos auxiliares `-shm`/`-wal`); al volver a iniciar la app con `npm start`, se regenera automáticamente. ⚠️ Borra todos los datos permanentemente — **nunca usarlo sobre la instalación real de un cliente**.

---

## 12. Problemas comunes y solución

| Problema | Causa probable | Solución |
|---|---|---|
| `npm` o `node` "no se reconoce como comando" | Node.js no está instalado o no quedó en el PATH | Instalar Node.js 18+ desde nodejs.org marcando la opción de agregar al PATH; cerrar y volver a abrir la terminal |
| `npm install` falla con errores de compilación (`node-gyp`, `python`, `MSBuild`) | Falta el compilador de C++ que a veces necesita `better-sqlite3` | Instalar "Visual Studio Build Tools" con la carga de trabajo "Desarrollo para escritorio con C++", o Python 3.x; volver a correr `npm install` |
| `npm run dist` falla en el paso de recompilar `better-sqlite3` | Mezcla de versiones entre `node_modules` y la versión de Electron declarada en `package.json` | Borrar la carpeta `node_modules` y el archivo `package-lock.json`, correr `npm install` de nuevo, y luego `npm run dist` |
| Windows muestra "Windows protegió su PC" al ejecutar el instalador | El instalador NSIS no tiene firma digital (no está configurado en este proyecto) | Es esperado: clic en "Más información" → "Ejecutar de todas formas". Si se necesita una imagen más profesional para el cliente, se puede añadir firma de código a futuro (no está implementado hoy) |
| Doble clic en el acceso directo no abre ninguna ventana | Base de datos corrupta, permisos insuficientes en la carpeta de datos, o una migración SQL falló al arrancar. El sistema **no guarda ningún archivo de log de errores en disco** | Ejecutar la app desde una consola visible para ver el error real: abrir `cmd`, ir a la carpeta donde quedó instalada, y ejecutar el `.exe` desde ahí (o usar `npm run dev` si se tiene el código fuente) |
| "Ya hay una instancia abierta" o el ícono no responde a los clics | El sistema permite una sola instancia a la vez, a propósito, para no dañar la base de datos con dos procesos escribiendo simultáneamente | Revisar el Administrador de Tareas de Windows por si quedó un proceso "Acueducto Admin" colgado, finalizarlo, y volver a abrir |
| "Conectar con Google Drive" falla o no hace nada | Falta el archivo `config/google-credentials.json`, o el firewall/antivirus del equipo bloquea el navegador predeterminado o el servidor local temporal (`localhost`) que usa el proceso de autorización de Google | Verificar que el archivo exista en la instalación; revisar reglas de firewall/antivirus que puedan estar bloqueando conexiones a `localhost` o la apertura del navegador |
| Se necesita reiniciar todo de cero en un equipo de pruebas | — | Ver `resetear_db.bat` en el §11. **No usar en la instalación real de un cliente** |
| "Ajustar saldos" rechaza el ajuste con un error sobre el período contable | La fecha del ajuste cae en un período ya Cerrado o Bloqueado (ver §9) | Si el período está Cerrado, reabrirlo desde Contabilidad → Períodos, registrar el ajuste, y volver a cerrarlo. Si está Bloqueado, no se puede reabrir desde la aplicación — usar una fecha de ajuste posterior al bloqueo |

---

## 13. Notas de seguridad — resumen

1. Cambiar la contraseña `admin`/`admin123` inmediatamente después de instalar (ver §7 y §8).
2. `config/google-credentials.json` viaja incluido en cada instalador y es compartido entre todos los clientes de este producto (ver §3) — no requiere acción para una venta puntual, pero tenlo presente si el negocio escala.
3. No existen variables de entorno ni archivos `.env` que configurar: todo lo sensible se reduce a los dos puntos anteriores.
4. La aplicación usa la configuración de seguridad estándar de Electron (`nodeIntegration: false`, `contextIsolation: true`) — el renderer no tiene acceso directo a Node.js, todo pasa por el puente controlado de `preload.js`.
