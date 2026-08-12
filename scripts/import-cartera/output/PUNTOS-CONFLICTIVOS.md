# Puntos conflictivos de la carga inicial de cartera

Este documento es para la junta y la administración. No tiene lenguaje técnico ni
referencias internas del sistema — solo qué pasa con cada cuenta, cuánta plata hay de
por medio, por qué se decidió así, y qué falta decidir.

De las 295 cuentas que se pudieron comparar contra el Excel de CARTERA, 281 quedaron
cuadradas al peso (actualizado 2026-08-13, ver nota al final de esta sección). Las otras
11 cuentas del sistema no tienen fila en ese Excel, así que no hay contra qué compararlas.
Este documento cubre las que no cuadran, y las decisiones que quedaron pendientes.

---

## 1. Cuentas cuyo saldo no coincide con el Excel, y por qué

Catorce cuentas quedan con una diferencia frente al Excel de CARTERA. Ninguna se "ajustó a
la fuerza" para que cuadrara — cada una tiene una explicación verificada, y se deja
registrada así, con la diferencia visible, en vez de forzar el número.

*(Actualizado el 4 de agosto, después de revisar recibo por recibo contra el talonario
físico las tres cuentas de la categoría más débil de la primera revisión — "un pago que
no aparece en ningún lado". Dos de las tres resultaron tener una explicación más precisa
que la inicial; se corrige aquí en vez de dejar la explicación débil.)*

### 1.1 Un pago que quedó anotado en la cuenta equivocada

El 22 de marzo de 2025 una familia pagó por transferencia sus cuatro predios, en cuatro
recibos seguidos. Los primeros tres quedaron bien anotados; el cuarto ($270.000) quedó
escrito bajo el código de un predio que ya había cambiado de dueño meses antes, en vez
del predio correcto. Se identificó comparando el nombre de la transferencia con quién
era el dueño real de cada predio en esa fecha, y se corrigió cuál cuenta recibe el pago
— el recibo en sí no se tocó, solo a cuál cuenta se le abona.

| Cuenta | Diferencia | Qué pasó |
|---|---|---|
| S0393 (la cuenta correcta) | $0 | Ya recibe el pago que le correspondía — cuadra exacto. |
| S0312 (donde CARTERA lo tenía anotado) | $270.000 | Se queda con la diferencia: es el pago que le pertenecía a la otra cuenta. |

### 1.2 Un pago real que el Excel de CARTERA nunca registró

Un recibo de $90.000 (4 de mayo de 2024) es un pago real y verificable que el Excel de
CARTERA nunca anotó — dejó ese año en blanco y sin ningún pago, cuando sí lo hubo. El
sistema sí lo cuenta, así que en total muestra $90.000 menos de deuda que el Excel — pero
**no como deuda rebajada**: en pantalla, S010 muestra $140.000 a pagar de la cuota
corriente (real, causación completa) y, aparte, $90.000 de saldo a favor disponible sin
aplicar, porque el recibo no declaraba a qué meses correspondía. La plata es la misma; solo
que ya no se aplica sola a los meses de 2026 nada más porque nadie dijo para qué era. Un
segundo recibo del mismo predio, de un pago anterior, ya no se cuenta aparte: ese dinero ya
estaba incluido en la deuda de arranque que trae el propio Excel, y contarlo de nuevo
lo habría contado dos veces.

| Cuenta | Diferencia | Qué pasó |
|---|---|---|
| S010 | −$90.000 | Pagó $90.000 que CARTERA nunca anotó; el sistema sí lo cuenta. |

### 1.3 Un pago que el Excel de CARTERA daba por hecho, pero que nunca existió

El Excel de CARTERA asume que esta persona paga religiosamente una vez al año, y
"proyectó" un tercer pago para 2026 que en realidad nunca se hizo — solo hay dos recibos
reales, no tres. El sistema, que solo cuenta pagos con recibo real detrás, muestra más
deuda por esa razón. Aparte, se corrigió a qué año pertenece uno de los dos recibos
reales (estaba anotado en 2026 cuando en realidad es de 2025, por cómo esta persona paga
siempre a fin o comienzo de año) — esa corrección es solo de prolijidad, no cambia la
plata.

