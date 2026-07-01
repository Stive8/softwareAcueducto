-- Motor de plantillas de contabilización.
--
-- Una "plantilla" define el PATRÓN de asiento contable para un tipo de operación
-- (Gasto/Efectivo, Recibo/Banco, etc.). Cada línea de la plantilla describe cómo
-- resolver: (a) la cuenta contable, (b) el monto, (c) el lado Débito/Crédito.
--
-- El motor procesa la plantilla contra un "contexto" (los datos del documento fuente)
-- y genera el array de líneas listo para AsientoContableService.crear().
--
-- VERSIONAMIENTO: cada vez que se modifica una plantilla se crea una nueva versión
-- (mismo 'codigo', version+1) cerrando la anterior con fecha_hasta. Así el motor
-- puede reconstruir exactamente qué plantilla estaba vigente en cualquier fecha
-- histórica, sin alterar asientos ya registrados.

CREATE TABLE plantillas_contabilizacion (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo              TEXT    NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  nombre              TEXT    NOT NULL,
  descripcion         TEXT,
  modulo              TEXT    NOT NULL CHECK(modulo IN ('Gasto', 'Recibo', 'Movimiento', 'Manual')),
  subtipo             TEXT,                    -- 'Efectivo' | 'Banco' | 'Traslado' | NULL
  fecha_desde         DATE    NOT NULL DEFAULT (date('now')),
  fecha_hasta         DATE,                    -- NULL = versión actualmente vigente
  activo              INTEGER NOT NULL DEFAULT 1,
  es_sistema          INTEGER NOT NULL DEFAULT 0,  -- 1 = creada por migración, no eliminable
  fecha_creacion      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (codigo, version)
);

CREATE INDEX idx_plantillas_vigente ON plantillas_contabilizacion (modulo, subtipo, activo, fecha_desde, fecha_hasta);

CREATE TABLE plantillas_lineas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plantilla_id INTEGER NOT NULL REFERENCES plantillas_contabilizacion(id),
  orden        INTEGER NOT NULL,

  -- RESOLUCIÓN DE CUENTA (exactamente uno de estos cuatro mecanismos debe estar definido)
  cuenta_fija_id          INTEGER REFERENCES plan_cuentas(id),      -- cuenta PUC hardcoded
  cuenta_automatica_clave TEXT,                                       -- clave en cuentas_automaticas: CAJA, BANCO, CARTERA_USUARIOS
  cuenta_mapeo_modulo     TEXT,                                       -- resolver desde mapeo_conceptos_contables...
  cuenta_mapeo_campo      TEXT,                                       --   ...usando este campo del contexto como concepto
  cuenta_contexto_campo   TEXT,                                       -- campo del contexto que ya trae cuenta_contable_id resuelto

  -- RESOLUCIÓN DE MONTO
  tipo_monto        TEXT NOT NULL DEFAULT 'Campo'
    CHECK(tipo_monto IN ('Campo', 'CampoAbsoluto', 'Porcentaje', 'Fijo')),
  monto_campo       TEXT,          -- campo del contexto: 'valor', 'total', 'monto'
  monto_base_campo  TEXT,          -- base para Porcentaje (campo del contexto)
  monto_porcentaje  REAL,          -- %  (ej. 19.0 para IVA 19%)
  monto_fijo        REAL,          -- valor literal para tipo_monto='Fijo'

  -- LADO
  lado TEXT NOT NULL DEFAULT 'Debito' CHECK(lado IN ('Debito', 'Credito')),

  -- EXPANSIÓN: genera N líneas iterando sobre una colección del contexto (ej. recibo_detalles)
  tipo_expansion          TEXT NOT NULL DEFAULT 'Unica'
    CHECK(tipo_expansion IN ('Unica', 'Expansion')),
  expansion_fuente        TEXT,    -- nombre de la colección en el contexto: 'detalles'
  expansion_cuenta_campo  TEXT,    -- campo del ítem que contiene cuenta_contable_id ya resuelto
  expansion_monto_campo   TEXT,    -- campo del ítem que contiene el monto (puede ser negativo)
  expansion_lado_formula  TEXT
    CHECK(expansion_lado_formula IN ('Debito', 'Credito', 'PorSigno')),
    -- PorSigno: valor>=0 → Crédito con ese valor; valor<0 → Débito con abs(valor)

  -- TERCERO / PROPIETARIO (qué campos de tercero se copian del contexto a esta línea)
  incluir_tercero_id      INTEGER NOT NULL DEFAULT 0,  -- poblar tercero_id desde contexto.tercero_id
  incluir_propietario_id  INTEGER NOT NULL DEFAULT 0,  -- poblar propietario_id desde contexto.propietario_id
  incluir_snapshot_nombre INTEGER NOT NULL DEFAULT 0,  -- poblar tercero_nombre + tercero_identificacion

  -- CONDICIÓN flexible en JSON (NULL = siempre incluir esta línea)
  -- Formatos soportados por el motor:
  --   Simple:   {"campo":"metodo_pago","op":"=","valor":"Efectivo"}
  --   Negado:   {"campo":"total","op":">","valor":0}
  --   Compuesto: {"op":"AND","condiciones":[...]}  |  {"op":"OR","condiciones":[...]}
  condicion_json TEXT,

  descripcion_linea TEXT,
  fecha_creacion    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CHECK (
    (cuenta_fija_id IS NOT NULL)
    + (cuenta_automatica_clave IS NOT NULL)
    + (cuenta_mapeo_modulo IS NOT NULL)
    + (cuenta_contexto_campo IS NOT NULL) >= 1
    OR tipo_expansion = 'Expansion'  -- las líneas de expansión resuelven la cuenta desde el ítem
  )
);

