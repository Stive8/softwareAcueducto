class PagoRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  transaccion(fn) {
    return this.db.transaction(fn)();
  }

  // Categoría y tarifa vigentes para una cuenta durante un mes calendario completo (consulta
  // histórica, nunca la categoría/tarifa actual). Se compara contra el rango completo del mes
  // (día 1 al último día), no solo el día 1, porque una cuenta o tarifa puede haber iniciado
  // en cualquier día del mes (ej. una cuenta creada el 21 de junio sigue cubriendo junio entero).
  // Si hubo más de un cambio dentro del mismo mes, se usa el más reciente (el vigente al cierre del mes).
  getCategoriaTarifaParaMes(cuentaId, anio, mes) {
    const primerDia = `${anio}-${String(mes).padStart(2, '0')}-01`;

    return this.db.prepare(`
      SELECT cat.id as categoria_id, cat.nombre as categoria_nombre, ct.tarifa_sostenimiento
      FROM cuenta_categorias cc
      INNER JOIN categorias cat ON cat.id = cc.categoria_id
      INNER JOIN categoria_tarifas ct ON ct.categoria_id = cat.id
      WHERE cc.cuenta_id = ?
        AND cc.fecha_inicio <= date(?, '+1 month', '-1 day')
        AND (cc.fecha_fin IS NULL OR cc.fecha_fin >= ?)
        AND ct.fecha_vigencia_desde <= date(?, '+1 month', '-1 day')
        AND (ct.fecha_vigencia_hasta IS NULL OR ct.fecha_vigencia_hasta >= ?)
      ORDER BY cc.fecha_inicio DESC, ct.fecha_vigencia_desde DESC
      LIMIT 1
    `).get(cuentaId, primerDia, primerDia, primerDia, primerDia);
  }

  existePeriodoPagado(cuentaId, anio, mes) {
    const row = this.db.prepare(`
      SELECT id FROM pago_periodos WHERE cuenta_id = ? AND anio = ? AND mes = ?
    `).get(cuentaId, anio, mes);
    return !!row;
  }

  getUltimoPeriodoPagado(cuentaId) {
    return this.db.prepare(`
      SELECT anio, mes FROM pago_periodos
      WHERE cuenta_id = ?
      ORDER BY (anio * 12 + mes) DESC
      LIMIT 1
    `).get(cuentaId);
  }

  // Fecha real desde la cual la cuenta debe sostenimiento: el inicio de su PRIMERA categoría
  // asignada (que puede ser muy anterior a fecha_creacion, ej. una cuenta preexistente cargada
  // hoy pero que paga desde 2023). Nunca usar fecha_creacion para esto, o se pierde la mora real.
  getFechaInicioFacturacion(cuentaId) {
    const row = this.db.prepare(`
      SELECT MIN(fecha_inicio) as fecha FROM cuenta_categorias WHERE cuenta_id = ?
    `).get(cuentaId);
    return row?.fecha;
  }

  getMesesPagados(cuentaId) {
    return this.db.prepare(`
      SELECT pp.anio, pp.mes, pp.valor, pp.fecha_pago, pp.recibo_detalle_id,
             rd.recibo_id, r.numero_recibo
      FROM pago_periodos pp
      LEFT JOIN recibo_detalles rd ON rd.id = pp.recibo_detalle_id
      LEFT JOIN recibos r ON r.id = rd.recibo_id
      WHERE pp.cuenta_id = ?
      ORDER BY pp.anio DESC, pp.mes DESC
    `).all(cuentaId);
  }

  crearPeriodoPago(cuentaId, anio, mes, valor, reciboDetalleId, fechaPago) {
    const result = this.db.prepare(`
      INSERT INTO pago_periodos (cuenta_id, anio, mes, valor, recibo_detalle_id, fecha_pago)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(cuentaId, anio, mes, valor, reciboDetalleId, fechaPago);
    return result.lastInsertRowid;
  }

  // Total histórico pagado en sostenimiento y cantidad de meses/períodos cubiertos por esos pagos
  getResumenPagos(cuentaId) {
    return this.db.prepare(`
      SELECT COALESCE(SUM(valor), 0) as totalPagado, COUNT(*) as totalMesesPagados
      FROM pago_periodos
      WHERE cuenta_id = ?
    `).get(cuentaId);
  }

  getSaldoCredito(cuentaId) {
    const result = this.db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN tipo = 'Abono' THEN monto ELSE -monto END), 0) as saldo
      FROM cuenta_creditos
      WHERE cuenta_id = ?
    `).get(cuentaId);
    return result.saldo;
  }

  crearMovimientoCredito(cuentaId, tipo, monto, reciboDetalleId, fecha, observaciones = null) {
    const result = this.db.prepare(`
      INSERT INTO cuenta_creditos (cuenta_id, tipo, monto, recibo_detalle_id, fecha, observaciones)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(cuentaId, tipo, monto, reciboDetalleId, fecha, observaciones);
    return result.lastInsertRowid;
  }

  getConsecutivoRecibo() {
    const row = this.db.prepare("SELECT valor FROM configuracion WHERE clave = 'consecutivo_recibos'").get();
    return parseInt(row?.valor || '1', 10);
  }

  incrementarConsecutivoRecibo(siguiente) {
    this.db.prepare(`
      UPDATE configuracion SET valor = ?, fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE clave = 'consecutivo_recibos'
    `).run(String(siguiente));
  }

  crearRecibo({ numeroRecibo, cuentaId, propietarioId, fechaRecibo, total, metodoPago, observaciones }) {
    const result = this.db.prepare(`
      INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(numeroRecibo, cuentaId, propietarioId, fechaRecibo, total, metodoPago, observaciones || null);
    return result.lastInsertRowid;
  }

  crearReciboDetalle({ reciboId, concepto, periodoDesde = null, periodoHasta = null, valor, observaciones = null }) {
    const result = this.db.prepare(`
      INSERT INTO recibo_detalles (recibo_id, concepto, periodo_desde, periodo_hasta, valor, observaciones)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(reciboId, concepto, periodoDesde, periodoHasta, valor, observaciones);
    return result.lastInsertRowid;
  }

  crearMovimiento({ tipo, origen, destino = null, monto, concepto, referenciaId = null, referenciaTipo = null, fechaMovimiento, observaciones = null }) {
    const result = this.db.prepare(`
      INSERT INTO movimientos (tipo, origen, destino, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento, observaciones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, origen, destino, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, observaciones);
    return result.lastInsertRowid;
  }

  // Cuentas con sus datos agregados de pago (para el módulo de Pagos). Devuelve TODAS las
  // cuentas que cumplen search/estado, sin paginar: el servicio necesita conocer el estado de
  // mora/saldo de cada una (calculado en JS) antes de poder filtrar por esos criterios y
  // paginar correctamente sobre el resultado ya filtrado.
  getCuentasConEstado(params = {}) {
    const { search = '', estado = 'Activo' } = params;

    let query = `
      SELECT
        c.id, c.codigo, c.direccion, c.estado, c.fecha_creacion,
        p.nombre_completo as propietario_actual,
        cat.nombre as categoria_actual,
        (SELECT MAX(anio * 12 + (mes - 1)) FROM pago_periodos WHERE cuenta_id = c.id) as ultimo_periodo_num,
        (SELECT COALESCE(SUM(CASE WHEN tipo = 'Abono' THEN monto ELSE -monto END), 0)
           FROM cuenta_creditos WHERE cuenta_id = c.id) as saldo_favor,
        (SELECT COALESCE(SUM(saldo_pendiente), 0)
           FROM nuevos_puntos WHERE cuenta_id = c.id AND estado = 'Pendiente') as conexion_pendiente,
        (SELECT MIN(fecha_inicio) FROM cuenta_categorias WHERE cuenta_id = c.id) as fecha_inicio_facturacion
      FROM cuentas c
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      LEFT JOIN cuenta_categorias cc ON cc.cuenta_id = c.id AND cc.fecha_fin IS NULL
      LEFT JOIN categorias cat ON cat.id = cc.categoria_id
      WHERE 1=1
    `;
    const queryParams = [];

    // Igual que en Cuentas: cubre código, dirección, y el propietario actual o histórico,
    // porque en la práctica la gente no siempre recuerda su código ni a nombre de quién está.
    if (search) {
      query += ` AND (
        c.codigo LIKE ? OR c.direccion LIKE ? OR EXISTS (
          SELECT 1 FROM cuenta_propietarios cp2
          INNER JOIN propietarios p2 ON p2.id = cp2.propietario_id
          WHERE cp2.cuenta_id = c.id
            AND (p2.nombre_completo LIKE ? OR p2.numero_identificacion LIKE ?)
        )
      )`;
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (estado) {
      query += ' AND c.estado = ?';
      queryParams.push(estado);
    }

    query += ' ORDER BY c.codigo ASC';

    return this.db.prepare(query).all(...queryParams);
  }
}

module.exports = PagoRepository;
