# Cartera como cuenta corriente — Design

Fecha: 2026-07-29

## 1. El problema

El sistema modela la deuda de un asociado en **meses**; la asociación la opera en **dinero**. Esa discordancia produce hoy cifras equivocadas en ambos sentidos, y no hay dónde registrar la plata que entra como "abono a la deuda".

### Cómo calcula la deuda el sistema hoy

En `PagoService.getEstadoCuenta` ([src/services/PagoService.js:82-103](../../../src/services/PagoService.js)) toda la deuda sale de una fórmula:

```
mora    = mes_actual − (último_mes_pagado + 1) + 1
deuda_$ = mora × tarifa_vigente_hoy
```

Consecuencias verificadas en el código:

1. **Solo mira el último mes pagado** (`MAX(anio*12+mes)`). Cualquier mes sin pagar que tenga *después* un mes pagado desaparece de la deuda.
2. **No hay causación.** El ingreso se reconoce solo al pagar (413505 contra Caja/Banco). La cartera contable no existe: es un estimado que se recalcula al vuelo en `ReporteRepository.getCuentasPorCobrarEstimado`.
3. **No existe "abono a deuda general".** La tabla `cuenta_creditos` está creada, pero ningún código inserta un `Abono` — solo `Aplicado` ([PagoService.js:260](../../../src/services/PagoService.js)). El saldo a favor nunca puede ser positivo. La tabla está **vacía**.
4. **No se pueden pagar meses no contiguos.** `construirPeriodos` avanza mes a mes desde un inicio y lanza error si topa uno ya pagado. Un recibo = un bloque corrido.
5. La única deuda con modelo "saldo + abonos" es la conexión (`nuevos_puntos`), también vacía.

### Evidencia en los datos de producción

Base auditada: `data/acueducto.db` — 304 cuentas (293 activas), 14.986 filas en `pago_periodos`, 2.429 recibos. Todos los recibos provienen de la importación histórica; **no se ha registrado ni un pago por la aplicación** (último recibo 2026-06-13, la fecha del cargue).

| Hallazgo | Cifra |
|---|---|
| Meses sin pagar intercalados (invisibles al cálculo actual) | 3.426 en 154 cuentas |
| Meses de mora "de cola" (los únicos que el sistema ve) | 3.830 |
| Cuentas que el sistema muestra "Al día, $0" teniendo huecos | 38 (704 meses) |
| Detalles de recibo con concepto "ABONO A LA DEUDA" | **160, por $14.238.500** |
| …de esos, **sin ningún mes asignado** | **133** |
| Cuentas activas en categoría `Sin clasificar` con tarifa **$1** | **293 de 293** |

Casos que ilustran el error en ambas direcciones:

| Cuenta | Deuda real (Excel) | Lo que diría el sistema | Error |
|---|---|---|---|
| R034 RUIZ ESCOBAR ANSELMO | $370.000 | 103 meses ≈ $1.030.000 | cobra 2,8× de más |
| R037 ALVAREZ CLARA ISABEL | $420.000 | ~"al día", $0 | no cobra nada |
| R019 VANEGAS HERRERA JOHANNA | $110.000 | 6 meses ≈ $60.000 | cobra de menos |

R034 abonó $350.000 en 6 recibos, ninguno con meses asignados: el sistema le cobra 103 meses ignorando esa plata. R037 abonó $390.000 y tiene **cero** meses registrados.

### Por qué los meses no pueden sostener el modelo

Test contra los datos reales (mensualidad tomada del Excel de cartera):

- **Recibos que NO son múltiplo exacto de la mensualidad: 386 de 2.371 (16,3%).**
- **Saldos al 31/12/2025 que NO son múltiplo exacto: 61 de 200 (30,5%).**

Ejemplos: C019 debe $5.000 = **0,50 meses**; R030 debe $9.000 = 0,56 meses; R033 debe $15.000 = 0,94 meses. `pago_periodos` tiene `UNIQUE(cuenta_id, anio, mes)` y **no existe el concepto de mes parcial**: un saldo de medio mes es inexpresable. El 30% de la cartera quedaría mal.

**Decisión: la deuda pasa a vivir en dinero.**

## 2. Las fuentes y qué manda en cada campo

Regla del importador, no criterio del momento:

| Fuente | Autoridad sobre | NO es autoridad sobre |
|---|---|---|
| `C:\Users\Brayhan\Documents\ACUEDUCTO\Datos.xlsx` (Hoja1, **filas 2-300**) | propietario, cédula, teléfono, correo, coordenadas, `NOMBRE FINCA`, propietario `ANTIGUO`, `OBSERVACION`, y el **`TIPO` como estado deseado** de la propiedad | la plata, y **la categoría con que se carga la cartera** |
| `C:\Users\Brayhan\Documents\ACUEDUCTO\CARTERA CON SALDO A 2025.xlsx` | **la mensualidad, y por lo tanto la categoría con que se causa**; apertura al 31/12/2021 (hoja `estado cta con movimiento`); saldos de verificación | propietarios (**desactualizados**) |
| `data/acueducto.db` (`recibos`) | el recibo: número, fecha, monto, soporte — de aquí salen todos los abonos | el saldo |

`DatosHistoricos.xlsx` queda descartado como fuente: `CARTERA CON SALDO A 2025.xlsx` es la versión vigente del mismo trabajo (45 columnas contra 42) y trae además las hojas de respaldo que resuelven la apertura.

Las coordenadas en `Datos.xlsx` están guardadas como **texto** (`"4.370519"`), no como número. El importador de datos maestros debe convertirlas.

**Filas 302 en adelante de `Datos.xlsx` se excluyen**: son puntos sin código ("EXISTE PERO NO CODIGO", "SEGUNDA CASA", "VENTA LOTE") que se resuelven aparte.

