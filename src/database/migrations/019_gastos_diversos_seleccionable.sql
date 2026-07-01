-- Reabre, a propósito, el catch-all que 015_tipos_gasto_completos.sql había excluido del
-- listado (quedó como '__default__', invisible para quien registra el gasto) — ahora vuelve a
-- ser una opción real y visible, pero con advertencia no bloqueante en el formulario al
-- elegirla (ver gastos.js) en vez de caer ahí en silencio.
INSERT INTO mapeo_conceptos_contables (modulo, concepto, cuenta_contable_id)
  VALUES ('Gasto', 'Gastos Diversos', (SELECT id FROM plan_cuentas WHERE codigo = '5195'));
