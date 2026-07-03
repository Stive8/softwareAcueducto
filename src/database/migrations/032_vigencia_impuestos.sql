-- Corrige el hallazgo Alto A-2 de la auditoría de Contabilidad (2026-07-03): la tabla
-- `impuestos` guardaba un único `porcentaje` mutable, así que editar una tasa afectaba también
-- la re-contabilización de documentos con fecha anterior al cambio. Se añade `fecha_vigencia_desde`
-- (aditivo, sin tocar la tabla existente) y una tabla de historial append-only con cada tramo de
-- vigencia anterior, para poder reconstruir qué tasa regía en cualquier fecha pasada.
ALTER TABLE impuestos ADD COLUMN fecha_vigencia_desde DATE NOT NULL DEFAULT '2000-01-01';

CREATE TABLE impuesto_historial_porcentaje (
  id             INTEGER  PRIMARY KEY AUTOINCREMENT,
  impuesto_id    INTEGER  NOT NULL REFERENCES impuestos(id),
  porcentaje     REAL     NOT NULL,
  fecha_desde    DATE     NOT NULL,
  fecha_hasta    DATE     NOT NULL,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_impuesto_historial_vigencia ON impuesto_historial_porcentaje(impuesto_id, fecha_desde, fecha_hasta);