### Conciliación Excel ↔ base: el Excel es confiable

Comparando `PAGOS EN 20XX` contra la suma de recibos por cuenta y año:

| Año | Comparables | Cuadran al peso | Total Excel | Total Base | Desviación |
|---|---|---|---|---|---|
| 2022 | 222 | 214 | $39.862.500 | $39.478.500 | 0,96% |
| 2023 | 194 | 189 | $21.335.000 | $21.254.000 | 0,38% |
| 2024 | 197 | 195 | $33.138.000 | $33.155.000 | 0,05% |
| 2025 | 281 | 279 | $38.119.000 | $37.657.000 | 1,21% |
| 2026 | 135 | 133 | $17.780.000 | $17.878.000 | 0,55% |

**991 de 1.010 comparaciones exactas al peso (98,1%).** El Excel y el libro de recibos son la misma realidad; se unen, no se elige entre ellos.

### La frontera: 31/12/2021

El Excel tiene columna `SALDO PAGOS 31/12/2021` y ahí arranca `CAUSACION 2022`. Los abonos "a la deuda" pican en 2022 (27% de los recibos de ese año, contra 3-6% en el resto), que es cuando se empezó a cobrar la cartera vieja en serio. Arriba de esa línea todo concilia; abajo está la semilla opaca.

### La semilla opaca no se puede descomponer

`SALDO A 31 12 2020` (247 cuentas, $31.290.000) **no es el saldo a 31/12/2020**. Comparado con `SALDO REAL A 31 12 2019` (hoja `SALDO INICIALES`, 233 cuentas, 100% legible, total $28.372.000), solo **87 de 201** cumplen `saldo2020 = saldo2019 + mensualidad×12`. En la mayoría el valor de 2020 es una **copia literal del de 2019** (nunca se causó ese año) y en otras hay ajustes manuales (C013: $111.000 → −$5.000; C022: $120.000 → $0).

Conclusión: es un bloque sin composición auditable. Se carga como **un solo movimiento opaco** y no se intenta reconstruir.

## 3. Decisiones tomadas

1. **El saldo opaco es visible pero NO exigible, y abarca todo lo anterior al 01/01/2022** (~$39 millones: $31,3M del saldo ≤2020 + ~$7,7M del movimiento 2021). Se muestra en el estado de cuenta, nunca se suma al cobro automático ni a la cartera contable, y solo baja si la persona decide abonarle. La junta puede castigarlo después por acta sin tocar código. Detalle y razón en §11.6.
2. **La deuda se modela como cuenta corriente en dinero** (cargos − abonos), no en meses.
3. **`Datos.xlsx` manda en datos maestros** (propietario, contacto, coordenadas). **La categoría con que se causa sale de la mensualidad que el Excel de cartera ya cobra**: la carga inicial reproduce lo que la asociación viene cobrando, y las correcciones de tipo las hace el usuario manualmente después, con fecha (§11.1).
4. **La facturación empieza en el mes del primer recibo** de cada cuenta, y ese ancla es editable (§6.2).
5. **La causación se detiene** en cuentas suspendidas o inexistentes, **con fecha de vigencia**: el estado de la cuenta pasa a tener historia (§6.1).
6. **Todo cambio de categoría o de ancla se puede aplicar con fecha retroactiva** y recalcula los cargos ya emitidos por diferencia, sin mutarlos ni borrarlos (§4.1). La tarifa es fija, pero depende de la categoría del punto — y la categoría tiene fecha.
7. **La causación no genera asientos contables** (§7). Es lo que permite corregir el pasado sin reexpresar períodos cerrados.

## 4. Modelo de datos

### Migración `036_cartera_movimientos.sql`

Crea `cartera_movimientos`, `cartera_imputaciones` y `cuenta_estados` (§6.1). La última migración existente es `035_admin_recuperacion.sql`.

```sql
CREATE TABLE cartera_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  fecha DATE NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN (
    'CargoMensual',          -- causación del aporte de un mes
    'AjusteCategoria',       -- corrección de un CargoMensual ya emitido (±), por recategorización
    'AperturaOpaca',         -- saldo ≤31/12/2021 sin sustento auditable
    'Abono',                 -- plata recibida (monto negativo)
    'AjusteAsamblea',        -- corrección o condonación documentada
    'CastigoCartera'         -- baja del saldo opaco por acta
  )),
  exigible INTEGER NOT NULL DEFAULT 1 CHECK(exigible IN (0,1)),
  monto REAL NOT NULL,             -- (+) cargo, (−) abono
  anio INTEGER, mes INTEGER,       -- solo CargoMensual: a qué mes corresponde
  recibo_detalle_id INTEGER,       -- soporte del abono
  documento TEXT,                  -- acta o referencia del ajuste
  observaciones TEXT,
  usuario_id INTEGER,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
  FOREIGN KEY (recibo_detalle_id) REFERENCES recibo_detalles(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- Impide causar dos veces el mismo mes. Misma disciplina que el UNIQUE de pago_periodos.
CREATE UNIQUE INDEX idx_cartera_cargo_unico
  ON cartera_movimientos(cuenta_id, anio, mes) WHERE tipo = 'CargoMensual';

CREATE INDEX idx_cartera_cuenta ON cartera_movimientos(cuenta_id, fecha);
CREATE INDEX idx_cartera_exigible ON cartera_movimientos(cuenta_id, exigible);

-- Qué cargo cubrió cada abono, y por cuánto. Se guarda SIEMPRE, en los cuatro modos de
-- imputación: FIFO no es un cálculo al vuelo sino la estrategia por defecto que genera
-- estas filas. Así la cobertura queda auditable ("este abono de $50.000 cubrió Ene-2022
-- $10.000, Feb-2022 $10.000, ...") y es estable: un abono posterior no puede cambiar
-- retroactivamente lo que cubrió uno anterior.
CREATE TABLE cartera_imputaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  abono_id INTEGER NOT NULL,
  cargo_id INTEGER NOT NULL,
  monto REAL NOT NULL CHECK(monto > 0),
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (abono_id) REFERENCES cartera_movimientos(id),
  FOREIGN KEY (cargo_id) REFERENCES cartera_movimientos(id),
  UNIQUE(abono_id, cargo_id)
);

CREATE INDEX idx_cartera_imput_abono ON cartera_imputaciones(abono_id);
CREATE INDEX idx_cartera_imput_cargo ON cartera_imputaciones(cargo_id);
```

