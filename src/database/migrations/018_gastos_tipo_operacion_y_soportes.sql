-- Distingue compra directa (el acueducto pagó directo al proveedor) de reembolso (alguien pagó
-- con su propio dinero y se le devolvió el valor). Sin CHECK, igual que el resto de columnas
-- agregadas vía ALTER TABLE en este proyecto (ver 013_gastos_tercero.sql): el valor se valida
-- en GastoService.create().
ALTER TABLE gastos ADD COLUMN tipo_operacion TEXT NOT NULL DEFAULT 'Compra directa';

-- Defensivo: hoy gastos solo tiene datos de prueba (se borran antes de producción), pero por si
-- alguna fila quedó con tercero_id NULL, se reasigna al tercero del sistema en vez de dejarla
-- huérfana ahora que el tercero es obligatorio (ver GastoService.create()).
UPDATE gastos SET tercero_id = (SELECT id FROM terceros WHERE es_sistema = 1) WHERE tercero_id IS NULL;

-- Uno o varios soportes documentales por gasto (factura electrónica, recibo simple, imagen del
-- comprobante, etc.), guardados en Google Drive — solo se almacena la referencia (drive_file_id)
-- y metadata, nunca el archivo binario en la base de datos. Tabla nueva sin datos que migrar,
-- así que el CHECK aquí sí es seguro de declarar directo.
CREATE TABLE gastos_soportes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gasto_id INTEGER NOT NULL REFERENCES gastos(id),
  tipo_soporte TEXT NOT NULL CHECK(tipo_soporte IN ('Factura electrónica', 'Factura física', 'Recibo simple', 'Comprobante interno', 'Imagen', 'PDF')),
  drive_file_id TEXT NOT NULL,
  nombre_archivo TEXT NOT NULL,
  fecha_adjuntado DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_gastos_soportes_gasto ON gastos_soportes(gasto_id);
