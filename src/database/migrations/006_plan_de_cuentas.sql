-- 006_plan_de_cuentas.sql
-- Plan Único de Cuentas (PUC) sectorial ampliado para acueductos comunitarios.
--
-- IMPORTANTE: esta migración prepara la estructura para una futura contabilidad de doble
-- partida (libro diario, libro mayor, balance de prueba, asientos automáticos), pero NO
-- implementa todavía lógica de débito/crédito ni genera asientos. Cada movimiento económico
-- (gasto, recibo, movimiento de caja/banco) queda relacionado con una cuenta contable mediante
-- `cuenta_contable_id`, y existe una tabla de mapeo configurable (`mapeo_conceptos_contables`)
-- que resuelve esa cuenta según el tipo de gasto / concepto del recibo / origen del movimiento,
-- sin necesidad de tocar el dato histórico si más adelante cambia el mapeo. La tabla
-- `movimientos_contables` (creada en 001, nunca usada) ya queda lista para cuando se construyan
-- los asientos automáticos: solo falta llenarla, no rediseñarla.

-- El plan_cuentas anterior (11 cuentas de ejemplo, nunca usado por ningún proceso real) se
-- reemplaza por un catálogo jerárquico amplio. movimientos_contables depende de plan_cuentas
-- por llave foránea, así que se elimina y se vuelve a crear igual (no se modifica su diseño).
DROP TABLE IF EXISTS movimientos_contables;
DROP TABLE IF EXISTS plan_cuentas;

CREATE TABLE plan_cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('Activo', 'Pasivo', 'Patrimonio', 'Ingreso', 'Gasto', 'Costo')),
  naturaleza TEXT NOT NULL CHECK(naturaleza IN ('Debito', 'Credito')),
  -- 1 Clase, 2 Grupo, 3 Cuenta, 4 Subcuenta, 5 Auxiliar (este catálogo siembra hasta nivel 4;
  -- el nivel 5 queda disponible para que cada acueducto agregue auxiliares propios si los necesita).
  nivel INTEGER NOT NULL CHECK(nivel BETWEEN 1 AND 5),
  padre_id INTEGER,
  activo INTEGER DEFAULT 1,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (padre_id) REFERENCES plan_cuentas(id)
);

CREATE INDEX idx_plan_cuentas_codigo ON plan_cuentas(codigo);
CREATE INDEX idx_plan_cuentas_tipo ON plan_cuentas(tipo);
CREATE INDEX idx_plan_cuentas_padre ON plan_cuentas(padre_id);

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
-- NIVEL 1: CLASE
-- ============================================
INSERT INTO plan_cuentas (codigo, nombre, tipo, naturaleza, nivel) VALUES
  ('1', 'ACTIVO', 'Activo', 'Debito', 1),
  ('2', 'PASIVO', 'Pasivo', 'Credito', 1),
  ('3', 'PATRIMONIO', 'Patrimonio', 'Credito', 1),
  ('4', 'INGRESOS', 'Ingreso', 'Credito', 1),
  ('5', 'GASTOS', 'Gasto', 'Debito', 1),
  ('6', 'COSTOS', 'Costo', 'Debito', 1);

