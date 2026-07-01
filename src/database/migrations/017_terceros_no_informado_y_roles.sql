-- terceros necesita: (a) permitir 'No informado' en tipo_identificacion, (b) volver
-- numero_identificacion nullable (hoy NOT NULL UNIQUE), (c) agregar banderas de rol nuevas,
-- (d) agregar es_sistema para proteger un registro permanente. SQLite no permite modificar un
-- CHECK ni quitar NOT NULL con ALTER TABLE, así que se recrea la tabla siguiendo el
-- procedimiento oficial de SQLite (https://www.sqlite.org/lang_altertable.html, sección "Making
-- Other Kinds Of Table Schema Changes"): desactivar foreign_keys, crear la tabla nueva, copiar,
-- dropear la vieja, renombrar, reactivar foreign_keys.
PRAGMA foreign_keys = OFF;

CREATE TABLE terceros_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_identificacion TEXT NOT NULL CHECK(tipo_identificacion IN ('Cédula de Ciudadanía', 'NIT', 'Cédula de Extranjería', 'Pasaporte', 'Registro Civil', 'Otro', 'No informado')),
  numero_identificacion TEXT UNIQUE,
  nombre_razon_social TEXT NOT NULL,
  nombre_comercial TEXT,
  telefono TEXT,
  email TEXT,
  direccion TEXT,
  observaciones TEXT,
  es_proveedor INTEGER NOT NULL DEFAULT 1,
  es_otro INTEGER NOT NULL DEFAULT 0,
  es_contratista INTEGER NOT NULL DEFAULT 0,
  es_aliado INTEGER NOT NULL DEFAULT 0,
  es_cliente INTEGER NOT NULL DEFAULT 0,
  es_empleado INTEGER NOT NULL DEFAULT 0,
  es_entidad_publica INTEGER NOT NULL DEFAULT 0,
  es_sistema INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO terceros_nueva (id, tipo_identificacion, numero_identificacion, nombre_razon_social, nombre_comercial, telefono, email, direccion, observaciones, es_proveedor, es_otro, activo, fecha_creacion)
  SELECT id, tipo_identificacion, numero_identificacion, nombre_razon_social, nombre_comercial, telefono, email, direccion, observaciones, es_proveedor, es_otro, activo, fecha_creacion FROM terceros;

DROP TABLE terceros;
ALTER TABLE terceros_nueva RENAME TO terceros;

CREATE INDEX idx_terceros_numero_identificacion ON terceros(numero_identificacion);
CREATE INDEX idx_terceros_nombre ON terceros(nombre_razon_social);

PRAGMA foreign_keys = ON;

-- Tercero permanente del sistema: se usa cuando de verdad no hay forma de identificar a la
-- contraparte de un gasto, en vez de inventar un NIT o crear un proveedor con datos ficticios.
-- es_sistema=1 lo protege de edición/desactivación (ver TerceroService) y nunca se vuelve a
-- escribir desde TerceroRepository.create()/update(), así que no puede duplicarse ni alterarse
-- desde la app.
INSERT INTO terceros (tipo_identificacion, numero_identificacion, nombre_razon_social, es_otro, es_sistema, activo)
  VALUES ('No informado', NULL, 'Tercero no identificado', 1, 1, 1);
