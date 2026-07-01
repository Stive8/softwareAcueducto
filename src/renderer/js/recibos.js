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

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header">
          <h2>Listado de Recibos</h2>
          <div class="table-controls">
            <input type="text" id="searchInput" class="search-box" placeholder="Buscar por número, código o dirección...">
          </div>
        </div>

        <div id="tableContent">
          ${App.renderSkeletonTable()}
        </div>
      </div>

      <div class="table-container">
        <div class="table-header">
          <h2>Recibos Anulados del Talonario Físico</h2>
          <div class="table-controls">
            <button class="btn btn-warning" id="btnRegistrarAnuladoFisico">+ Registrar Recibo Anulado</button>
          </div>
        </div>
        <div style="padding: 16px 24px; font-size: 13px; color: #64748b; border-bottom: 1px solid #e2e8f0;">
          Para números de recibo del talonario en papel que se anularon antes de representar un cobro real
          (error de escritura, tachón, etc.) y por eso nunca generaron cuenta ni valor en el sistema.
        </div>
        <div id="anuladosFisicosContent">
          ${App.renderSkeletonTable()}
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadRecibos();
    await this.loadAnuladosFisicos();
  },

  setupEventListeners() {
    document.getElementById('searchInput').addEventListener('input', App.debounce((e) => {
      this.search = e.target.value;
      this.currentPage = 1;
      this.loadRecibos();
    }));

    document.getElementById('btnRegistrarAnuladoFisico').addEventListener('click', () => {
      this.showRegistrarAnuladoFisicoModal();
    });
  },

  async loadAnuladosFisicos() {
    try {
      const response = await window.api.recibos.getAnuladosFisicos();
      const container = document.getElementById('anuladosFisicosContent');
      if (!response.success) {
        container.innerHTML = `<p style="padding: 24px; color: #ef4444;">Error: ${response.error}</p>`;
        return;
      }
      if (response.data.length === 0) {
        container.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No hay recibos anulados del talonario físico registrados</p>';
        return;
      }
      container.innerHTML = `
        <table>
          <thead>
            <tr><th>No. Recibo</th><th>Fecha</th><th>Motivo</th></tr>
          </thead>
          <tbody>
            ${response.data.map(a => `
              <tr>
                <td><strong>${a.numero_recibo}</strong></td>
                <td>${a.fecha ? this.formatDate(a.fecha) : '<em>Sin fecha</em>'}</td>
                <td>${a.motivo}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (error) {
      console.error('Error:', error);
    }
  },

  async showRegistrarAnuladoFisicoModal() {
    const consecutivoResponse = await window.api.recibos.getConsecutivo();
    const proximoNumero = consecutivoResponse.success ? consecutivoResponse.data : '';

    const content = `
      <div class="modal-header">
        <h2>Registrar Recibo Anulado del Talonario Físico</h2>
      </div>

      <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
          Use esto solo para números de recibo en papel que se anularon ANTES de representar un cobro real
          (no afecta cuentas, cartera ni caja). Si el recibo sí llegó a cobrarse y luego hay que anularlo,
          use "Anular" en el listado de recibos en vez de esto. El número sigue el mismo conteo consecutivo
          de los recibos reales: se sugiere el próximo número disponible, y si registra uno mayor, el
          contador avanza automáticamente para no repetirlo. Si está digitando historial viejo, puede
          cambiarlo por el número real del talonario.
        </p>
      </div>

      <div id="formError"></div>

      <form id="anuladoFisicoForm">
        <div class="form-group">
          <label for="numero_recibo">Número de Recibo <span style="color: #ef4444;">*</span></label>
          <input type="number" id="numero_recibo" name="numero_recibo" min="1" step="1" value="${proximoNumero}" required>
        </div>

        <div class="form-group">
          <label for="fecha_anulado">Fecha (opcional)</label>
          <input type="date" id="fecha_anulado" name="fecha_anulado">
        </div>

        <div class="form-group">
          <label for="motivo_anulado">Motivo <span style="color: #ef4444;">*</span></label>
          <textarea id="motivo_anulado" name="motivo_anulado" required placeholder="Ej: error de escritura, tachón en el talonario"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-warning">Registrar</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('anuladoFisicoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.recibos.registrarAnuladoFisico({
          numeroRecibo: document.getElementById('numero_recibo').value,
          fecha: document.getElementById('fecha_anulado').value || null,
          motivo: document.getElementById('motivo_anulado').value.trim()
        });

        if (response.success) {
          App.closeModal();
          this.loadAnuladosFisicos();
          App.toast('Recibo anulado registrado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el recibo anulado</div>`;
      }
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
            <th>Estado</th>
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
              <td><span class="badge badge-${r.estado === 'Anulado' ? 'inactivo' : 'activo'}">${r.estado}</span></td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-primary btn-icon" onclick="Recibos.showDetailModal(${r.id})">Ver</button>
                  <button class="btn btn-secondary btn-icon" onclick="Recibos.imprimir(${r.id})">Imprimir</button>
                  <button class="btn btn-success btn-icon" onclick="Recibos.exportarPDF(${r.id})">PDF</button>
                  ${r.estado !== 'Anulado' ? `<button class="btn btn-warning btn-icon" onclick="Recibos.showAnularModal(${r.id})">Anular</button>` : ''}
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
          <div class="detail-row">
            <div class="detail-label">Estado:</div>
            <div class="detail-value"><span class="badge badge-${recibo.estado === 'Anulado' ? 'inactivo' : 'activo'}">${recibo.estado}</span></div>
          </div>
          ${recibo.observaciones ? `
            <div class="detail-row">
              <div class="detail-label">Observaciones:</div>
              <div class="detail-value">${recibo.observaciones}</div>
            </div>
          ` : ''}
          ${recibo.estado === 'Anulado' ? `
            <div class="detail-row">
              <div class="detail-label">Motivo Anulación:</div>
              <div class="detail-value">${recibo.motivo_anulacion} (${this.formatDate(recibo.fecha_anulacion)})</div>
            </div>
          ` : ''}
          ${recibo.motivo_correccion_pago ? `
            <div class="detail-row">
              <div class="detail-label">Corrección Método de Pago:</div>
              <div class="detail-value">${recibo.motivo_correccion_pago} (${this.formatDate(recibo.fecha_correccion_pago)})</div>
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
          ${recibo.estado !== 'Anulado' ? `<button class="btn btn-secondary" onclick="Recibos.showCorregirMetodoPagoModal(${recibo.id}, '${recibo.metodo_pago}')">Corregir Método de Pago</button>` : ''}
          ${recibo.estado !== 'Anulado' ? `<button class="btn btn-warning" onclick="App.closeModal(); Recibos.showAnularModal(${recibo.id})">Anular</button>` : ''}
        </div>
      `;

      App.openModal(content, 'large');
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar el recibo', 'error');
    }
  },

  showAnularModal(id) {
    const content = `
      <div class="modal-header">
        <h2>Anular Recibo</h2>
      </div>

      <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
          <strong>Nota:</strong> El recibo no se elimina, queda marcado como anulado. Los meses, abonos o conexión que cubría
          quedan libres para volver a cobrarse, y se revierte su efecto en caja/banco. El registro permanece visible para auditoría.
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
        const response = await window.api.recibos.anular(id, motivo);

        if (response.success) {
          App.closeModal();
          this.loadRecibos();
          App.toast('Recibo anulado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al anular el recibo</div>`;
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
          <strong>Nota:</strong> Esto NO anula el recibo. El número, fecha, valor y propietario quedan intactos; solo se corrige a qué cuenta (Caja o Banco) quedó asociado el dinero, y se ajustan el movimiento y el asiento contable.
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
        const response = await window.api.recibos.corregirMetodoPago(id, nuevoMetodoPago, motivo);

        if (response.success) {
          App.closeModal();
          this.loadRecibos();
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
