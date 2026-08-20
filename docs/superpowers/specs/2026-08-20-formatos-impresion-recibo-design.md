# Formatos de impresión de recibo (Carta + Térmica 80mm)

**Fecha:** 2026-08-20
**Estado:** Aprobado, pendiente de plan de implementación

## Objetivo

Permitir imprimir/exportar el mismo recibo en dos formatos de presentación —
Carta (actual) y Térmica 80mm (nuevo) — sin duplicar el modelo de datos, sin
crear una segunda entidad "recibo", y sin que el cambio de formato genere
otra transacción o modifique el número/valor del recibo.

## Contexto (estado actual del código)

- Único punto de generación de HTML: `ReciboService.generarHTML(id)`
  (`src/services/ReciboService.js:199-274`), consumido tanto por imprimir
  como por exportar PDF (`src/services/ReciboService.js:191-198` documenta
  explícitamente que es el mismo HTML para ambos casos).
- Impresión/PDF vía Electron nativo, sin `pageSize` explícito hoy:
  - `main.js:1375-1399` — IPC `recibos:imprimir` → `BrowserWindow` oculto +
    `webContents.print({ silent: false })`.
  - `main.js:1401-1433` — IPC `recibos:exportarPDF` → `webContents.printToPDF({})`.
- Datos del recibo: `ReciboRepository.findById(id)` (join
  `recibos + cuentas + propietarios`) + `.detalles` vía `getDetalles(id)`.
  Información institucional vía `ReciboRepository.getConfiguracionAsociacion()`
  (`src/repositories/ReciboRepository.js:263-272`) — hoy **no** trae
  `logo_path` ni `ciudad`.
- Deuda técnica documentada: `generarHTML` lee `recibo.detalles` original,
  nunca pasa por el valor vigente tras una corrección
  (`recibo_correcciones`) — si un recibo fue editado, la plantilla sigue
  mostrando el valor original.
- Numeración: consecutivo manual en `configuracion.consecutivo_recibos`,
  asignado en `PagoService.registrarPagoSostenimiento()`. No se toca.
- 3 puntos de entrada a imprimir/exportar hoy:
  1. Tabla de recibos (`src/renderer/js/recibos.js`, fila de acciones)
  2. Modal de detalle (`src/renderer/js/recibos.js`)
  3. Modal de confirmación tras registrar un pago (`src/renderer/js/pagos.js`)
- Configuración institucional vive en tabla `configuracion` (clave/valor),
  editable desde Configuración → General (`src/renderer/js/configuracion.js`,
  `renderTabGeneral()`), vía `ConfiguracionService.CLAVES_EDITABLES`.

## Decisiones ya aprobadas por el usuario

1. El formato térmico aplica **tanto a Imprimir como a Exportar PDF** (mismo
   selector, mismo comportamiento en ambos).
2. El selector de formato aparece en **los 3 puntos de entrada** actuales.
3. El logo del acueducto se incluye **solo en Carta**. La plantilla térmica
   es **solo texto** institucional (nombre, NIT, dirección, teléfono).
4. Se corrige de una vez la deuda técnica del valor vigente — ambas
   plantillas deben reflejar correcciones posteriores, no el valor original.

## Arquitectura

### 1. Separación de datos y presentación

- `ReciboService.obtenerDatosParaImprimir(id)`: método nuevo que reemplaza
  la construcción de datos inline de `generarHTML`. Reutiliza
  `getById(id)` + `getConfiguracionAsociacion()` (esta última extendida
  para traer también `logo_path`), y para cada detalle usa el valor
  vigente (aplicando la lógica que ya existe para corrección de
  `recibo_correcciones`, hoy usada en otros flujos de consulta pero no en
  la plantilla) en vez del valor original de `recibo_detalles`. Devuelve
  **un único objeto de datos**, formato-agnóstico.

- Nuevo módulo `src/services/recibos/plantillas.js`:
  ```js
  function renderCarta(datos) { /* HTML actual, sin cambios de diseño */ }
  function renderTermico80mm(datos) { /* nuevo */ }

  const PLANTILLAS = {
    carta: renderCarta,
    termico_80mm: renderTermico80mm,
  };

  module.exports = { PLANTILLAS };
  ```
  Cada función recibe el mismo objeto `datos` y devuelve un HTML string
  independiente (incluye su propio `<style>` inline, igual que hoy). Sin
  clases ni interfaces — funciones puras, consistente con el estilo del
  resto del proyecto.

