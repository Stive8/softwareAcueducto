# Arquitectura Técnica - Acueducto Admin

Este documento complementa al [README.md](README.md) (qué hace el sistema, reglas de negocio) con el **cómo**: stack, estructura de carpetas, flujo de datos, modelo de seguridad, base de datos y el motor de contabilidad de doble partida.

## 1. Stack

| Pieza | Tecnología | Por qué |
|---|---|---|
| Runtime de escritorio | **Electron 38** | Una sola base de código JS para una app de escritorio Windows offline, sin depender de un navegador instalado. |
| Base de datos | **better-sqlite3** | SQLite embebido, API síncrona (sin callbacks/promesas en cada query), un solo archivo `.db`, cero configuración, cero dependencia de red. Ideal para una app de un solo usuario/una sola sede. |
| UI | **HTML/CSS/JS vanilla** | Sin React/Vue/build step. El proyecto es pequeño y de un solo desarrollador; un framework de frontend habría sido sobreingeniería. |
| Gráficos | **Chart.js** | Dashboard (barras/líneas de ingresos vs gastos). |
| Exportación a Excel | **exceljs** | Generación de `.xlsx` multi-hoja desde Node, sin Excel instalado. |
| PDF | **`webContents.printToPDF` / `.print()` de Electron** | No se usa ninguna librería de PDF: se renderiza HTML en una `BrowserWindow` oculta y se imprime/exporta con el motor de impresión nativo de Chromium. |
| Respaldo en la nube (opcional) | **googleapis** (OAuth2 + Drive API v3) | Sube/descarga un único archivo (la base de datos completa) a una carpeta de Google Drive del usuario. No es una sincronización en tiempo real ni un backend propio: cada equipo decide cuándo subir/traer, ver sección 12. |
| Empaquetado | **electron-builder** (NSIS) | Genera el instalador `.exe` para Windows y resuelve la recompilación nativa de `better-sqlite3` contra la versión de Electron usada. |

No hay backend propio ni servidor remoto, no hay build step de frontend (Webpack/Vite) ni transpilación: lo que está en `src/renderer/` es exactamente lo que carga el navegador embebido de Electron. El respaldo en la nube (sección 12) es la única pieza que sale a internet, y es opcional: el sistema funciona 100% sin ella.

## 2. Estructura de carpetas

```
main.js                  Proceso principal de Electron: ventana, IPC, sesión, permisos, auditoría
preload.js                contextBridge: la única puerta entre el renderer y Node/IPC
src/
  database/
    DatabaseService.js    Apertura de la conexión SQLite + runner de migraciones
    migrations/           *.sql numerados secuencialmente, nunca se editan tras mergear
  repositories/            Acceso directo a SQLite (una clase por entidad, sin lógica de negocio)
  services/                Lógica de negocio, validaciones, orquesta repositorios y transacciones
  utils/                   Helpers puros (hash de contraseña, etc.)
  renderer/
    index.html             Shell de la SPA (nav + contenedor de página)
    css/                   Estilos
    js/
      app.js               Router de páginas + estado global mínimo (sesión, toasts, modales)
      sidebar.js            Acordeón de sub-páginas del sidebar (Contabilidad, Gastos) y los
                             textos que solo existen tras login (asociación, usuario)
      combobox.js           Select buscable reutilizable (ver sección 8.1), para listas largas
                             (cuentas de servicio, plan de cuentas)
      <modulo>.js           Un archivo por módulo (cuentas.js, pagos.js, contabilidad.js, ...),
                             cada uno un objeto global (p.ej. `Contabilidad`) con sus métodos
    pages/                 Fragmentos HTML que `app.js` inyecta al navegar
assets/                   Íconos de la app e instalador
scripts/                  Utilidades de build (generación de íconos, etc.)
```

No existe carpeta `controllers/` ni `models/`: el patrón es **Repository → Service → IPC handler → UI**, descrito abajo.

## 3. Proceso principal vs. renderer (seguridad de Electron)

Electron corre dos tipos de proceso en esta app:

