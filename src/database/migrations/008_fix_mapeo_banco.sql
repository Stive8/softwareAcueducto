-- 008_fix_mapeo_banco.sql
-- Varios mapeos de conceptos contables sembrados en la migración 006 apuntaban a cuentas de
-- agrupación (cuentas que tienen subcuentas), que no admiten movimientos directos. Se corrigen
-- para que apunten a una subcuenta imputable. Se agrega además una subcuenta "Otros Gastos
-- Diversos" como verdadero catch-all imputable bajo Gastos Diversos (5195).

INSERT INTO plan_cuentas (codigo, nombre, tipo, naturaleza, nivel, padre_id) VALUES
  ('519599', 'Otros Gastos Diversos', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5195'));

UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '111005')
WHERE modulo = 'Movimiento' AND concepto = 'Banco';

UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '130505')
WHERE modulo = 'RecibosDetalle' AND concepto IN ('AplicacionSaldoFavor', 'AbonoSaldoFavor');

UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '519599')
WHERE modulo = 'Gasto' AND concepto IN ('Administración', '__default__');

UPDATE mapeo_conceptos_contables SET cuenta_contable_id = (SELECT id FROM plan_cuentas WHERE codigo = '510506')
WHERE modulo = 'Gasto' AND concepto = 'Nómina';
