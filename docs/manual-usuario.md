# Manual de Usuario — Sistema Administrativo del Acueducto

Guía para el personal administrativo de la asociación (tesorería, secretaría, junta directiva). No se necesitan conocimientos de informática para usar este manual.

_Versión del documento: 2026-08-20 (documenta el selector de formato de impresión de recibos —Carta o Térmica 80mm— junto a Imprimir/Descargar PDF y el nuevo campo de formato predeterminado en Configuración, el modal de confirmación con Imprimir/Descargar PDF al registrar un aporte o un abono de conexión, el cálculo automático del total en "Registrar Aporte", las coordenadas GPS colapsadas en "Nueva Cuenta", las 4 pestañas de Configuración, y los cambios de nombre en "Cartera y Movimientos"/"Avisos de Cartera" y en el Dashboard Financiero de Contabilidad)._

---

## Índice

1. [Antes de empezar: cosas que se repiten en todo el sistema](#1-antes-de-empezar-cosas-que-se-repiten-en-todo-el-sistema)
2. [Cómo iniciar sesión](#2-cómo-iniciar-sesión)
3. [Dashboard (pantalla de inicio)](#3-dashboard-pantalla-de-inicio)
4. [Cuentas (predios)](#4-cuentas-predios)
5. [Propietarios](#5-propietarios)
6. [Categorías y tarifas](#6-categorías-y-tarifas)
7. [Aportes (cobros y pagos)](#7-aportes-cobros-y-pagos)
8. [Recibos](#8-recibos)
9. [Gastos y Proveedores](#9-gastos-y-proveedores)
10. [Caja y Bancos](#10-caja-y-bancos)
11. [Contabilidad](#11-contabilidad)
12. [Reportes](#12-reportes)
13. [Configuración](#13-configuración)
14. [Cerrar sesión](#14-cerrar-sesión)

---

## 1. Antes de empezar: cosas que se repiten en todo el sistema

Estos comportamientos son iguales en todos los módulos del sistema. Entenderlos una sola vez ahorra explicarlos en cada pantalla.

- **Las ventanas emergentes (formularios)** se cierran con el botón "Cancelar" o "Cerrar", haciendo clic fuera del cuadro, o con la tecla `Esc`.
- **Los mensajes de confirmación** ("¿Está seguro...?") son ventanas propias del programa, no alertas de Windows. Siempre tienen un botón para cancelar y otro para confirmar.
- **Los avisos de éxito o error** aparecen como una notificación pequeña en una esquina de la pantalla (verde si algo salió bien, rojo si hubo un error) y desaparecen solas después de unos segundos; no hay que hacer clic en "Aceptar".
- **Los campos de dinero** agregan automáticamente los puntos de miles mientras se escribe (por ejemplo, al escribir `50000` se ve `50.000` en pantalla).
- **Algunos campos desplegables permiten escribir para buscar** (por ejemplo, al elegir un propietario, un proveedor o una cuenta contable): en vez de desplazarse por una lista larga, se puede escribir parte del nombre y el sistema filtra las opciones.
- **Nada se elimina de forma permanente.** En todo el sistema, en lugar de un botón "Eliminar" vas a encontrar botones como "Desactivar", "Suspender", "Cancelar" o "Anular". El registro original nunca desaparece, queda guardado como constancia — esto es a propósito, para que siempre se pueda auditar qué pasó.
- **El historial nunca se sobrescribe.** Cuando cambias el propietario de una cuenta, su categoría, o la tarifa de una categoría, el sistema no borra el dato anterior: lo "cierra" con una fecha, y crea uno nuevo vigente desde la fecha que indiques. Así siempre queda registrado quién/qué aplicaba en cada momento del pasado.

### Los tres tipos de usuario (roles)

El sistema tiene tres roles, y lo que cada uno puede hacer es distinto:

| Rol | Qué puede hacer |
|---|---|
| **Administrador** | Acceso completo: todos los módulos, gestión de usuarios, configuración de la asociación, contabilidad avanzada (Plan de Cuentas, Mapeo de Conceptos, cierre de períodos, etc.) y restaurar copias de seguridad. |
| **Usuario** | Operación del día a día: cuentas, propietarios, aportes, recibos, gastos, caja/bancos, reportes. No ve la configuración de la asociación ni la gestión de usuarios. |
| **Consulta** | Solo puede ver información, no puede registrar ni modificar nada. Además, tiene un comportamiento especial: si hay una versión más reciente de los datos en la nube, la trae automáticamente al iniciar sesión (ver más abajo). |

A lo largo de este manual, las secciones marcadas con 🔒 solo las puede usar el rol **Administrador**.

---

## 2. Cómo iniciar sesión

### Primera vez que se usa el sistema en un equipo nuevo

> **Antes de que aparezca cualquier pantalla**, la primerísima vez que se abre esta versión del sistema en un equipo (instalación nueva o actualización), se muestra un cuadro de mensaje con la contraseña de una **cuenta de recuperación** (usuario `recuperacion`). Anótala y guárdala en un lugar seguro aparte del computador — solo se muestra esa vez. Ver el detalle en "Usuarios 🔒" (sección Configuración) más abajo.

Si el equipo no tiene ningún dato todavía, antes del login aparece la pantalla **"Configuración Inicial"**:

- **"Traer datos desde Google Drive"**: úsalo si la asociación ya usa el sistema en otro equipo y tiene un respaldo guardado en la nube — trae automáticamente toda la información existente.
- **"Continuar sin la nube"**: úsalo si es la primera vez que se usa el sistema en la asociación.

[CAPTURA DE PANTALLA AQUÍ: pantalla "Configuración Inicial" con los dos botones]

### Iniciar sesión

1. Escribe tu **Usuario**.
2. Escribe tu **Contraseña**.
3. Haz clic en **"Ingresar"**.

[CAPTURA DE PANTALLA AQUÍ: pantalla de Login con los campos Usuario y Contraseña]

Si el usuario o la contraseña están mal, aparece un mensaje en rojo encima del formulario y puedes volver a intentarlo.

> **Nota para el rol Consulta**: si alguien más subió información más reciente a la nube, al iniciar sesión con este rol el sistema la trae automáticamente y reinicia el programa solo, sin pedir confirmación. Esto es normal y es porque este rol nunca tiene cambios propios que se puedan perder.

---

## 3. Dashboard (pantalla de inicio)

Es la primera pantalla que se ve después de iniciar sesión. Es solo para **consultar**, no tiene formularios ni botones de registro — su función es dar un vistazo rápido del estado general del acueducto.

[CAPTURA DE PANTALLA AQUÍ: Dashboard completo]

Si hay algo que requiere atención, aparece un aviso amarillo arriba de todo, por ejemplo:
- Categorías que no tienen tarifa configurada (no se les puede cobrar hasta asignarles una).
- El respaldo en la nube lleva más de 15 días sin actualizarse.

**Indicadores financieros**: Saldo en Caja, Saldo en Banco, Cartera Pendiente (lo que deben las cuentas en mora) e Ingresos del Mes.

**Indicadores operativos**: Cuentas Activas, Cuentas Suspendidas, Aportes Vencidos (cuentas en mora) y cuentas con Saldo a Favor.

**Gráfico**: Ingresos vs. Gastos de los últimos 6 meses.

**Actividad reciente**: los últimos pagos, los últimos gastos y los últimos movimientos de caja registrados en el sistema.

---

## 4. Cuentas (predios)

Es el módulo donde se administran los predios/cuentas de servicio del acueducto. **La cuenta es el centro de todo el sistema** — no la persona: si un predio cambia de dueño, la cuenta sigue siendo la misma y se conserva el historial completo de quiénes han sido sus propietarios.

[CAPTURA DE PANTALLA AQUÍ: listado de Cuentas con la barra de búsqueda y la tabla]

Arriba de la tabla puedes buscar por código, dirección, propietario o identificación, y filtrar por estado o por categoría.

### Cómo crear una cuenta nueva

1. Haz clic en **"+ Nueva Cuenta"**.
2. Completa el formulario:
   - **Código** (obligatorio): tú decides el código, no es automático.
   - **Dirección** (obligatorio).
   - **Ubicación (Coordenadas GPS) — opcional**: aparece plegada bajo un título que puedes hacer clic para desplegarla (si la cuenta ya tenía coordenadas guardadas, se abre sola). Ahí puedes registrar las coordenadas GPS del punto de conexión de agua (acometida) y de la vivienda. Para copiarlas desde Google Maps en tu celular: mantén presionado el punto exacto en el mapa, toca las coordenadas que aparecen arriba de la pantalla y pégalas aquí. Si el punto de la vivienda es el mismo que la acometida, marca la casilla correspondiente y no hace falta escribirlo dos veces.
   - **Categoría** (obligatorio): el tipo de predio (Finca, Tienda, etc.).
   - **Categoría Vigente Desde**: normalmente déjalo en la fecha de hoy, salvo que el predio ya existiera desde antes de usar el sistema, en cuyo caso pon la fecha real desde la que aplica esa categoría.
   - **Valor de Conexión (opcional)**: si esta es una conexión nueva que debe pagar un cargo por conectarse al acueducto, indica aquí el valor total.
   - **Propietario**: puedes escribir los datos de un propietario nuevo directamente aquí, o buscar y seleccionar uno que ya exista en el sistema. También puedes dejarlo en blanco y asignarlo después desde el módulo Propietarios.
   - **Observaciones (opcional)**.
3. Haz clic en **"Crear"**.

[CAPTURA DE PANTALLA AQUÍ: formulario "Nueva Cuenta" completo]

### Cómo editar, suspender o activar una cuenta

- Botón **"Editar"** en la fila de la cuenta: permite cambiar dirección, ubicación, estado y observaciones.
- Botón **"Suspender"** (si está activa) o **"Activar"** (si está suspendida): cambia el estado con una confirmación previa.
- **No existe un botón para eliminar una cuenta.** Solo se puede cambiar su estado (Activo / Inactivo / Suspendido).

### Ver el detalle de una cuenta

Al hacer clic en **"Ver"** se abre toda la información de la cuenta: datos generales, ubicación (con botón **"Ver en mapa"** si tiene coordenadas registradas, que abre Google Maps), historial completo de propietarios, historial completo de categorías, y el estado del cargo de conexión si tiene uno pendiente.

[CAPTURA DE PANTALLA AQUÍ: modal de detalle de una cuenta, mostrando historial de propietarios y categorías]

### Cambiar la categoría de una cuenta

1. Desde la tabla, botón **"Categoría"** (o desde el detalle, botón **"Cambiar Categoría"**).
2. Elige la **Nueva Categoría** y la **Fecha de Inicio** desde la cual aplica.
3. Puedes agregar una observación (por ejemplo, el motivo del cambio).
4. Haz clic en **"Cambiar"**.

La categoría anterior no se borra: queda registrada en el historial con la fecha en que dejó de aplicar.

### Cambiar el propietario de una cuenta

1. Desde el detalle de la cuenta, botón **"Cambiar Propietario"**.
2. Elige el **Nuevo Propietario** (debe existir ya en el módulo Propietarios) y la **Fecha de Inicio**.
3. Agrega una observación si quieres (por ejemplo: "Compra de propiedad", "Herencia").
4. Haz clic en **"Cambiar"**.

[CAPTURA DE PANTALLA AQUÍ: formulario "Cambiar Propietario de Cuenta"]

---

## 5. Propietarios

Aquí se administran las personas o entidades dueñas de los predios. Un propietario puede tener varias cuentas a la vez, y una cuenta conserva todo su historial de propietarios a través del tiempo.

[CAPTURA DE PANTALLA AQUÍ: listado de Propietarios]

### Cómo crear un propietario nuevo

1. Haz clic en **"+ Nuevo Propietario"**.
2. Completa: **Nombre Completo** (obligatorio), Número de Identificación, Teléfono, Correo Electrónico y Observaciones (todos opcionales excepto el nombre).
3. Haz clic en **"Crear"**.

> Crear un propietario no lo asigna automáticamente a ninguna cuenta — eso se hace en un segundo paso (ver abajo), o se puede hacer todo junto desde el formulario de "Nueva Cuenta" descrito en la sección anterior.

### Cómo asignar un propietario a una cuenta

1. Haz clic en **"Asignar"** en la fila del propietario.
2. Elige la **Cuenta** a la que se va a asignar (solo aparecen cuentas activas) y la **Fecha de Inicio**.
3. Agrega una observación si quieres.
4. Haz clic en **"Asignar"**.

[CAPTURA DE PANTALLA AQUÍ: formulario "Asignar Propietario a Cuenta"]

Si la cuenta ya tenía otro propietario, ese queda registrado en el historial con la fecha en que dejó de serlo — no se pierde la información.

### Ver el detalle de un propietario

Botón **"Ver"**: muestra sus datos, las cuentas que tiene actualmente asignadas, y el historial completo de todas las cuentas que ha tenido a lo largo del tiempo (incluidas las que ya no son suyas).

---

## 6. Categorías y tarifas

Las categorías son los tipos de predio (por ejemplo: Finca, Finca con piscina, Tienda), y cada una tiene su propia tarifa mensual de sostenimiento.

[CAPTURA DE PANTALLA AQUÍ: listado de Categorías con su tarifa actual]

> El listado solo muestra las categorías activas. Si necesitas ver también las que ya no se usan (por ejemplo, categorías heredadas de una carga inicial de datos), marca la casilla **"Mostrar inactivas"** junto al botón "+ Nueva Categoría".

### Cómo crear una categoría nueva

1. Haz clic en **"+ Nueva Categoría"**.
2. Completa **Nombre** (obligatorio) y **Descripción** (opcional).
3. Haz clic en **"Crear"**.
4. El sistema abre automáticamente la ventana para configurar la tarifa de esta categoría — ver el paso siguiente, porque una categoría recién creada no tiene tarifa hasta que se le asigne una.

### Cómo funciona la tarifa histórica — muy importante entenderlo bien

**No existe un botón para "editar" la tarifa actual.** En vez de eso, cada vez que la tarifa cambia (por ejemplo, un ajuste anual), se **agrega una tarifa nueva** con la fecha desde la cual empieza a regir, y el sistema automáticamente marca la anterior como finalizada en esa fecha. Así, si alguien debe meses de hace dos años, se le cobra al precio que estaba vigente en esa fecha, no al precio de hoy.

1. Haz clic en el botón **"Tarifa"** en la fila de la categoría.
2. Escribe la **Nueva Tarifa** (el valor mensual de sostenimiento).
3. Elige la **Fecha de Vigencia**: la fecha desde la cual debe aplicar ese valor (puede ser una fecha pasada, para dejar constancia de un ajuste anterior, o futura, para programarlo con anticipación).
4. Agrega una observación si quieres (por ejemplo: "Ajuste anual 2026").
5. Haz clic en **"Guardar Tarifa"**.

[CAPTURA DE PANTALLA AQUÍ: formulario "Configurar Tarifa" mostrando la tarifa actual y los campos de la nueva]

> **Si la Fecha de Vigencia es una fecha pasada** y a alguna cuenta de esa categoría ya se le habían cobrado meses desde esa fecha (a la tarifa anterior), el sistema guarda igual la tarifa y, apenas termina, muestra automáticamente un aviso — **"La tarifa nueva dejó cargos desalineados"** — con la lista de cuentas y meses afectados y la diferencia total. Desde ahí puedes elegir **"Aplicar reajuste ahora"** (corrige esos meses de una vez) o **"Dejarlo así por ahora"** (los deja para corregir después, ver el punto siguiente). No se corrige nada solo, sin que tú decidas.

### Ver el historial de tarifas de una categoría

Botón **"Ver"**: muestra todas las tarifas que ha tenido esa categoría a lo largo del tiempo (con las fechas de vigencia de cada una) y las cuentas que actualmente pertenecen a esa categoría.

### Cómo hacer un reajuste retroactivo de tarifa

Úsalo cuando la asamblea aprueba una tarifa nueva **con efecto retroactivo** (por ejemplo, "la tarifa sube desde enero de este año, aunque estamos en marzo") y hace falta corregir de una vez los meses que ya se cobraron a esos predios con la tarifa vieja. A diferencia del botón "Tarifa" (que solo registra la tarifa nueva hacia adelante), "Reajuste retroactivo" registra la tarifa **y** corrige lo ya cobrado en el mismo paso.

1. Botón **"Reajuste retroactivo"** en la fila de la categoría.
2. Indica la **Tarifa nueva**, la fecha **Vigente desde** (puede ser una fecha pasada) y, si quieres, el **Acta / motivo** (por ejemplo: "Aprobado en asamblea del 15 de marzo de 2026").
3. Haz clic en **"Ver cuentas afectadas"**. El sistema muestra una vista previa: cuántas cuentas de esa categoría tienen meses ya cobrados desde esa fecha, cuántos meses cada una, y cuánto suma la diferencia total. Si ninguna cuenta se ve afectada, lo dice igual — la tarifa se guarda de todas formas para cobrar los meses futuros.
4. Revisa la vista previa y haz clic en **"Confirmar y aplicar"**.

[CAPTURA DE PANTALLA AQUÍ: vista previa de "Confirmar reajuste" con la tabla de cuentas y meses afectados]

El ajuste queda registrado en el detalle de cada cuenta afectada — no reescribe ni borra los cargos que ya se habían generado, agrega el ajuste correspondiente al lado.

---

## 7. Aportes (cobros y pagos)

Este es el módulo donde se registran los pagos que hacen los propietarios por el sostenimiento del acueducto. Los aportes **siempre se cobran por mes calendario completo** (nunca por rangos de días), y un mismo pago puede cubrir varios meses atrasados o adelantados a la vez.

[CAPTURA DE PANTALLA AQUÍ: pantalla "Estado de Cuentas" del módulo Aportes]

### Cómo ver el estado de cartera

La tabla principal muestra, por cada cuenta: hasta qué mes está pagada, si está **Al día**, **En mora** (y cuántos meses debe), o si tiene **Saldo a Favor**. Puedes filtrar por estado de pago (todas / solo al día / solo en mora / solo con saldo a favor) y, aparte, por estado de la cuenta (Activas — lo que se ve por defecto —, todos los estados, solo suspendidas, o solo inactivas): una cuenta Suspendida no aparece en el filtro por defecto, así que si buscas a alguien y no lo encuentras, revisa este segundo filtro.

La columna **"Avisos de Cartera"** (al final de la tabla, junto a "Acciones") muestra etiquetas cortas cuando corresponde: **"Deuda 2024"** (debe algo de antes de 2024), **"Conexión"** (tiene un cargo de conexión pendiente) o **"Saldo a favor"** (tiene plata guardada de un pago anterior). Para ver el detalle completo de cualquiera de estos avisos, entra al "Ver" de la cuenta.

### Cómo registrar un aporte (cobro) — paso a paso

1. Busca la cuenta y haz clic en **"Registrar Aporte"**.
2. El sistema te muestra automáticamente hasta qué mes está pagada la cuenta y cuál sería el siguiente mes a cobrar.
3. Elige el **Mes y Año de Inicio** del pago (viene sugerido, pero lo puedes cambiar si vas a cobrar un período distinto).
4. Indica la **Cantidad de Meses a Aportar** — puede ser 1 o varios meses seguidos, incluso de años distintos.
5. Si la cuenta tiene saldo a favor guardado de un pago anterior, aparece la casilla **"Aplicar saldo a favor disponible"** — solo se descuenta del total si la marcas, no es automático.
6. El total a cobrar se calcula solo, apenas abres el formulario y cada vez que cambias el mes, el año o la cantidad de meses — no hace falta apretar ningún botón. El botón **"Calcular Total"** sigue ahí por si quieres forzar el recálculo a mano (por ejemplo, justo antes de confirmar, para revisar una vez más).
7. Si la cuenta tiene un cargo de conexión pendiente, puedes incluir un **abono a esa conexión** en el mismo pago (opcional).
8. Confirma la **Fecha de Aporte** (por defecto es hoy) y el **Método de Pago** (Efectivo o Transferencia).
9. Haz clic en **"Registrar Aporte y Generar Recibo"**.

[CAPTURA DE PANTALLA AQUÍ: formulario de registro de aporte, mostrando el cálculo del total y los meses a cubrir]

Al confirmar, el sistema genera automáticamente el **recibo** correspondiente y muestra una ventana de confirmación con el número de recibo, un selector de **formato de impresión** y dos botones: **"Imprimir Recibo"** y **"Descargar PDF"** — ya no hace falta ir después al módulo Recibos a buscarlo a mano. Puedes usar ambos botones (por ejemplo, imprimir para entregar en mano y además guardar el PDF) antes de cerrar la ventana con **"Cerrar"**.

El selector de formato ofrece tres opciones: **"Usar predeterminado"** (el que esté configurado para la asociación, ver sección 13), **"Carta"** (el diseño completo, tamaño carta/A4) o **"Térmica 80mm"** (un ticket angosto para impresoras térmicas POS de rollo continuo). Es el mismo recibo en cualquiera de los dos formatos — mismo número, mismo valor — solo cambia cómo se ve/imprime.

[CAPTURA DE PANTALLA AQUÍ: ventana de confirmación tras registrar un aporte, con el selector de formato y los botones Imprimir Recibo y Descargar PDF]

> Si la cuenta no tiene un propietario asignado, el sistema no deja registrar el pago hasta que se le asigne uno (ver módulo Propietarios).

### Deuda anterior a 2024 y saldo a favor guardado

Dentro del detalle de una cuenta (botón "Ver"), en la sección **"Cartera y Movimientos"**, debajo del recuadro de "A pagar" puede aparecer alguno de estos dos avisos:

- **Deuda anterior al corte (2024)** (en amarillo, como una alerta real): informa cuánto debe la cuenta de antes de 2024, pero es solo informativo — no tiene botón de acción todavía. Para cobrar esa deuda vieja, hazlo como un aporte normal (§"Cómo registrar un aporte") eligiendo como mes de inicio uno de esos meses atrasados.
- **Saldo a favor disponible** (en azul, para distinguirlo de una deuda: es plata a favor del cliente, no un problema): si la cuenta tiene plata guardada de un pago anterior que quedó sin usar (por ejemplo, pagó de más o pagó por adelantado más de lo que alcanzó a cubrir), aparece aquí con un botón **"Usar"**. Al hacer clic, se abre el formulario de "Registrar Aporte" con la casilla "Aplicar saldo a favor disponible" ya marcada y el total ya calculado — solo falta confirmar el método de pago y la fecha.

[CAPTURA DE PANTALLA AQUÍ: detalle de una cuenta mostrando el aviso de saldo a favor con el botón "Usar"]

### Conexiones nuevas (cargo de conexión)

Cuando una cuenta es una conexión nueva con un cargo por conectarse al acueducto, este se administra desde el detalle de la cuenta (botón "Ver" en Aportes):

- Si aún no tiene cargo registrado: botón **"Agregar Cargo de Conexión"**, donde se indica el **Valor Total** a cobrar.
- Si ya tiene un cargo pendiente: se puede **"Abonar Conexión"** (pagos parciales, uno o varios, hasta completar el valor total — cada abono genera su propio recibo, con la misma ventana de confirmación e Imprimir/Descargar PDF que un aporte) o **"Cancelar Conexión"** si finalmente no se va a cobrar (queda registrada como cancelada, no se borra).

[CAPTURA DE PANTALLA AQUÍ: sección "Conexión (Nuevo Punto)" dentro del detalle de una cuenta]

---

## 8. Recibos

Cada pago genera automáticamente un recibo. Este módulo sirve para buscarlos, imprimirlos, exportarlos y, si hace falta, anularlos.

[CAPTURA DE PANTALLA AQUÍ: listado de Recibos]

### Buscar, imprimir y exportar un recibo

1. Escribe en el buscador el número de recibo, código de cuenta o dirección.
2. Botón **"Ver"** para ver el detalle completo (conceptos y valores cobrados).
3. Junto a los botones de imprimir/exportar hay un selector de **formato de impresión**: "Usar predeterminado", "Carta" o "Térmica 80mm" (ver sección 7 para el detalle de las tres opciones).
4. Botón **"Imprimir"** para imprimirlo directamente, en el formato elegido en el selector.
5. Botón **"PDF"** para guardarlo como archivo PDF en el computador, también en el formato elegido.

Este selector aparece tanto en la fila del listado como en el detalle del recibo (botón "Ver"). Cambiar de formato no crea otro recibo ni modifica el número o el valor — es exactamente el mismo recibo, solo cambia la presentación.

[CAPTURA DE PANTALLA AQUÍ: listado de Recibos con el selector de formato junto a los botones Imprimir/PDF]

[CAPTURA DE PANTALLA AQUÍ: detalle de un recibo con el desglose de conceptos]

### Cómo anular un recibo

1. Botón **"Anular"** (solo disponible si el recibo no está ya anulado).
2. Escribe el **Motivo de la Anulación** (obligatorio).
3. Haz clic en **"Confirmar Anulación"**.

El recibo no se borra: queda marcado como "Anulado" y sigue visible para consulta. Los meses o el abono de conexión que cubría vuelven a quedar pendientes de cobro, y el dinero se descuenta automáticamente del saldo de Caja o Banco.

### Recibos anulados del talonario físico

Esta sección aparte es para un caso distinto: cuando en el talonario de papel se anuló un número de recibo **antes** de llegar a cobrarse (por ejemplo, un error de escritura o un tachón), y por lo tanto nunca representó un pago real en el sistema. Botón **"+ Registrar Recibo Anulado"**, indicando el número y el motivo, para que ese número quede reservado y no se repita.

---

## 9. Gastos y Proveedores

Este módulo tiene dos pestañas, visibles al pasar el cursor sobre "Gastos" en el menú lateral: **Gastos** y **Proveedores**.

[CAPTURA DE PANTALLA AQUÍ: listado de Gastos con las pestañas Gastos/Proveedores visibles]

### Cómo registrar un gasto nuevo — paso a paso

1. Haz clic en **"+ Nuevo Gasto"**.
2. Completa el formulario en este orden:
   - **Fecha** (por defecto hoy).
   - **Concepto**: una descripción breve del gasto.
   - **Tipo de Gasto**: elige de la lista (por ejemplo "Mantenimiento", "Servicios Públicos"). Esta lista está definida de antemano — si el tipo que necesitas no aparece, un Administrador lo puede agregar desde Contabilidad → Mapeo de Conceptos (ver §11).
   - **Tipo de Operación**: "Compra directa" (lo normal) o "Reembolso" (cuando alguien pagó de su propio bolsillo y el acueducto le devuelve el dinero).
   - **Tercero**: el proveedor o persona a quien se le pagó. Si no existe todavía en el sistema, hay un botón **"+ Nuevo"** justo al lado para crearlo sin perder lo que ya llevas escrito en el formulario de gasto.
   - **Valor** del gasto.
   - **Método de Pago**: Efectivo o Transferencia.
   - Si es en Efectivo y la asociación tiene activada la Caja Menor, se pregunta de cuál caja sale el dinero (Caja General o Caja Menor).
   - **Observaciones (opcional)**.
3. Haz clic en **"Registrar Gasto"**.

[CAPTURA DE PANTALLA AQUÍ: formulario "Nuevo Gasto" completo]

### Cómo adjuntar la factura o comprobante de un gasto

Esto se hace **después** de guardar el gasto, no en el mismo formulario:

1. Abre el detalle del gasto (botón "Ver").
2. Haz clic en **"+ Agregar Soporte"**.
3. Elige el **Tipo de Soporte** (Factura electrónica, Factura física, Recibo simple, Comprobante interno, Imagen o PDF).
4. Haz clic en **"Seleccionar archivo"** y elige el PDF o la foto/imagen desde el computador (máximo 15 MB).

Se pueden adjuntar varios soportes al mismo gasto.

[CAPTURA DE PANTALLA AQUÍ: detalle de un gasto mostrando la lista de soportes adjuntos]

### Cómo anular un gasto

1. Botón **"Anular"** en el listado o en el detalle del gasto.
2. Escribe el **Motivo de la Anulación**.
3. Haz clic en **"Confirmar Anulación"**.

El gasto no se borra, queda marcado como anulado, y el valor se devuelve automáticamente al saldo de Caja o Banco.

### Cómo editar un gasto ya registrado

Solo se pueden corregir el **Concepto** y las **Observaciones** de un gasto existente — el resto de campos (valor, fecha, proveedor, tipo de gasto, método de pago) no se pueden editar directamente; si alguno de esos está mal, hay que anular el gasto (paso anterior) y registrarlo de nuevo correctamente.

1. Abre el detalle del gasto (botón "Ver").
2. Haz clic en **"Editar"**.
3. Corrige el **Concepto** y/o las **Observaciones**.
4. Haz clic en **"Guardar"**.

[CAPTURA DE PANTALLA AQUÍ: modal "Editar Gasto" mostrando solo los campos Concepto y Observaciones]

### Pestaña Proveedores (Terceros)

Aquí se administran los proveedores y otros aliados a quienes se les hacen pagos por gastos — **es un catálogo separado de los Propietarios** (un propietario del acueducto nunca aparece aquí, y viceversa).

1. Botón **"+ Nuevo Proveedor"**.
2. Completa: Tipo de Identificación, Número de Identificación, Nombre o Razón Social (obligatorio), Nombre Comercial, Teléfono, Correo, Dirección, y marca al menos un **Tipo de Tercero** (Proveedor, Contratista, Aliado u Otro).
3. Haz clic en **"Crear"**.

[CAPTURA DE PANTALLA AQUÍ: formulario "Nuevo Proveedor"]

Botón **"Historial"** en cada proveedor: muestra todos los gastos que se le han registrado. Botón **"Activar/Desactivar"**: si un proveedor ya no se usa, se desactiva en vez de borrarse (su historial se conserva).

---

## 10. Caja y Bancos

Este módulo muestra los saldos y movimientos de dinero. La mayoría de los movimientos se generan solos, automáticamente, cuando se registra un aporte o un gasto en los módulos anteriores — aquí casi todo es de **consulta**.

[CAPTURA DE PANTALLA AQUÍ: pantalla principal de Caja y Bancos con las tarjetas de saldo]

### Saldos y movimientos

Arriba se ven el **Saldo en Caja**, el **Saldo en Banco** y el **Total Disponible**. Debajo, un resumen de Ingresos, Gastos y Flujo Neto del período (por defecto, el mes en curso). Más abajo, la tabla de **Historial de Movimientos**, que se puede filtrar por cuenta (Caja/Banco), tipo de movimiento y rango de fechas.

### Cómo trasladar dinero de Caja a Banco (Consignación)

1. Haz clic en **"+ Registrar Consignación"**.
2. Indica el **Monto a Consignar** y la **Fecha**.
3. Haz clic en **"Registrar Consignación"**.

El sistema resta ese valor de Caja y lo suma a Banco automáticamente; no puede ser mayor al saldo disponible en caja.

[CAPTURA DE PANTALLA AQUÍ: formulario "Registrar Consignación"]

### Cómo traer dinero de Banco a Caja (Registrar Retiro)

Es el movimiento contrario a la Consignación: sirve para cuando se retira efectivo de la cuenta bancaria para tenerlo disponible en caja.

1. Haz clic en **"+ Registrar Retiro"**.
2. Indica el **Monto a Retirar** y la **Fecha**.
3. Agrega una observación si quieres.
4. Haz clic en **"Registrar Retiro"**.

El sistema resta ese valor de Banco y lo suma a Caja automáticamente; no puede ser mayor al saldo disponible en banco.

[CAPTURA DE PANTALLA AQUÍ: formulario "Registrar Retiro"]

### Ajustar saldos cuando no coinciden con la realidad 🔒

Con el tiempo, el saldo que calcula el sistema puede quedar desactualizado frente a la realidad — por ejemplo, si hubo movimientos de caja o banco de años anteriores que nunca se alcanzaron a registrar. Para corregirlo sin borrar ni perder el rastro de nada, existe el botón **"Ajustar saldos"** (solo visible para el rol Administrador, junto a los botones de Consignación y Retiro).

1. Haz un **arqueo físico** de la caja (contar el efectivo real que hay) y revisa el **extracto bancario** más reciente.
2. Haz clic en **"Ajustar saldos"**.
3. El formulario muestra, como referencia, el saldo que el sistema tiene calculado para Caja y para Banco. Reemplázalos por el valor real que arrojó el arqueo/extracto.
4. Antes de guardar, el sistema muestra automáticamente la diferencia que se va a registrar (positiva o negativa) en cada cuenta.
5. Escribe el **Motivo** del ajuste (por ejemplo: "Regularización por registros históricos incompletos anteriores a 2026").
6. Haz clic en **"Registrar Ajuste"**.

[CAPTURA DE PANTALLA AQUÍ: formulario "Ajustar Saldos de Caja y Banco" mostrando la vista previa de la diferencia antes de guardar]

La diferencia queda registrada como un asiento contable normal, con fecha y motivo — no borra ni modifica ningún movimiento histórico, solo agrega el ajuste necesario para que el saldo del sistema vuelva a coincidir con la realidad.

> **Importante**: un ajuste no se puede registrar en una fecha cuyo período contable ya esté Cerrado o Bloqueado (Contabilidad → Períodos Contables). Si vas a hacer un ajuste a una fecha de corte específica (por ejemplo, fin de año), primero registra el ajuste con esa fecha y **después** cierra o bloquea el período — nunca al revés, porque ya no se podría registrar nada en una fecha bloqueada.

### Caja Menor

> Esta función está lista para usarse, aunque la asociación todavía no la ha activado con datos reales — puedes usarla apenas la necesites.

La activación inicial se hace desde 🔒 **Configuración → Caja Menor** (solo Administrador): se marca la casilla "Caja Menor activa", se define un **Saldo Objetivo** (el monto que la caja menor debería tener siempre disponible) y se asigna un **Responsable**.

Una vez activada:
- Los gastos en efectivo pueden pagarse "Con cargo a" Caja General o Caja Menor, eligiéndolo en el formulario de Nuevo Gasto (§9).
- Cuando la Caja Menor se queda con poco dinero, se repone desde **Caja y Bancos → "+ Reembolsar Caja Menor"** (🔒 solo Administrador, aunque el botón se ve en pantalla para cualquier rol): el sistema traslada automáticamente desde Caja General el monto exacto necesario para volver al Saldo Objetivo.

---

## 11. Contabilidad

Este es el módulo más completo del sistema, pensado para quien lleva la contabilidad de doble partida de la asociación (débito/crédito) — normalmente la tesorería, con revisión periódica de la contadora. **Lo bueno es que la mayoría de los asientos contables se generan solos**: cada aporte, cada gasto y cada consignación crea automáticamente su registro contable, sin que nadie tenga que "llevar la contabilidad a mano" para el día a día.

[CAPTURA DE PANTALLA AQUÍ: submenú de Contabilidad desplegado en el menú lateral, mostrando sus 9 secciones]

El módulo se organiza en varias secciones, accesibles desde el submenú de "Contabilidad" en el menú lateral:

### Dashboard Financiero

Muestra el estado del período contable del mes actual (Abierto, Cerrado o Sin registro, con botón para gestionarlo si está Abierto) y el **Resultado del Mes** (utilidad o pérdida contable). Ingresos, gastos, saldo disponible y cuentas en mora **no se repiten aquí** — esos ya están en el Dashboard principal (sección 3); este panel se limita a lo que es exclusivo de la contabilidad formal. Desde acá también hay accesos directos a Gestionar Períodos, Ver Reportes Contables y Asientos Contables.

### Períodos Contables 🔒

Los períodos (uno por cada mes) se crean solos cuando se registra el primer movimiento de ese mes. Desde aquí se puede:
- **Cerrar** un período (para impedir que se sigan registrando movimientos con fecha de ese mes) — se puede volver a abrir después.
- **Bloquear** un período: a diferencia de cerrar, esto es **definitivo** y ya no se puede reabrir desde el sistema. Úsalo solo cuando estés seguro de que ese mes ya quedó cerrado en firme (por ejemplo, después de la revisión de la contadora).

### Plan de Cuentas 🔒

Es el catálogo completo de cuentas contables de la asociación (organizado en niveles: Clase → Grupo → Cuenta → Subcuenta → Auxiliar). Para agregar una cuenta nueva, se elige primero la "cuenta padre" bajo la cual va a quedar (el sistema arma el código automáticamente a partir de ahí) y se le da un nombre.

### Cuentas Automáticas 🔒

Define a qué cuenta del Plan de Cuentas apunta cada concepto interno del sistema (Caja, Banco, Caja Menor). Normalmente no hay que tocar esto después de la configuración inicial.

### Plantillas de Contabilización 🔒

Define cómo se arma el asiento contable de cada tipo de operación (un gasto, un recibo, un traslado). Es una función avanzada, orientada más a quien configura el sistema que al uso diario.

### Impuestos 🔒

Catálogo de impuestos y retenciones (IVA, Retención en la Fuente, ICA, etc.) que se pueden asociar a las plantillas de contabilización mencionadas arriba, para que se descuenten automáticamente cuando corresponda.

### Mapeo de Conceptos 🔒

Aquí se define a qué cuenta contable corresponde cada **Tipo de Gasto**. Es lo que hace posible que, al registrar un gasto (§9), el sistema sepa automáticamente cómo contabilizarlo.

**Cómo agregar un Tipo de Gasto nuevo** (por ejemplo, si aparece una categoría de gasto que no existía antes, como "Seguros"):
1. Haz clic en **"+ Agregar Tipo de Gasto"**.
2. Escribe el **Nombre del Tipo de Gasto**.
3. Elige la **Cuenta Contable** a la que corresponde.
4. Haz clic en **"Agregar"**.

Desde ese momento, ese tipo de gasto queda disponible para elegir en el formulario de Nuevo Gasto.

[CAPTURA DE PANTALLA AQUÍ: formulario "Agregar Tipo de Gasto" en Mapeo de Conceptos]

### Asientos Contables 🔒

Aquí se pueden consultar todos los asientos contables generados (automáticos y manuales), filtrando por rango de fechas.

**Cómo hacer una Nota Contable manual** (para algo que la generación automática no cubre, como un ajuste):
1. Haz clic en **"+ Nueva Nota Contable"**.
2. Elige la fecha y el tipo de comprobante, y escribe el concepto.
3. Completa las líneas del asiento (cada una con su cuenta contable, y el valor en la columna Débito o Crédito). El sistema muestra en tiempo real si el asiento está balanceado — **el total de débitos debe ser igual al total de créditos** para poder guardarlo.
4. Haz clic en **"Guardar Asiento"**.

[CAPTURA DE PANTALLA AQUÍ: formulario "Nueva Nota Contable" mostrando el indicador de balanceado]

**Cómo anular un asiento manual**: botón **"Revertir"** en su detalle, con un motivo obligatorio. El asiento original nunca se borra ni se modifica: se crea uno nuevo con las líneas invertidas para neutralizar su efecto, y ambos quedan enlazados en el historial.

> Los asientos generados automáticamente por un gasto, un recibo o una consignación **no se anulan desde aquí**: hay que anular el documento original (el gasto, el recibo o la consignación) desde su propio módulo, y el asiento contable se revierte solo.

### Reportes Contables

Incluye: Cartera por Edades, Historial de Aportes y de Gastos, Balance General, Estado de Resultados, Flujo de Caja, Libro Diario, Libro Mayor, Balance de Prueba (general y por proveedor/tercero), y el **Informe de Empalme** — pensado específicamente para cuando una junta directiva le entrega el manejo del acueducto a la siguiente. El uso es igual al del módulo Reportes general (ver siguiente sección): vista previa en pantalla y exportación a PDF o Excel.

> Cuentas en Mora, Cuentas al Día y Cuentas con Saldo a Favor **no están acá** — son el mismo reporte que ya está en el módulo Reportes general (sección 12), así que se dejaron solo ahí para no tener el mismo reporte alcanzable por dos caminos distintos. El grupo "Cartera" de esta pantalla trae un enlace directo a Reportes para esos tres.

---

## 12. Reportes

Este módulo reúne los reportes generales sobre cuentas, propietarios y estado de cartera. (Los reportes contables/financieros están dentro de Contabilidad → Reportes Contables, sección anterior.)

[CAPTURA DE PANTALLA AQUÍ: pantalla de Reportes con las tarjetas agrupadas]

Reportes disponibles:
- **Cuentas y Propietarios**: Cuentas Activas, Cuentas Inactivas, Cuentas Suspendidas, Propietarios.
- **Estado de Cuentas**: Cuentas al Día, Cuentas en Mora, Cuentas con Saldo a Favor, Estado de Nuevos Puntos (conexiones).
- **Terceros**: Terceros con Información Incompleta (para detectar proveedores a los que les falta algún dato).

### Cómo generar un reporte

1. Busca la tarjeta del reporte que necesitas y haz clic en **"Vista previa"**.
2. El reporte se abre en una ventana con el mismo formato que tendría al exportarlo.
3. Desde ahí, botones **"Exportar PDF"** o **"Exportar Excel"** para guardarlo en el computador.

[CAPTURA DE PANTALLA AQUÍ: vista previa de un reporte con los botones de exportar]

---

## 13. Configuración

Esta pantalla se organiza en **4 pestañas**, justo debajo del título "Configuración". Las pestañas que ves dependen de tu rol:

| Pestaña | Quién la ve | Contenido |
|---|---|---|
| **General** 🔒 | Solo Administrador | Datos de la Asociación, Caja Menor |
| **Seguridad** | Todos los roles | Cambiar tu propia contraseña |
| **Respaldo** | Todos los roles (algunos botones solo Administrador) | Copias de Seguridad, Respaldo Automático, Respaldo en la Nube |
| **Usuarios y Auditoría** 🔒 | Solo Administrador | Usuarios, Auditoría |

Es decir: los roles Usuario y Consulta solo ven dos pestañas, **Seguridad** y **Respaldo** (y dentro de Respaldo, sin el botón "Restaurar desde Archivo" ni algunos botones de la nube, que son solo de Administrador).

[CAPTURA DE PANTALLA AQUÍ: pantalla de Configuración con las 4 pestañas, vista de Administrador]

### Pestaña General 🔒

**Datos de la Asociación**: Nombre, NIT, dirección, ciudad, teléfono, correo y logo de la asociación (el logo aparece en el encabezado de los reportes exportados, y también en el recibo si se imprime en formato Carta o Térmica 80mm). También los **Parámetros Generales**: próximo número de recibo, **formato de impresión predeterminado de los recibos** (Carta o Térmica 80mm — es el que se usa cuando alguien elige "Usar predeterminado" al imprimir, ver secciones 7 y 8), valor por defecto de un cargo de conexión nuevo, y los saldos iniciales de caja y banco (para cuando se empieza a usar el sistema con saldos que ya existían).

**Caja Menor**: activar/desactivar la Caja Menor, definir su saldo objetivo, y asignar quién es el responsable de manejarla — ver el detalle completo en la sección 10.

### Pestaña Seguridad — cambiar tu contraseña

Cualquier usuario, sin importar su rol, puede cambiar su propia contraseña aquí: escribe tu contraseña actual, la nueva, y confírmala.

[CAPTURA DE PANTALLA AQUÍ: formulario de cambio de contraseña]

### Pestaña Respaldo

#### Copias de Seguridad

- **"Crear Copia de Seguridad"** (todos los roles): genera un archivo con toda la información del sistema, para guardarlo en un lugar seguro (USB, otro computador, etc.).
- **"Restaurar desde Archivo"** 🔒 (solo Administrador): reemplaza todos los datos actuales por los de un archivo de respaldo. **Esta acción no se puede deshacer** — el sistema pide confirmación doble antes de hacerlo, y al terminar se reinicia solo.

#### Respaldo Automático

Solo informativo: muestra la fecha del último respaldo automático que el sistema guardó por su cuenta (esto ocurre solo, una vez al día, sin que nadie tenga que hacer nada).

#### Respaldo en la Nube (Google Drive) — opcional

Permite mantener la información sincronizada entre varios computadores de la misma asociación (por ejemplo, el de tesorería y el de la presidencia), usando una cuenta de Google Drive como punto de encuentro. Es completamente opcional: el sistema funciona igual de completo sin esto, guardando todo solo en el equipo local.

##### ¿De quién debe ser la cuenta de Google, y qué permisos necesita?

Esto **no es la misma cuenta con la que se inicia sesión en el programa** (esa es interna del sistema, usuario/contraseña). Es una cuenta de Google/Gmail aparte, que actúa como el "casillero" donde se guardan los respaldos.

- **No necesita ningún permiso especial ni configuración previa en Google** — cualquier cuenta de Gmail normal, gratuita, sirve. El sistema pide autorización solo para *"ver y administrar los archivos que esta app cree"* (nunca ve fotos, correos, documentos ni ningún otro archivo que ya exista en esa cuenta — solo las carpetas que el propio sistema crea, descritas abajo).
- **Recomendación**: crea una cuenta de Google dedicada solo para esto (ej. `acueducto.[nombreasociacion]@gmail.com`), en vez de usar la cuenta personal de un directivo. Si se usa la cuenta personal de una sola persona y esa persona deja la junta, la asociación podría quedarse sin acceso a sus propios respaldos. Guarda el usuario y la contraseña de esa cuenta en un lugar seguro y compartido (no solo en la cabeza de una persona).
- **Punto crítico — todos los equipos deben conectar la MISMA cuenta**: el sistema sincroniza porque todos los computadores suben/traen archivos del mismo lugar. Si el computador de tesorería conecta una cuenta de Google y el de presidencia conecta *otra* cuenta distinta, cada uno tendrá su propia copia por separado y **nunca se van a sincronizar entre sí** — no hay ningún aviso de error en ese caso, simplemente cada equipo seguirá viendo solo lo suyo. Antes de conectar un segundo equipo, confirma con quien configuró el primero cuál es el correo y la contraseña de esa cuenta compartida.

##### Dónde quedan guardados los datos

Al conectar la cuenta, el sistema crea automáticamente (la primera vez) dos carpetas dentro de esa cuenta de Google Drive — visibles entrando a [drive.google.com](https://drive.google.com) con ese mismo correo:

- **"Acueducto Admin - Respaldos"**: la copia completa de la base de datos (cuentas, pagos, gastos, contabilidad — todo).
- **"Acueducto Admin - Soportes"**: las facturas/comprobantes escaneados que se adjuntan desde el módulo de Gastos.

No hace falta crear estas carpetas a mano ni tocarlas manualmente — el sistema las administra solo. Tampoco hace falta preocuparse por espacio: una cuenta de Gmail gratuita (15 GB compartidos entre Gmail/Drive/Fotos) alcanza sin problema para años de uso de un solo acueducto.

##### Cómo conectar la cuenta por primera vez

1. Haz clic en **"Conectar con Google Drive"**.
2. Se abre el navegador de internet del computador (Chrome, Edge, etc.) — esto es una pantalla de Google, no del programa. Inicia sesión ahí con la cuenta de Google que se haya definido para la asociación (ver recomendación arriba) y acepta el permiso solicitado.
3. Cuando termine, verás una página de confirmación en el navegador; vuelve a la ventana del programa (no se regresa sola).
4. El sistema muestra "Cuenta de Google conectada correctamente".

[CAPTURA DE PANTALLA AQUÍ: sección "Respaldo en la Nube" antes y después de conectar la cuenta]

Una vez conectada, verás cuándo fue el último respaldo subido, y estos botones:
- **"Actualizar desde la nube"** (todos los roles): trae la versión más reciente guardada en Drive.
- **"Respaldar ahora"** 🔒 (solo Administrador): sube la información actual a la nube.
- **"Desconectar cuenta"**: deja de sincronizar con esa cuenta de Google.

> Si otro computador de la asociación subió información más nueva que este equipo no conoce todavía, el sistema te avisa antes de continuar — nunca sobrescribe nada sin avisar primero.

##### Agregar un segundo (o tercer) equipo más adelante

Cuando se instala el sistema en otro computador de la misma asociación, la pantalla previa al login ofrece **"Traer datos desde Google Drive"** (ver sección 2 de este manual). Ahí hay que iniciar sesión con **la misma cuenta de Google** ya conectada en el primer equipo — así trae automáticamente todo lo que ya existe, en vez de empezar de cero.

### Pestaña Usuarios y Auditoría 🔒

#### Usuarios

Aquí se crean las cuentas de acceso del personal y se les asigna su rol.

**Crear un usuario nuevo:**
1. Haz clic en **"+ Nuevo Usuario"**.
2. Completa **Usuario** (el nombre con el que va a iniciar sesión), **Nombre Completo**, una **Contraseña** inicial, y el **Rol** (Administrador, Usuario o Consulta — el propio formulario explica qué puede hacer cada uno).
3. Haz clic en **"Crear Usuario"**.

[CAPTURA DE PANTALLA AQUÍ: formulario "Nuevo Usuario" con el selector de rol]

**Restablecer la contraseña de otra persona:** botón **"Resetear Clave"** en su fila — solo pide la nueva contraseña, no la anterior (útil si alguien olvidó la suya).

**Desactivar un usuario** que ya no debe tener acceso: botón "Desactivar" en su fila (no se puede desactivar a uno mismo).

**Cuenta de recuperación**: además de los usuarios que ves y administras aquí, el sistema trae una cuenta especial llamada `recuperacion`, que **no aparece en esta lista** y no se puede editar, desactivar ni resetear desde esta pantalla — a propósito. Existe para que la asociación nunca quede sin ningún acceso de Administrador, ni siquiera si todas las demás cuentas se desactivan por error o se pierden todas sus contraseñas.

Su contraseña se genera automáticamente y es distinta en cada instalación (no es la misma para todos los clientes del sistema). Se muestra **una única vez**, en un cuadro de mensaje al primerísimo arranque (ver la nota al principio de la sección "2. Cómo iniciar sesión"). Guarda esa contraseña en un lugar seguro, aparte del propio computador (por ejemplo, un gestor de contraseñas o un documento físico bajo llave), y resérvala para el caso de emergencia de quedar bloqueados de todas las demás cuentas — no la uses para el trabajo diario.

#### Auditoría

Muestra las últimas 30 acciones registradas en el sistema: quién hizo qué, cuándo, y en qué módulo. Es de solo lectura — sirve para revisar el uso del sistema, no para hacer cambios.

[CAPTURA DE PANTALLA AQUÍ: tabla de Auditoría]

---

## 14. Cerrar sesión

Haz clic en el botón de cerrar sesión en la parte inferior del menú lateral, y confirma en el cuadro que aparece. Vuelves a la pantalla de Login.

[CAPTURA DE PANTALLA AQUÍ: botón de cerrar sesión en la barra lateral]

---

## Resumen de tareas frecuentes (accesos rápidos)

| Quiero... | Dónde voy |
|---|---|
| Registrar un predio nuevo | Cuentas → "+ Nueva Cuenta" (sección 4) |
| Reajustar una tarifa con efecto retroactivo (subida aprobada en asamblea) | Categorías → "Reajuste retroactivo" (sección 6) |
| Cobrar el sostenimiento de un mes | Aportes → "Registrar Aporte" (sección 7) |
| Usar un saldo a favor guardado de un pago anterior | Aportes → "Ver" la cuenta → botón "Usar" junto al saldo a favor, en azul (sección 7) |
| Imprimir o descargar en PDF el recibo justo después de cobrar | Aparece solo, en la ventana de confirmación al registrar el aporte o el abono (sección 7) |
| Imprimir o reimprimir un recibo ya registrado antes | Recibos → buscar el número → "Imprimir" o "PDF" (sección 8) |
| Imprimir un recibo en formato térmico (impresora POS de 80mm) en vez de carta | Elegir "Térmica 80mm" en el selector de formato, junto a Imprimir/PDF (secciones 7 y 8) |
| Configurar qué formato se usa por defecto al imprimir recibos | Configuración → pestaña General → Parámetros Generales → "Formato de Impresión de Recibos" (sección 13) |
| Registrar una compra o pago del acueducto | Gastos → "+ Nuevo Gasto" (sección 9) |
| Ver cuánto hay en caja y en banco | Caja y Bancos (sección 10) |
| Trasladar dinero entre Caja y Banco | Caja y Bancos → "+ Registrar Consignación" (Caja→Banco) o "+ Registrar Retiro" (Banco→Caja) (sección 10) |
| Corregir el saldo de Caja/Banco tras un arqueo o extracto | Caja y Bancos → "Ajustar saldos" (sección 10, solo Administrador) |
| Generar un reporte de cartera o de cuentas | Reportes → elegir tarjeta → "Vista previa" (sección 12) |
| Cambiar mi contraseña | Configuración → pestaña Seguridad (sección 13) |
| Crear un usuario nuevo para otra persona | Configuración → pestaña Usuarios y Auditoría → Usuarios (sección 13, solo Administrador) |
| Respaldar la información | Configuración → pestaña Respaldo → Copias de Seguridad (sección 13) |
