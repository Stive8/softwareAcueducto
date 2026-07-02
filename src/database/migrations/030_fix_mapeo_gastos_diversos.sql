-- 030_fix_mapeo_gastos_diversos.sql
-- El mapeo de conceptos 'Gasto' -> 'Gastos Diversos' apunta a 5195 (cuenta de agrupacion, tiene
-- subcuentas desde 006_plan_de_cuentas.sql), lo que hace fallar AsientoContableService.crear()
-- ("cuenta de agrupacion, no admite movimientos directos") al elegir "Gastos Diversos" como Tipo
-- de Gasto. Mismo bug que 029 corrigio para BANCO/CARTERA_USUARIOS/CAJA, en una fila que ese
-- fix no tocaba (modulo 'Gasto', no 'Movimiento'/'RecibosDetalle'). Se reasigna a 519599 "Otros
-- Gastos Diversos", el catch-all hoja que ya existe desde 006 y quedo reabierto como opcion
-- visible en 019_gastos_diversos_seleccionable.sql.
UPDATE mapeo_conceptos_contables
SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '519599'),
    fecha_actualizacion = CURRENT_TIMESTAMP
WHERE modulo = 'Gasto' AND concepto = 'Gastos Diversos';
