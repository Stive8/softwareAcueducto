# Carga inicial de cartera — Reglas y decisiones

**Proyecto:** Acueducto El Rodeo / El Salitre / El Cural
**Archivo de datos:** `carga_inicial_cartera.json`
**Revisión:** 3 — auditoría completa: bloque de punto reconstruido, mixtos corregidos, períodos saneados

> **Dónde vive el archivo de datos:** `data/carga_inicial_cartera.json`, en la raíz del repo.
> Esa carpeta está en `.gitignore` a propósito -- el JSON trae nombre completo, teléfono y
> coordenadas GPS reales de las 306 cuentas, el mismo tipo de dato sensible que traen los cinco
> Excel fuente (`CARTERA.xlsx`, `historial-aportes.xlsx`,
> `RELACION_COLILLAS_DE_PAGO_2019_A_2025.xlsx`, `DatosPropietariosCuentas.xlsx`,
> `cuentas_2026-07-31.xlsx`), que por la misma razón tampoco están versionados. Sin este archivo
> en esa ruta, `paso11.js` (conciliación) y `paso9.js` (causación desde `plan_causacion`) no
> pueden correr -- si no está ahí, pedirlo antes de reproducir la carga inicial.

> **El precio del punto ahora se deriva de la evidencia textual, no del año.** Cada `punto_conexion` trae `origen_precio` explicando de dónde salió. Prioridad: override de negocio → saldo pendiente declarado en el recibo → señal de cierre/"antiguo" → regla por año.
**Fecha:** 2026-07-31

Este documento explica **cada decisión** tomada y **por qué**. El JSON trae los datos ya resueltos; este documento existe para que no tengas que inferir nada y para que sepas qué cambiar en la lógica de la aplicación.

> **Regla de oro:** no reinterpretes ninguna de estas decisiones. Todas fueron validadas contra los cinco archivos fuente y aprobadas por el dueño del negocio. Si un dato del JSON parece contradecir tu intuición, la respuesta está en este documento.

---

## 1. El problema que esto resuelve

El sistema anterior intentaba deducir **si un recibo era un abono a la deuda** a partir de la palabra escrita en el concepto (`ABONO` vs `CUOTA DE SOSTENIMIENTO`). Eso está mal: la palabra es el hábito de redacción del cajero, no una categoría contable.

Peor aún, la implementación generalizó a *"si una cuenta tiene algún recibo con la palabra ABONO, entonces todos los demás recibos de esa cuenta se excluyen"* — una regla con alcance mal delimitado que inflaba la deuda de cuentas que habían pagado normalmente durante años.

**La regla correcta no depende del texto.** Depende de la fecha y del período que el recibo declara cubrir.

---

## 2. Arquitectura de la solución: 4 tipos de deuda

La junta actual inició en **enero de 2024**. Antes de esa fecha las cuentas no eran confiables. Por eso la deuda se modela en cuatro buckets independientes:

| # | Bucket | Origen | ¿Cuadra con el Excel? |
|---|---|---|---|
| 1 | `deuda_antes_2024` | Saldo opaco al 31/12/2023, tomado literal de CARTERA | **Sí, exacto** |
| 2 | `deuda_punto_conexion` | Precio del punto − abonos al punto | No existe en el Excel |
| 3 | `deuda_meses_desde_2024` | Causación mensual 2024–2026 − pagos de sostenimiento | **Sí** |
| 4 | `deuda_total` | 1 + 2 + 3 | Difiere solo por el bucket 2 |

**Por qué cuatro y no uno:** cuando un asociado pregunta *"¿cuánto debo?"*, la respuesta útil es *"800.000 en total: 300.000 de antes de 2024, 450.000 de los 45 meses desde enero 2024, y 50.000 que le falta del punto"*. Un solo número no permite esa conversación, y además hace imposible explicar por qué el sistema no coincide con el Excel.

### El corte del 31/12/2023

- La apertura de cada cuenta es la columna `SALDO A 31/12/2023` de CARTERA, **tal cual, sin recalcular**.
- Los **1.534 recibos anteriores a 2024** se cargan como historial consultable pero **NO generan movimientos de cartera**. Ya están absorbidos en la apertura.
- Los **927 recibos de 2024 en adelante** sí generan movimientos.

> **Consecuencia importante:** ninguna decisión de clasificación sobre un recibo anterior a 2024 puede generar un saldo a favor falso, porque esos recibos no mueven cartera. Solo afectan el bucket 2 (punto) y el registro histórico.

