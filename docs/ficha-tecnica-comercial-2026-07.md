# Ficha técnica y funcional — Acueducto Admin
_Insumo para propuesta comercial. Generado 2026-07-04 a partir de una lectura completa del código, README, ARQUITECTURA.md y memoria de sesiones previas (auditoría de contabilidad 2026-07-03/04)._

## 1. Qué es, en una frase

Software de escritorio 100% offline para la administración integral de **acueductos veredales** (asociaciones comunitarias de agua rural en Colombia): cuentas/predios, propietarios, tarifas, cartera, gastos, caja/bancos y **contabilidad de doble partida completa**, todo en una sola instalación por asociación.

## 2. ¿Es un "ERP"? — cómo posicionarlo sin sobrevender

El propio README del proyecto es explícito: **"No es un ERP completo: el sistema está acotado a lo que necesita una junta de acueducto veredal."** Incluye contabilidad de doble partida (débito/crédito) porque la asociación la necesita para sus informes ante la junta y la contadora, pero deliberadamente no incluye módulos de ERP genérico que no aplican a este contexto (inventarios, facturación electrónica, nómina).

**Recomendación para la propuesta**: posicionarlo como **"ERP vertical / especializado para acueductos veredales"**, no como un ERP genérico tipo SAP/Odoo. El argumento de venta es justamente lo contrario de "todo en uno genérico": es un sistema que ya trae resueltas las reglas de negocio específicas del sector (tarifas históricas, pagos por mes calendario, PUC ya mapeado) sin la complejidad ni el costo de un ERP genérico que habría que configurar desde cero.

## 3. Módulos y funcionalidades incluidas

### Dashboard
Indicadores generales: cuentas al día / en mora / con saldo a favor, saldo de caja, saldo de banco, gráficos de ingresos vs. gastos (Chart.js).

### Cuentas
Alta y gestión de predios/cuentas de servicio. Código manual (no autogenerado). Historial completo de propietarios y categorías a lo largo del tiempo — la cuenta/predio es la entidad central del sistema, no el usuario.

### Propietarios
Catálogo de personas/entidades asociadas a una o más cuentas a través del tiempo (un propietario puede vender el predio y el historial de la cuenta se conserva).

### Categorías
Tipos de cuenta (Finca, Tienda, etc.) con **tarifa histórica por año**: las tarifas nunca se sobrescriben, así que una deuda vieja se cobra al precio vigente en la fecha en que se causó, no al precio actual.

### Aportes (Pagos)
- Estado de cartera: al día / en mora / con saldo a favor.
- Registro de pagos y abonos; **un solo pago puede cubrir varios meses atrasados o futuros** (siempre por mes calendario completo, nunca por rangos de días).
- Tab **Nuevos Puntos**: conexiones nuevas con valor total y abonos parciales hasta saldarse.

### Recibos
Comprobante generado automáticamente por cada pago. Impresión directa y exportación a PDF (vía motor de impresión de Chromium, sin librería externa). Numeración **global y consecutiva**, configurable pero nunca reiniciable libremente.

### Gastos
- Registro de egresos con **Tipo de Gasto como lista cerrada** (no texto libre): cada tipo ya tiene una cuenta contable asignada en Mapeo de Conceptos, así que un gasto nunca queda mal clasificado por error de tipeo. Un Administrador puede agregar tipos nuevos.
- Tab **Proveedores** (catálogo de **Terceros**): proveedores y otros aliados, separado del catálogo de Propietarios (son relaciones de naturaleza distinta con el acueducto).

### Caja / Banco
Saldos, movimientos, consignaciones (traslado caja→banco), resumen de flujo de ingresos/gastos/flujo neto por período.

- **Caja Menor**: submódulo completo (asignación de responsable, historial de responsables, reembolsos, saldo objetivo configurable) — **construido y funcional, pero nunca activado con datos reales** en ninguna instalación hasta la fecha. Mencionarlo como funcionalidad disponible, no como algo "probado en campo".