Invariantes que los tests deben proteger:

- `Σ cartera_imputaciones.monto` de un abono ≤ `|monto|` de ese abono. La diferencia es saldo a favor.
- `Σ cartera_imputaciones.monto` sobre un cargo ≤ `monto` de ese cargo. Un cargo nunca queda sobrecubierto.
- Un abono con `exigible = 1` no puede imputarse a un cargo con `exigible = 0`, ni al revés.

### Los dos saldos, derivados

```
deuda_exigible = Σ monto WHERE exigible = 1    → si es negativo, es saldo a favor
saldo_opaco    = Σ monto WHERE exigible = 0    → informativo, nunca se cobra
```

Un solo mecanismo cubre: abono sin meses, pago parcial, saldo a favor, deuda opaca y ajuste por acta.

**El saldo sale de los movimientos, nunca de las imputaciones.** `cartera_imputaciones` solo explica *qué cubrió qué*; si estuviera vacía, los saldos seguirían siendo correctos. Esta separación es la que permite corregir el pasado sin reescribir historia (§4.1).

### 4.1 Corregir el pasado: recategorización retroactiva

Requisito del negocio: **la tarifa es fija, pero depende de la categoría del punto**, y la categoría puede haber cambiado en una fecha pasada que solo se descubre después. Si a alguien se le detecta piscina hoy pero la tenía desde noviembre de 2025, la deuda de nov-2025 en adelante tiene que poder recalcularse. Un modelo que solo aplica cambios "desde hoy" es inaceptable.

El modelo ya soporta la parte de datos: `cuenta_categorias` versiona la categoría con `fecha_inicio`/`fecha_fin` y `categoria_tarifas` versiona la tarifa. Falta la operación que propaga el cambio a los cargos ya emitidos.

**Regla: nunca se muta un `CargoMensual` emitido. Se emite un `AjusteCategoria` por la diferencia.**

```
Cuenta S0251, recategorizada a "Finca con piscina" con vigencia 2025-11-01:

  fecha       tipo              anio/mes   monto     observaciones
  2025-11-01  CargoMensual      2025/11    10.000    (emitido en la causación original)
  2026-07-29  AjusteCategoria   2025/11     6.000    recategorización a piscina, acta N
  2025-12-01  CargoMensual      2025/12    10.000
  2026-07-29  AjusteCategoria   2025/12     6.000    recategorización a piscina, acta N
  ...
```

El cargo del mes pasa a ser la **suma** de las filas de ese mes. El índice único solo cubre `tipo='CargoMensual'`, así que los ajustes conviven sin chocar.

Por qué así y no editando el monto:

- **No se reescribe historia.** Queda el rastro de qué se cobró, cuánto se corrigió, cuándo, por quién y con qué documento.
- **Ninguna imputación se deshace.** Si el cargo sube, el ajuste es un ítem pendiente más que el FIFO ve normalmente. Si baja, el ajuste es negativo, reduce el saldo directo, y si el mes ya estaba pagado eso se convierte en saldo a favor por la propia fórmula del saldo — sin tocar `cartera_imputaciones`. Esto funciona porque el saldo sale de los movimientos, no de las imputaciones.
- **Sirve en las dos direcciones**, que es lo que hace falta para las ~44 cuentas donde el tipo relevado contradice la tarifa cobrada (hay subcobro y sobrecobro).

`CarteraService.recategorizar(cuentaId, categoriaId, fechaVigencia, documento, usuarioId)`:

1. Cierra la vigencia anterior en `cuenta_categorias` y abre la nueva en `fechaVigencia`.
2. Recorre los meses desde `fechaVigencia` hasta hoy, recalcula la tarifa correcta de cada uno y emite un `AjusteCategoria` por la diferencia (omite los meses donde la diferencia sea cero).
3. Todo en una transacción, con registro en `auditoria`.

Los ajustes **no generan asientos contables** (§7), así que corregir meses de un período contable cerrado no lo reexpresa.

La misma mecánica sirve para corregir la `fecha_inicio_facturacion`: si se descubre que una cuenta empezó antes o después de lo que se asumió, se recausan o se anulan los meses del borde con `AjusteCategoria`.

### `cuenta_creditos` se absorbe

Está vacía y su función (saldo a favor) queda cubierta por un `deuda_exigible` negativo. Mantener dos mecanismos para lo mismo es una fuente de divergencia. La tabla se deja en el esquema sin uso; `PagoService` deja de leerla y el parámetro `usarSaldoAFavor` se reemplaza por la nueva imputación.

### `pago_periodos` se conserva como archivo histórico

Sus 14.986 filas no se tocan ni se borran: son el registro de qué dijo cada recibo. **Deja de ser la fuente de la deuda.**

El "está al día hasta X" pasa a **leerse de `cartera_imputaciones`**: es el último mes cuyo cargo quedó cubierto por completo, sin cargos descubiertos antes. Hoy el bug es que hay dos verdades (`MAX(mes)` de `pago_periodos` y la plata) y no coinciden; a partir de aquí hay una sola, y con el detalle de qué abono cubrió qué.

## 5. Cómo entra la plata: cuatro imputaciones

