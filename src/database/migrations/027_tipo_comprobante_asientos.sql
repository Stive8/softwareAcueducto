-- Clasificación de los asientos manuales según el tipo de comprobante contable.
-- Solo aplica a asientos con tipo_origen = 'Manual'; los demás quedan con NULL.
-- Esto permite distinguir entre notas de crédito, débito, depreciaciones, nómina, etc.
-- sin alterar la columna tipo_origen que gobierna la lógica interna del motor.

ALTER TABLE asientos_contables ADD COLUMN tipo_comprobante TEXT DEFAULT NULL;

-- Los asientos manuales ya existentes pasan a ser 'Asiento Contable' (tipo genérico).
UPDATE asientos_contables SET tipo_comprobante = 'Asiento Contable' WHERE tipo_origen = 'Manual';
