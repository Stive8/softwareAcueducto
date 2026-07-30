const ReporteRepository = require('../repositories/ReporteRepository');
const CajaRepository = require('../repositories/CajaRepository');
const AuditoriaRepository = require('../repositories/AuditoriaRepository');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');
const AsientoContableService = require('./AsientoContableService');
const PlantillaReporteService = require('./PlantillaReporteService');

const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Extrae año/mes de una fecha 'YYYY-MM-DD' sin pasar por new Date(): evita el desfase de un
// día (y a veces un mes completo) que ocurre en zonas horarias negativas como Colombia (UTC-5).
function anioMesDeFecha(fechaString) {
  const [anio, mes] = fechaString.split(' ')[0].split('-').map(Number);
  return { anio, mes };
}

class ReporteService {
  constructor(dbService) {
    this.repository = new ReporteRepository(dbService);
    this.cajaRepository = new CajaRepository(dbService);
    this.auditoriaRepository = new AuditoriaRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
    this.plantillaReporteService = new PlantillaReporteService(dbService);
  }

  // Para mostrar en "Filtros utilizados" el nombre de la cuenta en vez de solo su id interno.
  _nombreCuentaContable(cuentaContableId) {
    if (!cuentaContableId) return null;
    const cuenta = this.planCuentaRepository.findById(cuentaContableId);
    return cuenta ? `${cuenta.codigo} - ${cuenta.nombre}` : null;
  }

  // Devuelve un objeto estructurado { tipo: 'tabla'|'resumen', titulo, columnas, filas, secciones }
  // que sirve por igual de insumo para el PDF y para el Excel.
  getReporte(tipoReporte, params = {}) {
    switch (tipoReporte) {
      case 'cuentas':
        return this.reporteCuentas(params);
      case 'propietarios':
        return this.reportePropietarios();
      case 'historial_pagos':
        return this.reporteHistorialPagos(params);
      case 'historial_gastos':
        return this.reporteHistorialGastos(params);
      case 'cuentas_al_dia':
        return this.reporteCuentasAlDia();
      case 'cuentas_en_mora':
        return this.reporteCuentasEnMora();
      case 'cuentas_saldo_favor':
        return this.reporteCuentasSaldoFavor();
      case 'nuevos_puntos':
        return this.reporteNuevosPuntos();
      case 'ingresos_periodo':
        return this.reporteIngresosPeriodo(params);
      case 'gastos_periodo':
        return this.reporteGastosPeriodo(params);
      case 'balance_general':
        return this.reporteBalanceGeneral(params);
      case 'estado_resultados':
        return this.reporteEstadoResultados(params);
      case 'flujo_caja':
        return this.reporteFlujoCaja(params);
      case 'libro_diario':
        return this.reporteLibroDiario(params);
      case 'libro_mayor':
        return this.reporteLibroMayor(params);
      case 'balance_prueba':
        return this.reporteBalancePrueba(params);
      case 'balance_prueba_tercero':
        return this.reporteBalancePruebaPorTercero(params);
      case 'informe_empalme':
        return this.reporteInformeEmpalme(params);
      case 'terceros_incompletos':
        return this.reporteTercerosIncompletos();
      case 'cartera_por_edades':
        return this.reporteCarteraPorEdades();
      default:
        throw new Error('Tipo de reporte no reconocido');
    }
  }

  reporteCuentas({ estado = '' } = {}) {
    const filas = this.repository.getCuentas(estado);
    return {
      tipo: 'tabla',
      titulo: estado ? `Cuentas ${estado}s` : 'Todas las Cuentas',
      periodo: null,
      filtros: estado ? [{ label: 'Estado', valor: estado }] : [],
      columnas: [
        { key: 'codigo', label: 'Código' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'nombre_predio', label: 'Nombre de Predio' },
        { key: 'categoria', label: 'Categoría' },
        { key: 'propietario', label: 'Propietario' },
        { key: 'estado', label: 'Estado' },
        { key: 'fecha_creacion', label: 'Fecha Creación', tipo: 'fecha' },
        { key: 'lat_acometida', label: 'Latitud Acometida' },
        { key: 'lon_acometida', label: 'Longitud Acometida' },
        { key: 'lat_vivienda', label: 'Latitud Vivienda' },
        { key: 'lon_vivienda', label: 'Longitud Vivienda' }
      ],
      filas
    };
  }

