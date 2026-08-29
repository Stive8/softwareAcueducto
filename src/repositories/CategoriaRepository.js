class CategoriaRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  findAll(params = {}) {
    const { soloActivas = false } = params;

    let query = `
      SELECT 
        c.*,
        (
          SELECT tarifa_sostenimiento 
          FROM categoria_tarifas 
          WHERE categoria_id = c.id 
          AND fecha_vigencia_hasta IS NULL 
          LIMIT 1
        ) as tarifa_actual,
        (
          SELECT COUNT(*) 
          FROM cuenta_categorias 
          WHERE categoria_id = c.id 
          AND fecha_fin IS NULL
        ) as cuentas_count
      FROM categorias c
      WHERE 1=1
    `;
    const queryParams = [];

    if (soloActivas) {
      query += ' AND c.activo = 1';
    }

    query += ' ORDER BY c.nombre ASC';

    return this.db.prepare(query).all(...queryParams);
  }

  findById(id) {
    return this.db.prepare('SELECT * FROM categorias WHERE id = ?').get(id);
  }

  findByNombre(nombre) {
    return this.db.prepare('SELECT * FROM categorias WHERE nombre = ?').get(nombre);
  }

  create(categoria) {
    const stmt = this.db.prepare(`
      INSERT INTO categorias (nombre, descripcion)
      VALUES (?, ?)
    `);
    
    const result = stmt.run(
      categoria.nombre,
      categoria.descripcion || null
    );
    
    return result.lastInsertRowid;
  }

  update(id, categoria) {
    const stmt = this.db.prepare(`
      UPDATE categorias 
      SET nombre = ?, descripcion = ?
      WHERE id = ?
    `);
    
    stmt.run(
      categoria.nombre,
      categoria.descripcion || null,
      id
    );
  }

  toggleActivo(id) {
    const stmt = this.db.prepare(`
      UPDATE categorias 
      SET activo = CASE WHEN activo = 1 THEN 0 ELSE 1 END
      WHERE id = ?
    `);
    stmt.run(id);
  }

  // Tarifas
  getTarifaVigente(categoriaId, fecha = null) {
    const fechaBusqueda = fecha || new Date().toISOString().split('T')[0];
    
    return this.db.prepare(`
      SELECT * FROM categoria_tarifas
      WHERE categoria_id = ?
      AND fecha_vigencia_desde <= ?
      AND (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= ?)
      ORDER BY fecha_vigencia_desde DESC
      LIMIT 1
    `).get(categoriaId, fechaBusqueda, fechaBusqueda);
  }

  getHistorialTarifas(categoriaId) {
    return this.db.prepare(`
      SELECT * FROM categoria_tarifas
      WHERE categoria_id = ?
      ORDER BY fecha_vigencia_desde DESC
    `).all(categoriaId);
  }

  // Inserta una tarifa en cualquier punto de la línea de tiempo (pasado, presente o futuro),
  // sin afectar los valores históricos de tarifas que ya existan. Esto permite, por ejemplo,
  // registrar hoy la tarifa de 2023 para cobrar una deuda atrasada, aunque ya existan
  // tarifas configuradas para 2024 y 2025: solo se ajustan los límites de vigencia alrededor
  // de la fecha nueva, nunca se modifica el valor de una tarifa ya registrada.
  crearTarifa(categoriaId, tarifa, fechaDesde, observaciones = null) {
    const ejecutar = this.db.transaction(() => {
      // Si existe una tarifa cuya vigencia cubre la nueva fecha de inicio, se cierra un día antes
      this.db.prepare(`
        UPDATE categoria_tarifas
        SET fecha_vigencia_hasta = date(?, '-1 day')
        WHERE categoria_id = ?
          AND fecha_vigencia_desde <= ?
          AND (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= ?)
      `).run(fechaDesde, categoriaId, fechaDesde, fechaDesde);

      // Si ya existe una tarifa posterior (futura respecto a la nueva), la nueva tarifa
      // termina un día antes de que empiece esa; si no hay ninguna posterior, queda abierta
      const siguiente = this.db.prepare(`
        SELECT fecha_vigencia_desde FROM categoria_tarifas
        WHERE categoria_id = ? AND fecha_vigencia_desde > ?
        ORDER BY fecha_vigencia_desde ASC
        LIMIT 1
      `).get(categoriaId, fechaDesde);

      const fechaHasta = siguiente
        ? this.db.prepare("SELECT date(?, '-1 day') as f").get(siguiente.fecha_vigencia_desde).f
        : null;

      const result = this.db.prepare(`
        INSERT INTO categoria_tarifas (categoria_id, tarifa_sostenimiento, fecha_vigencia_desde, fecha_vigencia_hasta, observaciones)
        VALUES (?, ?, ?, ?, ?)
      `).run(categoriaId, tarifa, fechaDesde, fechaHasta, observaciones);

      return result.lastInsertRowid;
    });

    return ejecutar();
  }

  // Asignación a cuentas
  getCuentasConCategoria(categoriaId) {
    return this.db.prepare(`
      SELECT c.id, c.codigo, c.direccion, c.estado, cc.fecha_inicio
      FROM cuentas c
      INNER JOIN cuenta_categorias cc ON cc.cuenta_id = c.id
      WHERE cc.categoria_id = ? AND cc.fecha_fin IS NULL
      ORDER BY c.codigo ASC
    `).all(categoriaId);
  }

  getCategoriaActualCuenta(cuentaId) {
    return this.db.prepare(`
      SELECT cat.*, cc.fecha_inicio
      FROM categorias cat
      INNER JOIN cuenta_categorias cc ON cc.categoria_id = cat.id
      WHERE cc.cuenta_id = ? AND cc.fecha_fin IS NULL
    `).get(cuentaId);
  }

  getHistorialCategoriasCuenta(cuentaId) {
    return this.db.prepare(`
      SELECT cat.nombre, cc.fecha_inicio, cc.fecha_fin, cc.observaciones
      FROM cuenta_categorias cc
      INNER JOIN categorias cat ON cat.id = cc.categoria_id
      WHERE cc.cuenta_id = ?
      ORDER BY cc.fecha_inicio DESC
    `).all(cuentaId);
  }
}

module.exports = CategoriaRepository;
