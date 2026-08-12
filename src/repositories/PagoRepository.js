class PagoRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  getConfiguracionAsociacion() {
    const rows = this.db.prepare(`
      SELECT clave, valor FROM configuracion
      WHERE clave IN ('nombre_asociacion', 'nit', 'direccion', 'telefono', 'email')
    `).all();

    const config = {};
    rows.forEach(r => { config[r.clave] = r.valor; });
    return config;
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

  // Fecha real desde la cual la cuenta debe sostenimiento: el inicio de su PRIMERA categoría
  // asignada (que puede ser muy anterior a fecha_creacion, ej. una cuenta preexistente cargada
  // hoy pero que paga desde 2023). Nunca usar fecha_creacion para esto, o se pierde la mora real.
  getFechaInicioFacturacion(cuentaId) {
    const row = this.db.prepare(`
      SELECT MIN(fecha_inicio) as fecha FROM cuenta_categorias WHERE cuenta_id = ?
    `).get(cuentaId);
    return row?.fecha;
  }

  // Historial agrupado por recibo: cada fila ya es un grupo de meses consecutivos pagados juntos
  // (periodo_desde/periodo_hasta), con un solo valor, fecha y número de recibo.  Se excluyen
  // recibos anulados.
  getHistorialRecibosSostenimiento(cuentaId) {
    return this.db.prepare(`
      SELECT rd.id as recibo_detalle_id, rd.periodo_desde, rd.periodo_hasta, rd.valor,
             r.id as recibo_id, r.numero_recibo, r.fecha_recibo
      FROM recibo_detalles rd
      INNER JOIN recibos r ON r.id = rd.recibo_id
      WHERE r.cuenta_id = ? AND rd.periodo_desde IS NOT NULL AND r.estado != 'Anulado'
      ORDER BY r.fecha_recibo DESC, rd.id DESC
    `).all(cuentaId);
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

  // Resuelve a qué cuenta contable corresponde un concepto, según el mapeo configurable
  // (mapeo_conceptos_contables). Si no hay un mapeo específico, usa el "__default__" del módulo.
  // Preparación para una futura contabilidad de doble partida: por ahora solo se guarda el dato,
  // no se generan asientos.
  resolverCuentaContable(modulo, concepto) {
    const exacto = this.db.prepare(`
      SELECT cuenta_contable_id FROM mapeo_conceptos_contables WHERE modulo = ? AND concepto = ?
    `).get(modulo, concepto);
    if (exacto) return exacto.cuenta_contable_id;

    const porDefecto = this.db.prepare(`
      SELECT cuenta_contable_id FROM mapeo_conceptos_contables WHERE modulo = ? AND concepto = '__default__'
    `).get(modulo);
    return porDefecto ? porDefecto.cuenta_contable_id : null;
  }

  // tipoConceptoContable es la clave de clasificación para el mapeo ('Sostenimiento',
  // 'AplicacionSaldoFavor', 'AbonoPuntoNuevo'), independiente del texto libre de `concepto`
  // (que incluye el período/cuenta y cambia en cada recibo).
  crearReciboDetalle({ reciboId, concepto, periodoDesde = null, periodoHasta = null, valor, observaciones = null, tipoConceptoContable = 'Sostenimiento' }) {
    const cuentaContableId = this.resolverCuentaContable('RecibosDetalle', tipoConceptoContable);
    const result = this.db.prepare(`
      INSERT INTO recibo_detalles (recibo_id, concepto, periodo_desde, periodo_hasta, valor, observaciones, cuenta_contable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(reciboId, concepto, periodoDesde, periodoHasta, valor, observaciones, cuentaContableId);
    return result.lastInsertRowid;
  }

  crearMovimiento({ tipo, origen, destino = null, monto, concepto, referenciaId = null, referenciaTipo = null, fechaMovimiento, observaciones = null }) {
    const cuentaContableId = this.resolverCuentaContable('Movimiento', origen);
    const result = this.db.prepare(`
      INSERT INTO movimientos (tipo, origen, destino, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento, observaciones, cuenta_contable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, origen, destino, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, observaciones, cuentaContableId);
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
        (SELECT COALESCE(SUM(CASE WHEN tipo = 'Abono' THEN monto ELSE -monto END), 0)
           FROM cuenta_creditos WHERE cuenta_id = c.id) as saldo_favor,
        (SELECT COALESCE(SUM(saldo_pendiente), 0)
           FROM nuevos_puntos WHERE cuenta_id = c.id AND estado = 'Pendiente') as conexion_pendiente,
        (SELECT EXISTS(SELECT 1 FROM cartera_movimientos WHERE cuenta_id = c.id AND tipo = 'Abono')) as tiene_abonos
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
