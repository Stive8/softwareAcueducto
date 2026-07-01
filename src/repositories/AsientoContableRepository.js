class AsientoContableRepository {
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

  // --- Datos fuente para generar asientos automáticos (la cuenta_contable_id ya quedó
  // resuelta al crear el gasto/recibo/movimiento, vía el mapeo configurable de la migración 006) ---

  obtenerGastoParaAsiento(gastoId) {
    return this.db.prepare(`
      SELECT g.id, g.fecha_gasto as fecha, g.concepto, g.valor, g.metodo_pago, g.cuenta_contable_id,
        g.tercero_id,
        COALESCE(t.nombre_razon_social, g.proveedor) as tercero_nombre,
        COALESCE(t.numero_identificacion, g.nit_cedula) as tercero_identificacion
      FROM gastos g
      LEFT JOIN terceros t ON t.id = g.tercero_id
      WHERE g.id = ?
    `).get(gastoId);
  }

  obtenerReciboParaAsiento(reciboId) {
    const recibo = this.db.prepare(`
      SELECT r.id, r.fecha_recibo as fecha, r.numero_recibo, r.total, r.metodo_pago,
        r.propietario_id,
        p.nombre_completo as tercero_nombre, p.numero_identificacion as tercero_identificacion
      FROM recibos r
      INNER JOIN propietarios p ON p.id = r.propietario_id
      WHERE r.id = ?
    `).get(reciboId);
    if (!recibo) return null;

    recibo.detalles = this.db.prepare(`
      SELECT concepto, valor, cuenta_contable_id FROM recibo_detalles WHERE recibo_id = ?
    `).all(reciboId);

    return recibo;
  }

  obtenerMovimientoParaAsiento(movimientoId) {
    return this.db.prepare(`
      SELECT id, fecha_movimiento as fecha, concepto, monto, tipo, origen, destino
      FROM movimientos WHERE id = ?
    `).get(movimientoId);
  }

  // Refleja en el ledger simple (tabla `movimientos`, la que usan Dashboard y Caja/Banco) una
  // línea de un asiento manual que afecta Caja o Bancos. Ver AsientoContableService.crear().
  crearMovimientoSimple({ tipo, origen, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento }) {
    const cuentaContableId = this.resolverCuentaContable('Movimiento', origen);
    return this.db.prepare(`
      INSERT INTO movimientos (tipo, origen, monto, concepto, referencia_id, referencia_tipo, fecha_movimiento, cuenta_contable_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, origen, monto, concepto, referenciaId, referenciaTipo, fechaMovimiento, cuentaContableId).lastInsertRowid;
  }

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

  transaccion(fn) {
    return this.db.transaction(fn)();
  }

  getConsecutivo() {
    const row = this.db.prepare("SELECT valor FROM configuracion WHERE clave = 'consecutivo_asientos'").get();
    return parseInt(row?.valor || '1', 10);
  }

  incrementarConsecutivo(siguiente) {
    this.db.prepare(`
      UPDATE configuracion SET valor = ?, fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE clave = 'consecutivo_asientos'
    `).run(String(siguiente));
  }

  // Crea el encabezado y sus líneas en una sola operación. La validación de que las líneas
  // sumen lo mismo en débito y crédito ocurre en el Service, antes de llegar aquí: este método
  // confía en que ya está balanceado.
  crear({ numero, fecha, concepto, tipoOrigen, referenciaId = null, referenciaTipo = null, usuarioId = null, lineas }) {
    const asientoId = this.db.prepare(`
      INSERT INTO asientos_contables (numero, fecha, concepto, tipo_origen, referencia_id, referencia_tipo, usuario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(numero, fecha, concepto, tipoOrigen, referenciaId, referenciaTipo, usuarioId).lastInsertRowid;

    const insertarLinea = this.db.prepare(`
      INSERT INTO movimientos_contables
        (fecha, cuenta_id, debito, credito, concepto, referencia_id, referencia_tipo, asiento_id,
         tercero_identificacion, tercero_nombre, tercero_id, propietario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const linea of lineas) {
      insertarLinea.run(
        fecha, linea.cuentaContableId, linea.debito || 0, linea.credito || 0,
        concepto, referenciaId, referenciaTipo, asientoId,
        linea.terceroIdentificacion || null, linea.terceroNombre || null,
        linea.terceroId || null, linea.propietarioId || null
      );
    }

    return asientoId;
  }

  findById(id) {
    const asiento = this.db.prepare('SELECT * FROM asientos_contables WHERE id = ?').get(id);
    if (!asiento) return null;

    asiento.lineas = this.db.prepare(`
      SELECT mc.*, pc.codigo as cuenta_codigo, pc.nombre as cuenta_nombre
      FROM movimientos_contables mc
      INNER JOIN plan_cuentas pc ON pc.id = mc.cuenta_id
      WHERE mc.asiento_id = ?
      ORDER BY mc.id ASC
    `).all(id);

    return asiento;
  }

  findByReferenciaActiva(referenciaTipo, referenciaId) {
    return this.db.prepare(`
      SELECT * FROM asientos_contables
      WHERE referencia_tipo = ? AND referencia_id = ? AND estado = 'Activo'
      ORDER BY id DESC LIMIT 1
    `).get(referenciaTipo, referenciaId);
  }

  findAll(params = {}) {
    const { fechaDesde = '', fechaHasta = '', tipoOrigen = '', page = 1, limit = 30 } = params;
    const offset = (page - 1) * limit;

    let filtro = ' WHERE 1=1';
    const queryParams = [];

    if (fechaDesde) { filtro += ' AND a.fecha >= ?'; queryParams.push(fechaDesde); }
    if (fechaHasta) { filtro += ' AND a.fecha <= ?'; queryParams.push(fechaHasta); }
    if (tipoOrigen) { filtro += ' AND a.tipo_origen = ?'; queryParams.push(tipoOrigen); }

    const total = this.db.prepare(`SELECT COUNT(*) as total FROM asientos_contables a${filtro}`).get(...queryParams).total;

    const data = this.db.prepare(`
      SELECT a.*, (
        SELECT COALESCE(SUM(debito), 0) FROM movimientos_contables WHERE asiento_id = a.id
      ) as total_debito
      FROM asientos_contables a${filtro}
      ORDER BY a.numero DESC LIMIT ? OFFSET ?
    `).all(...queryParams, limit, offset);

    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  marcarAnulado(id, motivo, asientoReversionId) {
    this.db.prepare(`
      UPDATE asientos_contables
      SET estado = 'Anulado', fecha_anulacion = CURRENT_TIMESTAMP, motivo_anulacion = ?, asiento_reversion_id = ?
      WHERE id = ?
    `).run(motivo, asientoReversionId, id);
  }

  // Libro Mayor de una cuenta: todos los movimientos (de cualquier asiento, activo o no - los
  // de reversión se suman solos y el efecto neto siempre cuadra) con saldo corriente acumulado.
  getMovimientosPorCuenta(cuentaContableId, fechaDesde = '', fechaHasta = '') {
    let query = `
      SELECT mc.fecha, mc.concepto, mc.debito, mc.credito, a.numero as numero_asiento, a.tipo_origen
      FROM movimientos_contables mc
      INNER JOIN asientos_contables a ON a.id = mc.asiento_id
      WHERE mc.cuenta_id = ?
    `;
    const params = [cuentaContableId];
    if (fechaDesde) { query += ' AND mc.fecha >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND mc.fecha <= ?'; params.push(fechaHasta); }
    query += ' ORDER BY mc.fecha ASC, a.numero ASC, mc.id ASC';
    return this.db.prepare(query).all(...params);
  }

  // Balance de Prueba: para cada cuenta con movimiento en el período, total débito y crédito.
  getBalancePrueba(fechaDesde = '', fechaHasta = '', tipoCuenta = '') {
    let query = `
      SELECT pc.id, pc.codigo, pc.nombre, pc.tipo, pc.naturaleza,
        COALESCE(SUM(mc.debito), 0) as total_debito,
        COALESCE(SUM(mc.credito), 0) as total_credito
      FROM movimientos_contables mc
      INNER JOIN plan_cuentas pc ON pc.id = mc.cuenta_id
      WHERE 1=1
    `;
    const params = [];
    if (fechaDesde) { query += ' AND mc.fecha >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND mc.fecha <= ?'; params.push(fechaHasta); }
    if (tipoCuenta) { query += ' AND pc.tipo = ?'; params.push(tipoCuenta); }
    query += ' GROUP BY pc.id ORDER BY pc.codigo ASC';
    return this.db.prepare(query).all(...params);
  }

  // Igual que getBalancePrueba, pero agrupado también por tercero, y separando lo acumulado
  // ANTES de fechaDesde (saldo inicial del período) de lo movido DURANTE el período. Solo
  // incluye líneas que sí tienen un tercero asociado (las de Caja/Banco y traslados no aplican
  // aquí: no son una cuenta por cobrar/pagar de un tercero en particular).
  //
  // claves: el conjunto de combinaciones cuenta+tercero que tuvieron CUALQUIER movimiento hasta
  // fechaHasta, para que una combinación con saldo inicial pero sin movimiento en el período
  // (o viceversa) no quede fuera del resultado.
  getBalancePruebaPorTercero({ fechaDesde, fechaHasta, cuentaCodigoDesde = '', cuentaCodigoHasta = '', terceroQuery = '' } = {}) {
    let filtroBase = ' AND mc.tercero_nombre IS NOT NULL';
    const paramsBase = [];
    if (cuentaCodigoDesde) { filtroBase += ' AND pc.codigo >= ?'; paramsBase.push(cuentaCodigoDesde); }
    if (cuentaCodigoHasta) { filtroBase += ' AND pc.codigo <= ?'; paramsBase.push(cuentaCodigoHasta); }
    if (terceroQuery) {
      filtroBase += ' AND (mc.tercero_identificacion LIKE ? OR mc.tercero_nombre LIKE ?)';
      paramsBase.push(`%${terceroQuery}%`, `%${terceroQuery}%`);
    }

    const claves = this.db.prepare(`
      SELECT DISTINCT pc.id as cuenta_id, mc.tercero_identificacion, mc.tercero_nombre
      FROM movimientos_contables mc
      INNER JOIN plan_cuentas pc ON pc.id = mc.cuenta_id
      WHERE mc.fecha <= ? ${filtroBase}
    `).all(fechaHasta, ...paramsBase);

    const anteriores = this.db.prepare(`
      SELECT pc.id as cuenta_id, mc.tercero_identificacion, mc.tercero_nombre,
        COALESCE(SUM(mc.debito), 0) as debito, COALESCE(SUM(mc.credito), 0) as credito
      FROM movimientos_contables mc
      INNER JOIN plan_cuentas pc ON pc.id = mc.cuenta_id
      WHERE mc.fecha < ? ${filtroBase}
      GROUP BY pc.id, mc.tercero_identificacion, mc.tercero_nombre
    `).all(fechaDesde, ...paramsBase);

    const periodo = this.db.prepare(`
      SELECT pc.id as cuenta_id, mc.tercero_identificacion, mc.tercero_nombre,
        COALESCE(SUM(mc.debito), 0) as debito, COALESCE(SUM(mc.credito), 0) as credito
      FROM movimientos_contables mc
      INNER JOIN plan_cuentas pc ON pc.id = mc.cuenta_id
      WHERE mc.fecha >= ? AND mc.fecha <= ? ${filtroBase}
      GROUP BY pc.id, mc.tercero_identificacion, mc.tercero_nombre
    `).all(fechaDesde, fechaHasta, ...paramsBase);

    const clave = (cuentaId, identificacion, nombre) => `${cuentaId}|${identificacion || ''}|${nombre || ''}`;
    const anterioresPorClave = new Map(anteriores.map(a => [clave(a.cuenta_id, a.tercero_identificacion, a.tercero_nombre), a]));
    const periodoPorClave = new Map(periodo.map(p => [clave(p.cuenta_id, p.tercero_identificacion, p.tercero_nombre), p]));

    const cuentasPorId = new Map();
    const getCuenta = (id) => {
      if (!cuentasPorId.has(id)) {
        cuentasPorId.set(id, this.db.prepare(`
          SELECT id, nivel, codigo, nombre, tipo, naturaleza,
            NOT EXISTS (SELECT 1 FROM plan_cuentas hijo WHERE hijo.padre_id = plan_cuentas.id) as transaccional
          FROM plan_cuentas WHERE id = ?
        `).get(id));
      }
      return cuentasPorId.get(id);
    };

    return claves.map(k => {
      const cuenta = getCuenta(k.cuenta_id);
      const a = anterioresPorClave.get(clave(k.cuenta_id, k.tercero_identificacion, k.tercero_nombre)) || { debito: 0, credito: 0 };
      const p = periodoPorClave.get(clave(k.cuenta_id, k.tercero_identificacion, k.tercero_nombre)) || { debito: 0, credito: 0 };
      return {
        nivel: cuenta.nivel,
        transaccional: !!cuenta.transaccional,
        codigo: cuenta.codigo,
        nombre: cuenta.nombre,
        tipo: cuenta.tipo,
        naturaleza: cuenta.naturaleza,
        tercero_identificacion: k.tercero_identificacion,
        tercero_nombre: k.tercero_nombre,
        debito_anterior: a.debito,
        credito_anterior: a.credito,
        debito_periodo: p.debito,
        credito_periodo: p.credito
      };
    }).sort((a, b) => a.codigo.localeCompare(b.codigo) || (a.tercero_nombre || '').localeCompare(b.tercero_nombre || ''));
  }

  // Libro Diario real: una fila por línea de asiento, en orden cronológico/de asiento.
  getLibroDiario(fechaDesde = '', fechaHasta = '', tipoCuenta = '') {
    let query = `
      SELECT a.numero as numero_asiento, a.fecha, a.concepto as concepto_asiento, a.tipo_origen, a.estado,
             pc.codigo as cuenta_codigo, pc.nombre as cuenta_nombre, mc.debito, mc.credito
      FROM movimientos_contables mc
      INNER JOIN asientos_contables a ON a.id = mc.asiento_id
      INNER JOIN plan_cuentas pc ON pc.id = mc.cuenta_id
      WHERE 1=1
    `;
    const params = [];
    if (fechaDesde) { query += ' AND a.fecha >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND a.fecha <= ?'; params.push(fechaHasta); }
    if (tipoCuenta) { query += ' AND pc.tipo = ?'; params.push(tipoCuenta); }
    query += ' ORDER BY a.fecha ASC, a.numero ASC, mc.id ASC';
    return this.db.prepare(query).all(...params);
  }
}

module.exports = AsientoContableRepository;
