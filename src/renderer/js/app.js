// App principal - gestión de navegación y sesión
const App = {
  currentPage: 'dashboard',
  currentUser: null,
  initialized: false,

  initLogin() {
    this.setupModal();
    this.loadNombreAsociacion();

    document.getElementById('loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin();
    });

    document.getElementById('loginUsuario').focus();
  },

  // El nombre real de la asociación (configurable en Configuración) se muestra en el login
  // y en la barra lateral, en vez del genérico "Acueducto" que queda solo como respaldo.
  async loadNombreAsociacion() {
    try {
      const response = await window.api.config.getAll();
      if (response.success && response.data.nombre_asociacion) {
        const nombre = response.data.nombre_asociacion;
        document.getElementById('loginAsociacionNombre').textContent = nombre;
        Sidebar.setAsociacion(nombre);
      }
    } catch (error) {
      console.error('Error al cargar el nombre de la asociación:', error);
    }
  },

  async handleLogin() {
    const usuario = document.getElementById('loginUsuario').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    errorDiv.innerHTML = '';

    try {
      const response = await window.api.auth.login(usuario, password);

      if (response.success) {
        this.currentUser = response.data;
        document.getElementById('loginPassword').value = '';
        this.onLoginSuccess();
      } else {
        errorDiv.innerHTML = `<div class="error-message">${response.error}</div>`;
      }
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = `<div class="error-message">Error al iniciar sesión</div>`;
    }
  },

  onLoginSuccess() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';

    Sidebar.setUsuario(this.currentUser.nombreCompleto, this.currentUser.rol);

    if (!this.initialized) {
      this.setupNavigation();
      this.setupLogout();
      this.initialized = true;
    }

    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    document.querySelector('.nav-item[data-page="dashboard"]').classList.add('active');
    this.loadPage('dashboard');

    // Solo para Consulta: si hay algo más nuevo en la nube que este equipo no conoce, se trae
    // sin pedir confirmación (nunca tiene cambios locales propios que perder) y la app se
    // reinicia sola. Para cualquier otro rol esto no hace nada (ver cloudBackup:actualizarSiHayNuevo).
    if (this.currentUser.rol === 'Consulta') {
      this.verificarActualizacionNubeSilenciosa();
    }
  },

  async verificarActualizacionNubeSilenciosa() {
    try {
      const chequeo = await window.api.cloudBackup.getActualizacionPendiente();
      if (!chequeo.success || !chequeo.data.hay) return;

      // Aviso breve antes de aplicar: la actualización en sí reinicia la app casi de inmediato,
      // así que sin esta pausa nunca se llega a ver el mensaje.
      this.toast('Hay una versión más reciente en la nube. Actualizando en un momento...');

      setTimeout(async () => {
        try {
          const response = await window.api.cloudBackup.actualizarSiHayNuevo();
          if (!response.success) {
            console.error('No se pudo actualizar desde la nube automáticamente:', response.error);
            this.toast('No se pudo traer la versión más reciente de la nube: ' + response.error, 'error');
          }
          // Si fue exitoso, la app se reinicia sola desde el proceso principal.
        } catch (error) {
          console.error('Error al actualizar desde la nube:', error);
        }
      }, 1800);
    } catch (error) {
      console.error('Error al verificar actualizaciones en la nube:', error);
    }
  },

  setupLogout() {
    document.getElementById('btnLogout').addEventListener('click', async () => {
      const confirmado = await this.confirmDialog('¿Está seguro de cerrar la sesión?');
      if (confirmado) this.logout();
    });
  },

  async logout() {
    try {
      await window.api.auth.logout();
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
    this.currentUser = null;
    document.getElementById('appContainer').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginUsuario').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginUsuario').focus();
  },

  setupNavigation() {
    // Contabilidad y Gastos (.nav-item-main, con acordeón de sub-páginas) los maneja Sidebar
    // directamente (ver sidebar.js); aquí solo los ítems simples, que solo navegan.
    document.querySelectorAll('.nav-item:not(.disabled):not(.nav-item-main)').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;

        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');

        this.loadPage(page);
      });
    });
  },

  loadPage(page, tab = null) {
    this.currentPage = page;

    if (page === 'dashboard') {
      Dashboard.load();
    } else if (page === 'cuentas') {
      Cuentas.load();
    } else if (page === 'propietarios') {
      Propietarios.load();
    } else if (page === 'categorias') {
      Categorias.load();
    } else if (page === 'pagos') {
      Pagos.load();
    } else if (page === 'recibos') {
      Recibos.load();
    } else if (page === 'gastos') {
      Gastos.load(tab);
    } else if (page === 'caja') {
      Caja.load();
    } else if (page === 'configuracion') {
      Configuracion.load();
    } else if (page === 'reportes') {
      Reportes.load();
    } else if (page === 'contabilidad') {
      Contabilidad.load(tab);
    }
  },

  setupModal() {
    const modal = document.getElementById('modal');
    const closeBtn = document.querySelector('.modal-close');
    
    closeBtn.addEventListener('click', () => this.closeModal());
    
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeModal();
      }
    });
  },

  openModal(content, size = 'normal') {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalContent = modal.querySelector('.modal-content');
    
    // Remover clases de tamaño previas
    modalContent.classList.remove('modal-large');
    
    // Agregar clase de tamaño si es necesario
    if (size === 'large') {
      modalContent.classList.add('modal-large');
    }
    
    modalBody.innerHTML = content;
    modal.classList.add('active');
  },

  closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.remove('active');
  },

  // Notificación no bloqueante. Reemplaza a alert(): los diálogos nativos de Electron
  // en Windows dejan el foco del teclado roto en el siguiente campo de texto que se
  // edite, hasta que la ventana pierde y recupera el foco (alt-tab). Esta notificación
  // vive dentro de la misma página y no tiene ese problema.
  toast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) {
      console.warn('toastContainer no encontrado, mensaje:', message);
      return;
    }

    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;
    toastEl.textContent = message;
    container.appendChild(toastEl);

    requestAnimationFrame(() => toastEl.classList.add('show'));

    setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => toastEl.remove(), 250);
    }, 3800);
  },

  // Confirmación no bloqueante (reemplaza a confirm(), mismo motivo que toast()).
  // Reutiliza el modal existente en lugar de un diálogo nativo del sistema operativo.
  confirmDialog(message, opciones = {}) {
    const { titulo = 'Confirmar', textoConfirmar = 'Confirmar', textoCancelar = 'Cancelar' } = opciones;

    return new Promise((resolve) => {
      const content = `
        <div class="modal-header"><h2>${titulo}</h2></div>
        <p style="margin-bottom: 24px; color: #334155; font-size: 14px;">${message}</p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="confirmDialogCancelBtn">${textoCancelar}</button>
          <button type="button" class="btn btn-danger" id="confirmDialogOkBtn">${textoConfirmar}</button>
        </div>
      `;

      this.openModal(content);

      document.getElementById('confirmDialogCancelBtn').addEventListener('click', () => {
        this.closeModal();
        resolve(false);
      });

      document.getElementById('confirmDialogOkBtn').addEventListener('click', () => {
        this.closeModal();
        resolve(true);
      });
    });
  },

  // --- Campos de dinero: formato con separador de miles y símbolo $ mientras se escribe ---

  formatMoneyValue(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    return Number(digits).toLocaleString('es-CO');
  },

  parseMoneyValue(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits ? parseInt(digits, 10) : 0;
  },

  // Conecta el formateo en vivo a un <input> de texto. El valor real (sin puntos) se
  // obtiene siempre con App.parseMoneyValue(input.value) al momento de leer el formulario.
  attachMoneyInput(input) {
    if (!input) return;
    input.addEventListener('input', () => {
      const alFinal = input.selectionStart === input.value.length;
      input.value = this.formatMoneyValue(input.value);
      if (alFinal) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  },

  // Pantalla previa al login, solo cuando la base de datos local está completamente vacía (un
  // PC nuevo): permite traer los datos desde Google Drive antes de que exista ningún usuario
  // local con el que iniciar sesión (ver cloudBackup en main.js, canales sin sesión).
  initSetup() {
    document.getElementById('setupScreen').style.display = 'flex';
    document.getElementById('btnSetupTraerNube').addEventListener('click', () => this.setupTraerDesdeNube());
    document.getElementById('btnSetupContinuar').addEventListener('click', () => this.setupContinuarSinNube());
  },

  async setupTraerDesdeNube() {
    const boton = document.getElementById('btnSetupTraerNube');
    const errorDiv = document.getElementById('setupError');
    errorDiv.innerHTML = '';
    boton.disabled = true;

    try {
      const estado = await window.api.cloudBackup.getEstado();
      if (!estado.success || !estado.data.conectado) {
        boton.textContent = 'Conectando con Google...';
        const conexion = await window.api.cloudBackup.conectar();
        if (!conexion.success) {
          errorDiv.innerHTML = `<div class="error-message">${conexion.error}</div>`;
          return;
        }
      }

      boton.textContent = 'Descargando el respaldo más reciente...';
      const resultado = await window.api.cloudBackup.actualizarDesdeNube();
      if (resultado.canceled) return;
      if (!resultado.success) {
        errorDiv.innerHTML = `<div class="error-message">${resultado.error}</div>`;
      }
      // Si fue exitoso, la app se reinicia sola desde el proceso principal.
    } catch (error) {
      console.error('Error:', error);
      errorDiv.innerHTML = '<div class="error-message">No se pudo conectar con Google Drive</div>';
    } finally {
      boton.disabled = false;
      boton.textContent = 'Traer datos desde Google Drive';
    }
  },

  setupContinuarSinNube() {
    document.getElementById('setupScreen').style.display = 'none';
    this.initLogin();
  }
};

// Al iniciar la app: si la base de datos local está vacía (un PC nuevo), se ofrece traer los
// datos desde la nube antes que nada; si no, siempre se exige login, sin sesión persistida entre
// ejecuciones.
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await window.api.devtools.tieneDatosOperativos();
    if (response.success && !response.data) {
      App.initSetup();
      return;
    }
  } catch (error) {
    console.error('Error al verificar si hay datos operativos:', error);
  }

  App.initLogin();
});