- **Proceso principal** (`main.js`): tiene acceso completo a Node.js y al sistema de archivos. Aquí vive la base de datos, todos los `Service`/`Repository`, y los manejadores `ipcMain.handle(canal, fn)`.
- **Proceso de renderer** (`src/renderer/`): es la ventana de Chromium que el usuario ve. Corre con:
  - `nodeIntegration: false` — el renderer no puede hacer `require('fs')` ni nada de Node directamente.
  - `contextIsolation: true` — el `window` del renderer y el contexto del `preload.js` están aislados; el renderer no puede tocar internals de Electron/Node aunque quisiera.
  - Único punto de contacto: `preload.js` usa `contextBridge.exposeInMainWorld('api', {...})` para publicar una API explícita y de solo-datos (`window.api.cuentas.getAll(...)`, `window.api.asientos.crearManual(...)`, etc.). El renderer **nunca** ve un canal IPC crudo, solo funciones ya envueltas.

Esto significa que cualquier compromiso del renderer (por ejemplo, si algún día se cargara HTML no confiable) no obtiene acceso a Node ni al sistema de archivos: solo puede llamar a las funciones que `preload.js` decidió exponer.

## 4. Flujo de una operación, de clic a base de datos

Ejemplo: el usuario registra un gasto.

```
contabilidad.js / gastos.js (renderer)
  → window.api.gastos.create(datos)              [preload.js, vía contextBridge]
    → ipcRenderer.invoke('gastos:create', datos)
      ──────────── frontera de procesos (IPC) ────────────
      → ipcMain.handle('gastos:create', ...)       [main.js, envuelto por envolverHandle()]
        → GastoService.create(datos, usuarioId)    [src/services/GastoService.js]
          → valida datos de negocio
          → GastoRepository.create(...)            [src/repositories/GastoRepository.js]
            → resuelve cuenta_contable_id vía mapeo configurable
            → INSERT INTO gastos ...                [SQLite]
          → AsientoContableService.generarDesdeGasto(...)   [genera el asiento contable]
        ← { success: true, data: { id } }
      ← envolverHandle registra la accion en `auditoria` automáticamente
    ← ipcRenderer.invoke resuelve la promesa
  ← UI actualiza la tabla / muestra el toast
```

Puntos clave de este flujo:

- **Todo handler IPC devuelve `{ success: true, data }` o `{ success: false, error }`**, nunca lanza una excepción cruda hacia el renderer — cada `envolverHandle` envuelve la llamada en `try/catch` y traduce errores de los `Service` (que sí lanzan `Error` normales) a ese formato.
- **Las transacciones viven en el `Repository`**, no en el `Service`: cada repositorio expone `transaccion(fn)` (= `db.transaction(fn)()` de better-sqlite3), y el `Service` la usa para envolver todo lo que debe ser atómico (p. ej. crear el gasto **y** su asiento contable en la misma transacción: si el asiento falla, el gasto tampoco queda guardado). Como better-sqlite3 soporta transacciones anidadas (SAVEPOINT) sobre la misma conexión, un `Service` puede llamar a otro `Service` que abre su propia transacción sin romper la atomicidad.
- **La capa de permisos y auditoría es transversal**, no está repetida en cada handler (ver sección 5).

## 5. Sesión, roles y auditoría (`envolverHandle`)

Toda la seguridad de la app pasa por una única función en `main.js`, `envolverHandle(canal, fn)`, que envuelve cada `ipcMain.handle`:

