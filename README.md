# Sistema Administrativo - Acueducto Veredal

Aplicación de escritorio 100% offline para la administración de acueductos veredales en Colombia: cuentas/predios, propietarios, categorías y tarifas históricas, pagos y recibos, gastos, caja y bancos, nuevos puntos de conexión, contabilidad de doble partida (Plan Único de Cuentas, asientos contables, notas contables), reportes y configuración con seguridad básica.

No es un ERP completo: el sistema está acotado a lo que necesita una junta de acueducto veredal. Sí incluye contabilidad de doble partida (débito/crédito) porque la asociación la requiere para sus informes ante la junta y la contadora, pero no maneja módulos que no se usan en este contexto (inventarios, facturación electrónica, nómina detallada, etc.).

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
- **Nada se elimina**, solo se desactiva/anula/cancela (cuentas, gastos, nuevos puntos, cuentas contables, etc.). Anular un gasto o recibo no borra su asiento contable: se crea un asiento de **reversión** que lo neutraliza, y el original queda marcado pero intacto como constancia.
- El sistema **no genera facturación automática**: todo pago o gasto se registra manualmente.
- Cada gasto, recibo y traslado de caja a banco genera **automáticamente su asiento contable** (débito/crédito), según un mapeo configurable de conceptos a cuentas del Plan Único de Cuentas — nadie tiene que llevar la contabilidad "a mano" aparte.

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
| Contabilidad | Plan Único de Cuentas (catálogo jerárquico), Mapeo de Conceptos (qué cuenta usa cada tipo de gasto/recibo), Asientos Contables (automáticos + Notas Contables manuales, con reversión), y sus reportes: Libro Diario, Libro Mayor, Balance de Prueba, Balance General, Estado de Resultados, Flujo de Caja, Historial de Pagos/Gastos, e Informe de Empalme (para entrega de junta) |
| Reportes | Cuentas y Propietarios, y Estado de Cuentas (al día, en mora, saldo a favor, nuevos puntos) |
| Configuración | Datos de la asociación, parámetros, cambio de contraseña, copia de seguridad/restauración, Modo de Pruebas |

## Arquitectura

> Para el detalle técnico completo (stack, flujo de datos, modelo de seguridad/IPC, base de datos, patrón Repository/Service y el motor de contabilidad de doble partida), ver **[ARQUITECTURA.md](ARQUITECTURA.md)**.

- **Renderer** (`src/renderer/`): HTML/CSS/JS vanilla, un archivo por módulo, sin acceso directo a Node — todo pasa por `window.api` (expuesto en `preload.js` vía `contextBridge`).
- **Proceso principal** (`main.js`): registra los manejadores `ipcMain.handle(...)`, cada uno devuelve `{ success, data }` o `{ success, error }`.
- **Servicios** (`src/services/`): lógica de negocio y validaciones, componen uno o más repositorios.
- **Repositorios** (`src/repositories/`): acceso directo a SQLite vía `better-sqlite3`.
- **Migraciones** (`src/database/migrations/`): archivos `.sql` numerados, ejecutados una sola vez y registrados en la tabla `migrations`.

### Contabilidad de doble partida

- **Plan Único de Cuentas** (`plan_cuentas`): catálogo jerárquico (Clase → Grupo → Cuenta → Subcuenta → Auxiliar). Solo las cuentas "imputables" (sin subcuentas debajo) pueden recibir movimientos; las cuentas de agrupación nunca admiten un valor directo.
- **Mapeo de Conceptos** (`mapeo_conceptos_contables`): asocia cada concepto de gasto/recibo/movimiento con una cuenta imputable del PUC, con un `__default__` por módulo como respaldo. Editable desde Contabilidad → Mapeo de Conceptos, sin tocar datos históricos ya registrados.
- **Asientos Contables** (`asientos_contables` + `movimientos_contables`): cada gasto, recibo (incluye meses de sostenimiento, abono a conexión y aplicación de saldo a favor en un solo asiento) y traslado Caja→Banco genera su asiento automáticamente, usando la cuenta ya resuelta por el mapeo. Anular el origen no borra el asiento: genera un asiento de **reversión** con las líneas invertidas, y dos asientos enlazados quedan en el histórico.
- **Notas Contables**: asientos manuales para lo que la generación automática no cubre (ajustes, partidas de apertura, correcciones). Si una nota afecta Caja o Bancos, también se refleja en el saldo simple de Caja/Banco que usa el Dashboard, para que ambos siempre coincidan.
- Reportes de doble partida: **Libro Diario** (todas las líneas, en orden cronológico), **Libro Mayor** (movimientos de una cuenta con saldo corriente) y **Balance de Prueba** (totales débito/crédito por cuenta, debe cuadrar siempre).

## Instalación y ejecución (desarrollo)

Requisitos: Node.js 18+ y Windows.

```bash
npm install
npm start
```

En desarrollo la base de datos vive en `data/acueducto.db` dentro del proyecto (se crea sola en el primer arranque, junto con las categorías base y el usuario `admin`/`admin123`). Si necesitas reiniciarla por completo, usa `resetear_db.bat` o bórrala manualmente.

### Modo de Pruebas

Desde **Configuración → Modo de Pruebas** puedes cargar o eliminar datos de ejemplo (cuentas, propietarios, pagos, gastos, y sus asientos contables) mientras pruebas el sistema, sin afectar el Plan de Cuentas, el Mapeo de Conceptos, la configuración ni el usuario administrador. Eliminar datos operativos limpia también los asientos contables y reinicia su numeración, para no dejar registros huérfanos. Nunca se ejecuta automáticamente.

## Generar el instalador de Windows

```bash
npm run dist
```

Esto recompila `better-sqlite3` para la versión de Electron usada (`npm run rebuild`) y genera `dist/Acueducto Admin Setup <version>.exe` con electron-builder. En la app instalada, la base de datos vive en la carpeta de datos del usuario de Windows (`%APPDATA%/acueducto-admin`), no dentro de la carpeta de instalación.

## Licencia

Propietario