  reporteTercerosIncompletos() {
    const filas = this.repository.getTercerosIncompletos();
    return {
      tipo: 'tabla',
      titulo: 'Terceros con Información Incompleta',
      periodo: null,
      filtros: [],
      columnas: [
        { key: 'nombre_razon_social', label: 'Nombre / Razón Social' },
        { key: 'tipo_identificacion', label: 'Tipo de Identificación' },
        { key: 'numero_identificacion', label: 'Número de Identificación' },
        { key: 'telefono', label: 'Teléfono' },
        { key: 'email', label: 'Correo' },
        { key: 'direccion', label: 'Dirección' }
      ],
      filas
    };
  }

  reportePropietarios() {
    return {
      tipo: 'tabla',
      titulo: 'Propietarios',
      periodo: null,
      filtros: [],
      columnas: [
        { key: 'nombre_completo', label: 'Nombre Completo' },
        { key: 'numero_identificacion', label: 'Identificación' },
        { key: 'telefono', label: 'Teléfono' },
        { key: 'email', label: 'Correo' },
        { key: 'cuentas_actuales', label: 'Cuentas Actuales' }
      ],
      filas: this.repository.getPropietarios()
    };
  }

  reporteHistorialPagos({ fechaDesde = '', fechaHasta = '', cuentaContableId = '', tipoCuenta = '' } = {}) {
    const filas = this.repository.getHistorialPagos(fechaDesde, fechaHasta, cuentaContableId, tipoCuenta);

    return {
      tipo: 'tabla',
      titulo: 'Historial de Aportes',
      periodo: (fechaDesde || fechaHasta) ? { tipo: 'rango', fechaDesde, fechaHasta } : null,
      filtros: [
        this._nombreCuentaContable(cuentaContableId) && { label: 'Cuenta Contable', valor: this._nombreCuentaContable(cuentaContableId) },
        tipoCuenta && { label: 'Tipo de Cuenta', valor: tipoCuenta }
      ].filter(Boolean),
      columnas: [
        { key: 'cuenta', label: 'Cuenta' },
        { key: 'propietario', label: 'Propietario' },
        { key: 'concepto', label: 'Concepto / Período' },
        { key: 'valor', label: 'Valor', tipo: 'moneda' },
        { key: 'fecha_pago', label: 'Fecha de Pago', tipo: 'fecha' },
        { key: 'numero_recibo', label: 'No. Recibo' },
        { key: 'cuenta_contable_codigo', label: 'Código Cuenta Contable' },
        { key: 'cuenta_contable_nombre', label: 'Nombre Cuenta Contable' }
      ],
      filas,
      totales: { valor: filas.reduce((s, f) => s + f.valor, 0) }
    };
  }

  reporteHistorialGastos({ fechaDesde = '', fechaHasta = '', cuentaContableId = '', tipoCuenta = '' } = {}) {
    const filas = this.repository.getHistorialGastos(fechaDesde, fechaHasta, cuentaContableId, tipoCuenta);
    return {
      tipo: 'tabla',
      titulo: 'Historial de Gastos',
      periodo: (fechaDesde || fechaHasta) ? { tipo: 'rango', fechaDesde, fechaHasta } : null,
      filtros: [
        this._nombreCuentaContable(cuentaContableId) && { label: 'Cuenta Contable', valor: this._nombreCuentaContable(cuentaContableId) },
        tipoCuenta && { label: 'Tipo de Cuenta', valor: tipoCuenta }
      ].filter(Boolean),
      columnas: [
        { key: 'fecha_gasto', label: 'Fecha', tipo: 'fecha' },
        { key: 'concepto', label: 'Concepto' },
        { key: 'tipo_gasto', label: 'Tipo' },
        { key: 'proveedor', label: 'Proveedor' },
        { key: 'valor', label: 'Valor', tipo: 'moneda' },
        { key: 'metodo_pago', label: 'Método de Pago' },
        { key: 'estado', label: 'Estado' },
        { key: 'cuenta_contable_codigo', label: 'Código Cuenta Contable' },
        { key: 'cuenta_contable_nombre', label: 'Nombre Cuenta Contable' }
      ],
      filas,
      totales: { valor: filas.filter(f => f.estado !== 'Anulado').reduce((s, f) => s + f.valor, 0) }
    };
  }

