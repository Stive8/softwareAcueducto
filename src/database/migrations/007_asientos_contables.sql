-- 007_asientos_contables.sql
-- Asientos contables y lógica de débito/crédito (contabilidad de doble partida).
--
-- Cada asiento agrupa 2 o más líneas en movimientos_contables (la tabla ya existía desde 001,
-- pensada justo para esto) cuya suma de débitos siempre es igual a la suma de créditos. Los
-- asientos se generan automáticamente a partir de gastos, recibos (sostenimiento, abono a
-- conexión) y traslados de caja a banco, reutilizando la cuenta_contable_id que cada uno ya
-- tenía resuelta desde la migración 006. También se pueden crear asientos manuales (ajustes).
--
-- Como en el resto del sistema, nada se borra ni se modifica después de creado: anular un
-- asiento no lo borra, genera un asiento de reversión con las líneas invertidas y enlaza ambos.

CREATE TABLE asientos_contables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero INTEGER NOT NULL UNIQUE,
  fecha DATE NOT NULL,
  concepto TEXT NOT NULL,
  -- Origen del asiento: 'Gasto', 'Recibo', 'Movimiento' (traslados caja/banco), 'Manual'
  -- (ajustes financieros registrados a mano), 'Reversion' (generado al anular otro asiento).
  tipo_origen TEXT NOT NULL CHECK(tipo_origen IN ('Gasto', 'Recibo', 'Movimiento', 'Manual', 'Reversion')),
  referencia_id INTEGER,
  referencia_tipo TEXT,
  estado TEXT NOT NULL DEFAULT 'Activo' CHECK(estado IN ('Activo', 'Anulado')),
  asiento_reversion_id INTEGER REFERENCES asientos_contables(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  fecha_anulacion DATETIME,
  motivo_anulacion TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_asientos_contables_fecha ON asientos_contables(fecha);
CREATE INDEX idx_asientos_contables_referencia ON asientos_contables(referencia_tipo, referencia_id);
CREATE INDEX idx_asientos_contables_estado ON asientos_contables(estado);

ALTER TABLE movimientos_contables ADD COLUMN asiento_id INTEGER REFERENCES asientos_contables(id);
CREATE INDEX idx_movimientos_contables_asiento ON movimientos_contables(asiento_id);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('consecutivo_asientos', '1', 'Próximo número de asiento contable');
