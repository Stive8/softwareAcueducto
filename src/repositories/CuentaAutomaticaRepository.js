class CuentaAutomaticaRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  getAll() {
    return this.db.prepare(`
      SELECT ca.id, ca.clave, ca.nombre, ca.descripcion, ca.configurable,
             ca.cuenta_contable_id, pc.codigo, pc.nombre AS nombre_cuenta,
             ca.fecha_actualizacion
      FROM cuentas_automaticas ca
      JOIN plan_cuentas pc ON pc.id = ca.cuenta_contable_id
      ORDER BY ca.clave
    `).all();
  }

  getByClave(clave) {
    return this.db.prepare(`
      SELECT ca.id, ca.clave, ca.nombre, ca.descripcion, ca.configurable,
             ca.cuenta_contable_id, pc.codigo, pc.nombre AS nombre_cuenta
      FROM cuentas_automaticas ca
      JOIN plan_cuentas pc ON pc.id = ca.cuenta_contable_id
      WHERE ca.clave = ?
    `).get(clave);
  }

  // Devuelve el codigo PUC de la cuenta asociada a una clave automática.
  // Usado para detección por prefijo en sincronizarLineaConCajaBanco.
  getCodigoByClave(clave) {
    const row = this.db.prepare(`
      SELECT pc.codigo
      FROM cuentas_automaticas ca
      JOIN plan_cuentas pc ON pc.id = ca.cuenta_contable_id
      WHERE ca.clave = ?
    `).get(clave);
    return row ? row.codigo : null;
  }

  // Devuelve el id de plan_cuentas para usar como cuenta en un asiento.
  getCuentaIdByClave(clave) {
    const row = this.db.prepare(`
      SELECT cuenta_contable_id FROM cuentas_automaticas WHERE clave = ?
    `).get(clave);
    return row ? row.cuenta_contable_id : null;
  }

  actualizar(clave, cuentaContableId) {
    this.db.prepare(`
      UPDATE cuentas_automaticas
      SET cuenta_contable_id = ?, fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE clave = ?
    `).run(cuentaContableId, clave);
  }
}

module.exports = CuentaAutomaticaRepository;