1. **Sesión única**: como es una app de escritorio de un solo usuario por instalación, la sesión activa (`sesionActual`) es una variable en memoria del proceso principal, no un token. Si no hay sesión, cualquier canal (salvo `auth:login`) responde `{ success: false, error: 'Debe iniciar sesión' }`.
2. **Lectura vs. escritura por convención de nombre**: el método del canal (`modulo:metodo`) se clasifica como lectura si empieza por `get`, `find`, `simular`, `tiene`, `imprimir`, `exportar` o `generar` (`PREFIJOS_LECTURA`). Todo lo demás es escritura. No hay que declarar esto por canal: se infiere del nombre, así que un canal nuevo solo necesita seguir la convención de nombres para heredar el comportamiento correcto.
3. **Roles**: `Administrador`, `Usuario`, `Consulta`.
   - `Consulta` solo puede ejecutar canales de lectura.
   - Ciertos canales sensibles (gestión de usuarios, restaurar backup, Modo de Pruebas, Plan de Cuentas, Mapeo de Conceptos, Notas Contables/reversión) están en `CANALES_SOLO_ADMIN` y se bloquean para cualquier rol que no sea `Administrador`, sin importar si son lectura o escritura.
4. **Auditoría automática**: toda escritura exitosa se registra sola en la tabla `auditoria` (usuario, acción, módulo, id del registro, payload), sin que cada `Service`/handler tenga que llamar nada explícitamente. Esto es lo que hace confiable el reporte de auditoría y el "Informe de Empalme" (quién hizo qué, sin necesidad de instrumentar cada función).

## 6. Base de datos y migraciones

- Un único archivo SQLite (`data/acueducto.db` en desarrollo; `%APPDATA%/acueducto-admin/data/acueducto.db` en la app instalada — nunca dentro de la carpeta de instalación, que no es escribible).
- `journal_mode = WAL` y `foreign_keys = ON` activados al abrir la conexión.
- **Migraciones** (`src/database/migrations/*.sql`): archivos numerados, cada uno se ejecuta una sola vez (registrado en la tabla `migrations`) la primera vez que arranca una base de datos que no los tiene. No se "deshacen": una vez mergeado un número, ese archivo no se vuelve a editar — una corrección posterior es siempre una migración nueva con un número más alto (así pasó con la `008`, que corrige datos sembrados por la `006`).
- **Nunca se borra nada por diseño de esquema**: las tablas usan columnas `estado`/`activo`/`fecha_anulacion` en vez de `DELETE`. La única excepción es el botón explícito de **Modo de Pruebas → Eliminar Datos Operativos**, pensado solo para limpiar datos de ejemplo antes de poner el sistema en producción real.

## 7. Patrón Repository / Service

- **Repository** (`src/repositories/`): un método por consulta, SQL crudo con `better-sqlite3` (`db.prepare(...).run()/get()/all()`), sin reglas de negocio. Aquí vive también `transaccion(fn)` cuando el repositorio necesita garantizar atomicidad.
- **Service** (`src/services/`): valida entradas, decide reglas de negocio (p. ej. "un pago siempre es por mes calendario completo", "no se puede desactivar una cuenta contable en uso"), y orquesta uno o más repositorios (a veces de otros módulos: `PagoService` usa su propio repositorio y también `AsientoContableService` para generar el asiento). Lanza `Error` normales; quien los traduce a `{ success: false, error }` es `envolverHandle`.
- Un mismo dato puede tener su `cuenta_contable_id` resuelto en el `Repository` (vía el mapeo configurable de conceptos) en el momento de creación, y ese valor ya resuelto es el que usa después el motor de asientos — así, si el mapeo cambia más adelante, los registros históricos no cambian de cuenta retroactivamente.
- **Migrar de texto libre a catálogo sin romper lo histórico**: cuando `gastos.tercero_id` se agregó, ya existían gastos con solo `proveedor`/`nit_cedula` en texto plano (sin tercero asociado). En vez de forzar una migración de datos imperfecta, todo `SELECT` que muestra el proveedor de un gasto usa `COALESCE(t.nombre_razon_social, g.proveedor)` (con `LEFT JOIN terceros t ON t.id = g.tercero_id`): si el gasto tiene tercero, se usa su nombre actual del catálogo; si no, se usa el texto histórico tal cual quedó guardado. Los gastos nuevos siempre llevan `tercero_id`; las columnas de texto solo se conservan como respaldo de lo antiguo. Una migración aparte (`014_migrar_proveedores_existentes.sql`) además crea automáticamente un Tercero por cada combinación distinta de NIT que se repetía en el histórico, y enlaza esos gastos viejos al nuevo registro — agrupando por NIT (no por nombre) para fusionar variantes de escritura del mismo proveedor bajo un solo tercero.

