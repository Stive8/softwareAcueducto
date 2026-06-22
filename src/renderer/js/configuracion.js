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
        <p style="padding: 24px; text-align: center;">Cargando...</p>
      </div>
    `;

    await this.renderForm();
  },

  async renderForm() {
    const response = await window.api.config.getAll();
    const config = response.success ? response.data : {};
    const container = document.getElementById('configContent');

    container.innerHTML = `
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
              <label for="telefono">Teléfono</label>
              <input type="text" id="telefono" name="telefono" value="${config.telefono || ''}">
            </div>

            <div class="form-group">
              <label for="email">Correo Electrónico</label>
              <input type="email" id="email" name="email" value="${config.email || ''}">
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

      <div class="table-container">
        <div class="table-header"><h2>Copias de Seguridad</h2></div>
        <div style="padding: 24px;">
          <p style="color: #64748b; font-size: 14px; margin-bottom: 16px;">
            La copia de seguridad incluye toda la información del sistema (cuentas, propietarios, pagos, recibos, gastos, etc.) en un solo archivo.
          </p>
          <div class="form-actions" style="justify-content: flex-start;">
            <button type="button" class="btn btn-success" id="btnCrearBackup">Crear Copia de Seguridad</button>
            <button type="button" class="btn btn-warning" id="btnRestaurarBackup">Restaurar desde Archivo</button>
          </div>
        </div>
      </div>
    `;

    App.attachMoneyInput(document.getElementById('valor_nuevo_punto'));
    App.attachMoneyInput(document.getElementById('saldo_caja_inicial'));
    App.attachMoneyInput(document.getElementById('saldo_banco_inicial'));

    document.getElementById('configForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.guardarConfiguracion();
    });

    document.getElementById('passwordForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.cambiarPassword();
    });

    document.getElementById('btnCrearBackup').addEventListener('click', () => this.crearBackup());
    document.getElementById('btnRestaurarBackup').addEventListener('click', () => this.restaurarBackup());
  },

  formatMoney(value) {
    if (!value) return '';
    return App.formatMoneyValue(value);
  },

  async guardarConfiguracion() {
    const datos = {
      nombre_asociacion: document.getElementById('nombre_asociacion').value.trim(),
      nit: document.getElementById('nit').value.trim(),
      direccion: document.getElementById('direccion').value.trim(),
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
        App.toast('Configuración guardada con éxito');
      } else {
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al guardar la configuración</div>`;
    }
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
  }
};
