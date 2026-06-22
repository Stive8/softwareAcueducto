// Módulo de Recibos
const Recibos = {
  currentPage: 1,
  limit: 10,
  search: '',

  async load() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Recibos</h1>
        <p>Consulta, impresión y exportación de recibos generados</p>
      </div>

      <div class="table-container">
        <div class="table-header">
          <h2>Listado de Recibos</h2>
          <div class="table-controls">
            <input type="text" id="searchInput" class="search-box" placeholder="Buscar por número, código o dirección...">
          </div>
        </div>

        <div id="tableContent">
          <p style="padding: 24px; text-align: center;">Cargando...</p>
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadRecibos();
  },

  setupEventListeners() {
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.search = e.target.value;
      this.currentPage = 1;
      this.loadRecibos();
    });
  },

  async loadRecibos() {
    try {
      const response = await window.api.recibos.getAll({
        page: this.currentPage,
        limit: this.limit,
        search: this.search
      });

      if (response.success) {
        this.renderTable(response.data);
      } else {
        console.error('Error al cargar recibos:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderTable(data) {
    const tableContent = document.getElementById('tableContent');

    if (data.data.length === 0) {
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No se encontraron recibos</p>';
      return;
    }

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>No. Recibo</th>
            <th>Fecha</th>
            <th>Cuenta</th>
            <th>Propietario</th>
            <th>Método de Pago</th>
            <th>Total</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(r => `
            <tr>
              <td><strong>${r.numero_recibo}</strong></td>
              <td>${this.formatDate(r.fecha_recibo)}</td>
              <td>${r.cuenta_codigo} - ${r.cuenta_direccion}</td>
              <td>${r.propietario_nombre}</td>
              <td>${r.metodo_pago}</td>
              <td>$${this.formatNumber(r.total)}</td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-primary btn-icon" onclick="Recibos.showDetailModal(${r.id})">Ver</button>
                  <button class="btn btn-secondary btn-icon" onclick="Recibos.imprimir(${r.id})">Imprimir</button>
                  <button class="btn btn-success btn-icon" onclick="Recibos.exportarPDF(${r.id})">PDF</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="pagination">
        <div class="pagination-info">
          Mostrando ${(data.pagination.page - 1) * data.pagination.limit + 1} -
          ${Math.min(data.pagination.page * data.pagination.limit, data.pagination.total)}
          de ${data.pagination.total} registros
        </div>
        <div class="pagination-controls">
          <button ${data.pagination.page === 1 ? 'disabled' : ''} onclick="Recibos.changePage(${data.pagination.page - 1})">Anterior</button>
          <button disabled>${data.pagination.page} / ${data.pagination.totalPages}</button>
          <button ${data.pagination.page >= data.pagination.totalPages ? 'disabled' : ''} onclick="Recibos.changePage(${data.pagination.page + 1})">Siguiente</button>
        </div>
      </div>
    `;
  },

  changePage(page) {
    this.currentPage = page;
    this.loadRecibos();
  },

  async showDetailModal(id) {
    try {
      const response = await window.api.recibos.getById(id);

      if (!response.success) {
        App.toast('Error al cargar el recibo: ' + response.error, 'error');
        return;
      }

      const recibo = response.data;

      const content = `
        <div class="modal-header">
          <h2>Recibo No. ${recibo.numero_recibo}</h2>
        </div>

        <div class="detail-section">
          <div class="detail-row">
            <div class="detail-label">Fecha:</div>
            <div class="detail-value">${this.formatDate(recibo.fecha_recibo)}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Cuenta:</div>
            <div class="detail-value">${recibo.cuenta_codigo} - ${recibo.cuenta_direccion}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Propietario:</div>
            <div class="detail-value">${recibo.propietario_nombre}${recibo.propietario_identificacion ? ` (${recibo.propietario_identificacion})` : ''}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Método de Pago:</div>
            <div class="detail-value">${recibo.metodo_pago}</div>
          </div>
          ${recibo.observaciones ? `
            <div class="detail-row">
              <div class="detail-label">Observaciones:</div>
              <div class="detail-value">${recibo.observaciones}</div>
            </div>
          ` : ''}
        </div>

        <div class="detail-section">
          <h3>Detalle</h3>
          <table style="width: 100%; margin-top: 12px;">
            <thead>
              <tr><th>Concepto</th><th>Período</th><th>Valor</th></tr>
            </thead>
            <tbody>
              ${recibo.detalles.map(d => `
                <tr>
                  <td>${d.concepto}</td>
                  <td>${d.periodo_desde ? d.periodo_desde + (d.periodo_hasta && d.periodo_hasta !== d.periodo_desde ? ' - ' + d.periodo_hasta : '') : '-'}</td>
                  <td>$${this.formatNumber(d.valor)}</td>
                </tr>
              `).join('')}
              <tr style="font-weight: bold; background: #eff6ff;">
                <td colspan="2">TOTAL</td>
                <td>$${this.formatNumber(recibo.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          <button class="btn btn-secondary" onclick="Recibos.imprimir(${recibo.id})">Imprimir</button>
          <button class="btn btn-success" onclick="Recibos.exportarPDF(${recibo.id})">Exportar PDF</button>
        </div>
      `;

      App.openModal(content, 'large');
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar el recibo', 'error');
    }
  },

  async imprimir(id) {
    try {
      const response = await window.api.recibos.imprimir(id);
      if (!response.success && !response.canceled) {
        App.toast('Error al imprimir: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al imprimir el recibo', 'error');
    }
  },

  async exportarPDF(id) {
    try {
      const response = await window.api.recibos.exportarPDF(id);
      if (response.canceled) return;
      if (response.success) {
        App.toast('PDF guardado en: ' + response.filePath);
      } else {
        App.toast('Error al exportar PDF: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al exportar el recibo a PDF', 'error');
    }
  },

  formatNumber(num) {
    return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  },

  formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
  }
};
