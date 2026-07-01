-- Datos institucionales que faltaban para el encabezado del motor de plantillas de reportes
-- (ver PlantillaReporteService.js). logo_path solo guarda el NOMBRE del archivo (ej. 'logo.png'),
-- nunca una ruta absoluta: el archivo vive en userData (ver config:subirLogo en main.js), cuya
-- ubicación cambia entre equipos/instalaciones, así que la ruta completa se reconstruye en cada
-- lectura en vez de persistirse.
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('ciudad', '', 'Ciudad de la asociación'),
  ('logo_path', '', 'Nombre del archivo de logo guardado localmente (vacío = sin logo)');
