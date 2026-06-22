// Módulo de Pagos
const Pagos = {
  currentPage: 1,
  limit: 10,
  search: '',
  filtroPago: '',

  async load() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Pagos</h1>
        <p>Registro de pagos de sostenimiento y abonos. Los pagos se hacen por mes calendario completo.</p>
      </div>

      <div class="table-container">
        <div class="table-header">
          <h2>Estado de Cuentas</h2>
          <div class="table-controls">
            <input type="text" id="searchInput" class="search-box" placeholder="Buscar por código o dirección...">
            <select id="filtroPagoSelect" class="filter-select">
              <option value="">Todas las cuentas</option>
              <option value="al_dia">Solo al día</option>
              <option value="en_mora">Solo en mora</option>
              <option value="saldo_favor">Solo con saldo a favor</option>
            </select>
          </div>
        </div>

        <div id="tableContent">
          <p style="padding: 24px; text-align: center;">Cargando...</p>
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadCuentas();
  },

  setupEventListeners() {
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.search = e.target.value;
      this.currentPage = 1;
      this.loadCuentas();
    });

    document.getElementById('filtroPagoSelect').addEventListener('change', (e) => {
      this.filtroPago = e.target.value;
      this.currentPage = 1;
      this.loadCuentas();
    });
  },

  async loadCuentas() {
    try {
      const response = await window.api.pagos.getCuentasConEstado({
        page: this.currentPage,
        limit: this.limit,
        search: this.search,
        estado: 'Activo',
        filtroPago: this.filtroPago
      });

      if (response.success) {
        this.renderTable(response.data);
      } else {
        console.error('Error al cargar cuentas:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderTable(data) {
    const tableContent = document.getElementById('tableContent');

    if (data.data.length === 0) {
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No se encontraron cuentas activas</p>';
      return;
    }

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Dirección</th>
            <th>Propietario</th>
            <th>Pagado Hasta</th>
            <th>Estado</th>
            <th>Saldo a Favor</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(c => `
            <tr>
              <td><strong>${c.codigo}</strong></td>
              <td>${c.direccion}</td>
              <td>${c.propietario_actual || '<em>Sin asignar</em>'}</td>
              <td>${c.pagado_hasta || '<em>Sin pagos</em>'}</td>
              <td>
                ${c.meses_mora > 0
                  ? `<span class="badge badge-mora">En mora (${c.meses_mora} ${c.meses_mora === 1 ? 'mes' : 'meses'})</span>`
                  : '<span class="badge badge-aldia">Al día</span>'}
              </td>
              <td>${c.saldo_favor > 0 ? `<span class="badge badge-favor">$${this.formatNumber(c.saldo_favor)}</span>` : '-'}</td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-primary btn-icon" onclick="Pagos.showDetalleModal(${c.id})">Ver</button>
                  <button class="btn btn-success btn-icon" onclick="Pagos.showRegistrarPagoModal(${c.id})">Registrar Pago</button>
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
          <button ${data.pagination.page === 1 ? 'disabled' : ''} onclick="Pagos.changePage(${data.pagination.page - 1})">Anterior</button>
          <button disabled>${data.pagination.page} / ${data.pagination.totalPages}</button>
          <button ${data.pagination.page >= data.pagination.totalPages ? 'disabled' : ''} onclick="Pagos.changePage(${data.pagination.page + 1})">Siguiente</button>
        </div>
      </div>
    `;
  },

  changePage(page) {
    this.currentPage = page;
    this.loadCuentas();
  },

  async showDetalleModal(cuentaId) {
    try {
      const [estadoResponse, historialResponse] = await Promise.all([
        window.api.pagos.getEstadoCuenta(cuentaId),
        window.api.pagos.getHistorialPagos(cuentaId)
      ]);

      if (!estadoResponse.success) {
        App.toast('Error al cargar el estado de la cuenta: ' + estadoResponse.error, 'error');
        return;
      }

      const estado = estadoResponse.data;
      const historial = historialResponse.success ? historialResponse.data : [];

      const content = `
        <div class="modal-header">
          <h2>Estado de Pagos</h2>
        </div>

        <div class="detail-section">
          <div class="detail-row">
            <div class="detail-label">Pagado Hasta:</div>
            <div class="detail-value">${estado.pagadoHasta ? `<strong>${estado.pagadoHasta.label}</strong>` : '<em>Sin pagos registrados</em>'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Próximo Período:</div>
            <div class="detail-value">${estado.siguientePeriodo.label}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Estado:</div>
            <div class="detail-value">${estado.estadoMora === 'En mora' ? `<span class="badge badge-mora">En mora (${estado.mesesMora} ${estado.mesesMora === 1 ? 'mes' : 'meses'})</span>` : '<span class="badge badge-aldia">Al día</span>'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Saldo a Favor:</div>
            <div class="detail-value">${estado.saldoAFavor > 0 ? `<strong>$${this.formatNumber(estado.saldoAFavor)}</strong>` : '$0'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Saldo Pendiente:</div>
            <div class="detail-value">${estado.saldoPendienteEstimado > 0 ? `<strong style="color: #ef4444;">$${this.formatNumber(estado.saldoPendienteEstimado)}</strong> <small style="color: #64748b;">(estimado a tarifa actual)</small>` : '$0'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Total Pagado:</div>
            <div class="detail-value">$${this.formatNumber(estado.totalPagado)}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Meses Cubiertos:</div>
            <div class="detail-value">${estado.totalMesesPagados}</div>
          </div>
        </div>

        <div class="detail-section">
          <h3>Historial de Meses Pagados</h3>
          ${historial.length > 0 ? `
            <table style="width: 100%; margin-top: 12px;">
              <thead>
                <tr><th>Período</th><th>Valor</th><th>Fecha de Pago</th><th>Recibo</th></tr>
              </thead>
              <tbody>
                ${historial.map(h => `
                  <tr>
                    <td>${this.formatPeriodo(h.anio, h.mes)}</td>
                    <td>$${this.formatNumber(h.valor)}</td>
                    <td>${this.formatDate(h.fecha_pago)}</td>
                    <td>${h.numero_recibo ? `<a href="#" onclick="App.closeModal(); Recibos.showDetailModal(${h.recibo_id}); return false;">No. ${h.numero_recibo}</a>` : '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="color: #64748b; margin-top: 12px;">Sin pagos registrados</p>'}
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          <button class="btn btn-success" onclick="App.closeModal(); Pagos.showRegistrarPagoModal(${cuentaId})">Registrar Pago</button>
        </div>
      `;

      App.openModal(content, 'large');
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar el estado de pagos', 'error');
    }
  },

  async showRegistrarPagoModal(cuentaId) {
    const estadoResponse = await window.api.pagos.getEstadoCuenta(cuentaId);
    if (!estadoResponse.success) {
      App.toast('Error al cargar el estado de la cuenta: ' + estadoResponse.error, 'error');
      return;
    }
    const estado = estadoResponse.data;
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Registrar Pago</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          ${estado.pagadoHasta ? `<strong>Pagado hasta:</strong> ${estado.pagadoHasta.label}.` : '<strong>Sin pagos previos.</strong>'}
          <strong>Próximo período sugerido:</strong> ${estado.siguientePeriodo.label}.
          ${estado.saldoAFavor > 0 ? `<br><strong>Saldo a favor disponible:</strong> $${this.formatNumber(estado.saldoAFavor)}` : ''}
        </p>
      </div>

      <div class="table-controls" style="margin-bottom: 20px;">
        <button class="btn btn-primary" id="btnTabSostenimiento" type="button">Pago de Sostenimiento</button>
        <button class="btn btn-secondary" id="btnTabAbono" type="button">Abono (Saldo a Favor)</button>
      </div>

      <div id="formError"></div>

      <div id="panelSostenimiento">
        <form id="sostenimientoForm">
          <div class="form-group">
            <label>Mes y Año de Inicio <span style="color: #ef4444;">*</span></label>
            <div style="display: flex; gap: 12px;">
              <select id="mes_inicio" name="mes_inicio" style="flex: 1;">
                ${this.opcionesMeses(estado.siguientePeriodo.mes)}
              </select>
              <input type="number" id="anio_inicio" name="anio_inicio" value="${estado.siguientePeriodo.anio}" min="2000" max="2100" style="flex: 1;">
            </div>
          </div>

          <div class="form-group">
            <label for="cantidad_meses">Cantidad de Meses a Pagar <span style="color: #ef4444;">*</span></label>
            <input type="number" id="cantidad_meses" name="cantidad_meses" value="1" min="1" max="120" required>
            <small style="color: #64748b; font-size: 0.875rem;">Puede pagar uno o varios meses, incluso de años distintos, atrasados o futuros.</small>
          </div>

          <div class="form-group">
            <button type="button" class="btn btn-secondary" id="btnSimular">Calcular Total</button>
          </div>

          <div id="simulacionResultado"></div>

          <div class="form-group">
            <label for="fecha_pago_sost">Fecha de Pago <span style="color: #ef4444;">*</span></label>
            <input type="date" id="fecha_pago_sost" name="fecha_pago_sost" value="${hoy}" required>
          </div>

          <div class="form-group">
            <label for="metodo_pago_sost">Método de Pago <span style="color: #ef4444;">*</span></label>
            <select id="metodo_pago_sost" name="metodo_pago_sost" required>
              <option value="Efectivo">Efectivo</option>
              <option value="Transferencia">Transferencia</option>
            </select>
          </div>

          <div class="form-group">
            <label for="observaciones_sost">Observaciones</label>
            <textarea id="observaciones_sost" name="observaciones_sost"></textarea>
          </div>

          <div class="form-actions">
            <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
            <button type="submit" class="btn btn-primary">Registrar Pago y Generar Recibo</button>
          </div>
        </form>
      </div>

      <div id="panelAbono" style="display: none;">
        <form id="abonoForm">
          <div class="form-group">
            <label for="monto_abono">Monto del Abono <span style="color: #ef4444;">*</span></label>
            <div class="input-currency">
              <span class="currency-symbol">$</span>
              <input type="text" inputmode="numeric" id="monto_abono" name="monto_abono" required>
            </div>
            <small style="color: #64748b; font-size: 0.875rem;">Este monto queda como saldo a favor y se aplicará automáticamente al pagar próximos meses.</small>
          </div>

          <div class="form-group">
            <label for="fecha_pago_abono">Fecha de Pago <span style="color: #ef4444;">*</span></label>
            <input type="date" id="fecha_pago_abono" name="fecha_pago_abono" value="${hoy}" required>
          </div>

          <div class="form-group">
            <label for="metodo_pago_abono">Método de Pago <span style="color: #ef4444;">*</span></label>
            <select id="metodo_pago_abono" name="metodo_pago_abono" required>
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
      </div>
    `;

    App.openModal(content, 'large');
    this.setupRegistrarPagoModal(cuentaId);
  },

  setupRegistrarPagoModal(cuentaId) {
    App.attachMoneyInput(document.getElementById('monto_abono'));

    const btnTabSost = document.getElementById('btnTabSostenimiento');
    const btnTabAbono = document.getElementById('btnTabAbono');
    const panelSost = document.getElementById('panelSostenimiento');
    const panelAbono = document.getElementById('panelAbono');

    btnTabSost.addEventListener('click', () => {
      panelSost.style.display = 'block';
      panelAbono.style.display = 'none';
      btnTabSost.className = 'btn btn-primary';
      btnTabAbono.className = 'btn btn-secondary';
    });

    btnTabAbono.addEventListener('click', () => {
      panelSost.style.display = 'none';
      panelAbono.style.display = 'block';
      btnTabSost.className = 'btn btn-secondary';
      btnTabAbono.className = 'btn btn-primary';
    });

    document.getElementById('btnSimular').addEventListener('click', async () => {
      await this.simularPago(cuentaId);
    });

    document.getElementById('sostenimientoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.registrarPago(cuentaId);
    });

    document.getElementById('abonoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.registrarAbono(cuentaId);
    });
  },

  async simularPago(cuentaId) {
    const mesInicio = parseInt(document.getElementById('mes_inicio').value, 10);
    const anioInicio = parseInt(document.getElementById('anio_inicio').value, 10);
    const cantidadMeses = parseInt(document.getElementById('cantidad_meses').value, 10);
    const resultadoDiv = document.getElementById('simulacionResultado');
    const errorDiv = document.getElementById('formError');

    errorDiv.innerHTML = '';

    try {
      const response = await window.api.pagos.simularPago(cuentaId, anioInicio, mesInicio, cantidadMeses);

      if (!response.success) {
        resultadoDiv.innerHTML = '';
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        return;
      }

      const sim = response.data;
      resultadoDiv.innerHTML = `
        <div style="padding: 16px; background: #f8fafc; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0 0 8px 0; font-size: 0.875rem;"><strong>Meses a pagar:</strong> ${sim.periodos.map(p => p.label).join(', ')}</p>
          <p style="margin: 0 0 8px 0; font-size: 0.875rem;"><strong>Subtotal sostenimiento:</strong> $${this.formatNumber(sim.subtotal)}</p>
          ${sim.creditoAplicado > 0 ? `<p style="margin: 0 0 8px 0; font-size: 0.875rem; color: #059669;"><strong>Saldo a favor aplicado:</strong> -$${this.formatNumber(sim.creditoAplicado)}</p>` : ''}
          <p style="margin: 0; font-size: 1.1rem;"><strong>Total a cobrar: $${this.formatNumber(sim.totalACobrar)}</strong></p>
        </div>
      `;
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al calcular el total</div>`;
    }
  },

  async registrarPago(cuentaId) {
    const mesInicio = parseInt(document.getElementById('mes_inicio').value, 10);
    const anioInicio = parseInt(document.getElementById('anio_inicio').value, 10);
    const cantidadMeses = parseInt(document.getElementById('cantidad_meses').value, 10);
    const fechaPago = document.getElementById('fecha_pago_sost').value;
    const metodoPago = document.getElementById('metodo_pago_sost').value;
    const observaciones = document.getElementById('observaciones_sost').value.trim();
    const errorDiv = document.getElementById('formError');

    try {
      const response = await window.api.pagos.registrarPagoSostenimiento({
        cuentaId, anioInicio, mesInicio, cantidadMeses, fechaPago, metodoPago, observaciones
      });

      if (response.success) {
        App.closeModal();
        this.loadCuentas();
        App.toast(`Pago registrado con éxito. Recibo No. ${response.data.numeroRecibo}`);
      } else {
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al registrar el pago</div>`;
    }
  },

  async registrarAbono(cuentaId) {
    const monto = App.parseMoneyValue(document.getElementById('monto_abono').value);
    const fechaPago = document.getElementById('fecha_pago_abono').value;
    const metodoPago = document.getElementById('metodo_pago_abono').value;
    const observaciones = document.getElementById('observaciones_abono').value.trim();
    const errorDiv = document.getElementById('formError');

    try {
      const response = await window.api.pagos.registrarAbono({
        cuentaId, monto, fechaPago, metodoPago, observaciones
      });

      if (response.success) {
        App.closeModal();
        this.loadCuentas();
        App.toast(`Abono registrado con éxito. Recibo No. ${response.data.numeroRecibo}`);
      } else {
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al registrar el abono</div>`;
    }
  },

  opcionesMeses(mesSeleccionado) {
    const nombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return nombres.map((nombre, i) => `<option value="${i + 1}" ${i + 1 === mesSeleccionado ? 'selected' : ''}>${nombre}</option>`).join('');
  },

  formatPeriodo(anio, mes) {
    const nombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${nombres[mes - 1]} ${anio}`;
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
