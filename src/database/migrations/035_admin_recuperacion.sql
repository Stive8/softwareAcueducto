-- src/database/migrations/035_admin_recuperacion.sql
-- Cuenta de Administrador de recuperación: inmutable desde la app (ver AuthService), para que
-- el cliente nunca quede sin ningún acceso Administrador aunque desactive o pierda el resto de
-- sus cuentas. La contraseña real se genera al azar en el primer arranque posterior a esta
-- migración (AuthService.generarCredencialRecuperacionSiHaceFalta) y se muestra una única vez;
-- el valor de abajo es solo un marcador que nunca funciona como contraseña real.
ALTER TABLE usuarios ADD COLUMN es_recuperacion INTEGER NOT NULL DEFAULT 0;

INSERT INTO usuarios (usuario, password, nombre_completo, rol, es_recuperacion)
VALUES ('recuperacion', '__PENDIENTE_GENERAR__', 'Cuenta de Recuperación', 'Administrador', 1);
