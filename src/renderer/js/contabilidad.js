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
        { tipo: 'flujo_caja', titulo: 'Flujo de Caja', icon: '💧', rangoFecha: true },
        { tipo: 'libro_diario', titulo: 'Libro Diario', icon: '📖', rangoFecha: true }
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
            <button class="btn btn-secondary" id="tabReportesContablesBtn">Reportes Contables</button>
          </div>
        </div>
        <div id="contabilidadBody"></div>
      </div>
    `;

    document.getElementById('tabPlanCuentasBtn').addEventListener('click', () => this.mostrarTab('plancuentas'));
    document.getElementById('tabMapeoBtn').addEventListener('click', () => this.mostrarTab('mapeo'));
    document.getElementById('tabReportesContablesBtn').addEventListener('click', () => this.mostrarTab('reportes'));

    await this.mostrarTab('plancuentas');
  },

  async mostrarTab(tab) {
    this.tabActual = tab;
    document.getElementById('tabPlanCuentasBtn').className = tab === 'plancuentas' ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('tabMapeoBtn').className = tab === 'mapeo' ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('tabReportesContablesBtn').className = tab === 'reportes' ? 'btn btn-primary' : 'btn btn-secondary';

    if (tab === 'plancuentas') {
      await this.loadCatalogo();
    } else if (tab === 'mapeo') {
      await this.loadMapeo();
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

    if (this.gruposReportes.some(g => g.reportes.some(r => r.filtroCuentaContable))) {
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
      select.innerHTML = `
        <option value="">Todas las cuentas contables</option>
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
        ${reporte.filtroCuentaContable ? `
          <select id="cuentaContable_${idSufijo}" data-select-cuenta-contable style="width: 100%; margin-bottom: 8px;">
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

    if (reporte.filtroCuentaContable) {
      params.cuentaContableId = document.getElementById(`cuentaContable_${idSufijo}`).value;
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
  }
};
