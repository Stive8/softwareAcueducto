// Módulo de Cuentas
const Cuentas = {
  currentPage: 1,
  limit: 10,
  search: '',
  estado: '',
  categoria: '',

  async load() {
    const categorias = await this.getCategoriasOptions();
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Cuentas / Predios</h1>
        <p>Gestión de cuentas del acueducto</p>
      </div>

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
          <p style="padding: 24px; text-align: center;">Cargando...</p>
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadCuentas();
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
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.search = e.target.value;
      this.currentPage = 1;
      this.loadCuentas();
    });

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
                    `<button class="btn btn-warning btn-icon" onclick="Cuentas.changeStatus(${cuenta.id}, 'Suspendido')">Suspender</button>` :
                    `<button class="btn btn-success btn-icon" onclick="Cuentas.changeStatus(${cuenta.id}, 'Activo')">Activar</button>`
                  }
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
          <button ${data.pagination.page === 1 ? 'disabled' : ''} onclick="Cuentas.changePage(${data.pagination.page - 1})">Anterior</button>
          <button disabled>${data.pagination.page} / ${data.pagination.totalPages}</button>
          <button ${data.pagination.page >= data.pagination.totalPages ? 'disabled' : ''} onclick="Cuentas.changePage(${data.pagination.page + 1})">Siguiente</button>
        </div>
      </div>
    `;
  },

  changePage(page) {
    this.currentPage = page;
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
          </p>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Cambiar</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('cambiarCategoriaForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const categoriaId = document.getElementById('nueva_categoria_id').value;
      const fechaInicio = document.getElementById('fecha_inicio_categoria').value;
      const observaciones = document.getElementById('observaciones_categoria').value.trim();

      try {
        const response = await window.api.categorias.asignarACuenta(cuentaId, categoriaId, fechaInicio, observaciones);

        if (response.success) {
          App.closeModal();
          this.loadCuentas();
          App.toast('Categoría actualizada con éxito');
        } else {
          const errorDiv = document.getElementById('formError');
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        const errorDiv = document.getElementById('formError');
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

        ${!id ? `
          <div class="form-group">
            <label for="categoria_id">Categoría <span style="color: #ef4444;">*</span></label>
            <select id="categoria_id" name="categoria_id" required>
              <option value="">Seleccione una categoría...</option>
              ${(await this.getCategoriasOptions()).map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
            </select>
            <small style="color: #64748b; font-size: 0.875rem;">El propietario se asigna desde el módulo Propietarios.</small>
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
        ` : ''}

        ${id ? `
          <div class="form-group">
            <label for="estado">Estado</label>
            <select id="estado" name="estado">
              <option value="Activo" ${cuenta?.estado === 'Activo' ? 'selected' : ''}>Activo</option>
              <option value="Inactivo" ${cuenta?.estado === 'Inactivo' ? 'selected' : ''}>Inactivo</option>
              <option value="Suspendido" ${cuenta?.estado === 'Suspendido' ? 'selected' : ''}>Suspendido</option>
            </select>
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
    }

    document.getElementById('cuentaForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveCuenta(id);
    });
  },

  async saveCuenta(id) {
    const formData = {
      codigo: document.getElementById('codigo').value.trim(),
      direccion: document.getElementById('direccion').value.trim(),
      observaciones: document.getElementById('observaciones').value.trim()
    };

    let valorConexion = 0;
    if (id) {
      formData.estado = document.getElementById('estado').value;
    } else {
      formData.categoria_id = document.getElementById('categoria_id').value;
      formData.categoria_fecha_inicio = document.getElementById('categoria_fecha_inicio').value;
      valorConexion = App.parseMoneyValue(document.getElementById('valor_conexion').value);
    }

    try {
      const response = id
        ? await window.api.cuentas.update(id, formData)
        : await window.api.cuentas.create(formData);

      if (response.success) {
        if (!id && valorConexion > 0) {
          const cuentaId = response.data.id;
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

  async changeStatus(id, nuevoEstado) {
    const confirmado = await App.confirmDialog(`¿Está seguro de cambiar el estado de esta cuenta a ${nuevoEstado}?`);
    if (!confirmado) return;

    try {
      const response = await window.api.cuentas.changeStatus(id, nuevoEstado);

      if (response.success) {
        this.loadCuentas();
        App.toast('Estado actualizado con éxito');
      } else {
        App.toast('Error al cambiar el estado: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cambiar el estado', 'error');
    }
  },

  formatDate(dateString) {
    const date = new Date(dateString);
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
