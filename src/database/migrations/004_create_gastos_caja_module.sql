-- 004_create_gastos_caja_module.sql
-- Fase 4: Gastos (nunca se eliminan, solo se anulan) y Caja/Bancos
-- La tabla `movimientos` ya existía desde 001 y ya soporta Ingreso/Egreso/Traslado
-- entre Caja y Banco (origen/destino), por lo que no requiere cambios de esquema.

ALTER TABLE gastos ADD COLUMN estado TEXT DEFAULT 'Activo' CHECK(estado IN ('Activo', 'Anulado'));
ALTER TABLE gastos ADD COLUMN fecha_anulacion DATETIME;
ALTER TABLE gastos ADD COLUMN motivo_anulacion TEXT;

CREATE INDEX idx_gastos_estado ON gastos(estado);
CREATE INDEX idx_gastos_proveedor ON gastos(proveedor);
