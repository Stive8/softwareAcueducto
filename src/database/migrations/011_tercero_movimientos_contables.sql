-- Identificación y nombre del tercero (propietario o proveedor) asociado a una línea de
-- movimiento contable, para poder generar el Balance de Prueba por Tercero. Se guardan como
-- texto plano (no FK a propietarios/proveedores) porque los proveedores hoy son texto libre en
-- gastos, y porque conviene que el movimiento conserve el dato tal como era al momento del
-- registro, sin importar si el propietario/proveedor cambia de nombre después.
ALTER TABLE movimientos_contables ADD COLUMN tercero_identificacion TEXT;
ALTER TABLE movimientos_contables ADD COLUMN tercero_nombre TEXT;

CREATE INDEX idx_movimientos_contables_tercero ON movimientos_contables(tercero_identificacion);
