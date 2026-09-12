// Módulo de Cuentas
const Cuentas = {
  currentPage: 1,
  limit: 10,
  search: '',
  estado: '',
  categoria: '',

  async load() {
    // Se reinicia cada vez que se entra al módulo (no solo la primera vez): sin esto, el buscador
    // y los filtros quedaban visualmente vacíos tras salir y volver a entrar, pero el listado
    // seguía filtrado por lo último buscado (ej. una cuenta puntual), sin ningún indicio en
    // pantalla de por qué el listado se veía incompleto.
    this.currentPage = 1;
    this.search = '';
    this.estado = '';
    this.categoria = '';

    const categorias = await this.getCategoriasOptions();
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Cuentas / Predios</h1>
        <p>Gestión de cuentas del acueducto</p>
      </div>

      <div class="stats-grid" id="cuentasStatsGrid"></div>

      <div class="table-container">
        <div class="table-header">
          <h2>Listado de Cuentas</h2>
          <div class="table-controls">
            <input type="text" id="searchInput" class="search-box" placeholder="Buscar por código, dirección, propietario o identificación...">
            <select id="estadoFilter" class="filter-select">
              <option value="">Todos los estados</option>
              <option value="Activo">Activo</option>
              <option value="Inactivo">Inactivo</option>
              <option value="Suspendido">Suspendido</option>
            </select>
            <select id="categoriaFilter" class="filter-select">
              <option value="">Todas las categorías</option>
              ${categorias.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('')}
            </select>
            <button class="btn btn-primary" id="btnNuevaCuenta">+ Nueva Cuenta</button>
          </div>
        </div>

        <div id="tableContent">
          ${App.renderSkeletonTable()}
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadStats();
    await this.loadCuentas();
  },

  async loadStats() {
    const grid = document.getElementById('cuentasStatsGrid');
    try {
      const response = await window.api.cuentas.getStats();
      if (!response.success) {
        console.error('Error al cargar métricas de cuentas:', response.error);
        return;
      }
      const { total, activas, suspendidas, enMora } = response.data;
      grid.innerHTML = App.renderStatsGrid([
        { titulo: 'Total Cuentas', valor: total, icono: 'home' },
        { titulo: 'Activas', valor: activas, icono: 'tag' },
        { titulo: 'Suspendidas', valor: suspendidas, icono: 'fileText' },
        { titulo: 'En Mora', valor: enMora, icono: 'trendingDown' }
      ]);
    } catch (error) {
      console.error('Error:', error);
    }
  },

  async getCategoriasOptions() {
    try {
      const response = await window.api.categorias.getAll({ soloActivas: true });
      return response.success ? response.data : [];
    } catch (error) {
      console.error('Error al cargar categorías:', error);
      return [];
    }
  },

  setupEventListeners() {
    document.getElementById('searchInput').addEventListener('input', App.debounce((e) => {
      this.search = e.target.value;
      this.currentPage = 1;
      this.loadCuentas();
    }));

    document.getElementById('estadoFilter').addEventListener('change', (e) => {
      this.estado = e.target.value;
      this.currentPage = 1;
      this.loadCuentas();
    });

    document.getElementById('categoriaFilter').addEventListener('change', (e) => {
      this.categoria = e.target.value;
      this.currentPage = 1;
      this.loadCuentas();
    });

    document.getElementById('btnNuevaCuenta').addEventListener('click', () => {
      this.showFormModal();
    });
  },

  async loadCuentas() {
    try {
      const response = await window.api.cuentas.getAll({
        page: this.currentPage,
        limit: this.limit,
        search: this.search,
        estado: this.estado,
        categoria: this.categoria
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
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No se encontraron cuentas</p>';
      return;
    }

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Dirección</th>
            <th>Nombre de Predio</th>
            <th>Propietario</th>
            <th>Categoría</th>
            <th>Estado</th>
            <th>Fecha Creación</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(cuenta => `
            <tr>
              <td><strong>${cuenta.codigo}</strong></td>
              <td>${cuenta.direccion}</td>
              <td>${cuenta.nombre_predio || '-'}</td>
              <td>${cuenta.propietario_actual || '<em>Sin asignar</em>'}</td>
              <td>${cuenta.categoria_actual || '<em>Sin asignar</em>'}</td>
              <td><span class="badge badge-${cuenta.estado.toLowerCase()}">${cuenta.estado}</span></td>
              <td>${this.formatDate(cuenta.fecha_creacion)}</td>
              <td>
                <div class="table-actions">
                  <button class="btn btn-primary btn-icon" onclick="Cuentas.showDetailModal(${cuenta.id})">Ver</button>
                  <button class="btn btn-secondary btn-icon" onclick="Cuentas.showFormModal(${cuenta.id})">Editar</button>
                  <button class="btn btn-info btn-icon" onclick="Cuentas.showCambiarCategoriaModal(${cuenta.id})">Categoría</button>
                  ${cuenta.estado !== 'Suspendido' ?
                    `<button class="btn btn-warning btn-icon" onclick="Cuentas.showSuspenderModal(${cuenta.id})">Suspender</button>` :
                    `<button class="btn btn-success btn-icon" onclick="Cuentas.showReactivarModal(${cuenta.id})">Activar</button>`
                  }
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${App.renderPagination(data.pagination, 'Cuentas')}
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

  async showDetailModal(id) {
    try {
      const response = await window.api.cuentas.getById(id);
      
      if (response.success) {
        const cuenta = response.data;

        const historialCategoriasResponse = await window.api.categorias.getHistorialCategoriasCuenta(id);
        const historialCategorias = historialCategoriasResponse.success ? historialCategoriasResponse.data : [];

        const historialPropietariosResponse = await window.api.propietarios.getHistorialPropietariosCuenta(id);
        const historialPropietarios = historialPropietariosResponse.success ? historialPropietariosResponse.data : [];

        const conexionesResponse = await window.api.nuevosPuntos.getByCuentaId(id);
        const conexiones = conexionesResponse.success ? conexionesResponse.data : [];
        const conexionActiva = conexiones.find(p => p.estado === 'Pendiente') || conexiones[0] || null;

        const content = `
          <div class="modal-header">
            <h2>Detalle de Cuenta</h2>
          </div>

          <div class="detail-section">
            <h3>Información General</h3>
            <div class="detail-row">
              <div class="detail-label">Código:</div>
              <div class="detail-value"><strong>${cuenta.codigo}</strong></div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Dirección:</div>
              <div class="detail-value">${cuenta.direccion}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Nombre de Predio:</div>
              <div class="detail-value">${cuenta.nombre_predio || '<em>Sin registrar</em>'}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Propietario Actual:</div>
              <div class="detail-value">${cuenta.propietario_actual || '<em>Sin asignar</em>'}${cuenta.propietario_identificacion ? ` (${cuenta.propietario_identificacion})` : ''}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Categoría Actual:</div>
              <div class="detail-value">${cuenta.categoria_actual || '<em>Sin asignar</em>'}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Estado:</div>
              <div class="detail-value"><span class="badge badge-${cuenta.estado.toLowerCase()}">${cuenta.estado}</span></div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Fecha Creación:</div>
              <div class="detail-value">${this.formatDate(cuenta.fecha_creacion)}</div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Última Actualización:</div>
              <div class="detail-value">${this.formatDate(cuenta.fecha_actualizacion)}</div>
            </div>
            ${cuenta.observaciones ? `
              <div class="detail-row">
                <div class="detail-label">Observaciones:</div>
                <div class="detail-value">${cuenta.observaciones}</div>
              </div>
            ` : ''}
          </div>

          <div class="detail-section">
            <h3>Ubicación</h3>
            <div class="detail-row">
              <div class="detail-label">Acometida (conexión de agua):</div>
              <div class="detail-value">
                ${cuenta.lat_acometida != null ? `
                  ${cuenta.lat_acometida}, ${cuenta.lon_acometida}
                  <button type="button" class="btn btn-secondary btn-icon" onclick="Cuentas.verEnMapa(${cuenta.lat_acometida}, ${cuenta.lon_acometida})">Ver en mapa</button>
                ` : '<em>Sin coordenadas registradas</em>'}
              </div>
            </div>
            <div class="detail-row">
              <div class="detail-label">Vivienda:</div>
              <div class="detail-value">
                ${cuenta.lat_vivienda != null ? `
                  ${cuenta.lat_vivienda}, ${cuenta.lon_vivienda}
                  <button type="button" class="btn btn-secondary btn-icon" onclick="Cuentas.verEnMapa(${cuenta.lat_vivienda}, ${cuenta.lon_vivienda})">Ver en mapa</button>
                ` : '<em>Sin coordenadas registradas</em>'}
              </div>
            </div>
          </div>

          <div class="detail-section">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3>Historial de Propietarios</h3>
              <button class="btn btn-secondary btn-icon" onclick="App.closeModal(); Cuentas.showCambiarPropietarioModal(${cuenta.id})">Cambiar Propietario</button>
            </div>
            ${historialPropietarios.length > 0 ? `
              <table style="width: 100%; margin-top: 12px;">
                <thead>
                  <tr><th>Propietario</th><th>Identificación</th><th>Desde</th><th>Hasta</th></tr>
                </thead>
                <tbody>
                  ${historialPropietarios.map(h => `
                    <tr>
                      <td>${h.nombre_completo}</td>
                      <td>${h.numero_identificacion || '-'}</td>
                      <td>${this.formatDate(h.fecha_inicio)}</td>
                      <td>${h.fecha_fin ? this.formatDate(h.fecha_fin) : '<strong>Actual</strong>'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : '<p style="color: #64748b; margin-top: 12px;">Sin historial de propietarios</p>'}
          </div>

          <div class="detail-section">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h3>Historial de Categorías</h3>
              <button class="btn btn-secondary btn-icon" onclick="App.closeModal(); Cuentas.showCambiarCategoriaModal(${cuenta.id})">Cambiar Categoría</button>
            </div>
            ${historialCategorias.length > 0 ? `
              <table style="width: 100%; margin-top: 12px;">
                <thead>
                  <tr><th>Categoría</th><th>Desde</th><th>Hasta</th></tr>
                </thead>
                <tbody>
                  ${historialCategorias.map(h => `
                    <tr>
                      <td>${h.nombre}</td>
                      <td>${this.formatDate(h.fecha_inicio)}</td>
                      <td>${h.fecha_fin ? this.formatDate(h.fecha_fin) : '<strong>Actual</strong>'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            ` : '<p style="color: #64748b; margin-top: 12px;">Sin historial de categorías</p>'}
          </div>

          <div class="detail-section">
            <h3>Conexión (Nuevo Punto)</h3>
            ${conexionActiva ? `
              <div class="detail-row">
                <div class="detail-label">Saldo Pendiente:</div>
                <div class="detail-value">
                  <strong>$${this.formatNumber(conexionActiva.saldo_pendiente)}</strong>
                  <span class="badge ${conexionActiva.estado === 'Pagado' ? 'badge-activo' : (conexionActiva.estado === 'Cancelado' ? 'badge-inactivo' : 'badge-mora')}" style="margin-left: 8px;">${conexionActiva.estado}</span>
                </div>
              </div>
              <p style="margin-top: 8px;"><a href="#" onclick="App.closeModal(); Pagos.showDetalleModal(${cuenta.id}); return false;">Ver y gestionar en Estado de Pagos →</a></p>
            ` : `
              <p style="color: #64748b; margin-top: 12px;">Sin cargo de conexión registrado.</p>
              <button class="btn btn-secondary btn-icon" onclick="App.closeModal(); Pagos.showAgregarConexionModal(${cuenta.id})">Agregar Cargo de Conexión</button>
            `}
          </div>

          <div class="form-actions">
            <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
            <button class="btn btn-primary" onclick="App.closeModal(); Cuentas.showFormModal(${cuenta.id})">Editar</button>
          </div>
        `;

        App.openModal(content, 'large');
      } else {
        App.toast('Error al cargar la cuenta: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar la cuenta', 'error');
    }
  },

  async showCambiarCategoriaModal(cuentaId) {
    const categorias = await this.getCategoriasOptions();
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Cambiar Categoría de Cuenta</h2>
      </div>

      <div id="formError"></div>

      <form id="cambiarCategoriaForm">
        <div class="form-group">
          <label for="nueva_categoria_id">Nueva Categoría <span style="color: #ef4444;">*</span></label>
          <select id="nueva_categoria_id" name="nueva_categoria_id" required>
            <option value="">Seleccione una categoría...</option>
            ${categorias.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label for="fecha_inicio_categoria">Fecha de Inicio <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_inicio_categoria" name="fecha_inicio_categoria" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_categoria">Observaciones</label>
          <textarea id="observaciones_categoria" name="observaciones_categoria"></textarea>
        </div>

        <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
            <strong>Nota:</strong> La categoría actual será finalizada automáticamente. El historial nunca se sobrescribe.
            Si la fecha es pasada, los meses ya cobrados con la tarifa vieja se corrigen automáticamente
            (con un ajuste visible en el detalle de la cuenta, sin tocar lo ya causado).
          </p>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Cambiar</button>
        </div>
      </form>
    `;

    App.openModal(content);

    // cartera.recategorizar (no categorias.asignarACuenta, retirado de acá 2026-08-29): a
    // diferencia de ese cambio simple de vigencia, este corrige por diferencia los meses ya
    // causados desde la fecha declarada -- sin esto, elegir una fecha pasada dejaba los cargos
    // ya emitidos con la tarifa de la categoría vieja, sin ningún aviso.
    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('cambiarCategoriaForm'), async () => {
      const categoriaId = parseInt(document.getElementById('nueva_categoria_id').value, 10);
      const fechaVigencia = document.getElementById('fecha_inicio_categoria').value;
      const observaciones = document.getElementById('observaciones_categoria').value.trim() || null;
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.cartera.recategorizar({
          cuentaId, categoriaId, fechaVigencia, observaciones, opId
        });

        if (response.success) {
          App.closeModal();
          this.loadCuentas();
          const { ajustes, totalAjustado } = response.data;
          App.toast(ajustes.length > 0
            ? `Categoría actualizada. Se corrigieron ${ajustes.length} ${ajustes.length === 1 ? 'mes' : 'meses'} ya cobrados (ajuste neto: $${this.formatNumber(totalAjustado)}).`
            : 'Categoría actualizada con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al cambiar la categoría</div>`;
      }
    });
  },

  async showCambiarPropietarioModal(cuentaId) {
    const propietariosResponse = await window.api.propietarios.getAll({ limit: 1000 });
    const propietarios = propietariosResponse.success ? propietariosResponse.data.data : [];
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Cambiar Propietario de Cuenta</h2>
      </div>

      <div id="formError"></div>

      <form id="cambiarPropietarioForm">
        <div class="form-group">
          <label for="nuevo_propietario_id">Nuevo Propietario <span style="color: #ef4444;">*</span></label>
          <select id="nuevo_propietario_id" name="nuevo_propietario_id" required>
            <option value="">Seleccione un propietario...</option>
            ${propietarios.map(p => `<option value="${p.id}">${p.nombre_completo}${p.numero_identificacion ? ' - ' + p.numero_identificacion : ''}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label for="fecha_inicio_propietario">Fecha de Inicio <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_inicio_propietario" name="fecha_inicio_propietario" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_propietario">Observaciones</label>
          <textarea id="observaciones_propietario" name="observaciones_propietario" placeholder="Ej: Compra de propiedad, herencia, etc."></textarea>
        </div>

        <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
            <strong>Nota:</strong> El propietario actual será finalizado automáticamente. El historial nunca se sobrescribe.
          </p>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Cambiar</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('cambiarPropietarioForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const propietarioId = document.getElementById('nuevo_propietario_id').value;
      const fechaInicio = document.getElementById('fecha_inicio_propietario').value;
      const observaciones = document.getElementById('observaciones_propietario').value.trim();

      try {
        const response = await window.api.propietarios.asignarACuenta(cuentaId, propietarioId, fechaInicio, observaciones);

        if (response.success) {
          App.closeModal();
          this.loadCuentas();
          App.toast('Propietario actualizado con éxito');
        } else {
          const errorDiv = document.getElementById('formError');
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        const errorDiv = document.getElementById('formError');
        errorDiv.innerHTML = `<div class="error-message">Error al cambiar el propietario</div>`;
      }
    });
  },

  async showFormModal(id = null) {
    let cuenta = null;
    
    if (id) {
      try {
        const response = await window.api.cuentas.getById(id);
        if (response.success) {
          cuenta = response.data;
        } else {
          App.toast('Error al cargar la cuenta: ' + response.error, 'error');
          return;
        }
      } catch (error) {
        console.error('Error:', error);
        App.toast('Error al cargar la cuenta', 'error');
        return;
      }
    }

    const content = `
      <div class="modal-header">
        <h2>${id ? 'Editar Cuenta' : 'Nueva Cuenta'}</h2>
      </div>

      <div id="formError"></div>

      <form id="cuentaForm">
        <div class="form-group">
          <label for="codigo">Código <span style="color: #ef4444;">*</span></label>
          <input type="text" id="codigo" name="codigo" value="${cuenta ? cuenta.codigo : ''}" required>
          <small style="color: #64748b; font-size: 0.875rem;">Código manual único de la cuenta</small>
        </div>

        <div class="form-group">
          <label for="direccion">Dirección <span style="color: #ef4444;">*</span></label>
          <input type="text" id="direccion" name="direccion" value="${cuenta ? cuenta.direccion : ''}" required>
        </div>

        <div class="form-group">
          <label for="nombre_predio">Nombre de Predio (opcional)</label>
          <input type="text" id="nombre_predio" name="nombre_predio" value="${cuenta?.nombre_predio ?? ''}" placeholder="Ej. Finca La Esperanza">
        </div>

        <details style="margin: 24px 0 16px 0;" ${cuenta && cuenta.lat_acometida != null ? 'open' : ''}>
          <summary style="cursor: pointer; color: #1e40af; font-size: 16px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0;">Ubicación (Coordenadas GPS) — opcional</summary>
          <small style="color: #64748b; font-size: 0.875rem; display: block; margin: 12px 0;">
            Para copiarlas desde Google Maps: mantenga presionado el punto exacto en el mapa, toque las coordenadas que aparecen arriba y péguelas aquí (un número en cada campo).
          </small>

          <div class="form-group">
            <label>Punto de Conexión de Agua (Acometida)</label>
            <div style="display: flex; gap: 12px;">
              <input type="number" step="any" id="lat_acometida" placeholder="Latitud" value="${cuenta?.lat_acometida ?? ''}">
              <input type="number" step="any" id="lon_acometida" placeholder="Longitud" value="${cuenta?.lon_acometida ?? ''}">
            </div>
          </div>

          <div class="form-group">
            <label style="display: flex; align-items: center; gap: 8px; font-weight: normal;">
              <input type="checkbox" id="mismo_punto" style="width: auto;" ${cuenta && cuenta.lat_acometida != null && cuenta.lat_acometida === cuenta.lat_vivienda && cuenta.lon_acometida === cuenta.lon_vivienda ? 'checked' : ''}>
              El punto de la vivienda es el mismo que la acometida
            </label>
          </div>

          <div class="form-group" id="grupoPuntoVivienda" style="${cuenta && cuenta.lat_acometida != null && cuenta.lat_acometida === cuenta.lat_vivienda && cuenta.lon_acometida === cuenta.lon_vivienda ? 'display: none;' : ''}">
            <label>Punto de la Vivienda</label>
            <div style="display: flex; gap: 12px;">
              <input type="number" step="any" id="lat_vivienda" placeholder="Latitud" value="${cuenta?.lat_vivienda ?? ''}">
              <input type="number" step="any" id="lon_vivienda" placeholder="Longitud" value="${cuenta?.lon_vivienda ?? ''}">
            </div>
          </div>
        </details>

        ${!id ? `
          <div class="form-group">
            <label for="categoria_id">Categoría <span style="color: #ef4444;">*</span></label>
            <select id="categoria_id" name="categoria_id" required>
              <option value="">Seleccione una categoría...</option>
              ${(await this.getCategoriasOptions()).map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label for="categoria_fecha_inicio">Categoría Vigente Desde</label>
            <input type="date" id="categoria_fecha_inicio" name="categoria_fecha_inicio" value="${new Date().toISOString().split('T')[0]}">
            <small style="color: #64748b; font-size: 0.875rem;">Si esta cuenta ya existía antes de usar el sistema, indique la fecha real desde la cual aplica esta categoría (ej. el año en que se creó el predio), para poder registrar pagos de meses anteriores a hoy.</small>
          </div>

          <div class="form-group">
            <label for="valor_conexion">Valor de Conexión (opcional)</label>
            <div class="input-currency">
              <span class="currency-symbol">$</span>
              <input type="text" inputmode="numeric" id="valor_conexion" name="valor_conexion">
            </div>
            <small style="color: #64748b; font-size: 0.875rem;">Si esta es una conexión nueva con un cargo de conexión a cobrar, indique el valor aquí. Podrá registrar abonos parciales desde "Estado de Pagos" hasta saldarlo.</small>
          </div>

          <h3 style="color: #1e40af; font-size: 16px; margin: 24px 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0;">Propietario</h3>

          <div class="table-controls" style="margin-bottom: 16px;">
            <button class="btn btn-primary" id="btnTabPropietarioNuevo" type="button">Propietario Nuevo</button>
            <button class="btn btn-secondary" id="btnTabPropietarioExistente" type="button">Propietario Existente</button>
          </div>

          <div id="panelPropietarioNuevo">
            <div class="form-group">
              <label for="prop_nombre_completo">Nombre Completo</label>
              <input type="text" id="prop_nombre_completo" name="prop_nombre_completo">
            </div>
            <div class="form-group">
              <label for="prop_numero_identificacion">Número de Identificación</label>
              <input type="text" id="prop_numero_identificacion" name="prop_numero_identificacion">
            </div>
            <div class="form-group">
              <label for="prop_telefono">Teléfono</label>
              <input type="text" id="prop_telefono" name="prop_telefono">
            </div>
            <div class="form-group">
              <label for="prop_email">Correo Electrónico</label>
              <input type="email" id="prop_email" name="prop_email">
            </div>
            <small style="color: #64748b; font-size: 0.875rem;">Puede dejarlo en blanco y asignar el propietario después desde el módulo Propietarios.</small>
          </div>

          <div id="panelPropietarioExistente" style="display: none;">
            <div class="form-group">
              <label for="prop_buscar">Buscar por nombre o identificación</label>
              <input type="text" id="prop_buscar" name="prop_buscar" placeholder="Escriba para buscar...">
              <input type="hidden" id="prop_existente_id">
              <div id="prop_buscar_resultados" style="margin-top: 8px;"></div>
              <div id="prop_existente_seleccionado" style="margin-top: 8px; font-size: 0.875rem;"></div>
            </div>
          </div>
        ` : ''}

        <div class="form-group">
          <label for="observaciones">Observaciones</label>
          <textarea id="observaciones" name="observaciones">${cuenta?.observaciones || ''}</textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${id ? 'Actualizar' : 'Crear'}</button>
        </div>
      </form>
    `;

    App.openModal(content);

    if (!id) {
      App.attachMoneyInput(document.getElementById('valor_conexion'));
      this.setupPropietarioTabs();
    }

    document.getElementById('mismo_punto').addEventListener('change', (e) => {
      document.getElementById('grupoPuntoVivienda').style.display = e.target.checked ? 'none' : 'block';
    });

    document.getElementById('cuentaForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveCuenta(id);
    });
  },

  setupPropietarioTabs() {
    const btnNuevo = document.getElementById('btnTabPropietarioNuevo');
    const btnExistente = document.getElementById('btnTabPropietarioExistente');
    const panelNuevo = document.getElementById('panelPropietarioNuevo');
    const panelExistente = document.getElementById('panelPropietarioExistente');

    btnNuevo.addEventListener('click', () => {
      panelNuevo.style.display = 'block';
      panelExistente.style.display = 'none';
      btnNuevo.className = 'btn btn-primary';
      btnExistente.className = 'btn btn-secondary';
    });

    btnExistente.addEventListener('click', () => {
      panelNuevo.style.display = 'none';
      panelExistente.style.display = 'block';
      btnNuevo.className = 'btn btn-secondary';
      btnExistente.className = 'btn btn-primary';
    });

    let timeoutBusqueda;
    document.getElementById('prop_buscar').addEventListener('input', (e) => {
      clearTimeout(timeoutBusqueda);
      document.getElementById('prop_existente_id').value = '';
      document.getElementById('prop_existente_seleccionado').innerHTML = '';
      const texto = e.target.value.trim();
      const resultadosDiv = document.getElementById('prop_buscar_resultados');
      if (!texto) { resultadosDiv.innerHTML = ''; return; }

      timeoutBusqueda = setTimeout(async () => {
        try {
          const response = await window.api.propietarios.getAll({ search: texto, limit: 5 });
          const data = response.success ? response.data.data : [];
          resultadosDiv.innerHTML = data.length === 0
            ? '<p style="font-size: 0.8rem; color: #64748b;">Sin resultados</p>'
            : data.map(p => `
                <div style="padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 4px; cursor: pointer;"
                     onclick="Cuentas.seleccionarPropietarioExistente(${p.id}, '${p.nombre_completo.replace(/'/g, "\\'")}', '${p.numero_identificacion || ''}')">
                  ${p.nombre_completo} ${p.numero_identificacion ? `(${p.numero_identificacion})` : ''}
                </div>
              `).join('');
        } catch (error) {
          console.error('Error:', error);
        }
      }, 300);
    });
  },

  seleccionarPropietarioExistente(id, nombre, identificacion) {
    document.getElementById('prop_existente_id').value = id;
    document.getElementById('prop_buscar_resultados').innerHTML = '';
    document.getElementById('prop_buscar').value = '';
    document.getElementById('prop_existente_seleccionado').innerHTML = `Seleccionado: <strong>${nombre}</strong> ${identificacion ? `(${identificacion})` : ''}`;
  },

  async saveCuenta(id) {
    const formData = {
      codigo: document.getElementById('codigo').value.trim(),
      direccion: document.getElementById('direccion').value.trim(),
      nombre_predio: document.getElementById('nombre_predio').value.trim(),
      observaciones: document.getElementById('observaciones').value.trim()
    };

    const latAcometida = document.getElementById('lat_acometida').value.trim();
    const lonAcometida = document.getElementById('lon_acometida').value.trim();
    formData.lat_acometida = latAcometida === '' ? null : parseFloat(latAcometida);
    formData.lon_acometida = lonAcometida === '' ? null : parseFloat(lonAcometida);

    if (document.getElementById('mismo_punto').checked) {
      formData.lat_vivienda = formData.lat_acometida;
      formData.lon_vivienda = formData.lon_acometida;
    } else {
      const latVivienda = document.getElementById('lat_vivienda').value.trim();
      const lonVivienda = document.getElementById('lon_vivienda').value.trim();
      formData.lat_vivienda = latVivienda === '' ? null : parseFloat(latVivienda);
      formData.lon_vivienda = lonVivienda === '' ? null : parseFloat(lonVivienda);
    }

    let valorConexion = 0;
    if (!id) {
      formData.categoria_id = document.getElementById('categoria_id').value;
      formData.categoria_fecha_inicio = document.getElementById('categoria_fecha_inicio').value;
      valorConexion = App.parseMoneyValue(document.getElementById('valor_conexion').value);
    }

    try {
      const response = id
        ? await window.api.cuentas.update(id, formData)
        : await window.api.cuentas.create(formData);

      if (response.success) {
        if (!id) {
          const cuentaId = response.data.id;

          if (valorConexion > 0) {
            const conexionResponse = await window.api.nuevosPuntos.create({
              cuentaId,
              valorTotal: valorConexion,
              fechaRegistro: formData.categoria_fecha_inicio,
              observaciones: 'Cargo de conexión inicial'
            });
            if (!conexionResponse.success) {
              App.toast('La cuenta se creó, pero no se pudo registrar el cargo de conexión: ' + conexionResponse.error, 'error');
            }
          }

          const propietarioExistenteId = document.getElementById('prop_existente_id').value;
          const nombreNuevo = document.getElementById('prop_nombre_completo').value.trim();

          if (propietarioExistenteId) {
            const asignarResponse = await window.api.propietarios.asignarACuenta(cuentaId, parseInt(propietarioExistenteId, 10), formData.categoria_fecha_inicio);
            if (!asignarResponse.success) {
              App.toast('La cuenta se creó, pero no se pudo asignar el propietario: ' + asignarResponse.error, 'error');
            }
          } else if (nombreNuevo) {
            const propietarioResponse = await window.api.propietarios.create({
              nombre_completo: nombreNuevo,
              numero_identificacion: document.getElementById('prop_numero_identificacion').value.trim() || null,
              telefono: document.getElementById('prop_telefono').value.trim() || null,
              email: document.getElementById('prop_email').value.trim() || null
            });
            if (propietarioResponse.success) {
              const asignarResponse = await window.api.propietarios.asignarACuenta(cuentaId, propietarioResponse.data.id, formData.categoria_fecha_inicio);
              if (!asignarResponse.success) {
                App.toast('El propietario se creó, pero no se pudo asignar a la cuenta: ' + asignarResponse.error, 'error');
              }
            } else {
              App.toast('La cuenta se creó, pero no se pudo crear el propietario: ' + propietarioResponse.error, 'error');
            }
          }
        }

        App.closeModal();
        this.loadCuentas();
        App.toast(id ? 'Cuenta actualizada con éxito' : 'Cuenta creada con éxito');
      } else {
        const errorDiv = document.getElementById('formError');
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      const errorDiv = document.getElementById('formError');
      errorDiv.innerHTML = `<div class="error-message">Error al guardar la cuenta</div>`;
    }
  },

  // Suspender/Reactivar pasan por CarteraService (cartera:suspender/reactivar), no por
  // cuentas:changeStatus (retirado, auditoría 2026-08-29): a diferencia de ese cambio directo
  // de cuentas.estado, estos dejan vigencia en cuenta_estados (lo que el motor de cartera
  // realmente lee, ver calcularAPagar/asegurarCausacion) y, al suspender, anulan con rastro
  // cualquier CargoMensual ya causado desde la fecha declarada -- sin esto, una cuenta marcada
  // "Suspendido" en pantalla seguía generando cartera y apareciendo en mora en silencio.
  showSuspenderModal(cuentaId) {
    const hoy = new Date().toISOString().split('T')[0];
    const content = `
      <div class="modal-header"><h2>Suspender Cuenta</h2></div>
      <div id="formError"></div>
      <p style="color: #64748b; font-size: 0.875rem; margin-bottom: 16px;">
        Los cargos mensuales ya causados desde la fecha declarada se anulan (con rastro, no se borran).
        No se vuelven a causar mientras la cuenta siga suspendida.
      </p>
      <form id="suspenderForm">
        <div class="form-group">
          <label for="fecha_desde_suspension">Suspendida Desde <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_desde_suspension" name="fecha_desde_suspension" value="${hoy}" required>
        </div>
        <div class="form-group">
          <label for="motivo_suspension">Motivo <span style="color: #ef4444;">*</span></label>
          <textarea id="motivo_suspension" name="motivo_suspension" required></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-warning">Suspender</button>
        </div>
      </form>
    `;
    App.openModal(content);

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('suspenderForm'), async () => {
      const errorDiv = document.getElementById('formError');
      try {
        const response = await window.api.cartera.suspender({
          cuentaId,
          fechaDesde: document.getElementById('fecha_desde_suspension').value,
          motivo: document.getElementById('motivo_suspension').value.trim(),
          opId
        });
        if (response.success) {
          App.closeModal();
          this.loadCuentas();
          App.toast('Cuenta suspendida con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al suspender la cuenta</div>`;
      }
    });
  },

  showReactivarModal(cuentaId) {
    const hoy = new Date().toISOString().split('T')[0];
    const content = `
      <div class="modal-header"><h2>Reactivar Cuenta</h2></div>
      <div id="formError"></div>
      <p style="color: #64748b; font-size: 0.875rem; margin-bottom: 16px;">
        La causación se reanuda desde la fecha declarada. Los meses en que estuvo suspendida
        NO se cobran retroactivamente.
      </p>
      <form id="reactivarForm">
        <div class="form-group">
          <label for="fecha_desde_reactivacion">Reactivada Desde <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_desde_reactivacion" name="fecha_desde_reactivacion" value="${hoy}" required>
        </div>
        <div class="form-group">
          <label for="motivo_reactivacion">Motivo</label>
          <textarea id="motivo_reactivacion" name="motivo_reactivacion"></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-success">Reactivar</button>
        </div>
      </form>
    `;
    App.openModal(content);

    const opId = crypto.randomUUID();
    App.protegerEnvioDoble(document.getElementById('reactivarForm'), async () => {
      const errorDiv = document.getElementById('formError');
      try {
        const response = await window.api.cartera.reactivar({
          cuentaId,
          fechaDesde: document.getElementById('fecha_desde_reactivacion').value,
          motivo: document.getElementById('motivo_reactivacion').value.trim() || null,
          opId
        });
        if (response.success) {
          App.closeModal();
          this.loadCuentas();
          App.toast('Cuenta reactivada con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al reactivar la cuenta</div>`;
      }
    });
  },

  async verEnMapa(lat, lon) {
    const url = `https://www.google.com/maps?q=${lat},${lon}`;
    const response = await window.api.sistema.abrirEnlaceExterno(url);
    if (!response.success) {
      App.toast('No se pudo abrir el mapa: ' + response.error, 'error');
    }
  },

  formatDate(dateString) {
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateString) ? dateString + 'T00:00:00' : dateString);
    return date.toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  formatNumber(num) {
    return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
};
