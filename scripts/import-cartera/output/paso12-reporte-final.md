# Carga inicial de cartera — Reporte final (paso 12)

Base: `carga_inicial_cartera.json` revisión 5. Ejecutado sobre la copia de trabajo en
`.worktrees/carga-inicial-cartera-v2/data/acueducto.db` (no producción). Ningún
`AjusteCargaInicial` fue insertado en ningún momento del proceso.

## 1. Cifras de control (cruce contra la sección 15 del MD)

| Concepto | MD | Real | Coincide |
|---|---|---|---|
| Cuentas (universo JSON) | 306 | 306 | ✅ |
| Cuentas con punto de conexión | 117 | 117 | ✅ |
| Puntos con saldo pendiente | 17 — 3.334.000 | 17 — 3.334.000 | ✅ |
| Apertura opaca sostenimiento: deuda | 26.346.000 | 26.346.000 | ✅ |
| Apertura opaca sostenimiento: saldos a favor | −697.000 | −697.000 | ✅ |
| Cuentas que cuadran exacto | 286 de 306 | **283 de 295 evaluadas** (+10 sin target, +1 excluida S0332S0382) | ver nota |
| Cuentas con alertas | 41 | **54** | ❌ ver hallazgo 6.5 |

Nota sobre "283 de 295": el MD cuenta 306 - 10 sin fila en CARTERA = 296, pero excluyendo
también `S0332S0382` (cuenta corrupta desactivada, nunca se evalúa) da 295 evaluadas. El
MD anticipaba 286 cerrando exacto; después de la corrección de tarifa derogada (sección
3.3) quedan 283 cerrando exacto y 12 con diferencia, las 12 completamente explicadas (13
entradas en las tablas de la sección 3 — C021 acumula dos) — ver sección 3.

## 2. Fórmula final de conciliación

```
target = saldo_cartera_excel_2026
         − 5 × tarifa_2026                         (ago-dic 2026 nunca se causa)
         + término de punto                        (ver abajo)
         − recibos_pendientes_de_carga_desde_2024   (existen en el sistema, CARTERA no los contó)

diferencia = saldo_sostenimiento_sistema − target
```

Término de punto (0 si la cuenta no tiene punto):

- `cuadra_exacto:true` **y** la cuenta tiene `cargo_punto_incluido` en algún año de
  `plan_causacion` (grupo de 9: `C0041, R0031, R008, R0944, R0945, S0031, S0402, R0521,
  S0201`) → restar `saldo_pendiente` del punto. En las demás `cuadra_exacto:true` no se
  toca nada, aunque tengan un punto propio con saldo pendiente sin relación con esta
  diferencia.
- `cuadra_exacto:false` y la cuenta **tiene** apertura opaca (`apertura_opaca_2023_12_31
  > 0`) → sumar `abonos_punto_desde_2024`.
- `cuadra_exacto:false` y la cuenta **no** tiene apertura opaca → restar `saldo_pendiente`
  del punto.

## 3. Las 12 cuentas con diferencia (de 295 evaluadas), 13 entradas

Ninguna lleva `AjusteCargaInicial`. Las 12 están completamente explicadas: 1 (cuenta
equivocada) + 1 (pago real no registrado) + 1 (pago proyectado que nunca existió) + 4
(desfase de período) + 2 (error aritmético) + 4 (tarifa) = 13 entradas sobre 12 cuentas
únicas, porque C021 aparece dos veces (una en error aritmético, otra en tarifa — es la
única cuenta con dos causas distintas sumadas).

**Revisión 2026-08-04:** se revisaron uno por uno, contra CARTERA.xlsx y el talonario
físico, los 4 recibos detrás de S0393, S048 y S010 (los tres con la categoría más débil
de la primera pasada: "pago que no aparece en ningún lado"). Resultado: 4 correcciones
permanentes agregadas a `paso9b-correcciones.js` (recibos 2137, 2384, 1659, 1825) — ver
el detalle en la sección 6. S0393 cierra exacto y sale de esta lista; **S0312 entra** (el
mismo pago que liberó a S0393 estaba mal anotado ahí); S010 y S048 se quedan, pero con la
causa real en vez de la suposición inicial.

### 3.1 Explicada — CARTERA le atribuyó el pago a la cuenta equivocada

