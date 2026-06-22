// Módulo de Reportes
const Reportes = {
  grupos: [
    {
      titulo: 'Cuentas y Propietarios',
      reportes: [
        { tipo: 'cuentas', params: { estado: 'Activo' }, titulo: 'Cuentas Activas', icon: '🏠' },
        { tipo: 'cuentas', params: { estado: 'Inactivo' }, titulo: 'Cuentas Inactivas', icon: '🏠' },
        { tipo: 'cuentas', params: { estado: 'Suspendido' }, titulo: 'Cuentas Suspendidas', icon: '🏠' },
        { tipo: 'propietarios', titulo: 'Propietarios', icon: '👤' }
      ]
    },
    {
      titulo: 'Estado de Cuentas',
      reportes: [
        { tipo: 'cuentas_al_dia', titulo: 'Cuentas al Día', icon: '✅' },
        { tipo: 'cuentas_en_mora', titulo: 'Cuentas en Mora', icon: '⚠️' },
        { tipo: 'cuentas_saldo_favor', titulo: 'Cuentas con Saldo a Favor', icon: '💳' },
        { tipo: 'nuevos_puntos', titulo: 'Estado de Nuevos Puntos', icon: '🔧' }
      ]
    },
    {
      titulo: 'Pagos y Gastos',
      reportes: [
        { tipo: 'historial_pagos', titulo: 'Historial de Pagos', icon: '💰', rangoFecha: true, filtroCuentaContable: true },
        { tipo: 'historial_gastos', titulo: 'Historial de Gastos', icon: '💸', rangoFecha: true, filtroCuentaContable: true },
        { tipo: 'ingresos_periodo', titulo: 'Ingresos por Período', icon: '📈', rangoFecha: true, filtroCuentaContable: true },
        { tipo: 'gastos_periodo', titulo: 'Gastos por Período', icon: '📉', rangoFecha: true, filtroCuentaContable: true }
      ]
    },
    {
      titulo: 'Contabilidad',
      reportes: [
        { tipo: 'balance_general', titulo: 'Balance General', icon: '📊' },
        { tipo: 'estado_resultados', titulo: 'Estado de Resultados', icon: '📋', rangoFecha: true },
        { tipo: 'flujo_caja', titulo: 'Flujo de Caja', icon: '💧', rangoFecha: true },
        { tipo: 'libro_diario', titulo: 'Libro Diario', icon: '📖', rangoFecha: true }
      ]
    },
    {
      titulo: 'Informe de Gestión',
      reportes: [
        { tipo: 'informe_empalme', titulo: 'Informe de Empalme', icon: '🤝', rangoFecha: true }
      ]
    }
  ],

  async load() {
    const content = document.getElementById('page-content');

    let html = `
      <div class="page-header">
        <h1>Reportes</h1>
        <p>Reportes administrativos y contables simplificados, exportables a PDF y Excel</p>
      </div>
    `;

    this.grupos.forEach((grupo, gi) => {
      html += `
        <div class="table-container" style="margin-bottom: 24px;">
          <div class="table-header"><h2>${grupo.titulo}</h2></div>
          <div class="reportes-grid">
            ${grupo.reportes.map((r, ri) => this.renderCard(r, `${gi}_${ri}`)).join('')}
          </div>
        </div>
      `;
    });

    content.innerHTML = html;

    if (this.grupos.some(g => g.reportes.some(r => r.filtroCuentaContable))) {
      await this.cargarCuentasContables();
    }
  },

  // Cuentas contables imputables, para los selects de filtro "Cuenta Contable" de los reportes
  // que lo soportan. Se cargan una sola vez y se reutilizan en todos los selects de la página.
  async cargarCuentasContables() {
    try {
      const response = await window.api.planCuentas.getImputables({});
      this.cuentasContables = response.success ? response.data : [];
    } catch (error) {
      console.error('Error al cargar cuentas contables:', error);
      this.cuentasContables = [];
    }

    document.querySelectorAll('[data-select-cuenta-contable]').forEach(select => {
      select.innerHTML = `
        <option value="">Todas las cuentas contables</option>
        ${this.cuentasContables.map(c => `<option value="${c.id}">${c.codigo} - ${c.nombre}</option>`).join('')}
      `;
    });
  },

  renderCard(reporte, idSufijo) {
    const hoy = new Date().toISOString().split('T')[0];
    const inicioMes = new Date();
    inicioMes.setDate(1);
    const inicioMesStr = inicioMes.toISOString().split('T')[0];

    return `
      <div class="reporte-card">
        <div class="reporte-card-icon">${reporte.icon}</div>
        <div class="reporte-card-titulo">${reporte.titulo}</div>
        ${reporte.rangoFecha ? `
          <div class="reporte-card-fechas">
            <input type="date" id="desde_${idSufijo}" value="${inicioMesStr}">
            <input type="date" id="hasta_${idSufijo}" value="${hoy}">
          </div>
        ` : ''}
        ${reporte.filtroCuentaContable ? `
          <select id="cuentaContable_${idSufijo}" data-select-cuenta-contable style="width: 100%; margin-bottom: 8px;">
            <option value="">Todas las cuentas contables</option>
          </select>
        ` : ''}
        <div class="reporte-card-actions">
          <button class="btn btn-secondary btn-icon" onclick="Reportes.exportar('${idSufijo}', 'pdf')">PDF</button>
          <button class="btn btn-success btn-icon" onclick="Reportes.exportar('${idSufijo}', 'excel')">Excel</button>
        </div>
      </div>
    `;
  },

  obtenerReportePorSufijo(idSufijo) {
    const [gi, ri] = idSufijo.split('_').map(Number);
    return this.grupos[gi].reportes[ri];
  },

  async exportar(idSufijo, formato) {
    const reporte = this.obtenerReportePorSufijo(idSufijo);
    const params = { ...(reporte.params || {}) };

    if (reporte.rangoFecha) {
      params.fechaDesde = document.getElementById(`desde_${idSufijo}`).value;
      params.fechaHasta = document.getElementById(`hasta_${idSufijo}`).value;
    }

    if (reporte.filtroCuentaContable) {
      params.cuentaContableId = document.getElementById(`cuentaContable_${idSufijo}`).value;
    }

    const tipo = reporte.tipo;

    try {
      const response = formato === 'pdf'
        ? await window.api.reportes.generarPDF(tipo, params)
        : await window.api.reportes.generarExcel(tipo, params);

      if (response.canceled) return;

      if (response.success) {
        App.toast(`Reporte generado en: ${response.filePath}`);
      } else {
        App.toast('Error al generar el reporte: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al generar el reporte', 'error');
    }
  }
};
