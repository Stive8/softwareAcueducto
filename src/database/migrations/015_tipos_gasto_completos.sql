-- Completa el mapeo de tipos de gasto: el campo "Tipo de Gasto" del formulario va a dejar de
-- ser texto libre (donde escribir "Accesorio" en vez de "Insumos" caía silenciosamente en
-- "Gastos Diversos" sin avisar) para ser una lista cerrada tomada de mapeo_conceptos_contables.
-- Antes de eso, hay que dejar esa lista completa y correcta.

-- Cuentas que faltaban para clasificar gastos que ya ocurren en la práctica pero no tenían
-- dónde caer (bono anual a un empleado, alquiler de maquinaria).
INSERT INTO plan_cuentas (codigo, nombre, tipo, naturaleza, nivel, padre_id) VALUES
  ('510540', 'Bonificaciones', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5105')),
  ('5120', 'Arrendamientos', 'Gasto', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '51')),
  ('512005', 'Arrendamiento de Maquinaria y Equipo', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5120'));

-- "Administración" no aportaba ninguna clasificación distinta de la regla por defecto (las dos
-- apuntaban a Gastos Diversos). "Servicios" apuntaba SOLO a Energía Eléctrica, ignorando que
-- Internet y Telefonía ya existen como cuentas separadas. "Insumos" se renombra a algo más
-- intuitivo para quien registra el gasto (se cambia la entrada, no la cuenta).
DELETE FROM mapeo_conceptos_contables WHERE modulo = 'Gasto' AND concepto IN ('Administración', 'Servicios', 'Insumos');

INSERT INTO mapeo_conceptos_contables (modulo, concepto, cuenta_contable_id) VALUES
  ('Gasto', 'Accesorios y Materiales', (SELECT id FROM plan_cuentas WHERE codigo = '143005')),
  ('Gasto', 'Honorarios', (SELECT id FROM plan_cuentas WHERE codigo = '5110')),
  ('Gasto', 'Impuestos', (SELECT id FROM plan_cuentas WHERE codigo = '5115')),
  ('Gasto', 'Energía Eléctrica', (SELECT id FROM plan_cuentas WHERE codigo = '513525')),
  ('Gasto', 'Internet', (SELECT id FROM plan_cuentas WHERE codigo = '513535')),
  ('Gasto', 'Telefonía', (SELECT id FROM plan_cuentas WHERE codigo = '513540')),
  ('Gasto', 'Papelería', (SELECT id FROM plan_cuentas WHERE codigo = '519505')),
  ('Gasto', 'Mobiliario y Equipo de Oficina', (SELECT id FROM plan_cuentas WHERE codigo = '1528')),
  ('Gasto', 'Equipo de Cómputo', (SELECT id FROM plan_cuentas WHERE codigo = '1532')),
  ('Gasto', 'Bonificaciones', (SELECT id FROM plan_cuentas WHERE codigo = '510540')),
  ('Gasto', 'Arrendamiento de Maquinaria', (SELECT id FROM plan_cuentas WHERE codigo = '512005'));
