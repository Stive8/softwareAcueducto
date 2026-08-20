-- 043_formato_impresion_recibo.sql
-- Formato de impresión predeterminado para recibos: 'carta' (diseño actual, con logo si hay
-- uno configurado) o 'termico_80mm' (nuevo, solo texto, pensado para impresoras POS de rollo
-- continuo). El usuario puede igual elegir un formato distinto al momento de imprimir o exportar
-- (ver el selector en recibos.js/pagos.js): este valor solo aplica cuando elige "Usar
-- predeterminado". Ver docs/superpowers/specs/2026-08-20-formatos-impresion-recibo-design.md.
INSERT INTO configuracion (clave, valor, descripcion) VALUES
  ('formato_impresion_recibo', 'carta', 'Formato de impresión predeterminado de recibos: carta o termico_80mm');
