// Módulo de Reportes: cuentas, propietarios y estado de la cartera. Los reportes contables
// (pagos/gastos, estados financieros, informe de empalme) viven en el módulo Contabilidad.
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
      titulo: 'Terceros',
      reportes: [
        { tipo: 'terceros_incompletos', titulo: 'Terceros con Información Incompleta', icon: '⚠️' }
      ]
    }
  ],

  async load() {
    const content = document.getElementById('page-content');

    let html = `
      <div class="page-header">
        <h1>Reportes</h1>
        <p>Reportes de cuentas, propietarios y estado de cartera, exportables a PDF y Excel</p>
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
        <div class="reporte-card-actions">
          <button class="btn btn-primary" id="btnVistaPrevia_${idSufijo}" onclick="Reportes.buscarReporte('${idSufijo}')">Vista previa</button>
        </div>
      </div>
    `;
  },

  obtenerReportePorSufijo(idSufijo) {
    const [gi, ri] = idSufijo.split('_').map(Number);
    return this.grupos[gi].reportes[ri];
  },

  // Centraliza la lectura de los filtros de una tarjeta; la usan tanto la vista previa (Buscar)
  // como la exportación a PDF/Excel, para que ambas manden exactamente los mismos parámetros.
  obtenerParametrosReporte(idSufijo, reporte) {
    const params = { ...(reporte.params || {}) };

    if (reporte.rangoFecha) {
      params.fechaDesde = document.getElementById(`desde_${idSufijo}`).value;
      params.fechaHasta = document.getElementById(`hasta_${idSufijo}`).value;
    }

    return params;
  },

  // La vista previa pide al backend el HTML YA ARMADO (PlantillaReporteService) — el mismo
  // documento que produce el PDF, no una reimplementación aparte — y lo muestra en un iframe
  // dentro del modal (igual que los reportes contables en el módulo Contabilidad).
  async buscarReporte(idSufijo) {
    const reporte = this.obtenerReportePorSufijo(idSufijo);
    const params = this.obtenerParametrosReporte(idSufijo, reporte);

    const boton = document.getElementById(`btnVistaPrevia_${idSufijo}`);
    const textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Buscando...';

    try {
      const response = await window.api.reportes.getVistaPreviaHTML(reporte.tipo, params);
      if (!response.success) {
        App.toast('Error al generar la vista previa: ' + response.error, 'error');
        return;
      }
      this.mostrarVistaPrevia(idSufijo, reporte, response.data);
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al generar la vista previa', 'error');
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  },

  mostrarVistaPrevia(idSufijo, reporte, html) {
    const content = `
      <div class="modal-header"><h2>${reporte.titulo}</h2></div>
      <iframe class="reporte-preview-frame" srcdoc="${App.escapeAttr(html)}"></iframe>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
        <button type="button" class="btn btn-secondary btn-icon" onclick="Reportes.exportar('${idSufijo}', 'pdf')">Exportar PDF</button>
        <button type="button" class="btn btn-success btn-icon" onclick="Reportes.exportar('${idSufijo}', 'excel')">Exportar Excel</button>
      </div>
    `;
    // 'xlarge': se adapta al espacio disponible en pantalla en vez de un ancho fijo.
    App.openModal(content, 'xlarge');

    const iframe = document.querySelector('.reporte-preview-frame');
    iframe.addEventListener('load', () => {
      iframe.style.height = iframe.contentWindow.document.documentElement.scrollHeight + 'px';
    });
  },

  async exportar(idSufijo, formato) {
    const reporte = this.obtenerReportePorSufijo(idSufijo);
    const params = this.obtenerParametrosReporte(idSufijo, reporte);

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
