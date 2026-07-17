# Coordenadas GPS en Cuentas (acometida y vivienda) — Design

## Contexto y motivación

Hoy la tabla `cuentas` (el predio/servicio, entidad central del sistema) no guarda ninguna ubicación geográfica, solo una `direccion` en texto libre. Para trabajo de campo (verificar conexiones, planear rutas de mantenimiento, ubicar un predio) la asociación necesita guardar dos puntos GPS por cuenta:

- El punto de conexión del agua al predio (**acometida**, término técnico de acueducto).
- El punto de la vivienda/casa del lote.

Estos dos puntos a veces coinciden y a veces no (un lote grande puede tener la acometida lejos de la casa).

## Alcance

**Incluido:**
- 4 columnas nuevas en `cuentas`: latitud/longitud de acometida y latitud/longitud de vivienda.
- Captura en el formulario de Nueva/Editar Cuenta con 2 campos numéricos por punto (latitud, longitud), más un checkbox "El punto de la vivienda es el mismo que la acometida" que copia los valores de acometida a vivienda.
- Validación: si se informa una coordenada de un punto, se exige la otra (no queda a medias); rango genérico válido (lat -90..90, lon -180..180) y rango plausible de Colombia (lat -4.3..13.5, lon -82..-66) para atrapar el error más común (lat/lon invertidos).
- Vista de Detalle de Cuenta: sección "Ubicación" con ambos puntos y un enlace "Ver en mapa" (Google Maps) por cada uno que abre el navegador externo.
- Reporte "Cuentas y Propietarios" (Excel/PDF/vista previa): se agregan las 4 columnas.
- Todas las columnas son opcionales (nullable); las cuentas existentes quedan sin dato, sin necesidad de backfill.

**Explícitamente fuera de alcance (YAGNI por ahora):**
- Mapa interactivo embebido o cualquier librería de mapas (Leaflet, Google Maps JS API, etc.) — solo un enlace externo a Google Maps.
- Captura por "pegar un solo texto lat,lon" con parseo automático — se decidió usar 2 campos numéricos separados por punto.
- Coordenadas en `nuevos_puntos` (conexiones nuevas / cargo financiero de conexión) — es un concepto distinto (financiero, no físico) y no se toca.
- Cambios al Plan Único de Cuentas contable (`plan_cuentas`) — coincide el nombre "cuenta" pero es una entidad completamente distinta (catálogo contable vs. predio/servicio).
- Mostrar coordenadas en la grilla/listado de Cuentas (tabla paginada) — solo en formulario, detalle y el reporte mencionado.
- Backfill o importación masiva de coordenadas para cuentas existentes.

## Diseño

### 1. Modelo de datos — migración `034_coordenadas_cuentas.sql`

```sql
-- Coordenadas GPS de la cuenta: dos puntos porque la acometida (punto de conexión del agua)
-- y la vivienda a veces no coinciden dentro del mismo lote. Ambas parejas son opcionales.
ALTER TABLE cuentas ADD COLUMN lat_acometida REAL;
ALTER TABLE cuentas ADD COLUMN lon_acometida REAL;
ALTER TABLE cuentas ADD COLUMN lat_vivienda REAL;
ALTER TABLE cuentas ADD COLUMN lon_vivienda REAL;
```

Se usa "acometida" (no "conexión") para no chocar con el concepto ya existente de "conexión" como cargo financiero de un Nuevo Punto (`nuevos_puntos.valor_total`).

Sigue el patrón ya establecido para agregar columnas a una tabla existente (ej. `013_gastos_tercero.sql`): `ALTER TABLE ... ADD COLUMN`, nullable, sin tocar migraciones previas.

### 2. Validación — `CuentaService.js`

Nueva validación en `create` y `update`, aplicada a cada pareja (acometida, vivienda) por separado:

- Si se informa latitud o longitud de un punto, se exige la otra (no se permite guardar media coordenada).
- Si ambas están presentes: deben ser números; latitud en `[-90, 90]`, longitud en `[-180, 180]`; y además dentro del rango aproximado de Colombia (`lat` entre `-4.3` y `13.5`, `lon` entre `-82` y `-66`) — este último rango existe específicamente para atrapar el error más común de digitación (invertir latitud y longitud), dado que el sistema es para un acueducto veredal colombiano.
- Si ambos puntos están vacíos, no se valida nada (coordenadas 100% opcionales).