## 8. Renderer: SPA sin framework

- `app.js` mantiene el estado mínimo (sesión actual, página activa) y hace de router: cambia de página inyectando el fragmento HTML correspondiente (`src/renderer/pages/`) y llamando al método `.load()` del objeto global del módulo (`Cuentas.load()`, `Contabilidad.load()`, etc.).
- Cada módulo (`src/renderer/js/<modulo>.js`) es un objeto plano con métodos (`load`, `render...`, `show...Modal`, `save...`), sin clases ni estado reactivo: el patrón es "pedir datos a `window.api`, construir el HTML como string, inyectarlo, volver a pedir datos cuando algo cambia". Es deliberadamente simple porque no hay equipo de frontend ni necesidad de un grafo de estado complejo.
- Los modales y toasts son utilidades compartidas (`App.openModal(html)`, `App.toast(msg)`), no un sistema de componentes.

### 8.1 Sidebar colapsable y submenús

El sidebar (`index.html` → `.sidebar`) ocupa siempre 64px en el layout — `.main-content` nunca se reacomoda al pasar el cursor —, pero su contenido real vive en `.sidebar-inner`, puesto encima con `position: absolute` dentro de ese mismo riel; al pasar el cursor (`.sidebar:hover`), solo `.sidebar-inner` cambia de ancho (64px → 240px) y se ve por encima del contenido, sin afectar el ancho real del `<aside>`. Es deliberado: una versión anterior dejaba que `.sidebar` mismo creciera, lo que reacomodaba toda la pantalla cada vez que el cursor pasaba por encima.

Los nombres de cada módulo (`.nav-label`) están siempre en el DOM pero con `opacity: 0` mientras está colapsado — no `display: none` — para que `.sidebar:hover .nav-label { opacity: 1 }` sea instantáneo sin tener que medir ni recalcular nada. Contabilidad y Gastos llevan además un acordeón (`.nav-item-main` + `.nav-submenu`, clase `.open` para expandir) que reemplaza los botones de pestaña que antes vivían arriba de cada pantalla: `sidebar.js` maneja el clic de apertura/cierre y, al elegir una sub-página, llama a `App.loadPage(pagina, pestaña)`, que a su vez le pasa esa pestaña al `.load(tabInicial)` del módulo correspondiente (`Contabilidad.load('mapeo')`, `Gastos.load('proveedores')`, etc.).

### 8.2 `Combobox`: select buscable para listas largas

`combobox.js` expone `Combobox.attach(selectOrId)`: toma un `<select>` ya existente (con o sin `<optgroup>`), lo oculta (`display: none`) y, justo después en el DOM, inserta un campo de texto con una lista filtrable. El `<select>` original sigue siendo la fuente de verdad de su valor — `Combobox` solo lo actualiza (`select.value = ...` + `dispatchEvent('change')`) cuando el usuario elige una opción —, así que todo el código de cada módulo que ya leía `document.getElementById(id).value` sigue funcionando sin cambios; solo hace falta una línea extra (`Combobox.attach('idDelSelect')`) después de `App.openModal(...)`. Se usa donde una lista puede crecer mucho (cuentas de servicio al asignar un propietario, cuentas del Plan Único al mapear un concepto o armar una Nota Contable manual).

## 9. Reportes y documentos (PDF/Excel)

- **Excel**: `ExcelExportService` recibe la forma genérica `{ tipo: 'tabla', columnas, filas, totales }` que devuelve cualquier método de `ReporteService` y construye el `.xlsx` con `exceljs`, sin que cada reporte tenga que saber nada de formato de celdas.
- **PDF e impresión**: no hay una librería de generación de PDF. Cada documento imprimible (`ReciboService.generarHTML`, `AsientoContableService.generarHTML`, los reportes) construye un **string de HTML con estilos inline**, lo carga en una `BrowserWindow` oculta (`new BrowserWindow({ show: false })`) vía `loadURL('data:text/html;...')`, y luego:
  - `webContents.print({ silent: false })` para imprimir directamente, o
  - `webContents.printToPDF({})` + `fs.writeFileSync` para exportar a archivo.
  Esto evita una dependencia externa de PDF a cambio de delegar el renderizado al motor de Chromium que la app ya trae incluido.

