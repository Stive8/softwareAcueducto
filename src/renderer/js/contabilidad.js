// Módulo de Contabilidad: Plan de Cuentas (PUC), Mapeo de Conceptos y los reportes contables
// (pagos/gastos, estados financieros, informe de empalme). Preparación para una futura
// contabilidad de doble partida: aquí solo se administra el catálogo y se generan reportes,
// sin generar asientos todavía.
const Contabilidad = {
  tabActual: 'dashboard',

  gruposReportes: [
    {
      titulo: 'Cartera',
      reportes: [
        { tipo: 'cartera_por_edades', titulo: 'Cartera por Edades (Aging)', icon: 'clock', descripcion: 'Cuentas activas con mora, clasificadas por rango de antigüedad de la deuda.', destacado: true },
        { tipo: 'cuentas_en_mora', titulo: 'Cuentas en Mora', icon: 'alertTriangle', descripcion: 'Listado de cuentas que tienen pagos pendientes.' },
        { tipo: 'cuentas_al_dia', titulo: 'Cuentas al Día', icon: 'checkCircle', descripcion: 'Cuentas activas sin deuda pendiente.' },
        { tipo: 'cuentas_saldo_favor', titulo: 'Cuentas con Saldo a Favor', icon: 'wallet', descripcion: 'Cuentas que tienen saldo a favor acumulado.' }
      ]
    },
    {
      titulo: 'Aportes y Gastos',
      reportes: [
        { tipo: 'historial_pagos', titulo: 'Historial de Aportes', icon: 'wallet', descripcion: 'Listado detallado de los aportes de sostenimiento recibidos en el rango de fechas.', rangoFecha: true, filtroCuentaContable: true, filtroTipoCuenta: true },
        { tipo: 'historial_gastos', titulo: 'Historial de Gastos', icon: 'trendingDown', descripcion: 'Listado detallado de los gastos registrados en el rango de fechas.', rangoFecha: true, filtroCuentaContable: true, filtroTipoCuenta: true },
        { tipo: 'ingresos_periodo', titulo: 'Ingresos por Período', icon: 'barChart', descripcion: 'Total de ingresos agrupados por cuenta contable en el período.', rangoFecha: true, filtroCuentaContable: true, filtroTipoCuenta: true },
        { tipo: 'gastos_periodo', titulo: 'Gastos por Período', icon: 'trendingDown', descripcion: 'Total de gastos agrupados por cuenta contable en el período.', rangoFecha: true, filtroCuentaContable: true, filtroTipoCuenta: true }
      ]
    },
    {
      titulo: 'Estados Financieros',
      reportes: [
        { tipo: 'balance_general', titulo: 'Balance General', icon: 'landmark', descripcion: 'Activos, pasivos y patrimonio a una fecha de corte.', fechaCorte: true, destacado: true },
        { tipo: 'estado_resultados', titulo: 'Estado de Resultados', icon: 'fileChart', descripcion: 'Ingresos, gastos y utilidad del período.', rangoFecha: true, destacado: true },
        { tipo: 'flujo_caja', titulo: 'Flujo de Caja', icon: 'wallet', descripcion: 'Entradas y salidas de efectivo en el período.', rangoFecha: true }
      ]
    },
    {
      titulo: 'Doble Partida',
      reportes: [
        { tipo: 'libro_diario', titulo: 'Libro Diario', icon: 'book', descripcion: 'Registro cronológico de los movimientos contables del período.', rangoFecha: true, filtroTipoCuenta: true, destacado: true },
        { tipo: 'libro_mayor', titulo: 'Libro Mayor', icon: 'book', descripcion: 'Movimientos y saldo de una cuenta contable específica en el período.', rangoFecha: true, requiereCuentaContable: true, destacado: true },
        { tipo: 'balance_prueba', titulo: 'Balance de Prueba', icon: 'barChart', descripcion: 'Saldos de todas las cuentas contables al cierre del período.', rangoFecha: true, filtroTipoCuenta: true },
        { tipo: 'balance_prueba_tercero', titulo: 'Balance de Prueba por Tercero', icon: 'fileText', descripcion: 'Saldo de las cuentas de un tercero específico en un rango de cuentas.', rangoFecha: true, rangoCuentaContable: true, filtroTercero: true }
      ]
    },
    {
      titulo: 'Informe de Gestión',
      reportes: [
        { tipo: 'informe_empalme', titulo: 'Informe de Empalme', icon: 'fileChart', descripcion: 'Resumen de gestión para entrega y recepción de la administración.', rangoFecha: true }
      ]
    }
  ],

  // tabInicial: a qué pestaña entrar (la elige el submenú del sidebar al pasar el cursor sobre
  // "Contabilidad"). Si no se indica, se mantiene en la última que estaba abierta.
  async load(tabInicial = null) {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Contabilidad</h1>
        <p>Plan de cuentas, clasificación de movimientos y reportes contables</p>
      </div>

      <div class="table-container">
        <div id="contabilidadBody"></div>
      </div>
    `;

    await this.mostrarTab(tabInicial || this.tabActual);
  },

  async mostrarTab(tab) {
    this.tabActual = tab;

    if (tab === 'dashboard') {
      await this.loadDashboard();
    } else if (tab === 'periodos') {
      await this.loadPeriodos();
    } else if (tab === 'plancuentas') {
      await this.loadCatalogo();
    } else if (tab === 'cuentasautomaticas') {
      await this.loadCuentasAutomaticas();
    } else if (tab === 'plantillas') {
      await this.loadPlantillas();
    } else if (tab === 'impuestos') {
      await this.loadImpuestos();
    } else if (tab === 'mapeo') {
      await this.loadMapeo();
    } else if (tab === 'asientos') {
      await this.loadAsientos();
    } else {
      await this.loadReportesContables();
    }
  },

  // --- Dashboard Financiero ---

  async loadDashboard() {
    const body = document.getElementById('contabilidadBody');
    body.innerHTML = `<div id="dashboardContent" style="padding: 24px;">${App.renderSkeletonTable()}</div>`;

    try {
      const res = await window.api.contabilidad.getDashboard();
      if (!res.success) { App.toast('Error al cargar el dashboard: ' + res.error, 'error'); return; }
      this.renderDashboard(res.data);
    } catch (e) {
      console.error(e);
    }
  },

  renderDashboard(data) {
    const body = document.getElementById('contabilidadBody');
    const fmt = n => Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: 0 });
    const mes = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][data.mes - 1];
    const estadoPeriodo = data.periodoActual.estado || 'Sin registro';
    const colorEstado = estadoPeriodo === 'Abierto' ? '#16a34a' : estadoPeriodo === 'Cerrado' ? '#d97706' : '#dc2626';
    const utilidadColor = data.resultadoMes >= 0 ? '#16a34a' : '#dc2626';

    body.innerHTML = `
      <div style="padding: 24px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:24px;">
          <div>
            <h2 style="margin:0; color:#1e293b;">Dashboard Financiero</h2>
            <p style="margin:4px 0 0; color:#64748b; font-size:0.875rem;">${mes} ${data.anio}</p>
          </div>
          <div style="display:flex; align-items:center; gap:8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px 16px;">
            <span style="width:10px; height:10px; border-radius:50%; background:${colorEstado}; display:inline-block;"></span>
            <span style="font-size:0.875rem; color:#334155;">Período: <strong>${estadoPeriodo}</strong></span>
            ${estadoPeriodo === 'Abierto' ? '<button class="btn btn-secondary btn-icon" style="margin-left:8px;" onclick="Contabilidad.mostrarTab(\'periodos\')">Gestionar</button>' : ''}
          </div>
        </div>

        <div class="kpi-grid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; margin-bottom:32px;">
          <div class="kpi-card" style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px; border-left:4px solid #16a34a;">
            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">Ingresos del Mes</div>
            <div style="font-size:1.75rem; font-weight:700; color:#16a34a;">$${fmt(data.ingresosMes)}</div>
          </div>
          <div class="kpi-card" style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px; border-left:4px solid #dc2626;">
            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">Gastos del Mes</div>
            <div style="font-size:1.75rem; font-weight:700; color:#dc2626;">$${fmt(data.gastosMes)}</div>
          </div>
          <div class="kpi-card" style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px; border-left:4px solid ${utilidadColor};">
            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">Resultado del Mes</div>
            <div style="font-size:1.75rem; font-weight:700; color:${utilidadColor};">${data.resultadoMes < 0 ? '-' : ''}$${fmt(Math.abs(data.resultadoMes))}</div>
          </div>
          <div class="kpi-card" style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px; border-left:4px solid #3b82f6;">
            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">Saldo Disponible</div>
            <div style="font-size:1.75rem; font-weight:700; color:#1e293b;">$${fmt(data.saldoDisponible)}</div>
            <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">Caja $${fmt(data.saldoCaja)} + Banco $${fmt(data.saldoBanco)}</div>
          </div>
          <div class="kpi-card" style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:20px; border-left:4px solid #f59e0b; cursor:pointer;" onclick="Contabilidad.mostrarTab('reportes')">
            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">Cuentas en Mora</div>
            <div style="font-size:1.75rem; font-weight:700; color:#d97706;">${data.cuentasMora}</div>
            <div style="font-size:0.75rem; color:#3b82f6; margin-top:4px;">Ver Cartera por Edades →</div>
          </div>
        </div>

        <div style="display:flex; gap:12px; flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="Contabilidad.mostrarTab('periodos')">Gestionar Períodos</button>
          <button class="btn btn-secondary" onclick="Contabilidad.mostrarTab('reportes')">Ver Reportes Contables</button>
          <button class="btn btn-secondary" onclick="Contabilidad.mostrarTab('asientos')">Asientos Contables</button>
        </div>
      </div>
    `;
  },

  // --- Períodos Contables ---

  async loadPeriodos() {
    const body = document.getElementById('contabilidadBody');
    body.innerHTML = `
      <div style="padding: 16px 20px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 style="margin:0; color:#1e293b;">Períodos Contables</h2>
          <p style="margin:4px 0 0; color:#64748b; font-size:0.875rem;">Controla qué períodos están abiertos para registrar movimientos.</p>
        </div>
      </div>
      <div id="periodosContent" style="padding:0 20px 24px;">${App.renderSkeletonTable()}</div>
    `;

    try {
      const res = await window.api.periodos.getAll();
      if (!res.success) { App.toast('Error al cargar los períodos: ' + res.error, 'error'); return; }
      this.renderPeriodos(res.data);
    } catch (e) { console.error(e); }
  },

  renderPeriodos(periodos) {
    const cont = document.getElementById('periodosContent');
    const meses = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const badgeEstado = e => e === 'Abierto' ? 'badge-activo' : e === 'Cerrado' ? 'badge-warning' : 'badge-inactivo';

    if (!periodos.length) {
      cont.innerHTML = `<div class="empty-state"><p>No hay períodos registrados aún. Se crean automáticamente al registrar el primer movimiento de cada mes.</p></div>`;
      return;
    }

    cont.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Período</th>
            <th>Estado</th>
            <th>Fecha Apertura</th>
            <th>Fecha Cierre</th>
            <th>Cerrado por</th>
            <th>Motivo</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${periodos.map(p => `
            <tr>
              <td><strong>${meses[p.mes]} ${p.anio}</strong></td>
              <td><span class="badge ${badgeEstado(p.estado)}">${p.estado}</span></td>
              <td>${p.fecha_apertura ? p.fecha_apertura.substring(0,10) : '-'}</td>
              <td>${p.fecha_cierre ? p.fecha_cierre.substring(0,10) : '-'}</td>
              <td>${p.usuario_cierre_nombre || '-'}</td>
              <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${p.motivo_cierre || ''}">${p.motivo_cierre || '-'}</td>
              <td>
                <div class="table-actions">
                  ${p.estado === 'Abierto' ? `<button class="btn btn-warning btn-icon" onclick="Contabilidad.cerrarPeriodo(${p.id})">Cerrar</button>` : ''}
                  ${p.estado === 'Abierto' ? `<button class="btn btn-danger btn-icon" onclick="Contabilidad.bloquearPeriodo(${p.id})">Bloquear</button>` : ''}
                  ${p.estado === 'Cerrado' ? `<button class="btn btn-info btn-icon" onclick="Contabilidad.reabrirPeriodo(${p.id})">Reabrir</button>` : ''}
                  ${p.estado === 'Cerrado' ? `<button class="btn btn-danger btn-icon" onclick="Contabilidad.bloquearPeriodo(${p.id})">Bloquear</button>` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  cerrarPeriodo(id) {
    App.openModal(`
      <div class="modal-header"><h2>Cerrar Período</h2></div>
      <div id="formError"></div>
      <p style="color:#64748b; font-size:0.875rem; margin-bottom:16px;">Al cerrar el período no se podrán registrar nuevos movimientos con fecha en ese mes. Puede reabrirlo si es necesario.</p>
      <div class="form-group">
        <label>Motivo del cierre <span style="color:#ef4444;">*</span></label>
        <input type="text" id="motivoCierrePeriodo" placeholder="Ej: Cierre mensual de período">
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
        <button class="btn btn-warning" onclick="Contabilidad._confirmarCierrePeriodo(${id})">Cerrar Período</button>
      </div>
    `);
    setTimeout(() => document.getElementById('motivoCierrePeriodo')?.focus(), 100);
  },

  async _confirmarCierrePeriodo(id) {
    const motivo = document.getElementById('motivoCierrePeriodo')?.value?.trim();
    if (!motivo) { document.getElementById('formError').innerHTML = '<div class="alert alert-error">El motivo del cierre es obligatorio.</div>'; return; }
    const res = await window.api.periodos.cerrar(id, motivo);
    if (res.success) { App.closeModal(); App.toast('Período cerrado correctamente.', 'success'); await this.loadPeriodos(); }
    else { document.getElementById('formError').innerHTML = `<div class="alert alert-error">${res.error}</div>`; }
  },

  bloquearPeriodo(id) {
    App.openModal(`
      <div class="modal-header"><h2>Bloquear Período</h2></div>
      <div id="formError"></div>
      <div style="background:#fef2f2; border-left:4px solid #dc2626; border-radius:4px; padding:12px 16px; margin-bottom:16px;">
        <p style="margin:0; font-size:0.875rem; color:#991b1b;"><strong>Advertencia:</strong> El bloqueo es definitivo. Un período Bloqueado no puede reabrirse desde la aplicación.</p>
      </div>
      <div class="form-group">
        <label>Motivo del bloqueo <span style="color:#ef4444;">*</span></label>
        <input type="text" id="motivoBloqueo" placeholder="Ej: Cierre de ejercicio fiscal 2025">
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
        <button class="btn btn-danger" onclick="Contabilidad._confirmarBloqueo(${id})">Bloquear Definitivamente</button>
      </div>
    `);
    setTimeout(() => document.getElementById('motivoBloqueo')?.focus(), 100);
  },

  async _confirmarBloqueo(id) {
    const motivo = document.getElementById('motivoBloqueo')?.value?.trim();
    if (!motivo) { document.getElementById('formError').innerHTML = '<div class="alert alert-error">El motivo del bloqueo es obligatorio.</div>'; return; }
    const res = await window.api.periodos.bloquear(id, motivo);
    if (res.success) { App.closeModal(); App.toast('Período bloqueado definitivamente.', 'success'); await this.loadPeriodos(); }
    else { document.getElementById('formError').innerHTML = `<div class="alert alert-error">${res.error}</div>`; }
  },

  async reabrirPeriodo(id) {
    if (!confirm('¿Está seguro de reabrir este período? Se podrán registrar nuevos movimientos con fecha en ese mes.')) return;
    const res = await window.api.periodos.reabrir(id);
    if (res.success) { App.toast('Período reabierto correctamente.', 'success'); await this.loadPeriodos(); }
    else App.toast('Error: ' + res.error, 'error');
  },

  // --- Cuentas Automáticas ---

  async loadCuentasAutomaticas() {
    const body = document.getElementById('contabilidadBody');
    body.innerHTML = `
      <div style="padding: 16px 20px 8px;">
        <h2 style="margin:0; color:#1e293b;">Cuentas Automáticas</h2>
        <p style="margin:4px 0 16px; color:#64748b; font-size:0.875rem;">Cuentas contables que el sistema usa automáticamente en los asientos generados. Solo el administrador puede cambiar a qué cuenta del Plan de Cuentas apunta cada clave.</p>
        <div style="background:#eff6ff; border-left:4px solid #3b82f6; border-radius:4px; padding:12px 16px; margin-bottom:20px;">
          <p style="margin:0; font-size:0.875rem; color:#1e40af;"><strong>Nota:</strong> Cambiar una cuenta automática solo afecta los nuevos movimientos; los asientos ya registrados mantienen las cuentas con las que fueron creados.</p>
        </div>
      </div>
      <div id="cuentasAutoContent" style="padding:0 20px 24px;">${App.renderSkeletonTable()}</div>
    `;

    try {
      const [resCA, resPlan] = await Promise.all([
        window.api.cuentasAutomaticas.getAll(),
        window.api.planCuentas.getImputables({})
      ]);
      if (!resCA.success) { App.toast('Error: ' + resCA.error, 'error'); return; }
      this.renderCuentasAutomaticas(resCA.data, resPlan.success ? resPlan.data : []);
    } catch (e) { console.error(e); }
  },

  renderCuentasAutomaticas(cuentas, imputables) {
    const cont = document.getElementById('cuentasAutoContent');
    cont.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Clave</th>
            <th>Nombre</th>
            <th>Cuenta Asignada</th>
            <th>Código PUC</th>
            <th>Descripción</th>
            <th>Última Actualización</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          ${cuentas.map(ca => `
            <tr>
              <td><code>${ca.clave}</code></td>
              <td><strong>${ca.nombre}</strong></td>
              <td>${ca.nombre_cuenta}</td>
              <td><code>${ca.codigo}</code></td>
              <td style="font-size:0.8rem; color:#64748b; max-width:250px;">${ca.descripcion || '-'}</td>
              <td style="font-size:0.8rem;">${ca.fecha_actualizacion ? ca.fecha_actualizacion.substring(0,10) : '-'}</td>
              <td>
                <button class="btn btn-secondary btn-icon" onclick="Contabilidad.editarCuentaAutomatica('${ca.clave}', ${ca.cuenta_contable_id})">Cambiar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    this._imputablesCache = imputables;
    this._cuentasAutoCache = cuentas;
  },

  async editarCuentaAutomatica(clave, cuentaActualId) {
    const imputables = this._imputablesCache || [];
    const ca = (this._cuentasAutoCache || []).find(c => c.clave === clave);
    if (!ca) return;

    const content = `
      <div class="modal-header"><h2>Cambiar Cuenta Automática: ${ca.nombre}</h2></div>
      <div id="formError"></div>
      <p style="color:#64748b; font-size:0.875rem; margin-bottom:20px;">${ca.descripcion || ''}</p>
      <div class="form-group">
        <label>Cuenta Contable (solo imputables)</label>
        <select id="nuevaCuentaId">
          ${imputables.map(i => `<option value="${i.id}" ${i.id === cuentaActualId ? 'selected' : ''}>${i.codigo} - ${i.nombre}</option>`).join('')}
        </select>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Contabilidad.guardarCuentaAutomatica('${clave}')">Guardar</button>
      </div>
    `;
    App.openModal(content);
  },

  async guardarCuentaAutomatica(clave) {
    const cuentaId = parseInt(document.getElementById('nuevaCuentaId').value);
    const res = await window.api.cuentasAutomaticas.actualizar(clave, cuentaId);
    if (res.success) {
      App.toast('Cuenta automática actualizada.', 'success');
      App.closeModal();
      await this.loadCuentasAutomaticas();
    } else {
      document.getElementById('formError').innerHTML = `<div class="alert alert-error">${res.error}</div>`;
    }
  },

  // --- Catálogo de Cuentas (Plan de Cuentas) ---

  async loadCatalogo() {
    const body = document.getElementById('contabilidadBody');
    body.innerHTML = `
      <div style="padding: 16px 20px; display: flex; justify-content: flex-end;">
        <button class="btn btn-primary" id="btnNuevaCuenta">+ Nueva Cuenta</button>
      </div>
      <div id="catalogoTableContent">${App.renderSkeletonTable()}</div>
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
        ${!id ? `
          <div class="form-group">
            <label for="padreId">Cuenta Padre</label>
            <select id="padreId" name="padreId">
              <option value="">Sin cuenta padre (nueva Clase, nivel 1)</option>
              ${padres.map(p => `<option value="${p.id}" data-codigo="${p.codigo}" data-tipo="${p.tipo || ''}" data-naturaleza="${p.naturaleza || ''}">${p.codigo} - ${p.nombre} (${p.tipo})</option>`).join('')}
            </select>
          </div>
          <div class="form-group" id="codigoWrapper"></div>
        ` : `
          <div class="form-group">
            <label for="codigo">Código <span style="color:#ef4444;">*</span></label>
            <input type="text" id="codigo" name="codigo" value="${cuenta?.codigo || ''}" required>
          </div>
          <div style="padding:12px;background:#eff6ff;border-left:4px solid #3b82f6;border-radius:4px;margin-bottom:20px;">
            <p style="margin:0;font-size:0.875rem;color:#1e40af;">La jerarquía (cuenta padre / nivel) no se puede modificar después de creada la cuenta.</p>
          </div>
        `}
        <div class="form-group">
          <label for="nombre">Nombre <span style="color:#ef4444;">*</span></label>
          <input type="text" id="nombre" name="nombre" value="${cuenta?.nombre || ''}" required>
        </div>
        <div class="form-group">
          <label for="tipo">Tipo <span style="color:#ef4444;">*</span></label>
          <select id="tipo" name="tipo" required>
            ${['Activo', 'Pasivo', 'Patrimonio', 'Ingreso', 'Gasto', 'Costo'].map(t =>
              `<option value="${t}" ${cuenta?.tipo === t ? 'selected' : ''}>${t}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="naturaleza">Naturaleza <span style="color:#ef4444;">*</span></label>
          <select id="naturaleza" name="naturaleza" required>
            <option value="Debito" ${cuenta?.naturaleza === 'Debito' ? 'selected' : ''}>Débito</option>
            <option value="Credito" ${cuenta?.naturaleza === 'Credito' ? 'selected' : ''}>Crédito</option>
          </select>
        </div>
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

    if (!id) {
      this._actualizarCamposCuenta();
      document.getElementById('padreId').addEventListener('change', () => this._actualizarCamposCuenta());
      Combobox.attach('padreId');
    }
  },

  _actualizarCamposCuenta() {
    const padreSelect = document.getElementById('padreId');
    const wrapper = document.getElementById('codigoWrapper');
    if (!padreSelect || !wrapper) return;

    const padreId = padreSelect.value;

    if (!padreId) {
      wrapper.innerHTML = `
        <label for="codigoLibre">Código <span style="color:#ef4444;">*</span></label>
        <input type="text" id="codigoLibre" name="codigoLibre"
          placeholder="Ej: 1 (Clase), 11 (Grupo), 1105 (Cuenta)..."
          maxlength="8" inputmode="numeric" autocomplete="off" required>
        <small style="color:#64748b;font-size:0.875rem;">Máximo 8 dígitos. Ej: 1, 11, 1105, 110501</small>
      `;
      document.getElementById('codigoLibre').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
      });
    } else {
      const padreOpt = padreSelect.querySelector(`option[value="${padreId}"]`);
      const prefijo = padreOpt?.dataset.codigo || '';
      const tipo = padreOpt?.dataset.tipo || '';
      const naturaleza = padreOpt?.dataset.naturaleza || '';
      const maxSufijo = Math.max(1, 8 - prefijo.length);

      wrapper.innerHTML = `
        <label>Código <span style="color:#ef4444;">*</span></label>
        <div style="display:flex;align-items:stretch;border:1px solid #cbd5e1;border-radius:6px;overflow:hidden;">
          <span id="codigoPrefijo" style="
            display:flex;align-items:center;padding:0 12px;
            background:#f1f5f9;color:#334155;
            font-family:monospace;font-weight:700;font-size:15px;
            border-right:1px solid #e2e8f0;white-space:nowrap;user-select:none;"
          >${prefijo}</span>
          <input type="text" id="codigoSufijo"
            style="flex:1;border:none;outline:none;padding:10px 12px;font-size:14px;min-width:0;background:white;"
            inputmode="numeric" maxlength="${maxSufijo}"
            placeholder="${'0'.repeat(Math.min(maxSufijo, 2))}"
            autocomplete="off" required>
        </div>
        <small style="color:#64748b;font-size:0.875rem;">
          Prefijo fijo: <strong style="font-family:monospace;">${prefijo}</strong> — añade hasta ${maxSufijo} dígito${maxSufijo !== 1 ? 's' : ''} más
        </small>
      `;

      document.getElementById('codigoSufijo').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
      });

      if (tipo) document.getElementById('tipo').value = tipo;
      if (naturaleza) document.getElementById('naturaleza').value = naturaleza;
    }
  },

  async saveCuenta(id) {
    let codigo;
    if (!id) {
      const prefijo = document.getElementById('codigoPrefijo');
      const sufijo = document.getElementById('codigoSufijo');
      const libre = document.getElementById('codigoLibre');
      if (prefijo && sufijo) {
        codigo = prefijo.textContent.trim() + sufijo.value.trim();
      } else {
        codigo = libre?.value.trim() || '';
      }
    } else {
      codigo = document.getElementById('codigo')?.value.trim() || '';
    }

    if (!codigo) {
      document.getElementById('formError').innerHTML = '<div class="error-message">El código de la cuenta es requerido</div>';
      return;
    }

    const formData = {
      codigo,
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
      <div style="padding: 16px 20px; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;">
        <p style="color: #64748b; font-size: 0.875rem; margin: 0;">
          Define a qué cuenta contable corresponde cada tipo de gasto, concepto de recibo y origen de movimiento de caja/banco.
          Esto es lo que permite generar los asientos contables automáticos. El "Tipo de Gasto" del formulario de Gastos solo
          ofrece para elegir los que aparecen aquí.
        </p>
        <button class="btn btn-primary" id="btnAgregarTipoGasto" style="white-space: nowrap;">+ Agregar Tipo de Gasto</button>
      </div>
      <div id="mapeoTableContent">${App.renderSkeletonTable()}</div>
    `;

    document.getElementById('btnAgregarTipoGasto').addEventListener('click', () => this.showAgregarTipoGastoModal());

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
    Combobox.attach('cuentaContableId');

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

  // Por ahora solo para módulo "Gasto": los otros dos (RecibosDetalle, Movimiento) tienen una
  // lista fija y pequeña de conceptos que ya cubre todos los casos reales, no hace falta poder
  // agregarles más desde aquí.
  showAgregarTipoGastoModal() {
    const imputables = this.imputablesCache || [];
    const porTipo = {};
    imputables.forEach(c => {
      if (!porTipo[c.tipo]) porTipo[c.tipo] = [];
      porTipo[c.tipo].push(c);
    });

    const content = `
      <div class="modal-header"><h2>Agregar Tipo de Gasto</h2></div>
      <div id="formError"></div>
      <form id="agregarTipoGastoForm">
        <div class="form-group">
          <label for="nuevoConcepto">Nombre del Tipo de Gasto <span style="color: #ef4444;">*</span></label>
          <input type="text" id="nuevoConcepto" placeholder="Ej: Seguros, Capacitaciones" required>
        </div>
        <div class="form-group">
          <label for="nuevaCuentaContableId">Cuenta Contable <span style="color: #ef4444;">*</span></label>
          <select id="nuevaCuentaContableId" required>
            ${Object.keys(porTipo).map(tipo => `
              <optgroup label="${tipo}">
                ${porTipo[tipo].map(c => `<option value="${c.id}">${c.codigo} - ${c.nombre}</option>`).join('')}
              </optgroup>
            `).join('')}
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Agregar</button>
        </div>
      </form>
    `;

    App.openModal(content);
    Combobox.attach('nuevaCuentaContableId');

    document.getElementById('agregarTipoGastoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const concepto = document.getElementById('nuevoConcepto').value.trim();
      const cuentaContableId = parseInt(document.getElementById('nuevaCuentaContableId').value, 10);

      try {
        const response = await window.api.mapeoContable.crear('Gasto', concepto, cuentaContableId);
        if (response.success) {
          App.closeModal();
          this.loadMapeo();
          App.toast('Tipo de gasto agregado con éxito');
        } else {
          document.getElementById('formError').innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        document.getElementById('formError').innerHTML = '<div class="error-message">Error al agregar el tipo de gasto</div>';
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
      <div id="asientosTableContent">${App.renderSkeletonTable()}</div>
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
            <th>Tipo</th>
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
              <td style="font-size:0.82rem;">${a.tipo_comprobante || nombresOrigen[a.tipo_origen] || a.tipo_origen}</td>
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
          ${asiento.estado === 'Activo' && asiento.tipo_origen === 'Manual' ? `<button class="btn btn-warning" onclick="App.closeModal(); Contabilidad.showRevertirAsientoModal(${asiento.id})">Revertir</button>` : ''}
          ${asiento.estado === 'Activo' && asiento.tipo_origen !== 'Manual' ? `<p style="font-size: 0.8rem; color: #64748b;">Este asiento se generó automáticamente. Para revertirlo, anule el documento que lo originó desde su propio módulo (Gastos, Recibos o Caja).</p>` : ''}
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

    const TIPOS_COMPROBANTE = [
      'Asiento Contable',
      'Nota de Contabilidad',
      'Nota de Crédito',
      'Nota de Débito',
      'Nota de Depreciación',
      'Nota de Amortización',
      'Comprobante de Nómina',
      'Ajuste de Inventario'
    ];

    const content = `
      <div class="modal-header"><h2>Nueva Nota Contable</h2></div>
      <div id="formError"></div>
      <form id="asientoManualForm">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label for="am_fecha">Fecha <span style="color: #ef4444;">*</span></label>
            <input type="date" id="am_fecha" name="am_fecha" value="${hoy}" required>
          </div>
          <div class="form-group">
            <label for="am_tipo_comprobante">Tipo de comprobante <span style="color: #ef4444;">*</span></label>
            <select id="am_tipo_comprobante" class="form-control">
              ${TIPOS_COMPROBANTE.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label for="am_concepto">Concepto <span style="color: #ef4444;">*</span></label>
          <input type="text" id="am_concepto" name="am_concepto" placeholder="Ej: Ajuste por depreciación de equipo de bombeo" required>
        </div>

        <table style="width: 100%;" id="lineasAsientoTable">
          <thead><tr><th>Cuenta Contable</th><th style="width:120px;">Débito</th><th style="width:120px;">Crédito</th><th style="width:230px;">Tercero (opcional)</th><th style="width:44px;"></th></tr></thead>
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

    App.openModal(content, 'xlarge');

    this.agregarLineaAsiento();
    this.agregarLineaAsiento();

    document.getElementById('btnAgregarLinea').addEventListener('click', () => this.agregarLineaAsiento());

    App.protegerEnvioDoble(document.getElementById('asientoManualForm'), async () => {
      const lineas = Array.from(document.querySelectorAll('#lineasAsientoBody tr')).map(fila => ({
        cuentaContableId: parseInt(fila.querySelector('.linea-cuenta').value, 10),
        debito: App.parseMoneyValue(fila.querySelector('.linea-debito').value),
        credito: App.parseMoneyValue(fila.querySelector('.linea-credito').value),
        terceroIdentificacion: fila.querySelector('.linea-tercero-id').value.trim() || null,
        terceroNombre: fila.querySelector('.linea-tercero-nombre').value.trim() || null
      }));

      try {
        const response = await window.api.asientos.crearManual({
          fecha: document.getElementById('am_fecha').value,
          tipoComprobante: document.getElementById('am_tipo_comprobante').value,
          concepto: document.getElementById('am_concepto').value.trim(),
          lineas,
          opId: crypto.randomUUID()
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
      <td>
        <input type="text" class="linea-tercero-id" placeholder="Identificación" style="width: 100%; margin-bottom: 4px;">
        <input type="text" class="linea-tercero-nombre" placeholder="Nombre" style="width: 100%;">
      </td>
      <td><button type="button" class="btn btn-danger btn-icon" onclick="this.closest('tr').remove(); Contabilidad.actualizarBalanceAsiento();">✕</button></td>
    `;

    tbody.appendChild(fila);
    Combobox.attach(fila.querySelector('.linea-cuenta'));

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

    // Las tarjetas destacadas duplican la de su categoría pero con un idSufijo propio (prefijo
    // "d_"): son el mismo reporte, pero necesitan ids de DOM distintos para no chocar con los
    // inputs de la tarjeta original más abajo en la página.
    const destacados = [];
    this.gruposReportes.forEach((grupo, gi) => {
      grupo.reportes.forEach((r, ri) => {
        if (r.destacado) destacados.push(this.renderCard(r, `d_${gi}_${ri}`, { destacado: true }));
      });
    });

    let html = '';
    if (destacados.length > 0) {
      html += `
        <div style="padding: 16px 20px;">
          <h3 style="margin: 0 0 12px 0; color: #334155; font-size: 1rem;">Más usados</h3>
          <div class="reportes-grid reportes-grid-destacados">
            ${destacados.join('')}
          </div>
        </div>
      `;
    }

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

    if (this.gruposReportes.some(g => g.reportes.some(r => r.filtroCuentaContable || r.requiereCuentaContable || r.rangoCuentaContable))) {
      await this.cargarCuentasContables();
    }

    if (this.gruposReportes.some(g => g.reportes.some(r => r.filtroTercero))) {
      await this.cargarTercerosParaFiltro();
    }
  },

  // Sugerencias (datalist) para el filtro de tercero de los reportes que lo soportan: sigue
  // siendo texto libre (el backend busca por coincidencia parcial de nombre o identificación,
  // ver AsientoContableRepository.getBalancePruebaPorTercero), pero así se evitan errores de
  // tipeo al escribir el nombre o identificación de un tercero que ya está en el catálogo.
  async cargarTercerosParaFiltro() {
    try {
      const response = await window.api.terceros.getAll({});
      const terceros = response.success ? response.data : [];
      const datalist = document.getElementById('tercerosSugeridos');
      if (datalist) {
        datalist.innerHTML = terceros.map(t => `<option value="${t.nombre_razon_social}">${t.numero_identificacion}</option>`).join('');
      }
    } catch (error) {
      console.error('Error al cargar terceros para el filtro:', error);
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
      const textoPlaceholder = select.dataset.placeholder || 'Todas las cuentas contables';
      const opcionTodas = select.dataset.requerida === 'true' ? '' : `<option value="">${textoPlaceholder}</option>`;
      select.innerHTML = `
        ${opcionTodas}
        ${this.cuentasContables.map(c => `<option value="${c.id}">${c.codigo} - ${c.nombre}</option>`).join('')}
      `;
    });
  },

  renderCard(reporte, idSufijo, opciones = {}) {
    const hoy = new Date().toISOString().split('T')[0];
    const inicioMes = new Date();
    inicioMes.setDate(1);
    const inicioMesStr = inicioMes.toISOString().split('T')[0];

    // Filtros "avanzados": opcionales y menos usados que el rango de fechas, se ocultan detrás
    // de "Más filtros" para que la tarjeta no se vea como un formulario completo de entrada.
    // La cuenta contable obligatoria (Libro Mayor) y el filtro de tercero (la razón de ser de
    // ese reporte) se quedan siempre visibles.
    const filtrosAvanzados = `
      ${reporte.filtroCuentaContable ? `
        <select id="cuentaContable_${idSufijo}" data-select-cuenta-contable style="width: 100%; margin-bottom: 8px;">
          <option value="">Todas las cuentas contables</option>
        </select>
      ` : ''}
      ${reporte.filtroTipoCuenta ? `
        <select id="tipoCuenta_${idSufijo}" style="width: 100%; margin-bottom: 8px;">
          <option value="">Todos los tipos de cuenta</option>
          <option value="Activo">Activo</option>
          <option value="Pasivo">Pasivo</option>
          <option value="Patrimonio">Patrimonio</option>
          <option value="Ingreso">Ingreso</option>
          <option value="Gasto">Gasto</option>
          <option value="Costo">Costo</option>
        </select>
      ` : ''}
      ${reporte.rangoCuentaContable ? `
        <div style="display: flex; gap: 8px;">
          <select id="cuentaDesde_${idSufijo}" data-select-cuenta-contable data-placeholder="Cuenta desde (todas)" style="width: 50%;">
            <option value="">Cuenta desde (todas)</option>
          </select>
          <select id="cuentaHasta_${idSufijo}" data-select-cuenta-contable data-placeholder="Cuenta hasta (todas)" style="width: 50%;">
            <option value="">Cuenta hasta (todas)</option>
          </select>
        </div>
      ` : ''}
    `;
    const tieneFiltrosAvanzados = !!(reporte.filtroCuentaContable || reporte.filtroTipoCuenta || reporte.rangoCuentaContable);

    return `
      <div class="reporte-card${opciones.destacado ? ' reporte-card-destacado' : ''}">
        <div class="reporte-card-icon">${renderIcon(reporte.icon)}</div>
        <div class="reporte-card-titulo">${reporte.titulo}</div>
        <p class="reporte-card-descripcion">${reporte.descripcion || ''}</p>
        ${reporte.rangoFecha ? `
          <div class="reporte-card-fechas">
            <input type="date" id="desde_${idSufijo}" value="${inicioMesStr}">
            <input type="date" id="hasta_${idSufijo}" value="${hoy}">
          </div>
        ` : ''}
        ${reporte.fechaCorte ? `
          <div class="reporte-card-fechas">
            <input type="date" id="corte_${idSufijo}" value="${hoy}" title="Fecha de corte">
          </div>
        ` : ''}
        ${reporte.requiereCuentaContable ? `
          <select id="cuentaContable_${idSufijo}" data-select-cuenta-contable data-requerida="true" style="width: 100%; margin-bottom: 8px;" required>
            <option value="">Seleccione una cuenta contable</option>
          </select>
        ` : ''}
        ${reporte.filtroTercero ? `
          <input type="text" id="tercero_${idSufijo}" list="tercerosSugeridos" placeholder="Identificación o nombre del tercero (opcional)" style="width: 100%; padding: 6px 10px; border: 1px solid var(--gray-300); border-radius: 6px; font-size: 12px;">
          <datalist id="tercerosSugeridos"></datalist>
        ` : ''}
        ${tieneFiltrosAvanzados ? `
          <button type="button" class="reporte-card-mas-filtros" onclick="Contabilidad.toggleFiltrosAvanzados('${idSufijo}')">Más filtros ▾</button>
          <div class="reporte-card-filtros-avanzados" id="filtrosAvanzados_${idSufijo}">${filtrosAvanzados}</div>
        ` : ''}
        <div class="reporte-card-actions">
          <button class="btn btn-primary" id="btnVistaPrevia_${idSufijo}" onclick="Contabilidad.buscarReporte('${idSufijo}')">Vista previa</button>
        </div>
      </div>
    `;
  },

  toggleFiltrosAvanzados(idSufijo) {
    document.getElementById(`filtrosAvanzados_${idSufijo}`).classList.toggle('open');
  },

  obtenerReportePorSufijo(idSufijo) {
    const [gi, ri] = idSufijo.replace(/^d_/, '').split('_').map(Number);
    return this.gruposReportes[gi].reportes[ri];
  },

  // Centraliza la lectura de los filtros de una tarjeta de reporte; la usan tanto la vista
  // previa en pantalla (Buscar) como la exportación a PDF/Excel, para que ambas manden
  // exactamente los mismos parámetros. Devuelve null si falta un filtro obligatorio (y ya
  // mostró el aviso correspondiente).
  obtenerParametrosReporte(idSufijo, reporte) {
    const params = {};

    if (reporte.rangoFecha) {
      params.fechaDesde = document.getElementById(`desde_${idSufijo}`).value;
      params.fechaHasta = document.getElementById(`hasta_${idSufijo}`).value;
    }

    if (reporte.fechaCorte) {
      params.fechaCorte = document.getElementById(`corte_${idSufijo}`).value;
    }

    if (reporte.filtroCuentaContable || reporte.requiereCuentaContable) {
      params.cuentaContableId = document.getElementById(`cuentaContable_${idSufijo}`).value;
      if (reporte.requiereCuentaContable && !params.cuentaContableId) {
        App.toast('Debe seleccionar una cuenta contable', 'error');
        return null;
      }
    }

    if (reporte.filtroTipoCuenta) {
      params.tipoCuenta = document.getElementById(`tipoCuenta_${idSufijo}`).value;
    }

    if (reporte.rangoCuentaContable) {
      const idDesde = document.getElementById(`cuentaDesde_${idSufijo}`).value;
      const idHasta = document.getElementById(`cuentaHasta_${idSufijo}`).value;
      const cuentaDesde = (this.cuentasContables || []).find(c => String(c.id) === idDesde);
      const cuentaHasta = (this.cuentasContables || []).find(c => String(c.id) === idHasta);
      params.cuentaCodigoDesde = cuentaDesde ? cuentaDesde.codigo : '';
      params.cuentaCodigoHasta = cuentaHasta ? cuentaHasta.codigo : '';
    }

    if (reporte.filtroTercero) {
      params.terceroQuery = document.getElementById(`tercero_${idSufijo}`).value.trim();
    }

    return params;
  },

  // La vista previa pide al backend el HTML YA ARMADO (PlantillaReporteService) — el mismo
  // documento que produce el PDF, no una reimplementación aparte — y lo muestra en un iframe
  // dentro del modal (igual que los formularios de Cuenta/Propietario, pero con todo el ancho
  // disponible: una tabla con muchas columnas no cabe en el ancho angosto de una tarjeta).
  async buscarReporte(idSufijo) {
    const reporte = this.obtenerReportePorSufijo(idSufijo);
    const params = this.obtenerParametrosReporte(idSufijo, reporte);
    if (!params) return;

    const boton = document.getElementById(`btnVistaPrevia_${idSufijo}`);
    const textoOriginal = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Buscando...';

    try {
      const response = await window.api.reportes.getVistaPreviaHTML(reporte.tipo, params);
      if (!response.success) {
        App.toast('Error al generar la vista previa: ' + response.error, 'error');
        return;
      }
      this.mostrarVistaPrevia(idSufijo, reporte, response.data);
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al generar la vista previa', 'error');
    } finally {
      boton.disabled = false;
      boton.textContent = textoOriginal;
    }
  },

  mostrarVistaPrevia(idSufijo, reporte, html) {
    const content = `
      <div class="modal-header"><h2>${reporte.titulo}</h2></div>
      <iframe class="reporte-preview-frame" srcdoc="${App.escapeAttr(html)}"></iframe>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
        <button type="button" class="btn btn-secondary btn-icon" onclick="Contabilidad.exportarReporte('${idSufijo}', 'pdf')">Exportar PDF</button>
        <button type="button" class="btn btn-success btn-icon" onclick="Contabilidad.exportarReporte('${idSufijo}', 'excel')">Exportar Excel</button>
      </div>
    `;
    // 'xlarge' en vez de 'large': estos reportes pueden traer tablas con muchas columnas
    // (Libro Diario, Historial de Pagos con todos sus filtros, etc.) y un ancho fijo de 900px
    // las dejaba con scroll horizontal aunque la pantalla tuviera espacio de sobra.
    App.openModal(content, 'xlarge');

    const iframe = document.querySelector('.reporte-preview-frame');
    iframe.addEventListener('load', () => {
      iframe.style.height = iframe.contentWindow.document.documentElement.scrollHeight + 'px';
    });
  },

  async exportarReporte(idSufijo, formato) {
    const reporte = this.obtenerReportePorSufijo(idSufijo);
    const params = this.obtenerParametrosReporte(idSufijo, reporte);
    if (!params) return;

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
  },

  // --- Plantillas de Contabilización ---

  async loadPlantillas() {
    const body = document.getElementById('contabilidadBody');
    body.innerHTML = `<div style="padding:24px;">${App.renderSkeletonTable()}</div>`;
    try {
      const res = await window.api.plantillas.getAll();
      if (!res.success) { App.toast('Error: ' + res.error, 'error'); return; }
      this.renderPlantillas(res.data);
    } catch (e) { console.error(e); App.toast('Error al cargar plantillas', 'error'); }
  },

  renderPlantillas(plantillas) {
    const body = document.getElementById('contabilidadBody');
    const MODULO_LABELS = { Gasto: 'Gasto', Recibo: 'Recibo', Movimiento: 'Movimiento', Manual: 'Manual' };
    const filas = plantillas.map(p => `
      <tr>
        <td><strong>${p.codigo}</strong><br><small style="color:#64748b;">v${p.version}</small></td>
        <td>${p.nombre}</td>
        <td><span class="badge badge-info">${MODULO_LABELS[p.modulo] || p.modulo}</span></td>
        <td>${p.subtipo || '<span style="color:#94a3b8;">—</span>'}</td>
        <td style="font-size:0.8rem;color:#64748b;">${p.fecha_desde}${p.fecha_hasta ? ' → ' + p.fecha_hasta : ' → vigente'}</td>
        <td>${p.lineas ? p.lineas.length : 0} líneas</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-secondary btn-sm" onclick="Contabilidad.verPlantilla(${p.id})">Ver / Editar</button>
          <button class="btn btn-secondary btn-sm" style="margin-left:4px;" onclick="Contabilidad.abrirSimulacion(${p.id}, '${p.nombre.replace(/'/g, "\\'")}')">Simular</button>
        </td>
      </tr>
    `).join('');

    body.innerHTML = `
      <div style="padding:24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <div>
            <h2 style="margin:0;color:#1e293b;">Plantillas de Contabilización</h2>
            <p style="margin:4px 0 0;color:#64748b;font-size:0.875rem;">Define el patrón de asiento para cada tipo de operación. Modificar una plantilla crea una nueva versión sin alterar asientos históricos.</p>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead><tr>
              <th>Código / Versión</th><th>Nombre</th><th>Módulo</th><th>Subtipo</th><th>Vigencia</th><th>Líneas</th><th>Acciones</th>
            </tr></thead>
            <tbody>${filas || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">No hay plantillas registradas</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  },

  async verPlantilla(id) {
    const res = await window.api.plantillas.getById(id);
    if (!res.success) { App.toast('Error: ' + res.error, 'error'); return; }
    const p = res.data;

    const TIPO_CUENTA = {
      cuenta_fija_id: 'Cuenta fija PUC',
      cuenta_automatica_clave: 'Cuenta automática',
      cuenta_mapeo_modulo: 'Mapeo conceptos',
      cuenta_contexto_campo: 'Campo del documento'
    };

    const filaLineas = p.lineas.map((l, i) => {
      let cuentaDesc = '';
      if (l.cuenta_fija_id)          cuentaDesc = `Fija ID: ${l.cuenta_fija_id}`;
      if (l.cuenta_automatica_clave) cuentaDesc = `Automática: <strong>${l.cuenta_automatica_clave}</strong>`;
      if (l.cuenta_mapeo_modulo)     cuentaDesc = `Mapeo: ${l.cuenta_mapeo_modulo} → [${l.cuenta_mapeo_campo}]`;
      if (l.cuenta_contexto_campo)   cuentaDesc = `Campo doc: <em>${l.cuenta_contexto_campo}</em>`;

      const expansionBadge = l.tipo_expansion === 'Expansion'
        ? `<span class="badge badge-info">Expansión (${l.expansion_fuente})</span>`
        : '';

      const condBadge = l.condicion_json
        ? `<span class="badge badge-warning" title="${l.condicion_json}">Condicional</span>`
        : '';

      const terceroBadge = (l.incluir_tercero_id || l.incluir_propietario_id || l.incluir_snapshot_nombre)
        ? `<span class="badge" style="background:#e0f2fe;color:#0369a1;">Tercero</span>`
        : '';

      return `<tr>
        <td style="text-align:center;">${l.orden}</td>
        <td>${expansionBadge || cuentaDesc}</td>
        <td>${l.expansion_monto_campo ? `campo: ${l.expansion_monto_campo}` : `${l.tipo_monto}: ${l.monto_campo || l.monto_fijo || ''}`}</td>
        <td><strong>${l.tipo_expansion === 'Expansion' ? l.expansion_lado_formula : l.lado}</strong></td>
        <td>${condBadge} ${terceroBadge}</td>
        <td style="color:#64748b;font-size:0.8rem;">${l.descripcion_linea || ''}</td>
      </tr>`;
    }).join('');

    const esSistema = p.es_sistema === 1;

    App.openModal(`
      <div class="modal-header"><h2>${p.nombre} <small style="font-weight:normal;color:#64748b;">v${p.version}</small></h2></div>
      <div style="margin-bottom:12px;font-size:0.875rem;color:#64748b;">
        Módulo: <strong>${p.modulo}</strong> · Subtipo: <strong>${p.subtipo || '—'}</strong> ·
        Código: <code>${p.codigo}</code> · Vigencia: ${p.fecha_desde} → ${p.fecha_hasta || 'vigente'}
        ${esSistema ? ' · <span class="badge badge-warning">Sistema</span>' : ''}
      </div>
      <table class="data-table" style="margin-bottom:20px;">
        <thead><tr><th>#</th><th>Cuenta</th><th>Monto</th><th>Lado</th><th>Flags</th><th>Descripción</th></tr></thead>
        <tbody>${filaLineas}</tbody>
      </table>
      <div style="text-align:right;">
        <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
        <button class="btn btn-primary" style="margin-left:8px;" onclick="Contabilidad.abrirSimulacion(${p.id}, '${p.nombre.replace(/'/g, "\\'")}')">Simular</button>
      </div>
    `, 'large');
  },

  abrirSimulacion(plantillaId, nombrePlantilla) {
    const ejemplos = {
      1: '{"fecha":"2025-01-15","concepto":"Compra materiales","valor":500000,"metodo_pago":"Efectivo","cuenta_contable_id":1,"tercero_id":null,"tercero_nombre":"Proveedor Ejemplo","tercero_identificacion":"900123456"}',
      2: '{"fecha":"2025-01-15","concepto":"Servicio técnico","valor":800000,"metodo_pago":"Banco","cuenta_contable_id":1,"tercero_id":null,"tercero_nombre":"Proveedor Ejemplo","tercero_identificacion":"900123456"}',
      3: '{"fecha":"2025-01-15","numero_recibo":"1001","total":120000,"metodo_pago":"Efectivo","propietario_id":1,"tercero_nombre":"Juan Pérez","tercero_identificacion":"12345678","detalles":[{"concepto":"Sostenimiento","valor":120000,"cuenta_contable_id":5}]}',
      5: '{"fecha":"2025-01-15","concepto":"Consignación","monto":500000,"tipo":"Traslado","origen":"Caja","destino":"Banco"}'
    };
    const ejemploCtx = ejemplos[plantillaId] || '{}';

    App.openModal(`
      <div class="modal-header"><h2>Simular: ${nombrePlantilla}</h2></div>
      <p style="font-size:0.875rem;color:#64748b;margin-bottom:12px;">
        Ingresa el contexto del documento en formato JSON. El motor generará el asiento resultante
        <strong>sin registrar ningún dato en la base de datos</strong>.
      </p>
      <div class="form-group">
        <label for="simCtxJson">Contexto (JSON)</label>
        <textarea id="simCtxJson" class="form-control" rows="8" style="font-family:monospace;font-size:0.8rem;">${ejemploCtx}</textarea>
      </div>
      <div style="text-align:right;margin-bottom:16px;">
        <button class="btn btn-primary" onclick="Contabilidad.ejecutarSimulacion(${plantillaId})">Ejecutar simulación</button>
        <button class="btn btn-secondary" style="margin-left:8px;" onclick="App.closeModal()">Cancelar</button>
      </div>
      <div id="simResultado"></div>
    `, 'large');
  },

  async ejecutarSimulacion(plantillaId) {
    const textarea = document.getElementById('simCtxJson');
    const resultDiv = document.getElementById('simResultado');
    if (!textarea || !resultDiv) return;

    resultDiv.innerHTML = '<p style="color:#64748b;">Ejecutando...</p>';

    let contexto;
    try {
      contexto = JSON.parse(textarea.value);
    } catch {
      resultDiv.innerHTML = '<p style="color:#dc2626;"><strong>Error:</strong> El JSON no es válido. Verifica la sintaxis.</p>';
      return;
    }

    const res = await window.api.plantillas.simularContabilizacion(plantillaId, contexto);
    if (!res.success) {
      resultDiv.innerHTML = `<p style="color:#dc2626;"><strong>Error del motor:</strong> ${res.error}</p>`;
      return;
    }

    const { lineas, totalDebito, totalCredito, balanceado } = res.data;
    const fmt = n => Number(n || 0).toLocaleString('es-CO');

    const filasLineas = lineas.map((l, i) => `
      <tr>
        <td>${i + 1}</td>
        <td style="font-size:0.8rem;">${l.cuentaContableId}</td>
        <td class="text-right">${l.debito  > 0 ? '$' + fmt(l.debito)  : ''}</td>
        <td class="text-right">${l.credito > 0 ? '$' + fmt(l.credito) : ''}</td>
        <td style="font-size:0.75rem;color:#64748b;">${l.terceroNombre || l.propietarioId ? (l.terceroNombre || '') : ''}</td>
      </tr>
    `).join('');

    const estadoBalance = balanceado
      ? '<span style="color:#16a34a;font-weight:bold;">✓ Balanceado</span>'
      : '<span style="color:#dc2626;font-weight:bold;">✗ Desbalanceado</span>';

    resultDiv.innerHTML = `
      <hr style="margin:16px 0;">
      <h3 style="margin:0 0 12px;font-size:1rem;">Resultado de la simulación ${estadoBalance}</h3>
      <table class="data-table" style="margin-bottom:8px;">
        <thead><tr><th>#</th><th>Cuenta ID</th><th class="text-right">Débito</th><th class="text-right">Crédito</th><th>Tercero</th></tr></thead>
        <tbody>${filasLineas}</tbody>
        <tfoot>
          <tr style="font-weight:bold;background:#f8fafc;">
            <td colspan="2">TOTALES</td>
            <td class="text-right">$${fmt(totalDebito)}</td>
            <td class="text-right">$${fmt(totalCredito)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <p style="font-size:0.75rem;color:#64748b;">Los IDs de cuenta se muestran por brevedad. En producción se resolverán a las cuentas reales del PUC.</p>
    `;
  },

  // --- Impuestos ---

  async loadImpuestos() {
    const body = document.getElementById('contabilidadBody');
    body.innerHTML = `<div style="padding:24px;">${App.renderSkeletonTable()}</div>`;
    try {
      const res = await window.api.impuestos.getAll();
      if (!res.success) { App.toast('Error: ' + res.error, 'error'); return; }
      this.renderImpuestos(res.data);
    } catch (e) { console.error(e); App.toast('Error al cargar impuestos', 'error'); }
  },

  renderImpuestos(impuestos) {
    const body = document.getElementById('contabilidadBody');
    const TIPO_LABELS = { IVA: 'IVA', ReteFuente: 'Ret. Fuente', ReteIVA: 'Ret. IVA', ICA: 'ICA', Otro: 'Otro' };

    const filas = impuestos.length === 0
      ? '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:32px;">No hay impuestos configurados. Agrégalos cuando la asociación tenga obligaciones tributarias.</td></tr>'
      : impuestos.map(i => `
        <tr style="${i.activo ? '' : 'opacity:0.5;'}">
          <td><strong>${i.codigo}</strong></td>
          <td>${i.nombre}</td>
          <td><span class="badge badge-info">${TIPO_LABELS[i.tipo] || i.tipo}</span></td>
          <td style="text-align:right;">${i.porcentaje}%</td>
          <td style="font-size:0.8rem;">${i.cuenta_codigo} – ${i.cuenta_nombre}<br><small style="color:#64748b;">${i.lado_ajuste === 'Debito' ? 'Divide el gasto (débito)' : 'Divide el pago (crédito)'}</small></td>
          <td><span class="badge ${i.activo ? 'badge-success' : ''}" style="${!i.activo ? 'background:#f1f5f9;color:#94a3b8;' : ''}">${i.activo ? 'Activo' : 'Inactivo'}</span></td>
          <td style="white-space:nowrap;">
            <button class="btn btn-secondary btn-sm" onclick="Contabilidad.editarImpuesto(${i.id})">Editar</button>
            <button class="btn btn-secondary btn-sm" style="margin-left:4px;" onclick="Contabilidad.toggleImpuesto(${i.id})">${i.activo ? 'Desactivar' : 'Activar'}</button>
          </td>
        </tr>
      `).join('');

    body.innerHTML = `
      <div style="padding:24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <div>
            <h2 style="margin:0;color:#1e293b;">Impuestos</h2>
            <p style="margin:4px 0 0;color:#64748b;font-size:0.875rem;">Motor tributario: configura IVA, ReteFuente, ICA y otros impuestos. Se activan asignando un impuesto a una plantilla de contabilización.</p>
          </div>
          <button class="btn btn-primary" onclick="Contabilidad.editarImpuesto(null)">+ Nuevo Impuesto</button>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>%</th><th>Cuenta / Afecta</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      </div>
    `;
  },

  async editarImpuesto(id) {
    let imp = null;
    if (id) {
      const res = await window.api.impuestos.getById(id);
      if (!res.success) { App.toast('Error: ' + res.error, 'error'); return; }
      imp = res.data;
    }

    const TIPOS = ['IVA', 'ReteFuente', 'ReteIVA', 'ICA', 'Otro'];
    const optTipos = TIPOS.map(t => `<option value="${t}" ${imp?.tipo === t ? 'selected' : ''}>${t}</option>`).join('');

    App.openModal(`
      <div class="modal-header"><h2>${id ? 'Editar' : 'Nuevo'} Impuesto</h2></div>
      <form id="frmImpuesto">
        <div class="form-group">
          <label>Código <small style="color:#64748b;">(único, ej: IVA_19)</small></label>
          <input type="text" id="impCodigo" class="form-control" value="${imp?.codigo || ''}" required ${id ? 'readonly' : ''}>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label>Nombre</label>
            <input type="text" id="impNombre" class="form-control" value="${imp?.nombre || ''}" required>
          </div>
          <div class="form-group">
            <label>Tipo</label>
            <select id="impTipo" class="form-control">${optTipos}</select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label>Porcentaje (%)</label>
            <input type="number" id="impPorcentaje" class="form-control" value="${imp?.porcentaje || ''}" min="0.01" max="100" step="0.01" required>
          </div>
          <div class="form-group">
            <label>Campo base <small style="color:#64748b;">(campo del contexto)</small></label>
            <input type="text" id="impBaseCampo" class="form-control" value="${imp?.base_campo || 'valor'}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;">
          <div class="form-group">
            <label>Cuenta del impuesto (ID PUC) <small style="color:#64748b;">ej: 2408 IVA por Descontar, 2365 ReteFuente x Pagar</small></label>
            <input type="number" id="impCuentaId" class="form-control" value="${imp?.cuenta_id || ''}" required>
          </div>
          <div class="form-group">
            <label>Lado que afecta</label>
            <select id="impLadoAjuste" class="form-control">
              <option value="Credito" ${(imp?.lado_ajuste || 'Credito') === 'Credito' ? 'selected' : ''}>Crédito – ReteFuente / ICA (divide el pago)</option>
              <option value="Debito"  ${imp?.lado_ajuste === 'Debito' ? 'selected' : ''}>Débito – IVA descontable (divide el gasto)</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `, 'medium');

    document.getElementById('frmImpuesto').addEventListener('submit', async (e) => {
      e.preventDefault();
      const datos = {
        codigo:           document.getElementById('impCodigo').value.trim().toUpperCase(),
        nombre:           document.getElementById('impNombre').value.trim(),
        tipo:             document.getElementById('impTipo').value,
        porcentaje:       parseFloat(document.getElementById('impPorcentaje').value),
        cuentaId:    parseInt(document.getElementById('impCuentaId').value),
        ladoAjuste:  document.getElementById('impLadoAjuste').value,
        baseCampo:   document.getElementById('impBaseCampo').value.trim() || 'valor'
      };

      const res = id
        ? await window.api.impuestos.update(id, datos)
        : await window.api.impuestos.create(datos);

      if (!res.success) { App.toast('Error: ' + res.error, 'error'); return; }
      App.closeModal();
      App.toast(id ? 'Impuesto actualizado' : 'Impuesto creado', 'success');
      await this.loadImpuestos();
    });
  },

  async toggleImpuesto(id) {
    const res = await window.api.impuestos.toggleActivo(id);
    if (!res.success) { App.toast('Error: ' + res.error, 'error'); return; }
    App.toast(`Impuesto ${res.data.activo ? 'activado' : 'desactivado'}`, 'success');
    await this.loadImpuestos();
  }
};
