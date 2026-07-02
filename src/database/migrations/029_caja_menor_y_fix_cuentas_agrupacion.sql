-- 029_caja_menor_y_fix_cuentas_agrupacion.sql
-- Separa 1105 Caja en Caja General / Caja Menor (para poder responder "cuánto se gastó por
-- Caja Menor", "quién es el responsable", "cuánto debería haber físicamente"), y de paso corrige
-- un bug preexistente: BANCO y CARTERA_USUARIOS (en cuentas_automaticas) y varios mapeos en
-- mapeo_conceptos_contables apuntan a cuentas de agrupación (1110, 1305), lo que hace fallar
-- AsientoContableService.crear() ("cuenta de agrupación, no admite movimientos directos") para
-- cualquier Gasto/Recibo pagado por Banco o cualquier aplicación de saldo a favor.

-- ============================================
-- 1. Split de Caja
-- ============================================
INSERT INTO plan_cuentas (codigo, nombre, tipo, naturaleza, nivel, padre_id) VALUES
  ('110505', 'Caja General', 'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1105')),
  ('110510', 'Caja Menor',   'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1105'));

-- ============================================
-- 2. Reasignar cuentas automáticas a subcuentas hoja
-- ============================================
UPDATE cuentas_automaticas SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '110505'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE clave = 'CAJA';
UPDATE cuentas_automaticas SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '111005'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE clave = 'BANCO';
UPDATE cuentas_automaticas SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '130505'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE clave = 'CARTERA_USUARIOS';

-- ============================================
-- 3. Reasignar mapeos de conceptos a subcuentas hoja
-- ============================================
UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '110505'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE modulo = 'Movimiento' AND concepto = 'Caja';
UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '111005'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE modulo = 'Movimiento' AND concepto = 'Banco';
UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '130505'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE modulo = 'RecibosDetalle' AND concepto = 'AplicacionSaldoFavor';
UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '130505'), fecha_actualizacion = CURRENT_TIMESTAMP WHERE modulo = 'RecibosDetalle' AND concepto = 'AbonoSaldoFavor';

-- ============================================
-- 4. Configuración y responsable de Caja Menor
-- ============================================
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('caja_menor_activa', 'false', 'Si está en "true", habilita el selector de Caja Menor en Gastos y la tarjeta de Caja Menor en la pantalla de Caja.'),
  ('caja_menor_saldo_objetivo', '0', 'Monto al que se repone la Caja Menor al reembolsar. Editable libremente, no es un fondo fijo inmutable.');

CREATE TABLE caja_menor_responsables (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tercero_id     INTEGER NOT NULL REFERENCES terceros(id),
  fecha_inicio   DATE NOT NULL,
  fecha_fin      DATE,              -- NULL = responsable actual
  observaciones  TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_caja_menor_responsables_actual ON caja_menor_responsables(fecha_fin);

-- ============================================
-- 5. Columna de Gastos para saber de cuál caja salió el efectivo
-- ============================================
ALTER TABLE gastos ADD COLUMN caja_efectivo_id INTEGER REFERENCES plan_cuentas(id);

-- ============================================
-- 6. Versionar GASTO_EFECTIVO a v2: la línea de crédito deja de ser la automática CAJA fija y
-- pasa a resolverse desde gastos.caja_efectivo_id (ya completado en Caja General o Caja Menor
-- al crear el gasto). v1 se cierra (fecha_hasta) y sigue vigente para fechas anteriores a hoy.
-- ============================================
UPDATE plantillas_contabilizacion
SET fecha_hasta = date('now', '-1 day'), fecha_actualizacion = CURRENT_TIMESTAMP
WHERE codigo = 'GASTO_EFECTIVO' AND version = 1 AND fecha_hasta IS NULL;

INSERT INTO plantillas_contabilizacion (codigo, version, nombre, descripcion, modulo, subtipo, fecha_desde, activo, es_sistema) VALUES
  ('GASTO_EFECTIVO', 2, 'Gasto pagado en Efectivo (Caja General o Caja Menor)', 'Débito a cuenta de gasto, crédito a la subcuenta de efectivo elegida al registrar el gasto', 'Gasto', 'Efectivo', date('now'), 1, 1);

INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_contexto_campo, tipo_monto, monto_campo, lado, incluir_tercero_id, incluir_snapshot_nombre, descripcion_linea)
  VALUES ((SELECT id FROM plantillas_contabilizacion WHERE codigo = 'GASTO_EFECTIVO' AND version = 2), 1, 'cuenta_contable_id', 'Campo', 'valor', 'Debito', 1, 1, 'Cuenta del tipo de gasto');
INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_contexto_campo, tipo_monto, monto_campo, lado, descripcion_linea)
  VALUES ((SELECT id FROM plantillas_contabilizacion WHERE codigo = 'GASTO_EFECTIVO' AND version = 2), 2, 'caja_efectivo_id', 'Campo', 'valor', 'Credito', 'Salida de Caja General o Caja Menor');
