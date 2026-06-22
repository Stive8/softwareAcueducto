-- 002_insert_sample_data.sql
-- Migración con datos de prueba alineados con la lógica real del negocio

-- ============================================
-- INSERTAR CUENTAS
-- ============================================
INSERT INTO cuentas (codigo, direccion, estado, observaciones) VALUES 
  ('001-A', 'Vereda El Porvenir, Casa Principal', 'Activo', 'Primera cuenta registrada'),
  ('002-B', 'Vereda El Porvenir, Finca La Esperanza', 'Activo', NULL),
  ('003-C', 'Vereda San José, Km 2 vía principal', 'Activo', 'Tienda comunitaria'),
  ('004-D', 'Vereda El Carmen, Sector Alto', 'Activo', NULL),
  ('005-E', 'Vereda San José, Escuela Rural', 'Activo', 'Institución educativa'),
  ('006-F', 'Vereda El Porvenir, Lote 3', 'Suspendido', 'Suspendido por falta de pago'),
  ('007-G', 'Vereda El Carmen, Restaurante El Descanso', 'Activo', NULL),
  ('008-H', 'Vereda San José, Casa vieja', 'Inactivo', 'Deshabitada'),
  ('009-I', 'Vereda El Porvenir, Centro de salud', 'Activo', 'Puesto de salud'),
  ('010-J', 'Vereda El Carmen, Finca Los Robles', 'Activo', NULL),
  ('011-K', 'Vereda San José, Parcela 12', 'Activo', NULL),
  ('012-L', 'Vereda El Porvenir, Hotel Rural', 'Activo', 'Turismo rural'),
  ('013-M', 'Vereda El Carmen, Lote sin construir', 'Inactivo', 'Sin construcción'),
  ('014-N', 'Vereda San José, Casa esquina', 'Activo', NULL),
  ('015-O', 'Vereda El Porvenir, Salón comunal', 'Activo', 'Reuniones comunitarias');

-- ============================================
-- INSERTAR PROPIETARIOS
-- ============================================
INSERT INTO propietarios (nombre_completo, numero_identificacion, telefono, email) VALUES 
  ('Juan Pérez Gómez', '12345678', '3101234567', 'juan.perez@email.com'),
  ('María Rodríguez', '23456789', '3109876543', 'maria.rodriguez@email.com'),
  ('Carlos Martínez', '34567890', '3201234567', NULL),
  ('Ana López', '45678901', '3159876543', 'ana.lopez@email.com'),
  ('Alcaldía Municipal', '890123456-1', '3001112233', 'alcaldia@municipio.gov.co'),
  ('Pedro Gutiérrez', '56789012', '3112345678', NULL),
  ('Luis Fernández', '67890123', '3189876543', 'luis.fernandez@email.com'),
  ('Carmen Sánchez', '78901234', NULL, NULL),
  ('Secretaría de Salud', '890123456-2', '3001112244', 'salud@municipio.gov.co'),
  ('Roberto Castro', '89012345', '3156789012', 'roberto.castro@email.com'),
  ('Sofía Vargas', '90123456', '3167890123', NULL),
  ('Turismo Rural SAS', '900123456-3', '3178901234', 'info@turismorural.com'),
  ('Herederos de José Ramírez', NULL, NULL, NULL),
  ('Gloria Mendoza', '91234567', '3145678901', 'gloria.mendoza@email.com'),
  ('Junta de Acción Comunal', '890123456-4', '3001112255', 'jac@vereda.com');