CREATE INDEX idx_plineas_plantilla ON plantillas_lineas (plantilla_id, orden);

-- ===== SEED: Plantillas del sistema =====
-- Replican exactamente el comportamiento hardcoded actual de AsientoContableService.generarDesde*.
-- fecha_desde='2000-01-01' → válidas para cualquier documento histórico.
-- es_sistema=1 → no eliminables desde la UI (solo versionables).

INSERT INTO plantillas_contabilizacion (codigo, version, nombre, descripcion, modulo, subtipo, fecha_desde, activo, es_sistema) VALUES
  ('GASTO_EFECTIVO',      1, 'Gasto pagado en Efectivo',              'Débito a cuenta de gasto, crédito a Caja',                        'Gasto',     'Efectivo', '2000-01-01', 1, 1),
  ('GASTO_BANCO',         1, 'Gasto pagado por Banco/Transferencia',   'Débito a cuenta de gasto, crédito a Banco',                       'Gasto',     'Banco',    '2000-01-01', 1, 1),
  ('RECIBO_EFECTIVO',     1, 'Recibo cobrado en Efectivo',             'Crédito a cuentas de ingreso/cartera, débito a Caja',             'Recibo',    'Efectivo', '2000-01-01', 1, 1),
  ('RECIBO_BANCO',        1, 'Recibo cobrado por Banco/Transferencia', 'Crédito a cuentas de ingreso/cartera, débito a Banco',            'Recibo',    'Banco',    '2000-01-01', 1, 1),
  ('TRASLADO_CAJA_BANCO', 1, 'Consignación Caja → Banco',             'Débito a Banco, crédito a Caja (traslado de disponible sin P&G)', 'Movimiento','Traslado', '2000-01-01', 1, 1);

-- Líneas de GASTO_EFECTIVO (plantilla_id=1)
-- Línea 1: débito a la cuenta de gasto ya resuelta en el momento de registrar el gasto
INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_contexto_campo, tipo_monto, monto_campo, lado, incluir_tercero_id, incluir_snapshot_nombre, descripcion_linea)
  VALUES (1, 1, 'cuenta_contable_id', 'Campo', 'valor', 'Debito', 1, 1, 'Cuenta del tipo de gasto');
