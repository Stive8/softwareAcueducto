// Módulo de Contabilidad: Plan de Cuentas (PUC), Mapeo de Conceptos y los reportes contables
// (pagos/gastos, estados financieros, informe de empalme). Preparación para una futura
// contabilidad de doble partida: aquí solo se administra el catálogo y se generan reportes,
// sin generar asientos todavía.
const Contabilidad = {
  tabActual: 'plancuentas',

  gruposReportes: [
    {
      titulo: 'Pagos y Gastos',
      reportes: [
        { tipo: 'historial_pagos', titulo: 'Historial de Pagos', icon: '💰', rangoFecha: true, filtroCuentaContable: true },
        { tipo: 'historial_gastos', titulo: 'Historial de Gastos', icon: '💸', rangoFecha: true, filtroCuentaContable: true },
        { tipo: 'ingresos_periodo', titulo: 'Ingresos por Período', icon: '📈', rangoFecha: true, filtroCuentaContable: true },
        { tipo: 'gastos_periodo', titulo: 'Gastos por Período', icon: '📉', rangoFecha: true, filtroCuentaContable: true }
      ]
    },
    {
      titulo: 'Estados Financieros',
      reportes: [
        { tipo: 'balance_general', titulo: 'Balance General', icon: '📊' },
        { tipo: 'estado_resultados', titulo: 'Estado de Resultados', icon: '📋', rangoFecha: true },
        { tipo: 'flujo_caja', titulo: 'Flujo de Caja', icon: '💧', rangoFecha: true }
      ]
    },
    {
      titulo: 'Doble Partida',
      reportes: [
        { tipo: 'libro_diario', titulo: 'Libro Diario', icon: '📖', rangoFecha: true },
        { tipo: 'libro_mayor', titulo: 'Libro Mayor', icon: '📚', rangoFecha: true, requiereCuentaContable: true },
        { tipo: 'balance_prueba', titulo: 'Balance de Prueba', icon: '⚖️', rangoFecha: true }
      ]
    },
    {
      titulo: 'Informe de Gestión',
      reportes: [
        { tipo: 'informe_empalme', titulo: 'Informe de Empalme', icon: '🤝', rangoFecha: true }
      ]
    }
  ],

  async load() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Contabilidad</h1>
        <p>Plan de cuentas, clasificación de movimientos y reportes contables</p>
      </div>

      <div class="table-container">
        <div class="table-header">
          <div class="table-controls" style="gap: 8px;">
            <button class="btn btn-secondary" id="tabPlanCuentasBtn">Plan de Cuentas</button>
            <button class="btn btn-secondary" id="tabMapeoBtn">Mapeo de Conceptos</button>
            <button class="btn btn-secondary" id="tabAsientosBtn">Asientos Contables</button>
            <button class="btn btn-secondary" id="tabReportesContablesBtn">Reportes Contables</button>
          </div>
        </div>
        <div id="contabilidadBody"></div>
      </div>
    `;

    document.getElementById('tabPlanCuentasBtn').addEventListener('click', () => this.mostrarTab('plancuentas'));
    document.getElementById('tabMapeoBtn').addEventListener('click', () => this.mostrarTab('mapeo'));
    document.getElementById('tabAsientosBtn').addEventListener('click', () => this.mostrarTab('asientos'));
    document.getElementById('tabReportesContablesBtn').addEventListener('click', () => this.mostrarTab('reportes'));

    await this.mostrarTab('plancuentas');
  },

  async mostrarTab(tab) {
    this.tabActual = tab;
    document.getElementById('tabPlanCuentasBtn').className = tab === 'plancuentas' ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('tabMapeoBtn').className = tab === 'mapeo' ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('tabAsientosBtn').className = tab === 'asientos' ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('tabReportesContablesBtn').className = tab === 'reportes' ? 'btn btn-primary' : 'btn btn-secondary';

    if (tab === 'plancuentas') {
      await this.loadCatalogo();
    } else if (tab === 'mapeo') {
      await this.loadMapeo();
    } else if (tab === 'asientos') {
      await this.loadAsientos();
    } else {
      await this.loadReportesContables();
    }
  },

  // --- Catálogo de Cuentas (Plan de Cuentas) ---

  async loadCatalogo() {
    const body = document.getElementById('contabilidadBody');
    body.innerHTML = `
      <div style="padding: 16px 20px; display: flex; justify-content: flex-end;">
        <button class="btn btn-primary" id="btnNuevaCuenta">+ Nueva Cuenta</button>
      </div>
      <div id="catalogoTableContent"><p style="padding: 24px; text-align: center;">Cargando...</p></div>
    `;

    document.getElementById('btnNuevaCuenta').addEventListener('click', () => this.showFormModal());

    try {
      const response = await window.api.planCuentas.getAll({});
      if (response.success) {
        this.renderCatalogo(response.data);
      } else {
        App.toast('Error al cargar el plan de cuentas: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderCatalogo(cuentas) {
    const tableContent = document.getElementById('catalogoTableContent');
    this.cuentasCache = cuentas;

    if (cuentas.length === 0) {
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No hay cuentas registradas</p>';
      return;
    }

    const niveles = ['', 'Clase', 'Grupo', 'Cuenta', 'Subcuenta', 'Auxiliar'];

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Nombre</th>
            <th>Nivel</th>
            <th>Tipo</th>
            <th>Naturaleza</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${cuentas.map(c => `
            <tr>
              <td><code>${c.codigo}</code></td>
              <td>${'&nbsp;&nbsp;&nbsp;&nbsp;'.repeat(c.nivel - 1)}${c.nivel >= 3 ? '' : '<strong>'}${c.nombre}${c.nivel >= 3 ? '' : '</strong>'}</td>
              <td>${niveles[c.nivel]}</td>
              <td>${c.tipo}</td>
              <td>${c.naturaleza === 'Debito' ? 'Débito' : 'Crédito'}</td>
              <td><span class="badge badge-${c.activo ? 'activo' : 'inactivo'}">${c.activo ? 'Activa' : 'Inactiva'}</span></td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-secondary btn-icon" onclick="Contabilidad.showFormModal(${c.id})">Editar</button>
                  <button class="btn btn-${c.activo ? 'warning' : 'info'} btn-icon" onclick="Contabilidad.toggleActivo(${c.id})">${c.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  async showFormModal(id = null) {
    let cuenta = null;
    if (id) {
      const response = await window.api.planCuentas.getById(id);
      if (!response.success) {
        App.toast('Error al cargar la cuenta: ' + response.error, 'error');
        return;
      }
      cuenta = response.data;
    }

    const padres = (this.cuentasCache || []).filter(c => c.nivel < 5 && c.id !== id);

    const content = `
      <div class="modal-header"><h2>${id ? 'Editar Cuenta Contable' : 'Nueva Cuenta Contable'}</h2></div>
      <div id="formError"></div>
      <form id="cuentaContableForm">
        <div class="form-group">
          <label for="codigo">Código <span style="color: #ef4444;">*</span></label>
          <input type="text" id="codigo" name="codigo" value="${cuenta?.codigo || ''}" required>
        </div>
        <div class="form-group">
          <label for="nombre">Nombre <span style="color: #ef4444;">*</span></label>
          <input type="text" id="nombre" name="nombre" value="${cuenta?.nombre || ''}" required>
        </div>
        <div class="form-group">
          <label for="tipo">Tipo <span style="color: #ef4444;">*</span></label>
          <select id="tipo" name="tipo" required>
            ${['Activo', 'Pasivo', 'Patrimonio', 'Ingreso', 'Gasto', 'Costo'].map(t =>
              `<option value="${t}" ${cuenta?.tipo === t ? 'selected' : ''}>${t}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="naturaleza">Naturaleza <span style="color: #ef4444;">*</span></label>
          <select id="naturaleza" name="naturaleza" required>
            <option value="Debito" ${cuenta?.naturaleza === 'Debito' ? 'selected' : ''}>Débito</option>
            <option value="Credito" ${cuenta?.naturaleza === 'Credito' ? 'selected' : ''}>Crédito</option>
          </select>
        </div>
        ${!id ? `
          <div class="form-group">
            <label for="padreId">Cuenta Padre</label>
            <select id="padreId" name="padreId">
              <option value="">Ninguna (nueva Clase de nivel 1)</option>
              ${padres.map(p => `<option value="${p.id}">${p.codigo} - ${p.nombre} (${p.tipo})</option>`).join('')}
            </select>
            <small style="color: #64748b; font-size: 0.875rem;">El nivel se calcula automáticamente según la cuenta padre. El tipo debe coincidir con el de la cuenta padre.</small>
          </div>
        ` : `
          <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">La jerarquía (cuenta padre / nivel) no se puede modificar después de creada la cuenta.</p>
          </div>
        `}
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${id ? 'Actualizar' : 'Crear'}</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('cuentaContableForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveCuenta(id);
    });
  },

  async saveCuenta(id) {
    const formData = {
      codigo: document.getElementById('codigo').value.trim(),
      nombre: document.getElementById('nombre').value.trim(),
      tipo: document.getElementById('tipo').value,
      naturaleza: document.getElementById('naturaleza').value
    };

    if (!id) {
      const padreId = document.getElementById('padreId').value;
      formData.padreId = padreId ? parseInt(padreId, 10) : null;
    }

    try {
      const response = id
        ? await window.api.planCuentas.update(id, formData)
        : await window.api.planCuentas.create(formData);

      if (response.success) {
        App.closeModal();
        this.loadCatalogo();
        App.toast(id ? 'Cuenta contable actualizada con éxito' : 'Cuenta contable creada con éxito');
      } else {
        document.getElementById('formError').innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      document.getElementById('formError').innerHTML = '<div class="error-message">Error al guardar la cuenta contable</div>';
    }
  },

  async toggleActivo(id) {
    const confirmado = await App.confirmDialog('¿Está seguro de cambiar el estado de esta cuenta contable?');
    if (!confirmado) return;

    try {
      const response = await window.api.planCuentas.toggleActivo(id);
      if (response.success) {
        this.loadCatalogo();
        App.toast('Estado actualizado con éxito');
      } else {
        App.toast('Error al cambiar el estado: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cambiar el estado', 'error');
    }
  },

  // --- Mapeo de Conceptos Contables ---

  async loadMapeo() {
    const body = document.getElementById('contabilidadBody');
    body.innerHTML = `
      <div style="padding: 16px 20px;">
        <p style="color: #64748b; font-size: 0.875rem; margin: 0;">
          Define a qué cuenta contable corresponde cada tipo de gasto, concepto de recibo y origen de movimiento de caja/banco.
          Esto es lo que más adelante permitirá generar asientos contables automáticos.
        </p>
      </div>
      <div id="mapeoTableContent"><p style="padding: 24px; text-align: center;">Cargando...</p></div>
    `;

    try {
      const [mapeoResponse, imputablesResponse] = await Promise.all([
        window.api.mapeoContable.getAll(),
        window.api.planCuentas.getImputables({})
      ]);

      if (!mapeoResponse.success) {
        App.toast('Error al cargar el mapeo contable: ' + mapeoResponse.error, 'error');
        return;
      }

      this.imputablesCache = imputablesResponse.success ? imputablesResponse.data : [];
      this.renderMapeo(mapeoResponse.data);
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderMapeo(mapeos) {
    const tableContent = document.getElementById('mapeoTableContent');

    const nombresModulo = { Gasto: 'Gastos', RecibosDetalle: 'Recibos (ingresos)', Movimiento: 'Movimientos de Caja/Banco' };

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Módulo</th>
            <th>Concepto</th>
            <th>Cuenta Contable Asignada</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${mapeos.map(m => `
            <tr>
              <td>${nombresModulo[m.modulo] || m.modulo}</td>
              <td>${m.concepto === '__default__' ? '<em>Por defecto (cualquier otro)</em>' : m.concepto}</td>
              <td><code>${m.cuenta_codigo}</code> - ${m.cuenta_nombre}</td>
              <td>
                <button class="btn btn-secondary btn-icon" onclick="Contabilidad.showCambiarMapeoModal('${m.modulo}', '${m.concepto}')">Cambiar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  showCambiarMapeoModal(modulo, concepto) {
    const imputables = this.imputablesCache || [];
    const porTipo = {};
    imputables.forEach(c => {
      if (!porTipo[c.tipo]) porTipo[c.tipo] = [];
      porTipo[c.tipo].push(c);
    });

    const content = `
      <div class="modal-header"><h2>Cambiar Cuenta Contable</h2></div>
      <div id="formError"></div>
      <form id="mapeoForm">
        <div class="form-group">
          <label for="cuentaContableId">Cuenta Contable <span style="color: #ef4444;">*</span></label>
          <select id="cuentaContableId" name="cuentaContableId" required>
            ${Object.keys(porTipo).map(tipo => `
              <optgroup label="${tipo}">
                ${porTipo[tipo].map(c => `<option value="${c.id}">${c.codigo} - ${c.nombre}</option>`).join('')}
              </optgroup>
            `).join('')}
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('mapeoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const cuentaContableId = parseInt(document.getElementById('cuentaContableId').value, 10);

      try {
        const response = await window.api.mapeoContable.actualizar(modulo, concepto, cuentaContableId);
        if (response.success) {
          App.closeModal();
          this.loadMapeo();
          App.toast('Mapeo actualizado con éxito');
        } else {
          document.getElementById('formError').innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        document.getElementById('formError').innerHTML = '<div class="error-message">Error al guardar el mapeo</div>';
      }
    });
  },

  // --- Asientos Contables ---

  async loadAsientos() {
    const body = document.getElementById('contabilidadBody');
    const hoy = new Date().toISOString().split('T')[0];
    const inicioMes = new Date();
    inicioMes.setDate(1);
    const inicioMesStr = inicioMes.toISOString().split('T')[0];

    body.innerHTML = `
      <div style="padding: 16px 20px; display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap;">
        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="date" id="asientosDesde" value="${inicioMesStr}">
          <input type="date" id="asientosHasta" value="${hoy}">
          <button class="btn btn-secondary" id="btnFiltrarAsientos">Filtrar</button>
        </div>
        <button class="btn btn-primary" id="btnNuevoAsientoManual">+ Nueva Nota Contable</button>
      </div>
      <div id="asientosTableContent"><p style="padding: 24px; text-align: center;">Cargando...</p></div>
    `;

    document.getElementById('btnFiltrarAsientos').addEventListener('click', () => this.loadListaAsientos());
    document.getElementById('btnNuevoAsientoManual').addEventListener('click', () => this.showNuevoAsientoManualModal());

    await this.loadListaAsientos();
  },

  async loadListaAsientos() {
    const fechaDesde = document.getElementById('asientosDesde').value;
    const fechaHasta = document.getElementById('asientosHasta').value;

    try {
      const response = await window.api.asientos.getAll({ fechaDesde, fechaHasta, limit: 100 });
      if (response.success) {
        this.renderAsientos(response.data.data);
      } else {
        App.toast('Error al cargar los asientos: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderAsientos(asientos) {
    const tableContent = document.getElementById('asientosTableContent');

    const nombresOrigen = { Gasto: 'Gasto', Recibo: 'Recibo', Movimiento: 'Traslado Caja/Banco', Manual: 'Nota Contable', Reversion: 'Reversión' };

    if (asientos.length === 0) {
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No hay asientos en el período seleccionado</p>';
      return;
    }

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>No.</th>
            <th>Fecha</th>
            <th>Concepto</th>
            <th>Origen</th>
            <th>Total</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${asientos.map(a => `
            <tr>
              <td>${a.numero}</td>
              <td>${this.formatDate(a.fecha)}</td>
              <td>${a.concepto}</td>
              <td>${nombresOrigen[a.tipo_origen] || a.tipo_origen}</td>
              <td>$${this.formatNumber(a.total_debito)}</td>
              <td><span class="badge badge-${a.estado === 'Activo' ? 'activo' : 'inactivo'}">${a.estado}</span></td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-secondary btn-icon" onclick="Contabilidad.showDetalleAsiento(${a.id})">Ver</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  async showDetalleAsiento(id) {
    try {
      const response = await window.api.asientos.getById(id);
      if (!response.success) {
        App.toast('Error al cargar el asiento: ' + response.error, 'error');
        return;
      }

      const asiento = response.data;

      const content = `
        <div class="modal-header"><h2>Registro Contable No. ${asiento.numero}</h2></div>

        <div class="detail-section">
          <div class="detail-row"><div class="detail-label">Fecha:</div><div class="detail-value">${this.formatDate(asiento.fecha)}</div></div>
          <div class="detail-row"><div class="detail-label">Concepto:</div><div class="detail-value">${asiento.concepto}</div></div>
          <div class="detail-row"><div class="detail-label">Estado:</div><div class="detail-value"><span class="badge badge-${asiento.estado === 'Activo' ? 'activo' : 'inactivo'}">${asiento.estado}</span></div></div>
          ${asiento.estado === 'Anulado' ? `<div class="detail-row"><div class="detail-label">Motivo reversión:</div><div class="detail-value">${asiento.motivo_anulacion || '-'}</div></div>` : ''}
        </div>

        <table style="width: 100%; margin-top: 12px;">
          <thead><tr><th>Nombre de la Cuenta Contable</th><th>Código</th><th>Débito</th><th>Crédito</th></tr></thead>
          <tbody>
            ${asiento.lineas.map(l => `
              <tr>
                <td>${l.cuenta_nombre}</td>
                <td><code>${l.cuenta_codigo}</code></td>
                <td>${l.debito > 0 ? '$' + this.formatNumber(l.debito) : ''}</td>
                <td>${l.credito > 0 ? '$' + this.formatNumber(l.credito) : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          <button class="btn btn-secondary" onclick="Contabilidad.imprimirAsiento(${asiento.id})">Imprimir</button>
          <button class="btn btn-success" onclick="Contabilidad.exportarAsientoPDF(${asiento.id})">Exportar PDF</button>
          ${asiento.estado === 'Activo' ? `<button class="btn btn-warning" onclick="App.closeModal(); Contabilidad.showRevertirAsientoModal(${asiento.id})">Revertir</button>` : ''}
        </div>
      `;

      App.openModal(content, 'large');
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar el asiento', 'error');
    }
  },

  async imprimirAsiento(id) {
    try {
      const response = await window.api.asientos.imprimir(id);
      if (!response.success && !response.canceled) {
        App.toast('Error al imprimir: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al imprimir el registro contable', 'error');
    }
  },

  async exportarAsientoPDF(id) {
    try {
      const response = await window.api.asientos.exportarPDF(id);
      if (response.canceled) return;
      if (response.success) {
        App.toast(`Registro contable generado en: ${response.filePath}`);
      } else {
        App.toast('Error al exportar: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al exportar el registro contable', 'error');
    }
  },

  showRevertirAsientoModal(id) {
    const content = `
      <div class="modal-header"><h2>Revertir Asiento</h2></div>

      <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
          <strong>Nota:</strong> El asiento original no se borra ni se modifica; queda marcado como anulado y se crea un nuevo asiento con las líneas invertidas para neutralizar su efecto.
        </p>
      </div>

      <div id="formError"></div>

      <form id="revertirAsientoForm">
        <div class="form-group">
          <label for="motivo_reversion">Motivo de la Reversión <span style="color: #ef4444;">*</span></label>
          <textarea id="motivo_reversion" name="motivo_reversion" required></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-warning">Confirmar Reversión</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('revertirAsientoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const motivo = document.getElementById('motivo_reversion').value.trim();

      try {
        const response = await window.api.asientos.revertir(id, motivo);
        if (response.success) {
          App.closeModal();
          this.loadListaAsientos();
          App.toast('Asiento revertido con éxito');
        } else {
          document.getElementById('formError').innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        document.getElementById('formError').innerHTML = '<div class="error-message">Error al revertir el asiento</div>';
      }
    });
  },

  // Asiento manual: para todo lo que la generación automática no cubre (ajustes financieros,
  // depreciaciones, partidas de apertura, correcciones). El usuario agrega líneas libremente;
  // la validación de que cuadre débito = crédito ocurre al guardar, tanto aquí como en el backend.
  async showNuevoAsientoManualModal() {
    const imputablesResponse = await window.api.planCuentas.getImputables({});
    this.imputablesCache = imputablesResponse.success ? imputablesResponse.data : [];

    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header"><h2>Nueva Nota Contable</h2></div>
      <div id="formError"></div>
      <form id="asientoManualForm">
        <div class="form-group">
          <label for="am_fecha">Fecha <span style="color: #ef4444;">*</span></label>
          <input type="date" id="am_fecha" name="am_fecha" value="${hoy}" required>
        </div>
        <div class="form-group">
          <label for="am_concepto">Concepto <span style="color: #ef4444;">*</span></label>
          <input type="text" id="am_concepto" name="am_concepto" placeholder="Ej: Ajuste por depreciación de equipo de bombeo" required>
        </div>

        <table style="width: 100%;" id="lineasAsientoTable">
          <thead><tr><th>Cuenta Contable</th><th style="width: 140px;">Débito</th><th style="width: 140px;">Crédito</th><th></th></tr></thead>
          <tbody id="lineasAsientoBody"></tbody>
        </table>
        <button type="button" class="btn btn-secondary btn-icon" id="btnAgregarLinea" style="margin: 8px 0 16px 0;">+ Agregar línea</button>

        <div id="balanceAsientoInfo" style="padding: 10px 12px; background: #f1f5f9; border-radius: 6px; font-size: 0.875rem; margin-bottom: 16px;"></div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar Asiento</button>
        </div>
      </form>
    `;

    App.openModal(content, 'large');

    this.agregarLineaAsiento();
    this.agregarLineaAsiento();

    document.getElementById('btnAgregarLinea').addEventListener('click', () => this.agregarLineaAsiento());

    document.getElementById('asientoManualForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const lineas = Array.from(document.querySelectorAll('#lineasAsientoBody tr')).map(fila => ({
        cuentaContableId: parseInt(fila.querySelector('.linea-cuenta').value, 10),
        debito: App.parseMoneyValue(fila.querySelector('.linea-debito').value),
        credito: App.parseMoneyValue(fila.querySelector('.linea-credito').value)
      }));

      try {
        const response = await window.api.asientos.crearManual({
          fecha: document.getElementById('am_fecha').value,
          concepto: document.getElementById('am_concepto').value.trim(),
          lineas
        });

        if (response.success) {
          App.closeModal();
          this.loadListaAsientos();
          App.toast('Asiento manual creado con éxito');
        } else {
          document.getElementById('formError').innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        document.getElementById('formError').innerHTML = '<div class="error-message">Error al guardar el asiento</div>';
      }
    });
  },

  agregarLineaAsiento() {
    const tbody = document.getElementById('lineasAsientoBody');
    const fila = document.createElement('tr');

    const porTipo = {};
    (this.imputablesCache || []).forEach(c => {
      if (!porTipo[c.tipo]) porTipo[c.tipo] = [];
      porTipo[c.tipo].push(c);
    });

    fila.innerHTML = `
      <td>
        <select class="linea-cuenta" style="width: 100%;">
          ${Object.keys(porTipo).map(tipo => `
            <optgroup label="${tipo}">
              ${porTipo[tipo].map(c => `<option value="${c.id}">${c.codigo} - ${c.nombre}</option>`).join('')}
            </optgroup>
          `).join('')}
        </select>
      </td>
      <td><input type="text" inputmode="numeric" class="linea-debito" placeholder="0"></td>
      <td><input type="text" inputmode="numeric" class="linea-credito" placeholder="0"></td>
      <td><button type="button" class="btn btn-danger btn-icon" onclick="this.closest('tr').remove(); Contabilidad.actualizarBalanceAsiento();">✕</button></td>
    `;

    tbody.appendChild(fila);

    const inputDebito = fila.querySelector('.linea-debito');
    const inputCredito = fila.querySelector('.linea-credito');
    App.attachMoneyInput(inputDebito);
    App.attachMoneyInput(inputCredito);
    inputDebito.addEventListener('input', () => this.actualizarBalanceAsiento());
    inputCredito.addEventListener('input', () => this.actualizarBalanceAsiento());

    this.actualizarBalanceAsiento();
  },

  actualizarBalanceAsiento() {
    const totalDebito = Array.from(document.querySelectorAll('.linea-debito')).reduce((s, i) => s + App.parseMoneyValue(i.value), 0);
    const totalCredito = Array.from(document.querySelectorAll('.linea-credito')).reduce((s, i) => s + App.parseMoneyValue(i.value), 0);
    const diferencia = totalDebito - totalCredito;

    const info = document.getElementById('balanceAsientoInfo');
    if (!info) return;

    info.innerHTML = `
      Total Débito: <strong>$${this.formatNumber(totalDebito)}</strong> &nbsp;|&nbsp;
      Total Crédito: <strong>$${this.formatNumber(totalCredito)}</strong> &nbsp;|&nbsp;
      ${diferencia === 0
        ? '<span style="color: #16a34a;">✓ Balanceado</span>'
        : `<span style="color: #dc2626;">Diferencia: $${this.formatNumber(Math.abs(diferencia))}</span>`}
    `;
  },

  // --- Reportes Contables ---

  async loadReportesContables() {
    const body = document.getElementById('contabilidadBody');

    let html = '';
    this.gruposReportes.forEach((grupo, gi) => {
      html += `
        <div style="padding: 16px 20px;">
          <h3 style="margin: 0 0 12px 0; color: #334155; font-size: 1rem;">${grupo.titulo}</h3>
          <div class="reportes-grid">
            ${grupo.reportes.map((r, ri) => this.renderCard(r, `${gi}_${ri}`)).join('')}
          </div>
        </div>
      `;
    });

    body.innerHTML = html;

    if (this.gruposReportes.some(g => g.reportes.some(r => r.filtroCuentaContable || r.requiereCuentaContable))) {
      await this.cargarCuentasContables();
    }
  },

  // Cuentas contables imputables, para los selects de filtro "Cuenta Contable" de los reportes
  // que lo soportan. Se cargan una sola vez y se reutilizan en todos los selects de la página.
  async cargarCuentasContables() {
    try {
      const response = await window.api.planCuentas.getImputables({});
      this.cuentasContables = response.success ? response.data : [];
    } catch (error) {
      console.error('Error al cargar cuentas contables:', error);
      this.cuentasContables = [];
    }

    document.querySelectorAll('[data-select-cuenta-contable]').forEach(select => {
      const opcionTodas = select.dataset.requerida === 'true' ? '' : '<option value="">Todas las cuentas contables</option>';
      select.innerHTML = `
        ${opcionTodas}
        ${this.cuentasContables.map(c => `<option value="${c.id}">${c.codigo} - ${c.nombre}</option>`).join('')}
      `;
    });
  },

  renderCard(reporte, idSufijo) {
    const hoy = new Date().toISOString().split('T')[0];
    const inicioMes = new Date();
    inicioMes.setDate(1);
    const inicioMesStr = inicioMes.toISOString().split('T')[0];

    return `
      <div class="reporte-card">
        <div class="reporte-card-icon">${reporte.icon}</div>
        <div class="reporte-card-titulo">${reporte.titulo}</div>
        ${reporte.rangoFecha ? `
          <div class="reporte-card-fechas">
            <input type="date" id="desde_${idSufijo}" value="${inicioMesStr}">
            <input type="date" id="hasta_${idSufijo}" value="${hoy}">
          </div>
        ` : ''}
        ${reporte.filtroCuentaContable || reporte.requiereCuentaContable ? `
          <select id="cuentaContable_${idSufijo}" data-select-cuenta-contable data-requerida="${!!reporte.requiereCuentaContable}" style="width: 100%; margin-bottom: 8px;" ${reporte.requiereCuentaContable ? 'required' : ''}>
            <option value="">Todas las cuentas contables</option>
          </select>
        ` : ''}
        <div class="reporte-card-actions">
          <button class="btn btn-secondary btn-icon" onclick="Contabilidad.exportarReporte('${idSufijo}', 'pdf')">PDF</button>
          <button class="btn btn-success btn-icon" onclick="Contabilidad.exportarReporte('${idSufijo}', 'excel')">Excel</button>
        </div>
      </div>
    `;
  },

  obtenerReportePorSufijo(idSufijo) {
    const [gi, ri] = idSufijo.split('_').map(Number);
    return this.gruposReportes[gi].reportes[ri];
  },

  async exportarReporte(idSufijo, formato) {
    const reporte = this.obtenerReportePorSufijo(idSufijo);
    const params = {};

    if (reporte.rangoFecha) {
      params.fechaDesde = document.getElementById(`desde_${idSufijo}`).value;
      params.fechaHasta = document.getElementById(`hasta_${idSufijo}`).value;
    }

    if (reporte.filtroCuentaContable || reporte.requiereCuentaContable) {
      params.cuentaContableId = document.getElementById(`cuentaContable_${idSufijo}`).value;
      if (reporte.requiereCuentaContable && !params.cuentaContableId) {
        App.toast('Debe seleccionar una cuenta contable', 'error');
        return;
      }
    }

    const tipo = reporte.tipo;

    try {
      const response = formato === 'pdf'
        ? await window.api.reportes.generarPDF(tipo, params)
        : await window.api.reportes.generarExcel(tipo, params);

      if (response.canceled) return;

      if (response.success) {
        App.toast(`Reporte generado en: ${response.filePath}`);
      } else {
        App.toast('Error al generar el reporte: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al generar el reporte', 'error');
    }
  },

  formatNumber(num) {
    return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  },

  formatDate(dateString) {
    if (!dateString) return '-';
    const [anio, mes, dia] = dateString.split(' ')[0].split('-');
    return `${dia}/${mes}/${anio}`;
  }
};