---

## 3. Tarifas de sostenimiento

Validado con dos fuentes independientes: las 53 hojas individuales de `CARTERA.xlsx` y 1.285 recibos con período limpio. Además, el archivo de colillas lo dice explícitamente en dos celdas al margen (`Cuota años 2019 a 2023 = 5000`, `Cuota a partir 2024 = 10000`).

| Período | Finca | Con piscina | Comercial | Alquiler |
|---|---|---|---|---|
| ≤ 2016 | 1.500 | — | — | — |
| 2017 | 3.000 | — | — | — |
| **2018 – 2023** | **5.000** | **8.000** | **12.000** | **20.000** |
| **2024 – 2026** | **10.000** | **16.000** | **20.000** | **50.000** |

Solo hubo dos cambios de tarifa en toda la historia: **enero 2018** y **enero 2024**.

> ⚠️ **Trampa crítica:** `20.000` significa **Alquiler** hasta 2023 y **Comercial** desde 2024. **Nunca infieras la categoría a partir del monto sin considerar el año.**

**Categoría vigente:** se toma la de 2026 (columna `MENSUALIDAD 2026`, con respaldo en 2025 y 2024).

**Cuatro cuentas con tarifa desactualizada** en CARTERA (siguen en 5.000 pese a estar activas) se corrigen a 10.000 / Finca: `C021`, `R080`, `R091`, `S0244`. Vienen marcadas con alerta en el JSON.

---

## 4. Precio del punto de conexión

| Solicitud | Precio |
|---|---|
| Antes de 2022 | **300.000** |
| Desde 2022 | **500.000** |

No hay fecha de corte limpia: el primer pago de 500.000 es del 05-feb-2022 pero siguen apareciendo pagos de 300.000 hasta jul-2023, porque quien solicitó antes conservó el precio viejo. Por eso **el JSON trae el precio ya resuelto por cuenta** en `punto_conexion.precio` — úsalo, no lo recalcules.

Casos con override explícito (ver `incidencias.casos_especiales` en el JSON):

| Cuenta | Decisión |
|---|---|
| `S0362`, `S0363`, `S0364` | Un recibo de 1.500.000 cubre los tres puntos a 500.000 c/u |
| `C027`, `C0271` | 700.000 cada uno. Monto atípico, se conserva tal cual por decisión de negocio |
| `S0331`, `S03311` | Dos puntos de 300.000, ambos pagados en 2019 bajo el código `S0331` |
| `S008` | 315.000 pagados = punto de 300.000 + 15.000 que son 3 meses de cuota a 5.000 |
| `S0381`, `R0603`, `C025`, `S043`, `R0531`, `R0592` | Recibos mixtos, ya partidos en el JSON |

---

## 5. Clasificación de recibos: el principio

> **El recibo se guarda literal e inmutable. La clasificación va en un campo aparte.**

Cada recibo conserva `numero_recibo`, `fecha_recibo`, `valor` y `concepto_original` textual. La decisión de a qué se aplica va en `clasificacion` (`sostenimiento` | `punto`). Así un concepto mal rotulado nunca se pierde, pero tampoco contamina la contabilidad.

### ⚠️ No clasifiques por la palabra "PUNTO"

Hay falsos positivos verificados en el talonario:

| Recibo | Concepto | Realidad |
|---|---|---|
| `R018` | *"…SE DESCUENTA 90.000 POR NO TENER EL PUNTO CONECTADO"* | Abono a deuda **con condonación**, no pago de conexión |
| `R086` | *"…Punto por codificar"* | Sostenimiento puro; solo significa que el predio no tenía código |
| `S0365` rec. 1347 | *"TERMINA DE PAGAR EL PUNTO DE AGUA"* | El punto ya estaba saldado en 2019; se reclasifica a sostenimiento |

Los tres vienen ya corregidos en el JSON con su `nota` explicando el porqué.

### Recibos mixtos

Trece recibos pagan sostenimiento **y** punto en un solo detalle. Vienen **partidos en dos registros** con `es_split: true`, ambos conservando el mismo `numero_recibo` y el mismo `concepto_original`. Ejemplo real:

> *"PAGA PUNTO DE AGUA ANTIGUO $300.000 Y CUOTA DE SOSTENIMIENTO HASTA MARZO 2024"* → 516.000 = 300.000 punto + 216.000 sostenimiento