`PagoService.registrarPago` recibe un `modo`:

| Modo | Qué hace | Resto |
|---|---|---|
| `MesesEspecificos` | El operador elige los meses (ya **no** exige contigüidad ni falla por huecos). Abono + cobertura de esos cargos. | a saldo a favor |
| `AbonoDeudaFIFO` | Aplica al cargo exigible más antiguo sin cubrir y avanza. | a saldo a favor |
| `AbonoSaldoOpaco` | Reduce el bucket no exigible. Requiere confirmación explícita: no es cobrable. | no aplica |
| `Anticipo` | Queda como saldo a favor sin imputar. | — |

Todas generan **un solo `Abono`** en `cartera_movimientos` ligado al `recibo_detalle_id`, más sus filas en `cartera_imputaciones`. La única diferencia entre los modos es **qué cargos elige cubrir**: los que marcó el operador, los más antiguos exigibles, o el bucket opaco. La mecánica de registro es idéntica en los cuatro.

Esto es lo que hace representable el caso real que hoy no cabe: el recibo *"CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2023"* cubre los 12 cargos de 2023 y deja los de 2022 descubiertos, sin que un recálculo posterior los reordene.

Reglas de validación:
- Un abono no puede exceder `deuda_exigible + saldo_opaco` salvo en modo `Anticipo`.
- `AbonoSaldoOpaco` no puede exceder `saldo_opaco`.
- La fecha debe caer en período contable Abierto (`PeriodoContableService.validarFechaPermitida`, ya existente).

## 6. Causación: cuándo se genera el cargo, y cuándo NO

`CarteraService.asegurarCausacion(cuentaId, hastaAnio, hastaMes)` inserta los `CargoMensual` faltantes. Es **idempotente** por el índice único parcial. Se invoca al abrir el estado de cuenta y desde una acción manual del módulo de Contabilidad.

Valor del cargo: la tarifa vigente de la categoría de la cuenta **para ese mes**, vía `cuenta_categorias` + `categoria_tarifas` (histórico versionado que ya existe y hay que poblar — ver Fase 0).

**No se causa cuando:**

- La cuenta estaba `Suspendida` o `Inactiva` **en ese mes** (ver §6.1: el estado se vuelve histórico).
- El mes es anterior a la `fecha_inicio_facturacion` de la cuenta = **mes del primer recibo** (ver §6.2).
- El período contable de ese mes está Cerrado — **en operación normal**. Ver la excepción abajo.

### La carga inicial es la excepción, y es explícita

La Fase 0 causa desde enero 2022, y esos períodos contables están cerrados. La regla de "no causar en período cerrado" protege la operación diaria de escrituras hacia atrás; no puede bloquear la carga inicial, que es precisamente una reconstrucción del pasado.

Se resuelve con dos entradas distintas, no con una bandera que el operador pueda activar:

- `asegurarCausacion(...)` — la vía operativa. Respeta el bloqueo de períodos siempre, sin excepción ni parámetro para saltarlo.
- El script de migración de Fase 0 — escribe directamente por el repositorio, una sola vez, fuera del servicio. Deja constancia en `observaciones` de cada movimiento (`'Carga inicial cartera 2026-07'`) para que sea distinguible después.

Como la causación **no genera asientos contables** (§7), reconstruir 2022-2026 no toca ningún período contable ni reexpresa nada: solo escribe en `cartera_movimientos`.

Los datos exigen esta regla: 12 cuentas están congeladas en mensualidad $5.000 porque, según `OBSERVACION` de `Datos.xlsx`, **el punto no existe** — R002, R0211, S009, S0141, S025, S0395 ("SUSPENDIDO (NO EXISTE)"), R0971 ("NO ENCONTRADO"), S0441 ("PAGO 2018 PERO NO ENCONTRADO"), R0501 ("SUSPENDER"), R044 ("REVISAR / SUSPENDIDO"), S004 ("CASA ABANDONADA"). Causarles $10.000/mes fabrica cartera falsa a perpetuidad.

### 6.1 El estado de la cuenta se vuelve histórico — `cuenta_estados`

Hoy `cuentas.estado` es una sola columna sin historia: se puede poner `Suspendido`, pero no *desde cuándo*. Eso no sirve, porque el caso real es "el último pago fue en 2022 y desde entonces nadie sabe nada del punto": hay que poder suspender **con efecto retroactivo a 2022** para que no se genere deuda de esos años, y poder reactivar después si el punto reaparece.

Se sigue la convención que ya usa el proyecto para todo lo que cambia en el tiempo (`cuenta_categorias`, `cuenta_propietarios`: *"NUNCA sobrescribir"*):

```sql
CREATE TABLE cuenta_estados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK(estado IN ('Activo', 'Inactivo', 'Suspendido')),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  motivo TEXT,
  usuario_id INTEGER,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE INDEX idx_cuenta_estados_cuenta ON cuenta_estados(cuenta_id, fecha_inicio);
CREATE INDEX idx_cuenta_estados_actual ON cuenta_estados(cuenta_id, fecha_fin);
```

`cuentas.estado` se conserva como el estado **vigente** (lo que ya leen el listado, los filtros y los reportes, sin cambios), y pasa a ser un espejo de la fila abierta de `cuenta_estados`. La causación consulta el histórico, no la columna.

`CarteraService.suspender(cuentaId, fechaDesde, motivo)`:
1. Cierra la vigencia `Activo` anterior en `fechaDesde - 1 día` y abre `Suspendido` desde `fechaDesde`.
2. Emite `AjusteCategoria` negativos que anulan los `CargoMensual` ya causados desde `fechaDesde`. No se borran: se anulan con contrapartida, igual que en §4.1.
3. Sincroniza `cuentas.estado`.