- `ReciboService.generarHTML(id, formatoOverride)` queda como orquestador
  delgado:
  ```js
  async generarHTML(id, formatoOverride) {
    const datos = await this.obtenerDatosParaImprimir(id);
    const formato = formatoOverride
      || await configuracionService.obtener('formato_impresion_recibo')
      || 'carta';
    return PLANTILLAS[formato](datos);
  }
  ```

Agregar un formato futuro (p.ej. `termico_58mm`) = una función nueva +
una entrada en `PLANTILLAS`. No requiere tocar `generarHTML`,
`obtenerDatosParaImprimir`, IPC, ni la plantilla carta.

### 2. Configuración del formato predeterminado

- Nueva clave `formato_impresion_recibo` en tabla `configuracion`
  (valores válidos: `'carta'`, `'termico_80mm'`), default `'carta'`.
- Migración `src/database/migrations/043_formato_impresion_recibo.sql`
  (patrón de `021_configuracion_ciudad_logo.sql`): inserta la fila
  default si no existe.
- `ConfiguracionService.js`: agregar `formato_impresion_recibo` a
  `CLAVES_EDITABLES`, con validación de valores permitidos.
- `configuracion.js` (`renderTabGeneral`, sección "Parámetros
  Generales"): nuevo `<select>` "Formato de impresión predeterminado"
  con opciones Carta / Térmica 80mm, incluido en `guardarConfiguracion()`.

### 3. Selector de formato al momento de imprimir/exportar

- `Recibos.renderSelectorFormato(idPrefix)` (nuevo helper en
  `recibos.js`): devuelve el HTML de un `<select>` nativo:
  - `""` → "Usar predeterminado" (opción seleccionada por defecto)
  - `"carta"` → "Carta"
  - `"termico_80mm"` → "Térmica 80mm"
- `Recibos.leerFormatoSeleccionado(idPrefix)`: lee el valor actual del
  `<select>` por id (`idPrefix` evita colisiones entre tabla/modal).
- Se instancia en los 3 puntos de entrada, junto a los botones existentes
  (sin reemplazarlos, sin modal adicional):
  1. `recibos.js` — fila de acciones de la tabla
  2. `recibos.js` — modal de detalle
  3. `pagos.js` — modal de confirmación tras registrar un pago (ya
     invoca `Recibos.imprimir`/`Recibos.exportarPDF`, se le agrega el
     mismo selector)
- `Recibos.imprimir(id, formato)` / `Recibos.exportarPDF(id, formato)`
  pasan el segundo parámetro (string o `null`/`""`) tal cual a
  `window.api.recibos.imprimir(id, formato)` /
  `.exportarPDF(id, formato)`.
- `preload.js`: actualizar firmas de `imprimir`/`exportarPDF` para
  aceptar y reenviar `formato`.
- IPC handlers en `main.js` reciben `formato` y lo pasan a
  `reciboService.generarHTML(id, formato)`. Si `formato` es vacío/`null`,
  `generarHTML` resuelve el predeterminado desde configuración — mismo
  comportamiento para imprimir y exportar PDF.

### 4. Tamaño de página dinámico en Electron (solo térmico)

Chromium exige `pageSize` con ancho **y alto fijos** en `printToPDF` — no
existe "alto automático" como en una impresora térmica física de papel
continuo. Como el largo del recibo varía (número de conceptos,
observaciones, texto envuelto), se calcula la altura dinámicamente:

1. Cargar el HTML en el `BrowserWindow` oculto (ya se hace hoy).
2. Medir la altura real del contenido:
   `webContents.executeJavaScript('document.body.scrollHeight')`.
3. Convertir esa altura de px a micrones y usar
   `pageSize: { width: 80000, height: alturaCalculada + margen }`
   (80mm = 80000 micrones de ancho).
4. Aplicar el mismo `pageSize` calculado tanto a `printToPDF()` como a
   `print()` cuando `formato === 'termico_80mm'`, para que el driver de
   la impresora térmica no reciba por defecto tamaño Carta/A4.

Implementado como función auxiliar `calcularPageSizeTermico(browserWindow)`
en `main.js`, usada solo para el formato térmico. Para `carta` no cambia
nada (sin `pageSize`, comportamiento idéntico al actual).

**Riesgo conocido:** no hay impresora térmica física disponible para
probar en este entorno de desarrollo. Se puede verificar el PDF térmico
(ancho, alto, que no corte contenido), pero la impresión física en un
POS 80mm real queda como validación pendiente con hardware real después
de esta implementación.

## Diseño de la plantilla térmica 80mm

Contenido, de arriba hacia abajo:

1. Encabezado institucional centrado (texto, sin logo): nombre de la
   asociación, NIT, dirección, teléfono.
2. "RECIBO No. [numero_recibo]" + fecha, destacado.
3. Datos de cuenta: código, dirección, propietario, identificación — una
   línea por dato, sin tabla ni columnas.
4. Detalle: por cada línea de `recibo_detalles`, concepto (con
   `word-wrap`/salto de línea natural para conceptos largos como "CUOTA
   DE SOSTENIMIENTO DE ENERO A DICIEMBRE 2024"), período debajo, valor
   alineado.
5. TOTAL en bloque propio, tipografía más grande/bold — el elemento más
   visible del ticket.
6. Método de pago, observaciones.
7. Pie de página.

Reglas de estilo: layout de una sola columna (nada de `<table>` ni grid
de 2 columnas como en carta), tipografía sans-serif estándar (no
monoespaciada — se renderiza HTML normal vía Chromium, no ESC/POS crudo),
~11-12px cuerpo / 14-16px bold para total y número de recibo,
`@page { size: 80mm auto; margin: ... }` combinado con el cálculo de
altura dinámica descrito arriba.

## Fuera de alcance

- Formato térmico 58mm — la arquitectura (registro `PLANTILLAS`) queda
  preparada para agregarlo, pero no se implementa ahora.
- Prueba con impresora térmica física real (queda como validación
  posterior).
- Cualquier cambio a la numeración de recibos, al modelo de datos de
  `recibos`/`recibo_detalles`, o a la lógica de negocio en
  `PagoService`/`NuevoPuntoService`.

## Archivos afectados

**Backend**
- `src/services/ReciboService.js` — nuevo `obtenerDatosParaImprimir()`,
  `generarHTML()` se vuelve orquestador delgado.
- `src/services/recibos/plantillas.js` — nuevo, `renderCarta` +
  `renderTermico80mm` + registro `PLANTILLAS`.
- `src/repositories/ReciboRepository.js` — `getConfiguracionAsociacion()`
  extendida para traer `logo_path`.
- `src/services/ConfiguracionService.js` — nueva clave editable
  `formato_impresion_recibo` + validación.
- `main.js` — IPC `recibos:imprimir`/`recibos:exportarPDF` aceptan
  `formato`; nueva función `calcularPageSizeTermico()`.
- `src/database/migrations/043_formato_impresion_recibo.sql` — nueva
  migración + su test.

**Frontend**
- `src/renderer/js/recibos.js` — `renderSelectorFormato()`,
  `leerFormatoSeleccionado()`, `imprimir(id, formato)`,
  `exportarPDF(id, formato)`, selector agregado a tabla y modal.
- `src/renderer/js/pagos.js` — selector agregado al modal de
  confirmación tras pago.
- `src/renderer/js/configuracion.js` — nuevo `<select>` de formato
  predeterminado en `renderTabGeneral()`.
- `preload.js` — firmas actualizadas de `imprimir`/`exportarPDF`.

**Tests existentes a no romper**
- `src/services/ReciboService.anular.test.js`
- `src/services/ReciboService.correcciones.test.js`
- `src/repositories/ReciboRepository.anular.test.js`

## Resultado esperado (criterios de aceptación)

1. Registrar un pago genera el recibo exactamente igual que hoy (mismo
   modelo, mismo número, misma transacción).
2. Imprimir/exportar en Carta produce el mismo HTML/diseño que existe
   hoy (salvo el fix de valor vigente), sin regresiones.
3. Imprimir/exportar en Térmica 80mm produce un layout propio, legible,
   de una sola columna, con conceptos largos envueltos correctamente.
4. El formato predeterminado se configura en Configuración → General y
   se respeta cuando el usuario elige "Usar predeterminado".
5. Cambiar de formato al imprimir no crea otro recibo ni modifica
   número/valor — es el mismo recibo en ambos casos.
6. Agregar un futuro formato (p.ej. 58mm) solo requiere una función
   nueva + una entrada en `PLANTILLAS`, sin tocar el resto del módulo.
