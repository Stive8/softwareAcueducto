# Sistema Administrativo - Acueducto Veredal

Aplicación de escritorio 100% offline para la administración de acueductos veredales en Colombia: cuentas/predios, propietarios, categorías y tarifas históricas, pagos y recibos, gastos, caja y bancos, nuevos puntos de conexión, reportes y configuración con seguridad básica.

No es un ERP: el sistema está deliberadamente acotado a lo que necesita una junta de acueducto veredal, sin contabilidad de doble partida ni módulos que no se usan en este contexto.

## Stack Tecnológico

- **Electron** — aplicación de escritorio para Windows
- **better-sqlite3** — base de datos local, sin dependencias externas ni nube
- **JavaScript vanilla** en el renderer (sin frameworks de frontend)
- **Chart.js** — gráficos del dashboard
- **exceljs** — exportación de reportes a Excel
- **electron-builder** — empaquetado del instalador `.exe`

## Reglas de negocio clave

- La **cuenta/predio** es la entidad central, no el usuario. Propietarios y categorías cambian con el tiempo y se conserva su historial completo.
- Los pagos son siempre por **mes calendario completo** (nunca por cortes ni rangos de días), y un solo pago puede cubrir varios meses atrasados o futuros.
- Las **tarifas son históricas por categoría y año**: nunca se sobrescriben, así que una deuda vieja se cobra al precio vigente en esa fecha, no al precio actual.
- La numeración de recibos es **global y consecutiva**, configurable pero nunca reiniciable libremente.
- **Nada se elimina**, solo se desactiva/anula/cancela (cuentas, gastos, nuevos puntos, etc.).
- El sistema **no genera facturación automática**: todo pago o gasto se registra manualmente.

## Módulos

| Módulo | Qué hace |
|---|---|
| Dashboard | Indicadores generales: cuentas al día/en mora/con saldo a favor, caja, banco |
| Cuentas | Alta y gestión de predios, código manual, historial de propietarios y categorías |
| Propietarios | Personas/entidades asociadas a una o más cuentas a lo largo del tiempo |
| Categorías | Tipos de cuenta (Finca, Tienda, etc.) y su tarifa histórica de sostenimiento |
| Pagos | Estado de cartera (al día/en mora/saldo a favor), registro de pagos y abonos |
| Recibos | Comprobantes generados por cada pago, impresión y exportación a PDF |
| Gastos | Egresos del acueducto (proveedor, NIT/cédula, categoría del gasto) |
| Caja y Bancos | Saldos, movimientos, consignaciones, resumen de flujo del período |
| Nuevos Puntos | Conexiones nuevas con valor total y abonos parciales hasta saldarse |
| Reportes | Cartera, ingresos/gastos por período, y contabilidad simplificada (Estado de Resultados, Balance General, Flujo de Caja) exportables a PDF y Excel |
| Configuración | Datos de la asociación, parámetros, cambio de contraseña, copia de seguridad/restauración |

## Arquitectura

- **Renderer** (`src/renderer/`): HTML/CSS/JS vanilla, un archivo por módulo, sin acceso directo a Node — todo pasa por `window.api` (expuesto en `preload.js` vía `contextBridge`).
- **Proceso principal** (`main.js`): registra los manejadores `ipcMain.handle(...)`, cada uno devuelve `{ success, data }` o `{ success, error }`.
- **Servicios** (`src/services/`): lógica de negocio y validaciones, componen uno o más repositorios.
- **Repositorios** (`src/repositories/`): acceso directo a SQLite vía `better-sqlite3`.
- **Migraciones** (`src/database/migrations/`): archivos `.sql` numerados, ejecutados una sola vez y registrados en la tabla `migrations`.

## Instalación y ejecución (desarrollo)

Requisitos: Node.js 18+ y Windows.

```bash
npm install
npm start
```

En desarrollo la base de datos vive en `data/acueducto.db` dentro del proyecto (se crea sola en el primer arranque, junto con las categorías base y el usuario `admin`/`admin123`). Si necesitas reiniciarla por completo, usa `resetear_db.bat` o bórrala manualmente.

### Modo de Pruebas

Desde **Configuración → Modo de Pruebas** puedes cargar o eliminar datos de ejemplo (cuentas, propietarios, pagos, gastos) mientras pruebas el sistema, sin afectar categorías, configuración ni el usuario administrador. Nunca se ejecuta automáticamente.

## Generar el instalador de Windows

```bash
npm run dist
```

Esto recompila `better-sqlite3` para la versión de Electron usada (`npm run rebuild`) y genera `dist/Acueducto Admin Setup <version>.exe` con electron-builder. En la app instalada, la base de datos vive en la carpeta de datos del usuario de Windows (`%APPDATA%/acueducto-admin`), no dentro de la carpeta de instalación.

## Licencia

Propietario
