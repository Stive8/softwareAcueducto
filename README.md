# Sistema Administrativo - Acueducto Veredal

Aplicación de escritorio 100% offline para la administración de acueductos veredales en Colombia: cuentas/predios, propietarios, categorías y tarifas históricas, pagos y recibos, gastos, caja y bancos, nuevos puntos de conexión, contabilidad de doble partida (Plan Único de Cuentas, asientos contables, notas contables), reportes y configuración con seguridad básica.

No es un ERP completo: el sistema está acotado a lo que necesita una junta de acueducto veredal. Sí incluye contabilidad de doble partida (débito/crédito) porque la asociación la requiere para sus informes ante la junta y la contadora, pero no maneja módulos que no se usan en este contexto (inventarios, facturación electrónica, nómina detallada, etc.).

## Stack Tecnológico

- **Electron** — aplicación de escritorio para Windows
- **better-sqlite3** — base de datos local; el sistema funciona 100% sin internet, el respaldo en la nube (más abajo) es opcional
- **JavaScript vanilla** en el renderer (sin frameworks de frontend)
- **Chart.js** — gráficos del dashboard
- **exceljs** — exportación de reportes a Excel
- **googleapis** — respaldo opcional de la base de datos en Google Drive
- **electron-builder** — empaquetado del instalador `.exe`

## Reglas de negocio clave

- La **cuenta/predio** es la entidad central, no el usuario. Propietarios y categorías cambian con el tiempo y se conserva su historial completo.
- Los pagos son siempre por **mes calendario completo** (nunca por cortes ni rangos de días), y un solo pago puede cubrir varios meses atrasados o futuros.
- Las **tarifas son históricas por categoría y año**: nunca se sobrescriben, así que una deuda vieja se cobra al precio vigente en esa fecha, no al precio actual.
- La numeración de recibos es **global y consecutiva**, configurable pero nunca reiniciable libremente.
- **Nada se elimina**, solo se desactiva/anula/cancela (cuentas, gastos, nuevos puntos, cuentas contables, etc.). Anular un gasto o recibo no borra su asiento contable: se crea un asiento de **reversión** que lo neutraliza, y el original queda marcado pero intacto como constancia.
- El sistema **no genera facturación automática**: todo pago o gasto se registra manualmente.
- Cada gasto, recibo y traslado de caja a banco genera **automáticamente su asiento contable** (débito/crédito), según un mapeo configurable de conceptos a cuentas del Plan Único de Cuentas — nadie tiene que llevar la contabilidad "a mano" aparte.
- El **Tipo de Gasto** es una lista cerrada (no texto libre): cada uno ya tiene una cuenta contable asignada en Mapeo de Conceptos, así que un gasto nunca puede quedar mal clasificado por error de tipeo. Un Administrador puede agregar nuevos tipos desde Contabilidad → Mapeo de Conceptos cuando aparezca una categoría de gasto que no estaba contemplada.
- **Terceros** (proveedores y otros aliados) es un catálogo separado de **Propietarios** (clientes/predios): un propietario nunca aparece como tercero ni viceversa, porque son relaciones de naturaleza distinta con el acueducto.

## Módulos

