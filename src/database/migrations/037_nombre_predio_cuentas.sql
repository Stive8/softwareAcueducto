-- Agregar campo "Nombre de Predio" a la tabla cuentas
-- Campo opcional para identificar el nombre del predio/lote asociado a la cuenta
ALTER TABLE cuentas ADD COLUMN nombre_predio TEXT;