El recibo 2137 ($270.000, 22-mar-2025) es el cuarto de cuatro pagos consecutivos de la
familia Ospina por transferencia (2134→S0394, 2135→S0391, 2136→S0392, 2137→debía ser
S0393) pero CARTERA lo anotó bajo S0312. Evidencia: el nombre en la colilla es "Ospina
Machado Mariano y/o Azucena Salguero" — S0312 ya había cambiado de dueño a Azucena
Salguero antes de esa fecha; los demás recibos de S0312 forman una cadena sin huecos que
el 2137 duplicaría; y CARTERA mostraba S0312 con saldo negativo (crédito que no existía).
Se reasignó el movimiento de cartera (no el recibo, que se conserva intacto bajo su
número y su `cuenta_id` original — solo cambia el lado de la contabilidad de cartera).

| Cuenta | Diferencia |
|---|---|
| S0393 (recibió el pago corregido) | 0 — cierra exacto |
| S0312 (donde CARTERA lo tenía anotado) | +270.000 |

### 3.2 Explicada — un pago real que CARTERA nunca registró

El recibo 1825 ($90.000, 4-may-2024, cuenta S010) tiene un pago real y verificable, pero
CARTERA dejó `PAGOS EN 2024` vacío y el saldo de ese año igual a la causación completa,
como si nunca hubiera llegado. El sistema sí lo cuenta (por eso muestra $90.000 menos de
deuda). Junto con esto, el recibo 1659 (mismo predio, `CUOTA JULIO 2022 A DICIEMBRE
2023`) se quitó de cartera_movimientos: su efecto ya está dentro del saldo de apertura al
31/12/2023 que trae CARTERA (lo usó para cerrar 2023 en cero sin anotarlo como pago
aparte); contarlo también como abono en 2024 lo habría contado dos veces.

| Cuenta | Diferencia |
|---|---|
| S010 | −90.000 |

*Nota de proceso: la primera hipótesis para S010 (antes de revisar recibo por recibo) fue
que el dinero de 1825 quedaría como saldo a favor sin imputar, cerrando la cuenta contra
CARTERA. Se verificó mecánicamente (corriendo el algoritmo real de imputación) y esa
hipótesis era aritméticamente imposible: la causación total de S010 (31 meses) menos los
abonos que quedan tras retirar el 1659 da exactamente $90.000 pendientes, sin importar el
orden de imputación — el dinero de 1825 sí cubre cargos reales de 2024-2026, no queda
flotando. La diferencia de $90.000 es la firma exacta del pago que CARTERA no registró,
no un error de cálculo.*

### 3.3 Explicada — un pago que CARTERA proyectó pero que nunca existió

CARTERA declara tres pagos anuales para S048 (2024, 2025, 2026), pero solo hay dos
recibos reales: el 2019 (dic-2024) y el 2384 (ene-2026). El tercero es la fila de CARTERA
repitiendo el patrón de "paga siempre a fin/comienzo de año", no un pago real omitido.
Aparte, se corrigió el período del recibo 2384: decía "enero a diciembre 2026" pero la
asociada paga a fin de año o comienzos del siguiente y nunca ha pagado por adelantado —
el pago real es de 2025 (confirmado porque CARTERA registra `PAGOS EN 2025 = 192.000`).
Esta corrección de período es solo de trazabilidad (afecta el Historial de Aportes que
muestra la app) — no mueve la diferencia, porque el saldo de una cuenta sale de la suma
de los montos de sus movimientos, nunca de a qué cargo quedó imputado un abono.

| Cuenta | Diferencia |
|---|---|
| S048 | +192.000 |

### 3.4 Explicadas — desfase de período declarado (pagan con retraso; el recibo declara
meses de un año anterior; el sistema imputa al período declarado — más preciso que
CARTERA, que contó la plata en el año en que entró)

| Cuenta | Diferencia |
|---|---|
| S034 | −100.000 |
| R079 | −15.000 |
| R068 | −2.000 |
| S03351 | +2.000 |

### 3.5a Explicadas — error aritmético en la propia fila de CARTERA (verificado, no
inferido: reconstruyendo apertura + causación − pagos año por año con las cifras que
trae la propia hoja, el resultado no coincide con el `saldo_final` que CARTERA escribió)

