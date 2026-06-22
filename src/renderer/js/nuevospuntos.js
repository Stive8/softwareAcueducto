// Módulo de Nuevos Puntos
const NuevosPuntos = {
  currentPage: 1,
  limit: 10,
  estado: '',
  search: '',

  async load() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Nuevos Puntos</h1>
        <p>Registro de nuevas conexiones y sus abonos. El valor total se cobra mediante uno o varios abonos.</p>
      </div>

      <div class="table-container">
        <div class="table-header">
          <h2>Listado de Nuevos Puntos</h2>
          <div class="table-controls">
            <input type="text" id="searchInput" class="search-box" placeholder="Buscar por código o dirección...">
            <select id="estadoFilter" class="filter-select">
              <option value="">Todos los estados</option>
              <option value="Pendiente">Pendiente</option>
              <option value="Pagado">Pagado</option>
              <option value="Cancelado">Cancelado</option>
            </select>
            <button class="btn btn-primary" id="btnNuevoPunto">+ Nuevo Punto</button>
          </div>
        </div>

        <div id="tableContent">
          <p style="padding: 24px; text-align: center;">Cargando...</p>
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadPuntos();
  },

  setupEventListeners() {
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.search = e.target.value;
      this.currentPage = 1;
      this.loadPuntos();
    });

    document.getElementById('estadoFilter').addEventListener('change', (e) => {
      this.estado = e.target.value;
      this.currentPage = 1;
      this.loadPuntos();
    });

    document.getElementById('btnNuevoPunto').addEventListener('click', () => {
      this.showFormModal();
    });
  },

  async loadPuntos() {
    try {
      const response = await window.api.nuevosPuntos.getAll({
        page: this.currentPage,
        limit: this.limit,
        estado: this.estado,
        search: this.search
      });

      if (response.success) {
        this.renderTable(response.data);
      } else {
        console.error('Error al cargar puntos nuevos:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderTable(data) {
    const tableContent = document.getElementById('tableContent');

    if (data.data.length === 0) {
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No se encontraron puntos nuevos</p>';
      return;
    }

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Cuenta</th>
            <th>Dirección</th>
            <th>Valor Total</th>
            <th>Abonado</th>
            <th>Saldo Pendiente</th>
            <th>Estado</th>
            <th>Fecha</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(p => `
            <tr>
              <td><strong>${p.cuenta_codigo}</strong></td>
              <td>${p.cuenta_direccion}</td>
              <td>$${this.formatNumber(p.valor_total)}</td>
              <td>$${this.formatNumber(p.total_abonado)}</td>
              <td>$${this.formatNumber(p.saldo_pendiente)}</td>
              <td><span class="badge badge-${p.estado === 'Pagado' ? 'activo' : (p.estado === 'Cancelado' ? 'inactivo' : 'suspendido')}">${p.estado}</span></td>
              <td>${this.formatDate(p.fecha_registro)}</td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-primary btn-icon" onclick="NuevosPuntos.showDetailModal(${p.id})">Ver</button>
                  ${p.estado === 'Pendiente' ? `<button class="btn btn-success btn-icon" onclick="NuevosPuntos.showAbonoModal(${p.id})">Abonar</button>` : ''}
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
          <button ${data.pagination.page === 1 ? 'disabled' : ''} onclick="NuevosPuntos.changePage(${data.pagination.page - 1})">Anterior</button>
          <button disabled>${data.pagination.page} / ${data.pagination.totalPages}</button>
          <button ${data.pagination.page >= data.pagination.totalPages ? 'disabled' : ''} onclick="NuevosPuntos.changePage(${data.pagination.page + 1})">Siguiente</button>
        </div>
      </div>
    `;
  },

  changePage(page) {
    this.currentPage = page;
    this.loadPuntos();
  },

  async showDetailModal(id) {
    try {
      const response = await window.api.nuevosPuntos.getById(id);
      if (!response.success) {
        App.toast('Error al cargar el punto nuevo: ' + response.error, 'error');
        return;
      }

      const punto = response.data;

      const content = `
        <div class="modal-header"><h2>Detalle de Punto Nuevo</h2></div>

        <div class="detail-section">
          <div class="detail-row"><div class="detail-label">Cuenta:</div><div class="detail-value"><strong>${punto.cuenta_codigo}</strong> - ${punto.cuenta_direccion}</div></div>
          <div class="detail-row"><div class="detail-label">Valor Total:</div><div class="detail-value">$${this.formatNumber(punto.valor_total)}</div></div>
          <div class="detail-row"><div class="detail-label">Saldo Pendiente:</div><div class="detail-value"><strong>$${this.formatNumber(punto.saldo_pendiente)}</strong></div></div>
          <div class="detail-row"><div class="detail-label">Estado:</div><div class="detail-value"><span class="badge badge-${punto.estado === 'Pagado' ? 'activo' : (punto.estado === 'Cancelado' ? 'inactivo' : 'suspendido')}">${punto.estado}</span></div></div>
          <div class="detail-row"><div class="detail-label">Fecha Registro:</div><div class="detail-value">${this.formatDate(punto.fecha_registro)}</div></div>
          ${punto.observaciones ? `<div class="detail-row"><div class="detail-label">Observaciones:</div><div class="detail-value">${punto.observaciones}</div></div>` : ''}
        </div>

        <div class="detail-section">
          <h3>Historial de Abonos</h3>
          ${punto.abonos.length > 0 ? `
            <table style="width:100%; margin-top:12px;">
              <thead><tr><th>Fecha</th><th>Monto</th><th>Recibo</th></tr></thead>
              <tbody>
                ${punto.abonos.map(a => `
                  <tr>
                    <td>${this.formatDate(a.fecha_abono)}</td>
                    <td>$${this.formatNumber(a.monto)}</td>
                    <td>${a.numero_recibo ? 'No. ' + a.numero_recibo : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="color:#64748b; margin-top:12px;">Sin abonos registrados</p>'}
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          ${punto.estado === 'Pendiente' ? `
            <button class="btn btn-warning" onclick="App.closeModal(); NuevosPuntos.showCancelarModal(${punto.id})">Cancelar</button>
            <button class="btn btn-success" onclick="App.closeModal(); NuevosPuntos.showAbonoModal(${punto.id})">Abonar</button>
          ` : ''}
        </div>
      `;

      App.openModal(content, 'large');
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar el punto nuevo', 'error');
    }
  },

  async showFormModal() {
    const cuentasResponse = await window.api.cuentas.getAll({ limit: 1000, estado: 'Activo' });
    const cuentas = cuentasResponse.success ? cuentasResponse.data.data : [];
    const hoy = new Date().toISOString().split('T')[0];

    const configResponse = await window.api.config.getAll();
    const valorDefecto = configResponse.success ? configResponse.data.valor_nuevo_punto : '';

    const content = `
      <div class="modal-header"><h2>Nuevo Punto</h2></div>
      <div id="formError"></div>
      <form id="puntoForm">
        <div class="form-group">
          <label for="cuenta_id">Cuenta <span style="color: #ef4444;">*</span></label>
          <select id="cuenta_id" name="cuenta_id" required>
            <option value="">Seleccione una cuenta...</option>
            ${cuentas.map(c => `<option value="${c.id}">${c.codigo} - ${c.direccion}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label for="valor_total">Valor Total <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="valor_total" name="valor_total" value="${App.formatMoneyValue(valorDefecto)}" required>
          </div>
        </div>

        <div class="form-group">
          <label for="fecha_registro">Fecha de Registro <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_registro" name="fecha_registro" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones">Observaciones</label>
          <textarea id="observaciones" name="observaciones"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Punto Nuevo</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('valor_total'));

    document.getElementById('puntoForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const datos = {
        cuentaId: document.getElementById('cuenta_id').value,
        valorTotal: App.parseMoneyValue(document.getElementById('valor_total').value),
        fechaRegistro: document.getElementById('fecha_registro').value,
        observaciones: document.getElementById('observaciones').value.trim()
      };

      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.nuevosPuntos.create(datos);
        if (response.success) {
          App.closeModal();
          this.loadPuntos();
          App.toast('Punto nuevo registrado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el punto nuevo</div>`;
      }
    });
  },

  async showAbonoModal(nuevoPuntoId) {
    const response = await window.api.nuevosPuntos.getById(nuevoPuntoId);
    if (!response.success) {
      App.toast('Error al cargar el punto nuevo', 'error');
      return;
    }
    const punto = response.data;
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header"><h2>Registrar Abono</h2></div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Cuenta:</strong> ${punto.cuenta_codigo} - ${punto.cuenta_direccion}<br>
          <strong>Saldo Pendiente:</strong> $${this.formatNumber(punto.saldo_pendiente)}
        </p>
      </div>

      <div id="formError"></div>

      <form id="abonoForm">
        <div class="form-group">
          <label for="monto_abono">Monto del Abono <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="monto_abono" name="monto_abono" required>
          </div>
        </div>

        <div class="form-group">
          <label for="fecha_abono">Fecha <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_abono" name="fecha_abono" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="metodo_pago">Método de Pago <span style="color: #ef4444;">*</span></label>
          <select id="metodo_pago" name="metodo_pago" required>
            <option value="Efectivo">Efectivo</option>
            <option value="Transferencia">Transferencia</option>
          </select>
        </div>

        <div class="form-group">
          <label for="observaciones_abono">Observaciones</label>
          <textarea id="observaciones_abono" name="observaciones_abono"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Abono y Generar Recibo</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('monto_abono'));

    document.getElementById('abonoForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const payload = {
        nuevoPuntoId,
        monto: App.parseMoneyValue(document.getElementById('monto_abono').value),
        fechaAbono: document.getElementById('fecha_abono').value,
        metodoPago: document.getElementById('metodo_pago').value,
        observaciones: document.getElementById('observaciones_abono').value.trim()
      };

      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.nuevosPuntos.registrarAbono(payload);
        if (response.success) {
          App.closeModal();
          this.loadPuntos();
          App.toast(`Abono registrado con éxito. Recibo No. ${response.data.numeroRecibo}`);
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el abono</div>`;
      }
    });
  },

  showCancelarModal(id) {
    const content = `
      <div class="modal-header"><h2>Cancelar Punto Nuevo</h2></div>

      <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
          <strong>Nota:</strong> El registro no se elimina, queda marcado como cancelado. Los abonos ya recibidos no se reversan.
        </p>
      </div>

      <div id="formError"></div>

      <form id="cancelarForm">
        <div class="form-group">
          <label for="motivo">Motivo de la Cancelación <span style="color: #ef4444;">*</span></label>
          <textarea id="motivo" name="motivo" required></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-warning">Confirmar Cancelación</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('cancelarForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const motivo = document.getElementById('motivo').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.nuevosPuntos.cancelar(id, motivo);
        if (response.success) {
          App.closeModal();
          this.loadPuntos();
          App.toast('Punto nuevo cancelado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al cancelar el punto nuevo</div>`;
      }
    });
  },

  formatNumber(num) {
    return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  },

  formatDate(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
  }
};
