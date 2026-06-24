// Módulo de Gastos: registro de gastos y, en su propia pestaña, el catálogo de Proveedores
// (Terceros) que alimenta el campo "Proveedor" de cada gasto. Los clientes siguen siendo
// Propietarios, en su propio módulo; este catálogo es solo para proveedores y otros aliados.
const Gastos = {
  tabActual: 'gastos',
  currentPage: 1,
  limit: 10,
  search: '',
  tipoGasto: '',
  fechaDesde: '',
  fechaHasta: '',

  async load() {
    const content = document.getElementById('page-content');

    content.innerHTML = `
      <div class="page-header">
        <h1>Gastos</h1>
        <p>Registro de gastos del acueducto y catálogo de proveedores</p>
      </div>

      <div class="table-container">
        <div class="table-header">
          <div class="table-controls" style="gap: 8px;">
            <button class="btn btn-secondary" id="tabGastosBtn">Gastos</button>
            <button class="btn btn-secondary" id="tabProveedoresBtn">Proveedores</button>
          </div>
        </div>
        <div id="gastosModuloBody"></div>
      </div>
    `;

    document.getElementById('tabGastosBtn').addEventListener('click', () => this.mostrarTab('gastos'));
    document.getElementById('tabProveedoresBtn').addEventListener('click', () => this.mostrarTab('proveedores'));

    await this.mostrarTab('gastos');
  },

  async mostrarTab(tab) {
    this.tabActual = tab;
    document.getElementById('tabGastosBtn').className = tab === 'gastos' ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('tabProveedoresBtn').className = tab === 'proveedores' ? 'btn btn-primary' : 'btn btn-secondary';

    if (tab === 'gastos') await this.renderTabGastos();
    if (tab === 'proveedores') await this.renderTabProveedores();
  },

  async renderTabGastos() {
    const body = document.getElementById('gastosModuloBody');
    const tipos = await this.getTiposGasto();

    body.innerHTML = `
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

  // prefill: para reabrir el formulario con lo que el usuario ya había escrito, después de
  // crear un proveedor nuevo desde aquí mismo sin perder el resto de los datos del gasto.
  async showFormModal(prefill = null) {
    const hoy = new Date().toISOString().split('T')[0];
    const tipos = await this.getTiposGasto();

    const proveedoresResponse = await window.api.terceros.getAll({ soloActivos: true, soloProveedores: true });
    const proveedores = proveedoresResponse.success ? proveedoresResponse.data : [];

    const content = `
      <div class="modal-header">
        <h2>Nuevo Gasto</h2>
      </div>

      <div id="formError"></div>

      <form id="gastoForm">
        <div class="form-group">
          <label for="fecha_gasto">Fecha <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_gasto" name="fecha_gasto" value="${prefill?.fecha_gasto || hoy}" required>
        </div>

        <div class="form-group">
          <label for="concepto">Concepto <span style="color: #ef4444;">*</span></label>
          <input type="text" id="concepto" name="concepto" value="${prefill?.concepto || ''}" required>
        </div>

        <div class="form-group">
          <label for="tipo_gasto">Tipo de Gasto</label>
          <input type="text" id="tipo_gasto" name="tipo_gasto" list="tiposGastoSugeridos" value="${prefill?.tipo_gasto || ''}" placeholder="Ej: Administración, Fontanero, Mantenimiento">
          <datalist id="tiposGastoSugeridos">
            ${['Administración', 'Fontanero', 'Mantenimiento', ...tipos].filter((v, i, arr) => arr.indexOf(v) === i).map(t => `<option value="${t}">`).join('')}
          </datalist>
        </div>

        <div class="form-group">
          <label for="tercero_id">Proveedor</label>
          <div style="display: flex; gap: 8px;">
            <select id="tercero_id" style="flex: 1;">
              <option value="">Sin proveedor específico</option>
              ${proveedores.map(t => `<option value="${t.id}" ${prefill?.terceroId == t.id ? 'selected' : ''}>${t.nombre_razon_social} - ${t.numero_identificacion}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-secondary" id="btnNuevoProveedorDesdeGasto">+ Nuevo</button>
          </div>
        </div>

        <div class="form-group">
          <label for="valor">Valor <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="valor" name="valor" value="${prefill?.valorTexto || ''}" required>
          </div>
        </div>

        <div class="form-group">
          <label for="metodo_pago">Método de Pago <span style="color: #ef4444;">*</span></label>
          <select id="metodo_pago" name="metodo_pago" required>
            <option value="Efectivo" ${prefill?.metodo_pago === 'Efectivo' ? 'selected' : ''}>Efectivo</option>
            <option value="Transferencia" ${prefill?.metodo_pago === 'Transferencia' ? 'selected' : ''}>Transferencia</option>
          </select>
        </div>

        <div class="form-group">
          <label for="observaciones">Observaciones</label>
          <textarea id="observaciones" name="observaciones">${prefill?.observaciones || ''}</textarea>
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

    document.getElementById('btnNuevoProveedorDesdeGasto').addEventListener('click', () => {
      const snapshot = {
        fecha_gasto: document.getElementById('fecha_gasto').value,
        concepto: document.getElementById('concepto').value,
        tipo_gasto: document.getElementById('tipo_gasto').value,
        valorTexto: document.getElementById('valor').value,
        metodo_pago: document.getElementById('metodo_pago').value,
        observaciones: document.getElementById('observaciones').value
      };

      this.showFormModalProveedor(null, (nuevoId) => {
        snapshot.terceroId = nuevoId;
        this.showFormModal(snapshot);
      });
    });

    document.getElementById('gastoForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveGasto();
    });
  },

  async saveGasto() {
    const terceroIdValue = document.getElementById('tercero_id').value;
    const formData = {
      fechaGasto: document.getElementById('fecha_gasto').value,
      concepto: document.getElementById('concepto').value.trim(),
      tipoGasto: document.getElementById('tipo_gasto').value.trim(),
      terceroId: terceroIdValue ? parseInt(terceroIdValue, 10) : null,
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

  // --- Proveedores (catálogo de Terceros) ---

  TIPOS_IDENTIFICACION: ['Cédula de Ciudadanía', 'NIT', 'Cédula de Extranjería', 'Pasaporte', 'Registro Civil', 'Otro'],
  proveedoresSearch: '',

  async renderTabProveedores() {
    const body = document.getElementById('gastosModuloBody');

    body.innerHTML = `
      <div class="table-header">
        <h2>Catálogo de Proveedores</h2>
        <div class="table-controls">
          <input type="text" id="proveedoresSearchInput" class="search-box" placeholder="Buscar por nombre o identificación...">
          <button class="btn btn-primary" id="btnNuevoProveedor">+ Nuevo Proveedor</button>
        </div>
      </div>

      <div id="proveedoresTableContent">
        <p style="padding: 24px; text-align: center;">Cargando...</p>
      </div>
    `;

    document.getElementById('proveedoresSearchInput').addEventListener('input', (e) => {
      this.proveedoresSearch = e.target.value;
      this.loadProveedores();
    });

    document.getElementById('btnNuevoProveedor').addEventListener('click', () => this.showFormModalProveedor());

    await this.loadProveedores();
  },

  async loadProveedores() {
    try {
      const response = await window.api.terceros.getAll({ busqueda: this.proveedoresSearch });
      if (response.success) {
        this.renderTablaProveedores(response.data);
      } else {
        console.error('Error al cargar proveedores:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderTablaProveedores(terceros) {
    const tableContent = document.getElementById('proveedoresTableContent');

    if (terceros.length === 0) {
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No hay proveedores registrados</p>';
      return;
    }

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Nombre / Razón Social</th>
            <th>Identificación</th>
            <th>Teléfono</th>
            <th>Tipo</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${terceros.map(t => `
            <tr>
              <td><strong>${t.nombre_razon_social}</strong>${t.nombre_comercial ? `<br><small style="color:#64748b;">${t.nombre_comercial}</small>` : ''}</td>
              <td>${t.tipo_identificacion}: ${t.numero_identificacion}</td>
              <td>${t.telefono || '-'}</td>
              <td>${[t.es_proveedor ? 'Proveedor' : '', t.es_otro ? 'Otro' : ''].filter(Boolean).join(' / ')}</td>
              <td><span class="badge badge-${t.activo ? 'activo' : 'inactivo'}">${t.activo ? 'Activo' : 'Inactivo'}</span></td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-secondary btn-icon" onclick="Gastos.showFormModalProveedor(${t.id})">Editar</button>
                  <button class="btn btn-${t.activo ? 'warning' : 'info'} btn-icon" onclick="Gastos.toggleActivoProveedor(${t.id})">${t.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  // onSaved: si se pasa, se llama con el id del proveedor en vez de refrescar la pestaña de
  // Proveedores (lo usa el formulario de Gastos para crear uno al vuelo y seleccionarlo).
  async showFormModalProveedor(id = null, onSaved = null) {
    let tercero = null;

    if (id) {
      const response = await window.api.terceros.getById(id);
      if (!response.success) {
        App.toast('Error al cargar el proveedor: ' + response.error, 'error');
        return;
      }
      tercero = response.data;
    }

    const content = `
      <div class="modal-header"><h2>${id ? 'Editar Proveedor' : 'Nuevo Proveedor'}</h2></div>
      <div id="formError"></div>
      <form id="proveedorForm">
        <div class="form-group">
          <label for="p_tipoIdentificacion">Tipo de Identificación <span style="color: #ef4444;">*</span></label>
          <select id="p_tipoIdentificacion" required>
            ${this.TIPOS_IDENTIFICACION.map(t => `<option value="${t}" ${tercero?.tipo_identificacion === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="p_numeroIdentificacion">Número de Identificación <span style="color: #ef4444;">*</span></label>
          <input type="text" id="p_numeroIdentificacion" value="${tercero?.numero_identificacion || ''}" required>
          <small style="color: #64748b; font-size: 0.875rem;">Para Cédula de Ciudadanía, NIT y Registro Civil: solo números, entre 3 y 13 dígitos</small>
        </div>
        <div class="form-group">
          <label for="p_nombreRazonSocial">Nombre o Razón Social <span style="color: #ef4444;">*</span></label>
          <input type="text" id="p_nombreRazonSocial" value="${tercero?.nombre_razon_social || ''}" required>
        </div>
        <div class="form-group">
          <label for="p_nombreComercial">Nombre Comercial</label>
          <input type="text" id="p_nombreComercial" value="${tercero?.nombre_comercial || ''}">
        </div>
        <div class="form-group">
          <label for="p_telefono">Teléfono</label>
          <input type="text" id="p_telefono" value="${tercero?.telefono || ''}">
        </div>
        <div class="form-group">
          <label for="p_email">Correo</label>
          <input type="email" id="p_email" value="${tercero?.email || ''}">
        </div>
        <div class="form-group">
          <label for="p_direccion">Dirección</label>
          <input type="text" id="p_direccion" value="${tercero?.direccion || ''}">
        </div>
        <div class="form-group">
          <label>Tipo de Tercero <span style="color: #ef4444;">*</span></label>
          <label style="display: flex; align-items: center; gap: 6px; font-weight: normal;">
            <input type="checkbox" id="p_esProveedor" ${tercero ? (tercero.es_proveedor ? 'checked' : '') : 'checked'}> Proveedor
          </label>
          <label style="display: flex; align-items: center; gap: 6px; font-weight: normal;">
            <input type="checkbox" id="p_esOtro" ${tercero?.es_otro ? 'checked' : ''}> Otro (contratista, aliado, etc.)
          </label>
        </div>
        <div class="form-group">
          <label for="p_observaciones">Observaciones</label>
          <textarea id="p_observaciones">${tercero?.observaciones || ''}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${id ? 'Actualizar' : 'Crear'}</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('proveedorForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveProveedor(id, onSaved);
    });
  },

  async saveProveedor(id, onSaved = null) {
    const formData = {
      tipoIdentificacion: document.getElementById('p_tipoIdentificacion').value,
      numeroIdentificacion: document.getElementById('p_numeroIdentificacion').value.trim(),
      nombreRazonSocial: document.getElementById('p_nombreRazonSocial').value.trim(),
      nombreComercial: document.getElementById('p_nombreComercial').value.trim(),
      telefono: document.getElementById('p_telefono').value.trim(),
      email: document.getElementById('p_email').value.trim(),
      direccion: document.getElementById('p_direccion').value.trim(),
      observaciones: document.getElementById('p_observaciones').value.trim(),
      esProveedor: document.getElementById('p_esProveedor').checked,
      esOtro: document.getElementById('p_esOtro').checked
    };

    try {
      const response = id
        ? await window.api.terceros.update(id, formData)
        : await window.api.terceros.create(formData);

      if (response.success) {
        App.closeModal();
        if (onSaved) {
          onSaved(id || response.data.id);
        } else {
          this.loadProveedores();
        }
        App.toast(id ? 'Proveedor actualizado con éxito' : 'Proveedor creado con éxito');
      } else {
        document.getElementById('formError').innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      document.getElementById('formError').innerHTML = '<div class="error-message">Error al guardar el proveedor</div>';
    }
  },

  async toggleActivoProveedor(id) {
    try {
      const response = await window.api.terceros.toggleActivo(id);
      if (response.success) {
        this.loadProveedores();
        App.toast('Estado actualizado con éxito');
      } else {
        App.toast('Error: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al actualizar el estado', 'error');
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