  procesarEstadoCuentas() {
    const ahora = new Date();
    const periodoActual = ahora.getFullYear() * 12 + ahora.getMonth();

    return this.repository.getCuentasConUltimoPeriodo().map(c => {
      let pagadoHasta = null;
      let siguienteCod;

      if (c.ultimo_periodo_num !== null && c.ultimo_periodo_num !== undefined) {
        const anio = Math.floor(c.ultimo_periodo_num / 12);
        const mes = (c.ultimo_periodo_num % 12) + 1;
        pagadoHasta = `${NOMBRES_MES[mes - 1]} ${anio}`;
        siguienteCod = c.ultimo_periodo_num + 1;
      } else {
        const inicio = anioMesDeFecha(c.fecha_inicio_facturacion || c.fecha_creacion);
        siguienteCod = inicio.anio * 12 + (inicio.mes - 1);
      }

      const mesesMora = Math.max(periodoActual - siguienteCod + 1, 0);
      return { ...c, pagado_hasta: pagadoHasta, meses_mora: mesesMora };
    });
  }

  reporteCuentasAlDia() {
    const filas = this.procesarEstadoCuentas().filter(c => c.meses_mora === 0);
    return {
      tipo: 'tabla',
      titulo: 'Cuentas al Día',
      periodo: null,
      filtros: [],
      columnas: [
        { key: 'codigo', label: 'Código' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'propietario', label: 'Propietario' },
        { key: 'pagado_hasta', label: 'Pagado Hasta' }
      ],
      filas
    };
  }

  reporteCuentasEnMora() {
    const filas = this.procesarEstadoCuentas().filter(c => c.meses_mora > 0);
    return {
      tipo: 'tabla',
      titulo: 'Cuentas en Mora',
      periodo: null,
      filtros: [],
      columnas: [
        { key: 'codigo', label: 'Código' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'propietario', label: 'Propietario' },
        { key: 'pagado_hasta', label: 'Pagado Hasta' },
        { key: 'meses_mora', label: 'Meses en Mora' }
      ],
      filas
    };
  }

  reporteCuentasSaldoFavor() {
    return {
      tipo: 'tabla',
      titulo: 'Cuentas con Saldo a Favor',
      periodo: null,
      filtros: [],
      columnas: [
        { key: 'codigo', label: 'Código' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'propietario', label: 'Propietario' },
        { key: 'saldo', label: 'Saldo a Favor', tipo: 'moneda' }
      ],
      filas: this.repository.getCuentasConSaldoAFavor()
    };
  }

  reporteNuevosPuntos() {
    return {
      tipo: 'tabla',
      titulo: 'Estado de Nuevos Puntos',
      periodo: null,
      filtros: [],
      columnas: [
        { key: 'cuenta', label: 'Cuenta' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'valor_total', label: 'Valor Total', tipo: 'moneda' },
        { key: 'total_abonado', label: 'Total Abonado', tipo: 'moneda' },
        { key: 'saldo_pendiente', label: 'Saldo Pendiente', tipo: 'moneda' },
        { key: 'estado', label: 'Estado' },
        { key: 'fecha_registro', label: 'Fecha Registro', tipo: 'fecha' }
      ],
      filas: this.repository.getEstadoNuevosPuntos()
    };
  }

  reporteIngresosPeriodo({ fechaDesde = '', fechaHasta = '', cuentaContableId = '', tipoCuenta = '' } = {}) {
    const filas = this.repository.getIngresosPorPeriodo(fechaDesde, fechaHasta, cuentaContableId, tipoCuenta).map(f => ({
      ...f,
      cuentas_contables: f.cuentas_contables || '-'
    }));
    return {
      tipo: 'tabla',
      titulo: 'Ingresos por Período',
      periodo: (fechaDesde || fechaHasta) ? { tipo: 'rango', fechaDesde, fechaHasta } : null,
      filtros: [
        this._nombreCuentaContable(cuentaContableId) && { label: 'Cuenta Contable', valor: this._nombreCuentaContable(cuentaContableId) },
        tipoCuenta && { label: 'Tipo de Cuenta', valor: tipoCuenta }
      ].filter(Boolean),
      columnas: [
        { key: 'fecha_recibo', label: 'Fecha', tipo: 'fecha' },
        { key: 'numero_recibo', label: 'No. Recibo' },
        { key: 'cuenta', label: 'Cuenta' },
        { key: 'conceptos', label: 'Conceptos' },
        { key: 'total', label: 'Total', tipo: 'moneda' },
        { key: 'metodo_pago', label: 'Método de Pago' },
        { key: 'cuentas_contables', label: 'Cuentas Contables' }
      ],
      filas,
      totales: { total: filas.reduce((s, f) => s + f.total, 0) }
    };
  }

