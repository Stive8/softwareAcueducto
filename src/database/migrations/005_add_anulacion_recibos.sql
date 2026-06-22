-- 005_add_anulacion_recibos.sql
-- Igual que los gastos, los recibos nunca se eliminan, solo se anulan.
-- Anular un recibo libera los meses/abonos que cubría (para que se puedan volver a
-- cobrar) y revierte el efecto en caja/banco, pero conserva el recibo y su detalle
-- como constancia histórica de que existió y fue anulado.

ALTER TABLE recibos ADD COLUMN estado TEXT DEFAULT 'Activo' CHECK(estado IN ('Activo', 'Anulado'));
ALTER TABLE recibos ADD COLUMN fecha_anulacion DATETIME;
ALTER TABLE recibos ADD COLUMN motivo_anulacion TEXT;

CREATE INDEX idx_recibos_estado ON recibos(estado);

-- Recibos anulados del talonario físico (migración de historia en papel): un número de recibo
-- que se anuló ANTES de representar un cobro real (error de escritura, tachón, etc.), por lo que
-- nunca llegó a generar cuenta, valor ni movimiento de caja. Solo es una constancia del número y
-- el motivo, para no dejar huecos sin explicación en la numeración consecutiva.
CREATE TABLE recibos_anulados_fisicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_recibo INTEGER NOT NULL UNIQUE,
  fecha DATE,
  motivo TEXT NOT NULL,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);
