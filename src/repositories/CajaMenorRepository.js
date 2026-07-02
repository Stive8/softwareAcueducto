class CajaMenorRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  getResponsableActual() {
    return this.db.prepare(`
      SELECT cmr.*, t.nombre_razon_social, t.numero_identificacion
      FROM caja_menor_responsables cmr
      INNER JOIN terceros t ON t.id = cmr.tercero_id
      WHERE cmr.fecha_fin IS NULL
    `).get();
  }

  getHistorialResponsables() {
    return this.db.prepare(`
      SELECT cmr.*, t.nombre_razon_social, t.numero_identificacion
      FROM caja_menor_responsables cmr
      INNER JOIN terceros t ON t.id = cmr.tercero_id
      ORDER BY cmr.fecha_inicio DESC
    `).all();
  }

  // Mismo patrón que PropietarioRepository.asignarACuenta: cierra el responsable activo (un día
  // antes del nuevo inicio, sin solapamiento) e inserta el nuevo, en una sola transacción.
  asignarResponsable(terceroId, fechaInicio, observaciones = null) {
    const ejecutar = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE caja_menor_responsables
        SET fecha_fin = date(?, '-1 day')
        WHERE fecha_fin IS NULL
      `).run(fechaInicio);

      const result = this.db.prepare(`
        INSERT INTO caja_menor_responsables (tercero_id, fecha_inicio, observaciones)
        VALUES (?, ?, ?)
      `).run(terceroId, fechaInicio, observaciones);

      return result.lastInsertRowid;
    });

    return ejecutar();
  }
}

module.exports = CajaMenorRepository;
