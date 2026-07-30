-- 036_cartera_movimientos.sql
-- La deuda de un asociado pasa a modelarse en DINERO (cargos menos abonos), no en meses.
-- Motivo: el 30,5% de los saldos reales no son múltiplo de la mensualidad (hay saldos de
-- medio mes) y 133 recibos de "ABONO A LA DEUDA" no tienen ningún mes asignado, así que
-- pago_periodos -- con su UNIQUE(cuenta, anio, mes) y sin concepto de mes parcial -- no
-- puede representar la realidad. Ver docs/superpowers/specs/2026-07-29-cartera-cuenta-corriente-design.md
--
-- pago_periodos NO se toca: se conserva como archivo histórico de qué dijo cada recibo.

-- Un registro por cada cargo y por cada abono. El saldo de una cuenta es la suma de montos:
-- los cargos son positivos, los abonos negativos.
CREATE TABLE cartera_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  fecha DATE NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN (
    'CargoMensual',          -- causación del aporte de un mes
    'AjusteCategoria',       -- corrección (+/-) de un CargoMensual ya emitido
    'AperturaOpaca',         -- saldo anterior al 01/01/2022, sin sustento auditable
    'Abono',                 -- plata recibida (monto negativo)
    'AjusteAsamblea',        -- corrección o condonación documentada
    'CastigoCartera'         -- baja del saldo opaco por acta
  )),
  -- 0 = informativo, nunca se cobra ni entra a la cartera contable (la deuda anterior a 2022).
  exigible INTEGER NOT NULL DEFAULT 1 CHECK(exigible IN (0, 1)),
  monto REAL NOT NULL,
  anio INTEGER,   -- solo CargoMensual y AjusteCategoria: a qué mes corresponde
  mes INTEGER CHECK(mes IS NULL OR mes BETWEEN 1 AND 12),
  recibo_detalle_id INTEGER,   -- soporte del abono
  documento TEXT,              -- acta o referencia del ajuste
  observaciones TEXT,
  usuario_id INTEGER,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
  FOREIGN KEY (recibo_detalle_id) REFERENCES recibo_detalles(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

-- Impide causar dos veces el mismo mes. Es PARCIAL a propósito: solo aplica a CargoMensual,
-- para que los AjusteCategoria del mismo mes puedan convivir (así se corrige el pasado sin
-- mutar el cargo original).
CREATE UNIQUE INDEX idx_cartera_cargo_unico
  ON cartera_movimientos(cuenta_id, anio, mes) WHERE tipo = 'CargoMensual';

CREATE INDEX idx_cartera_cuenta ON cartera_movimientos(cuenta_id, fecha);
CREATE INDEX idx_cartera_exigible ON cartera_movimientos(cuenta_id, exigible);
CREATE INDEX idx_cartera_recibo_detalle ON cartera_movimientos(recibo_detalle_id);

-- Qué cargo cubrió cada abono y por cuánto. Explica la cobertura para el estado de cuenta;
-- el SALDO NUNCA se calcula desde aquí, sale de cartera_movimientos. Esa separación es la que
-- permite corregir el pasado con movimientos de contrapartida sin reescribir imputaciones.
CREATE TABLE cartera_imputaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  abono_id INTEGER NOT NULL,
  cargo_id INTEGER NOT NULL,
  monto REAL NOT NULL CHECK(monto > 0),
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (abono_id) REFERENCES cartera_movimientos(id),
  FOREIGN KEY (cargo_id) REFERENCES cartera_movimientos(id),
  UNIQUE(abono_id, cargo_id)
);

CREATE INDEX idx_cartera_imput_abono ON cartera_imputaciones(abono_id);
CREATE INDEX idx_cartera_imput_cargo ON cartera_imputaciones(cargo_id);

-- Historial de estado de la cuenta. Hasta ahora cuentas.estado era una sola columna sin
-- historia: se podía marcar Suspendido pero no DESDE CUÁNDO. Hace falta, porque el caso real
-- es "el último pago fue en 2022 y desde entonces nadie sabe nada del punto": hay que poder
-- suspender con efecto retroactivo para que no se genere deuda de esos años, y reactivar si
-- el punto reaparece. Misma convención que cuenta_categorias y cuenta_propietarios.
-- cuentas.estado se conserva como espejo del estado vigente (lo leen listados y reportes).
CREATE TABLE cuenta_estados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK(estado IN ('Activo', 'Inactivo', 'Suspendido')),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE,
  motivo TEXT,
  usuario_id INTEGER,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
);

CREATE INDEX idx_cuenta_estados_cuenta ON cuenta_estados(cuenta_id, fecha_inicio);
CREATE INDEX idx_cuenta_estados_actual ON cuenta_estados(cuenta_id, fecha_fin);

-- Backfill: cada cuenta que ya existe arranca con su estado actual vigente desde su creación,
-- para que la causación tenga siempre una vigencia que consultar.
INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo)
SELECT id, estado, date(COALESCE(fecha_creacion, '2000-01-01')), 'Estado inicial al migrar a cartera'
FROM cuentas;
