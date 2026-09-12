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

-- INSERT OR IGNORE, no INSERT plano: mapeo_conceptos_contables tiene UNIQUE(modulo, concepto)
-- (ver 006_plan_de_cuentas.sql) y esta brecha es exactamente el tipo de cosa que alguien pudo
-- haber parchado a mano en la base real antes de este fix -- si la fila ya existe, un INSERT
-- plano revienta con UNIQUE constraint failed, y como runMigrations hace rollback sin marcarla
-- aplicada, se repite (y falla) en TODOS los arranques siguientes, dejando la app sin arrancar
-- (mismo patrón que la migración 017). Idempotente: si la fila ya existe, no hace nada.
INSERT OR IGNORE INTO mapeo_conceptos_contables (modulo, concepto, cuenta_contable_id) VALUES
  ('RecibosDetalle', 'AbonoDeudaAnterior', (SELECT id FROM plan_cuentas WHERE codigo = '413505'));
