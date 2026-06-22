// Módulo de Categorías
const Categorias = {
  async load() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Categorías</h1>
        <p>Gestión de categorías y tarifas de sostenimiento</p>
      </div>

      <div class="table-container">
        <div class="table-header">
          <h2>Listado de Categorías</h2>
          <div class="table-controls">
            <button class="btn btn-primary" id="btnNuevaCategoria">+ Nueva Categoría</button>
          </div>
        </div>

        <div id="tableContent">
          <p style="padding: 24px; text-align: center;">Cargando...</p>
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadCategorias();
  },

  setupEventListeners() {
    document.getElementById('btnNuevaCategoria').addEventListener('click', () => {
      this.showFormModal();
    });
  },

  async loadCategorias() {
    try {
      const response = await window.api.categorias.getAll();

      if (response.success) {
        this.renderTable(response.data);
      } else {
        console.error('Error al cargar categorías:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderTable(categorias) {
    const tableContent = document.getElementById('tableContent');
    
    if (categorias.length === 0) {
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No hay categorías registradas</p>';
      return;
    }

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Descripción</th>
            <th>Tarifa Actual</th>
            <th>Cuentas</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${categorias.map(cat => {
            const tarifaActual = cat.tarifa_actual || 0;
            const cuentasCount = cat.cuentas_count || 0;
            return `
              <tr>
                <td><strong>${cat.nombre}</strong></td>
                <td>${cat.descripcion || '-'}</td>
                <td>$${this.formatNumber(tarifaActual)}</td>
                <td>${cuentasCount}</td>
                <td><span class="badge badge-${cat.activo ? 'activo' : 'inactivo'}">${cat.activo ? 'Activa' : 'Inactiva'}</span></td>
                <td>
                  <div class="table-actions">
                    <button class="btn btn-primary btn-icon" onclick="Categorias.showDetailModal(${cat.id})">Ver</button>
                    <button class="btn btn-secondary btn-icon" onclick="Categorias.showFormModal(${cat.id})">Editar</button>
                    <button class="btn btn-success btn-icon" onclick="Categorias.showTarifaModal(${cat.id})">Tarifa</button>
                    <button class="btn btn-${cat.activo ? 'warning' : 'info'} btn-icon" onclick="Categorias.toggleActivo(${cat.id})">${cat.activo ? 'Desactivar' : 'Activar'}</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  async showDetailModal(id) {
    try {
      const response = await window.api.categorias.getById(id);
      
      if (!response.success) {
        App.toast('Error al cargar categoría: ' + response.error, 'error');
        return;
      }

      const categoria = response.data;

      // Cargar historial de tarifas
      const tarifasResponse = await window.api.categorias.getHistorialTarifas(id);
      const tarifas = tarifasResponse.success ? tarifasResponse.data : [];

      // Cargar cuentas con esta categoría
      const cuentasResponse = await window.api.categorias.getCuentasConCategoria(id);
      const cuentas = cuentasResponse.success ? cuentasResponse.data : [];

      const content = `
        <div class="modal-header">
          <h2>Detalle de Categoría</h2>
        </div>

        <div class="detail-section">
          <h3>Información General</h3>
          <div class="detail-row">
            <div class="detail-label">Nombre:</div>
            <div class="detail-value"><strong>${categoria.nombre}</strong></div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Descripción:</div>
            <div class="detail-value">${categoria.descripcion || '-'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Estado:</div>
            <div class="detail-value"><span class="badge badge-${categoria.activo ? 'activo' : 'inactivo'}">${categoria.activo ? 'Activa' : 'Inactiva'}</span></div>
          </div>
        </div>

        <div class="detail-section">
          <h3>Historial de Tarifas</h3>
          ${tarifas.length > 0 ? `
            <table style="width: 100%; margin-top: 12px;">
              <thead>
                <tr>
                  <th>Tarifa</th>
                  <th>Vigente Desde</th>
                  <th>Vigente Hasta</th>
                  <th>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                ${tarifas.map(t => `
                  <tr>
                    <td><strong>$${this.formatNumber(t.tarifa_sostenimiento)}</strong></td>
                    <td>${this.formatDate(t.fecha_vigencia_desde)}</td>
                    <td>${t.fecha_vigencia_hasta ? this.formatDate(t.fecha_vigencia_hasta) : '<strong>Actual</strong>'}</td>
                    <td>${t.observaciones || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="color: #64748b; margin-top: 12px;">Sin historial de tarifas</p>'}
        </div>

        <div class="detail-section">
          <h3>Cuentas con esta Categoría (${cuentas.length})</h3>
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
          ` : '<p style="color: #64748b; margin-top: 12px;">No hay cuentas con esta categoría</p>'}
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          <button class="btn btn-primary" onclick="App.closeModal(); Categorias.showFormModal(${categoria.id})">Editar</button>
        </div>
      `;
      
      App.openModal(content, 'large');
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar la categoría', 'error');
    }
  },

  async showFormModal(id = null) {
    let categoria = null;
    
    if (id) {
      const response = await window.api.categorias.getById(id);
      if (response.success) {
        categoria = response.data;
      } else {
        App.toast('Error al cargar categoría: ' + response.error, 'error');
        return;
      }
    }

    const content = `
      <div class="modal-header">
        <h2>${id ? 'Editar Categoría' : 'Nueva Categoría'}</h2>
      </div>

      <div id="formError"></div>

      <form id="categoriaForm">
        <div class="form-group">
          <label for="nombre">Nombre <span style="color: #ef4444;">*</span></label>
          <input type="text" id="nombre" name="nombre" value="${categoria?.nombre || ''}" required>
          <small style="color: #64748b; font-size: 0.875rem;">Ej: Finca, Finca con piscina, Tienda</small>
        </div>

        <div class="form-group">
          <label for="descripcion">Descripción</label>
          <textarea id="descripcion" name="descripcion">${categoria?.descripcion || ''}</textarea>
        </div>

        ${!id ? `
          <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
              <strong>Nota:</strong> Después de crear la categoría, podrás configurar su tarifa de sostenimiento.
            </p>
          </div>
        ` : ''}

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${id ? 'Actualizar' : 'Crear'}</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('categoriaForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveCategoria(id);
    });
  },

  async saveCategoria(id) {
    const formData = {
      nombre: document.getElementById('nombre').value.trim(),
      descripcion: document.getElementById('descripcion').value.trim()
    };

    try {
      const response = id 
        ? await window.api.categorias.update(id, formData)
        : await window.api.categorias.create(formData);

      if (response.success) {
        App.closeModal();
        this.loadCategorias();
        
        if (!id) {
          App.toast('Categoría creada con éxito. Ahora puedes configurar su tarifa.');
          // Abrir modal de tarifa para la nueva categoría
          this.showTarifaModal(response.data.id);
        } else {
          App.toast('Categoría actualizada con éxito');
        }
      } else {
        const errorDiv = document.getElementById('formError');
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      const errorDiv = document.getElementById('formError');
      errorDiv.innerHTML = `<div class="error-message">Error al guardar la categoría</div>`;
    }
  },

  async showTarifaModal(categoriaId) {
    const categoriaResponse = await window.api.categorias.getById(categoriaId);
    if (!categoriaResponse.success) {
      App.toast('Error al cargar categoría', 'error');
      return;
    }
    const categoria = categoriaResponse.data;

    const tarifaVigenteResponse = await window.api.categorias.getTarifaVigente(categoriaId);
    const tarifaVigente = tarifaVigenteResponse.success ? tarifaVigenteResponse.data : null;

    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Configurar Tarifa</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Categoría:</strong> ${categoria.nombre}
        </p>
        ${tarifaVigente ? `
          <p style="margin: 8px 0 0 0; font-size: 0.875rem; color: #1e40af;">
            <strong>Tarifa actual:</strong> $${this.formatNumber(tarifaVigente.tarifa_sostenimiento)} 
            (desde ${this.formatDate(tarifaVigente.fecha_vigencia_desde)})
          </p>
        ` : ''}
      </div>

      <div id="formError"></div>

      <form id="tarifaForm">
        <div class="form-group">
          <label for="tarifa">Nueva Tarifa <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="tarifa" name="tarifa" required>
          </div>
          <small style="color: #64748b; font-size: 0.875rem;">Tarifa de sostenimiento mensual</small>
        </div>

        <div class="form-group">
          <label for="fecha_vigencia">Fecha de Vigencia <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_vigencia" name="fecha_vigencia" value="${hoy}" required>
          <small style="color: #64748b; font-size: 0.875rem;">Fecha desde la cual aplica la nueva tarifa</small>
        </div>

        <div class="form-group">
          <label for="observaciones_tarifa">Observaciones</label>
          <textarea id="observaciones_tarifa" name="observaciones_tarifa" placeholder="Ej: Ajuste anual 2025"></textarea>
        </div>

        <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
            <strong>Nota:</strong> La tarifa actual se finalizará automáticamente. Los valores históricos nunca se modifican.
          </p>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar Tarifa</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('tarifa'));

    document.getElementById('tarifaForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const tarifa = App.parseMoneyValue(document.getElementById('tarifa').value);
      const fechaVigencia = document.getElementById('fecha_vigencia').value;
      const observaciones = document.getElementById('observaciones_tarifa').value.trim();

      try {
        const response = await window.api.categorias.crearTarifa(categoriaId, tarifa, fechaVigencia, observaciones);

        if (response.success) {
          App.closeModal();
          this.loadCategorias();
          App.toast('Tarifa configurada con éxito');
        } else {
          const errorDiv = document.getElementById('formError');
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        const errorDiv = document.getElementById('formError');
        errorDiv.innerHTML = `<div class="error-message">Error al guardar la tarifa</div>`;
      }
    });
  },

  async toggleActivo(id) {
    const confirmado = await App.confirmDialog('¿Está seguro de cambiar el estado de esta categoría?');
    if (!confirmado) return;

    try {
      const response = await window.api.categorias.toggleActivo(id);

      if (response.success) {
        this.loadCategorias();
        App.toast('Estado actualizado con éxito');
      } else {
        App.toast('Error al cambiar el estado: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cambiar el estado', 'error');
    }
  },

  formatNumber(num) {
    return num.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