### Contabilidad (el módulo más elaborado del sistema)
- **Dashboard Financiero** propio.
- **Plan de Cuentas**: Plan Único de Cuentas (PUC) jerárquico, 5 niveles (Clase→Grupo→Cuenta→Subcuenta→Auxiliar), con tipo (Activo/Pasivo/Patrimonio/Ingreso/Gasto/Costo) y naturaleza (Débito/Crédito).
- **Mapeo de Conceptos**: qué cuenta del PUC usa cada tipo de gasto/recibo/movimiento, editable por un Administrador sin tocar código ni datos históricos ya registrados.
- **Cuentas Automáticas**: mapeo interno de claves del sistema (p. ej. "Caja", "Banco", "Caja Menor") a la cuenta imputable correspondiente del PUC.
- **Plantillas de Contabilización**: plantillas versionadas de asientos (usadas también por el motor de impuestos), con historial de versiones.
- **Impuestos**: motor de impuestos/retenciones asignables a plantillas — **construido pero nunca ejercitado con datos reales** (0 registros de impuestos en la base actual).
- **Períodos Contables**: apertura/cierre/bloqueo de períodos, con fecha límite configurable para impedir contabilizar en fechas ya cerradas — **construido pero nunca usado realmente** (0 filas en la tabla pese a años de asientos de prueba).
- **Asientos Contables**: automáticos (cada gasto, recibo y traslado caja→banco genera su asiento) + **Notas Contables** manuales (para ajustes, partidas de apertura, correcciones) + **reversión** (anular no borra: crea un asiento inverso enlazado, nunca se pierde el rastro).
- **Reportes Contables**: Libro Diario, Libro Mayor, Balance de Prueba (general y por Tercero), Balance General, Estado de Resultados, Flujo de Caja, Historial de Pagos/Gastos, **Informe de Empalme** (pensado específicamente para la entrega de una junta saliente a la entrante — un diferenciador fuerte para este nicho).

### Reportes (generales)
Cuentas, Propietarios, Historial de Pagos, Historial de Gastos, Cuentas al día / en mora / con saldo a favor, Nuevos Puntos, Ingresos por período, Gastos por período, Terceros con datos incompletos, Cartera por edades. Todos exportables a Excel (multi-hoja) y PDF.

### Configuración
- Datos de la asociación (nombre, ciudad, logo).
- Gestión de usuarios y roles (ver sección de seguridad).
- Cambio y reseteo de contraseña.
- **Auditoría**: bitácora de todas las acciones de escritura (quién hizo qué, cuándo), automática — no depende de que cada función la registre a mano.
- Copia de seguridad manual + copia de seguridad automática local.
- **Respaldo en la nube (Google Drive, opcional)**: sincroniza la base de datos completa entre varios equipos de la misma asociación (ej. tesorería y presidencia). Protocolo de "un solo escritor a la vez" (detecta si otro equipo subió una versión más nueva antes de sobrescribir). No es edición simultánea en tiempo real.
- **Modo de Pruebas**: cargar/eliminar datos de ejemplo sin afectar el Plan de Cuentas, Mapeo de Conceptos, configuración ni usuarios.

## 4. Reglas de negocio como argumentos de venta

Estas son decisiones de diseño que resuelven problemas reales del sector y son buenos puntos para la propuesta:

1. **Historial completo e inmutable**: nunca se borra nada (cuentas, gastos, asientos); todo se anula/desactiva con rastro. Relevante para juntas que rinden cuentas ante asamblea y para el "Informe de Empalme" entre juntas.
2. **Tarifas históricas por año**: una deuda de hace 2 años se cobra al precio de hace 2 años, no al precio de hoy — evita errores de cobro y reclamos.
3. **Contabilidad automática sin que nadie la lleve "a mano"**: cada gasto/recibo/traslado genera su asiento de doble partida solo, resuelto por un mapeo configurable — la asociación no necesita contratar un contador para el día a día, solo para revisión periódica.
4. **Cero riesgo de doble contabilización**: protección explícita contra doble clic/doble envío en los 5 formularios financieros (hallazgo crítico de auditoría ya corregido, ver memoria `auditoria_contabilidad_2026-07`).
5. **Trazabilidad total**: auditoría automática de cada escritura, reversión (no eliminación) de asientos anulados, balance de prueba que siempre debe cuadrar.
6. **Simplicidad deliberada de despliegue**: sin servidor, sin nube obligatoria, sin licencias de terceros recurrentes (SQLite embebido) — instalación en un solo PC funciona de inmediato.

## 5. Seguridad y control de acceso

- **3 roles**: Administrador, Usuario, Consulta.
- Rol **Consulta** solo puede leer, nunca escribir (aplicado automáticamente por convención de nombre del canal, no por configuración caso a caso).
- Una lista de operaciones sensibles (gestión de usuarios, restaurar backup, Plan de Cuentas, Mapeo de Conceptos, Notas Contables/reversión, Períodos, Impuestos, Cuentas Automáticas, Caja Menor) está bloqueada para cualquier rol distinto de Administrador, **incluso si técnicamente es de solo lectura para otros roles**.
- Sesión única por instalación (no hay tokens ni sesiones concurrentes múltiples dentro del mismo proceso).
- Auditoría automática de toda escritura exitosa (usuario, acción, módulo, registro afectado).