## 10. El motor de contabilidad de doble partida

Es la pieza más elaborada del sistema; vale la pena entenderla como un subsistema propio dentro de la arquitectura general.

### 10.1 Las tres piezas del catálogo

- **`plan_cuentas`**: árbol de cuentas (Clase → Grupo → Cuenta → Subcuenta → Auxiliar, niveles 1-5), cada una con `tipo` (Activo/Pasivo/Patrimonio/Ingreso/Gasto/Costo) y `naturaleza` (Débito/Crédito). Solo las cuentas **sin hijos** ("imputables") pueden recibir un movimiento directo; esto se valida en cada punto de entrada (`AsientoContableService.crear`, `MapeoContableService.actualizar`, `PlanCuentaService.toggleActivo`).
- **`mapeo_conceptos_contables`**: tabla `(modulo, concepto) → cuenta_contable_id`, con un `__default__` por módulo como respaldo. Es la única pieza editable por un Administrador sin tocar código: cambia a qué cuenta del PUC va, por ejemplo, un gasto de tipo "Mantenimiento".
- **`asientos_contables`** (cabecera) + **`movimientos_contables`** (líneas): el libro diario propiamente dicho. Cada asiento tiene un número consecutivo propio, un `tipo_origen` (`Gasto`, `Recibo`, `Movimiento`, `Manual`, `Reversion`) y, si vino de un proceso automático, una referencia al registro que lo originó.

### 10.2 Generación automática (sin lógica de negocio duplicada)

`GastoService.create`, `PagoService.registrarPagoSostenimiento`, `NuevoPuntoService.registrarAbono` y `CajaService.registrarConsignacion` llaman, dentro de su propia transacción, a un método de `AsientoContableService` (`generarDesdeGasto`, `generarDesdeRecibo`, `generarDesdeMovimientoTraslado`). Estos métodos **no contienen reglas por nombre de concepto**: leen el `cuenta_contable_id` que el repositorio ya resolvió al crear el registro, y construyen las líneas débito/crédito a partir de ahí. Consecuencia práctica: si más adelante se reasigna un concepto a otra cuenta en el Mapeo, el generador de asientos no necesita cambiar — simplemente usará lo que el mapeo diga en ese momento, para registros nuevos.

Caso particular: un recibo puede tener varios renglones en un solo cobro (meses de sostenimiento + abono a conexión + aplicación de saldo a favor). `generarDesdeRecibo` recorre **todos** los renglones del recibo y construye un único asiento balanceado: cada renglón positivo es un crédito, cada renglón negativo (aplicación de saldo a favor) es un débito por su valor absoluto, y si entró dinero real se agrega una línea de débito a Caja o Banco por el total cobrado.

### 10.3 Reversión, no eliminación

Anular un gasto o un recibo no borra ni modifica su asiento original: `AsientoContableService.revertir` crea un **nuevo** asiento (`tipo_origen = 'Reversion'`) con cada línea invertida (lo que era débito pasa a crédito y viceversa), y marca el asiento original como `Anulado` (solo para ubicarlo fácil en pantalla). Como consecuencia, ningún reporte necesita un filtro especial de "excluir anulados": sumar ambos asientos siempre da cero, así que basta con sumar todo.

### 10.4 Notas Contables (asientos manuales)

Para lo que la generación automática no cubre (partidas de apertura, ajustes, correcciones), un Administrador puede crear una **Nota Contable** manual desde Contabilidad → Asientos Contables. Pasa por la misma validación (`AsientoContableService.crear`) que la generación automática: cuentas activas, imputables, balanceadas. Si una nota afecta a Caja o Bancos (p. ej. registrar el saldo inicial al migrar al sistema), también se replica automáticamente en el ledger simple de movimientos (la tabla `movimientos` que alimenta el Dashboard y el módulo de Caja), para que las dos vistas de la caja —la simple y la de doble partida— nunca se desincronicen.

