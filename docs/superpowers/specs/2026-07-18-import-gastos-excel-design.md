# Importación histórica de Gastos desde Excel — Design

## Contexto y motivación

La asociación tiene el histórico real de gastos (2022-2026) en `Gastos Totales.xlsx`, un archivo de 5 hojas (una por año) llevado a mano durante casi 4 años. Antes de salir a producción hace falta cargar ese histórico en el sistema, tal como ya se hizo antes con el histórico de recibos.

Esa importación de recibos (2026-06-27) fue un script ad-hoc que insertó directo contra SQLite, sin pasar por la capa de servicio de la app ni por revisión previa: dejó rastro de **tres corridas de corrección** (fechas inválidas, colisión de numeración con el consecutivo real del sistema) documentadas en `data/log_importacion_historica_*.json` y `data/log_correccion_*.json`. Hoy el módulo de Gastos está mucho más integrado con Contabilidad que Recibos en ese momento (genera asiento de partida doble, valida saldo de caja, valida período contable, exige tercero del catálogo) — un insert directo dejaría el gasto "invisible" para Libro Diario, Libro Mayor, Balance de Prueba y Estado de Resultados. Este diseño evita ese enfoque: el import corre a través de `GastoService.create()`, el mismo código que usa el formulario, con una fase de revisión humana antes de escribir nada.

La inspección del Excel real (no solo lo que el usuario recordaba de su estructura) encontró inconsistencias materiales entre hojas que obligan a un mapeo por año y a exclusiones automáticas explícitas — ver "Hallazgos del Excel" abajo.

## Hallazgos del Excel (base del diseño)

- **371 filas de datos en 5 hojas**: `GASTOS GENERALES 2022` (108), `2023` (106), `2024` (80), `2025` (55), `2026` (22).
- **2022**: no tiene columna de identificación (Cédula/NIT) — la 3ª columna es `CANTIDAD`. La columna "N° Recibo" mezcla nombres de persona/empresa con números de factura/recibo (`FEP 10632`, `1901 100207215`, `10982 A`) que no identifican a nadie. 1 celda con error de fórmula (`#REF!`).
- **2023**: 13 columnas, pero de la 6 a la 13 hay una tabla de conciliación de caja totalmente distinta (recaudos, totales) que cae en las mismas filas por coincidencia de dónde se escribió — se ignora. Al final de la hoja (filas ~315-321) hay una sección aparte "RETIROS DE LA CUENTA" que parece relacionarse con ~6 filas de arriba que quedaron con `Valor` vacío. 1 celda con error de fórmula (`#VALUE!`).
- **2024**: la más limpia de las "grandes"; 10 filas sin identificación, 1 fila de `TOTAL GASTOS ENERO 2024 A DICIEMBRE 2024` al final. Incluye un `PRÉSTAMO` a Alberto Arciniegas ($808.187) que no es un gasto categorizable.
- **2025 / 2026**: estructura consistente `FECHA | N RECIBO | CEDULA/NIT | CONCEPTO | VALOR`; una 6ª columna suelta es un total acumulado (no un dato del gasto), se ignora. 5 filas sin identificación.
- **Terceros ya existentes en la BD**: solo 2 (el "No informado" del sistema y uno más) — la inmensa mayoría de los ~40-50 terceros distintos del Excel se crearán nuevos.
- **Períodos contables**: `periodo_bloqueo_anterior_a` está vacío y `periodos_contables` no tiene filas — ninguna fecha de 2022-2026 está bloqueada hoy. `asientos_contables` ya tiene registros desde 2017, así que este import encaja en el rango histórico existente.
- **Lista viva de Tipo de Gasto** (`mapeo_conceptos_contables` donde `modulo='Gasto'`): Accesorios y Materiales, Arrendamiento de Maquinaria, Bonificaciones, Elementos de Ferretería Menor, Energía Eléctrica, Equipo de Cómputo, Gastos Diversos, Gastos de Representación, Honorarios, Impuestos, Internet, Limpieza y Desinfección, Mano de Obra Ocasional, Mantenimiento, Mantenimiento Correctivo, Mantenimiento Preventivo, Mobiliario y Equipo de Oficina, Nómina, Papelería, Refrigerios, Telefonía, Transporte.

## Alcance