-- ============================================
-- ASIGNAR PROPIETARIOS ACTUALES A CUENTAS
-- ============================================
INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio, fecha_fin) VALUES 
  (1, 1, '2020-01-15', NULL),  -- Juan Pérez actual propietario cuenta 001-A
  (2, 2, '2021-03-10', NULL),  -- María Rodríguez
  (3, 3, '2019-06-20', NULL),  -- Carlos Martínez
  (4, 4, '2022-02-05', NULL),  -- Ana López
  (5, 5, '2018-01-01', NULL),  -- Alcaldía Municipal
  (6, 6, '2020-08-12', NULL),  -- Pedro Gutiérrez (suspendida)
  (7, 7, '2021-11-25', NULL),  -- Luis Fernández
  (8, 8, '2017-04-10', NULL),  -- Carmen Sánchez (inactiva)
  (9, 9, '2018-01-01', NULL),  -- Secretaría de Salud
  (10, 10, '2023-01-15', NULL), -- Roberto Castro
  (11, 11, '2022-07-20', NULL), -- Sofía Vargas
  (12, 12, '2023-05-10', NULL), -- Turismo Rural SAS
  (13, 13, '2015-03-01', NULL), -- Herederos José Ramírez
  (14, 14, '2021-09-15', NULL), -- Gloria Mendoza
  (15, 15, '2018-01-01', NULL); -- Junta de Acción Comunal

-- ============================================
-- ASIGNAR CATEGORÍAS ACTUALES A CUENTAS
-- ============================================
INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio, fecha_fin) VALUES 
  (1, 1, '2020-01-15', NULL),  -- Finca
  (2, 1, '2021-03-10', NULL),  -- Finca
  (3, 3, '2019-06-20', NULL),  -- Tienda
  (4, 1, '2022-02-05', NULL),  -- Finca
  (5, 1, '2018-01-01', NULL),  -- Finca (escuela usa categoría finca)
  (6, 1, '2020-08-12', NULL),  -- Finca
  (7, 3, '2021-11-25', NULL),  -- Tienda (restaurante)
  (8, 1, '2017-04-10', NULL),  -- Finca
  (9, 1, '2018-01-01', NULL),  -- Finca (centro salud usa categoría finca)
  (10, 1, '2023-01-15', NULL), -- Finca
  (11, 1, '2022-07-20', NULL), -- Finca
  (12, 2, '2023-05-10', NULL), -- Finca con piscina (hotel)
  (13, 1, '2015-03-01', NULL), -- Finca
  (14, 1, '2021-09-15', NULL), -- Finca
  (15, 1, '2018-01-01', NULL); -- Finca (salón comunal)

-- ============================================
-- INSERTAR RECIBOS Y PAGOS DE PRUEBA
-- ============================================
-- Recibos del mes pasado
INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago) VALUES 
  (5800, 1, 1, date('now', '-1 month'), 10000, 'Efectivo'),
  (5801, 2, 2, date('now', '-1 month'), 10000, 'Transferencia'),
  (5802, 3, 3, date('now', '-1 month'), 12000, 'Efectivo'),
  (5803, 4, 4, date('now', '-1 month'), 10000, 'Efectivo'),
  (5804, 5, 5, date('now', '-1 month'), 10000, 'Transferencia'),
  (5805, 7, 7, date('now', '-1 month'), 12000, 'Efectivo'),
  (5806, 10, 10, date('now', '-1 month'), 10000, 'Efectivo');

-- Recibos del mes actual
INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago) VALUES 
  (5807, 1, 1, date('now', '-5 days'), 10000, 'Efectivo'),
  (5808, 2, 2, date('now', '-3 days'), 10000, 'Transferencia'),
  (5809, 10, 10, date('now', '-1 day'), 10000, 'Efectivo');

-- Detalles de recibos (sostenimiento mensual)
INSERT INTO recibo_detalles (recibo_id, concepto, periodo_desde, periodo_hasta, valor) VALUES 
  -- Mes pasado
  (1, 'Sostenimiento', '2024-11', '2024-11', 10000),
  (2, 'Sostenimiento', '2024-11', '2024-11', 10000),
  (3, 'Sostenimiento', '2024-11', '2024-11', 12000),
  (4, 'Sostenimiento', '2024-11', '2024-11', 10000),
  (5, 'Sostenimiento', '2024-11', '2024-11', 10000),
  (6, 'Sostenimiento', '2024-11', '2024-11', 12000),
  (7, 'Sostenimiento', '2024-11', '2024-11', 10000),
  -- Mes actual
  (8, 'Sostenimiento', '2024-12', '2024-12', 10000),
  (9, 'Sostenimiento', '2024-12', '2024-12', 10000),
  (10, 'Sostenimiento', '2024-12', '2024-12', 10000);

