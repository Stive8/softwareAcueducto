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

    // Escape cierra el modal activo, y Tab/Shift+Tab quedan atrapados dentro de él (no debe
    // ser posible tabular hacia el contenido de la página que quedó detrás).
    document.addEventListener('keydown', (e) => {
      if (!modal.classList.contains('active')) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeModal();
      } else if (e.key === 'Tab') {
        this.atraparFocoEnModal(e);
      }
    });
  },

  atraparFocoEnModal(e) {
    const modalContent = document.querySelector('.modal-content');
    const focosables = Array.from(modalContent.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.disabled && el.offsetParent !== null);

    if (focosables.length === 0) return;

    const primero = focosables[0];
    const ultimo = focosables[focosables.length - 1];

    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  },

  openModal(content, size = 'normal') {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalContent = modal.querySelector('.modal-content');

    // Remover clases de tamaño previas
    modalContent.classList.remove('modal-large', 'modal-xlarge');

    // Agregar clase de tamaño si es necesario. 'xlarge' es para contenido que puede ser muy
    // ancho (tablas de reportes): se adapta al espacio disponible en pantalla en vez de tener
    // un ancho fijo, ver .modal-content.modal-xlarge en styles.css.
    if (size === 'large') {
      modalContent.classList.add('modal-large');
    } else if (size === 'xlarge') {
      modalContent.classList.add('modal-xlarge');
    }

    modalBody.innerHTML = content;
    modal.classList.add('active');

    // Para devolver el foco a donde estaba al cerrar (ej. el botón "+ Nuevo" que abrió el modal).
    this.elementoConFocoPrevio = document.activeElement;

    // Foco inicial dentro del modal: el primer campo de formulario si hay uno, o si no el
    // primer botón. Sin esto el usuario tenía que hacer click dentro del modal antes de poder
    // escribir o navegar con teclado.
    requestAnimationFrame(() => {
      const focoInicial = modalContent.querySelector('input, select, textarea') || modalContent.querySelector('button');
      if (focoInicial) focoInicial.focus();
    });
  },

  closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.remove('active');

    // Si el modal se cierra sin pasar por el botón que resuelve su propia promesa (ej.
    // confirmDialog cerrado con Escape o clic fuera), esto evita que quede una promesa colgada.
    if (this.alCerrarModalSinResolver) {
      const callback = this.alCerrarModalSinResolver;
      this.alCerrarModalSinResolver = null;
      callback();
    }

    if (this.elementoConFocoPrevio && typeof this.elementoConFocoPrevio.focus === 'function') {
      this.elementoConFocoPrevio.focus();
    }
    this.elementoConFocoPrevio = null;
  },

  // Evita que un formulario financiero se envíe dos veces (doble clic, doble Enter, o un
  // segundo clic mientras la primera petición IPC todavía no responde): deshabilita el botón de
  // submit apenas se dispara el evento, y lo restaura solo si el formulario sigue en pantalla al
  // terminar (si fn() cierra el modal con éxito, el botón ya no existe y no hay nada que
  // restaurar). fn recibe el evento con preventDefault() ya aplicado.
  //
  // Complementa —no sustituye— la deduplicación por opId del lado del servidor (ver main.js,
  // envolverHandle): esto es la primera línea de defensa (evita la petición duplicada por
  // completo), y el opId es la segunda (si igual llegaran dos peticiones, el servidor las
  // reduce a una sola). Hallazgo Crítico C-2 de la auditoría de Contabilidad (2026-07-03).
  protegerEnvioDoble(form, fn) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const boton = form.querySelector('button[type="submit"]');
      if (boton && boton.disabled) return; // ya hay un envío en curso
      const textoOriginal = boton ? boton.textContent : null;
      if (boton) boton.disabled = true;
      try {
        await fn(e);
      } finally {
        if (boton && document.body.contains(boton)) {
          boton.disabled = false;
          boton.textContent = textoOriginal;
        }
      }
    });
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
      let resuelto = false;
      const resolverUnaVez = (valor) => {
        if (resuelto) return;
        resuelto = true;
        resolve(valor);
      };

      const content = `
        <div class="modal-header"><h2>${titulo}</h2></div>
        <p style="margin-bottom: 24px; color: #334155; font-size: 14px;">${message}</p>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="confirmDialogCancelBtn">${textoCancelar}</button>
          <button type="button" class="btn btn-danger" id="confirmDialogOkBtn">${textoConfirmar}</button>
        </div>
      `;

      this.openModal(content);
      // Si el modal se cierra con Escape o clic fuera (sin pasar por ninguno de los dos
      // botones), se trata como un Cancelar en vez de dejar la promesa colgada para siempre.
      this.alCerrarModalSinResolver = () => resolverUnaVez(false);

      document.getElementById('confirmDialogCancelBtn').addEventListener('click', () => {
        // Se limpia antes de cerrar: si no, closeModal() dispararía este mismo fallback con
        // valor false y "ganaría" por ser el primero en resolver (la promesa solo resuelve una
        // vez), aunque en este caso da igual porque el botón también cancela.
        this.alCerrarModalSinResolver = null;
        this.closeModal();
        resolverUnaVez(false);
      });

      document.getElementById('confirmDialogOkBtn').addEventListener('click', () => {
        // Aquí sí es crítico limpiar antes de cerrar: sin esto, closeModal() dispararía el
        // fallback (resuelve false) antes de llegar a resolverUnaVez(true), y un "Confirmar"
        // terminaría resolviendo como si hubiera sido un Cancelar.
        this.alCerrarModalSinResolver = null;
        this.closeModal();
        resolverUnaVez(true);
      });
    });
  },

  // Cards de una fila de métricas rápidas (stat-cards), para usar como innerHTML de un
  // contenedor con class="stats-grid" ya presente en el HTML del módulo (no incluye el wrapper,
  // para no anidar dos .stats-grid cuando el módulo ya declaró el suyo con su propio id).
  // items: [{ titulo, valor, footer, icono, valorColor }] — icono es una clave de Icons (ver
  // icons.js); valorColor es opcional (ej. verde/rojo según si un flujo neto es positivo).
  renderStatsGrid(items) {
    return items.map(item => `
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-card-title">${item.titulo}</span>
          <span class="stat-card-icon">${renderIcon(item.icono)}</span>
        </div>
        <div class="stat-card-value"${item.valorColor ? ` style="color: ${item.valorColor};"` : ''}>${item.valor}</div>
        ${item.footer ? `<div class="stat-card-footer">${item.footer}</div>` : ''}
      </div>
    `).join('');
  },

  // Paginación estándar de las tablas de listado (Cuentas, Recibos, Pagos, Propietarios, Gastos,
  // Caja): además de Anterior/Siguiente, agrega saltar directo a una página escribiendo el
  // número, botones Primera/Última y un selector de registros por página -- sin esto, llegar a
  // la página 100 de un listado de ~2500 registros paginado de a 10 exigía darle clic a
  // "Siguiente" 99 veces. `moduleName` es el nombre global del módulo (ej. "Recibos"): sus
  // botones llaman a `${moduleName}.changePage(n)` y `${moduleName}.changeLimit(n)`, que cada
  // módulo ya expone (o debe exponer) junto a su propio método de recarga del listado.
  renderPagination(pagination, moduleName, limitOptions = [10, 25, 50, 100]) {
    const { page, limit, total, totalPages } = pagination;
    const ultimaPagina = Math.max(totalPages, 1);
    return `
      <div class="pagination">
        <div class="pagination-info">
          Mostrando ${total === 0 ? 0 : (page - 1) * limit + 1} -
          ${Math.min(page * limit, total)}
          de ${total} registros
        </div>
        <div class="pagination-controls">
          <select class="pagination-limit-select" title="Registros por página" onchange="App.cambiarLimitePagina('${moduleName}', this.value)">
            ${limitOptions.map(n => `<option value="${n}" ${n === limit ? 'selected' : ''}>${n} / página</option>`).join('')}
          </select>
          <button ${page === 1 ? 'disabled' : ''} onclick="${moduleName}.changePage(1)" title="Primera página">&laquo;</button>
          <button ${page === 1 ? 'disabled' : ''} onclick="${moduleName}.changePage(${page - 1})">Anterior</button>
          <span class="pagination-jump">
            Página
            <input type="number" min="1" max="${ultimaPagina}" value="${page}" class="pagination-page-input"
                   onchange="App.irAPagina(this, '${moduleName}', ${ultimaPagina})">
            de ${ultimaPagina}
          </span>
          <button ${page >= totalPages ? 'disabled' : ''} onclick="${moduleName}.changePage(${page + 1})">Siguiente</button>
          <button ${page >= totalPages ? 'disabled' : ''} onclick="${moduleName}.changePage(${ultimaPagina})" title="Última página">&raquo;</button>
        </div>
      </div>
    `;
  },

  irAPagina(input, moduleName, ultimaPagina) {
    let pagina = parseInt(input.value, 10);
    if (!Number.isInteger(pagina) || pagina < 1) pagina = 1;
    if (pagina > ultimaPagina) pagina = ultimaPagina;
    input.value = pagina;
    window[moduleName].changePage(pagina);
  },

  cambiarLimitePagina(moduleName, nuevoLimite) {
    window[moduleName].changeLimit(parseInt(nuevoLimite, 10));
  },

  // Retrasa la ejecución de fn hasta que pasen `espera` ms sin que se vuelva a llamar: se usa en
  // los buscadores de las tablas para no disparar una consulta por cada tecla presionada.
  debounce(fn, espera = 300) {
    let temporizador;
    return (...args) => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => fn(...args), espera);
    };
  },

  // Para insertar HTML completo (ej. el documento de un reporte) dentro de un atributo
  // srcdoc="..." de un <iframe>: solo hace falta escapar comillas dobles y &, no <>/ (eso es
  // contenido normal del HTML interno, no del atributo en sí).
  escapeAttr(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  },

  // Placeholder de carga para una tabla (reemplaza el "Cargando..." de texto plano que tenían
  // todos los módulos): un puñado de filas con barras grises animadas, del mismo ancho que el
  // contenido real, así la pantalla no "salta" tanto cuando los datos llegan.
  renderSkeletonTable(filas = 5, columnas = 5) {
    const fila = () => `
      <div class="skeleton-row">
        ${Array.from({ length: columnas }).map(() => '<span class="skeleton skeleton-cell"></span>').join('')}
      </div>
    `;
    return `<div class="skeleton-table">${Array.from({ length: filas }).map(fila).join('')}</div>`;
  },

  // Mismo recurso, pero con la forma de una fila de stat-cards (Caja muestra esto mientras
  // llegan los saldos, antes de tener datos reales que mostrar).
  renderSkeletonStatsGrid(cantidad = 3) {
    return Array.from({ length: cantidad }).map(() => `
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="skeleton skeleton-text" style="width: 90px; height: 12px;"></span>
        </div>
        <span class="skeleton skeleton-text" style="width: 60%; height: 26px;"></span>
      </div>
    `).join('');
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
