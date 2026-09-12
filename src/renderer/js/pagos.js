// Módulo de Pagos
const Pagos = {
  currentPage: 1,
  limit: 10,
  search: '',
  filtroPago: '',
  estado: 'Activo',

  // Apaga la comparación en pantalla contra el modelo viejo (bloque "Sistema actual" + los 4
  // buckets internos del detalle de cartera) para la entrega -- no se borra el código: es la
  // herramienta que encontró la mayoría de los bugs de la carga inicial (S048, las 26 cuentas
  // que cobraban de más, las 109 de apertura opaca, R007) y va a servir igual en las fases 3 y 4
  // del decommission del modelo viejo, para verificar que la pantalla de registro nueva da lo
  // mismo que la vieja antes de reemplazarla. Prender desde la consola del navegador:
  // `Pagos.MOSTRAR_COMPARACION_MODELO_VIEJO = true` y recargar el detalle de una cuenta.
  MOSTRAR_COMPARACION_MODELO_VIEJO: false,

  async load() {
    // Se reinicia cada vez que se entra al módulo: sin esto, el buscador y "Solo al día/en
    // mora/con saldo a favor" quedaban visualmente en su estado por defecto tras salir y volver
    // a entrar, pero el listado seguía filtrado por lo último elegido. `estado` no se reinicia:
    // ya refleja correctamente su valor actual en el <select> (ver el `selected` de cada opción
    // más abajo), así que no hay nada engañoso en dejarlo tal como estaba.
    this.currentPage = 1;
    this.search = '';
    this.filtroPago = '';

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
            <select id="estadoFilter" class="filter-select">
              <option value="Activo" ${this.estado === 'Activo' ? 'selected' : ''}>Activas</option>
              <option value="" ${this.estado === '' ? 'selected' : ''}>Todos los estados</option>
              <option value="Suspendido" ${this.estado === 'Suspendido' ? 'selected' : ''}>Solo suspendidas</option>
              <option value="Inactivo" ${this.estado === 'Inactivo' ? 'selected' : ''}>Solo inactivas</option>
            </select>
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

    document.getElementById('estadoFilter').addEventListener('change', (e) => {
      this.estado = e.target.value;
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
          estado: this.estado,
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
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No se encontraron cuentas</p>';
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
            <th title="Deuda anterior a 2024, conexión pendiente o saldo a favor disponible -- ver el detalle de la cuenta para más información">Avisos de Cartera</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(c => {
            const ind = indicadoresCartera[c.id];
            return `
            <tr>
              <td>
                <strong>${c.codigo}</strong>
                ${c.estado !== 'Activo' ? `<span class="badge badge-${c.estado.toLowerCase()}">${c.estado}</span>` : ''}
              </td>
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
                ind.deudaAntes2024 ? '<span class="badge badge-warning" title="Deuda anterior al corte (2024)">Deuda 2024</span>' : '',
                ind.puntoConexion ? '<span class="badge badge-warning" title="Punto de conexión pendiente">Conexión</span>' : '',
                ind.saldoCreditoDisponible ? '<span class="badge badge-favor" title="Saldo a favor disponible">Saldo a favor</span>' : ''
              ].filter(Boolean).join(' ') : '-'}</td>
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

      ${App.renderPagination(data.pagination, 'Pagos')}
    `;
  },

  changePage(page) {
    this.currentPage = page;
    this.loadCuentas();
  },

  changeLimit(limit) {
    this.limit = limit;
    this.currentPage = 1;
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

  // true si la lista de {anio, mes} (ya viene ordenada de CarteraService.calcularAPagar) es
  // una secuencia continua, sin huecos.
  sonMesesConsecutivos(meses) {
    for (let i = 1; i < meses.length; i++) {
      const codigoAnterior = meses[i - 1].anio * 12 + meses[i - 1].mes;
      const codigoActual = meses[i].anio * 12 + meses[i].mes;
      if (codigoActual !== codigoAnterior + 1) return false;
    }
    return true;
  },

  // "ene 2024 – ago 2026" (mismo año: "ene – ago 2026"), sin marcar el mes en curso -- para
  // un rango continuo no hace falta distinguirlo, a diferencia de la lista mes a mes.
  formatRangoMesesAPagar(meses) {
    const primero = meses[0];
    const ultimo = meses[meses.length - 1];
    const desde = primero.anio === ultimo.anio ? this.MESES_ABREV[primero.mes - 1] : this.formatMes(primero.anio, primero.mes);
    return `${desde} – ${this.formatMes(ultimo.anio, ultimo.mes)}`;
  },

  // Desglose de "a pagar": la lista mes a mes solo aporta cuando hay huecos en la mora (caso
  // real R007: dic 2024 y ago 2026 sueltos, responde "¿por qué 2 meses?"). Si los meses
  // pendientes son continuos (caso real C021: 32 meses seguidos de $10.000 cada uno) la lista
  // es puro ruido repetido -- el rango dice lo mismo en una línea.
  renderDesgloseAPagar(meses) {
    if (!meses || meses.length <= 1) return '';
    if (this.sonMesesConsecutivos(meses)) {
      return `<div style="margin-top: 6px; font-size: 0.875rem; color: #475569;">${this.formatRangoMesesAPagar(meses)}</div>`;
    }
    return `
      <ul style="margin: 8px 0 0 0; padding-left: 18px; font-size: 0.8125rem; color: #475569;">
        ${meses.map(m => `
          <li>${this.formatMes(m.anio, m.mes)}${m.causado ? ' (pendiente)' : ''} — $${this.formatNumber(m.valor)}</li>
        `).join('')}
      </ul>
    `;
  },

  // Cartera (nuevo modelo) -- SOLO LECTURA salvo "Usar" (redimirCredito, conectado 2026-08-10)
  // y "Abonar" deuda anterior al corte (registrarAbonoDeudaAnterior, conectado 2026-08-29).
  // La cifra principal ("a pagar") responde solo "¿cuánto paga hoy por su cuota corriente?";
  // deuda anterior al corte y saldo a favor son avisos aparte que NUNCA se suman ni restan de
  // esa cifra (cambio de diseño 2026-08-04, ver CarteraService.getEstadoCartera).
  //
  // "Abonar" deuda anterior al corte SÍ es plata nueva entrando (a diferencia de redimirCredito,
  // que reasigna plata que la cuenta ya tiene guardada) -- por eso tiene su propio modal con
  // método de pago y genera su propio recibo (ver showAbonarDeudaAnteriorModal más abajo y
  // PagoService.registrarAbonoDeudaAnterior), en vez de reutilizar showRegistrarPagoModal.
  //
  // "Abonar" punto de conexión NO se muestra acá: ya existe un botón que hace exactamente eso
  // ("Abonar Conexión", ver renderConexionDetalle más arriba en esta misma pantalla) -- repetirlo
  // acá era un botón muerto duplicando uno que sí funciona.
  // El título de esta sección era "Cartera (nuevo modelo) -- vista de solo lectura": lenguaje
  // interno de cuando esto era un panel de validación en paralelo al cálculo viejo. Hoy es la
  // única forma de ver el saldo pendiente, el saldo a favor y el detalle de movimientos de la
  // cuenta -- no un panel aparte -- así que se renombró a algo que un operador entienda sin
  // contexto del proyecto. El texto de comparación con el modelo viejo (MOSTRAR_COMPARACION_MODELO_VIEJO)
  // sigue funcionando igual, solo el título cambió.
  renderCarteraDetalle(estadoViejo, carteraEstado, carteraDetalle, motivoDiferencia) {
    if (!carteraEstado) {
      return `
        <div class="detail-section">
          <h3>Cartera y Movimientos</h3>
          <p style="color: #64748b; margin-top: 12px;">No se pudo cargar el detalle de la cartera.</p>
        </div>
      `;
    }

    const cuentaId = estadoViejo.cuentaId;
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

    const deudaAntes2024 = carteraEstado.deudaAntes2024 > 0 ? carteraEstado.deudaAntes2024 : 0;
    const saldoAFavorUsable = carteraEstado.saldoCreditoDisponible > 0 ? carteraEstado.saldoCreditoDisponible : 0;

    return `
      <div class="detail-section">
        <h3>Cartera y Movimientos</h3>
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
            ${estadoViejo.pagadoHasta && estadoViejo.pagadoHasta.huecoAnterior
              ? `<div style="font-size: 0.75rem; color: #b45309; font-weight: normal; margin-top: 2px;">⚠ con ${estadoViejo.pagadoHasta.huecoAnterior.meses} ${estadoViejo.pagadoHasta.huecoAnterior.meses === 1 ? 'mes anterior pendiente' : 'meses anteriores pendientes'}</div>`
              : ''}
          </div>
          <div style="font-size: 0.75rem; text-transform: uppercase; color: #64748b; margin-bottom: 4px;">
            A pagar${carteraEstado.mesesAPagar.length > 0 ? ` (${carteraEstado.mesesAPagar.length} ${carteraEstado.mesesAPagar.length === 1 ? 'mes pendiente' : 'meses pendientes'})` : ''}
          </div>
          <div style="font-size: 1.5rem; font-weight: bold;">$${this.formatNumber(carteraEstado.aPagar)}</div>
          ${this.renderDesgloseAPagar(carteraEstado.mesesAPagar)}
        </div>

        ${deudaAntes2024 > 0 || saldoAFavorUsable > 0 ? `
          <div style="margin-bottom: 16px;">
            ${deudaAntes2024 > 0 ? `
              <div style="display: flex; align-items: center; justify-content: space-between;
                background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px;
                padding: 10px 12px; margin-bottom: 8px;">
                <span>⚠ Deuda anterior al corte (2024): <strong>$${this.formatNumber(deudaAntes2024)}</strong></span>
                <button class="btn btn-warning btn-icon" onclick="App.closeModal(); Pagos.showAbonarDeudaAnteriorModal(${cuentaId}, ${deudaAntes2024})">Abonar</button>
              </div>
            ` : ''}
            ${saldoAFavorUsable > 0 ? `
              <div style="display: flex; align-items: center; justify-content: space-between;
                background: #dbeafe; border: 1px solid #93c5fd; border-radius: 6px;
                padding: 10px 12px; margin-bottom: 8px;">
                <span style="color: #1e40af;">💰 Saldo a favor disponible: <strong>$${this.formatNumber(saldoAFavorUsable)}</strong></span>
                <button class="btn btn-success btn-icon" onclick="App.closeModal(); Pagos.showRegistrarPagoModal(${cuentaId}, { prefillUsarSaldoFavor: true })">Usar</button>
              </div>
            ` : ''}
          </div>
        ` : ''}

        ${deudaAntes2024 === 0 ? `
          <p style="margin: 0 0 16px 0;">
            <a href="#" onclick="App.closeModal(); Pagos.showAgregarDeudaAperturaModal(${cuentaId}); return false;"
              style="font-size: 0.8125rem; color: #64748b;">+ Agregar deuda anterior al corte (2024)</a>
          </p>
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

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('conexionForm'), async () => {
      const datos = {
        cuentaId,
        valorTotal: App.parseMoneyValue(document.getElementById('valor_total_conexion').value),
        fechaRegistro: document.getElementById('fecha_registro_conexion').value,
        observaciones: document.getElementById('observaciones_conexion').value.trim(),
        opId
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

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('abonoConexionForm'), async () => {
      const payload = {
        nuevoPuntoId,
        monto: App.parseMoneyValue(document.getElementById('monto_abono_conexion').value),
        fechaAbono: document.getElementById('fecha_abono_conexion').value,
        metodoPago: document.getElementById('metodo_pago_conexion').value,
        observaciones: document.getElementById('observaciones_abono_conexion').value.trim(),
        opId
      };

      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.nuevosPuntos.registrarAbono(payload);
        if (response.success) {
          App.closeModal();
          this.loadCuentas();
          this.mostrarConfirmacionRecibo(response.data.reciboId, response.data.numeroRecibo, 'Abono de conexión registrado',
            () => this.showDetalleModal(cuentaId));
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el abono</div>`;
      }
    });
  },

  // Modal de "Abonar" la deuda anterior al corte (2024) -- ver renderCarteraDetalle. A diferencia
  // de "Usar saldo a favor" (showRegistrarPagoModal con prefillUsarSaldoFavor), acá entra plata
  // NUEVA, así que pide método de pago y genera su propio recibo, igual que Abonar Conexión
  // arriba (mismo patrón). deudaDisponible llega ya calculada desde el botón para no repetir la
  // llamada a getEstadoCartera solo para mostrar el tope en pantalla.
  async showAbonarDeudaAnteriorModal(cuentaId, deudaDisponible) {
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header"><h2>Abonar Deuda Anterior al Corte (2024)</h2></div>

      <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
          <strong>Deuda Anterior al Corte Pendiente:</strong> $${this.formatNumber(deudaDisponible)}
        </p>
      </div>

      <div id="formError"></div>

      <form id="abonoDeudaAnteriorForm">
        <div class="form-group">
          <label for="monto_abono_deuda_anterior">Monto del Abono <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="monto_abono_deuda_anterior" name="monto_abono_deuda_anterior" required>
          </div>
        </div>

        <div class="form-group">
          <label for="fecha_abono_deuda_anterior">Fecha <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_abono_deuda_anterior" name="fecha_abono_deuda_anterior" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="metodo_pago_deuda_anterior">Método de Pago <span style="color: #ef4444;">*</span></label>
          <select id="metodo_pago_deuda_anterior" name="metodo_pago_deuda_anterior" required>
            <option value="Efectivo">Efectivo</option>
            <option value="Transferencia">Transferencia</option>
          </select>
        </div>

        <div class="form-group">
          <label for="observaciones_abono_deuda_anterior">Observaciones</label>
          <textarea id="observaciones_abono_deuda_anterior" name="observaciones_abono_deuda_anterior"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Abono y Generar Recibo</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('monto_abono_deuda_anterior'));

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('abonoDeudaAnteriorForm'), async () => {
      const payload = {
        cuentaId,
        monto: App.parseMoneyValue(document.getElementById('monto_abono_deuda_anterior').value),
        fecha: document.getElementById('fecha_abono_deuda_anterior').value,
        metodoPago: document.getElementById('metodo_pago_deuda_anterior').value,
        observaciones: document.getElementById('observaciones_abono_deuda_anterior').value.trim(),
        opId
      };

      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.pagos.registrarAbonoDeudaAnterior(payload);
        if (response.success) {
          App.closeModal();
          this.loadCuentas();
          this.mostrarConfirmacionRecibo(response.data.reciboId, response.data.numeroRecibo, 'Abono a deuda anterior registrado',
            () => this.showDetalleModal(cuentaId));
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar el abono</div>`;
      }
    });
  },

  // Modal de "Agregar deuda anterior al corte" (ver renderCarteraDetalle) -- para una cuenta
  // preexistente que se da de alta en el sistema DESPUÉS de la migración inicial de cartera
  // (la única vez que esto se cargó hasta ahora) y que en realidad debía dinero de antes de
  // 2024. A diferencia de "Abonar" (arriba), acá no entra plata: es declarar el saldo, así que
  // no pide método de pago ni genera recibo -- mismo criterio que "Agregar Cargo de Conexión".
  // Solo Administrador (ver CANALES_SOLO_ADMIN): declara una cifra sin respaldo de cargos mes a
  // mes, y solo puede hacerse una vez por cuenta (cartera:agregarDeudaApertura la rechaza si ya
  // existe una).
  async showAgregarDeudaAperturaModal(cuentaId) {
    const content = `
      <div class="modal-header"><h2>Agregar Deuda Anterior al Corte (2024)</h2></div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e3a8a;">
          Úsalo solo para una cuenta preexistente que ya debía dinero de antes de 2024 y nunca se le registró esa deuda
          (por ejemplo, una cuenta que se está dando de alta ahora pero paga desde años atrás). Los meses desde 2024 en
          adelante se cobran como un aporte normal -- esto es solo para el saldo consolidado anterior.
        </p>
      </div>

      <div id="formError"></div>

      <form id="deudaAperturaForm">
        <div class="form-group">
          <label for="monto_deuda_apertura">Monto total adeudado antes de 2024 <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="monto_deuda_apertura" name="monto_deuda_apertura" required>
          </div>
        </div>

        <div class="form-group">
          <label for="observaciones_deuda_apertura">Observaciones</label>
          <textarea id="observaciones_deuda_apertura" name="observaciones_deuda_apertura" placeholder="Ej: cuenta preexistente, deuda 2022-2023"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Registrar Deuda Anterior</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('monto_deuda_apertura'));

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('deudaAperturaForm'), async () => {
      const payload = {
        cuentaId,
        monto: App.parseMoneyValue(document.getElementById('monto_deuda_apertura').value),
        observaciones: document.getElementById('observaciones_deuda_apertura').value.trim() || null,
        opId
      };

      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.cartera.agregarDeudaApertura(payload);
        if (response.success) {
          App.closeModal();
          this.loadCuentas();
          App.toast('Deuda anterior al corte registrada con éxito');
          this.showDetalleModal(cuentaId);
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al registrar la deuda anterior</div>`;
      }
    });
  },

  // El botón "Usar saldo a favor" (ver renderCarteraDetalle) abre showRegistrarPagoModal con la
  // casilla "usar saldo a favor" premarcada, en vez de un modal aparte de redención FIFO ciega:
  // ese modal ya declara un período explícito (anioInicio/mesInicio/cantidadMeses) y ya usa
  // asegurarCausacion + aplicarCreditoAMeses -- el mismo mecanismo que un aporte nuevo, sin tope
  // de meses futuros y sin dejar sobrante suelto (ver PagoService.registrarPagoSostenimiento).
  // Un solo camino para todo aporte, nuevo o desde crédito guardado. CarteraService.
  // redimirCredito (FIFO ciego contra deuda vieja/actual) sigue existiendo -- lo usan los
  // scripts de corrección de la carga histórica -- solo se retiró el botón de esta pantalla.

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

  // prefillUsarSaldoFavor (default false): llega en true desde el botón "Usar" del aviso de
  // saldo a favor (ver renderCarteraDetalle) -- premarca la casilla y calcula el total de una
  // vez, para que quien cobra no tenga que repetir el gesto de "aplicar crédito" que ya vino a
  // hacer. El período de inicio sigue siendo estado.siguientePeriodo (el más antiguo pendiente),
  // igual que cualquier aporte nuevo -- quien cobra ajusta la cantidad de meses según lo que
  // declare la colilla física.
  async showRegistrarPagoModal(cuentaId, { prefillUsarSaldoFavor = false } = {}) {
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
          ${estado.pagadoHasta
            ? `<strong>Aportado hasta:</strong> ${estado.pagadoHasta.label}${estado.pagadoHasta.huecoAnterior ? ` (con ${estado.pagadoHasta.huecoAnterior.meses} ${estado.pagadoHasta.huecoAnterior.meses === 1 ? 'mes anterior pendiente' : 'meses anteriores pendientes'})` : ''}.`
            : '<strong>Sin aportes previos.</strong>'}
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

        ${estado.saldoAFavor > 0 ? `
          <div class="form-group">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: normal;">
              <input type="checkbox" id="usar_saldo_favor" ${prefillUsarSaldoFavor ? 'checked' : ''}>
              Aplicar saldo a favor disponible ($${this.formatNumber(estado.saldoAFavor)})
            </label>
          </div>
        ` : ''}

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

        ${estado.deudaAntes2024 > 0 ? `
          <div class="form-group">
            <label for="abono_deuda_anterior">Abono a Deuda Anterior al Corte (opcional)</label>
            <div class="input-currency">
              <span class="currency-symbol">$</span>
              <input type="text" inputmode="numeric" id="abono_deuda_anterior" name="abono_deuda_anterior">
            </div>
            <small style="color: #64748b; font-size: 0.875rem;">
              Deuda anterior al corte pendiente: $${this.formatNumber(estado.deudaAntes2024)}.
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
    // Cálculo inicial automático: sin esto, el total quedaba en blanco hasta que alguien
    // apretara "Calcular Total" a mano.
    this.simularPago(cuentaId);
  },

  setupRegistrarPagoModal(cuentaId, conexionPendiente) {
    if (conexionPendiente) {
      App.attachMoneyInput(document.getElementById('abono_conexion'));
    }

    const abonoDeudaAnteriorInput = document.getElementById('abono_deuda_anterior');
    if (abonoDeudaAnteriorInput) {
      App.attachMoneyInput(abonoDeudaAnteriorInput);
    }

    document.getElementById('btnSimular').addEventListener('click', async () => {
      await this.simularPago(cuentaId);
    });

    // Recalcula en el acto ante cualquier cambio que afecte el total -- antes solo el checkbox
    // de saldo a favor lo hacía, y cambiar el mes/año/cantidad de meses dejaba el total mostrado
    // desactualizado hasta que alguien recordara apretar "Calcular Total" de nuevo.
    const recalcular = App.debounce(() => this.simularPago(cuentaId), 400);
    ['mes_inicio', 'anio_inicio', 'cantidad_meses'].forEach(id => {
      document.getElementById(id).addEventListener('input', recalcular);
      document.getElementById(id).addEventListener('change', recalcular);
    });

    const usarSaldoFavorInput = document.getElementById('usar_saldo_favor');
    if (usarSaldoFavorInput) {
      usarSaldoFavorInput.addEventListener('change', () => this.simularPago(cuentaId));
    }

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('sostenimientoForm'), () => this.registrarPago(cuentaId, conexionPendiente, opId));
  },

  async simularPago(cuentaId) {
    const mesInicio = parseInt(document.getElementById('mes_inicio').value, 10);
    const anioInicio = parseInt(document.getElementById('anio_inicio').value, 10);
    const cantidadMeses = parseInt(document.getElementById('cantidad_meses').value, 10);
    const usarSaldoFavorInput = document.getElementById('usar_saldo_favor');
    const usarSaldoAFavor = usarSaldoFavorInput ? usarSaldoFavorInput.checked : false;
    const resultadoDiv = document.getElementById('simulacionResultado');
    const errorDiv = document.getElementById('formError');

    errorDiv.innerHTML = '';

    try {
      const response = await window.api.pagos.simularPago(cuentaId, anioInicio, mesInicio, cantidadMeses, usarSaldoAFavor);

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
          ${sim.totalACobrar === 0 && sim.creditoAplicado > 0 ? `
            <p style="margin: 8px 0 0 0; font-size: 0.8125rem; color: #059669;">
              Cubierto por completo con el saldo a favor -- no se recibe dinero en este pago.
            </p>
          ` : ''}
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
    const abonoDeudaAnteriorInput = document.getElementById('abono_deuda_anterior');
    const abonoDeudaAnterior = abonoDeudaAnteriorInput ? App.parseMoneyValue(abonoDeudaAnteriorInput.value) : 0;
    const usarSaldoFavorInput = document.getElementById('usar_saldo_favor');
    const usarSaldoAFavor = usarSaldoFavorInput ? usarSaldoFavorInput.checked : false;

    try {
      const response = await window.api.pagos.registrarPagoSostenimiento({
        cuentaId, anioInicio, mesInicio, cantidadMeses, fechaPago, metodoPago, observaciones,
        usarSaldoAFavor,
        nuevoPuntoId: abonoConexion > 0 && conexionPendiente ? conexionPendiente.id : null,
        abonoConexion,
        abonoDeudaAnterior,
        opId
      });

      if (response.success) {
        App.closeModal();
        this.loadCuentas();
        this.mostrarConfirmacionRecibo(response.data.reciboId, response.data.numeroRecibo, 'Aporte registrado con éxito');
      } else {
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al registrar el aporte</div>`;
    }
  },

  // Modal de confirmación tras registrar un aporte o un abono de conexión -- son los dos únicos
  // flujos de esta pantalla que generan un recibo. Reemplaza al toast de solo texto: antes, para
  // imprimir o descargar el PDF había que cerrar, ir al módulo Recibos y buscar el número a mano.
  // alCerrar (opcional): se ejecuta al cerrar el modal, sea con el botón, Escape o clic afuera
  // (vía App.alCerrarModalSinResolver, el mismo mecanismo que usa confirmDialog) -- lo usa el
  // abono de conexión para volver al detalle de la cuenta, igual que hacía antes de este cambio.
  mostrarConfirmacionRecibo(reciboId, numeroRecibo, mensaje, alCerrar = null) {
    const content = `
      <div class="modal-header"><h2>✓ ${mensaje}</h2></div>
      <p style="margin-bottom: 24px; color: #334155; font-size: 14px;">
        Recibo No. <strong>${numeroRecibo}</strong>
      </p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
        ${Recibos.renderSelectorFormato(`confirmacion_${reciboId}`)}
        <button type="button" class="btn btn-secondary btn-icon" onclick="Recibos.imprimir(${reciboId}, Recibos.leerFormatoSeleccionado('confirmacion_${reciboId}'))">Imprimir Recibo</button>
        <button type="button" class="btn btn-success btn-icon" onclick="Recibos.exportarPDF(${reciboId}, Recibos.leerFormatoSeleccionado('confirmacion_${reciboId}'))">Descargar PDF</button>
      </div>
    `;

    App.openModal(content);
    if (alCerrar) App.alCerrarModalSinResolver = alCerrar;
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
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateString) ? dateString + 'T00:00:00' : dateString);
    return date.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
  }
};
