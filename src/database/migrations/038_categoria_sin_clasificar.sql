-- 038_categoria_sin_clasificar.sql
-- La categoría 'Sin clasificar' ya existe en la base real de producción (creada por fuera de las
-- migraciones, antes de este trabajo) como categoría temporal para cuentas que aún no tienen
-- categoría asignada. Se agrega aquí como migración nueva -- nunca se edita 001, ya aplicada --
-- para que las instalaciones nuevas del sistema queden con el mismo catálogo que la real.

INSERT INTO categorias (nombre, descripcion) VALUES
  ('Sin clasificar', 'Categoría temporal para cuentas sin clasificar');
