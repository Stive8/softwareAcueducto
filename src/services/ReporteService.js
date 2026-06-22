const ReporteRepository = require('../repositories/ReporteRepository');
const CajaRepository = require('../repositories/CajaRepository');
const AuditoriaRepository = require('../repositories/AuditoriaRepository');

function formatValorResumen(item) {
  return item.tipo === 'numero' ? String(item.valor) : `$${formatNumber(item.valor)}`;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(num) {
  return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatFecha(fechaString) {
  if (!fechaString) return '-';
  return new Date(fechaString).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

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
        return this.reporteBalanceGeneral();
      case 'estado_resultados':
        return this.reporteEstadoResultados(params);
      case 'flujo_caja':
        return this.reporteFlujoCaja(params);
      case 'libro_diario':
        return this.reporteLibroDiario(params);
      case 'informe_empalme':
        return this.reporteInformeEmpalme(params);
      default:
        throw new Error('Tipo de reporte no reconocido');
    }
  }

  reporteCuentas({ estado = '' } = {}) {
    const filas = this.repository.getCuentas(estado);
    return {
      tipo: 'tabla',
      titulo: estado ? `Cuentas ${estado}s` : 'Todas las Cuentas',
      columnas: [
        { key: 'codigo', label: 'Código' },
        { key: 'direccion', label: 'Dirección' },
        { key: 'categoria', label: 'Categoría' },
        { key: 'propietario', label: 'Propietario' },
        { key: 'estado', label: 'Estado' },
        { key: 'fecha_creacion', label: 'Fecha Creación', tipo: 'fecha' }
      ],
      filas
    };
  }

  reportePropietarios() {
    return {
      tipo: 'tabla',
      titulo: 'Propietarios',
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

  reporteHistorialPagos({ fechaDesde = '', fechaHasta = '', cuentaContableId = '' } = {}) {
    const filas = this.repository.getHistorialPagos(fechaDesde, fechaHasta, cuentaContableId).map(f => ({
      ...f,
      periodo: `${NOMBRES_MES[f.mes - 1]} ${f.anio}`,
      cuenta_contable: f.cuenta_contable_codigo ? `${f.cuenta_contable_codigo} - ${f.cuenta_contable_nombre}` : '-'
    }));

    return {
      tipo: 'tabla',
      titulo: 'Historial de Pagos',
      columnas: [
        { key: 'cuenta', label: 'Cuenta' },
        { key: 'propietario', label: 'Propietario' },
        { key: 'periodo', label: 'Período Pagado' },
        { key: 'valor', label: 'Valor', tipo: 'moneda' },
        { key: 'fecha_pago', label: 'Fecha de Pago', tipo: 'fecha' },
        { key: 'numero_recibo', label: 'No. Recibo' },
        { key: 'cuenta_contable', label: 'Cuenta Contable' }
      ],
      filas,
      totales: { valor: filas.reduce((s, f) => s + f.valor, 0) }
    };
  }

  reporteHistorialGastos({ fechaDesde = '', fechaHasta = '', cuentaContableId = '' } = {}) {
    const filas = this.repository.getHistorialGastos(fechaDesde, fechaHasta, cuentaContableId).map(f => ({
      ...f,
      cuenta_contable: f.cuenta_contable_codigo ? `${f.cuenta_contable_codigo} - ${f.cuenta_contable_nombre}` : '-'
    }));
    return {
      tipo: 'tabla',
      titulo: 'Historial de Gastos',
      columnas: [
        { key: 'fecha_gasto', label: 'Fecha', tipo: 'fecha' },
        { key: 'concepto', label: 'Concepto' },
        { key: 'tipo_gasto', label: 'Tipo' },
        { key: 'proveedor', label: 'Proveedor' },
        { key: 'valor', label: 'Valor', tipo: 'moneda' },
        { key: 'metodo_pago', label: 'Método de Pago' },
        { key: 'estado', label: 'Estado' },
        { key: 'cuenta_contable', label: 'Cuenta Contable' }
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

  reporteIngresosPeriodo({ fechaDesde = '', fechaHasta = '', cuentaContableId = '' } = {}) {
    const filas = this.repository.getIngresosPorPeriodo(fechaDesde, fechaHasta, cuentaContableId).map(f => ({
      ...f,
      cuentas_contables: f.cuentas_contables || '-'
    }));
    return {
      tipo: 'tabla',
      titulo: 'Ingresos por Período',
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

  reporteGastosPeriodo({ fechaDesde = '', fechaHasta = '', cuentaContableId = '' } = {}) {
    const filas = this.repository.getGastosPorPeriodo(fechaDesde, fechaHasta, cuentaContableId).map(f => ({
      ...f,
      cuenta_contable: f.cuenta_contable_codigo ? `${f.cuenta_contable_codigo} - ${f.cuenta_contable_nombre}` : '-'
    }));
    return {
      tipo: 'tabla',
      titulo: 'Gastos por Período',
      columnas: [
        { key: 'fecha_gasto', label: 'Fecha', tipo: 'fecha' },
        { key: 'concepto', label: 'Concepto' },
        { key: 'tipo_gasto', label: 'Tipo' },
        { key: 'valor', label: 'Valor', tipo: 'moneda' },
        { key: 'cuenta_contable', label: 'Cuenta Contable' }
      ],
      filas,
      totales: { valor: filas.reduce((s, f) => s + f.valor, 0) }
    };
  }

  // Balance General simplificado: no existe un libro mayor de doble partida en este sistema
  // (deliberado, para no convertirlo en un ERP); se deriva directamente de caja/banco reales
  // y de un estimado de cuentas por cobrar a partir de los meses en mora.
  reporteBalanceGeneral() {
    const saldoCaja = this.cajaRepository.getSaldoCaja();
    const saldoBanco = this.cajaRepository.getSaldoBanco();
    const cuentasPorCobrar = this.repository.getCuentasPorCobrarEstimado();
    const totalActivos = saldoCaja + saldoBanco + cuentasPorCobrar;

    return {
      tipo: 'resumen',
      titulo: 'Balance General Simplificado',
      fecha: new Date().toISOString().split('T')[0],
      secciones: [
        {
          titulo: 'Activos',
          items: [
            { label: 'Caja', valor: saldoCaja },
            { label: 'Bancos', valor: saldoBanco },
            { label: 'Cuentas por Cobrar (estimado por mora)', valor: cuentasPorCobrar }
          ],
          total: totalActivos
        },
        {
          titulo: 'Pasivos',
          items: [{ label: 'Sin pasivos registrados', valor: 0 }],
          total: 0
        },
        {
          titulo: 'Patrimonio',
          items: [{ label: 'Patrimonio (Activos - Pasivos)', valor: totalActivos }],
          total: totalActivos
        }
      ]
    };
  }

  reporteEstadoResultados({ fechaDesde = '', fechaHasta = '' } = {}) {
    const ingresosPorConcepto = this.repository.getTotalIngresosPorConcepto(fechaDesde, fechaHasta);
    const gastosPorTipo = this.repository.getTotalGastosPorTipo(fechaDesde, fechaHasta);

    const totalIngresos = ingresosPorConcepto.reduce((s, i) => s + i.total, 0);
    const totalGastos = gastosPorTipo.reduce((s, g) => s + g.total, 0);

    return {
      tipo: 'resumen',
      titulo: 'Estado de Resultados Simplificado',
      periodo: { fechaDesde, fechaHasta },
      secciones: [
        {
          titulo: 'Ingresos',
          items: ingresosPorConcepto.map(i => ({ label: i.categoria, valor: i.total })),
          total: totalIngresos
        },
        {
          titulo: 'Gastos',
          items: gastosPorTipo.map(g => ({ label: g.tipo_gasto, valor: g.total })),
          total: totalGastos
        },
        {
          titulo: 'Resultado Neto del Período',
          items: [{ label: 'Ingresos - Gastos', valor: totalIngresos - totalGastos }],
          total: totalIngresos - totalGastos
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
      periodo: { fechaDesde, fechaHasta },
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

  reporteLibroDiario({ fechaDesde = '', fechaHasta = '' } = {}) {
    const filas = this.repository.getLibroDiario(fechaDesde, fechaHasta);
    return {
      tipo: 'tabla',
      titulo: 'Libro Diario Simplificado',
      columnas: [
        { key: 'fecha', label: 'Fecha', tipo: 'fecha' },
        { key: 'concepto', label: 'Concepto' },
        { key: 'tipo', label: 'Tipo' },
        { key: 'valor', label: 'Valor', tipo: 'moneda' }
      ],
      filas
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

    const balance = this.reporteBalanceGeneral();
    const resultados = this.reporteEstadoResultados({ fechaDesde, fechaHasta });
    const flujo = this.reporteFlujoCaja({ fechaDesde, fechaHasta });
    const actividadUsuarios = this.auditoriaRepository.getResumenPorUsuario(fechaDesde, fechaHasta);

    return {
      tipo: 'compuesto',
      titulo: 'Informe de Empalme',
      periodo: { fechaDesde, fechaHasta },
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

  // --- Generación de HTML imprimible (para exportar a PDF) ---

  generarHTML(tipoReporte, params = {}) {
    const reporte = this.getReporte(tipoReporte, params);
    let cuerpo;
    if (reporte.tipo === 'compuesto') {
      cuerpo = reporte.partes.map(parte => `
        <h2 style="color:#1e40af; font-size:16px; margin: 24px 0 8px 0; border-bottom: 2px solid #1e40af; padding-bottom: 6px;">${escapeHtml(parte.titulo)}</h2>
        ${parte.tipo === 'resumen' ? this.renderResumenHTML(parte) : this.renderTablaHTML(parte)}
      `).join('');
    } else {
      cuerpo = reporte.tipo === 'resumen' ? this.renderResumenHTML(reporte) : this.renderTablaHTML(reporte);
    }

    return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(reporte.titulo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 28px; color: #1f2937; }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #1e40af; padding-bottom: 14px; }
  .header h1 { color: #1e40af; font-size: 20px; margin: 0 0 4px 0; }
  .header p { font-size: 12px; color: #64748b; margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 12px; text-align: left; }
  th { background: #f1f5f9; color: #334155; }
  .text-right { text-align: right; }
  .total-row td { font-weight: bold; background: #eff6ff; }
  .resumen-section { margin-bottom: 20px; }
  .resumen-section h3 { color: #1e40af; font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .resumen-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
  .resumen-total { display: flex; justify-content: space-between; font-weight: bold; padding-top: 6px; border-top: 1px solid #cbd5e1; margin-top: 4px; font-size: 13px; }
  .footer { margin-top: 28px; font-size: 10px; color: #94a3b8; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(reporte.titulo)}</h1>
    <p>Generado el ${formatFecha(new Date().toISOString())}</p>
  </div>
  ${cuerpo}
  <div class="footer">Documento generado por el sistema administrativo del acueducto.</div>
</body>
</html>
    `;
  }

  renderTablaHTML(reporte) {
    const filasHtml = reporte.filas.map(fila => `
      <tr>
        ${reporte.columnas.map(col => {
          const valor = fila[col.key];
          if (col.tipo === 'moneda') return `<td class="text-right">$${formatNumber(valor)}</td>`;
          if (col.tipo === 'fecha') return `<td>${formatFecha(valor)}</td>`;
          return `<td>${escapeHtml(valor)}</td>`;
        }).join('')}
      </tr>
    `).join('');

    const filaTotales = reporte.totales ? `
      <tr class="total-row">
        ${reporte.columnas.map((col, i) => {
          if (i === 0) return '<td>TOTAL</td>';
          if (reporte.totales[col.key] !== undefined) return `<td class="text-right">$${formatNumber(reporte.totales[col.key])}</td>`;
          return '<td></td>';
        }).join('')}
      </tr>
    ` : '';

    if (reporte.filas.length === 0) {
      return '<p style="text-align:center; color:#64748b; padding: 24px;">No hay datos para mostrar con los filtros seleccionados</p>';
    }

    return `
      <table>
        <thead><tr>${reporte.columnas.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${filasHtml}${filaTotales}</tbody>
      </table>
    `;
  }

  renderResumenHTML(reporte) {
    return reporte.secciones.map(seccion => `
      <div class="resumen-section">
        <h3>${escapeHtml(seccion.titulo)}</h3>
        ${seccion.items.map(item => `
          <div class="resumen-row"><span>${escapeHtml(item.label)}</span><span>${formatValorResumen(item)}</span></div>
        `).join('')}
        <div class="resumen-total"><span>Total ${escapeHtml(seccion.titulo)}</span><span>${formatValorResumen({ valor: seccion.total, tipo: seccion.tipoValor })}</span></div>
      </div>
    `).join('');
  }
}

module.exports = ReporteService;
