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

      <div class="stats-grid" id="saldosGrid">${App.renderSkeletonStatsGrid(3)}</div>

      <div id="cajaMenorCard"></div>

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header">
          <h2>Resumen del Período</h2>
          <p style="color: #64748b; font-size: 13px;">Usa los filtros de fecha de "Historial de Movimientos" para cambiar el período.</p>
        </div>
        <div class="stats-grid" id="resumenPeriodoGrid" style="padding: 24px;">${App.renderSkeletonStatsGrid(3)}</div>
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
            <button class="btn btn-secondary" id="btnRetiro">+ Registrar Retiro</button>
            ${App.currentUser.rol === 'Administrador' ? '<button class="btn btn-secondary" id="btnRegularizarSaldos">Ajustar saldos</button>' : ''}
          </div>
        </div>

        <div id="tableContent">
          ${App.renderSkeletonTable()}
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadSaldos();
    await this.loadCajaMenor();
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

    document.getElementById('btnRetiro').addEventListener('click', () => {
      this.showRetiroModal();
    });

    const btnRegularizarSaldos = document.getElementById('btnRegularizarSaldos');
    if (btnRegularizarSaldos) {
      btnRegularizarSaldos.addEventListener('click', async () => {
        try {
          const response = await window.api.caja.getSaldos();
          if (!response.success) {
            App.toast('No se pudieron cargar los saldos actuales', 'error');
            return;
          }
          this.showRegularizarSaldosModal(response.data.saldoCaja, response.data.saldoBanco);
        } catch (error) {
          console.error('Error:', error);
          App.toast('No se pudieron cargar los saldos actuales', 'error');
        }
      });
    }
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

      saldosGrid.innerHTML = App.renderStatsGrid([
        { titulo: 'Saldo en Caja', valor: `$${this.formatNumber(saldoCaja)}`, icono: 'wallet' },
        { titulo: 'Saldo en Banco', valor: `$${this.formatNumber(saldoBanco)}`, icono: 'landmark' },
        { titulo: 'Total Disponible', valor: `$${this.formatNumber(saldoCaja + saldoBanco)}`, icono: 'barChart' }
      ]);
    } catch (error) {
      console.error('Error:', error);
    }
  },

  async loadCajaMenor() {
    try {
      const response = await window.api.cajaMenor.getEstado();
      const container = document.getElementById('cajaMenorCard');
      if (!response.success || !response.data.activa) {
        container.innerHTML = '';
        return;
      }

      const estado = response.data;
      const puedeReembolsar = estado.montoReembolso > 0 && !!estado.responsable;

      container.innerHTML = `
        <div class="table-container" style="margin-bottom: 24px;">
          <div class="table-header"><h2>Caja Menor</h2></div>
          <div style="padding: 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
            <div>
              <p style="margin: 0; font-size: 1.5rem; font-weight: 700;">
                $${this.formatNumber(estado.saldoActual)}
                <span style="font-size: 1rem; font-weight: 400; color: #64748b;">de $${this.formatNumber(estado.saldoObjetivo)}</span>
              </p>
              <p style="margin: 4px 0 0; color: #64748b; font-size: 0.875rem;">
                Responsable: ${estado.responsable ? estado.responsable.nombre_razon_social : 'Sin asignar'}
              </p>
            </div>
            <button class="btn btn-primary" id="btnReembolsarCajaMenor" ${puedeReembolsar ? '' : 'disabled'}>+ Reembolsar Caja Menor</button>
          </div>
        </div>
      `;

      if (puedeReembolsar) {
        document.getElementById('btnReembolsarCajaMenor').addEventListener('click', () => this.showReembolsoCajaMenorModal(estado));
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  showReembolsoCajaMenorModal(estado) {
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Reembolsar Caja Menor</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          Traslada <strong>$${this.formatNumber(estado.montoReembolso)}</strong> de Caja General a Caja Menor,
          para volver al saldo objetivo de $${this.formatNumber(estado.saldoObjetivo)}.
          Responsable: <strong>${estado.responsable ? estado.responsable.nombre_razon_social : 'Sin asignar'}</strong>.
        </p>
      </div>

      <div id="formError"></div>

      <form id="reembolsoCajaMenorForm">
        <div class="form-group">
          <label for="fecha_reembolso">Fecha <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_reembolso" name="fecha_reembolso" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_reembolso">Observaciones</label>
          <textarea id="observaciones_reembolso" name="observaciones_reembolso"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Reembolsar</button>
        </div>
      </form>
    `;

    App.openModal(content);

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('reembolsoCajaMenorForm'), async () => {
      const fecha = document.getElementById('fecha_reembolso').value;
      const observaciones = document.getElementById('observaciones_reembolso').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.cajaMenor.reembolsar({ fecha, observaciones, opId });

        if (response.success) {
          App.closeModal();
          this.loadCajaMenor();
          App.toast('Reembolso de Caja Menor registrado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el reembolso</div>`;
      }
    });
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

      grid.innerHTML = App.renderStatsGrid([
        { titulo: 'Ingresos del Período', valor: `$${this.formatNumber(ingresos)}`, icono: 'barChart', valorColor: '#10b981' },
        { titulo: 'Gastos del Período', valor: `$${this.formatNumber(gastos)}`, icono: 'trendingDown', valorColor: '#ef4444' },
        { titulo: 'Flujo Neto', valor: `$${this.formatNumber(flujoNeto)}`, icono: 'wallet', valorColor: colorFlujo }
      ]);
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

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('consignacionForm'), async () => {
      const monto = App.parseMoneyValue(document.getElementById('monto_consignacion').value);
      const fecha = document.getElementById('fecha_consignacion').value;
      const observaciones = document.getElementById('observaciones_consignacion').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.caja.registrarConsignacion({ monto, fecha, observaciones, opId });

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

  showRetiroModal() {
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Registrar Retiro</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Nota:</strong> Disminuye el saldo de Banco y aumenta el saldo de Caja por el mismo monto.
        </p>
      </div>

      <div id="formError"></div>

      <form id="retiroForm">
        <div class="form-group">
          <label for="monto_retiro">Monto a Retirar <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="monto_retiro" name="monto_retiro" required>
          </div>
        </div>

        <div class="form-group">
          <label for="fecha_retiro">Fecha <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_retiro" name="fecha_retiro" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_retiro">Observaciones</label>
          <textarea id="observaciones_retiro" name="observaciones_retiro"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Retiro</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('monto_retiro'));

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('retiroForm'), async () => {
      const monto = App.parseMoneyValue(document.getElementById('monto_retiro').value);
      const fecha = document.getElementById('fecha_retiro').value;
      const observaciones = document.getElementById('observaciones_retiro').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.caja.registrarRetiro({ monto, fecha, observaciones, opId });

        if (response.success) {
          App.closeModal();
          this.loadSaldos();
          this.loadMovimientos();
          App.toast('Retiro registrado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el retiro</div>`;
      }
    });
  },

  showRegularizarSaldosModal(saldoCajaActual, saldoBancoActual) {
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Ajustar Saldos de Caja y Banco</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          Usa esto cuando el saldo real (arqueo físico de caja / extracto bancario) no coincide con el
          saldo que calcula el sistema. La diferencia se registra como un asiento contable fechado y con
          motivo contra la cuenta de Patrimonio — no borra ni reemplaza los movimientos históricos.
        </p>
      </div>

      <div id="formError"></div>

      <form id="regularizarSaldosForm">
        <div class="form-group">
          <label for="fecha_ajuste">Fecha del ajuste <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_ajuste" name="fecha_ajuste" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="saldo_real_caja">Saldo real de Caja <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="saldo_real_caja" name="saldo_real_caja" value="${this.formatNumber(saldoCajaActual)}" required>
          </div>
          <small>Saldo calculado por el sistema: $${this.formatNumber(saldoCajaActual)}</small>
        </div>

        <div class="form-group">
          <label for="saldo_real_banco">Saldo real de Banco <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="saldo_real_banco" name="saldo_real_banco" value="${this.formatNumber(saldoBancoActual)}" required>
          </div>
          <small>Saldo calculado por el sistema: $${this.formatNumber(saldoBancoActual)}</small>
        </div>

        <div id="previewAjusteSaldos" style="margin: 12px 0; font-size: 0.875rem; color: #64748b;"></div>

        <div class="form-group">
          <label for="motivo_ajuste">Motivo <span style="color: #ef4444;">*</span></label>
          <textarea id="motivo_ajuste" name="motivo_ajuste" required placeholder="Ej: Regularización de saldos por registros históricos incompletos anteriores a 2026"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Ajuste</button>
        </div>
      </form>
    `;

    App.openModal(content);

    const inputCaja = document.getElementById('saldo_real_caja');
    const inputBanco = document.getElementById('saldo_real_banco');
    App.attachMoneyInput(inputCaja);
    App.attachMoneyInput(inputBanco);

    const actualizarPreview = () => {
      const diferenciaCaja = App.parseMoneyValue(inputCaja.value) - saldoCajaActual;
      const diferenciaBanco = App.parseMoneyValue(inputBanco.value) - saldoBancoActual;
      const preview = document.getElementById('previewAjusteSaldos');
      const partes = [];
      if (diferenciaCaja !== 0) {
        partes.push(`Caja: ${diferenciaCaja > 0 ? '+' : '-'}$${this.formatNumber(Math.abs(diferenciaCaja))}`);
      }
      if (diferenciaBanco !== 0) {
        partes.push(`Banco: ${diferenciaBanco > 0 ? '+' : '-'}$${this.formatNumber(Math.abs(diferenciaBanco))}`);
      }
      preview.textContent = partes.length > 0 ? `Se registrará un ajuste de: ${partes.join(' | ')}` : 'No hay ninguna diferencia que ajustar.';
    };

    inputCaja.addEventListener('input', actualizarPreview);
    inputBanco.addEventListener('input', actualizarPreview);
    actualizarPreview();

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('regularizarSaldosForm'), async () => {
      const fecha = document.getElementById('fecha_ajuste').value;
      const saldoRealCaja = App.parseMoneyValue(inputCaja.value);
      const saldoRealBanco = App.parseMoneyValue(inputBanco.value);
      const motivo = document.getElementById('motivo_ajuste').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.caja.regularizarSaldos({ fecha, saldoRealCaja, saldoRealBanco, motivo, opId });

        if (response.success) {
          App.closeModal();
          this.loadSaldos();
          this.loadMovimientos();
          App.toast('Ajuste de saldos registrado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el ajuste de saldos</div>`;
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