-- Línea 2: crédito a Caja
INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_automatica_clave, tipo_monto, monto_campo, lado, descripcion_linea)
  VALUES (1, 2, 'CAJA', 'Campo', 'valor', 'Credito', 'Salida de Caja');

-- Líneas de GASTO_BANCO (plantilla_id=2)
INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_contexto_campo, tipo_monto, monto_campo, lado, incluir_tercero_id, incluir_snapshot_nombre, descripcion_linea)
  VALUES (2, 1, 'cuenta_contable_id', 'Campo', 'valor', 'Debito', 1, 1, 'Cuenta del tipo de gasto');
INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_automatica_clave, tipo_monto, monto_campo, lado, descripcion_linea)
  VALUES (2, 2, 'BANCO', 'Campo', 'valor', 'Credito', 'Salida de Banco');

-- Líneas de RECIBO_EFECTIVO (plantilla_id=3)
-- Línea 1 (Expansion): itera sobre recibo.detalles; cada ítem positivo → Crédito, negativo → Débito
INSERT INTO plantillas_lineas (plantilla_id, orden, tipo_expansion, expansion_fuente, expansion_cuenta_campo, expansion_monto_campo, expansion_lado_formula, tipo_monto, lado, incluir_propietario_id, incluir_snapshot_nombre, descripcion_linea)
  VALUES (3, 1, 'Expansion', 'detalles', 'cuenta_contable_id', 'valor', 'PorSigno', 'Campo', 'Credito', 1, 1, 'Renglones del recibo (ingreso / aplicación saldo a favor)');
-- Línea 2: débito a Caja solo si el total cobrado es > 0 (puede ser cero si todo fue saldo a favor)
INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_automatica_clave, tipo_monto, monto_campo, lado, condicion_json, descripcion_linea)
  VALUES (3, 2, 'CAJA', 'Campo', 'total', 'Debito', '{"campo":"total","op":">","valor":0}', 'Entrada de Caja');

-- Líneas de RECIBO_BANCO (plantilla_id=4)
INSERT INTO plantillas_lineas (plantilla_id, orden, tipo_expansion, expansion_fuente, expansion_cuenta_campo, expansion_monto_campo, expansion_lado_formula, tipo_monto, lado, incluir_propietario_id, incluir_snapshot_nombre, descripcion_linea)
  VALUES (4, 1, 'Expansion', 'detalles', 'cuenta_contable_id', 'valor', 'PorSigno', 'Campo', 'Credito', 1, 1, 'Renglones del recibo (ingreso / aplicación saldo a favor)');
INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_automatica_clave, tipo_monto, monto_campo, lado, condicion_json, descripcion_linea)
  VALUES (4, 2, 'BANCO', 'Campo', 'total', 'Debito', '{"campo":"total","op":">","valor":0}', 'Entrada de Banco');

-- Líneas de TRASLADO_CAJA_BANCO (plantilla_id=5)
-- destino recibe (Débito) y origen entrega (Crédito); los campos 'origen' y 'destino' en el
-- contexto del Movimiento contienen el concepto mapeado ('Caja'/'Banco')
INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_mapeo_modulo, cuenta_mapeo_campo, tipo_monto, monto_campo, lado, descripcion_linea)
  VALUES (5, 1, 'Movimiento', 'destino', 'Campo', 'monto', 'Debito',  'Banco destino (recibe)');
INSERT INTO plantillas_lineas (plantilla_id, orden, cuenta_mapeo_modulo, cuenta_mapeo_campo, tipo_monto, monto_campo, lado, descripcion_linea)
  VALUES (5, 2, 'Movimiento', 'origen',  'Campo', 'monto', 'Credito', 'Caja origen (entrega)');