**Incluido:**
- Herramienta de línea de comandos (scripts en `scripts/import-gastos/`) con dos fases por hoja: `preview` (propone, no escribe) y `commit` (backup + escribe vía `GastoService.create()`).
- Procesamiento **hoja por hoja**, en orden 2026 → 2025 → 2024 → 2023 → 2022, cada una con su propio ciclo preview → revisión humana → commit → backup, para contener el daño de cualquier error a una sola hoja.
- Resolución de tercero (match o creación) y propuesta de Tipo de Gasto por fila, con nivel de confianza; nunca un default silencioso a "Gastos Diversos".
- Exclusión automática (con motivo) de: filas de título/encabezado, filas "TOTAL...", celdas con error de fórmula, la sección "RETIROS DE LA CUENTA" de 2023 y las filas de Valor vacío relacionadas, el préstamo a Alberto Arciniegas.
- Verificación de posible duplicado antes de insertar cada fila (misma fecha + valor + tercero + concepto ya existente en `gastos`).
- Réplica del registro en `auditoria` que normalmente genera `main.js` en cada escritura vía IPC, para no perder trazabilidad al insertar por script.
- Log JSON de resultado por corrida de `commit` (mismo patrón que los logs de importación de recibos).

**Explícitamente fuera de alcance:**
- Cualquier cambio a `GastoService`/`GastoRepository`/al formulario de Gastos — el import reutiliza ese código tal cual existe, no lo modifica.
- Resolver automáticamente las filas de la sección "RETIROS DE LA CUENTA" de 2023 o el préstamo — quedan listadas para que el usuario las resuelva a mano (por Excel corregido o dándome el dato directamente).
- Un mecanismo genérico de importación reutilizable para otros módulos — esto es una herramienta puntual para esta carga histórica, con mapeo de columnas específico de este archivo.
- Marcar en la base de datos qué gastos vinieron del import (no existe columna `origen` en `gastos` y agregarla no es necesaria: la trazabilidad queda en el log JSON + en `auditoria`, igual que con recibos).
- Ejecutar `commit` para ninguna hoja sin que el usuario haya aprobado explícitamente el CSV de esa hoja.

## Diseño

### 1. Estructura de archivos

```
scripts/import-gastos/
  config-hojas.js       # mapeo de columnas y reglas de exclusión por año
  leer-excel.js         # lee una hoja, aplica mapeo + exclusiones, devuelve filas normalizadas
  clasificar.js         # propone tercero y tipo_gasto por fila, con nivel de confianza
  preview.js             # CLI: node scripts/import-gastos/preview.js 2026
  commit.js              # CLI: node scripts/import-gastos/commit.js 2026
  output/
    2026-preview.csv
    2026-commit-log.json
    ...
```

Todo corre con `electron.exe` en modo Node (`ELECTRON_RUN_AS_NODE=1`), el mismo mecanismo que ya usa `scripts/test.js`, porque necesita `better-sqlite3` (compilado contra el ABI de Electron) y los servicios reales de `src/services`/`src/repositories`.

### 2. `config-hojas.js` — mapeo por hoja

Cada entrada define, por nombre de hoja: fila donde empiezan los datos, índices de columna para fecha/nombre/identificación/concepto/valor, y un patrón de exclusión adicional (ej. para 2023: cortar en la fila donde aparece literalmente "RETIROS DE LA CUENTA").

```js
module.exports = {
  '2026': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 } },
  '2025': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 } },
  '2024': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 } },
  '2023': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: 2, concepto: 3, valor: 4 },
            truncarTodoDespuesDe: { col: 'nombre', patron: /RETIROS DE LA CUENTA/i } },
  '2022': { headerRow: 7, cols: { fecha: 0, nombre: 1, id: null, concepto: 3, valor: 4 } }, // sin columna de identificación real
};
```

### 3. `leer-excel.js` — lectura y exclusiones automáticas

Para cada fila de datos de la hoja:
- Se descarta si está vacía, si el concepto empieza por "TOTAL" (cubre también la única fila así de 2024), o si `valor` está vacío/no es numérico.
- Si la hoja define `truncarTodoDespuesDe` (solo 2023) y una fila coincide con ese patrón, esa fila y **todas las que siguen** se descartan como bloque — cubre la sección "RETIROS DE LA CUENTA", que no son filas de gasto individuales sino un resumen aparte.
- Se descarta y se reporta aparte si alguna celda relevante tiene `{error: ...}` (fórmula rota) — no se adivina el valor.
- El concepto se normaliza: colapsa saltos de línea internos y espacios repetidos (varias filas del Excel real tienen el texto partido en varias líneas dentro de la misma celda).
- Devuelve `{ filas: [...], excluidas: [{ fila, motivo }, ...] }`.

### 4. `clasificar.js` — propuesta de tercero y tipo_gasto

