-- src/database/migrations/031_reconciliar_movimientos_caja_agrupacion.sql
--
-- Corrige el hallazgo Crítico C-1 de la auditoría de Contabilidad (2026-07-03): la migración 029
-- dividió la cuenta '1105' Caja (que hasta entonces era una hoja imputable) en '110505' Caja
-- General y '110510' Caja Menor, y repuntó la cuenta automática CAJA hacia adelante, pero nunca
-- reescribió los movimientos_contables que ya habían quedado posteados contra '1105'. Desde ese
-- momento '1105' es una cuenta de agrupación (tiene hijas), y el propio sistema ya no permite
-- postear contra ella (ver AsientoContableService.crear(), validación tieneHijos) — pero los
-- movimientos históricos seguían ahí, invisibles para el Libro Mayor de "Caja General" y
-- mostrados como una fila fantasma en el Balance de Prueba.
--
-- Sigue el mismo patrón ya usado con éxito en la migración 016 (reclasificación de gastos):
-- reasignar movimientos_contables ya contabilizados con un UPDATE directo, documentado y
-- acotado por WHERE. Todo movimiento contra '1105' es anterior a que existiera Caja Menor
-- (que solo nace en la migración 029), así que reasignar el 100% a Caja General es correcto:
-- no hubo forma de que un movimiento contra '1105' fuera "en realidad" de Caja Menor.
--
-- Es idempotente: tras la primera ejecución, el WHERE no vuelve a encontrar filas.
UPDATE movimientos_contables
SET cuenta_id = (SELECT id FROM plan_cuentas WHERE codigo = '110505')
WHERE cuenta_id = (SELECT id FROM plan_cuentas WHERE codigo = '1105');
