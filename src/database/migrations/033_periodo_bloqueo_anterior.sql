-- Corrige el hallazgo Alto A-3 de la auditoría de Contabilidad (2026-07-03): un mes sin ninguna
-- actividad previa se auto-creaba como período 'Abierto' la primera vez que se le intentaba
-- contabilizar algo, sin importar qué tan retroactiva fuera la fecha — el control de "período
-- cerrado" solo protegía meses que ya habían sido tocados y cerrados explícitamente. Esta clave,
-- vacía por defecto (sin restricción, igual que el comportamiento actual), permite a un
-- Administrador fijar una fecha límite: nada anterior a ella podrá contabilizarse jamás, exista
-- o no ya un período para ese mes.
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('periodo_bloqueo_anterior_a', '', 'Fecha (AAAA-MM-DD) antes de la cual no se permite registrar ni corregir ningún movimiento contable. Vacío = sin restricción.');
