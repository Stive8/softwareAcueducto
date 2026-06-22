-- 001_create_initial_tables.sql
-- Migración inicial: estructura completa del sistema
-- LÓGICA: La CUENTA es el centro, propietarios y categorías cambian en el tiempo

-- ============================================
-- MÓDULO: CONFIGURACIÓN
-- ============================================
CREATE TABLE configuracion (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  descripcion TEXT,
  fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- MÓDULO: CUENTAS/PREDIOS (ENTIDAD PRINCIPAL)
-- ============================================
-- La cuenta es permanente, categoría y propietario cambian en el tiempo
CREATE TABLE cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  direccion TEXT NOT NULL,
  estado TEXT DEFAULT 'Activo' CHECK(estado IN ('Activo', 'Inactivo', 'Suspendido')),
  observaciones TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cuentas_codigo ON cuentas(codigo);
CREATE INDEX idx_cuentas_estado ON cuentas(estado);

-- ============================================
-- MÓDULO: PROPIETARIOS
-- ============================================
CREATE TABLE propietarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_completo TEXT NOT NULL,
  numero_identificacion TEXT,
  telefono TEXT,
  email TEXT,
  observaciones TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_propietarios_identificacion ON propietarios(numero_identificacion);

-- Historial de propietarios por cuenta (NUNCA eliminar)
CREATE TABLE cuenta_propietarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  propietario_id INTEGER NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  observaciones TEXT,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
  FOREIGN KEY (propietario_id) REFERENCES propietarios(id)
);

CREATE INDEX idx_cuenta_propietarios_cuenta ON cuenta_propietarios(cuenta_id);
CREATE INDEX idx_cuenta_propietarios_actual ON cuenta_propietarios(cuenta_id, fecha_fin);

-- ============================================
-- MÓDULO: CATEGORÍAS (CONFIGURABLES)
-- ============================================
CREATE TABLE categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  activo INTEGER DEFAULT 1,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Historial de tarifas por categoría (NUNCA sobrescribir)
CREATE TABLE categoria_tarifas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria_id INTEGER NOT NULL,
  tarifa_sostenimiento REAL NOT NULL,
  fecha_vigencia_desde DATE NOT NULL,
  fecha_vigencia_hasta DATE,
  observaciones TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);

CREATE INDEX idx_categoria_tarifas_vigencia ON categoria_tarifas(categoria_id, fecha_vigencia_desde, fecha_vigencia_hasta);

-- Historial de categorías por cuenta (NUNCA sobrescribir)
CREATE TABLE cuenta_categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  categoria_id INTEGER NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  observaciones TEXT,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
  FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);

CREATE INDEX idx_cuenta_categorias_cuenta ON cuenta_categorias(cuenta_id);
CREATE INDEX idx_cuenta_categorias_actual ON cuenta_categorias(cuenta_id, fecha_fin);

-- ============================================
-- MÓDULO: RECIBOS Y PAGOS
-- ============================================
-- Recibos con consecutivo global
CREATE TABLE recibos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_recibo INTEGER NOT NULL UNIQUE,
  cuenta_id INTEGER NOT NULL,
  propietario_id INTEGER NOT NULL,
  fecha_recibo DATE NOT NULL,
  total REAL NOT NULL,
  metodo_pago TEXT CHECK(metodo_pago IN ('Efectivo', 'Transferencia', 'Consignacion')),
  observaciones TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
  FOREIGN KEY (propietario_id) REFERENCES propietarios(id)
);

CREATE INDEX idx_recibos_numero ON recibos(numero_recibo);
CREATE INDEX idx_recibos_cuenta ON recibos(cuenta_id);
CREATE INDEX idx_recibos_fecha ON recibos(fecha_recibo);

-- Detalle de recibos (múltiples conceptos por recibo)
CREATE TABLE recibo_detalles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recibo_id INTEGER NOT NULL,
  concepto TEXT NOT NULL,
  periodo_desde TEXT,
  periodo_hasta TEXT,
  valor REAL NOT NULL,
  observaciones TEXT,
  FOREIGN KEY (recibo_id) REFERENCES recibos(id)
);

CREATE INDEX idx_recibo_detalles_recibo ON recibo_detalles(recibo_id);

-- ============================================
-- MÓDULO: NUEVOS PUNTOS
-- ============================================
CREATE TABLE nuevos_puntos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  valor_total REAL NOT NULL,
  saldo_pendiente REAL NOT NULL,
  fecha_registro DATE NOT NULL,
  estado TEXT DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente', 'Pagado', 'Cancelado')),
  observaciones TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id)
);

CREATE INDEX idx_nuevos_puntos_cuenta ON nuevos_puntos(cuenta_id);
CREATE INDEX idx_nuevos_puntos_estado ON nuevos_puntos(estado);

-- Historial de abonos a nuevos puntos
CREATE TABLE nuevo_punto_abonos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nuevo_punto_id INTEGER NOT NULL,
  recibo_detalle_id INTEGER,
  monto REAL NOT NULL,
  fecha_abono DATE NOT NULL,
  observaciones TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (nuevo_punto_id) REFERENCES nuevos_puntos(id),
  FOREIGN KEY (recibo_detalle_id) REFERENCES recibo_detalles(id)
);

CREATE INDEX idx_nuevo_punto_abonos_punto ON nuevo_punto_abonos(nuevo_punto_id);

-- ============================================
-- MÓDULO: GASTOS
-- ============================================
CREATE TABLE gastos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha_gasto DATE NOT NULL,
  concepto TEXT NOT NULL,
  tipo_gasto TEXT,
  proveedor TEXT,
  nit_cedula TEXT,
  valor REAL NOT NULL,
  metodo_pago TEXT CHECK(metodo_pago IN ('Efectivo', 'Transferencia', 'Consignacion')),
  observaciones TEXT,
  ruta_soporte TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_gastos_fecha ON gastos(fecha_gasto);
