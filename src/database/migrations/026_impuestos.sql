-- Motor tributario: configuración de impuestos y su asignación a plantillas.
--
-- Un impuesto define: tipo (IVA/ReteFuente/etc.), porcentaje, UNA cuenta contable
-- (la que acumula el impuesto) y el lado del asiento al que pertenece.
--
-- MODELO: cada impuesto DIVIDE un lado del asiento existente, no agrega un par nuevo.
--
-- lado_ajuste = 'Debito'  → IVA descontable: divide el gasto
--   Asiento resultante:
--     DB Gasto (base - montoImp)     ← línea base reducida
--     DB IVA por Descontar montoImp  ← nueva línea al impuesto (cuenta_id)
--     CR Banco  base                 ← sin cambios
--
-- lado_ajuste = 'Credito' → ReteFuente / ICA: divide el pago
--   Asiento resultante:
--     DB Gasto  base                       ← sin cambios
--     CR Rete x Pagar  montoImp            ← nueva línea al impuesto (cuenta_id)
--     CR Banco  (base - montoImp)          ← línea base reducida
--
-- Las tablas quedan vacías al instalarse: el administrador las llena cuando la asociación
-- tenga obligaciones tributarias reales (IVA, retenciones). El motor las ignora si no hay
-- impuestos asignados a una plantilla.

CREATE TABLE impuestos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo            TEXT    NOT NULL UNIQUE,   -- 'IVA_19', 'RETEFUENTE_2_5', 'ICA_0_7'
  nombre            TEXT    NOT NULL,
  tipo              TEXT    NOT NULL CHECK(tipo IN ('IVA', 'ReteFuente', 'ReteIVA', 'ICA', 'Otro')),
  porcentaje        REAL    NOT NULL CHECK(porcentaje > 0 AND porcentaje <= 100),
  -- Cuenta que acumula el impuesto (ej: 2408 IVA por Descontar, 2365 ReteFuente x Pagar)
  cuenta_id         INTEGER NOT NULL REFERENCES plan_cuentas(id),
  -- Indica qué lado del asiento divide este impuesto:
  --   'Debito'  → reduce la primera línea de débito y agrega débito al impuesto (IVA descontable)
  --   'Credito' → reduce la primera línea de crédito y agrega crédito al impuesto (ReteFuente/ICA)
  lado_ajuste       TEXT    NOT NULL DEFAULT 'Credito' CHECK(lado_ajuste IN ('Debito', 'Credito')),
  base_campo        TEXT    NOT NULL DEFAULT 'valor',  -- campo del contexto que es la base imponible
  activo            INTEGER NOT NULL DEFAULT 1,
  es_sistema        INTEGER NOT NULL DEFAULT 0,
  fecha_creacion    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Asigna qué impuestos aplican a cada plantilla (relación M:N)
CREATE TABLE plantilla_impuestos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  plantilla_id  INTEGER NOT NULL REFERENCES plantillas_contabilizacion(id),
  impuesto_id   INTEGER NOT NULL REFERENCES impuestos(id),
  -- Los impuestos con lado_ajuste='Debito' van primero (reducen la base antes de calcular los siguientes)
  orden         INTEGER NOT NULL DEFAULT 100,
  UNIQUE (plantilla_id, impuesto_id)
);

CREATE INDEX idx_plantilla_impuestos_plantilla ON plantilla_impuestos (plantilla_id);