-- ============================================
-- INSERTAR GASTOS DE PRUEBA
-- ============================================
INSERT INTO gastos (fecha_gasto, concepto, tipo_gasto, proveedor, valor, metodo_pago) VALUES
  (date('now', '-2 months'), 'Mantenimiento tubería principal', 'Mantenimiento', 'Fontanería El Río', 350000, 'Efectivo'),
  (date('now', '-2 months'), 'Cloro para tratamiento', 'Insumos', 'Distribuidora Aguas', 85000, 'Efectivo'),
  (date('now', '-1 month'), 'Mantenimiento bomba', 'Mantenimiento', 'Fontanería El Río', 220000, 'Transferencia'),
  (date('now', '-1 month'), 'Cloro para tratamiento', 'Insumos', 'Distribuidora Aguas', 85000, 'Efectivo'),
  (date('now', '-1 month'), 'Pago energía eléctrica', 'Servicios', 'Empresa de Energía', 180000, 'Transferencia'),
  (date('now', '-15 days'), 'Cloro para tratamiento', 'Insumos', 'Distribuidora Aguas', 85000, 'Efectivo'),
  (date('now', '-10 days'), 'Pago energía eléctrica', 'Servicios', 'Empresa de Energía', 190000, 'Transferencia');

-- ============================================
-- MOVIMIENTOS DE CAJA Y BANCO
-- ============================================
-- Ingresos por pagos mes pasado
INSERT INTO movimientos (tipo, origen, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento) VALUES
  ('Ingreso', 'Caja', 10000, 'Recibo 5800', 1, 'recibo', date('now', '-1 month')),
  ('Ingreso', 'Banco', 10000, 'Recibo 5801', 2, 'recibo', date('now', '-1 month')),
  ('Ingreso', 'Caja', 12000, 'Recibo 5802', 3, 'recibo', date('now', '-1 month')),
  ('Ingreso', 'Caja', 10000, 'Recibo 5803', 4, 'recibo', date('now', '-1 month')),
  ('Ingreso', 'Banco', 10000, 'Recibo 5804', 5, 'recibo', date('now', '-1 month')),
  ('Ingreso', 'Caja', 12000, 'Recibo 5805', 6, 'recibo', date('now', '-1 month')),
  ('Ingreso', 'Caja', 10000, 'Recibo 5806', 7, 'recibo', date('now', '-1 month'));

-- Ingresos por pagos mes actual
INSERT INTO movimientos (tipo, origen, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento) VALUES
  ('Ingreso', 'Caja', 10000, 'Recibo 5807', 8, 'recibo', date('now', '-5 days')),
  ('Ingreso', 'Banco', 10000, 'Recibo 5808', 9, 'recibo', date('now', '-3 days')),
  ('Ingreso', 'Caja', 10000, 'Recibo 5809', 10, 'recibo', date('now', '-1 day'));

-- Egresos por gastos
INSERT INTO movimientos (tipo, origen, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento) VALUES
  ('Egreso', 'Caja', 350000, 'Mantenimiento tubería', 1, 'gasto', date('now', '-2 months')),
  ('Egreso', 'Caja', 85000, 'Compra cloro', 2, 'gasto', date('now', '-2 months')),
  ('Egreso', 'Banco', 220000, 'Mantenimiento bomba', 3, 'gasto', date('now', '-1 month')),
  ('Egreso', 'Caja', 85000, 'Compra cloro', 4, 'gasto', date('now', '-1 month')),
  ('Egreso', 'Banco', 180000, 'Pago energía', 5, 'gasto', date('now', '-1 month')),
  ('Egreso', 'Caja', 85000, 'Compra cloro', 6, 'gasto', date('now', '-15 days')),
  ('Egreso', 'Banco', 190000, 'Pago energía', 7, 'gasto', date('now', '-10 days'));

-- ============================================
-- ACTUALIZAR CONSECUTIVO DE RECIBOS
-- ============================================
UPDATE configuracion SET valor = '5810' WHERE clave = 'consecutivo_recibos';

