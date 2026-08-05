-- 042_tarifas_historicas.sql
-- categoria_tarifas nunca tuvo vigencias históricas: toda la causación de 2017-2025 se hizo
-- leyendo plan_causacion del JSON de carga inicial (paso9), no esta tabla. Es un hueco real,
-- también en producción -- sin esto, cualquier mes no causado todavía que caiga antes de 2026
-- se salta en calcularAPagar por falta de tarifa, y asegurarCausacion tampoco puede causar
-- retroactivamente desde agosto 2026 en adelante.
--
-- Vigencias validadas contra dos fuentes independientes: las 53 hojas individuales de CARTERA
-- y 1.285 recibos con período limpio (2026-08-05).

-- Elimina primero las filas "Modo de Pruebas" sembradas durante desarrollo: arrancan en
-- 2026-01-01 y chocarían (mismo rango, valores de prueba) con las vigencias reales de abajo.
DELETE FROM categoria_tarifas WHERE observaciones = 'Tarifa de ejemplo (Modo de Pruebas)';

-- Finca: piso 1900-01-01 antes de 2017 (no hay cuentas reales más antiguas), luego 2017, luego
-- el tramo 2018-2023 unificado con el resto de categorías, luego 2024 en adelante.
INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta, observaciones)
SELECT id, 1500, '1900-01-01', '2016-12-31',
  'Vigencia histórica validada contra 53 hojas de CARTERA y 1.285 recibos con período limpio (2026-08-05)'
FROM categorias WHERE nombre = 'Finca';

INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta, observaciones)
SELECT id, 3000, '2017-01-01', '2017-12-31',
  'Vigencia histórica validada contra 53 hojas de CARTERA y 1.285 recibos con período limpio (2026-08-05)'
FROM categorias WHERE nombre = 'Finca';

INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta, observaciones)
SELECT id, 5000, '2018-01-01', '2023-12-31',
  'Vigencia histórica validada contra 53 hojas de CARTERA y 1.285 recibos con período limpio (2026-08-05)'
FROM categorias WHERE nombre = 'Finca';

INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta, observaciones)
SELECT id, 10000, '2024-01-01', NULL,
  'Vigencia histórica validada contra 53 hojas de CARTERA y 1.285 recibos con período limpio (2026-08-05)'
FROM categorias WHERE nombre = 'Finca';

-- Finca con piscina: solo hay validación desde 2018. Antes de esa fecha queda sin cobertura
-- a propósito (no se inventa un valor sin fuente) -- calcularAPagar debe alertar si algún mes
-- anterior a 2018 la necesita.
INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta, observaciones)
SELECT id, 8000, '2018-01-01', '2023-12-31',
  'Vigencia histórica validada contra 53 hojas de CARTERA y 1.285 recibos con período limpio (2026-08-05)'
FROM categorias WHERE nombre = 'Finca con piscina';

INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta, observaciones)
SELECT id, 16000, '2024-01-01', NULL,
  'Vigencia histórica validada contra 53 hojas de CARTERA y 1.285 recibos con período limpio (2026-08-05)'
FROM categorias WHERE nombre = 'Finca con piscina';

-- Tienda (Comercial): mismo caso, solo desde 2018. OJO: el 20.000 de 2024+ coincide en monto
-- con Finca para alquiler 2018-2023 -- son categorías distintas, no un error de copiar/pegar.
INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta, observaciones)
SELECT id, 12000, '2018-01-01', '2023-12-31',
  'Vigencia histórica validada contra 53 hojas de CARTERA y 1.285 recibos con período limpio (2026-08-05)'
FROM categorias WHERE nombre = 'Tienda';

INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta, observaciones)
SELECT id, 20000, '2024-01-01', NULL,
  'Vigencia histórica validada contra 53 hojas de CARTERA y 1.285 recibos con período limpio (2026-08-05)'
FROM categorias WHERE nombre = 'Tienda';

-- Finca para alquiler: el tramo 2024+ (50.000) ya existe como fila real en este worktree,
-- sembrada fuera de migraciones antes de este trabajo -- pero no hay garantía de que exista
-- igual en toda instalación (ej. producción), así que se agrega con guarda NOT EXISTS en vez
-- de asumir que ya está. Sumado al tramo histórico 2018-2023 que sí falta en todos lados.
INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta, observaciones)
SELECT id, 20000, '2018-01-01', '2023-12-31',
  'Vigencia histórica validada contra 53 hojas de CARTERA y 1.285 recibos con período limpio (2026-08-05)'
FROM categorias WHERE nombre = 'Finca para alquiler';

INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta, observaciones)
SELECT c.id, 50000, '2024-01-01', NULL,
  'Vigencia histórica validada contra 53 hojas de CARTERA y 1.285 recibos con período limpio (2026-08-05)'
FROM categorias c
WHERE c.nombre = 'Finca para alquiler'
  AND NOT EXISTS (
    SELECT 1 FROM categoria_tarifas ct
    WHERE ct.categoria_id = c.id AND ct.fecha_vigencia_desde = '2024-01-01' AND ct.tarifa_sostenimiento = 50000
  );
