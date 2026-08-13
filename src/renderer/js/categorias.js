// Módulo de Categorías
const Categorias = {
  async load() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Categorías</h1>
        <p>Gestión de categorías y tarifas de sostenimiento</p>
      </div>

      <div class="table-container">
        <div class="table-header">
          <h2>Listado de Categorías</h2>
          <div class="table-controls">
            <button class="btn btn-primary" id="btnNuevaCategoria">+ Nueva Categoría</button>
          </div>
        </div>

        <div id="tableContent">
          ${App.renderSkeletonTable()}
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadCategorias();
  },

  setupEventListeners() {
    document.getElementById('btnNuevaCategoria').addEventListener('click', () => {
      this.showFormModal();
    });
  },

  async loadCategorias() {
    try {
      const response = await window.api.categorias.getAll();

      if (response.success) {
        this.renderTable(response.data);
      } else {
        console.error('Error al cargar categorías:', response.error);
      }
    } catch (error) {
      console.error('Error:', error);
    }
  },

  renderTable(categorias) {
    const tableContent = document.getElementById('tableContent');
    
    if (categorias.length === 0) {
      tableContent.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">No hay categorías registradas</p>';
      return;
    }

    tableContent.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Descripción</th>
            <th>Tarifa Actual</th>
            <th>Cuentas</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${categorias.map(cat => {
            const tarifaActual = cat.tarifa_actual || 0;
            const cuentasCount = cat.cuentas_count || 0;
            return `
              <tr>
                <td><strong>${cat.nombre}</strong></td>
                <td>${cat.descripcion || '-'}</td>
                <td>$${this.formatNumber(tarifaActual)}</td>
                <td>${cuentasCount}</td>
                <td><span class="badge badge-${cat.activo ? 'activo' : 'inactivo'}">${cat.activo ? 'Activa' : 'Inactiva'}</span></td>
                <td>
                  <div class="table-actions">
                    <button class="btn btn-primary btn-icon" onclick="Categorias.showDetailModal(${cat.id})">Ver</button>
                    <button class="btn btn-secondary btn-icon" onclick="Categorias.showFormModal(${cat.id})">Editar</button>
                    <button class="btn btn-success btn-icon" onclick="Categorias.showTarifaModal(${cat.id})">Tarifa</button>
                    <button class="btn btn-secondary btn-icon" onclick="Categorias.showReajusteModal(${cat.id})">Reajuste retroactivo</button>
                    <button class="btn btn-${cat.activo ? 'warning' : 'info'} btn-icon" onclick="Categorias.toggleActivo(${cat.id})">${cat.activo ? 'Desactivar' : 'Activar'}</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  async showDetailModal(id) {
    try {
      const response = await window.api.categorias.getById(id);
      
      if (!response.success) {
        App.toast('Error al cargar categoría: ' + response.error, 'error');
        return;
      }

      const categoria = response.data;

      // Cargar historial de tarifas
      const tarifasResponse = await window.api.categorias.getHistorialTarifas(id);
      const tarifas = tarifasResponse.success ? tarifasResponse.data : [];

      // Cargar cuentas con esta categoría
      const cuentasResponse = await window.api.categorias.getCuentasConCategoria(id);
      const cuentas = cuentasResponse.success ? cuentasResponse.data : [];

      const content = `
        <div class="modal-header">
          <h2>Detalle de Categoría</h2>
        </div>

        <div class="detail-section">
          <h3>Información General</h3>
          <div class="detail-row">
            <div class="detail-label">Nombre:</div>
            <div class="detail-value"><strong>${categoria.nombre}</strong></div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Descripción:</div>
            <div class="detail-value">${categoria.descripcion || '-'}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Estado:</div>
            <div class="detail-value"><span class="badge badge-${categoria.activo ? 'activo' : 'inactivo'}">${categoria.activo ? 'Activa' : 'Inactiva'}</span></div>
          </div>
        </div>

        <div class="detail-section">
          <h3>Historial de Tarifas</h3>
          ${tarifas.length > 0 ? `
            <table style="width: 100%; margin-top: 12px;">
              <thead>
                <tr>
                  <th>Tarifa</th>
                  <th>Vigente Desde</th>
                  <th>Vigente Hasta</th>
                  <th>Observaciones</th>
                </tr>
              </thead>
              <tbody>
                ${tarifas.map(t => `
                  <tr>
                    <td><strong>$${this.formatNumber(t.tarifa_sostenimiento)}</strong></td>
                    <td>${this.formatDate(t.fecha_vigencia_desde)}</td>
                    <td>${t.fecha_vigencia_hasta ? this.formatDate(t.fecha_vigencia_hasta) : '<strong>Actual</strong>'}</td>
                    <td>${t.observaciones || '-'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="color: #64748b; margin-top: 12px;">Sin historial de tarifas</p>'}
        </div>

        <div class="detail-section">
          <h3>Cuentas con esta Categoría (${cuentas.length})</h3>
          ${cuentas.length > 0 ? `
            <table style="width: 100%; margin-top: 12px;">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Dirección</th>
                  <th>Estado</th>
                  <th>Desde</th>
                </tr>
              </thead>
              <tbody>
                ${cuentas.map(c => `
                  <tr>
                    <td><strong>${c.codigo}</strong></td>
                    <td>${c.direccion}</td>
                    <td><span class="badge badge-${c.estado.toLowerCase()}">${c.estado}</span></td>
                    <td>${this.formatDate(c.fecha_inicio)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p style="color: #64748b; margin-top: 12px;">No hay cuentas con esta categoría</p>'}
        </div>

        <div class="form-actions">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
          <button class="btn btn-primary" onclick="App.closeModal(); Categorias.showFormModal(${categoria.id})">Editar</button>
        </div>
      `;
      
      App.openModal(content, 'large');
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cargar la categoría', 'error');
    }
  },

  async showFormModal(id = null) {
    let categoria = null;
    
    if (id) {
      const response = await window.api.categorias.getById(id);
      if (response.success) {
        categoria = response.data;
      } else {
        App.toast('Error al cargar categoría: ' + response.error, 'error');
        return;
      }
    }

    const content = `
      <div class="modal-header">
        <h2>${id ? 'Editar Categoría' : 'Nueva Categoría'}</h2>
      </div>

      <div id="formError"></div>

      <form id="categoriaForm">
        <div class="form-group">
          <label for="nombre">Nombre <span style="color: #ef4444;">*</span></label>
          <input type="text" id="nombre" name="nombre" value="${categoria?.nombre || ''}" required>
          <small style="color: #64748b; font-size: 0.875rem;">Ej: Finca, Finca con piscina, Tienda</small>
        </div>

        <div class="form-group">
          <label for="descripcion">Descripción</label>
          <textarea id="descripcion" name="descripcion">${categoria?.descripcion || ''}</textarea>
        </div>

        ${!id ? `
          <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
              <strong>Nota:</strong> Después de crear la categoría, podrás configurar su tarifa de sostenimiento.
            </p>
          </div>
        ` : ''}

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">${id ? 'Actualizar' : 'Crear'}</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('categoriaForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveCategoria(id);
    });
  },

  async saveCategoria(id) {
    const formData = {
      nombre: document.getElementById('nombre').value.trim(),
      descripcion: document.getElementById('descripcion').value.trim()
    };

    try {
      const response = id 
        ? await window.api.categorias.update(id, formData)
        : await window.api.categorias.create(formData);

      if (response.success) {
        App.closeModal();
        this.loadCategorias();
        
        if (!id) {
          App.toast('Categoría creada con éxito. Ahora puedes configurar su tarifa.');
          // Abrir modal de tarifa para la nueva categoría
          this.showTarifaModal(response.data.id);
        } else {
          App.toast('Categoría actualizada con éxito');
        }
      } else {
        const errorDiv = document.getElementById('formError');
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      const errorDiv = document.getElementById('formError');
      errorDiv.innerHTML = `<div class="error-message">Error al guardar la categoría</div>`;
    }
  },

  async showTarifaModal(categoriaId) {
    const categoriaResponse = await window.api.categorias.getById(categoriaId);
    if (!categoriaResponse.success) {
      App.toast('Error al cargar categoría', 'error');
      return;
    }
    const categoria = categoriaResponse.data;

    const tarifaVigenteResponse = await window.api.categorias.getTarifaVigente(categoriaId);
    const tarifaVigente = tarifaVigenteResponse.success ? tarifaVigenteResponse.data : null;

    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Configurar Tarifa</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Categoría:</strong> ${categoria.nombre}
        </p>
        ${tarifaVigente ? `
          <p style="margin: 8px 0 0 0; font-size: 0.875rem; color: #1e40af;">
            <strong>Tarifa actual:</strong> $${this.formatNumber(tarifaVigente.tarifa_sostenimiento)} 
            (desde ${this.formatDate(tarifaVigente.fecha_vigencia_desde)})
          </p>
        ` : ''}
      </div>

      <div id="formError"></div>

      <form id="tarifaForm">
        <div class="form-group">
          <label for="tarifa">Nueva Tarifa <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="tarifa" name="tarifa" required>
          </div>
          <small style="color: #64748b; font-size: 0.875rem;">Tarifa de sostenimiento mensual</small>
        </div>

        <div class="form-group">
          <label for="fecha_vigencia">Fecha de Vigencia <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_vigencia" name="fecha_vigencia" value="${hoy}" required>
          <small style="color: #64748b; font-size: 0.875rem;">Fecha desde la cual aplica la nueva tarifa</small>
        </div>

        <div class="form-group">
          <label for="observaciones_tarifa">Observaciones</label>
          <textarea id="observaciones_tarifa" name="observaciones_tarifa" placeholder="Ej: Ajuste anual 2025"></textarea>
        </div>

        <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
            <strong>Nota:</strong> La tarifa actual se finalizará automáticamente. Los valores históricos nunca se modifican.
          </p>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar Tarifa</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('tarifa'));

    document.getElementById('tarifaForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const tarifa = App.parseMoneyValue(document.getElementById('tarifa').value);
      const fechaVigencia = document.getElementById('fecha_vigencia').value;
      const observaciones = document.getElementById('observaciones_tarifa').value.trim();

      try {
        const response = await window.api.categorias.crearTarifa(categoriaId, tarifa, fechaVigencia, observaciones);

        if (response.success) {
          App.closeModal();
          this.loadCategorias();
          App.toast('Tarifa configurada con éxito');
        } else {
          const errorDiv = document.getElementById('formError');
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        const errorDiv = document.getElementById('formError');
        errorDiv.innerHTML = `<div class="error-message">Error al guardar la tarifa</div>`;
      }
    });
  },

  // "Tarifa" (arriba) solo registra la tarifa nueva hacia adelante -- no toca lo ya cobrado.
  // "Reajuste retroactivo" es para el caso real de la asamblea subiendo la tarifa con efecto
  // retroactivo (recibos "PENDIENTE REAJUSTE"): registra la tarifa nueva Y corrige, con un
  // AjusteCategoria visible en el detalle, a TODAS las cuentas de esta categoría que ya
  // tuvieran meses cobrados desde la fecha de vigencia. Primero muestra una vista previa (qué
  // cuentas, cuántos meses, cuánta plata) antes de aplicar nada -- puede mover plata de varias
  // cuentas de golpe.
  async showReajusteModal(categoriaId) {
    const categoriaResponse = await window.api.categorias.getById(categoriaId);
    if (!categoriaResponse.success) {
      App.toast('Error al cargar categoría', 'error');
      return;
    }
    const categoria = categoriaResponse.data;

    const tarifaVigenteResponse = await window.api.categorias.getTarifaVigente(categoriaId);
    const tarifaVigente = tarifaVigenteResponse.success ? tarifaVigenteResponse.data : null;

    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Reajuste retroactivo de tarifa</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Categoría:</strong> ${categoria.nombre}
        </p>
        ${tarifaVigente ? `
          <p style="margin: 8px 0 0 0; font-size: 0.875rem; color: #1e40af;">
            <strong>Tarifa actual:</strong> $${this.formatNumber(tarifaVigente.tarifa_sostenimiento)}
            (desde ${this.formatDate(tarifaVigente.fecha_vigencia_desde)})
          </p>
        ` : ''}
        <p style="margin: 8px 0 0 0; font-size: 0.875rem; color: #1e40af;">
          A diferencia de "Tarifa", esto además corrige (con un ajuste visible en el detalle de
          cada cuenta, sin reescribir lo ya cobrado) a todas las cuentas de esta categoría que
          tengan meses cobrados desde la fecha de vigencia.
        </p>
      </div>

      <div id="formError"></div>

      <form id="reajusteForm">
        <div class="form-group">
          <label for="reajuste_tarifa">Tarifa nueva <span style="color: #ef4444;">*</span></label>
          <div class="input-currency">
            <span class="currency-symbol">$</span>
            <input type="text" inputmode="numeric" id="reajuste_tarifa" name="reajuste_tarifa" required>
          </div>
        </div>

        <div class="form-group">
          <label for="reajuste_fecha">Vigente desde <span style="color: #ef4444;">*</span></label>
          <input type="date" id="reajuste_fecha" name="reajuste_fecha" value="${hoy}" required>
          <small style="color: #64748b; font-size: 0.875rem;">Puede ser una fecha pasada -- por eso es "retroactivo".</small>
        </div>

        <div class="form-group">
          <label for="reajuste_observaciones">Acta / motivo</label>
          <textarea id="reajuste_observaciones" name="reajuste_observaciones" placeholder="Ej: Aprobado en asamblea del 15 de marzo de 2026"></textarea>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Ver cuentas afectadas</button>
        </div>
      </form>
    `;

    App.openModal(content);
    App.attachMoneyInput(document.getElementById('reajuste_tarifa'));

    document.getElementById('reajusteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById('formError');
      const tarifa = App.parseMoneyValue(document.getElementById('reajuste_tarifa').value);
      const fechaVigencia = document.getElementById('reajuste_fecha').value;
      const observaciones = document.getElementById('reajuste_observaciones').value.trim();

      try {
        const cuentasResponse = await window.api.categorias.getCuentasConCategoria(categoriaId);
        if (!cuentasResponse.success) {
          errorDiv.innerHTML = `<div class="error-message">${cuentasResponse.error}</div>`;
          return;
        }
        const cuentaIds = cuentasResponse.data.map(c => c.id);
        if (cuentaIds.length === 0) {
          errorDiv.innerHTML = `<div class="error-message">Esta categoría no tiene ninguna cuenta -- no hay nada que reajustar.</div>`;
          return;
        }

        const previewResponse = await window.api.cartera.simularReajustarTarifaCategoria({
          categoriaId, tarifa, fechaVigencia, cuentaIds, observacionesTarifa: observaciones
        });
        if (!previewResponse.success) {
          errorDiv.innerHTML = `<div class="error-message">${previewResponse.error}</div>`;
          return;
        }

        this.showReajustePreview(categoriaId, categoria, { tarifa, fechaVigencia, observaciones },
          previewResponse.data, cuentasResponse.data);
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al calcular la vista previa</div>`;
      }
    });
  },

  // Vista previa (nada se escribió todavía -- simularReajustarTarifaCategoria corre y revierte
  // la misma transacción real) y confirmación antes de aplicar.
  showReajustePreview(categoriaId, categoria, datos, preview, cuentasInfo) {
    const cuentaPorId = new Map(cuentasInfo.map(c => [c.id, c]));
    const afectadas = preview.porCuenta.filter(p => p.ajustes.length > 0);

    const content = `
      <div class="modal-header">
        <h2>Confirmar reajuste -- ${categoria.nombre}</h2>
      </div>

      <div style="padding: 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Tarifa nueva:</strong> $${this.formatNumber(datos.tarifa)}, vigente desde ${this.formatDate(datos.fechaVigencia)}
        </p>
        <p style="margin: 8px 0 0 0; font-size: 0.875rem; color: #1e40af;">
          <strong>Cuentas afectadas:</strong> ${afectadas.length} de ${preview.porCuenta.length}
          &nbsp;|&nbsp; <strong>Total a ajustar:</strong> $${this.formatNumber(preview.totalAjustado)}
        </p>
      </div>

      ${afectadas.length === 0 ? `
        <p style="color: #64748b;">Ninguna cuenta tiene meses ya cobrados desde esa fecha -- no hay nada que corregir. La tarifa nueva se guarda igual, para cobrar los meses futuros.</p>
      ` : `
        <div style="max-height: 320px; overflow-y: auto;">
          <table style="width: 100%;">
            <thead>
              <tr><th>Cuenta</th><th>Meses ajustados</th><th>Monto</th></tr>
            </thead>
            <tbody>
              ${afectadas.map(p => {
                const cuenta = cuentaPorId.get(p.cuentaId);
                return `
                  <tr>
                    <td><strong>${cuenta ? cuenta.codigo : p.cuentaId}</strong></td>
                    <td>${p.ajustes.length}</td>
                    <td>$${this.formatNumber(p.totalAjustado)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}

      <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin: 20px 0;">
        <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
          Al confirmar, esto queda registrado como un ajuste en el detalle de cada cuenta -- no
          modifica los cargos ya emitidos ni las imputaciones existentes.
        </p>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Categorias.showReajusteModal(${categoriaId})">Volver</button>
        <button type="button" class="btn btn-primary" id="btnConfirmarReajuste">Confirmar y aplicar</button>
      </div>
    `;

    App.openModal(content, 'large');

    const opId = crypto.randomUUID();
    const boton = document.getElementById('btnConfirmarReajuste');
    boton.addEventListener('click', async () => {
      if (boton.disabled) return;
      boton.disabled = true;
      const textoOriginal = boton.textContent;
      boton.textContent = 'Aplicando...';

      try {
        const cuentaIds = preview.porCuenta.map(p => p.cuentaId);
        const observacionesAjuste = `Reajuste de tarifa de ${categoria.nombre} a $${this.formatNumber(datos.tarifa)}, ` +
          `vigente desde ${this.formatDate(datos.fechaVigencia)}${datos.observaciones ? ' -- ' + datos.observaciones : ''}`;

        const response = await window.api.cartera.reajustarTarifaCategoria({
          categoriaId, tarifa: datos.tarifa, fechaVigencia: datos.fechaVigencia, cuentaIds,
          observacionesTarifa: datos.observaciones, observacionesAjuste, opId
        });

        if (response.success) {
          App.closeModal();
          this.loadCategorias();
          App.toast(`Reajuste aplicado: $${this.formatNumber(response.data.totalAjustado)} en ${response.data.porCuenta.filter(p => p.ajustes.length > 0).length} cuenta(s)`);
        } else {
          App.toast('Error al aplicar el reajuste: ' + response.error, 'error');
          boton.disabled = false;
          boton.textContent = textoOriginal;
        }
      } catch (error) {
        console.error('Error:', error);
        App.toast('Error al aplicar el reajuste', 'error');
        boton.disabled = false;
        boton.textContent = textoOriginal;
      }
    });
  },

  async toggleActivo(id) {
    const confirmado = await App.confirmDialog('¿Está seguro de cambiar el estado de esta categoría?');
    if (!confirmado) return;

    try {
      const response = await window.api.categorias.toggleActivo(id);

      if (response.success) {
        this.loadCategorias();
        App.toast('Estado actualizado con éxito');
      } else {
        App.toast('Error al cambiar el estado: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cambiar el estado', 'error');
    }
  },

  formatNumber(num) {
    return num.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  },

  formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-CO', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric'
    });
  }
};