  reporteGastosPeriodo({ fechaDesde = '', fechaHasta = '', cuentaContableId = '', tipoCuenta = '' } = {}) {
    const filas = this.repository.getGastosPorPeriodo(fechaDesde, fechaHasta, cuentaContableId, tipoCuenta);
    return {
      tipo: 'tabla',
      titulo: 'Gastos por Período',
      periodo: (fechaDesde || fechaHasta) ? { tipo: 'rango', fechaDesde, fechaHasta } : null,
      filtros: [
        this._nombreCuentaContable(cuentaContableId) && { label: 'Cuenta Contable', valor: this._nombreCuentaContable(cuentaContableId) },
        tipoCuenta && { label: 'Tipo de Cuenta', valor: tipoCuenta }
      ].filter(Boolean),
      columnas: [
        { key: 'fecha_gasto', label: 'Fecha', tipo: 'fecha' },
        { key: 'concepto', label: 'Concepto' },
        { key: 'tipo_gasto', label: 'Tipo' },
        { key: 'valor', label: 'Valor', tipo: 'moneda' },
        { key: 'cuenta_contable_codigo', label: 'Código Cuenta Contable' },
        { key: 'cuenta_contable_nombre', label: 'Nombre Cuenta Contable' }
      ],
      filas,
      totales: { valor: filas.reduce((s, f) => s + f.valor, 0) }
    };
  }

  // Balance General: se deriva de la misma fuente que el Balance de Prueba (movimientos_contables,
  // la doble partida real), no de la tabla simple de caja/banco — así Activo siempre cuadra con
  // Pasivo + Patrimonio por construcción, y los dos reportes nunca pueden divergir entre sí.
  // Como este sistema no hace un cierre de ejercicio formal (que trasladaría el saldo de las
  // cuentas de Ingreso/Gasto/Costo a una cuenta de Patrimonio), el "Resultado del Ejercicio" se
  // calcula aquí mismo, acumulado desde el inicio hasta la fecha de corte, y se suma al
  // Patrimonio registrado: es la identidad contable que garantiza que el balance cuadre siempre,
  // sin necesidad de un asiento de cierre.
  reporteBalanceGeneral({ fechaCorte = '' } = {}) {
    const corte = fechaCorte || new Date().toISOString().split('T')[0];
    const { filas } = this.asientoContableService.getBalancePrueba('', corte);

    const sumarSaldo = (tipo) => filas.filter(f => f.tipo === tipo).reduce((s, f) => s + f.saldo, 0);
    const itemsPorTipo = (tipo) => filas.filter(f => f.tipo === tipo).map(f => ({ label: `${f.codigo} - ${f.nombre}`, valor: f.saldo }));

    const totalActivos = sumarSaldo('Activo');
    const totalPasivos = sumarSaldo('Pasivo');
    const patrimonioRegistrado = sumarSaldo('Patrimonio');
    const resultadoEjercicio = sumarSaldo('Ingreso') - sumarSaldo('Gasto') - sumarSaldo('Costo');
    const totalPatrimonio = patrimonioRegistrado + resultadoEjercicio;

    const cuentasPorCobrar = this.repository.getCuentasPorCobrarEstimado();

    return {
      tipo: 'resumen',
      titulo: 'Balance General',
      fecha: corte,
      periodo: { tipo: 'corte', fecha: corte },
      filtros: [],
      secciones: [
        {
          titulo: 'Activos',
          items: itemsPorTipo('Activo').length > 0 ? itemsPorTipo('Activo') : [{ label: 'Sin movimientos registrados', valor: 0 }],
          total: totalActivos
        },
        {
          titulo: 'Pasivos',
          items: itemsPorTipo('Pasivo').length > 0 ? itemsPorTipo('Pasivo') : [{ label: 'Sin pasivos registrados', valor: 0 }],
          total: totalPasivos
        },
        {
          titulo: 'Patrimonio',
          items: [
            ...itemsPorTipo('Patrimonio'),
            { label: 'Resultado del Ejercicio (Ingresos - Gastos - Costos, acumulado a la fecha)', valor: resultadoEjercicio }
          ],
          total: totalPatrimonio
        },
        // Fuera de la ecuación Activo = Pasivo + Patrimonio a propósito: este sistema reconoce
        // el ingreso por sostenimiento solo cuando se recibe el pago (no cuando se causa la
        // mora), así que la cartera pendiente no tiene una cuenta por cobrar contabilizada que
        // sumar al Activo. Se muestra aparte, como memo informativo.
        {
          titulo: 'Cartera Pendiente (informativo, no incluida en el balance contable)',
          items: [{ label: 'Estimado por meses en mora a la tarifa vigente', valor: cuentasPorCobrar }],
          total: cuentasPorCobrar
        }
      ]
    };
  }

