class PlanCuentaRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  findAll(params = {}) {
    const { soloActivas = false, tipo = '', nivel = null } = params;

    let query = `
      SELECT pc.*, padre.codigo as padre_codigo, padre.nombre as padre_nombre
      FROM plan_cuentas pc
      LEFT JOIN plan_cuentas padre ON padre.id = pc.padre_id
      WHERE 1=1
    `;
    const queryParams = [];

    if (soloActivas) query += ' AND pc.activo = 1';
    if (tipo) { query += ' AND pc.tipo = ?'; queryParams.push(tipo); }
    if (nivel) { query += ' AND pc.nivel = ?'; queryParams.push(nivel); }

    query += ' ORDER BY pc.codigo ASC';

    return this.db.prepare(query).all(...queryParams);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM plan_cuentas WHERE id = ?').get(id);
  }

  findByCodigo(codigo) {
    return this.db.prepare('SELECT * FROM plan_cuentas WHERE codigo = ?').get(codigo);
  }

  // Cuentas "imputables": las de nivel más profundo dentro de su rama (sin hijos), que son
  // las únicas que en una contabilidad real se usan para registrar movimientos directamente
  // (Clase/Grupo/Cuenta intermedios solo agrupan para presentación de reportes).
  findImputables(params = {}) {
    const { soloActivas = true, tipo = '' } = params;

    let query = `
      SELECT pc.*
      FROM plan_cuentas pc
      WHERE NOT EXISTS (SELECT 1 FROM plan_cuentas hijo WHERE hijo.padre_id = pc.id)
    `;
    const queryParams = [];

    if (soloActivas) query += ' AND pc.activo = 1';
    if (tipo) { query += ' AND pc.tipo = ?'; queryParams.push(tipo); }

    query += ' ORDER BY pc.codigo ASC';

    return this.db.prepare(query).all(...queryParams);
  }

  tieneHijos(id) {
    const { c } = this.db.prepare('SELECT COUNT(*) as c FROM plan_cuentas WHERE padre_id = ?').get(id);
    return c > 0;
  }

  tieneMovimientos(id) {
    const enGastos = this.db.prepare('SELECT COUNT(*) as c FROM gastos WHERE cuenta_contable_id = ?').get(id).c;
    const enRecibos = this.db.prepare('SELECT COUNT(*) as c FROM recibo_detalles WHERE cuenta_contable_id = ?').get(id).c;
    const enMovimientos = this.db.prepare('SELECT COUNT(*) as c FROM movimientos WHERE cuenta_contable_id = ?').get(id).c;
    // movimientos_contables además de los tres anteriores: una Nota Contable manual puede tocar
    // esta cuenta sin pasar por gastos/recibos/movimientos (p.ej. un ajuste que no toca Caja/Banco).
    const enMovimientosContables = this.db.prepare('SELECT COUNT(*) as c FROM movimientos_contables WHERE cuenta_id = ?').get(id).c;
    return (enGastos + enRecibos + enMovimientos + enMovimientosContables) > 0;
  }

  // Sube por la jerarquía padre_id hasta encontrar un ancestro de nivel <= nivelMax (o hasta la
  // raíz si la cuenta ya está en un nivel <= nivelMax). Se usa para agrupar todas las subcuentas
  // de una "familia" (p.ej. Caja General y Caja Menor comparten el mismo ancestro de nivel 3,
  // '1105' Caja) sin depender de que sus códigos compartan un prefijo de longitud fija.
  getAncestroHastaNivel(id, nivelMax) {
    let cuenta = this.findById(id);
    while (cuenta && cuenta.nivel > nivelMax && cuenta.padre_id) {
      cuenta = this.findById(cuenta.padre_id);
    }
    return cuenta || null;
  }

  create(cuenta) {
    const result = this.db.prepare(`
      INSERT INTO plan_cuentas (codigo, nombre, tipo, naturaleza, nivel, padre_id, activo)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(
      cuenta.codigo,
      cuenta.nombre,
      cuenta.tipo,
      cuenta.naturaleza,
      cuenta.nivel,
      cuenta.padreId || null
    );

    return result.lastInsertRowid;
  }

  update(id, cuenta) {
    this.db.prepare(`
      UPDATE plan_cuentas
      SET codigo = ?, nombre = ?, tipo = ?, naturaleza = ?
      WHERE id = ?
    `).run(cuenta.codigo, cuenta.nombre, cuenta.tipo, cuenta.naturaleza, id);
  }

  toggleActivo(id) {
    this.db.prepare(`
      UPDATE plan_cuentas SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END WHERE id = ?
    `).run(id);
  }
}

module.exports = PlanCuentaRepository;
