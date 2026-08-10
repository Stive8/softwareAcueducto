const CajaRepository = require('./CajaRepository');
const CarteraService = require('../services/CarteraService');
const { codificarPeriodo } = require('../services/cartera/periodos');
const { redondear } = require('../services/cartera/dinero');

class ReporteRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
    this.cajaRepository = new CajaRepository(dbService);
    this.carteraService = new CarteraService(dbService);
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
  //
  // "Último período pagado" sale de cubiertoHasta (CarteraService), no de pago_periodos: un
  // hueco viejo nunca desaparece detrás de un pago más reciente (ver
  // docs/superpowers/specs/2026-08-10-fase2-reportes-dashboard-design.md). deuda_antes_2024 se
  // agrega aparte -- una cuenta puede estar al día en sus meses 2024+ y aun así deber la
  // apertura opaca; eso también cuenta como estar en mora, decisión del servicio que consume
  // esto, no de esta consulta.
  //
  // meses_impagos NO es (periodo_actual - ultimo_periodo_num): ese rango cuenta todo lo que pasó
  // desde el primer hueco aunque ya se haya puesto al día después (cubiertoHasta se congela ahí
  // a propósito). meses_impagos es la cuenta real de meses con saldo pendiente (mesesImpagos de
  // CarteraService, ver el caso R007 en el spec): un hueco viejo de un mes con todo lo posterior
  // pagado cuenta 1 (más el mes corriente si aplica), no 20.
  getCuentasConUltimoPeriodo() {
    const cuentas = this.db.prepare(`
      SELECT c.id, c.codigo, c.direccion, c.fecha_creacion,
             p.nombre_completo as propietario
      FROM cuentas c
      LEFT JOIN cuenta_propietarios cp ON cp.cuenta_id = c.id AND cp.fecha_fin IS NULL
      LEFT JOIN propietarios p ON p.id = cp.propietario_id
      WHERE c.estado = 'Activo'
      ORDER BY c.codigo ASC
    `).all();

    const indicadores = new Map(
      this.carteraService.getIndicadoresMoraTodas(cuentas.map(c => c.id)).map(i => [i.cuentaId, i])
    );

    return cuentas.map(c => {
      const ind = indicadores.get(c.id);
      const ultimo_periodo_num = ind.cubiertoHasta ? codificarPeriodo(ind.cubiertoHasta.anio, ind.cubiertoHasta.mes) : null;
      // Solo se calcula el ancla de arranque (más cara: consulta CargoMensual/pago_periodos/
      // recibos/fecha_creacion) cuando hace falta -- si ya hay cubiertoHasta no se usa para nada.
      const fecha_inicio_facturacion = ultimo_periodo_num === null
        ? (this.carteraService.getFechaInicioFacturacion(c.id) || c.fecha_creacion)
        : null;
      return {
        codigo: c.codigo, direccion: c.direccion, fecha_creacion: c.fecha_creacion, propietario: c.propietario,
        ultimo_periodo_num,
        fecha_inicio_facturacion,
        deuda_antes_2024: ind.deudaAntes2024,
        meses_impagos: ind.mesesImpagos
      };
    });
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
  //
  // meses_mora y el rango salen de meses_impagos/mes_mas_antiguo_impago (CarteraService), no de
  // (periodo_actual - cubiertoHasta): ese rango cuenta todo lo que pasó desde el primer hueco
  // aunque ya se haya puesto al día después, así que un hueco de un solo mes con todo lo
  // posterior pagado salía clasificado en "Más de 12 meses" por antigüedad del hueco, con un
  // valor_estimado inflado por meses ya pagados (caso R007, ver
  // docs/superpowers/specs/2026-08-10-fase2-reportes-dashboard-design.md). El rango ahora mira
  // la antigüedad del mes impago MÁS ANTIGUO -- para R007 (dic-2024) eso sigue siendo "Más de 12
  // meses" porque el hueco en sí es viejo, pero meses_mora y valor_estimado ahora reflejan la
  // deuda real (2 meses, $28.000), no el rango completo.
  //
  // El valor ya no se estima con mesesMora × tarifa vigente: se usa aPagar (CarteraService),
  // suma real mes a mes de lo pendiente -- mismo criterio que ya usa getCuentasPorCobrarEstimado.
  //
  // La deuda anterior a 2024 (deuda_antes_2024) entra siempre en "Más de 12 meses" -- por
  // definición nunca es más reciente que eso -- y una cuenta con SOLO esa deuda (al día en sus
  // meses 2024+) ahora SÍ aparece en el reporte, cosa que antes no pasaba (ver spec). El punto
  // de conexión pendiente queda fuera a propósito: no tiene dimensión temporal, es un cargo único.
  getCartedaPorEdades() {
    const hoy = new Date();
    const periodoActual = hoy.getFullYear() * 12 + hoy.getMonth(); // año*12 + (mes-1, 0-indexed)

    const rows = this.db.prepare(`
      SELECT c.id, c.codigo, c.direccion,
        p.nombre_completo as propietario,
        (SELECT MAX(fecha) FROM cartera_movimientos WHERE cuenta_id = c.id AND tipo = 'Abono') as fecha_ultimo_pago,
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

    const indicadores = new Map(
      this.carteraService.getIndicadoresMoraTodas(rows.map(r => r.id)).map(i => [i.cuentaId, i])
    );

    const filas = [];
    for (const row of rows) {
      const ind = indicadores.get(row.id);
      const deudaAntes2024 = ind.deudaAntes2024;
      const mesesMora = ind.mesesImpagos;
      if (mesesMora === 0 && deudaAntes2024 === 0) continue; // sin ninguna deuda, no va en el reporte

      const valorEstimado = redondear(deudaAntes2024 + ind.aPagar);

      let rango;
      if (deudaAntes2024 > 0) {
        rango = 'Más de 12 meses';
      } else {
        const antiguedadMeses = periodoActual - codificarPeriodo(ind.mesMasAntiguoImpago.anio, ind.mesMasAntiguoImpago.mes) + 1;
        if (antiguedadMeses <= 3) rango = '1-3 meses';
        else if (antiguedadMeses <= 6) rango = '4-6 meses';
        else if (antiguedadMeses <= 12) rango = '7-12 meses';
        else rango = 'Más de 12 meses';
      }

      filas.push({
        codigo: row.codigo,
        direccion: row.direccion,
        propietario: row.propietario,
        fecha_ultimo_pago: row.fecha_ultimo_pago || null,
        meses_mora: mesesMora,
        deuda_antes_2024: deudaAntes2024,
        rango_mora: rango,
        tarifa_mensual: row.tarifa_actual || 0,
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

    // En mora = debe algo en 2024+ (cubiertoHasta no llega al mes actual) O tiene deuda
    // anterior a 2024 pendiente, aunque esté al día en lo corriente -- mismo criterio que
    // procesarEstadoCuentas/reporteCuentasEnMora (ver
    // docs/superpowers/specs/2026-08-10-fase2-reportes-dashboard-design.md). El punto de
    // conexión NO cuenta para esto a propósito.
    const periodoActualCod = anio * 12 + (mes - 1);
    const idsActivas = this.db.prepare(`SELECT id FROM cuentas WHERE estado = 'Activo'`).all().map(r => r.id);
    const cuentasMora = this.carteraService.getIndicadoresMoraTodas(idsActivas).filter(ind => {
      const cubiertoCod = ind.cubiertoHasta ? codificarPeriodo(ind.cubiertoHasta.anio, ind.cubiertoHasta.mes) : -1;
      return cubiertoCod < periodoActualCod || ind.deudaAntes2024 > 0;
    }).length;

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

  // Estimado de cuentas por cobrar, desglosado en las tres deudas reales de cartera: anterior
  // al corte de 2024 (apertura opaca), desde 2024 (deudaExigible) y punto de conexión
  // pendiente. Ya no se reconstruye "meses en mora × tarifa vigente" -- se usa directo
  // deudaExigible, la cifra que ya está validada y reconciliada (282/13), en vez de una
  // aproximación paralela que puede no coincidir con ella. Ver
  // docs/superpowers/specs/2026-08-10-fase2-reportes-dashboard-design.md.
  getCuentasPorCobrarEstimado() {
    const idsActivas = this.db.prepare(`SELECT id FROM cuentas WHERE estado = 'Activo'`).all().map(r => r.id);
    const indicadores = this.carteraService.getIndicadoresMoraTodas(idsActivas);

    let deudaAntes2024 = 0, deudaExigible = 0, deudaPuntoConexion = 0;
    for (const ind of indicadores) {
      deudaAntes2024 += ind.deudaAntes2024;
      if (ind.deudaExigible > 0) deudaExigible += ind.deudaExigible;
      deudaPuntoConexion += ind.deudaPuntoConexion;
    }

    return {
      deudaAntes2024: redondear(deudaAntes2024),
      deudaExigible: redondear(deudaExigible),
      deudaPuntoConexion: redondear(deudaPuntoConexion),
      total: redondear(deudaAntes2024 + deudaExigible + deudaPuntoConexion)
    };
  }

}

module.exports = ReporteRepository;