  // Estado de Resultados: misma fuente que el Balance de Prueba y el Balance General
  // (movimientos_contables), filtrado a las cuentas de resultado (Ingreso/Gasto/Costo) del
  // período. Al usar la misma fuente, el "Resultado del Ejercicio" acumulado que se ve en el
  // Balance General y el "Resultado del Período" que se ve aquí son consistentes entre sí: la
  // diferencia entre ambos números es exactamente el resultado acumulado ANTES de fechaDesde
  // (igual que en cualquier balance contra estado de resultados real).
  reporteEstadoResultados({ fechaDesde = '', fechaHasta = '' } = {}) {
    const { filas } = this.asientoContableService.getBalancePrueba(fechaDesde, fechaHasta);

    const itemsPorTipo = (tipo) => filas.filter(f => f.tipo === tipo).map(f => ({ label: `${f.codigo} - ${f.nombre}`, valor: f.saldo }));
    const sumarSaldo = (tipo) => filas.filter(f => f.tipo === tipo).reduce((s, f) => s + f.saldo, 0);

    const totalIngresos = sumarSaldo('Ingreso');
    const totalGastos = sumarSaldo('Gasto');
    const totalCostos = sumarSaldo('Costo');
    const resultado = totalIngresos - totalGastos - totalCostos;

    const seccionesGastosCostos = [
      {
        titulo: 'Gastos',
        items: itemsPorTipo('Gasto').length > 0 ? itemsPorTipo('Gasto') : [{ label: 'Sin gastos en el período', valor: 0 }],
        total: totalGastos
      }
    ];
    if (itemsPorTipo('Costo').length > 0) {
      seccionesGastosCostos.push({ titulo: 'Costos', items: itemsPorTipo('Costo'), total: totalCostos });
    }

    return {
      tipo: 'resumen',
      titulo: 'Estado de Resultados',
      periodo: { tipo: 'rango', fechaDesde, fechaHasta },
      filtros: [],
      secciones: [
        {
          titulo: 'Ingresos',
          items: itemsPorTipo('Ingreso').length > 0 ? itemsPorTipo('Ingreso') : [{ label: 'Sin ingresos en el período', valor: 0 }],
          total: totalIngresos
        },
        ...seccionesGastosCostos,
        {
          titulo: 'Resultado del Período',
          items: [{ label: 'Ingresos - Gastos - Costos', valor: resultado }],
          total: resultado
        }
      ]
    };
  }

  // Flujo de Caja: a diferencia del Estado de Resultados (que clasifica por concepto/tipo),
  // este reporte muestra el movimiento real de efectivo: cuánto había, cuánto entró, cuánto
  // salió, y cuánto queda. Caja y Banco se presentan combinados (ver getResumenFlujoCaja).
  reporteFlujoCaja({ fechaDesde = '', fechaHasta = '' } = {}) {
    const { saldoInicial, entradas, salidas, saldoFinal } = this.cajaRepository.getResumenFlujoCaja(fechaDesde, fechaHasta);

    return {
      tipo: 'resumen',
      titulo: 'Flujo de Caja',
      periodo: { tipo: 'rango', fechaDesde, fechaHasta },
      filtros: [],
      secciones: [
        {
          titulo: 'Saldo Inicial (Caja + Banco)',
          items: [{ label: 'Saldo al inicio del período', valor: saldoInicial }],
          total: saldoInicial
        },
        {
          titulo: 'Entradas de Dinero',
          items: [{ label: 'Total ingresos del período', valor: entradas }],
          total: entradas
        },
        {
          titulo: 'Salidas de Dinero',
          items: [{ label: 'Total gastos del período', valor: salidas }],
          total: salidas
        },
        {
          titulo: 'Saldo Final (Caja + Banco)',
          items: [{ label: 'Saldo Inicial + Entradas - Salidas', valor: saldoFinal }],
          total: saldoFinal
        }
      ]
    };
  }

