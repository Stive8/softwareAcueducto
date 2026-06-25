// Módulo de Propietarios
const Propietarios = {
  currentPage: 1,
  limit: 10,
  search: '',

  async load() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Propietarios</h1>
        <p>Gestión de propietarios del acueducto</p>
      </div>

      <div class="stats-grid" id="propietariosStatsGrid"></div>

      <div class="table-container">
        <div class="table-header">
          <h2>Listado de Propietarios</h2>
          <div class="table-controls">
            <input type="text" id="searchInput" class="search-box" placeholder="Buscar por nombre o identificación...">
            <button class="btn btn-primary" id="btnNuevoPropietario">+ Nuevo Propietario</button>
          </div>
        </div>

        <div id="tableContent">
          ${App.renderSkeletonTable()}
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadStats();
    await this.loadPropietarios();
  },

  async loadStats() {
    const grid = document.getElementById('propietariosStatsGrid');
    try {
      const response = await window.api.propietarios.getStats();
      if (!response.success) {
        console.error('Error al cargar métricas de propietarios:', response.error);
        return;
      }
      const { total, conCuenta, sinCuenta } = response.data;
      grid.innerHTML = App.renderStatsGrid([
        { titulo: 'Total Propietarios', valor: total, icono: 'users' },
        { titulo: 'Con Cuenta Asignada', valor: conCuenta, icono: 'home' },
        { titulo: 'Sin Cuenta Asignada', valor: sinCuenta, icono: 'tag' }
      ]);
    } catch (error) {
      console.error('Error:', error);
    }
  },

  setupEventListeners() {
    document.getElementById('searchInput').addEventListener('input', App.debounce((e) => {
      this.search = e.target.value;
      this.currentPage = 1;
      this.loadPropietarios();
    }));

    document.getElementById('btnNuevoPropietario').addEventListener('click', () => {
      this.showFormModal();
    });
  },

  async loadPropietarios() {
    try {
      const response = await window.api.propietarios.getAll({
        page: this.currentPage,
        limit: this.limit,
        search: this.search
      });

      if (response.success) {
        this.renderTable(response.data);
      } else {
        console.error('Error al cargar propietarios:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderTable(data) {
    const tableContent = document.getElementById('tableContent');
    
    if (data.data.length === 0) {
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No se encontraron propietarios</p>';
      return;
    }

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Nombre Completo</th>
            <th>Identificación</th>
            <th>Teléfono</th>
            <th>Correo</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(propietario => `
            <tr>
              <td><strong>${propietario.nombre_completo}</strong></td>
              <td>${propietario.numero_identificacion || '<em>Sin registro</em>'}</td>
              <td>${propietario.telefono || '-'}</td>
              <td>${propietario.email || '-'}</td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-primary btn-icon" onclick="Propietarios.showDetailModal(${propietario.id})">Ver</button>
                  <button class="btn btn-secondary btn-icon" onclick="Propietarios.showFormModal(${propietario.id})">Editar</button>
                  <button class="btn btn-success btn-icon" onclick="Propietarios.showAsignarModal(${propietario.id})">Asignar</button>
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
          <button ${data.pagination.page === 1 ? 'disabled' : ''} onclick="Propietarios.changePage(${data.pagination.page - 1})">Anterior</button>
          <button disabled>${data.pagination.page} / ${data.pagination.totalPages}</button>
          <button ${data.pagination.page >= data.pagination.totalPages ? 'disabled' : ''} onclick="Propietarios.changePage(${data.pagination.page + 1})">Siguiente</button>
        </div>
      </div>
    `;
  },

  changePage(page) {
    this.currentPage = page;
    this.loadPropietarios();
  },

  async showDetailModal(id) {
    try {
      const response = await window.api.propietarios.getById(id);
      
      if (!response.success) {
        App.toast('Error al cargar propietario: ' + response.error, 'error');
        return;
      }

      const propietario = response.data;

      // Cargar cuentas actuales
      const cuentasResponse = await window.api.propietarios.getCuentasActuales(id);
      const cuentas = cuentasResponse.success ? cuentasResponse.data : [];

      // Cargar historial
      const historialResponse = await window.api.propietarios.getHistorialCuentas(id);
      const historial = historialResponse.success ? historialResponse.data : [];

      const content = `
        <div class="modal-header">
          <h2>Detalle de Propietario</h2>
        </div>

        <div class="detail-section">
          <h3>Información General</h3>
          <div class="detail-row">
            <div class="detail-label">Nombre Completo:</div>
            <div class="detail-value"><strong>${propietario.nombre_completo}</strong></div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Identificación:</div>
            <div class="detail-value">${propietario.numero_identificacion || '<em>Sin registro</em>'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Teléfono:</div>
            <div class="detail-value">${propietario.telefono || '-'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Correo:</div>
            <div class="detail-value">${propietario.email || '-'}</div>
          </div>
          ${propietario.observaciones ? `
            <div class="detail-row">
              <div class="detail-label">Observaciones:</div>
              <div class="detail-value">${propietario.observaciones}</div>
            </div>
          ` : ''}
        </div>

        <div class="detail-section">
          <h3>Cuentas Actuales (${cuentas.length})</h3>
          ${cuentas.length > 0 ? `
            <table style="width: 100%; margin-top: 12px;">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Dirección</th>
                  <th>Estado</th>
                  <th>Desde</th>
                </tr>
              </thead>
              <tbody>
                ${cuentas.map(c => `
                  <tr>
                    <td><strong>${c.codigo}</strong></td>
                    <td>${c.direccion}</td>
                    <td><span class="badge badge-${c.estado.toLowerCase()}">${c.estado}</span></td>
                    <td>${this.formatDate(c.fecha_inicio)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="color: #64748b; margin-top: 12px;">No tiene cuentas asignadas actualmente</p>'}
        </div>

        <div class="detail-section">
          <h3>Historial de Cuentas</h3>
          ${historial.length > 0 ? `
            <table style="width: 100%; margin-top: 12px;">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Dirección</th>
                  <th>Desde</th>
                  <th>Hasta</th>
                </tr>
              </thead>
              <tbody>
                ${historial.map(h => `
                  <tr>
                    <td>${h.codigo}</td>
                    <td>${h.direccion}</td>
                    <td>${this.formatDate(h.fecha_inicio)}</td>
                    <td>${h.fecha_fin ? this.formatDate(h.fecha_fin) : '<strong>Actual</strong>'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="color: #64748b; margin-top: 12px;">Sin historial</p>'}
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          <button class="btn btn-primary" onclick="App.closeModal(); Propietarios.showFormModal(${propietario.id})">Editar</button>
        </div>
      `;
      
      App.openModal(content, 'large');
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar el propietario', 'error');
    }
  },

  async showFormModal(id = null) {
    let propietario = null;
    
    if (id) {
      const response = await window.api.propietarios.getById(id);
      if (response.success) {
        propietario = response.data;
      } else {
        App.toast('Error al cargar propietario: ' + response.error, 'error');
        return;
      }
    }

    const content = `
      <div class="modal-header">
        <h2>${id ? 'Editar Propietario' : 'Nuevo Propietario'}</h2>
      </div>

      <div id="formError"></div>

      <form id="propietarioForm">
        <div class="form-group">
          <label for="nombre_completo">Nombre Completo <span style="color: #ef4444;">*</span></label>
          <input type="text" id="nombre_completo" name="nombre_completo" value="${propietario?.nombre_completo || ''}" required>
        </div>

        <div class="form-group">
          <label for="numero_identificacion">Número de Identificación</label>
          <input type="text" id="numero_identificacion" name="numero_identificacion" value="${propietario?.numero_identificacion || ''}">
        </div>

        <div class="form-group">
          <label for="telefono">Teléfono</label>
          <input type="text" id="telefono" name="telefono" value="${propietario?.telefono || ''}">
        </div>

        <div class="form-group">
          <label for="email">Correo Electrónico</label>
          <input type="email" id="email" name="email" value="${propietario?.email || ''}">
        </div>

        <div class="form-group">
          <label for="observaciones">Observaciones</label>
          <textarea id="observaciones" name="observaciones">${propietario?.observaciones || ''}</textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${id ? 'Actualizar' : 'Crear'}</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('propietarioForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.savePropietario(id);
    });
  },

  async savePropietario(id) {
    const formData = {
      nombre_completo: document.getElementById('nombre_completo').value.trim(),
      numero_identificacion: document.getElementById('numero_identificacion').value.trim(),
      telefono: document.getElementById('telefono').value.trim(),
      email: document.getElementById('email').value.trim(),
      observaciones: document.getElementById('observaciones').value.trim()
    };

    try {
      const response = id 
        ? await window.api.propietarios.update(id, formData)
        : await window.api.propietarios.create(formData);

      if (response.success) {
        App.closeModal();
        this.loadPropietarios();
        App.toast(id ? 'Propietario actualizado con éxito' : 'Propietario creado con éxito');
      } else {
        const errorDiv = document.getElementById('formError');
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      const errorDiv = document.getElementById('formError');
      errorDiv.innerHTML = `<div class="error-message">Error al guardar el propietario</div>`;
    }
  },

  async showAsignarModal(propietarioId) {
    const propietarioResponse = await window.api.propietarios.getById(propietarioId);
    if (!propietarioResponse.success) {
      App.toast('Error al cargar propietario', 'error');
      return;
    }
    const propietario = propietarioResponse.data;

    // Cargar todas las cuentas
    const cuentasResponse = await window.api.cuentas.getAll({ limit: 1000 });
    const cuentas = cuentasResponse.success ? cuentasResponse.data.data : [];

    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Asignar Propietario a Cuenta</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Propietario:</strong> ${propietario.nombre_completo}
        </p>
      </div>

      <div id="formError"></div>

      <form id="asignarForm">
        <div class="form-group">
          <label for="cuenta_id">Cuenta <span style="color: #ef4444;">*</span></label>
          <select id="cuenta_id" name="cuenta_id" required>
            <option value="">Seleccione una cuenta...</option>
            ${cuentas.filter(c => c.estado === 'Activo').map(c => `
              <option value="${c.id}">${c.codigo} - ${c.direccion}</option>
            `).join('')}
          </select>
        </div>

        <div class="form-group">
          <label for="fecha_inicio">Fecha de Inicio <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_inicio" name="fecha_inicio" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_asignacion">Observaciones</label>
          <textarea id="observaciones_asignacion" name="observaciones_asignacion" placeholder="Ej: Compra de propiedad, herencia, etc."></textarea>
        </div>

        <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
            <strong>Nota:</strong> Si la cuenta ya tiene un propietario, este será finalizado automáticamente.
          </p>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Asignar</button>
        </div>
      </form>
    `;

    App.openModal(content);
    Combobox.attach('cuenta_id');

    document.getElementById('asignarForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const cuentaId = document.getElementById('cuenta_id').value;
      const fechaInicio = document.getElementById('fecha_inicio').value;
      const observaciones = document.getElementById('observaciones_asignacion').value.trim();

      try {
        const response = await window.api.propietarios.asignarACuenta(cuentaId, propietarioId, fechaInicio, observaciones);
        
        if (response.success) {
          App.closeModal();
          App.toast('Propietario asignado con éxito');
        } else {
          const errorDiv = document.getElementById('formError');
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        const errorDiv = document.getElementById('formError');
        errorDiv.innerHTML = `<div class="error-message">Error al asignar propietario</div>`;
      }
    });
  },

  formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-CO', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric'
    });
  }
};
