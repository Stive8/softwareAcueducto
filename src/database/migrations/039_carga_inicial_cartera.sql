-- 039_carga_inicial_cartera.sql
-- Prepara el esquema para la carga inicial de cartera (306 cuentas / 2.463 recibos, corte
-- 31/12/2023) descrita en REGLAS_CARGA_INICIAL.md:
--
-- (a) recibos.fecha_pago_real: hoy `recibos` solo tiene `fecha_recibo` (cuándo se escribió la
--     colilla). Hay recibos escritos semanas después de que la plata entró (ejemplo real: los
--     recibos 1185-1194 quedaron fechados 13-08-2022 pero su concepto dice "transferencia
--     01-07-2022"). La imputación FIFO debe ordenar por cuándo entró la plata, no por cuándo se
--     escribió el papel. Nullable: NULL significa "coincide con fecha_recibo" (no se duplica el
--     dato en los ~2.386 recibos donde ambas fechas son iguales); quien lea la fecha efectiva de
--     pago debe hacer COALESCE(fecha_pago_real, fecha_recibo).
--
-- (b) cartera_movimientos.tipo agrega 'AjusteCargaInicial': el ajuste residual que exige la
--     conciliación contra CARTERA.xlsx (sección 7 del MD) — hasta ~15 cuentas donde la aritmética
--     del propio Excel no cierra al centavo. Se mantiene distinto de 'AjusteAsamblea' (que es para
--     correcciones/condonaciones de junta *después* de la carga) para no mezclar en el historial
--     un ajuste de conciliación de apertura con una decisión de asamblea futura.
--
-- SQLite no permite modificar un CHECK con ALTER TABLE, así que cartera_movimientos se recrea
-- siguiendo el procedimiento oficial (sqlite.org/lang_altertable.html, "Making Other Kinds Of
-- Table Schema Changes"), igual que 017_terceros_no_informado_y_roles.sql. Los `id` se preservan
-- explícitamente porque cartera_imputaciones y recibo_detalles-que-referencian-abonos dependen de
-- ellos como FK.

ALTER TABLE recibos ADD COLUMN fecha_pago_real DATE;

PRAGMA foreign_keys = OFF;

CREATE TABLE cartera_movimientos_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  fecha DATE NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN (
    'CargoMensual',          -- causación del aporte de un mes
    'AjusteCategoria',       -- corrección (+/-) de un CargoMensual ya emitido
    'AperturaOpaca',         -- saldo anterior al corte de la carga inicial, sin sustento auditable
    'Abono',                 -- plata recibida (monto negativo)
    'AjusteAsamblea',        -- corrección o condonación documentada, decidida después de la carga
    'AjusteCargaInicial',    -- residuo de conciliación contra CARTERA.xlsx en la carga inicial
    'CastigoCartera'         -- baja del saldo opaco por acta
  )),
  -- 0 = informativo, nunca se cobra ni entra a la cartera contable (la deuda de antes del corte).
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

INSERT INTO cartera_movimientos_nueva
  (id, cuenta_id, fecha, tipo, exigible, monto, anio, mes, recibo_detalle_id, documento, observaciones, usuario_id, fecha_creacion)
  SELECT id, cuenta_id, fecha, tipo, exigible, monto, anio, mes, recibo_detalle_id, documento, observaciones, usuario_id, fecha_creacion
  FROM cartera_movimientos;

DROP TABLE cartera_movimientos;
ALTER TABLE cartera_movimientos_nueva RENAME TO cartera_movimientos;

CREATE UNIQUE INDEX idx_cartera_cargo_unico
  ON cartera_movimientos(cuenta_id, anio, mes) WHERE tipo = 'CargoMensual';

CREATE INDEX idx_cartera_cuenta ON cartera_movimientos(cuenta_id, fecha);
CREATE INDEX idx_cartera_exigible ON cartera_movimientos(cuenta_id, exigible);
CREATE INDEX idx_cartera_recibo_detalle ON cartera_movimientos(recibo_detalle_id);

PRAGMA foreign_keys = ON;