**Tercero:**
1. Si hay número de identificación: normaliza (quita espacios) y busca en `terceros.numero_identificacion`. Si existe, usa ese `tercero_id`.
2. Si no existe, propone crear uno nuevo: `nombre_razon_social` = columna nombre, `tipo_identificacion` = `NIT` si el valor tiene forma `NNNNNNNNN-N`, si no `Cédula de Ciudadanía` (revisable en el CSV).
3. Si no hay identificación confiable (columna de identificación vacía, o el "nombre" no contiene ninguna letra alfabética de un nombre reconocible — es decir, es solo dígitos/espacios/guiones, como `"1901 100207215"`, `"FEP 10632"`, `"4385"`), propone el tercero `No informado` del sistema y guarda el texto original del Excel en `observaciones` del gasto para no perder el dato. Esta heurística es deliberadamente conservadora (falsos positivos hacia "No informado" son aceptables, un tercero inventado no lo es) y se afina en la implementación al ver el CSV real de la primera hoja.
4. Dentro de una misma corrida, dos filas que proponen el mismo tercero nuevo (mismo número de identificación) se resuelven al mismo tercero — no se duplica.

**Tipo de Gasto** — reglas por palabra clave sobre el concepto normalizado en mayúsculas, primera coincidencia gana, evaluadas en este orden:

| # | Palabras clave (contiene) | Tipo de Gasto |
|---|---|---|
| 1 | `FONTANERO` | Honorarios |
| 2 | `COBRO DE CARTERA` | Honorarios |
| 3 | `BONO` | Bonificaciones |
| 4 | `HONORARIOS`, `ASESORIA`/`ASESORÍA`, `CONTADOR`, `DECLARACION DE RENTA`/`DECLARACIÓN DE RENTA`, `ESTUDIO AMBIENTAL` | Honorarios |
| 5 | `TASA USO`, `CORTOLIMA`, `IMPUESTO`, `CAMARA DE COMERCIO`/`CÁMARA DE COMERCIO` | Impuestos |
| 6 | `REFRIGERIO`, `GASEOSA`, `AGUA BRISA`, `CAFÉ`/`CAFE`, `BOLSAS DE AGUA`, `HIDRATACION`/`HIDRATACIÓN` | Refrigerios |
| 7 | `IMPRESORA`, `PORTATIL`/`PORTÁTIL`, `MEMORIA DDR`, `EQUIPO DE COMPUTO`/`EQUIPO DE CÓMPUTO` | Equipo de Cómputo |
| 8 | `RESMA`, `FOLDER`, `TALONARIO`, `COSEDORA`, `TINTA` | Papelería |
| 9 | `SILLA`, `MESA`, `MOBILIARIO`, `ARCHIVO COLGANTE` | Mobiliario y Equipo de Oficina |
| 10 | `ENERGIA`/`ENERGÍA`, `ELECTRIC` | Energía Eléctrica |
| 11 | `INTERNET` | Internet |
| 12 | `TELEFON` | Telefonía |
| 13 | `TRANSPORTE`, `GASOLINA`, `VIAJE DE ARENA` | Transporte |
| 14 | `ARRENDAMIENTO`, `ARRIENDO` | Arrendamiento de Maquinaria |
| 15 | `LIMPIEZA`, `DESINFECCION`/`DESINFECCIÓN` | Limpieza y Desinfección |
| 16 | `MANTENIMIENTO PREVENTIVO` | Mantenimiento Preventivo |
| 17 | `TUBO`, `TUBERIA`/`TUBERÍA`, `UNION`/`UNIÓN`, `CODO`, `COLLAR`, `ADAPTADOR`, `REGISTRO`, `SOLDADURA`, `VALVULA`/`VÁLVULA`, `MANGUERA`, `PVC`, `CINTA TEFLON`, `LUBRICANTE` | Accesorios y Materiales |
| 18 | `HORAS`, `DIA DE`/`DÍA DE`, `MANO DE OBRA`, `APOYO A`, `JORNAL` (y ninguna palabra de la regla 17) | Mano de Obra Ocasional |
| — | Ninguna regla anterior aplica | **"Sin clasificar"** — no se propone valor, queda obligatoriamente para elección manual en el CSV |

Cada propuesta lleva `confianza: alta` (reglas 1-16, específicas) o `confianza: media` (reglas 17-18, genéricas por vocabulario de materiales/labor) para que la revisión humana priorice mirar primero las de confianza media y las "Sin clasificar".

`metodo_pago` = `Efectivo` y `tipo_operacion` = `Compra directa` para todas las filas (confirmado).