-- ============================================
-- NIVEL 2: GRUPO
-- ============================================
INSERT INTO plan_cuentas (codigo, nombre, tipo, naturaleza, nivel, padre_id) VALUES
  ('11', 'Disponible', 'Activo', 'Debito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '1')),
  ('13', 'Deudores', 'Activo', 'Debito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '1')),
  ('14', 'Inventarios', 'Activo', 'Debito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '1')),
  ('15', 'Propiedades, Planta y Equipo', 'Activo', 'Debito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '1')),
  ('21', 'Obligaciones Financieras', 'Pasivo', 'Credito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '2')),
  ('22', 'Proveedores', 'Pasivo', 'Credito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '2')),
  ('23', 'Cuentas por Pagar', 'Pasivo', 'Credito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '2')),
  ('24', 'Impuestos, Gravámenes y Tasas', 'Pasivo', 'Credito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '2')),
  ('25', 'Obligaciones Laborales', 'Pasivo', 'Credito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '2')),
  ('31', 'Capital Social', 'Patrimonio', 'Credito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '3')),
  ('33', 'Reservas', 'Patrimonio', 'Credito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '3')),
  ('36', 'Resultados del Ejercicio', 'Patrimonio', 'Credito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '3')),
  ('37', 'Resultados de Ejercicios Anteriores', 'Patrimonio', 'Credito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '3')),
  ('41', 'Ingresos Operacionales', 'Ingreso', 'Credito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '4')),
  ('42', 'Ingresos No Operacionales', 'Ingreso', 'Credito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '4')),
  ('51', 'Gastos de Administración', 'Gasto', 'Debito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '5')),
  ('53', 'Gastos No Operacionales', 'Gasto', 'Debito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '5')),
  ('61', 'Costos de Prestación del Servicio', 'Costo', 'Debito', 2, (SELECT id FROM plan_cuentas WHERE codigo = '6'));

-- ============================================
-- NIVEL 3: CUENTA
-- ============================================
INSERT INTO plan_cuentas (codigo, nombre, tipo, naturaleza, nivel, padre_id) VALUES
  ('1105', 'Caja', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '11')),
  ('1110', 'Bancos', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '11')),

  ('1305', 'Clientes - Cartera de Usuarios', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '13')),
  ('1330', 'Anticipos y Avances', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '13')),
  ('1355', 'Anticipo de Impuestos y Contribuciones', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '13')),
  ('1380', 'Deudores Varios', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '13')),

  ('1430', 'Inventario de Materiales y Suministros', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '14')),

  ('1520', 'Maquinaria y Equipo', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '15')),
  ('1524', 'Equipo de Bombeo y Tratamiento', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '15')),
  ('1528', 'Muebles y Enseres', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '15')),
  ('1532', 'Equipo de Cómputo y Comunicación', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '15')),
  ('1540', 'Flota y Equipo de Transporte (Vehículos)', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '15')),
  ('1550', 'Herramientas y Accesorios', 'Activo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '15')),
  ('1592', 'Depreciación Acumulada', 'Activo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '15')),

  ('2105', 'Obligaciones Financieras Nacionales', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '21')),

  ('2205', 'Proveedores Nacionales', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '22')),

  ('2335', 'Costos y Gastos por Pagar (Servicios por Pagar)', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '23')),
  ('2367', 'Excedentes o Dividendos por Pagar', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '23')),
  ('2380', 'Acreedores Varios', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '23')),

  ('2404', 'Impuesto de Industria y Comercio', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '24')),
  ('2408', 'Impuesto sobre las Ventas por Pagar (IVA)', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '24')),
  ('2412', 'Retención en la Fuente', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '24')),
  ('2415', 'Retenciones y Aportes de Nómina', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '24')),

  ('2505', 'Salarios por Pagar (Nómina por Pagar)', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '25')),
  ('2510', 'Cesantías Consolidadas', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '25')),
  ('2515', 'Intereses sobre Cesantías', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '25')),
  ('2520', 'Prima de Servicios', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '25')),
  ('2525', 'Vacaciones Consolidadas', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '25')),
  ('2530', 'Aportes a Seguridad Social y Parafiscales', 'Pasivo', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '25')),

  ('3105', 'Capital o Patrimonio Inicial', 'Patrimonio', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '31')),
  ('3305', 'Reservas Obligatorias y Estatutarias', 'Patrimonio', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '33')),
  ('3605', 'Excedente (o Pérdida) del Ejercicio', 'Patrimonio', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '36')),
  ('3705', 'Excedentes Acumulados', 'Patrimonio', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '37')),

  ('4135', 'Servicio de Acueducto', 'Ingreso', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '41')),
  ('4140', 'Reconexiones e Instalaciones', 'Ingreso', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '41')),
  ('4145', 'Intereses de Mora', 'Ingreso', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '41')),
  ('4170', 'Otros Ingresos Operacionales', 'Ingreso', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '41')),

  ('4210', 'Ingresos Financieros', 'Ingreso', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '42')),
  ('4250', 'Recuperaciones', 'Ingreso', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '42')),
  ('4295', 'Ingresos Diversos', 'Ingreso', 'Credito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '42')),

  ('5105', 'Gastos de Personal (Nómina y Prestaciones)', 'Gasto', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '51')),
  ('5110', 'Honorarios', 'Gasto', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '51')),
  ('5115', 'Impuestos y Contribuciones', 'Gasto', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '51')),
  ('5135', 'Servicios', 'Gasto', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '51')),
  ('5140', 'Gastos de Viaje y Transporte', 'Gasto', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '51')),
  ('5145', 'Mantenimiento y Reparaciones', 'Gasto', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '51')),
  ('5160', 'Depreciaciones', 'Gasto', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '51')),
  ('5195', 'Gastos Diversos', 'Gasto', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '51')),

  ('5305', 'Gastos Financieros (Gastos Bancarios)', 'Gasto', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '53')),

  ('6135', 'Costo de Operación del Sistema de Acueducto', 'Costo', 'Debito', 3, (SELECT id FROM plan_cuentas WHERE codigo = '61'));

