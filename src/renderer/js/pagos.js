// Módulo de Pagos
const Pagos = {
  currentPage: 1,
  limit: 10,
  search: '',
  filtroPago: '',

  // Apaga la comparación en pantalla contra el modelo viejo (bloque "Sistema actual" + los 4
  // buckets internos del detalle de cartera) para la entrega -- no se borra el código: es la
  // herramienta que encontró la mayoría de los bugs de la carga inicial (S048, las 26 cuentas
  // que cobraban de más, las 109 de apertura opaca, R007) y va a servir igual en las fases 3 y 4
  // del decommission del modelo viejo, para verificar que la pantalla de registro nueva da lo
  // mismo que la vieja antes de reemplazarla. Prender desde la consola del navegador:
  // `Pagos.MOSTRAR_COMPARACION_MODELO_VIEJO = true` y recargar el detalle de una cuenta.
  MOSTRAR_COMPARACION_MODELO_VIEJO: false,

  async load() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Aportes</h1>
        <p>Registro de aportes de sostenimiento y abonos. Los aportes se hacen por mes calendario completo.</p>
      </div>

      <div class="table-container">
        <div class="table-header">
          <h2>Estado de Cuentas</h2>
          <div class="table-controls">
            <input type="text" id="searchInput" class="search-box" placeholder="Buscar por código, dirección, propietario o identificación...">
            <select id="filtroPagoSelect" class="filter-select">
              <option value="">Todas las cuentas</option>
              <option value="al_dia">Solo al día</option>
              <option value="en_mora">Solo en mora</option>
              <option value="saldo_favor">Solo con saldo a favor</option>
            </select>
          </div>
        </div>

        <div id="tableContent">
          ${App.renderSkeletonTable()}
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadCuentas();
  },

  setupEventListeners() {
    document.getElementById('searchInput').addEventListener('input', App.debounce((e) => {
      this.search = e.target.value;
      this.currentPage = 1;
      this.loadCuentas();
    }));

    document.getElementById('filtroPagoSelect').addEventListener('change', (e) => {
      this.filtroPago = e.target.value;
      this.currentPage = 1;
      this.loadCuentas();
    });
  },

  async loadCuentas() {
    try {
      const [response, indicadoresResponse] = await Promise.all([
        window.api.pagos.getCuentasConEstado({
          page: this.currentPage,
          limit: this.limit,
          search: this.search,
          estado: 'Activo',
          filtroPago: this.filtroPago
        }),
        window.api.cartera.getIndicadoresBulk()
      ]);

      if (response.success) {
        this.renderTable(response.data, indicadoresResponse.success ? indicadoresResponse.data : {});
      } else {
        console.error('Error al cargar cuentas:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderTable(data, indicadoresCartera = {}) {
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
            <th>Conexión</th>
            <th title="Avisos del modelo nuevo de cartera (en validación, ver detalle de la cuenta)">Cartera nueva</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(c => {
            const ind = indicadoresCartera[c.id];
            return `
            <tr>
              <td><strong>${c.codigo}</strong></td>
              <td>${c.direccion}</td>
              <td>${c.propietario_actual || '<em>Sin asignar</em>'}</td>
              <td>${c.pagado_hasta || (c.tiene_abonos ? '<em>Ningún mes cubierto</em>' : '<em>Sin aportes</em>')}</td>
              <td>
                ${c.meses_mora > 0
                  ? `<span class="badge badge-mora">En mora (${c.meses_mora} ${c.meses_mora === 1 ? 'mes' : 'meses'})</span>`
                  : '<span class="badge badge-aldia">Al día</span>'}
              </td>
              <td>${c.saldo_favor > 0 ? `<span class="badge badge-favor">$${this.formatNumber(c.saldo_favor)}</span>` : '-'}</td>
              <td>${c.conexion_pendiente > 0 ? `<span class="badge badge-mora">🔧 $${this.formatNumber(c.conexion_pendiente)}</span>` : '-'}</td>
              <td>${ind ? [
                ind.deudaAntes2024 ? '<span title="Deuda anterior al corte (2024)">⏳</span>' : '',
                ind.puntoConexion ? '<span title="Punto de conexión pendiente">🔧</span>' : '',
                ind.saldoCreditoDisponible ? '<span title="Saldo a favor disponible">💰</span>' : ''
              ].join(' ') : '-'}</td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-primary btn-icon" onclick="Pagos.showDetalleModal(${c.id})">Ver</button>
                  <button class="btn btn-success btn-icon" onclick="Pagos.showRegistrarPagoModal(${c.id})">Registrar Aporte</button>
                </div>
              </td>
            </tr>
          `;
          }).join('')}
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
      const [estadoResponse, historialResponse, conexionesResponse,
        carteraEstadoResponse, carteraDetalleResponse, motivoResponse] = await Promise.all([
        window.api.pagos.getEstadoCuenta(cuentaId),
        window.api.pagos.getHistorialPagos(cuentaId),
        window.api.nuevosPuntos.getByCuentaId(cuentaId),
        window.api.cartera.getEstadoCartera(cuentaId),
        window.api.cartera.getDetalleCartera(cuentaId),
        window.api.cartera.getMotivoDiferencia(cuentaId)
      ]);

      if (!estadoResponse.success) {
        App.toast('Error al cargar el estado de la cuenta: ' + estadoResponse.error, 'error');
        return;
      }

      const estado = estadoResponse.data;
      const historial = historialResponse.success ? historialResponse.data : [];
      const conexiones = conexionesResponse.success ? conexionesResponse.data : [];
      const conexionActiva = conexiones.find(p => p.estado === 'Pendiente') || conexiones[0] || null;
      const carteraEstado = carteraEstadoResponse.success ? carteraEstadoResponse.data : null;
      const carteraDetalle = carteraDetalleResponse.success ? carteraDetalleResponse.data : null;
      const motivoDiferencia = motivoResponse.success ? motivoResponse.data : null;

      const content = `
        <div class="modal-header">
          <h2>Estado de Aportes</h2>
        </div>

        ${this.MOSTRAR_COMPARACION_MODELO_VIEJO ? `
        <div class="detail-section">
          <div class="detail-row">
            <div class="detail-label">Aportado Hasta:</div>
            <div class="detail-value">${estado.pagadoHasta ? `<strong>${estado.pagadoHasta.label}</strong>` : '<em>Sin aportes registrados</em>'}</div>
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
            <div class="detail-value">${estado.saldoPendienteEstimado > 0 ? `<strong style="color: #ef4444;">$${this.formatNumber(estado.saldoPendienteEstimado)}</strong>` : '$0'}</div>
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
        ` : ''}

        <div class="detail-section">
          <h3>Historial de Aportes</h3>
          ${historial.length > 0 ? `
            <table style="width: 100%; margin-top: 12px;">
              <thead>
                <tr><th>Período</th><th>Valor</th><th>Fecha de Aporte</th><th>Recibo</th></tr>
              </thead>
              <tbody>
                ${historial.map(h => `
                  <tr>
                    <td>${h.periodo_desde === h.periodo_hasta ? h.periodo_desde : `${h.periodo_desde} - ${h.periodo_hasta}`}</td>
                    <td>$${this.formatNumber(h.valor)}</td>
                    <td>${this.formatDate(h.fecha_recibo)}</td>
                    <td><a href="#" onclick="App.closeModal(); Recibos.showDetailModal(${h.recibo_id}); return false;">No. ${h.numero_recibo}</a></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="color: #64748b; margin-top: 12px;">Sin aportes registrados</p>'}
        </div>

        <div class="detail-section">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <h3>Conexión (Nuevo Punto)</h3>
            ${!conexionActiva ? `<button class="btn btn-secondary btn-icon" onclick="App.closeModal(); Pagos.showAgregarConexionModal(${cuentaId})">Agregar Cargo de Conexión</button>` : ''}
          </div>
          ${this.renderConexionDetalle(conexionActiva, cuentaId)}
        </div>

        ${this.renderCarteraDetalle(estado, carteraEstado, carteraDetalle, motivoDiferencia)}

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          <button class="btn btn-secondary" onclick="Pagos.imprimirEstadoCuenta(${cuentaId})">Imprimir Estado de Cuenta</button>
          <button class="btn btn-secondary" onclick="Pagos.exportarEstadoCuentaPDF(${cuentaId})">Exportar PDF</button>
          <button class="btn btn-success" onclick="App.closeModal(); Pagos.showRegistrarPagoModal(${cuentaId})">Registrar Aporte</button>
        </div>
      `;

      App.openModal(content, 'large');
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar el estado de aportes', 'error');
    }
  },

  renderConexionDetalle(punto, cuentaId) {
    if (!punto) {
      return '<p style="color: #64748b; margin-top: 12px;">Esta cuenta no tiene un cargo de conexión registrado.</p>';
    }

    const badgeClase = punto.estado === 'Pagado' ? 'badge-activo' : (punto.estado === 'Cancelado' ? 'badge-inactivo' : 'badge-mora');
    const totalAbonado = punto.valor_total - punto.saldo_pendiente;

    return `
      <div class="detail-row">
        <div class="detail-label">Valor Total:</div>
        <div class="detail-value">$${this.formatNumber(punto.valor_total)}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Abonado:</div>
        <div class="detail-value">$${this.formatNumber(totalAbonado)}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Saldo Pendiente:</div>
        <div class="detail-value"><strong>$${this.formatNumber(punto.saldo_pendiente)}</strong></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Estado:</div>
        <div class="detail-value"><span class="badge ${badgeClase}">${punto.estado}</span></div>
      </div>
      ${punto.estado === 'Pendiente' ? `
        <div class="form-actions" style="justify-content: flex-start; margin-top: 12px;">
          <button class="btn btn-success btn-icon" onclick="App.closeModal(); Pagos.showAbonoConexionModal(${punto.id}, ${cuentaId})">Abonar Conexión</button>
          <button class="btn btn-warning btn-icon" onclick="App.closeModal(); Pagos.showCancelarConexionModal(${punto.id}, ${cuentaId})">Cancelar Conexión</button>
        </div>
      ` : ''}
    `;
  },

  // Meses en español abreviados, para el rango "ene - jul 2026" de la cifra principal.
  MESES_ABREV: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],

  formatMes(anio, mes) {
    return `${this.MESES_ABREV[mes - 1]} ${anio}`;
  },

  // Etiqueta del rango de mesesAPagar (ver CarteraService.calcularAPagar): vacío si está al día,
  // un solo mes, o "desde - hasta, N meses" (con año en ambos extremos si cruza de año).
  formatRangoAPagar(meses) {
    if (!meses || meses.length === 0) return '';
    const primero = meses[0];
    const ultimo = meses[meses.length - 1];
    if (meses.length === 1) return `${this.formatMes(primero.anio, primero.mes)}`;
    const desde = primero.anio === ultimo.anio ? this.MESES_ABREV[primero.mes - 1] : this.formatMes(primero.anio, primero.mes);
    return `${desde} - ${this.formatMes(ultimo.anio, ultimo.mes)}, ${meses.length} meses`;
  },

  // Cartera (nuevo modelo) -- SOLO LECTURA. La cifra principal ("a pagar") responde solo
  // "¿cuánto paga hoy por su cuota corriente?"; deuda anterior al corte, punto de conexión y
  // saldo a favor son avisos aparte que NUNCA se suman ni restan de esa cifra (cambio de diseño
  // 2026-08-04, ver CarteraService.getEstadoCartera). Los botones de cada aviso todavía no
  // escriben nada -- se conectan en la siguiente etapa (registrar pagos contra el modelo nuevo).
  renderCarteraDetalle(estadoViejo, carteraEstado, carteraDetalle, motivoDiferencia) {
    if (!carteraEstado) {
      return `
        <div class="detail-section">
          <h3>Cartera (nuevo modelo) — vista de solo lectura</h3>
          <p style="color: #64748b; margin-top: 12px;">No se pudo cargar el detalle del nuevo modelo de cartera.</p>
        </div>
      `;
    }

    const movimientos = carteraDetalle ? carteraDetalle.movimientos : [];
    const puntosConexion = carteraDetalle ? carteraDetalle.puntosConexion : [];

    const TIPO_LABEL = {
      CargoMensual: 'Cargo mensual',
      Abono: 'Abono',
      AjusteCategoria: 'Ajuste de categoría',
      AjusteAsamblea: 'Ajuste de asamblea',
      AjusteCargaInicial: 'Ajuste de carga inicial',
      AperturaOpaca: 'Apertura (antes de 2024)'
    };

    const avisos = [
      { label: 'Deuda anterior al corte (2024)', valor: carteraEstado.deudaAntes2024, accion: 'Abonar' },
      { label: 'Punto de conexión pendiente', valor: carteraEstado.deudaPuntoConexion, accion: 'Abonar' },
      { label: 'Saldo a favor disponible', valor: carteraEstado.saldoCreditoDisponible, accion: 'Usar' }
    ].filter(a => a.valor > 0);

    return `
      <div class="detail-section">
        <h3>Cartera (nuevo modelo) — vista de solo lectura</h3>
        ${this.MOSTRAR_COMPARACION_MODELO_VIEJO ? `
        <p style="color: #64748b; font-size: 0.8125rem; margin: -4px 0 12px 0;">
          El sistema sigue cobrando con el cálculo de arriba ("Sistema actual"). Esto es el
          modelo nuevo de cartera, en paralelo, para validarlo contra datos reales — todavía
          sin botones de registro conectados.
        </p>
        ` : ''}

        ${motivoDiferencia ? `
          <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
            <strong>⚠ Esta cuenta tiene una diferencia documentada frente al Excel de CARTERA:</strong>
            <p style="margin: 6px 0 0 0;">${motivoDiferencia}</p>
          </div>
        ` : ''}

        <div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 16px; margin-bottom: 12px;">
          <div style="font-size: 0.75rem; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">Último mes cubierto</div>
          <div style="font-size: 1rem; margin-bottom: 14px;">
            ${estadoViejo.pagadoHasta ? estadoViejo.pagadoHasta.label : 'Sin meses cubiertos'}
          </div>
          <div style="font-size: 0.75rem; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">
            A pagar${carteraEstado.mesesAPagar.length > 0 ? ` (${carteraEstado.mesesAPagar.length} ${carteraEstado.mesesAPagar.length === 1 ? 'mes pendiente' : 'meses pendientes'})` : ''}
          </div>
          <div style="font-size: 1.5rem; font-weight: bold;">$${this.formatNumber(carteraEstado.aPagar)}</div>
          ${carteraEstado.mesesAPagar.length > 1 ? `
            <ul style="margin: 8px 0 0 0; padding-left: 18px; font-size: 0.8125rem; color: #475569;">
              ${carteraEstado.mesesAPagar.map(m => `
                <li>${this.formatMes(m.anio, m.mes)}${m.causado ? ' (pendiente)' : ''} — $${this.formatNumber(m.valor)}</li>
              `).join('')}
            </ul>
          ` : ''}
        </div>

        ${avisos.length > 0 ? `
          <div style="margin-bottom: 16px;">
            ${avisos.map(a => `
              <div style="display: flex; align-items: center; justify-content: space-between;
                background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px;
                padding: 10px 12px; margin-bottom: 8px;">
                <span>⚠ ${a.label}: <strong>$${this.formatNumber(a.valor)}</strong></span>
                <button class="btn btn-secondary" disabled title="Se conecta en la siguiente etapa">${a.accion}</button>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${this.MOSTRAR_COMPARACION_MODELO_VIEJO ? `
        <details style="margin-bottom: 16px;">
          <summary style="cursor: pointer; color: #64748b; font-size: 0.8125rem;">Ver los 4 buckets internos (comparación con el sistema actual)</summary>
          <table style="width: 100%; margin-top: 8px;">
            <thead>
              <tr><th>Antes de 2024</th><th>Meses desde 2024</th><th>Punto de conexión</th><th>Total (referencia)</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>$${this.formatNumber(carteraEstado.deudaAntes2024)}</td>
                <td>$${this.formatNumber(carteraEstado.deudaMesesDesde2024)}</td>
                <td>$${this.formatNumber(carteraEstado.deudaPuntoConexion)}</td>
                <td><strong>$${this.formatNumber(carteraEstado.deudaTotal)}</strong></td>
              </tr>
            </tbody>
          </table>
        </details>
        ` : ''}

        <h4 style="margin: 16px 0 8px 0;">Detalle de movimientos</h4>
        ${movimientos.length > 0 ? `
          <table style="width: 100%; margin-bottom: 16px;">
            <thead>
              <tr><th>Fecha</th><th>Tipo</th><th>Período</th><th>Monto</th><th>Observación</th></tr>
            </thead>
            <tbody>
              ${movimientos.map(m => `
                <tr>
                  <td>${this.formatDate(m.fecha)}</td>
                  <td>${TIPO_LABEL[m.tipo] || m.tipo}</td>
                  <td>${m.tipo === 'Abono' ? (this.formatRangoAPagar(m.periodos) || '-') : (m.anio ? `${m.anio}-${String(m.mes).padStart(2, '0')}` : '-')}</td>
                  <td style="${m.monto < 0 ? 'color: #059669;' : ''}">$${this.formatNumber(m.monto)}</td>
                  <td style="color: #475569; font-size: 0.8125rem;">${m.observaciones || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p style="color: #64748b; margin-bottom: 16px;">Sin movimientos registrados.</p>'}

        ${puntosConexion.length > 0 ? `
          <h4 style="margin: 16px 0 8px 0;">Punto de conexión — detalle</h4>
          ${puntosConexion.map(p => `
            <table style="width: 100%; margin-bottom: 12px;">
              <thead>
                <tr><th colspan="2">Punto de ${this.formatDate(p.fecha_registro)} — valor $${this.formatNumber(p.valor_total)}, saldo $${this.formatNumber(p.saldo_pendiente)}, estado ${p.estado}</th></tr>
                <tr><th>Fecha abono</th><th>Monto</th></tr>
              </thead>
              <tbody>
                ${p.abonos.length > 0 ? p.abonos.map(a => `
                  <tr><td>${this.formatDate(a.fecha_abono)}</td><td>$${this.formatNumber(a.monto)}</td></tr>
                `).join('') : '<tr><td colspan="2" style="color: #64748b;">Sin abonos registrados</td></tr>'}
              </tbody>
            </table>
          `).join('')}
        ` : ''}
      </div>
    `;
  },

  async showAgregarConexionModal(cuentaId) {
    const configResponse = await window.api.config.getAll();
    const valorDefecto = configResponse.success ? configResponse.data.valor_nuevo_punto : '';
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header"><h2>Agregar Cargo de Conexión</h2></div>
      <div id="formError"></div>
      <form id="conexionForm">
        <div class="form-group">
          <label for="valor_total_conexion">Valor Total <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="valor_total_conexion" name="valor_total_conexion" value="${App.formatMoneyValue(valorDefecto)}" required>
          </div>
        </div>

        <div class="form-group">
          <label for="fecha_registro_conexion">Fecha de Registro <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_registro_conexion" name="fecha_registro_conexion" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_conexion">Observaciones</label>
          <textarea id="observaciones_conexion" name="observaciones_conexion"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('valor_total_conexion'));

    document.getElementById('conexionForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const datos = {
        cuentaId,
        valorTotal: App.parseMoneyValue(document.getElementById('valor_total_conexion').value),
        fechaRegistro: document.getElementById('fecha_registro_conexion').value,
        observaciones: document.getElementById('observaciones_conexion').value.trim()
      };

      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.nuevosPuntos.create(datos);
        if (response.success) {
          App.closeModal();
          App.toast('Cargo de conexión registrado con éxito');
          this.showDetalleModal(cuentaId);
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el cargo de conexión</div>`;
      }
    });
  },

  async showAbonoConexionModal(nuevoPuntoId, cuentaId) {
    const response = await window.api.nuevosPuntos.getById(nuevoPuntoId);
    if (!response.success) {
      App.toast('Error al cargar la conexión: ' + response.error, 'error');
      return;
    }
    const punto = response.data;
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header"><h2>Abonar Conexión</h2></div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Saldo Pendiente de Conexión:</strong> $${this.formatNumber(punto.saldo_pendiente)}
        </p>
      </div>

      <div id="formError"></div>

      <form id="abonoConexionForm">
        <div class="form-group">
          <label for="monto_abono_conexion">Monto del Abono <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="monto_abono_conexion" name="monto_abono_conexion" required>
          </div>
        </div>

        <div class="form-group">
          <label for="fecha_abono_conexion">Fecha <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_abono_conexion" name="fecha_abono_conexion" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="metodo_pago_conexion">Método de Pago <span style="color: #ef4444;">*</span></label>
          <select id="metodo_pago_conexion" name="metodo_pago_conexion" required>
            <option value="Efectivo">Efectivo</option>
            <option value="Transferencia">Transferencia</option>
          </select>
        </div>

        <div class="form-group">
          <label for="observaciones_abono_conexion">Observaciones</label>
          <textarea id="observaciones_abono_conexion" name="observaciones_abono_conexion"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Abono y Generar Recibo</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('monto_abono_conexion'));

    document.getElementById('abonoConexionForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const payload = {
        nuevoPuntoId,
        monto: App.parseMoneyValue(document.getElementById('monto_abono_conexion').value),
        fechaAbono: document.getElementById('fecha_abono_conexion').value,
        metodoPago: document.getElementById('metodo_pago_conexion').value,
        observaciones: document.getElementById('observaciones_abono_conexion').value.trim()
      };

      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.nuevosPuntos.registrarAbono(payload);
        if (response.success) {
          App.closeModal();
          App.toast(`Abono de conexión registrado. Recibo No. ${response.data.numeroRecibo}`);
          this.showDetalleModal(cuentaId);
          this.loadCuentas();
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el abono</div>`;
      }
    });
  },

  showCancelarConexionModal(nuevoPuntoId, cuentaId) {
    const content = `
      <div class="modal-header"><h2>Cancelar Cargo de Conexión</h2></div>

      <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
          <strong>Nota:</strong> El registro no se elimina, queda marcado como cancelado. Los abonos ya recibidos no se reversan.
        </p>
      </div>

      <div id="formError"></div>

      <form id="cancelarConexionForm">
        <div class="form-group">
          <label for="motivo_cancelacion_conexion">Motivo de la Cancelación <span style="color: #ef4444;">*</span></label>
          <textarea id="motivo_cancelacion_conexion" name="motivo_cancelacion_conexion" required></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-warning">Confirmar Cancelación</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('cancelarConexionForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const motivo = document.getElementById('motivo_cancelacion_conexion').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.nuevosPuntos.cancelar(nuevoPuntoId, motivo);
        if (response.success) {
          App.closeModal();
          App.toast('Cargo de conexión cancelado con éxito');
          this.showDetalleModal(cuentaId);
          this.loadCuentas();
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al cancelar el cargo de conexión</div>`;
      }
    });
  },

  async showRegistrarPagoModal(cuentaId) {
    const [estadoResponse, conexionesResponse] = await Promise.all([
      window.api.pagos.getEstadoCuenta(cuentaId),
      window.api.nuevosPuntos.getByCuentaId(cuentaId)
    ]);
    if (!estadoResponse.success) {
      App.toast('Error al cargar el estado de la cuenta: ' + estadoResponse.error, 'error');
      return;
    }
    const estado = estadoResponse.data;
    const conexiones = conexionesResponse.success ? conexionesResponse.data : [];
    const conexionPendiente = conexiones.find(p => p.estado === 'Pendiente') || null;
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Registrar Aporte</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          ${estado.pagadoHasta ? `<strong>Aportado hasta:</strong> ${estado.pagadoHasta.label}.` : '<strong>Sin aportes previos.</strong>'}
          <strong>Próximo período sugerido:</strong> ${estado.siguientePeriodo.label}.
          ${estado.saldoAFavor > 0 ? `<br><strong>Saldo a favor disponible:</strong> $${this.formatNumber(estado.saldoAFavor)}` : ''}
        </p>
      </div>

      <div id="formError"></div>

      <form id="sostenimientoForm">
        <div class="form-group">
          <label>Mes y Año de Inicio <span style="color: #ef4444;">*</span></label>
          <div style="display: flex; gap: 12px;">
            <select id="mes_inicio" name="mes_inicio" style="flex: 1;">
              ${this.opcionesMeses(estado.siguientePeriodo.mes)}
            </select>
            <input type="number" id="anio_inicio" name="anio_inicio" value="${estado.siguientePeriodo.anio}" min="2024" max="2100" style="flex: 1;">
          </div>
        </div>

        <div class="form-group">
          <label for="cantidad_meses">Cantidad de Meses a Aportar <span style="color: #ef4444;">*</span></label>
          <input type="number" id="cantidad_meses" name="cantidad_meses" value="1" min="1" max="120" required>
          <small style="color: #64748b; font-size: 0.875rem;">Puede aportar uno o varios meses, incluso de años distintos, atrasados, actuales o por adelantado.</small>
        </div>

        <div class="form-group">
          <button type="button" class="btn btn-secondary" id="btnSimular">Calcular Total</button>
        </div>

        <div id="simulacionResultado"></div>

        ${conexionPendiente ? `
          <div class="form-group">
            <label for="abono_conexion">Abono a Conexión Pendiente (opcional)</label>
            <div class="input-currency">
              <span class="currency-symbol">$</span>
              <input type="text" inputmode="numeric" id="abono_conexion" name="abono_conexion">
            </div>
            <small style="color: #64748b; font-size: 0.875rem;">
              Saldo pendiente de conexión: $${this.formatNumber(conexionPendiente.saldo_pendiente)}.
              Si la persona también paga esto hoy, se incluye en el mismo recibo.
            </small>
          </div>
        ` : ''}

        <div class="form-group">
          <label for="fecha_pago_sost">Fecha de Aporte <span style="color: #ef4444;">*</span></label>
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
          <button type="submit" class="btn btn-primary">Registrar Aporte y Generar Recibo</button>
        </div>
      </form>
    `;

    App.openModal(content, 'large');
    this.setupRegistrarPagoModal(cuentaId, conexionPendiente);
  },

  setupRegistrarPagoModal(cuentaId, conexionPendiente) {
    if (conexionPendiente) {
      App.attachMoneyInput(document.getElementById('abono_conexion'));
    }

    document.getElementById('btnSimular').addEventListener('click', async () => {
      await this.simularPago(cuentaId);
    });

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('sostenimientoForm'), () => this.registrarPago(cuentaId, conexionPendiente, opId));
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

  async registrarPago(cuentaId, conexionPendiente, opId) {
    const mesInicio = parseInt(document.getElementById('mes_inicio').value, 10);
    const anioInicio = parseInt(document.getElementById('anio_inicio').value, 10);
    const cantidadMeses = parseInt(document.getElementById('cantidad_meses').value, 10);
    const fechaPago = document.getElementById('fecha_pago_sost').value;
    const metodoPago = document.getElementById('metodo_pago_sost').value;
    const observaciones = document.getElementById('observaciones_sost').value.trim();
    const errorDiv = document.getElementById('formError');

    const abonoConexionInput = document.getElementById('abono_conexion');
    const abonoConexion = abonoConexionInput ? App.parseMoneyValue(abonoConexionInput.value) : 0;

    try {
      const response = await window.api.pagos.registrarPagoSostenimiento({
        cuentaId, anioInicio, mesInicio, cantidadMeses, fechaPago, metodoPago, observaciones,
        nuevoPuntoId: abonoConexion > 0 && conexionPendiente ? conexionPendiente.id : null,
        abonoConexion,
        opId
      });

      if (response.success) {
        App.closeModal();
        this.loadCuentas();
        App.toast(`Aporte registrado con éxito. Recibo No. ${response.data.numeroRecibo}`);
      } else {
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al registrar el aporte</div>`;
    }
  },

  async imprimirEstadoCuenta(cuentaId) {
    try {
      const response = await window.api.pagos.imprimirEstadoCuenta(cuentaId);
      if (!response.success && !response.canceled) {
        App.toast('Error al imprimir: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al imprimir el estado de cuenta', 'error');
    }
  },

  async exportarEstadoCuentaPDF(cuentaId) {
    try {
      const response = await window.api.pagos.exportarEstadoCuentaPDF(cuentaId);
      if (response.canceled) return;
      if (response.success) {
        App.toast('PDF guardado en: ' + response.filePath);
      } else {
        App.toast('Error al exportar PDF: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al exportar el estado de cuenta a PDF', 'error');
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
