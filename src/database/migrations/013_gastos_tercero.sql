-- Enlaza cada gasto con el catálogo de Terceros en vez de depender solo del texto libre
-- proveedor/nit_cedula. Esos dos campos se quedan en la tabla como respaldo histórico (los
-- gastos ya registrados antes de este catálogo), pero los gastos nuevos ya no los vuelven a
-- escribir: usan tercero_id. Es opcional porque no todo gasto tiene un proveedor identificable
-- (compras pequeñas en efectivo sin soporte, por ejemplo).
ALTER TABLE gastos ADD COLUMN tercero_id INTEGER REFERENCES terceros(id);

CREATE INDEX idx_gastos_tercero ON gastos(tercero_id);
