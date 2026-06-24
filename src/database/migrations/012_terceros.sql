-- Catálogo de Terceros (proveedores y otros aliados con los que interactúa la asociación: no
-- incluye clientes, esos ya están bien cubiertos por Propietarios y no se tocan aquí). Existe
-- para no repetir el nombre/identificación de un mismo proveedor como texto libre cada vez que
-- se registra un gasto (lo que hoy pasa en gastos.proveedor/nit_cedula).
--
-- es_proveedor / es_otro son dos banderas independientes (no un único "tipo"), porque un mismo
-- tercero puede tener varias características a la vez (ej. ser proveedor y además un aliado al
-- que se le hacen otro tipo de pagos).
CREATE TABLE terceros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_identificacion TEXT NOT NULL CHECK(tipo_identificacion IN ('Cédula de Ciudadanía', 'NIT', 'Cédula de Extranjería', 'Pasaporte', 'Registro Civil', 'Otro')),
  numero_identificacion TEXT NOT NULL UNIQUE,
  nombre_razon_social TEXT NOT NULL,
  nombre_comercial TEXT,
  telefono TEXT,
  email TEXT,
  direccion TEXT,
  observaciones TEXT,
  es_proveedor INTEGER NOT NULL DEFAULT 1,
  es_otro INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_terceros_numero_identificacion ON terceros(numero_identificacion);
CREATE INDEX idx_terceros_nombre ON terceros(nombre_razon_social);
