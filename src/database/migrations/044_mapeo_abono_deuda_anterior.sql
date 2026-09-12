-- 044_mapeo_abono_deuda_anterior.sql
-- PagoService.registrarPagoSostenimiento/registrarAbonoDeudaAnterior clasifican el abono a deuda
-- anterior al corte (2024) como tipoConceptoContable='AbonoDeudaAnterior' (ver PagoService.js,
-- crearReciboDetalle), pero nunca existió una fila ('RecibosDetalle', 'AbonoDeudaAnterior', ...)
-- en mapeo_conceptos_contables -- la semilla de 006_plan_de_cuentas.sql solo cubre Sostenimiento,
-- AbonoPuntoNuevo, AplicacionSaldoFavor y AbonoSaldoFavor. Sin una fila propia, el recaudo caía en
-- el __default__ de RecibosDetalle (4295 "Ingresos Diversos", una cuenta de ingreso NO
-- operacional) en vez de la cuenta real de Sostenimiento -- hallazgo Alto A3 de la auditoría de
-- Contabilidad (2026-09-11). Se mapea a la misma cuenta que Sostenimiento (413505): es el mismo
-- tipo de ingreso (cuota de sostenimiento), solo que de un período anterior al corte.
INSERT INTO mapeo_conceptos_contables (modulo, concepto, cuenta_contable_id) VALUES
  ('RecibosDetalle', 'AbonoDeudaAnterior', (SELECT id FROM plan_cuentas WHERE codigo = '413505'));
