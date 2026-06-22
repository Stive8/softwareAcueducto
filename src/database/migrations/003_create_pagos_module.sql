-- 003_create_pagos_module.sql
-- Soporte para el módulo de Pagos (sostenimiento por mes calendario completo, nunca por cortes)
-- Las tablas recibos / recibo_detalles ya existían desde 001 (preparadas desde el inicio).

-- Un registro por cada mes calendario efectivamente pagado de una cuenta.
-- El UNIQUE evita pagar dos veces el mismo mes. Permite pagar atrasados, futuros,
-- o varios años de una sola vez, sin que el período tenga que ser contiguo.
CREATE TABLE pago_periodos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  anio INTEGER NOT NULL,
  mes INTEGER NOT NULL CHECK(mes BETWEEN 1 AND 12),
  valor REAL NOT NULL,
  recibo_detalle_id INTEGER,
  fecha_pago DATE NOT NULL,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
  FOREIGN KEY (recibo_detalle_id) REFERENCES recibo_detalles(id),
  UNIQUE(cuenta_id, anio, mes)
);

CREATE INDEX idx_pago_periodos_cuenta ON pago_periodos(cuenta_id, anio, mes);
CREATE INDEX idx_pago_periodos_recibo_detalle ON pago_periodos(recibo_detalle_id);

-- Saldo a favor: abonos libres que no se aplicaron a meses específicos, y su posterior aplicación.
-- saldo_a_favor de una cuenta = SUM(monto WHERE tipo='Abono') - SUM(monto WHERE tipo='Aplicado')
CREATE TABLE cuenta_creditos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuenta_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('Abono', 'Aplicado')),
  monto REAL NOT NULL,
  recibo_detalle_id INTEGER,
  fecha DATE NOT NULL,
  observaciones TEXT,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
  FOREIGN KEY (recibo_detalle_id) REFERENCES recibo_detalles(id)
);

CREATE INDEX idx_cuenta_creditos_cuenta ON cuenta_creditos(cuenta_id);