| Cuenta | Diferencia | Qué pasó |
|---|---|---|
| S048 | $192.000 | El Excel asumió un tercer pago anual que nunca se hizo. |

### 1.3b Otro pago real que el Excel de CARTERA nunca registró (agregado 2026-08-13)

El recibo 2246 de R0942 documenta una transferencia de $180.000 el 19 de junio de 2025
("TRANSFERENCIA 19/06/2025 - $180,000 - SALDO A FAVOR 4,000"), pero tanto el Excel de
CARTERA como la carga inicial del sistema lo registraron por $176.000. Verificado contra
el talonario físico: los $4.000 son plata real que la asociación recibió y que ninguno de
los dos sistemas contaba. Se agregó como saldo a favor disponible para R0942 (ver
`scripts/import-cartera/paso9b-correcciones.js`, corrección 15) — mismo tipo de diferencia
que S010 en la sección 1.2, encontrada más tarde porque no había ningún indicio hasta que
se revisaron uno por uno los recibos que mencionan "saldo a favor" en el talonario.

| Cuenta | Diferencia | Qué pasó |
|---|---|---|
| R0942 | −$4.000 | Transferencia de $180.000 registrada por $176.000; el Excel tampoco lo contó. |

### 1.4 Pagó tarde, y el recibo dice a qué meses viejos corresponde