---

> ⚠️ **`numero_recibo` NO es único en la lista de recibos.** Los 13 mixtos y el recibo 1157 aparecen en 2 registros con el mismo número. Al conciliar contra la base, cuenta **números distintos** (2.462), no registros (2.475). Y al generar movimientos, genera **uno por registro**, no uno por número.

## 6. Imputación de pagos

**Prioridad 1 — el período declarado.** El 86% de los recibos (2.111 de 2.463) trae mes y año explícitos en el concepto: *"CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2024"*. Ya vienen parseados en `periodo_desde` / `periodo_hasta` (formato `YYYY-MM`). **Imputa a esos meses.** No adivines.

**Prioridad 2 — FIFO cronológico.** Solo para los recibos sin período (abonos genéricos), imputa contra los cargos más antiguos pendientes.

### Dos fechas distintas

- `fecha_recibo` — cuándo se escribió la colilla
- `fecha_pago_real` — cuándo entró la plata, extraída del concepto cuando menciona la transferencia

Hay recibos escritos semanas después del pago. Ejemplo: recibos 1185–1194 fechados 13-08-2022 pero cuyo concepto dice *"transferencia 01-07-2022"*. **Usa `fecha_pago_real` para el orden cronológico.**

---

## 7. Conciliación con el Excel

CARTERA es el "santo grial": si alguien revisa, tiene que coincidir.

**286 de 306 cuentas cuadran exacto, al peso.** Las otras 20 difieren por una razón única y deterministica:

```
saldo_sostenimiento_sistema  =  saldo_CARTERA  +  abonos_a_punto_desde_2024
```

**Por qué:** el Excel aplicó el dinero del punto de agua contra la deuda de sostenimiento, sin haber causado nunca el cargo del punto. Es decir, le dio a esas personas un descuento en cuotas equivalente a lo que pagaron por su conexión. El modelo correcto separa las dos cosas.

Cada cuenta trae el bloque `conciliacion` con `saldo_cartera_excel_2026`, `abonos_punto_desde_2024`, `saldo_sostenimiento_esperado` y `cuadra_exacto`. **La diferencia siempre se explica en un renglón.**

### Nueve cuentas donde CARTERA sí causó el punto

En `C0041`, `R0031`, `R008`, `R0944`, `R0945`, `S0031`, `S0402`, `R0521` y `S0201`, el Excel **metió el cargo del punto dentro de la columna `CAUSACION`** del año de instalación. Ejemplo:

> `S0031` CAUSACION 2024 = 600.000 = **500.000 del punto** + 10 meses × 10.000 (marzo a diciembre)

Para estas, el campo `plan_causacion.<año>.cargo_punto_incluido` trae el monto a separar, y `causacion_sostenimiento` la cifra neta que debes usar. **El efecto neto es cero: solo se reclasifica.**

### Ajuste residual

Tras cargar todo, compara el saldo resultante con `SALDO A 31/12/2026`. Si difiere (unas ~15 filas donde la aritmética del propio Excel no cierra), genera **un solo** movimiento `AjusteCargaInicial` fechado `2023-12-31` por la diferencia, con observación `"Ajuste de conciliación carga inicial — descuadre en hoja CARTERA"`.

> Calcúlalo **después** de separar el punto, para no enmascarar esa diferencia.

---

### Apertura del punto (crítico)

Los abonos al punto anteriores a 2024 **no generan movimiento** (misma regla que el sostenimiento). Sin un abono de apertura, 75 cuentas mostrarían deuda de conexión ya pagada. Por eso cada cuenta con punto trae `abonado_pre_2024` y `abonado_desde_2024`:

- Cargo `DerechoPuntoAgua` = `precio`, fechado en `primer_abono` (o 2023-12-31 si es null)
- Abono de apertura = `abonado_pre_2024`, fechado 2023-12-31, sin `recibo_detalle_id`
- Los abonos desde 2024 salen de los recibos reales

Control: apertura pre-2024 = **30.996.000**; abonos 2024+ = **9.906.000**; saldo final = **3.334.000**.

## 8. Estados y suspensiones

**Siete cuentas suspendidas sin ningún pago registrado** — `R002`, `R0211`, `R044`, `R0501`, `R0971`, `S009`, `S025`. Vienen con `fecha_suspension: "CREACION"`: se crean y se suspenden el mismo día, para que **no generen deuda**.