### 3. Repository — `CuentaRepository.js`

- `create(cuenta)`: el `INSERT INTO cuentas` agrega las 4 columnas nuevas (valor `null` si no vienen).
- `update(id, cuenta)`: el `UPDATE cuentas` agrega las 4 columnas nuevas.
- `findById(id)`: sin cambios (ya hace `SELECT c.*`, las nuevas columnas quedan incluidas automáticamente).
- `findAll(params)`: sin cambios (el listado paginado no muestra coordenadas).

### 4. Formulario de Cuenta (Nueva/Editar) — `src/renderer/js/cuentas.js`

Nueva sección "Ubicación (Coordenadas GPS)" dentro de `showFormModal`, visible tanto al crear como al editar (a diferencia de `categoria_id`/`valor_conexion`, que solo aplican al crear):

- Campos `lat_acometida` / `lon_acometida` (inputs numéricos, `step="any"`).
- Checkbox `mismo_punto` ("El punto de la vivienda es el mismo que la acometida"). Al marcarlo, oculta los campos de vivienda; al enviar el formulario, si está marcado, se copian los valores de acometida a vivienda antes de construir el payload.
- Campos `lat_vivienda` / `lon_vivienda` (ocultos si el checkbox está marcado).
- Texto de ayuda breve indicando cómo copiar coordenadas desde Google Maps (mantener presionado el punto en el mapa → tocar las coordenadas para copiarlas → pegar cada número en su campo).
- Al editar una cuenta cuyos 4 valores ya son iguales, el checkbox se pre-marca automáticamente (conveniencia, no se guarda como flag separado en la base de datos — se recalcula comparando los valores en cada carga).

`saveCuenta(id)` se extiende para leer estos campos (parseFloat o `null` si vacíos) y agregarlos al `formData` enviado a `cuentas.create`/`cuentas.update`.

### 5. Detalle de Cuenta — `src/renderer/js/cuentas.js`

Nueva sección "Ubicación" en `showDetailModal`, con un bloque por punto (Acometida, Vivienda):

- Si el punto tiene coordenadas: muestra "lat, lon" y un enlace "Ver en mapa" que abre `https://www.google.com/maps?q=<lat>,<lon>` en el navegador externo (`target="_blank"`, o el mecanismo que use el resto de la app para abrir enlaces externos — ver `shell.openExternal` si ya existe un precedente en `main.js`/`preload.js`).
- Si no tiene coordenadas: "Sin coordenadas registradas".

### 6. Reporte "Cuentas y Propietarios"

- `ReporteRepository.getCuentas(estado)`: se agregan `c.lat_acometida, c.lon_acometida, c.lat_vivienda, c.lon_vivienda` al `SELECT`.
- `ReporteService.reporteCuentas({ estado })`: se agregan 4 entradas a `columnas` (`Latitud Acometida`, `Longitud Acometida`, `Latitud Vivienda`, `Longitud Vivienda`).
- Como `PlantillaReporteService` usa la misma estructura `{ columnas, filas }` tanto para la vista previa en pantalla como para PDF y Excel, este único cambio alcanza los tres formatos sin tocarlos por separado.

## Riesgos / notas de implementación

- El renderer no puede abrir enlaces externos directamente (`nodeIntegration:false`/`contextIsolation:true`): un `<a href="https://maps...">` normal no funciona igual que en un navegador normal dentro de una `BrowserWindow` de Electron. `electron.shell.openExternal` ya se usa en `CloudBackupService.js` (flujo OAuth) pero solo dentro del proceso principal, sin canal IPC expuesto al renderer. Este trabajo necesita agregar un canal nuevo (ej. `sistema:abrirEnlaceExterno`) en `main.js`/`preload.js` que llame a `shell.openExternal(url)`, y usarlo desde el botón "Ver en mapa" en vez de un `<a href>` plano.
- No se agrega índice sobre las nuevas columnas (no se filtran ni se buscan por coordenada en ningún flujo actual).
- Sin impacto en `Modo de Pruebas` (`DevToolsService`): no siembra datos en `cuentas` con lista fija de columnas, así que no requiere cambios.
