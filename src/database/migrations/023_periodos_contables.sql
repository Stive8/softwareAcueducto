-- 023_periodos_contables.sql
-- Tabla de períodos contables (mes/año).
-- Permite controlar qué períodos están abiertos para registrar movimientos
-- y cuáles han sido cerrados o bloqueados por el administrador.
--
-- Estado 'Abierto'   → se pueden crear asientos, gastos y recibos con fecha en ese mes.
-- Estado 'Cerrado'   → el administrador lo cerró manualmente; no se admiten nuevos movimientos.
-- Estado 'Bloqueado' → cierre definitivo de ejercicio; no se puede reabrir desde la UI.
--
-- Los períodos se crean automáticamente la primera vez que se registra un movimiento
-- con fecha en ese mes/año (siempre como 'Abierto'). El administrador puede cerrarlos
-- o bloquearlos desde el módulo de Contabilidad > Períodos.

CREATE TABLE periodos_contables (
  id                 INTEGER  PRIMARY KEY AUTOINCREMENT,
  anio               INTEGER  NOT NULL,
  mes                INTEGER  NOT NULL CHECK (mes BETWEEN 1 AND 12),
  estado             TEXT     NOT NULL DEFAULT 'Abierto'
                              CHECK (estado IN ('Abierto', 'Cerrado', 'Bloqueado')),
  fecha_apertura     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_cierre       DATETIME,
  usuario_cierre_id  INTEGER  REFERENCES usuarios(id),
  motivo_cierre      TEXT,
  notas              TEXT,
  fecha_creacion     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (anio, mes)
);

-- Índice para consultas frecuentes por estado
CREATE INDEX idx_periodos_estado ON periodos_contables (estado, anio, mes);