  // Libro Diario real, de doble partida: una fila por línea de asiento (débito/crédito a una
  // cuenta), agrupadas visualmente por número de asiento. Reemplaza la versión simplificada
  // anterior (que solo listaba ingresos y egresos en una columna) ahora que cada gasto, recibo
  // y traslado de caja/banco genera su asiento automáticamente.
  reporteLibroDiario({ fechaDesde = '', fechaHasta = '', tipoCuenta = '' } = {}) {
    const filas = this.asientoContableService.getLibroDiario(fechaDesde, fechaHasta, tipoCuenta);

    return {
      tipo: 'tabla',
      titulo: tipoCuenta ? `Libro Diario - Cuentas de ${tipoCuenta}` : 'Libro Diario',
      periodo: (fechaDesde || fechaHasta) ? { tipo: 'rango', fechaDesde, fechaHasta } : null,
      filtros: tipoCuenta ? [{ label: 'Tipo de Cuenta', valor: tipoCuenta }] : [],
      columnas: [
        { key: 'numero_asiento', label: 'Asiento No.' },
        { key: 'fecha', label: 'Fecha', tipo: 'fecha' },
        { key: 'concepto_asiento', label: 'Concepto' },
        { key: 'cuenta_nombre', label: 'Nombre de la Cuenta Contable' },
        { key: 'cuenta_codigo', label: 'Código' },
        { key: 'debito', label: 'Débito', tipo: 'moneda' },
        { key: 'credito', label: 'Crédito', tipo: 'moneda' }
      ],
      filas,
      totales: {
        debito: filas.reduce((s, f) => s + f.debito, 0),
        credito: filas.reduce((s, f) => s + f.credito, 0)
      }
    };
  }

  // Libro Mayor: el movimiento de UNA cuenta contable a lo largo del tiempo, con saldo corriente.
  reporteLibroMayor({ cuentaContableId, fechaDesde = '', fechaHasta = '' } = {}) {
    if (!cuentaContableId) throw new Error('Debe seleccionar una cuenta contable');

    const { cuenta, movimientos, saldoFinal } = this.asientoContableService.getLibroMayor(cuentaContableId, fechaDesde, fechaHasta);

    return {
      tipo: 'tabla',
      titulo: `Libro Mayor - ${cuenta.codigo} ${cuenta.nombre}`,
      periodo: (fechaDesde || fechaHasta) ? { tipo: 'rango', fechaDesde, fechaHasta } : null,
      filtros: [{ label: 'Cuenta Contable', valor: `${cuenta.codigo} - ${cuenta.nombre}` }],
      columnas: [
        { key: 'fecha', label: 'Fecha', tipo: 'fecha' },
        { key: 'numero_asiento', label: 'Asiento No.' },
        { key: 'concepto', label: 'Concepto' },
        { key: 'debito', label: 'Débito', tipo: 'moneda' },
        { key: 'credito', label: 'Crédito', tipo: 'moneda' },
        { key: 'saldo', label: 'Saldo', tipo: 'moneda' }
      ],
      filas: movimientos,
      totales: {
        debito: movimientos.reduce((s, m) => s + m.debito, 0),
        credito: movimientos.reduce((s, m) => s + m.credito, 0),
        saldo: saldoFinal
      }
    };
  }

