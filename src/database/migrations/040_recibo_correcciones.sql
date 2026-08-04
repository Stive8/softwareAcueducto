-- 040_recibo_correcciones.sql
-- Edición de recibos ya cargados (sección 13.2 de REGLAS_CARGA_INICIAL.md) sin romper la regla
-- 3 ("el recibo se guarda literal e inmutable"): recibos.numero_recibo/fecha_recibo y
-- recibo_detalles.concepto/valor NUNCA se sobrescriben. Cada corrección queda como una fila
-- aparte con el valor anterior, el valor nuevo, el motivo y quién la hizo; el "valor vigente"
-- de un campo es el de su última corrección, y el original queda siempre consultable en la
-- tabla base. Mismo patrón que fecha_correccion_pago/motivo_correccion_pago (020), pero
-- generalizado a varios campos y con historial completo en vez de solo el último cambio.
CREATE TABLE recibo_correcciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recibo_id INTEGER NOT NULL,
  recibo_detalle_id INTEGER,   -- NULL para campos de `recibos`; obligatorio para los de `recibo_detalles`
  campo TEXT NOT NULL CHECK(campo IN ('numero_recibo', 'fecha_recibo', 'concepto', 'valor')),
  valor_anterior TEXT,
  valor_nuevo TEXT NOT NULL,
  motivo TEXT NOT NULL,
  usuario_id INTEGER,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recibo_id) REFERENCES recibos(id),
  FOREIGN KEY (recibo_detalle_id) REFERENCES recibo_detalles(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE INDEX idx_recibo_correcciones_recibo ON recibo_correcciones(recibo_id);
CREATE INDEX idx_recibo_correcciones_detalle ON recibo_correcciones(recibo_detalle_id);