`CarteraService.reactivar(cuentaId, fechaDesde, motivo)` cierra la suspensión y reanuda la causación desde `fechaDesde`. **Los meses en que estuvo suspendida no se causan retroactivamente**: la suspensión significa que en ese lapso no había servicio que cobrar. Si en algún caso se decidiera lo contrario, es un `AjusteAsamblea` explícito y documentado, no un efecto automático.

Los 12 puntos inexistentes se cargan en Fase 0 como `Suspendido` con `fecha_inicio` = el mes siguiente a su último recibo, para que no arrastren deuda de años en que nadie los vio.

**Los 4 puntos "ACTIVA, PERO NO SE ENCUENTRA"** (S0222, S0272, S0273, S0373) quedan **`Activo`** por ahora: son recientes y todavía se les puede encontrar. Si más adelante se decide que no se sabe nada de ellos, se los suspende con la fecha que corresponda y los cargos de ese lapso se anulan solos. Con `cuenta_estados` esa decisión ya no es urgente ni irreversible — que es exactamente lo que hacía falta.

### 6.2 El ancla de facturación: el primer recibo

`fecha_inicio_facturacion` = **mes del primer recibo de la cuenta** (`MIN(recibos.fecha_recibo)`), no el primer mes en `pago_periodos`. La distinción importa: 29 cuentas activas tienen **cero** meses asignados pero **todas** tienen recibos, por $8.900.000 en total. Con este ancla las 293 cuentas quedan cubiertas y no hace falta inventar una fecha para nadie.

Es además la regla que la asociación ya aplica, y está escrita en el propio Excel — la observación de R0972 dice: *"Pagó el punto el 13 de Junio 2026, empieza a pagar Julio"*.

El ancla es **editable por cuenta**, porque hay casos donde el Excel la declara explícitamente (R069: *"DESDE ENERO 2026"*) y porque la información se aclara con el tiempo. Corregirla dispara la misma recausación por diferencia de §4.1: se emiten o se anulan los cargos del borde, sin borrar nada.

Los 429 `periodosOmitidosPorColision` del log de importación y los casos como S0401 (recibo 909: *"CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2021"*, $60.000, con **cero** meses registrados) y C024 (recibo 332: *"...JUNIO A DICIEMBRE 2018"*) muestran que el texto del concepto **nombra los meses** y el importador no los guardó. Son recuperables parseando el concepto — tarea de Fase 0.

## 7. Contabilidad: la cartera es operativa, no reexpresa el pasado

La causación **no** genera asientos. La contabilidad sigue reconociendo el ingreso al recaudar (413505 contra Caja/Banco), exactamente como hoy.

Razones:
- Causar 2022-2026 retroactivamente **reexpresaría estados de resultados de años ya cerrados**, y `periodos_contables` tiene períodos bloqueados a propósito.
- El saldo opaco es explícitamente **no exigible**: no cumple para ser un activo en el balance.

Los reportes de cartera dejan de usar `getCuentasPorCobrarEstimado` (meses × tarifa de hoy) y pasan a leer `deuda_exigible`, que es un dato real. `saldo_opaco` se reporta en columna aparte, nunca sumado.

Queda como decisión futura, fuera de este alcance: si en algún cierre se quiere llevar la cartera exigible al balance, se hace con un asiento de apertura por el neto, no reexpresando años.

## 8. Estado de cuenta: qué ve el operador

```
R034 — RUIZ ESCOBAR ANSELMO

Deuda corriente (desde 01/2022) .......... $190.000
    causado 2022-2026 .................... $540.000
    abonos aplicados ..................... $350.000
    cubierto hasta ....................... Marzo 2024

Saldo histórico sin sustento (≤2021) ..... $180.000   [informativo, no exigible]
                                           ---------
TOTAL A COBRAR HOY ....................... $190.000
Total de referencia (con histórico) ...... $370.000
```

El bloque opaco se muestra siempre, en tipografía y color distintos, con la leyenda de que no es exigible. Nunca entra en el total a cobrar.

## 9. Componentes

| Unidad | Responsabilidad | Depende de |
|---|---|---|
| `CarteraRepository` | CRUD de `cartera_movimientos`, saldos agregados por cuenta | `DatabaseService` |
| `CarteraService` | `asegurarCausacion`, `getEstadoCartera`, `registrarAbono`, `registrarAjuste`, `castigarOpaco`, `recategorizar`, `suspender`, `reactivar` | `CarteraRepository`, `PeriodoContableService`, `CategoriaRepository`, `CuentaEstadoRepository` |
| `CuentaEstadoRepository` | vigencias de `cuenta_estados`, estado de una cuenta en un mes dado, sincronía con `cuentas.estado` | `DatabaseService` |
| `imputacion.js` (módulo puro) | Dados los cargos pendientes y un monto → qué filas de `cartera_imputaciones` generar y cuánto sobra. Una estrategia por modo. Sin I/O. | nada (función pura, testeable sola) |
| `PagoService` | Orquesta recibo + movimiento de caja + abono de cartera | `CarteraService` |
| `scripts/import-cartera/` | Fase 0: leer los tres Excel, validar, previsualizar, aplicar | `exceljs`, `DatabaseService` |

`imputacion.js` se aísla a propósito: es donde está la lógica delicada y donde los tests dan más valor.

El importador sigue el patrón que ya existe y funciona en [scripts/import-gastos/](../../../scripts/import-gastos/): módulos separados para leer, normalizar, previsualizar y aplicar, cada uno con su test.

## 10. Fase 0 — prerrequisitos, sin esto no se causa nada

Bloqueante: las 293 cuentas activas están en categoría `Sin clasificar` con tarifa **$1**, y `categoria_tarifas` tiene filas inválidas (`Finca` repetida 3 veces con `vigencia_desde 2026-01-01` y `vigencia_hasta 2025-12-31`, invertidas).