CREATE INDEX idx_gastos_tipo ON gastos(tipo_gasto);

-- ============================================
-- MÓDULO: CAJA Y BANCOS
-- ============================================
CREATE TABLE movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('Ingreso', 'Egreso', 'Traslado')),
  origen TEXT NOT NULL CHECK(origen IN ('Caja', 'Banco')),
  destino TEXT CHECK(destino IN ('Caja', 'Banco')),
  monto REAL NOT NULL,
  concepto TEXT NOT NULL,
  referencia_id INTEGER,
  referencia_tipo TEXT,
  fecha_movimiento DATE NOT NULL,
  observaciones TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_movimientos_fecha ON movimientos(fecha_movimiento);
CREATE INDEX idx_movimientos_origen ON movimientos(origen);
CREATE INDEX idx_movimientos_referencia ON movimientos(referencia_tipo, referencia_id);

-- ============================================
-- MÓDULO: CONTABILIDAD SIMPLIFICADA
-- ============================================
CREATE TABLE plan_cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT CHECK(tipo IN ('Activo', 'Pasivo', 'Patrimonio', 'Ingreso', 'Gasto')),
  nivel INTEGER NOT NULL,
  padre_id INTEGER,
  activo INTEGER DEFAULT 1,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (padre_id) REFERENCES plan_cuentas(id)
);

CREATE INDEX idx_plan_cuentas_codigo ON plan_cuentas(codigo);
CREATE INDEX idx_plan_cuentas_tipo ON plan_cuentas(tipo);

-- Movimientos contables automáticos
CREATE TABLE movimientos_contables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha DATE NOT NULL,
  cuenta_id INTEGER NOT NULL,
  debito REAL DEFAULT 0,
  credito REAL DEFAULT 0,
  concepto TEXT NOT NULL,
  referencia_id INTEGER,
  referencia_tipo TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES plan_cuentas(id)
);

CREATE INDEX idx_movimientos_contables_fecha ON movimientos_contables(fecha);
CREATE INDEX idx_movimientos_contables_cuenta ON movimientos_contables(cuenta_id);
CREATE INDEX idx_movimientos_contables_referencia ON movimientos_contables(referencia_tipo, referencia_id);

-- ============================================
-- MÓDULO: SEGURIDAD Y AUDITORÍA
-- ============================================
CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  nombre_completo TEXT NOT NULL,
  rol TEXT DEFAULT 'Usuario' CHECK(rol IN ('Administrador', 'Usuario', 'Consulta')),
  activo INTEGER DEFAULT 1,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  fecha_ultimo_acceso DATETIME
);

-- Auditoría básica
CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  accion TEXT NOT NULL,
  tabla TEXT NOT NULL,
  registro_id INTEGER,
  datos_anteriores TEXT,
  datos_nuevos TEXT,
  fecha_accion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE INDEX idx_auditoria_fecha ON auditoria(fecha_accion);
CREATE INDEX idx_auditoria_tabla ON auditoria(tabla, registro_id);

-- ============================================
-- DATOS INICIALES
-- ============================================

-- Configuración general
INSERT INTO configuracion (clave, valor, descripcion) VALUES 
  ('nombre_asociacion', 'Asociación de Usuarios de Acueducto El Salitere, El Rodeo, El Cural', 'Nombre de la asociación'),
  ('nit', '', 'NIT de la asociación'),
  ('direccion', '', 'Dirección de la asociación'),
  ('telefono', '', 'Teléfono de contacto'),
  ('email', '', 'Correo electrónico'),
  ('consecutivo_recibos', '1', 'Próximo número de recibo'),
  ('valor_nuevo_punto', '500000', 'Valor por defecto de nuevos puntos'),
  ('saldo_caja_inicial', '0', 'Saldo inicial en caja'),
  ('saldo_banco_inicial', '0', 'Saldo inicial en banco');

-- Categorías predeterminadas
INSERT INTO categorias (nombre, descripcion) VALUES 
  ('Finca', 'Finca residencial'),
  ('Finca con piscina', 'Finca con piscina'),
  ('Tienda', 'Establecimiento comercial'),
  ('Finca para alquiler', 'Finca destinada a alquiler turístico');

-- Tarifas iniciales para cada categoría (año actual)
INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde) VALUES 
  (1, 10000, date('now', 'start of year')),
  (2, 16000, date('now', 'start of year')),
  (3, 20000, date('now', 'start of year')),
  (4, 50000, date('now', 'start of year'));

-- Plan de cuentas básico
INSERT INTO plan_cuentas (codigo, nombre, tipo, nivel) VALUES 
  ('1', 'ACTIVO', 'Activo', 1),
  ('1105', 'Caja', 'Activo', 2),
  ('1110', 'Bancos', 'Activo', 2),
  ('1305', 'Cuentas por cobrar', 'Activo', 2),
  ('4', 'INGRESOS', 'Ingreso', 1),
  ('4135', 'Ingresos sostenimiento', 'Ingreso', 2),
  ('4140', 'Nuevos puntos', 'Ingreso', 2),
  ('5', 'GASTOS', 'Gasto', 1),
  ('5135', 'Gastos administración', 'Gasto', 2),
  ('5140', 'Gastos fontanero', 'Gasto', 2),
  ('5150', 'Gastos mantenimiento', 'Gasto', 2);

-- Usuario administrador por defecto (password: admin123)
INSERT INTO usuarios (usuario, password, nombre_completo, rol) VALUES 
  ('admin', 'admin123', 'Administrador del Sistema', 'Administrador');
