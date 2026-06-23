-- 010_limpiar_respaldo_nube_local.sql
-- La migración 009 original sembró por error 3 claves que en realidad son propias de cada
-- equipo (nombre, secuencia local, última fecha exitosa) dentro de la base de datos compartida,
-- lo que las hacía resetearse cada vez que se "Actualiza desde la nube". Se corrigió para que
-- esas 3 vivan en un archivo local aparte; aquí se limpian los restos de la versión anterior en
-- cualquier base de datos donde ya se hubiera ejecutado la 009 original.

DELETE FROM configuracion WHERE clave IN (
  'respaldo_nube_nombre_equipo', 'respaldo_nube_secuencia_local', 'respaldo_nube_ultima_fecha_exitosa'
);