  // Balance de Prueba: por cada cuenta con movimiento, total débito/crédito y saldo según su
  // naturaleza. Si el sistema de doble partida está bien construido, el total débito siempre
  // debe coincidir con el total crédito (columna "Diferencia" en 0).
  reporteBalancePrueba({ fechaDesde = '', fechaHasta = '', tipoCuenta = '' } = {}) {
    const { filas, totalDebito, totalCredito } = this.asientoContableService.getBalancePrueba(fechaDesde, fechaHasta, tipoCuenta);

    return {
      tipo: 'tabla',
      titulo: tipoCuenta ? `Balance de Prueba - Cuentas de ${tipoCuenta}` : 'Balance de Prueba',
      periodo: (fechaDesde || fechaHasta) ? { tipo: 'rango', fechaDesde, fechaHasta } : null,
      filtros: tipoCuenta ? [{ label: 'Tipo de Cuenta', valor: tipoCuenta }] : [],
      columnas: [
        { key: 'codigo', label: 'Código Cuenta Contable' },
        { key: 'nombre', label: 'Nombre Cuenta Contable' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'total_debito', label: 'Total Débito', tipo: 'moneda' },
        { key: 'total_credito', label: 'Total Crédito', tipo: 'moneda' },
        { key: 'saldo', label: 'Saldo', tipo: 'moneda' }
      ],
      filas,
      totales: { total_debito: totalDebito, total_credito: totalCredito }
    };
  }

  // Balance de Prueba por Tercero: el mismo Balance de Prueba pero abierto por propietario o
  // proveedor (el "tercero" de cada movimiento), con saldo inicial del período además de los
  // totales movidos. No incluye columna de "Sucursal" (este sistema es para una sola
  // asociación, sin sedes), a diferencia de software contable multi-sede del que viene la idea.
  reporteBalancePruebaPorTercero({ fechaDesde, fechaHasta, cuentaCodigoDesde = '', cuentaCodigoHasta = '', terceroQuery = '' } = {}) {
    const filas = this.asientoContableService.getBalancePruebaPorTercero({ fechaDesde, fechaHasta, cuentaCodigoDesde, cuentaCodigoHasta, terceroQuery });

    return {
      tipo: 'tabla',
      titulo: 'Balance de Prueba por Tercero',
      periodo: { tipo: 'rango', fechaDesde, fechaHasta },
      filtros: [
        (cuentaCodigoDesde || cuentaCodigoHasta) && { label: 'Rango de Cuentas', valor: `${cuentaCodigoDesde || 'inicio'} - ${cuentaCodigoHasta || 'fin'}` },
        terceroQuery && { label: 'Tercero', valor: terceroQuery }
      ].filter(Boolean),
      columnas: [
        { key: 'nivel', label: 'Nivel' },
        { key: 'transaccional', label: 'Transaccional' },
        { key: 'codigo', label: 'Código Cuenta Contable' },
        { key: 'nombre', label: 'Nombre Cuenta Contable' },
        { key: 'tercero_identificacion', label: 'Identificación' },
        { key: 'tercero_nombre', label: 'Nombre Tercero' },
        { key: 'saldo_inicial', label: 'Saldo Inicial', tipo: 'moneda' },
        { key: 'movimiento_debito', label: 'Movimiento Débito', tipo: 'moneda' },
        { key: 'movimiento_credito', label: 'Movimiento Crédito', tipo: 'moneda' },
        { key: 'saldo_final', label: 'Saldo Final', tipo: 'moneda' }
      ],
      filas: filas.map(f => ({ ...f, transaccional: f.transaccional ? 'Sí' : 'No' })),
      totales: {
        saldo_inicial: filas.reduce((s, f) => s + f.saldo_inicial, 0),
        movimiento_debito: filas.reduce((s, f) => s + f.movimiento_debito, 0),
        movimiento_credito: filas.reduce((s, f) => s + f.movimiento_credito, 0),
        saldo_final: filas.reduce((s, f) => s + f.saldo_final, 0)
      }
    };
  }

