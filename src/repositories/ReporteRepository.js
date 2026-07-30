// Extrae año/mes de una fecha 'YYYY-MM-DD' sin pasar por new Date(): evita el desfase de un
// día (y a veces un mes completo) que ocurre en zonas horarias negativas como Colombia (UTC-5).
function anioMesDeFecha(fechaString) {
  const [anio, mes] = fechaString.split(' ')[0].split('-').map(Number);
  return { anio, mes };
}

const CajaRepository = require('./CajaRepository');

class ReporteRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
    this.cajaRepository = new CajaRepository(dbService);
  }

  getCuentas(estado = '') {
    let query = `
      SELECT c.codigo, c.direccion, c.nombre_predio, cat.nombre as categoria, p.nombre_completo as propietario,
             c.estado, c.fecha_creacion,
             c.lat_acometida, c.lon_acometida, c.lat_vivienda, c.lon_vivienda
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

  // es_sistema = 0 excluye al tercero protegido "Tercero no identificado": su falta de datos es
  // intencional, no un vacío administrativo pendiente de completar.
  getTercerosIncompletos() {
    return this.db.prepare(`
      SELECT nombre_razon_social, tipo_identificacion, numero_identificacion, telefono, email, direccion
      FROM terceros
      WHERE activo = 1 AND es_sistema = 0
        AND (numero_identificacion IS NULL OR telefono IS NULL OR telefono = '' OR direccion IS NULL OR direccion = '' OR email IS NULL OR email = '')
      ORDER BY nombre_razon_social ASC
    `).all();
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

  // Un registro por cada renglón de recibo (rd.concepto ya trae el período agrupado cuando
  // aplica, p.ej. "Sostenimiento Enero 2026 - Junio 2026"), no por mes individual: así un mismo
  // recibo que cobró varios meses sale en una sola fila, y se incluyen también los renglones que
  // no son meses de sostenimiento (abono a conexión, aplicación de saldo a favor), que antes no
  // aparecían en este reporte porque la consulta solo miraba pago_periodos.
  getHistorialPagos(fechaDesde = '', fechaHasta = '', cuentaContableId = '', tipoCuenta = '') {
    let query = `
      SELECT c.codigo as cuenta, c.direccion, p.nombre_completo as propietario,
             rd.concepto, rd.valor, r.fecha_recibo as fecha_pago, r.numero_recibo,
             pc.codigo as cuenta_contable_codigo, pc.nombre as cuenta_contable_nombre
      FROM recibo_detalles rd
      INNER JOIN recibos r ON r.id = rd.recibo_id
      INNER JOIN cuentas c ON c.id = r.cuenta_id
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      LEFT JOIN plan_cuentas pc ON pc.id = rd.cuenta_contable_id
      WHERE r.estado != 'Anulado'
    `;
    const params = [];
    if (fechaDesde) { query += ' AND r.fecha_recibo >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND r.fecha_recibo <= ?'; params.push(fechaHasta); }
    if (cuentaContableId) { query += ' AND rd.cuenta_contable_id = ?'; params.push(cuentaContableId); }
    if (tipoCuenta) { query += ' AND pc.tipo = ?'; params.push(tipoCuenta); }
    query += ' ORDER BY r.fecha_recibo DESC, r.numero_recibo DESC';
    return this.db.prepare(query).all(...params);
  }

  getHistorialGastos(fechaDesde = '', fechaHasta = '', cuentaContableId = '', tipoCuenta = '') {
    let query = `
      SELECT g.fecha_gasto, g.concepto, g.tipo_gasto,
             COALESCE(t.nombre_razon_social, g.proveedor) as proveedor,
             g.valor, g.metodo_pago, g.estado,
             pc.codigo as cuenta_contable_codigo, pc.nombre as cuenta_contable_nombre
      FROM gastos g
      LEFT JOIN plan_cuentas pc ON pc.id = g.cuenta_contable_id
      LEFT JOIN terceros t ON t.id = g.tercero_id
      WHERE 1=1
    `;
    const params = [];
    if (fechaDesde) { query += ' AND g.fecha_gasto >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND g.fecha_gasto <= ?'; params.push(fechaHasta); }
    if (cuentaContableId) { query += ' AND g.cuenta_contable_id = ?'; params.push(cuentaContableId); }
    if (tipoCuenta) { query += ' AND pc.tipo = ?'; params.push(tipoCuenta); }
    query += ' ORDER BY g.fecha_gasto DESC';
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

  getIngresosPorPeriodo(fechaDesde = '', fechaHasta = '', cuentaContableId = '', tipoCuenta = '') {
    let query = `
      SELECT r.fecha_recibo, r.numero_recibo, c.codigo as cuenta,
        (SELECT GROUP_CONCAT(concepto, ' | ') FROM recibo_detalles WHERE recibo_id = r.id) as conceptos,
        (SELECT GROUP_CONCAT(DISTINCT pc.nombre) FROM recibo_detalles rd2
           INNER JOIN plan_cuentas pc ON pc.id = rd2.cuenta_contable_id WHERE rd2.recibo_id = r.id) as cuentas_contables,
        r.total, r.metodo_pago
      FROM recibos r
      INNER JOIN cuentas c ON c.id = r.cuenta_id
      WHERE r.estado != 'Anulado'
    `;
    const params = [];
    if (fechaDesde) { query += ' AND r.fecha_recibo >= ?'; params.push(fechaDesde); }
    if (fechaHasta) { query += ' AND r.fecha_recibo <= ?'; params.push(fechaHasta); }
    if (cuentaContableId) {
      query += ' AND EXISTS (SELECT 1 FROM recibo_detalles rd3 WHERE rd3.recibo_id = r.id AND rd3.cuenta_contable_id = ?)';
      params.push(cuentaContableId);
    }
    if (tipoCuenta) {
      query += ` AND EXISTS (
        SELECT 1 FROM recibo_detalles rd4
        INNER JOIN plan_cuentas pc4 ON pc4.id = rd4.cuenta_contable_id
        WHERE rd4.recibo_id = r.id AND pc4.tipo = ?
      )`;
      params.push(tipoCuenta);
    }
    query += ' ORDER BY r.fecha_recibo DESC, r.numero_recibo DESC';
    return this.db.prepare(query).all(...params);
  }

  getGastosPorPeriodo(fechaDesde = '', fechaHasta = '', cuentaContableId = '', tipoCuenta = '') {
    return this.getHistorialGastos(fechaDesde, fechaHasta, cuentaContableId, tipoCuenta).filter(g => g.estado !== 'Anulado');
  }

  // Cartera por edades (Aging): una fila por cuenta activa con mora, indicando en qué rango
  // de antigüedad cae su deuda. Los rangos son: 1-3 meses, 4-6 meses, 7-12 meses, >12 meses.
  // El valor se estima con la tarifa vigente actual (no histórica mes a mes).
  getCartedaPorEdades() {
    const hoy = new Date();
    const periodoActual = hoy.getFullYear() * 12 + hoy.getMonth(); // año*12 + (mes-1, 0-indexed)

    const rows = this.db.prepare(`
      SELECT c.id, c.codigo, c.direccion,
        p.nombre_completo as propietario,
        (SELECT MAX(anio * 12 + (mes - 1)) FROM pago_periodos WHERE cuenta_id = c.id) as ultimo_periodo_num,
        (SELECT MAX(r.fecha_recibo) FROM pago_periodos pp
           INNER JOIN recibo_detalles rd ON rd.id = pp.recibo_detalle_id
           INNER JOIN recibos r ON r.id = rd.recibo_id AND r.estado != 'Anulado'
           WHERE pp.cuenta_id = c.id) as fecha_ultimo_pago,
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
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      WHERE c.estado = 'Activo'
      ORDER BY c.codigo ASC
    `).all();

    const filas = [];
    for (const row of rows) {
      let siguienteCod;
      if (row.ultimo_periodo_num !== null && row.ultimo_periodo_num !== undefined) {
        siguienteCod = row.ultimo_periodo_num + 1;
      } else {
        const inicio = anioMesDeFecha(row.fecha_inicio_facturacion || '2000-01-01');
        siguienteCod = inicio.anio * 12 + (inicio.mes - 1);
      }
      const mesesMora = Math.max(periodoActual - siguienteCod + 1, 0);
      if (mesesMora === 0) continue; // sin mora, no va en el reporte

      const tarifa = row.tarifa_actual || 0;
      const valorEstimado = mesesMora * tarifa;

      let rango;
      if (mesesMora <= 3) rango = '1-3 meses';
      else if (mesesMora <= 6) rango = '4-6 meses';
      else if (mesesMora <= 12) rango = '7-12 meses';
      else rango = 'Más de 12 meses';

      filas.push({
        codigo: row.codigo,
        direccion: row.direccion,
        propietario: row.propietario,
        fecha_ultimo_pago: row.fecha_ultimo_pago || null,
        meses_mora: mesesMora,
        rango_mora: rango,
        tarifa_mensual: tarifa,
        valor_estimado: valorEstimado
      });
    }

    return filas;
  }

  // Dashboard contable: KPIs del período actual para la pantalla de inicio del módulo.
  getDashboardContable() {
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth() + 1;
    const primerDiaMes = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDiaMes = new Date(anio, mes, 0).toISOString().split('T')[0];

    const ingresosMes = this.db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM recibos
      WHERE estado != 'Anulado'
        AND fecha_recibo BETWEEN ? AND ?
    `).get(primerDiaMes, ultimoDiaMes).total;

    const gastosMes = this.db.prepare(`
      SELECT COALESCE(SUM(valor), 0) as total
      FROM gastos
      WHERE estado != 'Anulado'
        AND fecha_gasto BETWEEN ? AND ?
    `).get(primerDiaMes, ultimoDiaMes).total;

    // Reutiliza EXACTAMENTE la misma fórmula que ya usan correctamente el Dashboard general y
    // la pantalla de Caja (CajaRepository.getSaldo): saldo inicial configurado + ingresos -
    // egresos/traslados salientes + traslados entrantes. Antes, este método reimplementaba su
    // propia fórmula que ignoraba el saldo inicial y solo miraba `origen`, nunca `destino`, así
    // que cualquier traslado interno (consignación, retiro) hacía "desaparecer" ese dinero del
    // tablero — hallazgo Crítico C-3 de la auditoría de Contabilidad (2026-07-03).
    const saldoCaja = this.cajaRepository.getSaldoCaja();
    const saldoBanco = this.cajaRepository.getSaldoBanco();

    const cuentasMora = this.db.prepare(`
      SELECT COUNT(*) as total
      FROM cuentas c
      WHERE c.estado = 'Activo'
        AND (SELECT MAX(anio * 12 + (mes - 1)) FROM pago_periodos WHERE cuenta_id = c.id)
          < (? * 12 + ? - 1)
    `).get(anio, mes).total;

    const periodoActual = this.db.prepare(`
      SELECT * FROM periodos_contables WHERE anio = ? AND mes = ?
    `).get(anio, mes);

    return {
      anio, mes, primerDiaMes, ultimoDiaMes,
      ingresosMes,
      gastosMes,
      resultadoMes: ingresosMes - gastosMes,
      saldoCaja,
      saldoBanco,
      saldoDisponible: saldoCaja + saldoBanco,
      cuentasMora,
      periodoActual: periodoActual || { anio, mes, estado: 'Sin registro' }
    };
  }

  // --- Datos base para los reportes contables simplificados ---

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

}

module.exports = ReporteRepository;