1. **Obtener la apertura al 31/12/2021** siguiendo esta cascada, en orden. No requiere que nadie recalcule nada en Excel.

   La columna `SALDO PAGOS 31/12/2021` de `ESTADO DE CUENTA ASOCIADOS` no es un dato: es un `VLOOKUP` contra la hoja **`estado cta con movimiento`** del mismo archivo, y muchas celdas no tienen el resultado guardado. La hoja fuente sí tiene números planos (218 cuentas, cero fórmulas) y **pasa su propia prueba de integridad 218/218** (`Saldo Mes Ant. + Débito − Crédito = Saldo Mes`).

   | Orden | Fuente | Cuentas |
   |---|---|---|
   | 1 | Hoja `estado cta con movimiento`, columna `Saldo Mes`, buscando por código en la columna A. **Es la fuente autoritativa**: resuelve el `VLOOKUP` que el archivo no alcanzó a guardar. | 231 |
   | 2 | `SALDO A 31 12 2020` (número plano, sin fórmula) donde la cuenta no esté en la hoja fuente | 26 |
   | 3 | **$0**, cuando el primer recibo de la cuenta es de 2022 o posterior: nació después de la frontera y no tiene deuda vieja | 38 |
   | 4 | Reconciliación manual: C021, R0081, S03321 no existen como cuenta en la base (ver paso 11) | 3 |

   **Cobertura: 298 de 298.** Total apertura opaca: **$39.092.500**.

   En 9 cuentas (C013, R019, R026, R028, R033, R042, R075, S017, S053) el valor guardado en la celda contradice el `VLOOKUP` resuelto — se calcularon contra versiones anteriores de la hoja fuente, y de hecho el rango de la fórmula varía entre filas (`$H$217` vs `$H$222`). **Gana la hoja fuente** (paso 1), y las 9 se reportan para revisión. La diferencia no afecta ningún cobro: este bloque no es exigible, así que su valor es informativo.
2. **Limpiar `categoria_tarifas`** y cargar el histórico de tarifas:

   | Categoría existente | 2022-2023 | 2024-2026 |
   |---|---|---|
   | Finca | $5.000 | $10.000 |
   | Finca con piscina | $8.000 | $16.000 |
   | Tienda (comercial) | $12.000 | $20.000 |
   | Finca para alquiler | $20.000 | $50.000 |

   Hay que borrar antes las filas inválidas de `Finca` (repetida 3 veces con `vigencia_desde 2026-01-01` y `vigencia_hasta 2025-12-31`, invertidas).

3. **Asignar categoría a cada cuenta según la MENSUALIDAD que el Excel de cartera ya le cobra** — no según el `TIPO` de `Datos.xlsx` (§11.1). El mapeo es la tabla de arriba leída al revés: $5.000/$10.000 → Finca, $8.000/$16.000 → Finca con piscina, $12.000/$20.000 → Tienda, $20.000/$50.000 → Finca para alquiler.

   Dos vigencias por cuenta, porque la tarifa cambió: la categoría según `MENSUALIDAD` desde el inicio, y según `MENSUALIDAD 2024` desde 2024-01-01 si difiere. Las 5 cuentas congeladas en $5.000/$5.000 mantienen Finca en las dos.

   Se respetan las fechas que el Excel declara explícitamente: S0251 (*"PISCINA A PARTIR DE ENERO 2026"*) y R069 (*"DESDE ENERO 2026"*) entran como cambio de categoría con vigencia, que `cuenta_categorias` ya sabe versionar.

   El `TIPO` de `Datos.xlsx` **sí se carga**, pero como dato de la cuenta para que el usuario vea la discrepancia y decida; no toca la categoría ni la tarifa. La Fase 0 entrega el reporte de las ~44 diferencias.
4. **Fijar `fecha_inicio_facturacion`** = mes del primer recibo (§6.2), aplicando los overrides que el Excel declara (R069 "DESDE ENERO 2026", R0972 "empieza a pagar Julio").
5. **Recuperar los meses que el importador perdió**, parseando el concepto de los recibos que los nombran en texto ("CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2021"): S0401, C024 y los 429 `periodosOmitidosPorColision` del log de importación. Cada recuperación se reporta para revisión, no se aplica a ciegas.
6. **Cargar `cuenta_estados`** con la vigencia `Activo` inicial de las 293 cuentas, y suspender con `fecha_inicio` = mes siguiente a su último recibo (§6.1): los 12 puntos inexistentes, **R085** (*"no encontrado"*) y **C021** (creada en el paso 11, *"no encontrado"*). Todas reactivables si aparecen.
7. **Cargar `AperturaOpaca`** por cuenta desde `SALDO PAGOS 31/12/2021` (o `SALDO A 31 12 2020` donde el otro sea ilegible), con `exigible = 0`.
8. **Causar 2022-01 a hoy** y cargar los abonos desde los recibos ya existentes en la base.
9. **Reportar** las ~44 cuentas donde el `TIPO` de `Datos.xlsx` contradice la categoría cargada, **sin aplicar ningún cambio** (§11.1). El usuario las corrige a mano, una por una, con la fecha de vigencia real de cada caso.
10. **Conciliar el resultado contra `SALDO A 31/12/2025` del Excel** y reportar toda cuenta que difiera. Este paso es el criterio de aceptación de la migración, no un extra.
11. **Resolver los códigos huérfanos.** El objetivo es que toda cuenta que exista en los Excel exista en la base, para que ninguna quede fuera del sistema. Pero **no todos los huérfanos son cuentas faltantes**: se verificó uno por uno y hay duplicados.

    | Código | Diagnóstico | Acción |
    |---|---|---|
    | **C021** "CASTRO DIEGO" | Falta de verdad. En los dos Excel, congelada en $5.000/$5.000, sin cédula ni teléfono, saldo 31/12/2025 = $0. | **Crear** como `Suspendido`, motivo *"no encontrado"*, categoría Finca. |
    | **R0081** "ARIAS MORENO MARTHA LUCIA" | **Es la misma cuenta que `S058`.** Mismo teléfono (`3227600287`) en las filas 44 y 299 de `Datos.xlsx`; el pago de $500.000 del 2026-01-31 ("PAGO DE PUNTO NUEVO", recibo 2400) ya está registrado bajo `S058`, y coincide con `PAGOS 2026` de R0081 en el Excel. | **NO crear.** Se mapea `R0081 → S058` en la tabla de equivalencias del importador. Crearla duplicaría la cuenta y contaría dos veces los $500.000. |
    | **S03321** "MARIN HERRERA ORFILIA" | En el Excel de cartera su nombre es *"OFILIA REVISAR S022"*; en la base, el propietario de `S022` es *"MACHADO MENDOZA CARMENZA Y/O OFILIA MARIN HERRERA"* — las dos personas quedaron en un solo nombre. Pero `Datos.xlsx` le da fila y teléfono propios (`3102227718`). **Decidido 2026-07-30**: es un punto aparte, no la co-propietaria de S022. | **Crear** como `Activo` (tiene teléfono propio, nada indica que no exista), categoría según su mensualidad. |
    | Los otros 11 (R002, R0211, R044, R0501, R080, R085, R091, R0971, S009, S0244, S025) | Sí existen en la base bajo el mismo código normalizado. | Ninguna: el desajuste era de formato (guiones y ceros), ya resuelto por la normalización. |
    | 8 códigos en la base y en ningún Excel | Incluye el código malformado `"S0332 - S0382"` (un rango metido en un solo campo). | Revisión manual, reportada por el importador. |

    Regla general del importador: **antes de crear una cuenta huérfana, buscar duplicado por nombre y teléfono**. R0081/S058 se habría detectado sola con esa regla.

