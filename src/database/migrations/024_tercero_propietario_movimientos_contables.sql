-- Añade referencias FK a las entidades que generaron cada línea del asiento,
-- complementando los snapshots de texto ya existentes (tercero_identificacion, tercero_nombre).
-- El snapshot preserva la evidencia histórica inmutable; las FK permiten joins y reportes futuros
-- sin reconstruir el nombre de la entidad desde el texto plano.
--
-- Ambas columnas son nullables: los movimientos anteriores no tienen estos IDs y no deben
-- actualizarse retroactivamente (el snapshot es suficiente para la auditoría histórica).
-- Solo UNA de las dos FK estará poblada por línea:
--   tercero_id    → proveedor/acreedor (tabla terceros) — líneas generadas por gastos
--   propietario_id → usuario del servicio (tabla propietarios) — líneas generadas por recibos

ALTER TABLE movimientos_contables
  ADD COLUMN tercero_id INTEGER REFERENCES terceros(id);

ALTER TABLE movimientos_contables
  ADD COLUMN propietario_id INTEGER REFERENCES propietarios(id);

CREATE INDEX idx_mc_tercero_id     ON movimientos_contables (tercero_id)     WHERE tercero_id     IS NOT NULL;
CREATE INDEX idx_mc_propietario_id ON movimientos_contables (propietario_id) WHERE propietario_id IS NOT NULL;
