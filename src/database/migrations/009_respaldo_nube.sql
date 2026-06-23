-- 009_respaldo_nube.sql
-- Configuración compartida del respaldo en la nube (Google Drive). Solo la política de
-- retención vive aquí, porque es una decisión de la asociación, no de un equipo en particular.
-- El nombre de equipo, la secuencia local y la fecha del último respaldo exitoso son datos
-- PROPIOS de este equipo (no deben viajar dentro del .db que se sube/descarga de la nube, o un
-- "Actualizar desde la nube" los resetearía sin sentido); esos viven en un archivo local aparte,
-- ver CloudBackupOrchestratorService.

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('respaldo_nube_dias_retencion', '30', 'Días de respaldos diarios a conservar en la nube antes de pasar a solo uno por mes');