## 11. Decisiones cerradas sobre los casos límite

1. **Las ~44 cuentas donde el `TIPO` relevado contradice la mensualidad cobrada.** La carga inicial **respeta la mensualidad que el Excel de cartera ya cobra**, no el `TIPO` de `Datos.xlsx`. Es decir: la migración reproduce el estado actual tal como está, sin corregir nada por su cuenta.

   La corrección la hace el usuario **manualmente, cuenta por cuenta**, con `CarteraService.recategorizar` y la fecha de vigencia que corresponda en cada caso (§4.1). Esa es justamente la razón por la que la operación existe.

   Por qué así y no automático: el `TIPO` dice *qué es hoy*, no *desde cuándo*. Aplicarlo automáticamente en la carga inventaría una fecha de vigencia (¿desde siempre? ¿desde hoy?) y en las dos opciones la deuda quedaría mal. Con la mensualidad actual como punto de partida, la carga es fiel a lo que la asociación viene cobrando y toda corrección posterior queda registrada, fechada y atribuida.

   Reparto de las discrepancias, para que el usuario las trabaje: 7 PISC y 2 ALQL cobradas como CASA (subcobro), 8 CASA cobradas como PISC o ALQL (sobrecobro), 5 CASA que nunca recibieron el aumento de 2024. La Fase 0 entrega este listado como reporte, no como cambio aplicado.

2. **El ancla de facturación** se resolvió: es el mes del primer recibo, y las 293 cuentas lo tienen (§6.2).

3. **Los 4 puntos "ACTIVA, PERO NO SE ENCUENTRA"** quedan `Activo`; si se decide suspenderlos, se hace con fecha y los cargos del lapso se anulan (§6.1).

4. **Las 15 cuentas sin `TIPO`** toman la categoría que corresponde a **la mensualidad que ya se les cobra** (misma regla del punto 1), no un `CASA` por defecto:

   | Cuenta | Mensualidad vieja / 2024 | Categoría que se carga |
   |---|---|---|
   | R0211 | $12.000 / $20.000 | **Tienda** — su tarifa dice comercial, no finca |
   | S0373 | $8.000 / $10.000 | Finca (la tarifa nueva manda; la vieja era de piscina) |
   | S063, S0222, S0272, S0273, S025, S0395 | $5.000 / $10.000 | Finca |
   | R002, R0501, R0971, S009, S0141, S0441 | $5.000 / $5.000 | Finca — congeladas, van a `Suspendido` |
   | **R085** | $5.000 / $10.000 | Finca, y **estado `Suspendido`** (ver abajo) |

   **R085 se carga como `Suspendido`**, con motivo *"no encontrado"*. Si aparece, se reactiva con `CarteraService.reactivar` y la causación se reanuda desde esa fecha (§6.1). Con esto **ninguna de las 15 causa**, así que su categoría queda registrada pero sin efecto sobre la deuda hasta que alguna se reactive.

5. **Los 5 propietarios fallecidos** (C022, R045, R095, S035, S036): **no se cambia el propietario.** La información la dieron los familiares y no hubo cambio de dueño formal. Se deja constancia en `observaciones` de la cuenta. Cuando se quiera cambiar el titular se usa el flujo de propietarios que ya existe (`cuenta_propietarios`, un propietario activo a la vez). Esto sale del alcance de cartera y pasa a la sesión de datos maestros.