Cuatro cuentas pagan con atraso, y el recibo aclara que ese dinero es para cubrir meses
de un año anterior (por ejemplo, "paga en enero de 2026 lo de septiembre-octubre de
2025"). El sistema nuevo respeta esa aclaración y aplica el pago al mes que realmente
cubre. CARTERA, en cambio, simplemente contaba la plata en el año en que llegó, sin
mirar a qué meses correspondía. El número del sistema es el más preciso de los dos.

| Cuenta | Diferencia |
|---|---|
| S034 | −$100.000 |
| R079 | −$15.000 |
| R068 | −$2.000 |
| S03351 | $2.000 |

### 1.5 Tarifa vieja que CARTERA nunca actualizó (decisión de la junta, no un error)

Cuatro cuentas activas — casas normales, no fincas abandonadas — llevaban años pagando
la tarifa de $5.000 que dejó de existir en 2024. La tarifa vigente para su categoría es
$10.000. CARTERA nunca actualizó su hoja para estas cuatro, así que su Excel las sigue
mostrando a $5.000. El sistema ahora las cobra a la tarifa correcta ($10.000) desde
enero de 2024, así que su saldo queda por encima del Excel — **a propósito, no es un
descuadre**.

| Cuenta | Diferencia | Nota |
|---|---|---|
| R080 | +$155.000 | Solo el efecto de la tarifa correcta. |
| R091 | +$155.000 | Solo el efecto de la tarifa correcta. |
| S0244 | +$155.000 | Solo el efecto de la tarifa correcta. |
| **C021** | **+$275.000** | $155.000 de la tarifa corregida, más $120.000 de un error propio del Excel de CARTERA (ver 1.6). **La cuenta con la mayor diferencia de todo el proyecto.** |

*(Siete cuentas más tenían esta misma tarifa vieja, pero están abandonadas o no
localizadas — no se les subió la tarifa. Ver sección 3.)*

### 1.6 El propio Excel de CARTERA no cierra en esa fila

Dos cuentas donde, revisando la fila de CARTERA con su propia calculadora — lo que debía
más lo que causó, menos lo que pagó — el resultado no coincide con el saldo que CARTERA
mismo escribió. No es un problema de nuestros datos: es un error de digitación o de
fórmula dentro del propio Excel, anterior a esta carga.

| Cuenta | Diferencia | El error en la fila de CARTERA |
|---|---|---|
| S0162 | +$210.000 | En 2024, con lo que ya debía más lo que causó ese año y sin ningún pago, el saldo debía quedar en $240.000. CARTERA lo escribió en $30.000. El error se arrastra a 2025 y 2026: hoy debe $480.000, no los $270.000 que muestra el Excel — no ha pagado sostenimiento desde 2018. |
| C021 (parte) | +$120.000 | En 2025, con la causación de ese año y sin pagos, el saldo debía quedar en $120.000. CARTERA lo escribió en $0. |

### 1.7 CARTERA confundió el pendiente del punto de conexión con deuda de sostenimiento

CARTERA arrastraba en el saldo de apertura los $156.000 que en realidad eran el
pendiente del punto de conexión (declarado textualmente en el recibo 1296 de dic-2022),
no deuda de sostenimiento. Ese pendiente se cubrió con los tres abonos de $52.000 de
2024. La apertura del sistema se corrigió a $0. La diferencia frente al Excel es de
$156.000.

| Cuenta | Diferencia | Qué pasó |
|---|---|---|
| S044 | −$156.000 | Apertura opaca corregida a 0 (duplicaba el pendiente del punto); antes cuadraba con el Excel por casualidad, porque ambos arrastraban el mismo error. |

*(Ver sección 2 — S0339 tiene el mismo texto de recibo "pendiente del punto" pero su
aritmética de sostenimiento no cierra igual, así que no se tocó.)*

### 1.8 Punto de conexión (ya resuelto, no aparece arriba)

Al principio, la mayor fuente de diferencias — más de 30 cuentas — era que CARTERA
mezclaba en una sola columna la plata del sostenimiento (la cuota mensual) con la plata
del punto de agua (lo que se paga una sola vez por la conexión). Eso ya se separó
correctamente en el cálculo y no requiere ninguna decisión: por eso ninguna de esas
cuentas aparece en la lista de arriba.

---

## 2. Decisiones pendientes que alguien tiene que resolver

**Los 4 créditos a favor que nadie usa.** `S0331`, `R028`, `R070` y `R086` tienen plata a
favor desde hace años (quedó a favor de un pago anterior) y, en vez de usarla, la
persona sigue pagando la cuota completa mes a mes. El crédito se cargó tal cual — no se
puso en cero — pero alguien de la junta debería decidir si se les avisa que tienen ese
saldo a favor, o si se deja así.

**Un recibo de $60.000 sin cuenta asignada.** Hay un recibo físico de diciembre de 2022
que el talonario no permite identificar a qué cuenta pertenece (el código está
ilegible o no se anotó). Quedó fuera de la carga hasta que alguien lo identifique
manualmente contra el talonario físico.

**S03321: un punto de agua real que nunca entró a la contabilidad.** Existe la cuenta,
tiene coordenadas de campo reales, pero nunca se le cobró nada — ni la conexión ni el
sostenimiento — porque nunca apareció en la hoja de CARTERA. Alguien de la junta tiene
que decidir desde cuándo empezar a cobrarle, porque el sistema no tiene ninguna fecha de
referencia para inventarla.

**S004: no hay saldo del Excel contra qué comparar.** Es una cuenta suspendida desde
2021 y CARTERA no le dejó un saldo final registrado para 2026. No se pudo verificar si
su deuda calculada es correcta porque no existe la cifra de CARTERA con la cual
compararla.

**S0339: apertura de sostenimiento con una coincidencia sospechosa, pero sin tocar.** Su
apertura de $100.000 coincide textualmente con un recibo que dice "pendiente del punto"
($100.000, ene-2023) — el mismo patrón que resultó ser un error en S044 (sección 1.7).
Pero a diferencia de esa, aquí la aritmética de sostenimiento de CARTERA sí parece cerrar
como deuda real: saldo 2022 ($205.000) + causación ($60.000) − pagos ($65.000: recibos
1313, 1499 y 1603) = $200.000, contra los $100.000 que el Excel escribió — el error del
Excel, si lo hay, parece haber sido escribir el pendiente del punto EN LUGAR DEL saldo de
sostenimiento, no sumado encima. S0339 arrancó en abril de 2022 con historial irregular,
así que $200.000 de deuda real es plausible. No se corrigió — ponerla en 0 podría borrar
deuda real de sostenimiento. Queda marcada para que alguien la revise contra el talonario
físico.

---

## 3. Cartera probablemente incobrable — para que la junta decida

Siete cuentas suspendidas, marcadas en los datos de campo como "NO EXISTE", "NO
ENCONTRADO" o "CASA ABANDONADA" — casi todas sin tipo de predio, sin coordenadas y sin
teléfono de contacto. Acumulan **$3.918.000** entre las siete:

| Cuenta | Deuda acumulada |
|---|---|
| R002 | $755.000 |
| R0501 | $755.000 |
| S009 | $755.000 |
| R0971 | $500.000 |
| S004 | $513.000 |
| S0441 | $425.000 |
| S0141 | $215.000 |
| **Total** | **$3.918.000** |

Una aclaración importante: el sistema les siguió calculando la cuota mensual de 2024 a
julio de 2026 igual que a cualquier cuenta activa, porque así lo trae el archivo de
CARTERA. De los $3.918.000, **$1.085.000 corresponden al período de enero 2024 a julio
2026** ($155.000 por cuenta). Ese es el tramo que la junta puede decidir congelar; el
resto es deuda anterior a 2024.

**Decisión confirmada 2026-08-05 sobre S004:** al corregir la cifra "a pagar" se encontró
que S004 arrastraba $19 de más (un placeholder de $1/mes de la categoría "Sin
clasificar" filtrándose en los meses de 2025 en adelante). Ya corregido -- los $155.000
de S004 en la tabla de arriba son limpios, sin ese residuo. Aparte, se evaluó si había
que registrar en el sistema la suspensión real de S004 desde 2021-06-30 (hoy el sistema
solo sabe que quedó suspendida desde agosto de 2026, por la carga inicial) y **se decidió
explícitamente que no** -- causarle 2024-2026 con normalidad y dejarla en esta lista es
el tratamiento acordado: los $155.000 de ese tramo son justamente la cifra que la junta
necesita ver para decidir si castiga esta cartera. Si la junta decide congelarla, se hace
con acta, no retroactivamente en el código.

**Corrección 2026-08-13: las 7 cuentas de esta sección estuvieron dobladas por un error
temporal.** Un comando suelto corrido el 2026-08-11 contra la base real les agregó, a cada
una, un segundo cargo mensual paralelo -- de modo que en vez de $5.000/mes (la tarifa
vieja, correcta según la decisión de la sección 1.5) se les estaba cobrando $10.000/mes,
el doble. La tabla de arriba ($3.918.000 en total) ya refleja el número correcto, después
de revertir ese error. La categoría de las 7 (Finca, $10.000 vigente) nunca estuvo mal --
lo que estaba mal era el histórico causado, no a quién pertenecen. Corregido y versionado
en `scripts/import-cartera/paso9b-correcciones.js`, corrección 14, para que quede
reproducible y no vuelva a perderse el rastro de qué se cambió y por qué.

---

## 4. Oportunidades detectadas

- **S0244 — cambio de propietario, ya resuelto.** El Excel de CARTERA tenía a "MACHADO
  ZAPATA LUIS HERNANDO" como dueño; el archivo de propietarios actual trae a "ZAPATO
  MACHADO PEDRO NEL" con el mismo teléfono, correo y cédula. El archivo de propietarios
  incluye una columna con el nombre anterior, y coincide exactamente con el de CARTERA:
  confirma que el predio cambió de dueño y CARTERA nunca se actualizó. Se asignó el
  propietario actual (ZAPATO MACHADO PEDRO NEL) como parte de esta carga — no requiere
  ninguna decisión de la junta.

- **Once cuentas aparecen duplicadas en el sistema** (el mismo predio con dos formas de
  escribir el código, por ejemplo `S006-1` y `S0061`). Ya estaban inactivas desde julio,
  antes de esta carga, y toda la información quedó del lado correcto de cada par. NO
  requieren ninguna acción — se mencionan solo para que no sorprendan si alguien las
  encuentra en un listado.

- **R080 — posible predio dividido.** Los datos de campo traen la nota "DOS CASAS
  INDEPENDIENTES" para esta dirección. Podría tratarse de dos viviendas que hoy pagan
  como una sola cuenta y deberían separarse en dos conexiones (dos cuotas, no una).

- **Cuatro cuentas con tarifa vieja, ya corregidas.** `C021`, `R080`, `R091` y `S0244`
  llevaban años pagando $5.000 en vez de los $10.000 vigentes desde 2024. Ya quedaron
  corregidas hacia adelante (ver sección 1.5).

- **32 recibos que sí se cobraron pero nunca se anotaron en la planilla.** Existen en el
  talonario físico, por un total de **$2.978.000**, pero no estaban en ningún archivo
  digital. Ya se cargaron al sistema; antes solo existían en papel.

- **R0831 — la pantalla mostraba $108.000 de saldo a favor y "En mora (7)"; la cifra real
  era $8.000 y al día (corregido 2026-08-14, reemplaza la corrección más chica del
  2026-08-13).** La causa raíz era el recibo 2159 ($100.000, 29-mar-2025, "ABONO A
  DEUDA", sin período declarado): el sistema nunca corre el pago automático (FIFO) sobre
  un recibo sin período — regla que existe para no repetir el caso de S010 (sección 1.4),
  donde un período mal transcrito habría aplicado la plata a los meses equivocados. Pero
  acá el texto "ABONO A DEUDA" sí es una instrucción clara de pagar deuda, así que ese
  100.000 se quedó completo como crédito sin aplicar, y dejó sin pagar el tramo más viejo
  de la cuenta. Los dos recibos posteriores (2311 y 2407) se imputaron en cascada sobre
  esa base equivocada: 2311 ($412.000, "hasta diciembre 2025") terminó pagando de más
  hacia 2026 por el mecanismo de arrastre, dejando al recibo 2407 ($120.000, enero-julio
  2026, con "SALDO A FAVOR 8,000" explícito en el texto) sin nada real contra qué
  aplicarse — de ahí el saldo a favor inflado y el "En mora (7)" que no correspondía.
  Corregido recalculando los tres recibos juntos, en orden cronológico, con el mismo
  fundamento textual documentado ("ABONO A DEUDA" como excepción puntual, no una regla
  general). Resultado verificado contra el talonario: deuda anterior al corte $0, deuda
  exigible $0, al día hasta julio 2026, saldo a favor $8.000 — exactamente lo que el
  recibo 2407 declaraba. Versionado en `paso9b-correcciones.js`, corrección 16.

---

## 5. Si alguien reclama en el mostrador

**Actualizado 2026-08-04: cambió la forma de mostrar la deuda.** Ya no es una sola cifra ni
cuatro partes que se suman entre sí. Ahora hay **una cifra principal y tres avisos aparte**,
ninguno de los cuales se mezcla con los otros:

1. **A pagar** — solo la cuota corriente: cuántos meses debe desde el último que cubrió hasta
   hoy, a la tarifa vigente. Es la única cifra "grande" en pantalla.
2. **⚠ Deuda anterior al corte (2024)** — si tiene algo pendiente de antes, aparte, con su
   propio botón de abono.
3. **⚠ Punto de conexión pendiente** — si debe algo de la instalación del servicio, aparte.
4. **⚠ Saldo a favor disponible** — si pagó de más alguna vez y esa plata no se aplicó a
   ningún mes todavía, aparece aquí. **Ya no baja el "A pagar" por su cuenta**: hay que
   decidir explícitamente aplicarlo (botón "Usar").

Si alguien dice que el número no coincide con lo que recuerda del Excel viejo de
CARTERA, explicar:

> "Antes todo se mezclaba en una sola cifra: la cuota mensual, lo del punto de agua y
> cualquier plata que hubiera pagado de más quedaban sumados o restados sin que quedara
> claro de dónde salía el número. Ahora se separan: la cifra grande es solo lo que debe
> por la cuota de estos meses. Si tiene algo a favor, se lo mostramos aparte y se lo
> aplicamos cuando usted lo pida, no antes. Además, si pagó algo que declaraba a qué
> meses correspondía, ahora ese pago se aplica exactamente a esos meses — antes se
> contaba simplemente en el año en que llegaba la plata, sin mirar el detalle. Por eso el
> número puede verse distinto, aunque la plata sea la misma."

Si insiste en que hizo un pago que no aparece, pedirle el recibo físico (número y fecha)
y anotarlo para que se verifique contra el talonario — hay casos reales tanto de pagos
que quedaron anotados bajo el código de otro predio (sección 1.1) como de pagos que el
Excel de CARTERA nunca alcanzó a registrar (sección 1.2).

**Nota interna, no para el mostrador:** que una cuenta muestre "saldo a favor disponible"
no significa que haya que aplicarlo. El caso de Azucena (S0312, sección 1.1) tenía un
crédito de $210.000 que resultó ser producto de un pago mal anotado, no un sobrepago real
-- aplicarlo automáticamente habría marcado meses futuros como pagados sin que fuera
cierto. Por eso la aplicación siempre es una decisión explícita de quien atiende, nunca
algo que el sistema hace solo.