| Cuenta | Diferencia | Verificación |
|---|---|---|
| S0162 | +210.000 | 2024: apertura(120.000) + causación(120.000) − pagos(0, sin recibos) = 240.000. CARTERA escribió 30.000. |
| C021 (parte) | +120.000 | 2025: saldo previo(60.000, sin error) + causación(60.000) − pagos(0) = 120.000. CARTERA escribió 0. Ver 3.6. |

### 3.5 Explicadas — corrección de tarifa derogada, decisión de negocio (diferencia
DELIBERADA, no descuadre)

CARTERA seguía cobrando 5.000/mes a cuentas activas donde esa tarifa dejó de existir en
2024 (categoría Finca, tarifa vigente 10.000). Verificado en `DatosPropietariosCuentas`:
las 4 son `TIPO=CASA`, con coordenadas de campo, sin marca de suspensión, y ninguna tiene
recibos desde 2024 (nada que reimputar). Se borraron sus 31 `CargoMensual` a 5.000 y se
regeneraron a 10.000 (12 meses 2024, 12 meses 2025, 7 meses 2026 = 310.000 causación cada
una), con observación *"Tarifa corregida a la vigente 2024: CARTERA mantenia 5.000
(tarifa derogada) por falta de actualizacion"*.

| Cuenta | Diferencia | Detalle |
|---|---|---|
| **C021** | **+275.000** | 155.000 por la corrección de tarifa + 120.000 del error aritmético ya reportado en la fila de CARTERA (ver 3.6). **La mayor divergencia justificada del proyecto.** |
| R080 | +155.000 | Puro efecto de la corrección de tarifa. |
| R091 | +155.000 | Puro efecto de la corrección de tarifa. |
| S0244 | +155.000 | Puro efecto de la corrección de tarifa. |

Las 7 suspendidas con la misma tarifa desactualizada (`R002, R0501, R0971, S004, S009,
S0141, S0441`) se dejaron a 5.000, sin tocar: `DatosPropietariosCuentas` las marca "NO
EXISTE" / "NO ENCONTRADO" / "CASA ABANDONADA", casi todas sin tipo, sin coordenadas y sin
teléfono. Cuadran con el Excel y subirles la tarifa solo infla una cartera que la junta
decidirá si castiga.

### 3.6 C021 — la parte que no es tarifa, resuelta

Antes de la corrección de tarifa, C021 ya mostraba +120.000. Se descartó bug del paso 9
(causaba correctamente a la tarifa vigente en el plan en ese momento) y se descartó punto
y pendiente-de-carga. Al reconstruir año por año la propia fila de CARTERA (ver 3.5a) el
error queda identificado: el saldo de 2025 debía dar 120.000 según la causación y los
pagos que la propia hoja declara, pero CARTERA lo escribió en 0. Los 120.000 más los
155.000 de tarifa dan los 275.000 totales — **ninguna parte de C021 queda sin
explicación.**

### Correcciones aplicadas antes de llegar a esta lista

- **R0944, R0031, R0945**: cerraban con el término de punto (grupo `cargo_punto_incluido`,
  restar saldo pendiente). Antes de la corrección mostraban −300.000 / −250.000 / −150.000.
- **S03311**: era la única de las "20 celda vacía" que sí necesitaba causar el año 2024
  completo. Se insertaron 12 `CargoMensual` de 10.000 (enero-diciembre 2024), observación
  *"Causacion inferida: celda vacia en CARTERA, confirmada por continuidad del saldo"*.
  Cerraba en 0 tras la inserción.
- **Recibo 2137**: reasignado de S0312 a S0393 (ver 3.1). Solo se movió el movimiento de
  cartera; el recibo y su `cuenta_id` original no se tocaron.
- **Recibo 2384 (S048)**: período corregido de 2026 a 2025 en `recibo_detalles` (ver 3.3).
  No afecta ningún cargo ni imputación.
- **Recibos 1659 y 1825 (S010)**: 1659 eliminado de cartera_movimientos (su efecto ya
  estaba en la apertura); 1825 pasó a abono libre. Los 3 abonos de S010 desde 2024 se
  recalcularon juntos, en orden cronológico (ver 3.2).

## 4. Alertas del JSON: 54 cuentas (no 41)

