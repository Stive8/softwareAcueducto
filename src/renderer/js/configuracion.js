// Módulo de Configuración
const Configuracion = {
  async load() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="page-header">
        <h1>Configuración</h1>
        <p>Datos de la asociación, parámetros generales, seguridad y copias de seguridad</p>
      </div>
      <div id="configContent">
        ${App.renderSkeletonTable()}
      </div>
    `;

    await this.renderForm();
  },

  async renderForm() {
    const esAdmin = App.currentUser.rol === 'Administrador';
    const response = await window.api.config.getAll();
    const config = response.success ? response.data : {};
    const container = document.getElementById('configContent');

    const cajaMenorResponse = esAdmin ? await window.api.cajaMenor.getEstado() : { success: false };
    const cajaMenorEstado = cajaMenorResponse.success
      ? cajaMenorResponse.data
      : { activa: false, saldoObjetivo: 0, saldoActual: 0, responsable: null, montoReembolso: 0 };

    container.innerHTML = `
      ${esAdmin ? `
      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header"><h2>Datos de la Asociación</h2></div>
        <div style="padding: 24px;">
          <div id="configError"></div>
          <form id="configForm">
            <div class="form-group">
              <label for="nombre_asociacion">Nombre de la Asociación <span style="color: #ef4444;">*</span></label>
              <input type="text" id="nombre_asociacion" name="nombre_asociacion" value="${config.nombre_asociacion || ''}" required>
            </div>

            <div class="form-group">
              <label for="nit">NIT</label>
              <input type="text" id="nit" name="nit" value="${config.nit || ''}">
            </div>

            <div class="form-group">
              <label for="direccion">Dirección</label>
              <input type="text" id="direccion" name="direccion" value="${config.direccion || ''}">
            </div>

            <div class="form-group">
              <label for="ciudad">Ciudad</label>
              <input type="text" id="ciudad" name="ciudad" value="${config.ciudad || ''}">
            </div>

            <div class="form-group">
              <label for="telefono">Teléfono</label>
              <input type="text" id="telefono" name="telefono" value="${config.telefono || ''}">
            </div>

            <div class="form-group">
              <label for="email">Correo Electrónico</label>
              <input type="email" id="email" name="email" value="${config.email || ''}">
            </div>

            <div style="margin: 8px 0 20px 0; padding-top: 16px; border-top: 1px solid #e2e8f0;">
              <label style="display: block; margin-bottom: 8px;">Logo (aparece en el encabezado de los reportes en PDF/Excel)</label>
              <div style="display: flex; align-items: center; gap: 16px;">
                <div id="logoPreview" style="width: 80px; height: 80px; border: 1px dashed #cbd5e1; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; color: #94a3b8; font-size: 0.75rem; text-align: center;">Cargando...</div>
                <div style="display: flex; gap: 8px;">
                  <button type="button" class="btn btn-secondary" id="btnSubirLogo">Subir Logo</button>
                  <button type="button" class="btn btn-warning" id="btnQuitarLogo">Quitar Logo</button>
                </div>
              </div>
              <small style="color: #64748b; font-size: 0.875rem;">PNG o JPG, máximo 500 KB. Se sube de inmediato, no requiere "Guardar Configuración".</small>
            </div>

            <h3 style="color: #1e40af; font-size: 16px; margin: 24px 0 16px 0; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0;">Parámetros Generales</h3>

            <div class="form-group">
              <label for="consecutivo_recibos">Próximo Número de Recibo <span style="color: #ef4444;">*</span></label>
              <input type="number" id="consecutivo_recibos" name="consecutivo_recibos" min="1" step="1" value="${config.consecutivo_recibos || 1}" required>
              <small style="color: #64748b; font-size: 0.875rem;">El siguiente recibo que se genere usará este número. No puede ser menor o igual al último recibo ya emitido.</small>
            </div>

            <div class="form-group">
              <label for="valor_nuevo_punto">Valor por Defecto de Nuevos Puntos</label>
              <div class="input-currency">
                <span class="currency-symbol">$</span>
                <input type="text" inputmode="numeric" id="valor_nuevo_punto" name="valor_nuevo_punto" value="${this.formatMoney(config.valor_nuevo_punto)}">
              </div>
            </div>

            <div class="form-group">
              <label for="saldo_caja_inicial">Saldo Inicial de Caja</label>
              <div class="input-currency">
                <span class="currency-symbol">$</span>
                <input type="text" inputmode="numeric" id="saldo_caja_inicial" name="saldo_caja_inicial" value="${this.formatMoney(config.saldo_caja_inicial)}">
              </div>
            </div>

            <div class="form-group">
              <label for="saldo_banco_inicial">Saldo Inicial de Banco</label>
              <div class="input-currency">
                <span class="currency-symbol">$</span>
                <input type="text" inputmode="numeric" id="saldo_banco_inicial" name="saldo_banco_inicial" value="${this.formatMoney(config.saldo_banco_inicial)}">
              </div>
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Guardar Configuración</button>
            </div>
          </form>
        </div>
      </div>

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header"><h2>Caja Menor</h2></div>
        <div style="padding: 24px;">
          <div id="cajaMenorConfigError"></div>
          <form id="cajaMenorConfigForm">
            <div class="form-group">
              <label>
                <input type="checkbox" id="caja_menor_activa" ${cajaMenorEstado.activa ? 'checked' : ''}>
                Caja Menor activa
              </label>
            </div>

            <div class="form-group">
              <label for="caja_menor_saldo_objetivo">Saldo Objetivo</label>
              <div class="input-currency">
                <span class="currency-symbol">$</span>
                <input type="text" inputmode="numeric" id="caja_menor_saldo_objetivo" name="caja_menor_saldo_objetivo" value="${this.formatMoney(cajaMenorEstado.saldoObjetivo)}">
              </div>
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Guardar Caja Menor</button>
            </div>
          </form>

          <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;">

          <p style="margin: 0 0 8px;"><strong>Responsable actual:</strong> ${cajaMenorEstado.responsable ? cajaMenorEstado.responsable.nombre_razon_social : 'Sin asignar'}</p>
          <div class="form-actions" style="justify-content: flex-start;">
            <button type="button" class="btn btn-secondary" id="btnCambiarResponsableCajaMenor">Cambiar Responsable</button>
            <button type="button" class="btn btn-secondary" id="btnHistorialResponsablesCajaMenor">Ver Historial de Responsables</button>
          </div>
        </div>
      </div>
      ` : ''}

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header"><h2>Seguridad</h2></div>
        <div style="padding: 24px;">
          <div id="passwordError"></div>
          <form id="passwordForm">
            <div class="form-group">
              <label for="password_actual">Contraseña Actual <span style="color: #ef4444;">*</span></label>
              <input type="password" id="password_actual" name="password_actual" required>
            </div>

            <div class="form-group">
              <label for="password_nueva">Nueva Contraseña <span style="color: #ef4444;">*</span></label>
              <input type="password" id="password_nueva" name="password_nueva" required minlength="4">
            </div>

            <div class="form-group">
              <label for="password_confirmar">Confirmar Nueva Contraseña <span style="color: #ef4444;">*</span></label>
              <input type="password" id="password_confirmar" name="password_confirmar" required minlength="4">
            </div>

            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Cambiar Contraseña</button>
            </div>
          </form>
        </div>
      </div>

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header"><h2>Copias de Seguridad</h2></div>
        <div style="padding: 24px;">
          <p style="color: #64748b; font-size: 14px; margin-bottom: 16px;">
            La copia de seguridad incluye toda la información del sistema (cuentas, propietarios, pagos, recibos, gastos, etc.) en un solo archivo.
            Además de esta copia manual, el sistema guarda automáticamente una copia diaria en segundo plano (ver más abajo).
          </p>
          <div class="form-actions" style="justify-content: flex-start;">
            <button type="button" class="btn btn-success" id="btnCrearBackup">Crear Copia de Seguridad</button>
            ${esAdmin ? '<button type="button" class="btn btn-warning" id="btnRestaurarBackup">Restaurar desde Archivo</button>' : ''}
          </div>
        </div>
      </div>

      <div id="backupAutomaticoContainer" style="margin-bottom: 24px;"></div>

      <div id="respaldoNubeContainer" style="margin-bottom: 24px;"></div>

      ${esAdmin ? `
      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header">
          <h2>Usuarios</h2>
          <button type="button" class="btn btn-primary" id="btnNuevoUsuario">+ Nuevo Usuario</button>
        </div>
        <div id="usuariosContent">${App.renderSkeletonTable()}</div>
      </div>

      <div class="table-container" style="margin-bottom: 24px;">
        <div class="table-header"><h2>Auditoría</h2></div>
        <div id="auditoriaContent">${App.renderSkeletonTable()}</div>
      </div>

      ` : ''}
    `;

    if (esAdmin) {
      App.attachMoneyInput(document.getElementById('valor_nuevo_punto'));
      App.attachMoneyInput(document.getElementById('saldo_caja_inicial'));
      App.attachMoneyInput(document.getElementById('saldo_banco_inicial'));

      document.getElementById('configForm').addEventListener('submit', (e) => {
        e.preventDefault();
        this.guardarConfiguracion();
      });

      App.attachMoneyInput(document.getElementById('caja_menor_saldo_objetivo'));
      document.getElementById('cajaMenorConfigForm').addEventListener('submit', (e) => {
        e.preventDefault();
        this.guardarCajaMenorConfig();
      });
      document.getElementById('btnCambiarResponsableCajaMenor').addEventListener('click', () => {
        this.showCambiarResponsableCajaMenorModal();
      });
      document.getElementById('btnHistorialResponsablesCajaMenor').addEventListener('click', () => {
        this.showHistorialResponsablesCajaMenorModal();
      });

      document.getElementById('btnRestaurarBackup').addEventListener('click', () => this.restaurarBackup());
      document.getElementById('btnNuevoUsuario').addEventListener('click', () => this.showNuevoUsuarioModal());

      document.getElementById('btnSubirLogo').addEventListener('click', () => this.subirLogo());
      document.getElementById('btnQuitarLogo').addEventListener('click', () => this.quitarLogo());
      this.cargarLogoPreview();

      await this.renderUsuarios();
      await this.renderAuditoria();
    }

    document.getElementById('passwordForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.cambiarPassword();
    });

    document.getElementById('btnCrearBackup').addEventListener('click', () => this.crearBackup());

    await this.renderBackupAutomatico();
    await this.renderRespaldoNube();
  },

  formatMoney(value) {
    if (!value) return '';
    return App.formatMoneyValue(value);
  },

  async cargarLogoPreview() {
    const preview = document.getElementById('logoPreview');
    try {
      const response = await window.api.config.getLogoBase64();
      preview.innerHTML = (response.success && response.data)
        ? `<img src="${response.data}" alt="Logo" style="max-width: 100%; max-height: 100%; object-fit: contain;">`
        : 'Sin logo';
    } catch (error) {
      console.error('Error:', error);
      preview.textContent = 'Sin logo';
    }
  },

  async subirLogo() {
    try {
      const response = await window.api.config.subirLogo();
      if (response.canceled) return;

      if (response.success) {
        App.toast('Logo actualizado con éxito');
        this.cargarLogoPreview();
      } else {
        App.toast('Error: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al subir el logo', 'error');
    }
  },

  async quitarLogo() {
    try {
      const response = await window.api.config.quitarLogo();
      if (response.success) {
        App.toast('Logo eliminado');
        this.cargarLogoPreview();
      } else {
        App.toast('Error: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al quitar el logo', 'error');
    }
  },

  async guardarConfiguracion() {
    const datos = {
      nombre_asociacion: document.getElementById('nombre_asociacion').value.trim(),
      nit: document.getElementById('nit').value.trim(),
      direccion: document.getElementById('direccion').value.trim(),
      ciudad: document.getElementById('ciudad').value.trim(),
      telefono: document.getElementById('telefono').value.trim(),
      email: document.getElementById('email').value.trim(),
      consecutivo_recibos: document.getElementById('consecutivo_recibos').value,
      valor_nuevo_punto: App.parseMoneyValue(document.getElementById('valor_nuevo_punto').value),
      saldo_caja_inicial: App.parseMoneyValue(document.getElementById('saldo_caja_inicial').value),
      saldo_banco_inicial: App.parseMoneyValue(document.getElementById('saldo_banco_inicial').value)
    };

    const errorDiv = document.getElementById('configError');
    errorDiv.innerHTML = '';

    try {
      const response = await window.api.config.actualizar(datos);

      if (response.success) {
        App.loadNombreAsociacion();
        App.toast('Configuración guardada con éxito');
      } else {
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al guardar la configuración</div>`;
    }
  },

  async guardarCajaMenorConfig() {
    const datos = {
      caja_menor_activa: document.getElementById('caja_menor_activa').checked ? 'true' : 'false',
      caja_menor_saldo_objetivo: String(App.parseMoneyValue(document.getElementById('caja_menor_saldo_objetivo').value))
    };

    const errorDiv = document.getElementById('cajaMenorConfigError');
    errorDiv.innerHTML = '';

    try {
      const response = await window.api.config.actualizar(datos);

      if (response.success) {
        App.toast('Configuración de Caja Menor guardada con éxito');
        await this.renderForm();
      } else {
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al guardar la configuración de Caja Menor</div>`;
    }
  },

  async showCambiarResponsableCajaMenorModal() {
    const tercerosResponse = await window.api.terceros.getAll({ soloActivos: true });
    const terceros = tercerosResponse.success ? tercerosResponse.data : [];
    const hoy = new Date().toISOString().split('T')[0];

    const content = `
      <div class="modal-header">
        <h2>Cambiar Responsable de Caja Menor</h2>
      </div>

      <div id="formError"></div>

      <form id="responsableCajaMenorForm">
        <div class="form-group">
          <label for="tercero_responsable_id">Responsable <span style="color: #ef4444;">*</span></label>
          <select id="tercero_responsable_id" required>
            <option value="">Seleccione...</option>
            ${terceros.map(t => `<option value="${t.id}">${t.nombre_razon_social}${t.numero_identificacion ? ' - ' + t.numero_identificacion : ''}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label for="fecha_inicio_responsable">Fecha de Inicio <span style="color: #ef4444;">*</span></label>
          <input type="date" id="fecha_inicio_responsable" value="${hoy}" required>
        </div>

        <div class="form-group">
          <label for="observaciones_responsable">Observaciones</label>
          <textarea id="observaciones_responsable"></textarea>
        </div>

        <div style="padding: 12px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 0.875rem; color: #92400e;">
            <strong>Nota:</strong> Si ya hay un responsable, su período se cerrará automáticamente en la fecha de inicio del nuevo.
          </p>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Asignar</button>
        </div>
      </form>
    `;

    App.openModal(content);
    Combobox.attach('tercero_responsable_id');

    document.getElementById('responsableCajaMenorForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const terceroId = parseInt(document.getElementById('tercero_responsable_id').value, 10);
      const fechaInicio = document.getElementById('fecha_inicio_responsable').value;
      const observaciones = document.getElementById('observaciones_responsable').value.trim();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.cajaMenor.asignarResponsable(terceroId, fechaInicio, observaciones);

        if (response.success) {
          App.closeModal();
          App.toast('Responsable de Caja Menor asignado con éxito');
          await this.renderForm();
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al asignar el responsable</div>`;
      }
    });
  },

  async showHistorialResponsablesCajaMenorModal() {
    const response = await window.api.cajaMenor.getHistorialResponsables();
    const historial = response.success ? response.data : [];

    const content = `
      <div class="modal-header">
        <h2>Historial de Responsables de Caja Menor</h2>
      </div>

      ${historial.length === 0 ? '<p style="color: #64748b;">Sin registros todavía.</p>' : `
        <table>
          <thead>
            <tr><th>Responsable</th><th>Desde</th><th>Hasta</th><th>Observaciones</th></tr>
          </thead>
          <tbody>
            ${historial.map(h => `
              <tr>
                <td>${h.nombre_razon_social}</td>
                <td>${h.fecha_inicio}</td>
                <td>${h.fecha_fin || 'Actual'}</td>
                <td>${h.observaciones || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cerrar</button>
      </div>
    `;

    App.openModal(content);
  },

  async cambiarPassword() {
    const passwordActual = document.getElementById('password_actual').value;
    const passwordNueva = document.getElementById('password_nueva').value;
    const passwordConfirmar = document.getElementById('password_confirmar').value;
    const errorDiv = document.getElementById('passwordError');
    errorDiv.innerHTML = '';

    if (passwordNueva !== passwordConfirmar) {
      errorDiv.innerHTML = `<div class="error-message">Las contraseñas nuevas no coinciden</div>`;
      return;
    }

    try {
      const response = await window.api.auth.cambiarPassword(App.currentUser.id, passwordActual, passwordNueva);

      if (response.success) {
        document.getElementById('passwordForm').reset();
        App.toast('Contraseña actualizada con éxito');
      } else {
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al cambiar la contraseña</div>`;
    }
  },

  async crearBackup() {
    try {
      const response = await window.api.backup.crear();
      if (response.canceled) return;

      if (response.success) {
        App.toast('Copia de seguridad creada en: ' + response.filePath);
      } else {
        App.toast('Error al crear la copia de seguridad: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al crear la copia de seguridad', 'error');
    }
  },

  async restaurarBackup() {
    const confirmado = await App.confirmDialog(
      'Esta acción reemplazará TODOS los datos actuales con los del archivo que seleccione a continuación. Esta acción no se puede deshacer. ¿Desea continuar?',
      { titulo: 'Restaurar Copia de Seguridad', textoConfirmar: 'Sí, continuar' }
    );
    if (!confirmado) return;

    try {
      const response = await window.api.backup.restaurar();
      if (response.canceled) return;

      if (!response.success) {
        App.toast('Error al restaurar la copia de seguridad: ' + response.error, 'error');
      }
      // Si fue exitosa, la aplicación se reinicia automáticamente desde el proceso principal.
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al restaurar la copia de seguridad', 'error');
    }
  },

  // --- Usuarios (solo Administrador) ---

  async renderUsuarios() {
    const container = document.getElementById('usuariosContent');
    try {
      const response = await window.api.usuarios.getAll();
      if (!response.success) {
        container.innerHTML = `<p style="padding: 24px; color: #ef4444;">Error: ${response.error}</p>`;
        return;
      }

      container.innerHTML = `
        <table>
          <thead>
            <tr><th>Usuario</th><th>Nombre Completo</th><th>Rol</th><th>Estado</th><th>Último Acceso</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            ${response.data.map(u => `
              <tr>
                <td><strong>${u.usuario}</strong></td>
                <td>${u.nombre_completo}</td>
                <td>${u.rol}</td>
                <td><span class="badge badge-${u.activo ? 'activo' : 'inactivo'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td>${u.fecha_ultimo_acceso ? this.formatDate(u.fecha_ultimo_acceso) : '<em>Nunca</em>'}</td>
                <td>
                  <div class="table-actions">
                    <button class="btn btn-secondary btn-icon" onclick="Configuracion.showResetPasswordModal(${u.id}, '${u.usuario}')">Resetear Clave</button>
                    ${u.id !== App.currentUser.id ? `
                      <button class="btn btn-${u.activo ? 'warning' : 'success'} btn-icon" onclick="Configuracion.toggleActivoUsuario(${u.id}, ${u.activo ? 0 : 1})">${u.activo ? 'Desactivar' : 'Activar'}</button>
                    ` : '<em style="font-size: 0.8rem; color: #64748b;">(usted)</em>'}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (error) {
      console.error('Error:', error);
      container.innerHTML = '<p style="padding: 24px; color: #ef4444;">Error al cargar los usuarios</p>';
    }
  },

  showNuevoUsuarioModal() {
    const content = `
      <div class="modal-header"><h2>Nuevo Usuario</h2></div>
      <div id="formError"></div>
      <form id="nuevoUsuarioForm">
        <div class="form-group">
          <label for="nuevo_usuario">Usuario <span style="color: #ef4444;">*</span></label>
          <input type="text" id="nuevo_usuario" name="nuevo_usuario" required>
        </div>
        <div class="form-group">
          <label for="nuevo_nombre_completo">Nombre Completo <span style="color: #ef4444;">*</span></label>
          <input type="text" id="nuevo_nombre_completo" name="nuevo_nombre_completo" required>
        </div>
        <div class="form-group">
          <label for="nuevo_password">Contraseña <span style="color: #ef4444;">*</span></label>
          <input type="password" id="nuevo_password" name="nuevo_password" required minlength="4">
        </div>
        <div class="form-group">
          <label for="nuevo_rol">Rol <span style="color: #ef4444;">*</span></label>
          <select id="nuevo_rol" name="nuevo_rol" required>
            <option value="Usuario">Usuario (operación diaria: cuentas, pagos, gastos)</option>
            <option value="Administrador">Administrador (acceso total, incluye usuarios y configuración)</option>
            <option value="Consulta">Consulta (solo puede ver información, no modificarla)</option>
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Crear Usuario</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('nuevoUsuarioForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.usuarios.crear({
          usuario: document.getElementById('nuevo_usuario').value.trim(),
          nombreCompleto: document.getElementById('nuevo_nombre_completo').value.trim(),
          password: document.getElementById('nuevo_password').value,
          rol: document.getElementById('nuevo_rol').value
        });

        if (response.success) {
          App.closeModal();
          this.renderUsuarios();
          App.toast('Usuario creado con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al crear el usuario</div>`;
      }
    });
  },

  showResetPasswordModal(id, usuario) {
    const content = `
      <div class="modal-header"><h2>Resetear Contraseña de "${usuario}"</h2></div>
      <div id="formError"></div>
      <form id="resetPasswordForm">
        <div class="form-group">
          <label for="reset_password_nueva">Nueva Contraseña <span style="color: #ef4444;">*</span></label>
          <input type="password" id="reset_password_nueva" name="reset_password_nueva" required minlength="4">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" onclick="App.closeModal()">Cancelar</button>
          <button type="submit" class="btn btn-primary">Restablecer</button>
        </div>
      </form>
    `;

    App.openModal(content);

    document.getElementById('resetPasswordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById('formError');

      try {
        const response = await window.api.usuarios.resetearPassword(id, document.getElementById('reset_password_nueva').value);
        if (response.success) {
          App.closeModal();
          App.toast('Contraseña restablecida con éxito');
        } else {
          errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
        }
      } catch (error) {
        console.error('Error:', error);
        errorDiv.innerHTML = `<div class="error-message">Error al restablecer la contraseña</div>`;
      }
    });
  },

  async toggleActivoUsuario(id, activo) {
    try {
      const response = await window.api.usuarios.toggleActivo(id, activo);
      if (response.success) {
        this.renderUsuarios();
        App.toast(activo ? 'Usuario activado' : 'Usuario desactivado');
      } else {
        App.toast('Error: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al cambiar el estado del usuario', 'error');
    }
  },

  // --- Auditoría (solo Administrador, solo lectura) ---

  async renderAuditoria() {
    const container = document.getElementById('auditoriaContent');
    try {
      const response = await window.api.auditoria.getAll({ page: 1, limit: 30 });
      if (!response.success) {
        container.innerHTML = `<p style="padding: 24px; color: #ef4444;">Error: ${response.error}</p>`;
        return;
      }

      if (response.data.data.length === 0) {
        container.innerHTML = '<p style="padding: 24px; text-align: center; color: #64748b;">Sin actividad registrada todavía</p>';
        return;
      }

      container.innerHTML = `
        <table>
          <thead>
            <tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Módulo</th><th>Registro</th></tr>
          </thead>
          <tbody>
            ${response.data.data.map(a => `
              <tr>
                <td>${this.formatDateTime(a.fecha_accion)}</td>
                <td>${a.nombre_completo || '<em>Desconocido</em>'}</td>
                <td>${a.accion}</td>
                <td>${a.tabla}</td>
                <td>${a.registro_id ?? '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p style="padding: 16px 24px; font-size: 0.8rem; color: #64748b;">Mostrando las últimas ${response.data.data.length} acciones.</p>
      `;
    } catch (error) {
      console.error('Error:', error);
      container.innerHTML = '<p style="padding: 24px; color: #ef4444;">Error al cargar la auditoría</p>';
    }
  },

  // --- Respaldo automático ---

  async renderBackupAutomatico() {
    const container = document.getElementById('backupAutomaticoContainer');
    try {
      const response = await window.api.backup.getEstadoAutomatico();
      const info = response.success ? response.data : null;

      container.innerHTML = `
        <div class="table-container">
          <div class="table-header"><h2>Respaldo Automático</h2></div>
          <div style="padding: 24px;">
            <p style="color: #64748b; font-size: 14px;">
              Además de la copia manual, el sistema guarda automáticamente una copia de seguridad
              ${info ? `cada vez que ha pasado más de un día desde la última, en una carpeta local del sistema` : ''}.
              No reemplaza tener copias en otro lugar (USB, nube): es solo una red de seguridad adicional.
            </p>
            ${info ? `
              <p style="font-size: 14px; margin-top: 12px;">
                <strong>Último respaldo automático:</strong> ${info.ultimoBackup ? this.formatDateTime(info.ultimoBackup) : 'Todavía no se ha generado ninguno'}<br>
                <strong>Copias guardadas:</strong> ${info.cantidad} (se conservan las últimas ${info.maximo})
              </p>
            ` : ''}
          </div>
        </div>
      `;
    } catch (error) {
      console.error('Error:', error);
      container.innerHTML = '';
    }
  },

  // --- Respaldo en la nube (Google Drive) ---

  async renderRespaldoNube() {
    const container = document.getElementById('respaldoNubeContainer');
    const esAdmin = App.currentUser.rol === 'Administrador';

    try {
      const response = await window.api.cloudBackup.getEstado();
      const estado = response.success ? response.data : { conectado: false };

      container.innerHTML = `
        <div class="table-container">
          <div class="table-header"><h2>Respaldo en la Nube</h2></div>
          <div style="padding: 24px;">
            <p style="color: #64748b; font-size: 14px; margin-bottom: 16px;">
              Copia de los respaldos en Google Drive, para poder recuperarlos si este equipo se
              pierde o se daña, o para abrirlos desde otro. Es un complemento a la copia local de
              arriba, no un remplazo.
            </p>
            ${estado.conectado ? `
              <p style="font-size: 14px; margin-bottom: 16px;">
                <strong>Cuenta de Google conectada</strong> en este equipo.<br>
                Último respaldo subido a la nube: ${estado.ultimaFechaExitosa ? this.formatDateTime(estado.ultimaFechaExitosa.replace('T', ' ').slice(0, 19)) : 'Todavía no se ha subido ninguno'}
                ${esAdmin ? `<br>Retención: últimos ${estado.diasRetencion} días + uno por mes` : ''}
              </p>
              <div class="form-actions" style="justify-content: flex-start;">
                <button type="button" class="btn btn-primary" id="btnActualizarNube">Actualizar desde la nube</button>
                ${esAdmin ? '<button type="button" class="btn btn-success" id="btnRespaldarNubeAhora">Respaldar ahora</button>' : ''}
                <button type="button" class="btn btn-secondary" id="btnDesconectarNube">Desconectar cuenta</button>
              </div>
              <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
                <div class="form-group">
                  <label for="respaldoNubeNombreEquipo">Nombre de este equipo</label>
                  <input type="text" id="respaldoNubeNombreEquipo" value="${estado.nombreEquipo || ''}" placeholder="Ej: PC de la asociación">
                  <small style="color: #64748b; font-size: 0.875rem;">Para identificar este equipo en la lista de respaldos. Es un dato propio de este equipo: no viaja con los respaldos que se suben/bajan.</small>
                </div>
                <div class="form-actions" style="justify-content: flex-start;">
                  <button type="button" class="btn btn-primary" id="btnGuardarNombreEquipo">Guardar nombre</button>
                </div>
                ${esAdmin ? `
                  <div class="form-group" style="margin-top: 16px;">
                    <label for="respaldoNubeDiasRetencion">Días de respaldos diarios a conservar</label>
                    <input type="number" id="respaldoNubeDiasRetencion" min="1" step="1" value="${estado.diasRetencion}">
                    <small style="color: #64748b; font-size: 0.875rem;">Más allá de estos días, se conserva solo un respaldo por mes, indefinidamente. Aplica para toda la asociación.</small>
                  </div>
                  <div class="form-actions">
                    <button type="button" class="btn btn-primary" id="btnGuardarRetencion">Guardar retención</button>
                  </div>
                ` : ''}
              </div>
            ` : `
              <p style="font-size: 14px; color: #64748b; margin-bottom: 16px;">No hay ninguna cuenta de Google conectada en este equipo.</p>
              <div class="form-actions" style="justify-content: flex-start;">
                <button type="button" class="btn btn-primary" id="btnConectarNube">Conectar con Google Drive</button>
              </div>
            `}
          </div>
        </div>
      `;

      if (estado.conectado) {
        document.getElementById('btnActualizarNube').addEventListener('click', () => this.actualizarDesdeNube());
        document.getElementById('btnDesconectarNube').addEventListener('click', () => this.desconectarNube());
        document.getElementById('btnGuardarNombreEquipo').addEventListener('click', () => this.guardarNombreEquipoNube());
        if (esAdmin) {
          document.getElementById('btnRespaldarNubeAhora').addEventListener('click', () => this.respaldarNubeAhora());
          document.getElementById('btnGuardarRetencion').addEventListener('click', () => this.guardarRetencionNube());
        }
      } else {
        document.getElementById('btnConectarNube').addEventListener('click', () => this.conectarNube());
      }
    } catch (error) {
      console.error('Error:', error);
      container.innerHTML = '';
    }
  },

  async conectarNube() {
    App.toast('Se abrió tu navegador. Inicia sesión con la cuenta de Google y acepta el acceso.');
    try {
      const response = await window.api.cloudBackup.conectar();
      if (response.success) {
        App.toast('Cuenta de Google conectada correctamente.');
        await this.renderRespaldoNube();
      } else {
        App.toast('No se pudo conectar: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('No se pudo conectar con Google Drive', 'error');
    }
  },

  async desconectarNube() {
    const confirmado = await App.confirmDialog(
      'Esto desconecta la cuenta de Google de este equipo. Los respaldos que ya están en Drive no se borran. ¿Desea continuar?',
      { titulo: 'Desconectar cuenta de Google', textoConfirmar: 'Sí, desconectar' }
    );
    if (!confirmado) return;

    try {
      const response = await window.api.cloudBackup.desconectar();
      if (response.success) {
        App.toast('Cuenta desconectada.');
        await this.renderRespaldoNube();
      } else {
        App.toast('Error al desconectar: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al desconectar la cuenta', 'error');
    }
  },

  async respaldarNubeAhora(forzar = false) {
    try {
      const response = await window.api.cloudBackup.respaldarAhora({ forzar });
      if (!response.success) {
        App.toast('Error al respaldar: ' + response.error, 'error');
        return;
      }

      if (response.data.conflicto) {
        const confirmado = await App.confirmDialog(
          response.data.mensaje,
          { titulo: 'Posible respaldo cruzado', textoConfirmar: 'Subir igual' }
        );
        if (confirmado) await this.respaldarNubeAhora(true);
        return;
      }

      App.toast('Respaldo subido a la nube correctamente.');
      await this.renderRespaldoNube();
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al respaldar en la nube', 'error');
    }
  },

  async actualizarDesdeNube() {
    const boton = document.getElementById('btnActualizarNube');
    if (boton) boton.disabled = true;

    try {
      const response = await window.api.cloudBackup.actualizarDesdeNube();
      if (response.canceled) return;
      if (!response.success) {
        App.toast('Error al actualizar desde la nube: ' + response.error, 'error');
      }
      // Si fue exitoso, la aplicación se reinicia automáticamente desde el proceso principal.
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al actualizar desde la nube', 'error');
    } finally {
      if (boton) boton.disabled = false;
    }
  },

  async guardarNombreEquipoNube() {
    try {
      const nombre = document.getElementById('respaldoNubeNombreEquipo').value.trim();
      const response = await window.api.cloudBackup.configurarEquipo(nombre);
      if (response.success) {
        App.toast('Nombre del equipo guardado.');
        await this.renderRespaldoNube();
      } else {
        App.toast('Error al guardar: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al guardar el nombre del equipo', 'error');
    }
  },

  async guardarRetencionNube() {
    try {
      const dias = document.getElementById('respaldoNubeDiasRetencion').value;
      const response = await window.api.config.actualizar({ respaldo_nube_dias_retencion: dias });
      if (response.success) {
        App.toast('Política de retención guardada.');
        await this.renderRespaldoNube();
      } else {
        App.toast('Error al guardar: ' + response.error, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      App.toast('Error al guardar la retención', 'error');
    }
  },

  formatDateTime(value) {
    if (!value) return '-';
    const [fecha, hora] = value.split(' ');
    const [anio, mes, dia] = fecha.split('-');
    return `${dia}/${mes}/${anio}${hora ? ' ' + hora.slice(0, 5) : ''}`;
  },

  formatDate(value) {
    if (!value) return '-';
    return this.formatDateTime(value).split(' ')[0];
  }
};