| Módulo | Qué hace |
|---|---|
| Dashboard | Indicadores generales: cuentas al día/en mora/con saldo a favor, caja, banco |
| Cuentas | Alta y gestión de predios, código manual, historial de propietarios y categorías, y ubicación GPS opcional (acometida/vivienda) con enlace directo a Google Maps |
| Propietarios | Personas/entidades asociadas a una o más cuentas a lo largo del tiempo |
| Categorías | Tipos de cuenta (Finca, Tienda, etc.) y su tarifa histórica de sostenimiento |
| Aportes | Estado de cartera (al día/en mora/saldo a favor), registro de pagos y abonos, y gestión de **Nuevos Puntos** (conexiones nuevas con valor total y abonos parciales hasta saldarse) |
| Recibos | Comprobantes generados por cada pago, impresión y exportación a PDF |
| Gastos | Egresos del acueducto, con su Tipo de Gasto (lista cerrada, define la cuenta contable — ver Mapeo de Conceptos), soportes adjuntos (facturas/comprobantes escaneados, con respaldo opcional en Google Drive) y, en su propia pestaña, el catálogo de **Terceros** (proveedores y otros aliados, para no reescribir nombre/identificación cada vez). Un gasto ya registrado se puede editar parcialmente (concepto y observaciones); el resto de campos (valor, fecha, tercero, tipo, método de pago) solo se corrige anulando y volviendo a registrar |
| Caja y Bancos | Saldos, movimientos, consignaciones (Caja→Banco) y retiros (Banco→Caja), ajuste de saldos a la realidad tras un arqueo físico/extracto bancario (solo Administrador), resumen de flujo del período, y **Caja Menor** (responsable asignado, historial de responsables, reembolsos y saldo objetivo configurable) |
| Contabilidad | Dashboard Financiero, Plan Único de Cuentas (catálogo jerárquico), Cuentas Automáticas (mapeo de claves internas del sistema —Caja, Banco, Caja Menor— a su cuenta del PUC), Plantillas de Contabilización (versionadas), Impuestos (retenciones/tributos asignables a plantillas), Períodos Contables (apertura/cierre/bloqueo por fecha), Mapeo de Conceptos (qué cuenta usa cada tipo de gasto/recibo, con opción de agregar nuevos tipos), Asientos Contables (automáticos + Notas Contables manuales, con reversión), y sus reportes: Cartera por Edades, Historial de Aportes/Gastos, Ingresos/Gastos por Período, Balance General, Estado de Resultados, Flujo de Caja, Libro Diario, Libro Mayor, Balance de Prueba (general y por Tercero), e Informe de Empalme (para entrega de junta) |
| Reportes | Cuentas y Propietarios, Estado de Cuentas (al día, en mora, saldo a favor, nuevos puntos), y Terceros con información incompleta |
| Configuración | Datos de la asociación, parámetros, gestión de usuarios y roles (Administrador/Usuario/Consulta), Auditoría (bitácora de acciones), cambio de contraseña, copia de seguridad/restauración local, respaldo en la nube |

> ⚠️ **Funcionalidad pendiente conocida — abonar específicamente a la deuda anterior al corte (2024).** En el detalle de una cuenta (Aportes → Ver → panel "Cartera (nuevo modelo)"), el aviso "Deuda anterior al corte" muestra el monto pero no tiene botón de acción — a diferencia del aviso de saldo a favor ("Usar", conectado 2026-08-11). Redimir un saldo a favor sí está disponible; abonar dinero nuevo específicamente contra la deuda de antes de 2024 no. El operador solo puede cobrar la cuota corriente desde Aportes → Registrar Aporte. **Workaround equivalente**: registrar ese pago como sostenimiento de los meses viejos correspondientes tiene el mismo efecto contable, pero hay que decírselo al administrador — la UI no lo sugiere. Conectar este botón implica un flujo de cobro nuevo (método de pago, recibo — como `registrarPagoSostenimiento`), no una simple conexión de canal; queda para después de esta entrega.

## Respaldo en la nube (opcional)

Cada equipo puede conectar su propia cuenta de Google Drive (Configuración → Respaldo en la Nube) para mantener una copia de la base de datos sincronizada entre varios computadores de la misma asociación (p. ej. el de la tesorería y el de la presidencia). No es obligatorio: el sistema funciona completo sin esto, guardando todo solo en el equipo local.

- **Un solo escritor a la vez**: antes de subir un respaldo, el sistema detecta si otro equipo subió una versión más nueva que este no tiene, para no sobrescribir cambios ajenos sin avisar.
- **Consulta es de solo-lectura ante la nube**: una sesión con rol Consulta nunca sube nada; al iniciar sesión, si hay una versión más reciente en la nube, la trae sola y reinicia la app, sin pedir confirmación (nunca tiene cambios propios que perder).
- **Equipo nuevo**: si la base de datos local está vacía, la pantalla previa al login ofrece traer el respaldo más reciente de la nube en vez de empezar desde cero.

La misma cuenta de Google Drive conectada también puede almacenar los **soportes de gastos** (facturas, comprobantes escaneados) que se adjuntan desde el módulo de Gastos, en una carpeta separada de la del respaldo de la base de datos.

## Arquitectura

> Para el detalle técnico completo (stack, flujo de datos, modelo de seguridad/IPC, base de datos, patrón Repository/Service, el motor de contabilidad de doble partida y el respaldo en la nube), ver **[ARQUITECTURA.md](ARQUITECTURA.md)**.

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
- El motor también incluye **Cuentas Automáticas**, **Plantillas de Contabilización**, **Impuestos** y **Períodos Contables** (control de fechas cerradas/bloqueadas) — ver ARQUITECTURA.md §10.6-10.8 para el detalle de cada uno.

## Instalación y ejecución (desarrollo)

Requisitos: Node.js 18+ y Windows.

```bash
npm install
npm start
```

