-- Corrige un caso real encontrado en auditoría: 4 gastos se registraron con tipo_gasto
-- "Accesorios" (texto libre, de antes de que la lista se cerrara en la migración 015, que dejó
-- el concepto como "Accesorios y Materiales"). Como "Accesorios" no calza exacto con ningún
-- concepto del mapeo, cayeron en silencio en el "__default__" del módulo Gasto (cuenta 519599,
-- Otros Gastos Diversos) en vez de en 143005 (Materiales y Accesorios de Acueducto) — exactamente
-- el problema que motivó cerrar la lista.

-- 1. Corrige las líneas contables YA generadas (el asiento se generó en su momento con la cuenta
-- resuelta entonces; corregir solo la fila de gastos no alcanza, el Libro Mayor y el Balance de
-- Prueba seguirían mostrando el monto en la cuenta equivocada).
UPDATE movimientos_contables
SET cuenta_id = (SELECT id FROM plan_cuentas WHERE codigo = '143005')
WHERE cuenta_id = (SELECT id FROM plan_cuentas WHERE codigo = '519599')
  AND asiento_id IN (
    SELECT a.id FROM asientos_contables a
    INNER JOIN gastos g ON g.id = a.referencia_id AND a.tipo_origen = 'Gasto'
    WHERE g.tipo_gasto = 'Accesorios'
  );

-- 2. Corrige los gastos mismos: tipo_gasto al nombre real del concepto ya existente en el mapeo,
-- y la cuenta contable correspondiente.
UPDATE gastos
SET tipo_gasto = 'Accesorios y Materiales',
    cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '143005')
WHERE tipo_gasto = 'Accesorios';
