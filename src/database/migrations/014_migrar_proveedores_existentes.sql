-- Migra a Terceros los proveedores que hoy solo existen como texto libre en gastos ya
-- registrados (antes de que existiera el catálogo), agrupando por nit_cedula: si dos gastos
-- viejos tienen la misma identificación pero el nombre del proveedor escrito un poco distinto
-- (ej. "Ferreteria Tornillo" vs "Ferreteria El Tornillo"), quedan como UN solo tercero (se usa
-- el primero alfabéticamente como nombre), evitando duplicados.
--
-- tipo_identificacion se deja como 'Otro' para todos los migrados: no se puede asumir que el
-- texto histórico cumple el formato esperado para NIT/Cédula (sin puntos ni guión de
-- verificación), y 'Otro' no exige ningún formato numérico. Quien revise el catálogo después
-- puede corregir el tipo si quiere.
--
-- Gastos con proveedor pero SIN nit_cedula no se migran: sin una identificación no se puede
-- crear un Tercero válido (es obligatoria), así que ese texto se queda como estaba, sin enlazar.
INSERT INTO terceros (tipo_identificacion, numero_identificacion, nombre_razon_social, es_proveedor, es_otro)
SELECT 'Otro', TRIM(nit_cedula), MIN(TRIM(proveedor)), 1, 0
FROM gastos
WHERE nit_cedula IS NOT NULL AND TRIM(nit_cedula) != ''
  AND proveedor IS NOT NULL AND TRIM(proveedor) != ''
  AND tercero_id IS NULL
  AND TRIM(nit_cedula) NOT IN (SELECT numero_identificacion FROM terceros)
GROUP BY TRIM(nit_cedula);

-- Enlaza los gastos viejos a su tercero (recién creado arriba, o uno que ya existiera con la
-- misma identificación, por ejemplo si ya se había creado a mano desde el catálogo).
UPDATE gastos
SET tercero_id = (SELECT id FROM terceros WHERE terceros.numero_identificacion = TRIM(gastos.nit_cedula))
WHERE tercero_id IS NULL
  AND nit_cedula IS NOT NULL AND TRIM(nit_cedula) != ''
  AND proveedor IS NOT NULL AND TRIM(proveedor) != '';
