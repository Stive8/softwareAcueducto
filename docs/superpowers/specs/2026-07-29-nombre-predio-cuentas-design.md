# Nombre de Predio en Cuentas — Design

## Contexto y motivación

Hoy la tabla `cuentas` (el predio/servicio, entidad central del sistema) solo identifica un punto por `codigo` (manual, único) y `direccion` (texto libre). Varios propietarios conocen y nombran su predio de otra forma (ej. "Finca La Esperanza") y ese nombre no siempre coincide con la dirección registrada. Se necesita un campo propio para ese nombre, para que sea más fácil ubicar la cuenta al buscarla y para que aparezca en el listado, el detalle y el reporte de Cuentas.

Esto surgió en conversación al validar si el sistema soporta dos propietarios simultáneos por cuenta (no lo soporta — cada cuenta tiene un único propietario activo a la vez, ver `cuenta_propietarios` y `PropietarioRepository.asignarACuenta`). El usuario decidió NO rediseñar ese modelo (los casos de dos dueños se seguirán registrando como un solo texto en `nombre_completo` del propietario, ej. "Juan Pérez y María Gómez") y en su lugar priorizar este campo, que es un requerimiento independiente.

## Alcance

**Incluido:**
- 1 columna nueva en `cuentas`: `nombre_predio` (texto libre, opcional).
- Captura en el formulario de Nueva/Editar Cuenta, justo después de Dirección.
- Búsqueda: el buscador de Cuentas (que ya busca por código, dirección y propietario actual/histórico) también encuentra por `nombre_predio`.
- Listado de Cuentas: nueva columna "Nombre de Predio" en la tabla paginada.
- Detalle de Cuenta: nueva fila en "Información General".
- Reporte "Cuentas" (`ReporteService.reporteCuentas`, ya exportable a Excel/PDF): se agrega la columna.
- Columna nullable, sin backfill — las cuentas existentes quedan sin dato.

**Explícitamente fuera de alcance (YAGNI por ahora):**
- Cualquier cambio al modelo de propietarios (soporte de múltiples propietarios simultáneos por cuenta). Se descartó explícitamente por el usuario en esta conversación.
- Historial de `nombre_predio` a través del tiempo (tabla tipo `cuenta_categorias`/`cuenta_propietarios`). No aplica: a diferencia de categoría y propietario, el nombre del predio no es un dato que el sistema necesite versionar — es un atributo estático de la cuenta, igual que `direccion`.
- Validación de formato o unicidad sobre `nombre_predio` — es texto libre, sin reglas de negocio, igual que `observaciones`.
- Hacerlo obligatorio — se decidió opcional porque no todos los predios tienen un nombre propio (ej. una tienda del pueblo).

## Diseño

### 1. Modelo de datos — migración `036_nombre_predio_cuentas.sql`

```sql
-- Nombre propio del predio (ej. "Finca La Esperanza"), distinto de la dirección: varios
-- propietarios identifican su predio por este nombre y no siempre coincide con la dirección
-- registrada. Opcional: no todos los predios tienen uno (ej. una tienda del pueblo).
ALTER TABLE cuentas ADD COLUMN nombre_predio TEXT;
```

Sigue el mismo patrón que `034_coordenadas_cuentas.sql`: `ALTER TABLE ... ADD COLUMN`, nullable, sin tocar migraciones previas. La última migración existente es `035_admin_recuperacion.sql`.

### 2. Repository — `CuentaRepository.js`

- `create(cuenta)`: el `INSERT INTO cuentas` agrega `nombre_predio` (valor `cuenta.nombre_predio || null`).
- `update(id, cuenta)`: el `UPDATE cuentas` agrega `nombre_predio` de la misma forma.
- `findById(id)`: sin cambios (ya hace `SELECT c.*`, la columna nueva queda incluida automáticamente).
- `findAll(params)`: se agrega `c.nombre_predio` al `SELECT` del listado paginado, y se agrega `OR c.nombre_predio LIKE ?` a `condicionBusqueda` (la misma constante que ya cubre `codigo`, `direccion` y el propietario actual/histórico). El parámetro nuevo (`%${search}%`) se suma una sola vez dentro del bloque `if (search) { queryParams.push(...) }`: ese mismo array `queryParams` se reutiliza tal cual para el `WHERE` principal y para el `countQuery`, así que no hace falta duplicarlo.

### 3. Service — `CuentaService.js`

Sin cambios: `nombre_predio` es opcional y sin reglas de negocio, no requiere validación nueva en `create`/`update`.

### 4. Formulario de Cuenta (Nueva/Editar) — `src/renderer/js/cuentas.js`

En `showFormModal`, nuevo campo de texto `nombre_predio` justo después del `form-group` de Dirección y antes de la sección "Ubicación (Coordenadas GPS)", visible tanto al crear como al editar (igual que Código y Dirección, a diferencia de `categoria_id`/`valor_conexion` que solo aplican al crear):

```html
<div class="form-group">
  <label for="nombre_predio">Nombre de Predio (opcional)</label>
  <input type="text" id="nombre_predio" name="nombre_predio" value="${cuenta?.nombre_predio ?? ''}">
</div>
```

`saveCuenta(id)` se extiende para leer este campo (`.trim()`, cadena vacía se envía como está y el Repository la normaliza a `null`) y agregarlo al `formData` enviado a `cuentas.create`/`cuentas.update`.

### 5. Listado de Cuentas — `src/renderer/js/cuentas.js`

En `renderTable`, nueva columna `<th>Nombre de Predio</th>` en el `<thead>`, y la celda correspondiente `<td>${cuenta.nombre_predio || '-'}</td>` en cada fila, ubicada junto a Código/Dirección.

### 6. Detalle de Cuenta — `src/renderer/js/cuentas.js`

En `showDetailModal`, nueva fila en la sección "Información General", junto a Dirección:

```html
<div class="detail-row">
  <div class="detail-label">Nombre de Predio:</div>
  <div class="detail-value">${cuenta.nombre_predio || '<em>Sin registrar</em>'}</div>
</div>
```

### 7. Reporte "Cuentas"

- `ReporteRepository.getCuentas(estado)`: se agrega `c.nombre_predio` al `SELECT`.
- `ReporteService.reporteCuentas({ estado })`: se agrega `{ key: 'nombre_predio', label: 'Nombre de Predio' }` a `columnas`, junto a `codigo`/`direccion`.
- Como `PlantillaReporteService` usa la misma estructura `{ columnas, filas }` tanto para la vista previa en pantalla como para PDF y Excel, este único cambio alcanza los tres formatos sin tocarlos por separado.

## Riesgos / notas de implementación

- Sin impacto en `Modo de Pruebas` (`DevToolsService`): no siembra datos en `cuentas` con una lista fija de columnas, así que no requiere cambios.
- No se agrega índice sobre `nombre_predio` (el volumen de cuentas de una asociación veredal no lo justifica; la búsqueda ya usa `LIKE` sin índice sobre `direccion`, que es análogo).
