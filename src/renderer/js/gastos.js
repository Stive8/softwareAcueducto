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

  // tabInicial: a qué pestaña entrar (la elige el submenú del sidebar al pasar el cursor sobre
  // "Gastos"). Si no se indica, se mantiene en la última que estaba abierta.
  async load(tabInicial = null) {
    const content = document.getElementById('page-content');

    content.innerHTML = `
      <div class="page-header">
        <h1>Gastos</h1>
        <p>Registro de gastos del acueducto y catálogo de proveedores</p>
      </div>

      <div class="stats-grid" id="gastosStatsGrid"></div>

      <div class="table-container">
        <div id="gastosModuloBody"></div>
      </div>
    `;

    await this.mostrarTab(tabInicial || this.tabActual);
  },

  async mostrarTab(tab) {
    this.tabActual = tab;

    if (tab === 'gastos') {
      await this.renderTabGastos();
    } else {
      document.getElementById('gastosStatsGrid').innerHTML = '';
      if (tab === 'proveedores') await this.renderTabProveedores();
    }
  },

  async loadStats() {
    const grid = document.getElementById('gastosStatsGrid');
    try {
      const response = await window.api.gastos.getStats({
        search: this.search,
        tipoGasto: this.tipoGasto,
        fechaDesde: this.fechaDesde,
        fechaHasta: this.fechaHasta
      });
      if (!response.success) {
        console.error('Error al cargar métricas de gastos:', response.error);
        return;
      }
      const { totalMes, totalFiltrado, cantidadFiltrado } = response.data;
      grid.innerHTML = App.renderStatsGrid([
        { titulo: 'Total Gastos del Mes', valor: `$${this.formatNumber(totalMes)}`, icono: 'trendingDown' },
        { titulo: 'Total del Filtro Activo', valor: `$${this.formatNumber(totalFiltrado)}`, footer: `${cantidadFiltrado} gastos`, icono: 'barChart' }
      ]);
    } catch (error) {
      console.error('Error:', error);
    }
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
        ${App.renderSkeletonTable()}
      </div>
    `;

    this.setupEventListeners();
    await this.loadStats();
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
    document.getElementById('searchInput').addEventListener('input', App.debounce((e) => {
      this.search = e.target.value;
      this.currentPage = 1;
      this.loadStats();
      this.loadGastos();
    }));

    document.getElementById('tipoFilter').addEventListener('change', (e) => {
      this.tipoGasto = e.target.value;
      this.currentPage = 1;
      this.loadStats();
      this.loadGastos();
    });

    document.getElementById('fechaDesdeFilter').addEventListener('change', (e) => {
      this.fechaDesde = e.target.value;
      this.currentPage = 1;
      this.loadStats();
      this.loadGastos();
    });

    document.getElementById('fechaHastaFilter').addEventListener('change', (e) => {
      this.fechaHasta = e.target.value;
      this.currentPage = 1;
      this.loadStats();
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
      const soportesResponse = await window.api.gastos.getSoportes(id);
      const soportes = soportesResponse.success ? soportesResponse.data : [];

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
            <div class="detail-label">Tipo de Operación:</div>
            <div class="detail-value">${gasto.tipo_operacion}</div>
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
          ${gasto.motivo_correccion_pago ? `
            <div class="detail-row">
              <div class="detail-label">Corrección Método de Pago:</div>
              <div class="detail-value">${gasto.motivo_correccion_pago} (${this.formatDate(gasto.fecha_correccion_pago)})</div>
            </div>
          ` : ''}
          <div class="detail-row">
            <div class="detail-label">Soportes:</div>
            <div class="detail-value">
              ${soportes.length === 0 ? 'Sin soportes adjuntos' : soportes.map(s => `
                <div style="margin-bottom: 4px;">
                  <span class="badge badge-activo">${s.tipo_soporte}</span> ${s.nombre_archivo}
                  <button class="btn btn-secondary btn-icon" onclick="Gastos.verSoporte(${gasto.id}, ${s.id})">Ver</button>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          ${gasto.estado !== 'Anulado' ? `<button class="btn btn-secondary" onclick="Gastos.agregarSoporte(${gasto.id})">+ Agregar Soporte</button>` : ''}
          ${gasto.estado !== 'Anulado' ? `<button class="btn btn-secondary" onclick="Gastos.showCorregirMetodoPagoModal(${gasto.id}, '${gasto.metodo_pago}')">Corregir Método de Pago</button>` : ''}
          ${gasto.estado !== 'Anulado' ? `<button class="btn btn-warning" onclick="App.closeModal(); Gastos.showAnularModal(${gasto.id})">Anular</button>` : ''}
        </div>
      `;

      App.openModal(content);
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar el gasto', 'error');
    }
  },

  async agregarSoporte(gastoId) {
    const opciones = this.TIPOS_SOPORTE.map(t => `<option value="${t}">${t}</option>`).join('');
    const content = `
      <div class="modal-header"><h2>Agregar Soporte</h2></div>
      <div id="formError"></div>
      <form id="soporteForm">
        <div class="form-group">
          <label for="tipo_soporte">Tipo de Soporte <span style="color: #ef4444;">*</span></label>
          <select id="tipo_soporte" required>${opciones}</select>
        </div>
        <p style="color: #64748b; font-size: 0.875rem;">Al continuar se abrirá el explorador de archivos para elegir el PDF o imagen (máx. 15 MB).</p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Seleccionar archivo</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('soporteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const tipoSoporte = document.getElementById('tipo_soporte').value;
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.gastos.adjuntarSoporte(gastoId, tipoSoporte);

        if (response.canceled) return;

        if (response.success) {
          App.toast('Soporte adjuntado con éxito');
          this.showDetailModal(gastoId);
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = '<div class="error-message">Error al adjuntar el soporte</div>';
      }
    });
  },

  async verSoporte(gastoId, soporteId) {
    App.toast('Abriendo soporte...');
    try {
      const response = await window.api.gastos.getSoporte(gastoId, soporteId);
      if (!response.success) {
        App.toast('Error: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al abrir el soporte', 'error');
    }
  },

  // prefill: para reabrir el formulario con lo que el usuario ya había escrito, después de
  // crear un proveedor nuevo desde aquí mismo sin perder el resto de los datos del gasto.
  async showFormModal(prefill = null) {
    const hoy = new Date().toISOString().split('T')[0];

    const mapeoResponse = await window.api.mapeoContable.getAll('Gasto');
    const tiposDisponibles = mapeoResponse.success
      ? mapeoResponse.data.filter(m => m.concepto !== '__default__').sort((a, b) => a.concepto.localeCompare(b.concepto))
      : [];

    const proveedoresResponse = await window.api.terceros.getAll({ soloActivos: true });
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
          <label for="tipo_gasto">Tipo de Gasto <span style="color: #ef4444;">*</span></label>
          <select id="tipo_gasto" name="tipo_gasto" required>
            <option value="">Seleccione...</option>
            ${tiposDisponibles.map(t => `<option value="${t.concepto}" ${prefill?.tipo_gasto === t.concepto ? 'selected' : ''}>${t.concepto} (${t.cuenta_codigo} - ${t.cuenta_nombre})</option>`).join('')}
          </select>
          <small style="color: #64748b; font-size: 0.875rem;">¿No encuentras el tipo que necesitas? Agrégalo en Contabilidad → Mapeo de Conceptos.</small>
          <div id="avisoGastosDiversos" style="display: none; margin-top: 8px; padding: 10px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; font-size: 0.875rem; color: #92400e;">
            Si existe un concepto más específico, te recomendamos usarlo en vez de "Gastos Diversos" para mejorar la calidad de los reportes.
          </div>
        </div>

        <div class="form-group">
          <label for="tipo_operacion">Tipo de Operación <span style="color: #ef4444;">*</span></label>
          <select id="tipo_operacion" name="tipo_operacion" required>
            <option value="Compra directa" ${(prefill?.tipo_operacion || 'Compra directa') === 'Compra directa' ? 'selected' : ''}>Compra directa</option>
            <option value="Reembolso" ${prefill?.tipo_operacion === 'Reembolso' ? 'selected' : ''}>Reembolso</option>
          </select>
          <small style="color: #64748b; font-size: 0.875rem;">Reembolso: alguien pagó con su propio dinero y el acueducto le devolvió el valor; el tercero debe ser esa persona, no el proveedor original.</small>
        </div>

        <div class="form-group">
          <label for="tercero_id">Tercero <span style="color: #ef4444;">*</span></label>
          <div style="display: flex; gap: 8px;">
            <select id="tercero_id" style="flex: 1;" required>
              ${proveedores.map(t => `<option value="${t.id}" ${prefill?.terceroId == t.id ? 'selected' : ''}>${t.nombre_razon_social}${t.numero_identificacion ? ' - ' + t.numero_identificacion : ''}</option>`).join('')}
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

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Gasto</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('valor'));
    Combobox.attach('tipo_gasto');
    Combobox.attach('tercero_id');

    document.getElementById('tipo_gasto').addEventListener('change', (e) => {
      document.getElementById('avisoGastosDiversos').style.display = e.target.value === 'Gastos Diversos' ? 'block' : 'none';
    });

    document.getElementById('btnNuevoProveedorDesdeGasto').addEventListener('click', () => {
      const snapshot = {
        fecha_gasto: document.getElementById('fecha_gasto').value,
        concepto: document.getElementById('concepto').value,
        tipo_gasto: document.getElementById('tipo_gasto').value,
        tipo_operacion: document.getElementById('tipo_operacion').value,
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
    const formData = {
      fechaGasto: document.getElementById('fecha_gasto').value,
      concepto: document.getElementById('concepto').value.trim(),
      tipoGasto: document.getElementById('tipo_gasto').value.trim(),
      tipoOperacion: document.getElementById('tipo_operacion').value,
      terceroId: parseInt(document.getElementById('tercero_id').value, 10),
      valor: App.parseMoneyValue(document.getElementById('valor').value),
      metodoPago: document.getElementById('metodo_pago').value,
      observaciones: document.getElementById('observaciones').value.trim()
    };

    try {
      const response = await window.api.gastos.create(formData);

      if (response.success) {
        App.closeModal();
        this.loadStats();
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
          this.loadStats();
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

  showCorregirMetodoPagoModal(id, metodoActual) {
    const otroMetodo = metodoActual === 'Efectivo' ? 'Transferencia' : 'Efectivo';
    const content = `
      <div class="modal-header">
        <h2>Corregir Método de Pago</h2>
      </div>

      <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
          <strong>Nota:</strong> Esto NO anula el gasto. El número, fecha, valor y proveedor quedan intactos; solo se corrige a qué cuenta (Caja o Banco) quedó asociado el dinero, y se ajustan el movimiento y el asiento contable.
        </p>
      </div>

      <div id="formError"></div>

      <form id="corregirMetodoPagoForm">
        <div class="form-group">
          <label for="nuevo_metodo_pago">Método de Pago Correcto <span style="color: #ef4444;">*</span></label>
          <select id="nuevo_metodo_pago" required>
            <option value="${otroMetodo}" selected>${otroMetodo}</option>
            <option value="${metodoActual}">${metodoActual} (actual)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="motivo_correccion">Motivo de la Corrección <span style="color: #ef4444;">*</span></label>
          <textarea id="motivo_correccion" name="motivo_correccion" required></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Confirmar Corrección</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('corregirMetodoPagoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nuevoMetodoPago = document.getElementById('nuevo_metodo_pago').value;
      const motivo = document.getElementById('motivo_correccion').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.gastos.corregirMetodoPago(id, nuevoMetodoPago, motivo);

        if (response.success) {
          App.closeModal();
          this.loadStats();
          this.loadGastos();
          App.toast('Método de pago corregido con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al corregir el método de pago</div>`;
      }
    });
  },

  // --- Proveedores (catálogo de Terceros) ---

  TIPOS_IDENTIFICACION: ['Cédula de Ciudadanía', 'NIT', 'Cédula de Extranjería', 'Pasaporte', 'Registro Civil', 'Otro', 'No informado'],
  TIPOS_SOPORTE: ['Factura electrónica', 'Factura física', 'Recibo simple', 'Comprobante interno', 'Imagen', 'PDF'],
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
        ${App.renderSkeletonTable()}
      </div>
    `;

    document.getElementById('proveedoresSearchInput').addEventListener('input', App.debounce((e) => {
      this.proveedoresSearch = e.target.value;
      this.loadProveedores();
    }));

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
              <td>${[t.es_proveedor ? 'Proveedor' : '', t.es_contratista ? 'Contratista' : '', t.es_aliado ? 'Aliado' : '', t.es_otro ? 'Otro' : ''].filter(Boolean).join(' / ')}</td>
              <td><span class="badge badge-${t.activo ? 'activo' : 'inactivo'}">${t.activo ? 'Activo' : 'Inactivo'}</span></td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-secondary btn-icon" onclick="Gastos.showHistorialModal(${t.id})">Historial</button>
                  ${t.es_sistema ? '' : `<button class="btn btn-secondary btn-icon" onclick="Gastos.showFormModalProveedor(${t.id})">Editar</button>
                  <button class="btn btn-${t.activo ? 'warning' : 'info'} btn-icon" onclick="Gastos.toggleActivoProveedor(${t.id})">${t.activo ? 'Desactivar' : 'Activar'}</button>`}
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
          <input type="text" id="p_numeroIdentificacion" value="${tercero?.numero_identificacion || ''}" ${tercero?.tipo_identificacion === 'No informado' ? 'disabled' : 'required'}>
          <small style="color: #64748b; font-size: 0.875rem;">Para Cédula de Ciudadanía, NIT y Registro Civil: solo números, entre 3 y 13 dígitos. "No informado" no requiere número.</small>
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
          <label class="form-check">
            <input type="checkbox" id="p_esProveedor" ${tercero ? (tercero.es_proveedor ? 'checked' : '') : 'checked'}> Proveedor
          </label>
          <label class="form-check">
            <input type="checkbox" id="p_esContratista" ${tercero?.es_contratista ? 'checked' : ''}> Contratista
          </label>
          <label class="form-check">
            <input type="checkbox" id="p_esAliado" ${tercero?.es_aliado ? 'checked' : ''}> Aliado
          </label>
          <label class="form-check">
            <input type="checkbox" id="p_esOtro" ${tercero?.es_otro ? 'checked' : ''}> Otro
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

    document.getElementById('p_tipoIdentificacion').addEventListener('change', (e) => {
      const numeroInput = document.getElementById('p_numeroIdentificacion');
      if (e.target.value === 'No informado') {
        numeroInput.value = '';
        numeroInput.disabled = true;
        numeroInput.required = false;
      } else {
        numeroInput.disabled = false;
        numeroInput.required = true;
      }
    });

    document.getElementById('proveedorForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveProveedor(id, onSaved);
    });
  },

  async saveProveedor(id, onSaved = null) {
    const tipoIdentificacion = document.getElementById('p_tipoIdentificacion').value;
    const formData = {
      tipoIdentificacion,
      numeroIdentificacion: tipoIdentificacion === 'No informado' ? null : document.getElementById('p_numeroIdentificacion').value.trim(),
      nombreRazonSocial: document.getElementById('p_nombreRazonSocial').value.trim(),
      nombreComercial: document.getElementById('p_nombreComercial').value.trim(),
      telefono: document.getElementById('p_telefono').value.trim(),
      email: document.getElementById('p_email').value.trim(),
      direccion: document.getElementById('p_direccion').value.trim(),
      observaciones: document.getElementById('p_observaciones').value.trim(),
      esProveedor: document.getElementById('p_esProveedor').checked,
      esContratista: document.getElementById('p_esContratista').checked,
      esAliado: document.getElementById('p_esAliado').checked,
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

  async showHistorialModal(terceroId) {
    try {
      const response = await window.api.terceros.getHistorialMovimientos(terceroId);
      if (!response.success) {
        App.toast('Error al cargar el historial: ' + response.error, 'error');
        return;
      }

      const movimientos = response.data;
      const content = `
        <div class="modal-header"><h2>Historial de Movimientos</h2></div>
        ${movimientos.length === 0 ? '<p style="color: #64748b;">Este tercero no tiene gastos asociados.</p>' : `
          <table>
            <thead>
              <tr><th>Fecha</th><th>Concepto</th><th>Tipo de Gasto</th><th>Valor</th><th>Estado</th></tr>
            </thead>
            <tbody>
              ${movimientos.map(m => `
                <tr>
                  <td>${this.formatDate(m.fecha_gasto)}</td>
                  <td>${m.concepto}</td>
                  <td>${m.tipo_gasto || '-'}</td>
                  <td>$${this.formatNumber(m.valor)}</td>
                  <td><span class="badge badge-${m.estado === 'Anulado' ? 'inactivo' : 'activo'}">${m.estado}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
        </div>
      `;

      App.openModal(content);
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar el historial', 'error');
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
