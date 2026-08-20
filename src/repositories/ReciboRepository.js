class ReciboRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  findAll(params = {}) {
    const { page = 1, limit = 10, search = '', fechaDesde = '', fechaHasta = '' } = params;
    const offset = (page - 1) * limit;

    let query = `
      SELECT r.id, r.numero_recibo, r.fecha_recibo, r.total, r.metodo_pago, r.estado,
             c.codigo as cuenta_codigo, c.direccion as cuenta_direccion,
             p.nombre_completo as propietario_nombre
      FROM recibos r
      INNER JOIN cuentas c ON c.id = r.cuenta_id
      INNER JOIN propietarios p ON p.id = r.propietario_id
      WHERE 1=1
    `;
    const queryParams = [];

    if (search) {
      query += ' AND (CAST(r.numero_recibo AS TEXT) LIKE ? OR c.codigo LIKE ? OR c.direccion LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (fechaDesde) {
      query += ' AND r.fecha_recibo >= ?';
      queryParams.push(fechaDesde);
    }

    if (fechaHasta) {
      query += ' AND r.fecha_recibo <= ?';
      queryParams.push(fechaHasta);
    }

    const countQuery = `
      SELECT COUNT(*) as total
      FROM recibos r
      INNER JOIN cuentas c ON c.id = r.cuenta_id
      WHERE 1=1
      ${search ? ' AND (CAST(r.numero_recibo AS TEXT) LIKE ? OR c.codigo LIKE ? OR c.direccion LIKE ?)' : ''}
      ${fechaDesde ? ' AND r.fecha_recibo >= ?' : ''}
      ${fechaHasta ? ' AND r.fecha_recibo <= ?' : ''}
    `;
    const total = this.db.prepare(countQuery).get(...queryParams).total;

    query += ' ORDER BY r.numero_recibo DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const data = this.db.prepare(query).all(...queryParams);

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  findById(id) {
    return this.db.prepare(`
      SELECT r.*, c.codigo as cuenta_codigo, c.direccion as cuenta_direccion,
             p.nombre_completo as propietario_nombre, p.numero_identificacion as propietario_identificacion
      FROM recibos r
      INNER JOIN cuentas c ON c.id = r.cuenta_id
      INNER JOIN propietarios p ON p.id = r.propietario_id
      WHERE r.id = ?
    `).get(id);
  }

  getDetalles(reciboId) {
    return this.db.prepare(`
      SELECT * FROM recibo_detalles WHERE recibo_id = ? ORDER BY id ASC
    `).all(reciboId);
  }

  transaccion(fn) {
    return this.db.transaction(fn)();
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

  crearMovimiento({ tipo, origen, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, observaciones }) {
    const cuentaContableId = this.resolverCuentaContable('Movimiento', origen);
    return this.db.prepare(`
      INSERT INTO movimientos (tipo, origen, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento, observaciones, cuenta_contable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, origen, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, observaciones || null, cuentaContableId).lastInsertRowid;
  }

  actualizarMetodoPago(id, metodoPago, motivo) {
    this.db.prepare(`
      UPDATE recibos
      SET metodo_pago = ?, fecha_correccion_pago = CURRENT_TIMESTAMP, motivo_correccion_pago = ?
      WHERE id = ?
    `).run(metodoPago, motivo, id);
  }

  // cuenta_creditos es un pool por CUENTA, no un saldo rastreado por recibo: cuando
  // CarteraService.redimirCredito consume saldo a favor, la fila 'Aplicado' que genera no queda
  // ligada a qué crédito 'Abono' puntual la originó (no hay ese vínculo en el esquema). Por eso
  // esto no intenta decidir "¿el crédito DE ESTE recibo fue el que se redimió?" -- pregunta que
  // el propio modelo de datos no puede responder -- sino si borrar el crédito de este recibo
  // dejaría el saldo AGREGADO de la cuenta en negativo, que es el invariante real que hay que
  // proteger. Usado por ReciboService.anular para bloquear con un mensaje claro en vez de dejar
  // una corrupción silenciosa (ver auditoría de entrega, hallazgo 5).
  getImpactoCreditoAlAnular(reciboId, cuentaId) {
    const { creditoDelRecibo } = this.db.prepare(`
      SELECT COALESCE(SUM(monto), 0) AS creditoDelRecibo
      FROM cuenta_creditos
      WHERE tipo = 'Abono' AND recibo_detalle_id IN (SELECT id FROM recibo_detalles WHERE recibo_id = ?)
    `).get(reciboId);

    const { saldoActual } = this.db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN tipo = 'Abono' THEN monto ELSE -monto END), 0) AS saldoActual
      FROM cuenta_creditos WHERE cuenta_id = ?
    `).get(cuentaId);

    return { creditoDelRecibo, saldoActual, saldoTrasAnular: saldoActual - creditoDelRecibo };
  }

  // Anular un recibo libera los meses/abonos/conexión que cubría, para que se puedan volver
  // a cobrar, pero conserva el recibo y su detalle como constancia de que existió y se anuló.
  anular(id, motivo) {
    const detalleIds = this.db.prepare('SELECT id FROM recibo_detalles WHERE recibo_id = ?').all(id).map(d => d.id);

    if (detalleIds.length > 0) {
      const placeholders = detalleIds.map(() => '?').join(',');

      // Único lugar del flujo activo, aparte de la excepción documentada en
      // CarteraService.getFechaInicioFacturacion, que todavía menciona pago_periodos (barrido
      // 2026-08-11) -- a propósito: es limpieza de escritura, no una lectura que alimente ningún
      // cálculo. Nada escribe filas nuevas en pago_periodos desde esa fecha (PagoRepository ya no
      // tiene crearPeriodoPago), así que para cualquier recibo nuevo este DELETE no encuentra nada
      // y no hace nada. Se deja para que anular un recibo VIEJO (con filas reales de la
      // importación histórica) siga limpiando su rastro ahí también, sin necesidad especial.
      this.db.prepare(`DELETE FROM pago_periodos WHERE recibo_detalle_id IN (${placeholders})`).run(...detalleIds);
      this.db.prepare(`DELETE FROM cuenta_creditos WHERE recibo_detalle_id IN (${placeholders})`).run(...detalleIds);

      // Motor de cartera (cartera_movimientos/cartera_imputaciones): el abono nunca se borra ni
      // se muta, se cancela con una contrapartida -- mismo patrón que
      // CarteraService.reclasificarAbono -- y se liberan sus imputaciones para que los cargos
      // que cubría vuelvan a quedar pendientes. Sin esto, anular el recibo no tenía ningún
      // efecto sobre la deuda de cartera: el abono seguía contando como pagado.
      const abonosCartera = this.db.prepare(
        `SELECT id, cuenta_id, fecha, exigible, monto, recibo_detalle_id FROM cartera_movimientos
         WHERE recibo_detalle_id IN (${placeholders}) AND tipo = 'Abono'`
      ).all(...detalleIds);
      for (const abono of abonosCartera) {
        this.db.prepare(`DELETE FROM cartera_imputaciones WHERE abono_id = ?`).run(abono.id);
        this.db.prepare(`
          INSERT INTO cartera_movimientos (cuenta_id, fecha, tipo, exigible, monto, recibo_detalle_id, observaciones)
          VALUES (?, ?, 'Abono', ?, ?, ?, ?)
        `).run(abono.cuenta_id, abono.fecha, abono.exigible, -abono.monto, abono.recibo_detalle_id,
          `Reversión por anulación de recibo: ${motivo}`);
      }

      const puntosAfectados = this.db.prepare(
        `SELECT DISTINCT nuevo_punto_id FROM nuevo_punto_abonos WHERE recibo_detalle_id IN (${placeholders})`
      ).all(...detalleIds);

      this.db.prepare(`DELETE FROM nuevo_punto_abonos WHERE recibo_detalle_id IN (${placeholders})`).run(...detalleIds);

      for (const { nuevo_punto_id } of puntosAfectados) {
        const punto = this.db.prepare('SELECT valor_total FROM nuevos_puntos WHERE id = ?').get(nuevo_punto_id);
        const totalAbonado = this.db.prepare(
          'SELECT COALESCE(SUM(monto), 0) as total FROM nuevo_punto_abonos WHERE nuevo_punto_id = ?'
        ).get(nuevo_punto_id).total;
        const saldoPendiente = Math.max(punto.valor_total - totalAbonado, 0);
        const nuevoEstado = saldoPendiente <= 0 ? 'Pagado' : 'Pendiente';
        this.db.prepare('UPDATE nuevos_puntos SET saldo_pendiente = ?, estado = ? WHERE id = ?')
          .run(saldoPendiente, nuevoEstado, nuevo_punto_id);
      }
    }

    this.db.prepare(`
      UPDATE recibos SET estado = 'Anulado', fecha_anulacion = CURRENT_TIMESTAMP, motivo_anulacion = ?
      WHERE id = ?
    `).run(motivo, id);
  }

  // Recibos del talonario físico anulados ANTES de representar un cobro real (no tienen
  // cuenta, valor ni movimiento de caja asociado): solo una constancia de número y motivo.
  numeroRecibioExiste(numeroRecibo) {
    const enRecibos = this.db.prepare('SELECT 1 FROM recibos WHERE numero_recibo = ?').get(numeroRecibo);
    if (enRecibos) return true;
    const enAnulados = this.db.prepare('SELECT 1 FROM recibos_anulados_fisicos WHERE numero_recibo = ?').get(numeroRecibo);
    return !!enAnulados;
  }

  getConsecutivoRecibo() {
    const row = this.db.prepare("SELECT valor FROM configuracion WHERE clave = 'consecutivo_recibos'").get();
    return parseInt(row?.valor || '1', 10);
  }

  // El número de un recibo anulado del talonario físico ocupa un puesto en la MISMA secuencia
  // consecutiva que los recibos reales (es el mismo talonario). Si se anula un número que está en
  // o por delante del próximo a emitir, hay que correr el contador para que no se vuelva a usar.
  crearAnuladoFisico({ numeroRecibo, fecha, motivo }) {
    return this.transaccion(() => {
      const id = this.db.prepare(`
        INSERT INTO recibos_anulados_fisicos (numero_recibo, fecha, motivo)
        VALUES (?, ?, ?)
      `).run(numeroRecibo, fecha || null, motivo).lastInsertRowid;

      const consecutivoActual = this.getConsecutivoRecibo();
      if (numeroRecibo >= consecutivoActual) {
        this.db.prepare(`
          UPDATE configuracion SET valor = ?, fecha_actualizacion = CURRENT_TIMESTAMP
          WHERE clave = 'consecutivo_recibos'
        `).run(String(numeroRecibo + 1));
      }

      return id;
    });
  }

  getAnuladosFisicos() {
    return this.db.prepare(`
      SELECT * FROM recibos_anulados_fisicos ORDER BY numero_recibo DESC
    `).all();
  }

  // recibo_correcciones: log de ediciones con el original siempre preservado (ver 040 y la
  // regla 3 de la carga inicial). "Valor vigente" de un campo = el de su última corrección, o
  // el de la columna original en recibos/recibo_detalles si nunca se corrigió.
  crearCorreccion({ reciboId, reciboDetalleId = null, campo, valorAnterior, valorNuevo, motivo, usuarioId = null }) {
    const r = this.db.prepare(`
      INSERT INTO recibo_correcciones (recibo_id, recibo_detalle_id, campo, valor_anterior, valor_nuevo, motivo, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(reciboId, reciboDetalleId, campo, valorAnterior, valorNuevo, motivo, usuarioId);
    return r.lastInsertRowid;
  }

  getCorrecciones(reciboId) {
    return this.db.prepare(`
      SELECT * FROM recibo_correcciones WHERE recibo_id = ? ORDER BY fecha_creacion ASC, id ASC
    `).all(reciboId);
  }

  // null = no hay corrección todavía, usar el valor original de la columna.
  getValorVigente(reciboId, campo, reciboDetalleId = null) {
    const fila = this.db.prepare(`
      SELECT valor_nuevo FROM recibo_correcciones
      WHERE recibo_id = ? AND campo = ? AND recibo_detalle_id IS ?
      ORDER BY fecha_creacion DESC, id DESC LIMIT 1
    `).get(reciboId, campo, reciboDetalleId);
    return fila ? fila.valor_nuevo : null;
  }

  getConfiguracionAsociacion() {
    const rows = this.db.prepare(`
      SELECT clave, valor FROM configuracion
      WHERE clave IN ('nombre_asociacion', 'nit', 'direccion', 'telefono', 'email', 'logo_path')
    `).all();

    const config = {};
    rows.forEach(r => { config[r.clave] = r.valor; });
    return config;
  }

  // 'carta' si la clave todavía no existe en esta base (p. ej. antes de correr la migración 043,
  // o en un test que la borra a propósito) -- mismo patrón defensivo que getConsecutivoRecibo.
  getFormatoImpresionPredeterminado() {
    const row = this.db.prepare("SELECT valor FROM configuracion WHERE clave = 'formato_impresion_recibo'").get();
    return row?.valor || 'carta';
  }
}

module.exports = ReciboRepository;