-- ============================================
-- NIVEL 4: SUBCUENTA
-- ============================================
INSERT INTO plan_cuentas (codigo, nombre, tipo, naturaleza, nivel, padre_id) VALUES
  ('111005', 'Cuenta de Ahorros', 'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1110')),
  ('111010', 'Cuenta Corriente', 'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1110')),

  ('130505', 'Cartera de Usuarios - Servicio de Acueducto', 'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1305')),
  ('130510', 'Cartera de Usuarios - Conexiones y Reconexiones', 'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1305')),

  ('133005', 'Anticipos a Proveedores', 'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1330')),
  ('133010', 'Anticipos a Contratistas', 'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1330')),

  ('143005', 'Materiales y Accesorios de Acueducto', 'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1430')),
  ('143010', 'Químicos de Tratamiento (Cloro, etc.)', 'Activo', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '1430')),

  ('413505', 'Sostenimiento Mensual', 'Ingreso', 'Credito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '4135')),
  ('413510', 'Consumo de Agua', 'Ingreso', 'Credito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '4135')),

  ('414005', 'Reconexiones', 'Ingreso', 'Credito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '4140')),
  ('414010', 'Instalaciones - Nuevos Puntos', 'Ingreso', 'Credito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '4140')),

  ('510506', 'Sueldos', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5105')),
  ('510527', 'Auxilio de Transporte', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5105')),
  ('510530', 'Cesantías', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5105')),
  ('510533', 'Prima de Servicios', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5105')),
  ('510536', 'Vacaciones', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5105')),
  ('510568', 'Aportes a Seguridad Social', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5105')),

  ('513525', 'Energía Eléctrica', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5135')),
  ('513530', 'Acueducto y Alcantarillado (Consumo Propio)', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5135')),
  ('513535', 'Internet y Comunicaciones', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5135')),
  ('513540', 'Servicio de Telefonía', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5135')),

  ('514005', 'Transporte y Fletes', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5140')),
  ('514010', 'Combustibles y Lubricantes', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5140')),

  ('514505', 'Mantenimiento de Redes de Acueducto', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5145')),
  ('514510', 'Mantenimiento de Equipos de Bombeo', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5145')),
  ('514515', 'Mantenimiento de Vehículos', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5145')),
  ('514520', 'Reparaciones Locativas', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5145')),

  ('519505', 'Papelería y Útiles de Oficina', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5195')),
  ('519510', 'Capacitación al Personal', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5195')),
  ('519515', 'Elementos de Aseo y Cafetería', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5195')),

  ('530505', 'Comisiones Bancarias', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5305')),
  ('530510', 'Gravamen a los Movimientos Financieros (4x1000)', 'Gasto', 'Debito', 4, (SELECT id FROM plan_cuentas WHERE codigo = '5305'));

-- ============================================
-- Vínculo de movimientos económicos existentes con el plan de cuentas (preparación, sin
-- generar asientos todavía: solo queda guardado a qué cuenta correspondería cada uno).
-- ============================================
ALTER TABLE gastos ADD COLUMN cuenta_contable_id INTEGER REFERENCES plan_cuentas(id);
ALTER TABLE recibo_detalles ADD COLUMN cuenta_contable_id INTEGER REFERENCES plan_cuentas(id);
ALTER TABLE movimientos ADD COLUMN cuenta_contable_id INTEGER REFERENCES plan_cuentas(id);

CREATE INDEX idx_gastos_cuenta_contable ON gastos(cuenta_contable_id);
CREATE INDEX idx_recibo_detalles_cuenta_contable ON recibo_detalles(cuenta_contable_id);
CREATE INDEX idx_movimientos_cuenta_contable ON movimientos(cuenta_contable_id);

-- Mapeo configurable: a qué cuenta contable corresponde cada tipo de gasto, cada tipo de
-- concepto de recibo, y cada origen de movimiento de caja/banco. Resolver por mapeo (en vez de
-- escribir la cuenta a mano en cada lugar del código) permite que el administrador reclasifique
-- algo más adelante editando una sola fila, sin tocar el histórico ya guardado.
CREATE TABLE mapeo_conceptos_contables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modulo TEXT NOT NULL CHECK(modulo IN ('Gasto', 'RecibosDetalle', 'Movimiento')),
  concepto TEXT NOT NULL,
  cuenta_contable_id INTEGER NOT NULL,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_contable_id) REFERENCES plan_cuentas(id),
  UNIQUE(modulo, concepto)
);

INSERT INTO mapeo_conceptos_contables (modulo, concepto, cuenta_contable_id) VALUES
  ('RecibosDetalle', 'Sostenimiento', (SELECT id FROM plan_cuentas WHERE codigo = '413505')),
  ('RecibosDetalle', 'AbonoPuntoNuevo', (SELECT id FROM plan_cuentas WHERE codigo = '414010')),
  ('RecibosDetalle', 'AplicacionSaldoFavor', (SELECT id FROM plan_cuentas WHERE codigo = '1305')),
  ('RecibosDetalle', 'AbonoSaldoFavor', (SELECT id FROM plan_cuentas WHERE codigo = '1305')),
  ('RecibosDetalle', '__default__', (SELECT id FROM plan_cuentas WHERE codigo = '4295')),

  ('Movimiento', 'Caja', (SELECT id FROM plan_cuentas WHERE codigo = '1105')),
  ('Movimiento', 'Banco', (SELECT id FROM plan_cuentas WHERE codigo = '1110')),

  ('Gasto', 'Mantenimiento', (SELECT id FROM plan_cuentas WHERE codigo = '514505')),
  ('Gasto', 'Insumos', (SELECT id FROM plan_cuentas WHERE codigo = '143005')),
  ('Gasto', 'Servicios', (SELECT id FROM plan_cuentas WHERE codigo = '513525')),
  ('Gasto', 'Administración', (SELECT id FROM plan_cuentas WHERE codigo = '5195')),
  ('Gasto', 'Nómina', (SELECT id FROM plan_cuentas WHERE codigo = '5105')),
  ('Gasto', 'Transporte', (SELECT id FROM plan_cuentas WHERE codigo = '514010')),
  ('Gasto', '__default__', (SELECT id FROM plan_cuentas WHERE codigo = '5195'));
