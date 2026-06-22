class MapeoContableRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  findAll(modulo = '') {
    let query = `
      SELECT m.*, pc.codigo as cuenta_codigo, pc.nombre as cuenta_nombre
      FROM mapeo_conceptos_contables m
      INNER JOIN plan_cuentas pc ON pc.id = m.cuenta_contable_id
      WHERE 1=1
    `;
    const params = [];
    if (modulo) { query += ' AND m.modulo = ?'; params.push(modulo); }
    query += ' ORDER BY m.modulo ASC, m.concepto ASC';
    return this.db.prepare(query).all(...params);
  }

  // Resuelve la cuenta contable para un (modulo, concepto) dado, cayendo al mapeo "__default__"
  // de ese módulo si no hay uno específico. Puede devolver null si ni siquiera existe el default
  // (no debería pasar con el catálogo semillado, pero el llamador debe tolerarlo).
  resolverCuentaContableId(modulo, concepto) {
    const exacto = this.db.prepare(`
      SELECT cuenta_contable_id FROM mapeo_conceptos_contables WHERE modulo = ? AND concepto = ?
    `).get(modulo, concepto);
    if (exacto) return exacto.cuenta_contable_id;

    const porDefecto = this.db.prepare(`
      SELECT cuenta_contable_id FROM mapeo_conceptos_contables WHERE modulo = ? AND concepto = '__default__'
    `).get(modulo);
    return porDefecto ? porDefecto.cuenta_contable_id : null;
  }

  upsert(modulo, concepto, cuentaContableId) {
    this.db.prepare(`
      INSERT INTO mapeo_conceptos_contables (modulo, concepto, cuenta_contable_id, fecha_actualizacion)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(modulo, concepto) DO UPDATE SET
        cuenta_contable_id = excluded.cuenta_contable_id,
        fecha_actualizacion = CURRENT_TIMESTAMP
    `).run(modulo, concepto, cuentaContableId);
  }
}

module.exports = MapeoContableRepository;