### 5. `preview.js <hoja>` — fase de propuesta (no escribe en la BD)

1. Carga la hoja con `leer-excel.js`, clasifica cada fila con `clasificar.js` (usando datos en vivo de `terceros`/`mapeo_conceptos_contables` vía conexión de solo lectura).
2. Escribe `output/<hoja>-preview.csv` con columnas: `fila_excel, accion, fecha, tercero_nombre, tercero_id_o_NUEVO, tercero_tipo_id, tercero_numero_id, tipo_gasto, confianza, concepto, valor, observaciones`. `accion` = `IMPORTAR` por defecto en confianza alta/media, `REVISAR` en "Sin clasificar" o cuando el tercero propuesto es "No informado".
3. Escribe `output/<hoja>-excluidas.csv` con las filas descartadas automáticamente y su motivo (fórmula rota, sección de retiros, préstamo, etc.).
4. No toca `data/acueducto.db` más que en lecturas.

El usuario abre el CSV (Excel/LibreOffice), corrige `tipo_gasto`/`tercero`/`accion` donde haga falta, y guarda.

### 6. `commit.js <hoja>` — fase de escritura

1. Lee `output/<hoja>-preview.csv` ya revisado. Solo procesa filas con `accion = IMPORTAR`.
2. Antes de escribir nada: copia `data/acueducto.db` a `backups_automaticos/pre_import_gastos_<hoja>_<timestamp>.db` (mismo patrón que usan los backups automáticos existentes).
3. Por cada fila, dentro de una transacción por fila:
   - Verifica duplicado: `SELECT 1 FROM gastos WHERE fecha_gasto=? AND valor=? AND tercero_id=? AND concepto=?`. Si existe, no inserta, registra `DUPLICADO_PROBABLE` en el log y sigue con la siguiente fila.
   - Si el tercero es "nuevo", lo crea vía `TerceroService.create()` (o reutiliza el ya creado en esta misma corrida si dos filas apuntan al mismo número de identificación).
   - Llama a `GastoService.create({...})` con los campos resueltos — corre toda la validación y contabilización real (asiento contable, saldo de caja, período).
   - Inserta manualmente en `auditoria` la misma fila que generaría `main.js` para `gastos:create` (usuario = `"Importación histórica Excel"`, acción, tabla, JSON del payload), ya que este script no pasa por el canal IPC.
4. Escribe `output/<hoja>-commit-log.json` con: filas insertadas, filas con `DUPLICADO_PROBABLE`, filas con error (mensaje de validación de `GastoService`, ej. saldo insuficiente o tipo_gasto inválido) — nada se pierde en silencio.
5. Imprime un resumen en consola al terminar.

Si `commit.js` falla a mitad de una hoja, las filas ya insertadas quedan (cada una es su propia transacción); se puede volver a correr `commit.js` sobre el mismo CSV sin duplicar, porque el chequeo de duplicado del paso 3 salta las que ya existen.

## Riesgos / notas de implementación

- **Las reglas de clasificación de tipo_gasto son un punto de partida, no un oráculo.** Con ~371 filas de vocabulario libre a mano, es esperable que la tabla de palabras clave necesite ajustes después de ver el CSV de la primera hoja (2026, la más simple) — el diseño ya asume esa iteración: se corre `preview` en 2026, se revisa, y si aparecen patrones no cubiertos se ajusta `clasificar.js` antes de seguir con 2025.
- **El chequeo de duplicado es a propósito estricto** (fecha+valor+tercero+concepto exactos) para no bloquear gastos legítimamente distintos que coincidan en fecha y valor (pasa varias veces en el Excel real, ej. pagos mensuales iguales a la misma persona en fechas distintas) — solo protege contra re-ejecutar el mismo `commit.js` dos veces sobre el mismo CSV.
- **No se usa `opId`/idempotencia de `main.js`** (es lógica de la capa IPC, no aplica a un script) — la protección equivalente aquí es el chequeo de duplicado del punto anterior más el hecho de que cada `commit.js` corre manualmente, una vez por hoja, bajo supervisión.
- **Las ~6 filas de 2023 con `Valor` vacío y la sección "RETIROS DE LA CUENTA"** quedan fuera de este script; si el usuario quiere cargarlas después de reconciliarlas a mano, se hace como gastos individuales por el formulario normal (no vale la pena automatizar 6 filas con ambigüedad real).
- **Orden de ejecución hoja por hoja es deliberado**: si algo sale mal en una hoja intermedia, el `backup` de esa hoja permite restaurar solo esa corrida sin perder las hojas ya confirmadas antes.
