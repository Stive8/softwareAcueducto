-- 009_respaldo_nube.sql
-- Configuración para el respaldo en la nube (Google Drive). Estado por-equipo: el nombre del
-- equipo, la secuencia local (para detectar conflictos entre equipos) y la fecha del último
-- respaldo subido con éxito (para la alerta de "lleva mucho sin respaldar" del Dashboard).

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('respaldo_nube_nombre_equipo', '', 'Nombre identificador de este equipo para los respaldos en la nube'),
  ('respaldo_nube_secuencia_local', '0', 'Contador local de respaldos subidos por este equipo, usado para detectar conflictos'),
  ('respaldo_nube_dias_retencion', '30', 'Días de respaldos diarios a conservar en la nube antes de pasar a solo uno por mes'),
  ('respaldo_nube_ultima_fecha_exitosa', '', 'Fecha/hora del último respaldo subido con éxito a la nube');
