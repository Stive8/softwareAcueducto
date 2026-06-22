// Módulo de Caja y Bancos
const Caja = {
  currentPage: 1,
  limit: 15,
  cuenta: '',
  tipo: '',
  fechaDesde: '',
  fechaHasta: '',

  async load() {
    const content = document.getElementById('page-content');

    if (!this.fechaDesde) {
      const inicioMes = new Date();
      inicioMes.setDate(1);
      this.fechaDesde = inicioMes.toISOString().split('T')[0];
    }
    if (!this.fechaHasta) {
      this.fechaHasta = new Date().toISOString().split('T')[0];
    }

    content.innerHTML = `
      <div class="page-header">
        <h1>Caja y Bancos</h1>
        <p>Saldos y movimientos generados automáticamente por pagos y gastos</p>
      </div>

      <div class="stats-grid" id="saldosGrid">
        <p style="padding: 24px; text-align: center;">Cargando saldos...</p>
      </div>

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header">
          <h2>Resumen del Período</h2>
          <p style="color: #64748b; font-size: 13px;">Usa los filtros de fecha de "Historial de Movimientos" para cambiar el período.</p>
        </div>
        <div class="stats-grid" id="resumenPeriodoGrid" style="padding: 24px;">
          <p style="text-align: center;">Cargando resumen...</p>
        </div>
      </div>

      <div class="table-container">
        <div class="table-header">
          <h2>Historial de Movimientos</h2>
          <div class="table-controls">
            <select id="cuentaFilter" class="filter-select">
              <option value="">Caja y Banco</option>
              <option value="Caja">Solo Caja</option>
              <option value="Banco">Solo Banco</option>
            </select>
            <select id="tipoFilter" class="filter-select">
              <option value="">Todos los movimientos</option>
              <option value="Ingreso">Ingresos</option>
              <option value="Egreso">Egresos</option>
              <option value="Traslado">Traslados</option>
            </select>
            <input type="date" id="fechaDesdeFilter" class="filter-select" title="Desde" value="${this.fechaDesde}">
            <input type="date" id="fechaHastaFilter" class="filter-select" title="Hasta" value="${this.fechaHasta}">
            <button class="btn btn-primary" id="btnConsignacion">+ Registrar Consignación</button>
          </div>
        </div>

        <div id="tableContent">
          <p style="padding: 24px; text-align: center;">Cargando...</p>
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadSaldos();
    await this.loadResumenPeriodo();
    await this.loadMovimientos();
  },

  setupEventListeners() {
    document.getElementById('cuentaFilter').addEventListener('change', (e) => {
      this.cuenta = e.target.value;
      this.currentPage = 1;
      this.loadMovimientos();
    });

    document.getElementById('tipoFilter').addEventListener('change', (e) => {
      this.tipo = e.target.value;
      this.currentPage = 1;
      this.loadMovimientos();
    });

    document.getElementById('fechaDesdeFilter').addEventListener('change', (e) => {
      this.fechaDesde = e.target.value;
      this.currentPage = 1;
      this.loadResumenPeriodo();
      this.loadMovimientos();
    });

    document.getElementById('fechaHastaFilter').addEventListener('change', (e) => {
      this.fechaHasta = e.target.value;
      this.currentPage = 1;
      this.loadResumenPeriodo();
      this.loadMovimientos();
    });

    document.getElementById('btnConsignacion').addEventListener('click', () => {
      this.showConsignacionModal();
    });
  },

  async loadSaldos() {
    try {
      const response = await window.api.caja.getSaldos();
      const saldosGrid = document.getElementById('saldosGrid');

      if (!response.success) {
        saldosGrid.innerHTML = `<p style="color: #ef4444;">Error al cargar saldos: ${response.error}</p>`;
        return;
      }

      const { saldoCaja, saldoBanco } = response.data;

      saldosGrid.innerHTML = `
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-title">Saldo en Caja</span>
            <span class="stat-card-icon">💵</span>
          </div>
          <div class="stat-card-value">$${this.formatNumber(saldoCaja)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-title">Saldo en Banco</span>
            <span class="stat-card-icon">🏦</span>
          </div>
          <div class="stat-card-value">$${this.formatNumber(saldoBanco)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-title">Total Disponible</span>
            <span class="stat-card-icon">💰</span>
          </div>
          <div class="stat-card-value">$${this.formatNumber(saldoCaja + saldoBanco)}</div>
        </div>
      `;
    } catch (error) {
      console.error('Error:', error);
    }
  },

  async loadResumenPeriodo() {
    try {
      const response = await window.api.caja.getResumenPeriodo(this.fechaDesde, this.fechaHasta);
      const grid = document.getElementById('resumenPeriodoGrid');

      if (!response.success) {
        grid.innerHTML = `<p style="color: #ef4444;">Error al cargar el resumen: ${response.error}</p>`;
        return;
      }

      const { ingresos, gastos, flujoNeto } = response.data;
      const colorFlujo = flujoNeto >= 0 ? '#10b981' : '#ef4444';

      grid.innerHTML = `
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-title">Ingresos del Período</span>
            <span class="stat-card-icon">📈</span>
          </div>
          <div class="stat-card-value" style="color: #10b981;">$${this.formatNumber(ingresos)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-title">Gastos del Período</span>
            <span class="stat-card-icon">📉</span>
          </div>
          <div class="stat-card-value" style="color: #ef4444;">$${this.formatNumber(gastos)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-card-title">Flujo Neto</span>
            <span class="stat-card-icon">⚖️</span>
          </div>
          <div class="stat-card-value" style="color: ${colorFlujo};">$${this.formatNumber(flujoNeto)}</div>
        </div>
      `;
    } catch (error) {
      console.error('Error:', error);
    }
  },

  async loadMovimientos() {
    try {
      const response = await window.api.caja.getMovimientos({
        page: this.currentPage,
        limit: this.limit,
        cuenta: this.cuenta,
        tipo: this.tipo,
        fechaDesde: this.fechaDesde,
        fechaHasta: this.fechaHasta
      });

      if (response.success) {
        this.renderTable(response.data);
      } else {
        console.error('Error al cargar movimientos:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderTable(data) {
    const tableContent = document.getElementById('tableContent');

    if (data.data.length === 0) {
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No se encontraron movimientos</p>';
      return;
    }

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Tipo</th>
            <th>Origen</th>
            <th>Destino</th>
            <th>Concepto</th>
            <th>Monto</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(m => `
            <tr>
              <td>${this.formatDate(m.fecha_movimiento)}</td>
              <td><span class="badge badge-${m.tipo === 'Ingreso' ? 'aldia' : (m.tipo === 'Egreso' ? 'mora' : 'favor')}">${m.tipo}</span></td>
              <td>${m.origen}</td>
              <td>${m.destino || '-'}</td>
              <td>${m.concepto}</td>
              <td>$${this.formatNumber(m.monto)}</td>
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
          <button ${data.pagination.page === 1 ? 'disabled' : ''} onclick="Caja.changePage(${data.pagination.page - 1})">Anterior</button>
          <button disabled>${data.pagination.page} / ${data.pagination.totalPages}</button>
          <button ${data.pagination.page >= data.pagination.totalPages ? 'disabled' : ''} onclick="Caja.changePage(${data.pagination.page + 1})">Siguiente</button>
        </div>
      </div>
    `;
  },

  changePage(page) {
    this.currentPage = page;
    this.loadMovimientos();
  },

  showConsignacionModal() {
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Registrar Consignación</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Nota:</strong> Disminuye el saldo de Caja y aumenta el saldo de Banco por el mismo monto.
        </p>
      </div>

      <div id="formError"></div>

      <form id="consignacionForm">
        <div class="form-group">
          <label for="monto_consignacion">Monto a Consignar <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="monto_consignacion" name="monto_consignacion" required>
          </div>
        </div>

        <div class="form-group">
          <label for="fecha_consignacion">Fecha <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_consignacion" name="fecha_consignacion" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_consignacion">Observaciones</label>
          <textarea id="observaciones_consignacion" name="observaciones_consignacion"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Consignación</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('monto_consignacion'));

    document.getElementById('consignacionForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const monto = App.parseMoneyValue(document.getElementById('monto_consignacion').value);
      const fecha = document.getElementById('fecha_consignacion').value;
      const observaciones = document.getElementById('observaciones_consignacion').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.caja.registrarConsignacion({ monto, fecha, observaciones });

        if (response.success) {
          App.closeModal();
          this.loadSaldos();
          this.loadMovimientos();
          App.toast('Consignación registrada con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar la consignación</div>`;
      }
    });
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