| Alerta | Cuentas |
|---|---|
| Categoría asignada por defecto (sin dato en CARTERA) | 17 |
| No existe en la app: debe darse de alta | 14 |
| No existe en CARTERA pero tiene recibos: apertura 0 | 9 |
| Mensualidad fuera del tarifario 2024+ | 7 |
| Suspendida sin ningún pago: suspender el mismo día de creación | 7 |
| CARTERA incluyó el cargo del punto dentro de causación 2024 | 4 |
| Tarifa desactualizada en CARTERA (corregida) | 4 |
| Crédito no consumido: revisar con la junta | 4 |
| CARTERA incluyó el cargo del punto dentro de causación 2025 | 3 |
| Saldo a favor heredado de CARTERA | 12 (montos distintos) |
| Meses causados no enteros en 2024 | 6 |
| Otras (punto exento, suspensión con historial, cuenta corrupta, punto sin historial) | 5 |

(Una misma cuenta puede tener más de una alerta; 54 es el conteo de cuentas con al menos
una.)

## 5. Pendientes abiertos para revisión manual

1. **~~C021 sin explicación~~ — resuelto.** Los 275.000 de diferencia quedaron
   completamente explicados: 155.000 por la corrección de tarifa (3.3) y 120.000 por un
   error aritmético propio de la fila de CARTERA en 2025 (3.3a/3.4). No requiere
   `AjusteCargaInicial` ni más revisión — se deja documentado, no se ajusta.

2. **11 cuentas duplicadas en la base, preexistentes a esta carga inicial.** Mismo
   predio con dos filas bajo dos formas de escritura del código (con guion / sin guion),
   ambas creadas en el mismo instante (`2026-06-27 16:00:59`), antes de que este proyecto
   empezara. En los 11 pares, toda la actividad de cartera (pasos 1-11) quedó
   consistentemente en una sola fila de cada par — la otra fila del par tiene 0
   movimientos y 0 recibos, es decir, quedó completamente inerte durante todo el proceso.
   Fila viva (recibió los datos) / fila muerta (vacía) por par:

   | Código normalizado | Fila viva | Fila muerta (candidata a limpieza) |
   |---|---|---|
   | S0061 | id=197 `S0061` | id=64 `S006-1` |
   | S0337 | id=202 `S0337` | id=111 `S033-7` |
   | S0332 | id=283 `S0332` | id=112 `S033-2` |
   | S0221 | id=248 `S0221` | id=114 `S022-1` |
   | S0161 | id=127 `S0161` | id=272 `S016-1` |
   | S0392 | id=285 `S0392` | id=132 `S039-2` |
   | S0394 | id=284 `S0394` | id=134 `S039-4` |
   | R0591 | id=199 `R0591` | id=173 `R059-1` |
   | S0338 | id=210 `S0338` | id=218 `S033-8` |
   | R0071 | id=302 `R0071` | id=214 `R007-1` |
   | S0333 | id=221 `S0333` | id=304 `S033-3` |

   No se tocó ninguna de las 22 filas. Antes de borrar o fusionar las 11 "muertas" hay
   que verificar si tienen datos en otros módulos (gastos, pagos, terceros) fuera del
   alcance de esta carga.

3. ~~Discrepancia interna en el propio JSON~~ — **resuelto.** `incidencias.recibos_pendientes_de_carga`
   declaraba 33 recibos / $3.038.000, pero el detalle real (`recibos[].nota` que contiene
   "PENDIENTE DE CARGA") solo trae **32 registros, $2.978.000** (31 cuentas). El 33 venía
   de un conteo previo que incluía un registro sin valor asociado. El número correcto es
   32, y es el que se usó en la fórmula de conciliación.

4. **Recibo #1284** (`codigo_cuenta: "SINCODIFICAR"`, $60.000, 2022-12-03) — omitido de
   los pasos 7 a 11 por decisión ya aprobada. Requiere asignación manual de cuenta antes
   de poder cargarse.

5. **S004** — sin `saldo_cartera_excel_2026` en la conciliación (target `null`). No se
   pudo verificar contra CARTERA. Su `plan_causacion` 2025 y 2026 también vienen `null`
   (la cuenta está suspendida desde 2021-06-30 según el MD).

6. **4 créditos "no consumidos"** (`S0331, R028, R070, R086`) — la persona sigue pagando
   completo y el crédito nunca se usa. Cargados tal cual (no en cero), marcados por el MD
   para revisión de la junta.

