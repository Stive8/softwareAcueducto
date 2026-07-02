-- 028_ampliar_mantenimiento_y_gastos_diversos.sql
-- Nuevas subcuentas para clasificar mejor los gastos de mantenimiento (mano de obra ocasional,
-- limpieza y desinfección, preventivo vs. correctivo) y gastos diversos frecuentes (ferretería
-- menor, refrigerios, representación) que hasta ahora caían en cuentas genéricas.
INSERT INTO plan_cuentas (codigo, nombre, tipo, naturaleza, nivel, padre_id) VALUES
  ('514525', 'Mano de Obra Ocasional', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5145')),
  ('514530', 'Limpieza y Desinfección', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5145')),
  ('514535', 'Mantenimiento Preventivo', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5145')),
  ('514540', 'Mantenimiento Correctivo', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5145')),
  ('519520', 'Elementos de Ferretería Menor', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5195')),
  ('519525', 'Refrigerios', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5195')),
  ('519530', 'Gastos de Representación', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5195'));

-- Para que aparezcan como opción en el desplegable "Tipo de Gasto" del formulario de gastos
-- (gastos.js lee mapeo_conceptos_contables donde modulo='Gasto'), cada cuenta nueva necesita su
-- propia fila de mapeo.
INSERT INTO mapeo_conceptos_contables (modulo, concepto, cuenta_contable_id) VALUES
  ('Gasto', 'Mano de Obra Ocasional', (SELECT id FROM plan_cuentas WHERE codigo = '514525')),
  ('Gasto', 'Limpieza y Desinfección', (SELECT id FROM plan_cuentas WHERE codigo = '514530')),
  ('Gasto', 'Mantenimiento Preventivo', (SELECT id FROM plan_cuentas WHERE codigo = '514535')),
  ('Gasto', 'Mantenimiento Correctivo', (SELECT id FROM plan_cuentas WHERE codigo = '514540')),
  ('Gasto', 'Elementos de Ferretería Menor', (SELECT id FROM plan_cuentas WHERE codigo = '519520')),
  ('Gasto', 'Refrigerios', (SELECT id FROM plan_cuentas WHERE codigo = '519525')),
  ('Gasto', 'Gastos de Representación', (SELECT id FROM plan_cuentas WHERE codigo = '519530'));

-- Corrige un bug de 015_tipos_gasto_completos.sql: 5120 y 512005 se insertaron en el mismo
-- INSERT ... VALUES, así que la subconsulta que buscaba el id de 5120 para asignarlo como padre
-- de 512005 se ejecutó antes de que esa fila quedara confirmada y devolvió NULL. 512005 existe
-- pero queda huérfano y no se agrupa bajo "Arrendamientos" en reportes ni en la jerarquía.
UPDATE plan_cuentas
SET padre_id = (SELECT id FROM plan_cuentas WHERE codigo = '5120')
WHERE codigo = '512005' AND padre_id IS NULL;
