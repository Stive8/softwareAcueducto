// Extrae año/mes de una fecha 'YYYY-MM-DD' sin pasar por new Date(): evita el desfase de un
// día (y a veces un mes completo) que ocurre en zonas horarias negativas como Colombia (UTC-5).
function anioMesDeFecha(fechaString) {
  const [anio, mes] = fechaString.split(' ')[0].split('-').map(Number);
  return { anio, mes };
}

class ReporteRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  getCuentas(estado = '') {
    let query = `
      SELECT c.codigo, c.direccion, cat.nombre as categoria, p.nombre_completo as propietario,
             c.estado, c.fecha_creacion
      FROM cuentas c
      LEFT JOIN cuenta_categorias cc ON cc.cuenta_id = c.id AND cc.fecha_fin IS NULL
      LEFT JOIN categorias cat ON cat.id = cc.categoria_id
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      WHERE 1=1
    `;
    const params = [];
    if (estado) {
      query += ' AND c.estado = ?';
      params.push(estado);
    }
    query += ' ORDER BY c.codigo ASC';
    return this.db.prepare(query).all(...params);
  }

  getPropietarios() {
    return this.db.prepare(`
      SELECT p.nombre_completo, p.numero_identificacion, p.telefono, p.email,
        (
          SELECT GROUP_CONCAT(c.codigo, ', ')
          FROM cuenta_propietarios cp
          INNER JOIN cuentas c ON c.id = cp.cuenta_id
          WHERE cp.propietario_id = p.id AND cp.fecha_fin IS NULL
        ) as cuentas_actuales
      FROM propietarios p
      ORDER BY p.nombre_completo ASC
    `).all();
  }

  getHistorialPagos(fechaDesde = '', fechaHasta = '') {
    let query = `
      SELECT c.codigo as cuenta, c.direccion, p.nombre_completo as propietario,
             pp.anio, pp.mes, pp.valor, pp.fecha_pago, r.numero_recibo
      FROM pago_periodos pp
      INNER JOIN cuentas c ON c.id = pp.cuenta_id
      LEFT JOIN recibo_detalles rd ON rd.id = pp.recibo_detalle_id
      LEFT JOIN recibos r ON r.id = rd.recibo_id
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      WHERE 1=1
    `;
    const params = [];
    if (fechaDesde) { query += ' AND pp.fecha_pago >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND pp.fecha_pago <= ?'; params.push(fechaHasta); }
    query += ' ORDER BY pp.fecha_pago DESC';
    return this.db.prepare(query).all(...params);
  }

  getHistorialGastos(fechaDesde = '', fechaHasta = '') {
    let query = `
      SELECT fecha_gasto, concepto, tipo_gasto, proveedor, valor, metodo_pago, estado
      FROM gastos
      WHERE 1=1
    `;
    const params = [];
    if (fechaDesde) { query += ' AND fecha_gasto >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND fecha_gasto <= ?'; params.push(fechaHasta); }
    query += ' ORDER BY fecha_gasto DESC';
    return this.db.prepare(query).all(...params);
  }

  // Cuentas activas con su último período pagado codificado (año*12+(mes-1)), para que el
  // servicio determine cuáles están al día, en mora, y desde cuándo.
  getCuentasConUltimoPeriodo() {
    return this.db.prepare(`
      SELECT c.codigo, c.direccion, c.fecha_creacion,
             p.nombre_completo as propietario,
             (SELECT MAX(anio * 12 + (mes - 1)) FROM pago_periodos WHERE cuenta_id = c.id) as ultimo_periodo_num,
             (SELECT MIN(fecha_inicio) FROM cuenta_categorias WHERE cuenta_id = c.id) as fecha_inicio_facturacion
      FROM cuentas c
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      WHERE c.estado = 'Activo'
      ORDER BY c.codigo ASC
    `).all();
  }

  getCuentasConSaldoAFavor() {
    return this.db.prepare(`
      SELECT c.codigo, c.direccion, p.nombre_completo as propietario, cred.saldo
      FROM (
        SELECT cuenta_id, SUM(CASE WHEN tipo = 'Abono' THEN monto ELSE -monto END) as saldo
        FROM cuenta_creditos
        GROUP BY cuenta_id
        HAVING saldo > 0
      ) cred
      INNER JOIN cuentas c ON c.id = cred.cuenta_id
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      ORDER BY c.codigo ASC
    `).all();
  }

  getEstadoNuevosPuntos() {
    return this.db.prepare(`
      SELECT c.codigo as cuenta, c.direccion, np.valor_total, np.fecha_registro, np.estado,
        (SELECT COALESCE(SUM(monto), 0) FROM nuevo_punto_abonos WHERE nuevo_punto_id = np.id) as total_abonado,
        np.saldo_pendiente
      FROM nuevos_puntos np
      INNER JOIN cuentas c ON c.id = np.cuenta_id
      ORDER BY np.fecha_registro DESC
    `).all();
  }

  getIngresosPorPeriodo(fechaDesde = '', fechaHasta = '') {
    let query = `
      SELECT r.fecha_recibo, r.numero_recibo, c.codigo as cuenta,
        (SELECT GROUP_CONCAT(concepto, ' | ') FROM recibo_detalles WHERE recibo_id = r.id) as conceptos,
        r.total, r.metodo_pago
      FROM recibos r
      INNER JOIN cuentas c ON c.id = r.cuenta_id
      WHERE 1=1
    `;
    const params = [];
    if (fechaDesde) { query += ' AND r.fecha_recibo >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND r.fecha_recibo <= ?'; params.push(fechaHasta); }
    query += ' ORDER BY r.fecha_recibo DESC, r.numero_recibo DESC';
    return this.db.prepare(query).all(...params);
  }

  getGastosPorPeriodo(fechaDesde = '', fechaHasta = '') {
    return this.getHistorialGastos(fechaDesde, fechaHasta).filter(g => g.estado !== 'Anulado');
  }

  // --- Datos base para los reportes contables simplificados ---

  getTotalIngresosPorConcepto(fechaDesde = '', fechaHasta = '') {
    let query = `
      SELECT
        CASE
          WHEN rd.concepto LIKE 'Sostenimiento%' THEN 'Sostenimiento'
          WHEN rd.concepto LIKE 'Abono Punto Nuevo%' THEN 'Nuevos Puntos'
          WHEN rd.concepto LIKE 'Aplicación de saldo a favor%' THEN 'Aplicación saldo a favor'
          WHEN rd.concepto LIKE 'Abono a saldo a favor%' THEN 'Abonos a saldo a favor'
          ELSE 'Otros'
        END as categoria,
        SUM(rd.valor) as total
      FROM recibo_detalles rd
      INNER JOIN recibos r ON r.id = rd.recibo_id
      WHERE 1=1
    `;
    const params = [];
    if (fechaDesde) { query += ' AND r.fecha_recibo >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND r.fecha_recibo <= ?'; params.push(fechaHasta); }
    query += ' GROUP BY categoria';
    return this.db.prepare(query).all(...params);
  }

  getTotalGastosPorTipo(fechaDesde = '', fechaHasta = '') {
    let query = `
      SELECT COALESCE(tipo_gasto, 'Sin clasificar') as tipo_gasto, SUM(valor) as total
      FROM gastos
      WHERE estado != 'Anulado'
    `;
    const params = [];
    if (fechaDesde) { query += ' AND fecha_gasto >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND fecha_gasto <= ?'; params.push(fechaHasta); }
    query += ' GROUP BY tipo_gasto ORDER BY total DESC';
    return this.db.prepare(query).all(...params);
  }

  // Estimado de cuentas por cobrar: meses en mora de cada cuenta activa, valorados a la
  // tarifa vigente HOY de su categoría actual (aproximación simple, no histórica mes a mes,
  // suficiente para un balance "simplificado").
  getCuentasPorCobrarEstimado() {
    const hoy = new Date();
    const periodoActual = hoy.getFullYear() * 12 + hoy.getMonth();

    const rows = this.db.prepare(`
      SELECT c.id, c.fecha_creacion,
        (SELECT MAX(anio * 12 + (mes - 1)) FROM pago_periodos WHERE cuenta_id = c.id) as ultimo_periodo_num,
        (SELECT MIN(fecha_inicio) FROM cuenta_categorias WHERE cuenta_id = c.id) as fecha_inicio_facturacion,
        (
          SELECT ct.tarifa_sostenimiento
          FROM cuenta_categorias cc
          INNER JOIN categoria_tarifas ct ON ct.categoria_id = cc.categoria_id
          WHERE cc.cuenta_id = c.id AND cc.fecha_fin IS NULL
            AND ct.fecha_vigencia_hasta IS NULL
          LIMIT 1
        ) as tarifa_actual
      FROM cuentas c
      WHERE c.estado = 'Activo'
    `).all();

    let total = 0;
    for (const row of rows) {
      const tarifa = row.tarifa_actual || 0;
      let siguienteCod;
      if (row.ultimo_periodo_num !== null && row.ultimo_periodo_num !== undefined) {
        siguienteCod = row.ultimo_periodo_num + 1;
      } else {
        const inicio = anioMesDeFecha(row.fecha_inicio_facturacion || row.fecha_creacion);
        siguienteCod = inicio.anio * 12 + (inicio.mes - 1);
      }
      const mesesMora = Math.max(periodoActual - siguienteCod + 1, 0);
      total += mesesMora * tarifa;
    }

    return total;
  }

  getLibroDiario(fechaDesde = '', fechaHasta = '') {
    let queryIngresos = `
      SELECT r.fecha_recibo as fecha, ('Recibo No. ' || r.numero_recibo || ' - ' || c.codigo) as concepto,
             'Ingreso' as tipo, r.total as valor
      FROM recibos r
      INNER JOIN cuentas c ON c.id = r.cuenta_id
      WHERE 1=1
    `;
    let queryGastos = `
      SELECT fecha_gasto as fecha, concepto, 'Egreso' as tipo, valor
      FROM gastos
      WHERE estado != 'Anulado'
    `;
    const paramsIngresos = [];
    const paramsGastos = [];

    if (fechaDesde) { queryIngresos += ' AND r.fecha_recibo >= ?'; paramsIngresos.push(fechaDesde); queryGastos += ' AND fecha_gasto >= ?'; paramsGastos.push(fechaDesde); }
    if (fechaHasta) { queryIngresos += ' AND r.fecha_recibo <= ?'; paramsIngresos.push(fechaHasta); queryGastos += ' AND fecha_gasto <= ?'; paramsGastos.push(fechaHasta); }

    const ingresos = this.db.prepare(queryIngresos).all(...paramsIngresos);
    const gastos = this.db.prepare(queryGastos).all(...paramsGastos);

    return [...ingresos, ...gastos].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  }
}

module.exports = ReporteRepository;