7. **`requisitos_de_la_aplicacion`** (7 ítems del JSON) — cambios de UI/lógica de
   aplicación (modelar 4 tipos de deuda, permitir anular/editar recibos, reclasificar
   abonos entre punto y sostenimiento, etc.). Backlog de desarrollo, fuera del alcance de
   esta carga de datos.

## 6. Confirmación final

- Ningún `AjusteCargaInicial` insertado en ningún paso.
- Pasos 1 a 11 ejecutados sobre la copia de trabajo del worktree, no sobre producción.
- Los 3 tests de `paso11-conciliacion.test.js` originales se ampliaron a 9, cubriendo los
  tres ramales del término de punto y el término de pendiente-de-carga; todos pasan.
- **C021, R080, R091, S0244**: se borraron y regeneraron sus 31 `CargoMensual` cada una
  (5.000 → 10.000/mes, decisión de negocio, ver 3.5). Verificado antes de tocar nada que
  ninguna tenía recibos, abonos ni imputaciones desde 2024, así que no hubo nada que
  reimputar. Las 7 suspendidas con la misma tarifa vieja quedaron intactas.
- **Reproducibilidad verificada de punta a punta.** Las dos correcciones manuales de
  arriba (S03311 y la tarifa de las 4 cuentas) solo existían como scripts sueltos, no
  como parte del loader — quedaron escritas como `paso9b-correcciones.js` (+ `paso9b.js`
  CLI, 4 tests) para que una corrida limpia las reproduzca. Se creó también `paso11.js`
  (CLI de conciliación, nunca inserta `AjusteCargaInicial`). Se corrió el loader completo
  (pasos 1 a 11 + 9b) sobre una copia nueva de la base real previa a este proyecto
  (`data/acueducto.db`, verificada como el estado limpio: migraciones solo hasta la 038,
  `cartera_movimientos` y `nuevos_puntos` vacíos, 304 cuentas) y dio exactamente las
  mismas cifras: 283 cuadran, 12 con diferencia (mismos montos), apertura sostenimiento
  26.346.000/−697.000, 117 puntos con 17 pendientes por 3.334.000, apertura de punto
  30.996.000, 8.764 `CargoMensual`, 7 `AjusteCategoria`, 0 `AjusteCargaInicial`.
- **S0244 — asignación de propietario, corregida el 2026-08-03.** Al verificar
  `PUNTOS-CONFLICTIVOS.md` contra la base se encontró que el documento decía "ya se
  asignó" el propietario ZAPATO MACHADO PEDRO NEL, pero eso nunca se había ejecutado —
  `cuenta_propietarios` no tenía ninguna fila para S0244. Se agregó como una tercera
  corrección dentro de `paso9b-correcciones.js` (idempotente: solo inserta si la cuenta
  sigue sin propietario activo), se cubrió con 3 tests nuevos, y se ejecutó sobre la
  copia de trabajo del worktree. El documento de junta ya refleja el estado real.
- **La base real no cambió desde el 31 de julio.** La última `fecha_creacion` en recibos
  y cuentas es del 27 de junio (la carga histórica original); nada posterior. Existe una
  copia instalada en `%APPDATA%\acueducto-admin` mucho más pequeña (479 KB, del 22 de
  julio) que no parece ser la base de trabajo real — señalada por si acaso.
- **Revisión recibo por recibo, 2026-08-04.** Se revisaron uno por uno, contra
  CARTERA.xlsx y el talonario físico, los recibos detrás de S0393, S048 y S010. Cuatro
  correcciones permanentes agregadas a `paso9b-correcciones.js` (recibos 2137, 2384, 1659,
  1825 — ver sección 3), con 8 tests nuevos (14 en total en el archivo, todos pasan). Cada
  una se verificó primero en modo dry-run (transacción con `ROLLBACK`, corriendo el
  algoritmo real de imputación de `paso10-imputacion.js`) antes de aplicarla de verdad.
  Una hipótesis inicial sobre S010 (que el dinero del recibo 1825 quedaría como saldo a
  favor sin imputar) resultó ser aritméticamente imposible una vez verificada — el reporte
  se corrigió con la cifra real (−90.000) en vez de forzar la esperada, siguiendo la
  misma regla de no ajustar números para que cuadren con lo que se anticipaba. Se corrió
  `paso9b.js` sobre la base real de trabajo del worktree y `paso11.js` después, dando
  exactamente **283 cuadran, 12 con diferencia** — mismo total que antes de esta revisión
  (S0393 sale, S0312 entra), con S010 y S048 reclasificados a su causa real.
