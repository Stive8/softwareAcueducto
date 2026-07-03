class ImpuestoRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  findAll() {
    return this.db.prepare(`
      SELECT i.*,
        c.codigo as cuenta_codigo, c.nombre as cuenta_nombre
      FROM impuestos i
      INNER JOIN plan_cuentas c ON c.id = i.cuenta_id
      ORDER BY i.tipo ASC, i.nombre ASC
    `).all();
  }

  findById(id) {
    return this.db.prepare(`
      SELECT i.*,
        c.codigo as cuenta_codigo, c.nombre as cuenta_nombre
      FROM impuestos i
      INNER JOIN plan_cuentas c ON c.id = i.cuenta_id
      WHERE i.id = ?
    `).get(id);
  }

  // Impuestos asignados a una plantilla, ordenados por secuencia de procesamiento.
  // Los que dividen el lado Débito (IVA descontable) van primero: reducen la base
  // antes de que los del lado Crédito (ReteFuente) calculen su retención.
  findByPlantillaId(plantillaId) {
    return this.db.prepare(`
      SELECT i.*, pi.orden as orden_plantilla
      FROM impuestos i
      INNER JOIN plantilla_impuestos pi ON pi.impuesto_id = i.id
      WHERE pi.plantilla_id = ? AND i.activo = 1
      ORDER BY CASE WHEN i.lado_ajuste = 'Debito' THEN 0 ELSE 1 END ASC,
               pi.orden ASC, i.id ASC
    `).all(plantillaId);
  }

  create({ codigo, nombre, tipo, porcentaje, cuentaId, ladoAjuste = 'Credito', baseCampo = 'valor' }) {
    return this.db.prepare(`
      INSERT INTO impuestos (codigo, nombre, tipo, porcentaje, cuenta_id, lado_ajuste, base_campo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(codigo, nombre, tipo, porcentaje, cuentaId, ladoAjuste, baseCampo).lastInsertRowid;
  }

  update(id, { nombre, tipo, porcentaje, cuentaId, ladoAjuste, baseCampo }) {
    const actual = this.db.prepare('SELECT porcentaje, fecha_vigencia_desde FROM impuestos WHERE id = ?').get(id);
    if (!actual) throw new Error('Impuesto no encontrado');

    // Si la tarifa cambia, se cierra el tramo de vigencia anterior en el historial ANTES de
    // sobreescribir impuestos.porcentaje, para poder reconstruir qué tasa regía en fechas
    // pasadas sin alterar el resultado de asientos ya generados con la tasa anterior.
    if (Number(actual.porcentaje) !== Number(porcentaje)) {
      const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
      const hoy = new Date().toLocaleDateString('en-CA');
      // fecha_hasta nunca puede ser anterior a fecha_desde (actual.fecha_vigencia_desde): si ya
      // hubo un cambio de tarifa hoy mismo, el segundo cambio del mismo día debe cerrar el tramo
      // el mismo día en que empezó, no "ayer" (que quedaría antes de fecha_desde).
      const fechaHastaHistorial = ayer > actual.fecha_vigencia_desde ? ayer : actual.fecha_vigencia_desde;

      this.db.prepare(`
        INSERT INTO impuesto_historial_porcentaje (impuesto_id, porcentaje, fecha_desde, fecha_hasta)
        VALUES (?, ?, ?, ?)
      `).run(id, actual.porcentaje, actual.fecha_vigencia_desde, fechaHastaHistorial);

      this.db.prepare(`
        UPDATE impuestos
        SET nombre = ?, tipo = ?, porcentaje = ?, cuenta_id = ?, lado_ajuste = ?,
            base_campo = ?, fecha_vigencia_desde = ?, fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nombre, tipo, porcentaje, cuentaId, ladoAjuste, baseCampo, hoy, id);
    } else {
      this.db.prepare(`
        UPDATE impuestos
        SET nombre = ?, tipo = ?, porcentaje = ?, cuenta_id = ?, lado_ajuste = ?,
            base_campo = ?, fecha_actualizacion = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nombre, tipo, porcentaje, cuentaId, ladoAjuste, baseCampo, id);
    }
  }

  // Porcentaje que regía para este impuesto en una fecha dada. Si la fecha es igual o posterior
  // a la última vigencia registrada, se usa la tarifa ACTUAL; si es anterior, se busca en el
  // historial de cambios. Si no hay ningún tramo histórico que cubra esa fecha (p. ej. el
  // impuesto se creó después), se usa la tarifa actual como mejor aproximación disponible.
  getPorcentajeVigente(impuestoId, fechaISO) {
    const actual = this.db.prepare('SELECT porcentaje, fecha_vigencia_desde FROM impuestos WHERE id = ?').get(impuestoId);
    if (!actual) return null;
    if (fechaISO >= actual.fecha_vigencia_desde) return actual.porcentaje;

    const historico = this.db.prepare(`
      SELECT porcentaje FROM impuesto_historial_porcentaje
      WHERE impuesto_id = ? AND fecha_desde <= ? AND fecha_hasta >= ?
      ORDER BY fecha_desde DESC LIMIT 1
    `).get(impuestoId, fechaISO, fechaISO);
    return historico ? historico.porcentaje : actual.porcentaje;
  }

  toggleActivo(id) {
    this.db.prepare(`
      UPDATE impuestos SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END,
        fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
    return this.findById(id);
  }

  asignarAPlantilla(plantillaId, impuestoId, orden = 100) {
    this.db.prepare(`
      INSERT INTO plantilla_impuestos (plantilla_id, impuesto_id, orden) VALUES (?, ?, ?)
      ON CONFLICT(plantilla_id, impuesto_id) DO UPDATE SET orden = excluded.orden
    `).run(plantillaId, impuestoId, orden);
  }

  quitarDePlantilla(plantillaId, impuestoId) {
    this.db.prepare('DELETE FROM plantilla_impuestos WHERE plantilla_id = ? AND impuesto_id = ?').run(plantillaId, impuestoId);
  }

  // Copia todas las asignaciones de impuestos de una plantilla a otra, preservando el orden.
  // Se usa al versionar una plantilla (PlantillaContabilizacionService.actualizarLineas): la
  // versión nueva tiene un id distinto, así que sin esto pierde en silencio todos los impuestos
  // que tuviera configurados la versión anterior — hallazgo Alto A-1 de la auditoría de
  // Contabilidad (2026-07-03).
  copiarAsignaciones(plantillaIdOrigen, plantillaIdDestino) {
    const asignaciones = this.db.prepare(`
      SELECT impuesto_id, orden FROM plantilla_impuestos WHERE plantilla_id = ?
    `).all(plantillaIdOrigen);
    for (const a of asignaciones) {
      this.asignarAPlantilla(plantillaIdDestino, a.impuesto_id, a.orden);
    }
  }

  getPlantillasAsignadas(impuestoId) {
    return this.db.prepare(`
      SELECT p.id, p.codigo, p.version, p.nombre, p.modulo, p.subtipo, pi.orden
      FROM plantilla_impuestos pi
      INNER JOIN plantillas_contabilizacion p ON p.id = pi.plantilla_id
      WHERE pi.impuesto_id = ?
      ORDER BY p.modulo, p.codigo
    `).all(impuestoId);
  }
}

module.exports = ImpuestoRepository;