## 6. Qué NO incluye (explícito — para gestionar expectativas en la propuesta)

- **No es un ERP genérico**: no reemplaza un SAP/Odoo/similar para una empresa comercial normal.
- **No maneja inventarios ni compras** (no hay control de stock/almacén).
- **No genera facturación electrónica** (no hay integración con la DIAN ni documentos electrónicos fiscales).
- **No tiene módulo de nómina** (liquidación de empleados, seguridad social, prestaciones) — el motor de "Impuestos" es para retenciones/tributos del acueducto, no para nómina.
- **No es multiusuario concurrente en tiempo real**: es una app de escritorio de un solo usuario activo por instalación. Varios equipos de la misma asociación se sincronizan por **respaldo completo de archivo** (Google Drive), con protocolo de un solo escritor a la vez — no es edición simultánea fila por fila como un sistema cliente-servidor.
- **No tiene backend/servidor propio ni API pública**; no es una aplicación web ni tiene versión móvil.
- **Solo Windows**: el instalador se genera únicamente para Windows x64 (NSIS). No hay build para Mac/Linux.
- **No tiene pasarela de pagos en línea** (PSE, tarjetas) ni cobro automático a los propietarios — todo pago se registra manualmente.
- **No envía notificaciones automáticas** (SMS/email/WhatsApp) a los propietarios sobre su cartera o vencimientos.
- **No tiene portal de autoservicio** para que el propietario consulte su cuenta desde fuera de la oficina.
- **No es multi-empresa/multi-sede**: una instalación = una asociación. No hay multi-moneda (el contexto es un solo acueducto veredal en pesos colombianos).
- **No genera facturación automática recurrente**: cada pago y gasto se registra manualmente, por diseño (control humano deliberado, apropiado para el tamaño de estas organizaciones).

## 7. Estado de madurez del proyecto (importante para no sobrevender)

- Proyecto iniciado 2026-06-21, ~84 commits a la fecha (2026-07-04): **desarrollo muy reciente**, no hay track record de años.
- **Todos los datos actuales (gastos, pagos, recibos) son de prueba** y se borrarán antes de cualquier puesta en producción real (ver memoria `datos_prueba_descartables`) — **el sistema aún no ha sido usado por ninguna asociación real**. No presentar casos de uso/clientes reales en la propuesta a menos que ya exista uno confirmado fuera de este repositorio.
- Auditoría integral de Contabilidad realizada 2026-07-03: 54 hallazgos totales; los 13 Críticos/Altos ya corregidos y mergeados a `main` (2026-07-04). Quedan 41 hallazgos Medio/Bajo pendientes (no bloquean funcionalidad, son mejoras/deuda técnica).
- Cobertura de pruebas automatizadas: 14 archivos de test unitarios, concentrados en la lógica financiera/contable más sensible (motor de asientos, reversión, conciliación, saldo inicial).
- Submódulos **construidos pero sin ejercitar aún con datos reales**: Períodos Contables (cierre/bloqueo), Impuestos (motor tributario), Caja Menor (activable pero nunca activada). Funcionan y tienen tests, pero no hay evidencia de uso real todavía — presentarlos como "incluidos y disponibles", no como "probados en producción durante años".

## 8. Requisitos técnicos y despliegue

- Aplicación de escritorio **Electron** para Windows; instalador `.exe` (NSIS), instalación local sin dependencia de servidor.
- Base de datos **SQLite embebida** (better-sqlite3): un solo archivo, cero configuración, funciona 100% sin internet.
- Reportes exportables a **Excel** (multi-hoja, vía exceljs) y **PDF** (vía motor de impresión nativo de Chromium).
- Respaldo local manual + automático; respaldo opcional en la nube vía **Google Drive** (OAuth2), sin costo de servidor propio.
- Sin dependencia de conexión a internet para el uso diario — internet solo es necesario si se activa el respaldo en la nube.

## 9. Notas para quien escriba la propuesta comercial

- Usar el lenguaje de "ERP especializado para acueductos veredales" o "sistema administrativo y contable a la medida del sector", evitando la comparación directa con ERPs genéricos de mercado.
- Separar claramente, en la sección de alcance, "Incluido" vs. "No incluido" (sección 6 de este documento) para evitar expectativas mal fundadas — esto además transmite profesionalismo y transparencia.
- No mencionar años de operación ni clientes reales como referencia todavía (sección 7).
- Los verdaderos diferenciadores para destacar son: historial inmutable con reversión contable, tarifas históricas, contabilización automática sin contador de planta, y el Informe de Empalme entre juntas — son necesidades muy específicas del sector que un ERP genérico no resuelve de fábrica.
