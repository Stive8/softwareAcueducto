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
    this.db.prepare(`
      UPDATE impuestos
      SET nombre = ?, tipo = ?, porcentaje = ?, cuenta_id = ?, lado_ajuste = ?,
          base_campo = ?, fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nombre, tipo, porcentaje, cuentaId, ladoAjuste, baseCampo, id);
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
