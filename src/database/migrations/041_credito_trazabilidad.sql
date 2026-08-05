-- 041_credito_trazabilidad.sql
-- El saldo a favor deja de restarse solo: un abono sin destino específico (o el sobrante de
-- uno que sí lo tiene) entra a cuenta_creditos como 'Abono' y ahí se queda hasta que alguien
-- lo redima explícitamente contra los meses de cartera pendientes. Al redimirlo se crea un
-- Abono real en cartera_movimientos y la fila de crédito pasa a 'Aplicado' -- esta columna
-- guarda a cuál, para poder ver desde el crédito qué meses cubrió (vía cartera_imputaciones).
ALTER TABLE cuenta_creditos ADD COLUMN abono_movimiento_id INTEGER;
