-- Coordenadas GPS de la cuenta: dos puntos porque la acometida (punto de conexión del agua) y
-- la vivienda a veces no coinciden dentro del mismo lote. Ambas parejas son opcionales; no todas
-- las cuentas van a tener este dato de inmediato.
ALTER TABLE cuentas ADD COLUMN lat_acometida REAL;
ALTER TABLE cuentas ADD COLUMN lon_acometida REAL;
ALTER TABLE cuentas ADD COLUMN lat_vivienda REAL;
ALTER TABLE cuentas ADD COLUMN lon_vivienda REAL;
