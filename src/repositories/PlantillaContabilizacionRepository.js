class PlantillaContabilizacionRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  // Todas las plantillas, mostrando solo la versión más alta de cada codigo.
  // Para el listado administrativo: un código = una fila, con sus líneas incluidas.
  findAll() {
    const plantillas = this.db.prepare(`
      SELECT p.*
      FROM plantillas_contabilizacion p
      INNER JOIN (
        SELECT codigo, MAX(version) as max_version
        FROM plantillas_contabilizacion
        GROUP BY codigo
      ) latest ON p.codigo = latest.codigo AND p.version = latest.max_version
      ORDER BY p.modulo ASC, p.subtipo ASC, p.codigo ASC
    `).all();

    return plantillas.map(p => ({ ...p, lineas: this._getLineas(p.id) }));
  }

  // Todas las versiones de un código concreto (para el historial de versiones en la UI).
  findVersionesByCodigo(codigo) {
    return this.db.prepare(`
      SELECT * FROM plantillas_contabilizacion
      WHERE codigo = ? ORDER BY version DESC
    `).all(codigo);
  }

  findById(id) {
    const p = this.db.prepare('SELECT * FROM plantillas_contabilizacion WHERE id = ?').get(id);
    if (!p) return null;
    return { ...p, lineas: this._getLineas(id) };
  }

  // Plantilla vigente para una fecha dada: la de mayor versión cuyo rango la incluye.
  // Si subtipo es NULL se busca la plantilla sin subtipo.
  findVigente(modulo, subtipo, fecha) {
    const p = subtipo
      ? this.db.prepare(`
          SELECT * FROM plantillas_contabilizacion
          WHERE modulo = ? AND subtipo = ? AND activo = 1
            AND fecha_desde <= ? AND (fecha_hasta IS NULL OR fecha_hasta >= ?)
          ORDER BY version DESC LIMIT 1
        `).get(modulo, subtipo, fecha, fecha)
      : this.db.prepare(`
          SELECT * FROM plantillas_contabilizacion
          WHERE modulo = ? AND subtipo IS NULL AND activo = 1
            AND fecha_desde <= ? AND (fecha_hasta IS NULL OR fecha_hasta >= ?)
          ORDER BY version DESC LIMIT 1
        `).get(modulo, fecha, fecha);

    if (!p) return null;
    return { ...p, lineas: this._getLineas(p.id) };
  }

  _getLineas(plantillaId) {
    return this.db.prepare(`
      SELECT * FROM plantillas_lineas WHERE plantilla_id = ? ORDER BY orden ASC
    `).all(plantillaId);
  }

  // Cierra la vigencia de una versión (preparando la creación de la siguiente).
  cerrarVigencia(id, fechaHasta) {
    this.db.prepare(`
      UPDATE plantillas_contabilizacion
      SET fecha_hasta = ?, fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(fechaHasta, id);
  }

  // Crea una nueva versión de una plantilla existente.
  // El llamador debe haber cerrado la versión anterior con cerrarVigencia() antes de llamar aquí.
  crearVersion({ codigo, version, nombre, descripcion, modulo, subtipo, fechaDesde, esSistema = 0 }) {
    return this.db.prepare(`
      INSERT INTO plantillas_contabilizacion (codigo, version, nombre, descripcion, modulo, subtipo, fecha_desde, activo, es_sistema)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(codigo, version, nombre, descripcion, modulo, subtipo || null, fechaDesde, esSistema ? 1 : 0).lastInsertRowid;
  }

  // Reemplaza todas las líneas de una plantilla.
  // La validación de que las líneas sean coherentes ocurre en el Service antes de llamar aquí.
  reemplazarLineas(plantillaId, lineas) {
    this.db.prepare('DELETE FROM plantillas_lineas WHERE plantilla_id = ?').run(plantillaId);

    const ins = this.db.prepare(`
      INSERT INTO plantillas_lineas (
        plantilla_id, orden,
        cuenta_fija_id, cuenta_automatica_clave, cuenta_mapeo_modulo, cuenta_mapeo_campo, cuenta_contexto_campo,
        tipo_monto, monto_campo, monto_base_campo, monto_porcentaje, monto_fijo,
        lado,
        tipo_expansion, expansion_fuente, expansion_cuenta_campo, expansion_monto_campo, expansion_lado_formula,
        incluir_tercero_id, incluir_propietario_id, incluir_snapshot_nombre,
        condicion_json, descripcion_linea
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const l of lineas) {
      ins.run(
        plantillaId, l.orden,
        l.cuenta_fija_id || null, l.cuenta_automatica_clave || null,
        l.cuenta_mapeo_modulo || null, l.cuenta_mapeo_campo || null, l.cuenta_contexto_campo || null,
        l.tipo_monto || 'Campo', l.monto_campo || null, l.monto_base_campo || null,
        l.monto_porcentaje || null, l.monto_fijo || null,
        l.lado || 'Debito',
        l.tipo_expansion || 'Unica', l.expansion_fuente || null, l.expansion_cuenta_campo || null,
        l.expansion_monto_campo || null, l.expansion_lado_formula || null,
        l.incluir_tercero_id ? 1 : 0, l.incluir_propietario_id ? 1 : 0, l.incluir_snapshot_nombre ? 1 : 0,
        l.condicion_json || null, l.descripcion_linea || null
      );
    }
  }

  transaccion(fn) {
    return this.db.transaction(fn)();
  }
}

module.exports = PlantillaContabilizacionRepository;