### 10.5 Validación de balance

`AsientoContableService.crear` es el único punto de entrada que de verdad inserta un asiento (tanto la generación automática como las notas manuales pasan por ahí). Verifica, por cada línea, que tenga exactamente un lado con valor (débito o crédito, no ambos ni ninguno), que la cuenta exista, esté activa y sea imputable, y que la suma total de débitos sea igual a la de créditos (con una tolerancia de centavos). Si algo no cuadra, lanza un error y toda la transacción (incluida la creación del gasto/recibo que lo disparó) se revierte: nunca puede quedar un gasto guardado sin su asiento, ni un asiento desbalanceado guardado.

## 11. Empaquetado y distribución

`npm run dist` ejecuta `electron-rebuild` (recompila el binario nativo de `better-sqlite3` contra la versión exacta de Electron usada — un módulo nativo compilado para el Node del sistema no es compatible con el Node embebido en Electron) y luego `electron-builder --win`, que genera un instalador NSIS en `dist/`. El binario de `better-sqlite3` se deja sin empaquetar en el `.asar` (`asarUnpack`) porque los módulos nativos no pueden ejecutarse desde dentro de un archivo `.asar`.

## 12. Respaldo en la nube (Google Drive, opcional)

A diferencia del resto del sistema (100% local), esta pieza sí sale a internet — pero solo para subir/traer un único archivo (la base de datos completa), nunca para operar en tiempo real contra ella.

### 12.1 Por qué un archivo completo y no sincronización fila por fila

Sincronizar tabla por tabla entre varios equipos (con resolución de conflictos campo a campo) es la complejidad de un sistema multiusuario distribuido — exactamente lo que esta app evita a propósito (ver sección 1). En vez de eso, `CloudBackupOrchestratorService` trata el `.db` completo como una sola unidad: lo sube, lo descarga, y compara cuál copia es más reciente con un número de **secuencia** simple (no con marcas de tiempo, que pueden desincronizarse entre relojes de distintos equipos).

### 12.2 Un solo escritor a la vez

- Cada equipo guarda su propio `secuenciaLocal` en un JSON local (`data/cloud-backup-estado.json`, junto a la base de datos pero fuera de ella: tiene que sobrevivir incluso a que el archivo `.db` se reemplace por el que viene de la nube).
- Antes de **subir**, el orquestador descarga primero el número de secuencia que hay en la nube; si es mayor que el `secuenciaLocal` de este equipo, significa que otro equipo subió algo que este todavía no tiene — se avisa del conflicto en vez de sobrescribir a ciegas.
- Después de **traer** un respaldo (`aplicarRespaldoDescargado` en `main.js`), `marcarRespaldoTraido(secuencia)` actualiza el `secuenciaLocal` antes de reemplazar el archivo `.db` — quedó como corrección de un bug real: si esto no se actualizaba, el equipo volvía a detectar "hay algo nuevo" en cada inicio de sesión y entraba en un ciclo de traer el mismo respaldo una y otra vez.

### 12.3 Consulta es de solo-lectura ante la nube

El rol `Consulta` nunca tiene cambios propios que perder (no puede escribir nada), así que es el único caso donde traer un respaldo más nuevo no necesita confirmación: `App.verificarActualizacionNubeSilenciosa()` se dispara solo después de un login con ese rol, y si hay algo más nuevo, lo trae y reinicia la app sin preguntar.

### 12.4 Canales que funcionan sin sesión

`CANALES_SIN_SESION` (en `main.js`) es la única excepción a la regla de "todo canal exige sesión" (sección 5): la pantalla de **Configuración Inicial** (un equipo nuevo, base de datos vacía) necesita poder revisar y traer un respaldo de la nube *antes* de que exista cualquier usuario local con el que iniciar sesión.