En desarrollo la base de datos vive en `data/acueducto.db` dentro del proyecto. Si el archivo no existe, se crea sola en el primer arranque (vacía, solo con las categorías base y el usuario `admin`/`admin123`) — pero **en este repositorio ya existe y contiene datos reales**, ver advertencia abajo. `resetear_db.bat` o borrar el archivo manualmente solo tiene sentido en una base vacía de prueba.

No existe ningún botón en la interfaz para cargar o borrar datos de ejemplo/prueba: toda la información se registra igual sea de prueba o real, y nada se elimina de forma permanente (ver "Nada se elimina" arriba).

> ⚠️ **`data/acueducto.db` es la base de datos REAL de producción, no una base de prueba.** Contiene el historial real de la asociación (pagos desde 2017, 318 cuentas, más de 2.400 recibos) y se vende junto con el sistema. Vive fuera de git (`data/` está en `.gitignore`) porque contiene información personal (PII) de propietarios — su única protección es que quien trabaje en el repo sepa dónde está y qué no hacer con ella:
> - **No la borres, no uses `resetear_db.bat` sobre ella, ni la reemplaces con una base vacía.** Antes de cualquier operación riesgosa, respaldala (`cp data/acueducto.db data/acueducto.db.<motivo>-<fecha>`) — así se hizo el 2026-08-10 antes de consolidar la base tras la carga inicial de cartera.
> - **No vuelvas a correr `scripts/import-cartera/commit.js` (ni `preview.js`) contra esta base.** La carga inicial de cartera ya se ejecutó y se validó cuenta por cuenta durante varias semanas (conciliación 281/295 cuentas exactas contra el Excel de referencia — el resto tiene explicación documentada en `scripts/import-cartera/output/PUNTOS-CONFLICTIVOS.md`, ver también `scripts/import-cartera/output/paso12-reporte-final.md`). Volver a correrla sin saber esto repite semanas de trabajo y puede producir resultados distintos a los ya validados.
> - **Toda escritura contra esta base (una corrección, una redención, un ajuste manual) va seguida de `npm run conciliacion`.** Es de solo lectura (nunca inserta nada) y compara el saldo del sistema contra `data/carga_inicial_cartera.json` (necesario para que corra — no está en git, ver arriba). Si el conteo de "Cuadran exacto" no da el número esperado, hay que explicar la diferencia (¿es alguna de las documentadas en `PUNTOS-CONFLICTIVOS.md`, o es un efecto secundario de lo que se acaba de escribir?) antes de seguir — es el termómetro que valida cada cambio contra la base real, y quedó una vez sin poder correr semanas porque el JSON no estaba en disco.
> - **Toda corrección contra la base real va como script versionado en `scripts/import-cartera/paso9b-correcciones.js`, nunca como un comando suelto.** Un comando corrido una sola vez y no guardado no se puede auditar ni reproducir — así se perdió el rastro de una corrección real en 2026-08-11 que dobló la deuda de 7 cuentas por error (encontrada y corregida el 2026-08-13, ver `paso9b-correcciones.js` corrección 14).
> - Si en algún momento aparece más de un `acueducto.db` real (por ejemplo por trabajar en un `git worktree` con su propia carpeta `data/`, que no se sincroniza en el merge porque está gitignoreada), la copia válida es la que tenga la migración más reciente aplicada y más cuentas/recibos — compará antes de asumir cuál es la buena.
> - Los backups de este archivo (manuales y automáticos) viven en `backups_automaticos/` y `data/backups-manuales/`, también fuera de git.

## Importar gastos históricos desde Excel (herramienta puntual)

`scripts/import-gastos/` es un conjunto de scripts de línea de comandos (sin UI) para migrar, una sola vez, el historial de gastos de una asociación desde un Excel externo hacia el sistema: lee cada hoja, clasifica el tipo de gasto y reconcilia terceros contra el catálogo existente, genera un CSV de previsualización para revisar antes de aplicar, y finalmente escribe los gastos vía los mismos `Service` reales de la aplicación (con respaldo previo de la base de datos e idempotencia, para poder reintentar sin duplicar). Pensado para el técnico que hace el despliegue, no para el usuario final del sistema.

## Generar el instalador de Windows

```bash
npm run dist
```

Esto recompila `better-sqlite3` para la versión de Electron usada (`npm run rebuild`) y genera `dist/Acueducto Admin Setup <version>.exe` con electron-builder. En la app instalada, la base de datos vive en la carpeta de datos del usuario de Windows (`%APPDATA%/acueducto-admin`), no dentro de la carpeta de instalación.

## Licencia

Propietario