**Cuatro suspendidas con historial de pagos** — la fecha es el fin del último período efectivamente pagado:

| Cuenta | Suspensión | Razón |
|---|---|---|
| `S004` | 2021-06-30 | último pago cubre marzo–junio 2021 |
| `S0141` | 2021-12-31 | el recibo dice *"pendiente cuota todo 2022"* |
| `S0395` | 2019-01-31 | último pago ene-2019 |
| `S0441` | 2018-12-31 | último pago dic-2018 |

---

## 9. Saldos a favor

Catorce cuentas tienen apertura **negativa** al 31/12/2023. **Se cargan tal cual como crédito real.** Dos razones:

1. CARTERA ya los tiene incorporados en el saldo → cargarlos reproduce el Excel exactamente.
2. La práctica está documentada. El recibo 1773 de `R007` dice literalmente: *"CUOTA DE SOSTENIMIENTO DE ENERO A DICIEMBRE 2024 **(TENÍA SALDO A FAVOR DE $92.000)**"* y pagó 100.000 en vez de 192.000. La junta sí los honra.

Diez de los catorce ya se consumieron solos. Los otros cuatro — `S0331`, `R028`, `R070`, `R086` — llevan años sin usarse porque la persona sigue pagando completo. Vienen con `credito_no_consumido: true` **pero NO puestos en cero**, porque eso rompería el cuadre.

---

## 10. Códigos y cuentas

**Normalización:** quitar guiones y espacios, pasar a mayúsculas. Verificado: **no produce ni una sola colisión** en los cinco archivos. `C017-1` → `C0171`, `S033-2` → `S0332`, `O40-1` → `O401`.

**Nueve cuentas existen en la app y tienen recibos, pero no tienen fila en CARTERA** — `O401`, `R0103`, `R031`, `R0401`, `S0101`, `S0332S0382`, `S058`, `S061`, `S091`. Se crean con **apertura 0**. Tienen 1,4 M en pagos reales colgando.

> `S0332S0382` es un **código corrupto dentro de la propia app** (dos códigos pegados). Debe separarse en `S0332` y `S0382`.

**Catorce cuentas hay que dar de alta en la app** (están en CARTERA y DATOS pero no en la app): `C021`, `R002`, `R0081`, `R0211`, `R044`, `R0501`, `R080`, `R085`, `R091`, `R0971`, `S009`, `S0244`, `S025`, `S03321`. Siete de ellas son las suspendidas.

**Dirección de cuentas nuevas:** el prefijo del código mapea 1:1 con la vereda, sin excepciones (verificado en las 293 cuentas de la app): `C` → *Vereda El Cural*, `R` → *Vereda El Rodeo*, `S` → *Vereda El Salitre*. Úsalo en vez de un placeholder. La única excepción es `O401`, cuyo prefijo no corresponde a ninguna vereda.

**Diez personas tienen varios puntos.** Crea **un solo `propietario`** y varias filas en `cuenta_propietarios`. Ver `incidencias.personas_con_varios_puntos`.

---

## 11. Casos especiales resueltos

### `S063` → `S0365`

Son **la misma cuenta duplicada**, no dos cuentas. Ambas filas tienen apertura 140.000 y causación 60.000 idénticas en 2023; la diferencia es que a `S063` nunca le registraron los pagos. El nombre de `S0365` en CARTERA es literalmente *"MACHADO CARMEN ROSA S063 - S0365"*.

> **NO sumar las aperturas.** La apertura correcta es **40.000** (la de `S0365`, que sí tiene los pagos aplicados). Los 3 recibos de `S063` pasan a `S0365`.

### `S0331` / `S03311`

`S0331` pagó 600.000 en punto (recibos 434 y 458 de 2019) = dos puntos de 300.000. `S03311` es de la misma dueña y no tiene ningún recibo de punto propio.

> **NO mover plata entre cuentas.** Se marca el punto de `S03311` como saldado con nota de trazabilidad, y la apertura de `S0331` queda en −236.000 tal como CARTERA. Mover los 300.000 rompería el cuadre. `S03311` causa sostenimiento desde su primer recibo propio (jun-2024).

### `S0332` / `S0382`

Recibo 1157 de 240.000 el 30-jul-2022: *"pagó 2 años de los dos puntos"* = 2 predios × 24 meses × 5.000. **Partir 120.000 a cada uno.** Confirmado por los recibos separados de 120.000 en 2025.