6. **El movimiento de 2021 NO es exigible** (decidido 2026-07-29). La `AperturaOpaca` cubre **todo** lo anterior al 01/01/2022: los $31.290.000 del saldo ≤2020 más los ~$7,7 millones del movimiento 2021. Total no exigible: **~$39 millones**.

   Razón: las columnas del movimiento 2021 (`SALDO ANTERIOR`, `DEBITO`, `CREDITO`) son las de peor calidad del archivo — `CREDITO` tiene 115 celdas ilegibles de 298 — y el `SALDO A 31 12 2020` que las alimenta resultó ser en parte copia del 2019 y en parte ajustes manuales (§2). Un cobro construido sobre eso no se puede sustentar ante un reclamo.

   Consecuencia práctica: **la frontera de exigibilidad es el 01/01/2022**, la misma fecha desde la cual la conciliación con el Excel da 98,1%. No hay ningún tramo de deuda cobrable cuyo respaldo sea dudoso.

### Sin puntos abiertos de diseño

No queda ningún pendiente de decisión del usuario. Los tres huérfanos están resueltos: C021 se crea suspendida, R0081 es duplicado de S058 (se mapea, no se crea), y S03321 se crea como punto aparte, activa (decidido 2026-07-30).

Lo demás salió del camino crítico: las ~44 recategorizaciones son trabajo manual posterior a la carga, y R085 entra suspendida.

La lectura de las aperturas **ya no es un bloqueador**: se resuelve leyendo la hoja fuente del `VLOOKUP` en vez de la celda calculada, con cobertura de 298/298 (§10.1). Nadie tiene que recalcular nada en Excel.

### Sobre la calidad de las fuentes: qué importa y qué no

Las columnas del Excel se dividen en dos grupos, y la diferencia decide dónde vale la pena invertir esfuerzo:

| Columnas | Estado | Impacto |
|---|---|---|
| `PAGOS EN 2022`…`2026`, `MENSUALIDAD`, `MENSUALIDAD 2024` | **limpias, 0 fórmulas rotas** | Alto: de aquí sale toda la deuda exigible |
| `SALDO A 31/12/20XX`, `SALDO ANTERIOR`, `DEBITO`, `CREDITO` | fórmulas con resultado parcial o desactualizado | Bajo: son saldos derivados, y el bloque que alimentan no es exigible |

Los datos que determinan lo que alguien paga son justamente los limpios. Los sucios alimentan un número que nunca se cobra. Por eso la migración reconstruye el tramo 2022→hoy desde cero (causación calculada + abonos de los recibos de la base, conciliados al 98,1%) en vez de importar los saldos del Excel, y solo usa el Excel para la apertura opaca y para **verificar** el resultado (§10.10).

## 12. Fuera de alcance

- **Actualización de datos maestros** (cédula, teléfono, correo, coordenadas, `NOMBRE FINCA`, propietario `ANTIGUO`, alias "TAMBIEN COMO X"). Es un entregable aparte que usa el mismo `Datos.xlsx` pero no toca la deuda, y encaja con el spec ya escrito de [nombre_predio](2026-07-29-nombre-predio-cuentas-design.md).
- **Los 5 propietarios fallecidos.** No hay cambio de titular (§11.5); la constancia en `observaciones` va con los datos maestros.
- **Cualquier cambio al modelo de propietarios.** Sigue siendo un propietario activo por cuenta, como ya se decidió.
- **Los puntos "piratas"** (filas 302+ de `Datos.xlsx`, sin código).
- **Llevar la cartera al balance contable** (§7).
- **Intereses de mora.** No se cobran hoy y nadie los pidió.
- **Reconstruir la composición del saldo opaco.** Demostradamente imposible (§2).

## 13. Testing

Unitarios, sobre base en memoria como el resto del proyecto:

- `imputacion.test.js` — el módulo puro, con los casos que salieron de la data real: abono parcial de medio mes (C019, $5.000 sobre mensualidad $10.000); abono que cubre varios cargos y deja sobrante; abono mayor a la deuda (→ saldo a favor); deuda cero; cargos con tarifas distintas en el rango (cruce 2023→2024, cuando la mensualidad se dobló); **cobertura de meses salteados** (cubrir los 12 cargos de 2023 dejando descubiertos los de 2022, y verificar que "cubierto hasta" no avanza).
- `CarteraService.causacion.test.js` — idempotencia (llamar dos veces no duplica); no causa en `Suspendido`/`Inactivo`; no causa antes de `fecha_inicio_facturacion`; **no causa en período cerrado y no existe forma de forzarlo desde el servicio**; usa la tarifa histórica correcta por mes.
- `CarteraService.abonos.test.js` — los cuatro modos; el opaco solo baja con `AbonoSaldoOpaco`; un abono FIFO nunca toca el bucket no exigible; validaciones de tope; **los tres invariantes de `cartera_imputaciones` (§4)**; un abono nuevo no altera las imputaciones de uno anterior.
- `CarteraService.saldos.test.js` — `deuda_exigible` y `saldo_opaco` separados; saldo a favor como exigible negativo; `AjusteAsamblea` y `CastigoCartera`.
- `CarteraService.recategorizar.test.js` — el caso de S0251 (piscina retroactiva a nov-2025): sube el cargo de los meses afectados sin tocar imputaciones; la baja retroactiva sobre un mes **ya pagado** produce saldo a favor; los meses con diferencia cero no generan ajuste; ningún `CargoMensual` se muta nunca; recategorizar dos veces seguidas no acumula ajustes duplicados; los saldos quedan correctos aunque `cartera_imputaciones` esté vacía.
- `CarteraService.estados.test.js` — suspender con fecha retroactiva anula los cargos de ese lapso; reactivar reanuda sin recausar el lapso suspendido; `cuentas.estado` queda sincronizado con la vigencia abierta; no se solapan dos vigencias; la causación consulta el histórico y no la columna.
- Regresión de los tres casos reales: **R034 → $370.000, R037 → $420.000, R019 → $110.000**, con sus recibos reales como entrada. Son el mejor test que tenemos porque la respuesta correcta está verificada contra el Excel al peso.
- `scripts/import-cartera/*.test.js` — siguiendo el patrón de `import-gastos`.