  // Informe de Empalme: pensado para la rotación de junta directiva (tesorero entrante/saliente).
  // Reúne en un solo documento lo que normalmente habría que armar a mano juntando varios
  // reportes: estado de la cartera, balance, resultados del período, flujo de caja y quién operó
  // el sistema mientras estuvo a cargo. No es un reporte nuevo de cero: reutiliza los existentes.
  reporteInformeEmpalme({ fechaDesde = '', fechaHasta = '' } = {}) {
    const cartera = this.procesarEstadoCuentas();
    const alDia = cartera.filter(c => c.meses_mora === 0).length;
    const enMora = cartera.filter(c => c.meses_mora > 0).length;
    const conSaldoFavor = this.repository.getCuentasConSaldoAFavor().length;

    const balance = this.reporteBalanceGeneral({ fechaCorte: fechaHasta });
    const resultados = this.reporteEstadoResultados({ fechaDesde, fechaHasta });
    const flujo = this.reporteFlujoCaja({ fechaDesde, fechaHasta });
    const actividadUsuarios = this.auditoriaRepository.getResumenPorUsuario(fechaDesde, fechaHasta);

    return {
      tipo: 'compuesto',
      titulo: 'Informe de Empalme',
      periodo: { tipo: 'rango', fechaDesde, fechaHasta },
      filtros: [],
      partes: [
        {
          titulo: 'Resumen de Cartera (estado actual)',
          tipo: 'resumen',
          secciones: [{
            titulo: 'Cuentas',
            tipoValor: 'numero',
            items: [
              { label: 'Total de cuentas activas', valor: cartera.length, tipo: 'numero' },
              { label: 'Al día', valor: alDia, tipo: 'numero' },
              { label: 'En mora', valor: enMora, tipo: 'numero' },
              { label: 'Con saldo a favor', valor: conSaldoFavor, tipo: 'numero' }
            ],
            total: cartera.length
          }]
        },
        {
          titulo: 'Balance General (al cierre)',
          tipo: 'resumen',
          secciones: balance.secciones
        },
        {
          titulo: `Estado de Resultados del Período (${fechaDesde || 'inicio'} a ${fechaHasta || 'hoy'})`,
          tipo: 'resumen',
          secciones: resultados.secciones
        },
        {
          titulo: 'Flujo de Caja del Período',
          tipo: 'resumen',
          secciones: flujo.secciones
        },
        {
          titulo: 'Actividad de Usuarios en el Período',
          tipo: 'resumen',
          secciones: [{
            titulo: 'Acciones registradas en auditoría',
            tipoValor: 'numero',
            items: actividadUsuarios.map(u => ({ label: u.nombre_completo, valor: u.cantidad, tipo: 'numero' })),
            total: actividadUsuarios.reduce((s, u) => s + u.cantidad, 0)
          }]
        }
      ]
    };
  }

  // --- Generación de HTML imprimible (para exportar a PDF y para la vista previa) ---
  // El armado real del documento (encabezado institucional, filtros, contenido, pie) vive en
  // PlantillaReporteService, compartido por todos los reportes — ver ese archivo.

  generarHTML(tipoReporte, params = {}, nombreUsuario = null) {
    const reporte = this.getReporte(tipoReporte, params);
    const config = this.plantillaReporteService.obtenerConfiguracionInstitucional();
    return this.plantillaReporteService.construirHTML(reporte, config, nombreUsuario);
  }

  // Cartera por Edades (Aging): cuentas activas con mora, clasificadas por antigüedad de deuda.
  reporteCarteraPorEdades() {
    const filas = this.repository.getCartedaPorEdades();
    const totalEstimado = filas.reduce((s, f) => s + f.valor_estimado, 0);

    return {
      tipo: 'tabla',
      titulo: 'Cartera por Edades (Aging)',
      periodo: null,
      filtros: [],
      columnas: [
        { key: 'codigo', label: 'Código' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'propietario', label: 'Propietario' },
        { key: 'fecha_ultimo_pago', label: 'Último Pago', tipo: 'fecha' },
        { key: 'meses_mora', label: 'Meses en Mora', tipo: 'numero' },
        { key: 'rango_mora', label: 'Rango de Mora' },
        { key: 'tarifa_mensual', label: 'Tarifa Mensual', tipo: 'moneda' },
        { key: 'valor_estimado', label: 'Valor Estimado', tipo: 'moneda' }
      ],
      filas,
      totales: [
        { label: 'Total cuentas en mora', valor: filas.length, tipo: 'numero' },
        { label: 'Total cartera estimada', valor: totalEstimado, tipo: 'moneda' }
      ]
    };
  }

  // KPIs del módulo de Contabilidad para el Dashboard. Los saldos de Caja/Banco vienen del
  // ledger simple (movimientos), consistente con el Dashboard general.
  getDashboardContable() {
    return this.repository.getDashboardContable();
  }
}

module.exports = ReporteService;