---

## 12. Trampas de los archivos fuente

| # | Trampa | Qué hacer |
|---|---|---|
| 1 | Fila `TOTAL` con **239.382.500** al final de `historial-aportes` | Filtrar por código de cuenta válido, no por "fila no vacía" |
| 2 | En `RELACION_COLILLAS`, montos de **2017–2021 están en miles** (`300` = 300.000) y desde 2022 en pesos | Detectar el corte por año antes de parsear |
| 3 | **69 números de talonario sin usar** (blancos) | No crear registros para ellos |
| 4 | **33 recibos cobrados que no están en el sistema** (3.038.000, hasta jul-2026) | Vienen incluidos y marcados con `nota: "PENDIENTE DE CARGA"` |
| 5 | **93 recibos ANULADOS** | Ya excluidos. Lista completa en `recibos_anulados` |
| 6 | Doce recibos de **62.500** (`R003`/`R106`) | Mismo dueño con dos puntos; transferencias de 125.000 partidas. **No fusionar ni redondear** |
| 7 | **157 puntos comparten coordenada exacta** | Se capturaron por sector. Cargar como referencia, no para distinguir predios |
| 8 | Errores de digitación: `FEBREO`, `DICIEMRBE`, `CU0TA`, `SOSTENIMEINTO` | Ya normalizados en el parser |
| 9 | Huecos de numeración: recibos **287, 1143, 1148** | Nunca existieron |

---

## 13. Cambios requeridos en la aplicación

Esto **no** es solo un import. La app necesita:

1. **Modelar los 4 tipos de deuda** como concepto de primera clase, en el modelo de datos y en la UI.
2. **Editar y anular recibos** ya cargados, con motivo y trazabilidad. Usar los campos existentes `estado` / `fecha_anulacion` / `motivo_anulacion`. **Nunca borrado físico.**
3. **Reclasificar** el destino de un abono entre sostenimiento y punto **sin rehacer el recibo**. El caso `S0365` va a volver a pasar.
4. **Ajustes manuales de deuda** vía movimientos `AjusteAsamblea` / `AjusteCargaInicial`, siempre con rastro y usuario.
5. **Precio del punto por cuenta**, definido al crear el punto, con abonos parciales imputables contra él.
6. **`fecha_recibo` y `fecha_pago_real` separadas.**
7. **Recibos multi-período y recibos mixtos** (una parte a sostenimiento, otra a punto).

---

## 14. Orden de ejecución sugerido

1. Crear/actualizar **propietarios** (uno por cédula, no uno por cuenta).
2. Crear **cuentas** faltantes; separar `S0332S0382`; fusionar `S063` en `S0365`.
3. Cargar **categorías** vigentes con sus tarifas.
4. Aplicar **estados y suspensiones**.
5. Cargar **apertura opaca** al 31/12/2023 (`AperturaOpaca`, incluidos los créditos negativos).
6. Crear **cargos de punto** (`DerechoPuntoAgua`) con su precio por cuenta.
7. Cargar **todos los recibos** (histórico completo, inmutables).
8. Generar **movimientos de cartera solo para recibos ≥ 2024**.
9. **Causar meses** 2024 → julio 2026 según `plan_causacion`, respetando `inicio_causacion_estimado` y las suspensiones.
10. **Imputar abonos**: primero por período declarado, luego FIFO.
11. **Conciliar** contra `SALDO A 31/12/2026` y generar `AjusteCargaInicial` donde haga falta.
12. **Reportar** las 20 cuentas con diferencia y las 41 con alertas para revisión manual.

---

## 15. Cifras de control

| Concepto | Valor |
|---|---|
| Cuentas | **306** |
| Registros de recibo | **2.477** (16 recibos partidos en 2 registros) |
| Recibos anulados | 93 |
| Recibos con período parseado | 2.111 (86 %) |
| Cuentas con punto de conexión | 117 |
| Puntos con saldo pendiente | 17 — **3.334.000** |
| Apertura: deuda | **26.346.000** |
| Apertura: saldos a favor | −697.000 |
| Cuentas que cuadran exacto | **286 de 306** |
| Cuentas con alertas | 41 |

> Si al terminar tus cifras no coinciden con esta tabla, algo salió mal. Revisa antes de continuar.
