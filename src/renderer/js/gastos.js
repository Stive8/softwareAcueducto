// Módulo de Gastos
const Gastos = {
  currentPage: 1,
  limit: 10,
  search: '',
  tipoGasto: '',
  fechaDesde: '',
  fechaHasta: '',

  async load() {
    const content = document.getElementById('page-content');
    const tipos = await this.getTiposGasto();

    content.innerHTML = `
      <div class="page-header">
        <h1>Gastos</h1>
        <p>Registro de gastos del acueducto. Los gastos nunca se eliminan, solo se anulan.</p>
      </div>

      <div class="table-container">
        <div class="table-header">
          <h2>Listado de Gastos</h2>
          <div class="table-controls">
            <input type="text" id="searchInput" class="search-box" placeholder="Buscar por concepto o proveedor...">
            <select id="tipoFilter" class="filter-select">
              <option value="">Todos los tipos</option>
              ${tipos.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
            <input type="date" id="fechaDesdeFilter" class="filter-select" title="Desde">
            <input type="date" id="fechaHastaFilter" class="filter-select" title="Hasta">
            <button class="btn btn-primary" id="btnNuevoGasto">+ Nuevo Gasto</button>
          </div>
        </div>

        <div id="tableContent">
          <p style="padding: 24px; text-align: center;">Cargando...</p>
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadGastos();
  },

  async getTiposGasto() {
    try {
      const response = await window.api.gastos.getTiposGasto();
      return response.success ? response.data : [];
    } catch (error) {
      console.error('Error al cargar tipos de gasto:', error);
      return [];
    }
  },

  setupEventListeners() {
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.search = e.target.value;
      this.currentPage = 1;
      this.loadGastos();
    });

    document.getElementById('tipoFilter').addEventListener('change', (e) => {
      this.tipoGasto = e.target.value;
      this.currentPage = 1;
      this.loadGastos();
    });

    document.getElementById('fechaDesdeFilter').addEventListener('change', (e) => {
      this.fechaDesde = e.target.value;
      this.currentPage = 1;
      this.loadGastos();
    });

    document.getElementById('fechaHastaFilter').addEventListener('change', (e) => {
      this.fechaHasta = e.target.value;
      this.currentPage = 1;
      this.loadGastos();
    });

    document.getElementById('btnNuevoGasto').addEventListener('click', () => {
      this.showFormModal();
    });
  },

  async loadGastos() {
    try {
      const response = await window.api.gastos.getAll({
        page: this.currentPage,
        limit: this.limit,
        search: this.search,
        tipoGasto: this.tipoGasto,
        fechaDesde: this.fechaDesde,
        fechaHasta: this.fechaHasta
      });

      if (response.success) {
        this.renderTable(response.data);
      } else {
        console.error('Error al cargar gastos:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderTable(data) {
    const tableContent = document.getElementById('tableContent');

    if (data.data.length === 0) {
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No se encontraron gastos</p>';
      return;
    }

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Concepto</th>
            <th>Tipo</th>
            <th>Proveedor</th>
            <th>Valor</th>
            <th>Método de Pago</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(g => `
            <tr>
              <td>${this.formatDate(g.fecha_gasto)}</td>
              <td>${g.concepto}</td>
              <td>${g.tipo_gasto || '-'}</td>
              <td>${g.proveedor || '-'}</td>
              <td>$${this.formatNumber(g.valor)}</td>
              <td>${g.metodo_pago}</td>
              <td><span class="badge badge-${g.estado === 'Anulado' ? 'inactivo' : 'activo'}">${g.estado}</span></td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-primary btn-icon" onclick="Gastos.showDetailModal(${g.id})">Ver</button>
                  ${g.estado !== 'Anulado' ? `<button class="btn btn-warning btn-icon" onclick="Gastos.showAnularModal(${g.id})">Anular</button>` : ''}
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
          <button ${data.pagination.page === 1 ? 'disabled' : ''} onclick="Gastos.changePage(${data.pagination.page - 1})">Anterior</button>
          <button disabled>${data.pagination.page} / ${data.pagination.totalPages}</button>
          <button ${data.pagination.page >= data.pagination.totalPages ? 'disabled' : ''} onclick="Gastos.changePage(${data.pagination.page + 1})">Siguiente</button>
        </div>
      </div>
    `;
  },

  changePage(page) {
    this.currentPage = page;
    this.loadGastos();
  },

  async showDetailModal(id) {
    try {
      const response = await window.api.gastos.getById(id);

      if (!response.success) {
        App.toast('Error al cargar el gasto: ' + response.error, 'error');
        return;
      }

      const gasto = response.data;

      const content = `
        <div class="modal-header">
          <h2>Detalle de Gasto</h2>
        </div>

        <div class="detail-section">
          <div class="detail-row">
            <div class="detail-label">Fecha:</div>
            <div class="detail-value">${this.formatDate(gasto.fecha_gasto)}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Concepto:</div>
            <div class="detail-value"><strong>${gasto.concepto}</strong></div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Tipo de Gasto:</div>
            <div class="detail-value">${gasto.tipo_gasto || '-'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Proveedor:</div>
            <div class="detail-value">${gasto.proveedor || '-'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">NIT o Cédula:</div>
            <div class="detail-value">${gasto.nit_cedula || '-'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Valor:</div>
            <div class="detail-value"><strong>$${this.formatNumber(gasto.valor)}</strong></div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Método de Pago:</div>
            <div class="detail-value">${gasto.metodo_pago}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Estado:</div>
            <div class="detail-value"><span class="badge badge-${gasto.estado === 'Anulado' ? 'inactivo' : 'activo'}">${gasto.estado}</span></div>
          </div>
          ${gasto.observaciones ? `
            <div class="detail-row">
              <div class="detail-label">Observaciones:</div>
              <div class="detail-value">${gasto.observaciones}</div>
            </div>
          ` : ''}
          ${gasto.estado === 'Anulado' ? `
            <div class="detail-row">
              <div class="detail-label">Motivo Anulación:</div>
              <div class="detail-value">${gasto.motivo_anulacion} (${this.formatDate(gasto.fecha_anulacion)})</div>
            </div>
          ` : ''}
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          ${gasto.estado !== 'Anulado' ? `<button class="btn btn-warning" onclick="App.closeModal(); Gastos.showAnularModal(${gasto.id})">Anular</button>` : ''}
        </div>
      `;

      App.openModal(content);
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar el gasto', 'error');
    }
  },

  async showFormModal() {
    const hoy = new Date().toISOString().split('T')[0];
    const tipos = await this.getTiposGasto();

    const content = `
      <div class="modal-header">
        <h2>Nuevo Gasto</h2>
      </div>

      <div id="formError"></div>

      <form id="gastoForm">
        <div class="form-group">
          <label for="fecha_gasto">Fecha <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_gasto" name="fecha_gasto" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="concepto">Concepto <span style="color: #ef4444;">*</span></label>
          <input type="text" id="concepto" name="concepto" required>
        </div>

        <div class="form-group">
          <label for="tipo_gasto">Tipo de Gasto</label>
          <input type="text" id="tipo_gasto" name="tipo_gasto" list="tiposGastoSugeridos" placeholder="Ej: Administración, Fontanero, Mantenimiento">
          <datalist id="tiposGastoSugeridos">
            ${['Administración', 'Fontanero', 'Mantenimiento', ...tipos].filter((v, i, arr) => arr.indexOf(v) === i).map(t => `<option value="${t}">`).join('')}
          </datalist>
        </div>

        <div class="form-group">
          <label for="proveedor">Proveedor</label>
          <input type="text" id="proveedor" name="proveedor">
        </div>

        <div class="form-group">
          <label for="nit_cedula">NIT o Cédula</label>
          <input type="text" id="nit_cedula" name="nit_cedula">
        </div>

        <div class="form-group">
          <label for="valor">Valor <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="valor" name="valor" required>
          </div>
        </div>

        <div class="form-group">
          <label for="metodo_pago">Método de Pago <span style="color: #ef4444;">*</span></label>
          <select id="metodo_pago" name="metodo_pago" required>
            <option value="Efectivo">Efectivo</option>
            <option value="Transferencia">Transferencia</option>
          </select>
        </div>

        <div class="form-group">
          <label for="observaciones">Observaciones</label>
          <textarea id="observaciones" name="observaciones"></textarea>
        </div>

        <div class="form-group">
          <label for="soporte">Soporte (PDF o imagen)</label>
          <input type="file" id="soporte" name="soporte" disabled accept=".pdf,.png,.jpg,.jpeg">
          <small style="color: #64748b; font-size: 0.875rem;">Función disponible próximamente. El campo ya está preparado en el sistema.</small>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Gasto</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('valor'));

    document.getElementById('gastoForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveGasto();
    });
  },

  async saveGasto() {
    const formData = {
      fechaGasto: document.getElementById('fecha_gasto').value,
      concepto: document.getElementById('concepto').value.trim(),
      tipoGasto: document.getElementById('tipo_gasto').value.trim(),
      proveedor: document.getElementById('proveedor').value.trim(),
      nitCedula: document.getElementById('nit_cedula').value.trim(),
      valor: App.parseMoneyValue(document.getElementById('valor').value),
      metodoPago: document.getElementById('metodo_pago').value,
      observaciones: document.getElementById('observaciones').value.trim()
    };

    try {
      const response = await window.api.gastos.create(formData);

      if (response.success) {
        App.closeModal();
        this.loadGastos();
        App.toast('Gasto registrado con éxito');
      } else {
        const errorDiv = document.getElementById('formError');
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      const errorDiv = document.getElementById('formError');
      errorDiv.innerHTML = `<div class="error-message">Error al registrar el gasto</div>`;
    }
  },

  showAnularModal(id) {
    const content = `
      <div class="modal-header">
        <h2>Anular Gasto</h2>
      </div>

      <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
          <strong>Nota:</strong> El gasto no se elimina, queda marcado como anulado y se revierte su efecto en caja/banco. El registro permanece visible para auditoría.
        </p>
      </div>

      <div id="formError"></div>

      <form id="anularForm">
        <div class="form-group">
          <label for="motivo_anulacion">Motivo de la Anulación <span style="color: #ef4444;">*</span></label>
          <textarea id="motivo_anulacion" name="motivo_anulacion" required></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-warning">Confirmar Anulación</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('anularForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const motivo = document.getElementById('motivo_anulacion').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.gastos.anular(id, motivo);

        if (response.success) {
          App.closeModal();
          this.loadGastos();
          App.toast('Gasto anulado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al anular el gasto</div>`;
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
