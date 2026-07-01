-- Soporta "Corregir Método de Pago" (Efectivo↔Transferencia) en un gasto o recibo ya creado, sin
-- anularlo: el número, la fecha, el valor y el tercero quedan intactos, solo se corrige a qué
-- cuenta (Caja/Banco) está asociado el movimiento. Solo se guarda la ÚLTIMA corrección — el
-- rastro completo de cuántas veces y por qué ya queda en Auditoría y en la cadena de asientos
-- revertidos (asiento_reversion_id).
ALTER TABLE gastos ADD COLUMN fecha_correccion_pago DATETIME;
ALTER TABLE gastos ADD COLUMN motivo_correccion_pago TEXT;
ALTER TABLE recibos ADD COLUMN fecha_correccion_pago DATETIME;
ALTER TABLE recibos ADD COLUMN motivo_correccion_pago TEXT;