- **`motivosDiferencia.js` actualizado** con las 12 cuentas vigentes: S0312 (nueva), S010
  y S048 (motivo corregido), y S0162/C021/S034/R079/R068/S03351 (motivo con más detalle,
  mismos montos). La pantalla de cartera del punto anterior ya muestra estos textos.
- **Cambio de diseño, 2026-08-04: el saldo a favor deja de restar la deuda solo.** Antes,
  un abono que sobraba (o una apertura opaca negativa) reducía `deuda_exigible`/`saldo_opaco`
  de forma implícita, sin que quedara registrado en ningún lado que esa plata seguía sin
  destino. Ahora el `Abono`/`AperturaOpaca` se recorta a lo realmente imputado y el sobrante
  va a `cuenta_creditos` (`tipo='Abono'`), visible aparte como "saldo a favor disponible" y
  sin aplicarse a nada hasta que alguien lo redima explícitamente (`CarteraService.
  redimirCredito`, FIFO por defecto).
- **Segunda vuelta del mismo cambio: un abono SIN período declarado ("abono libre") tampoco
  entra al FIFO.** Al revisar S010 contra este cambio, el usuario detectó que el recibo 1825
  (sin período, por decisión de la corrección de esta misma sesión) seguía imputándose solo
  contra los meses de 2026 -- exactamente el comportamiento que el cambio de diseño existe
  para evitar. Causa: `paso10-imputacion.js` y `reimputarAbono` (en `paso9b-correcciones.js`)
  hacían caer CUALQUIER sobrante al FIFO general, sin distinguir "declaró un período pero esos
  meses no tienen cargo causado" (donde el FIFO sí tiene sentido: hay una intención declarada)
  de "nunca declaró ningún período" (donde no la hay). Se corrigió: el FIFO de respaldo ahora
  SOLO corre si hubo período declarado, aunque ese período específico no calce con ningún
  cargo real. Se midió el alcance en toda la base: **29 recibos sin período en 24 cuentas**
  ($1.811.000), aparte de S010 (que va por su propia corrección en `paso9b`, con su propio
  candado de idempotencia -- hubo que resetear sus tres abonos a mano y reimputarlos con
  `reimputarAbono` ya corregido). Las 24 cuentas se resetearon (imputaciones borradas, monto
  del Abono restaurado al valor original del recibo) y se reprocesaron con `paso10` corregido.
  **Total final en `cuenta_creditos`: $5.824.000, en 92 cuentas** (subió de $4.111.000/72
  tras este segundo ajuste).
- **`paso11-conciliacion.js` suma `saldoCreditoDisponible` al target**, igual que ya hacía
  con el término de punto de conexión: es una diferencia de *modelo* entre los dos sistemas
  (el Excel sí tenía el crédito descontado), no una diferencia de datos que haya que
  documentar cuenta por cuenta. La conciliación se corrió después de las dos rondas del
  cambio de diseño (sobrante + abono libre) y sigue dando **283 cuadran, 12 con diferencia**
  — mismo resultado que antes del cambio de diseño completo, con dos números más limpios:
  R079 se revela en −15.000 (antes se leía −5.000, con 10.000 de crédito tapando la cifra
  real) y S03351 en +2.000 (antes 52.000, con 50.000 de crédito). Se corrigió además un error
  aritmético propio en el texto de C021 (decía "$310.000"; 155.000 + 120.000 = $275.000, que
  es lo que siempre mostró el sistema).
- **S010, con el ajuste completo: queda exactamente como se definió.** Último mes cubierto
  diciembre 2025; **$140.000 a pagar** (7 meses de 2026, causación real: 31 meses × $20.000 −
  480.000 ya cubiertos por los recibos 2151 y 2302, que declaran período y cubren 2024/2025
  completos sin sobrante); **$90.000 de saldo a favor disponible** (recibo 1825, sin período,
  ya no se aplica solo). Su diferencia contra el Excel de CARTERA se mantiene en −90.000 (el
  Excel nunca registró ese pago) -- eso no cambia, porque `paso11` ya suma el crédito
  disponible al target: mover la plata de "deuda" a "crédito" dentro del sistema no mueve la
  brecha contra el Excel, solo la representa correctamente.
