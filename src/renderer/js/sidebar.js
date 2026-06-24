// Sidebar: además del nombre de la asociación/usuario (que llegan después del login y antes no
// existen), maneja el acordeón de Contabilidad/Gastos (clic en la fila principal despliega sus
// sub-páginas debajo, dentro del propio sidebar — reemplaza los botones que antes vivían arriba
// de cada pantalla).
const Sidebar = {
  setAsociacion(nombre) {
    const el = document.getElementById('sidebarAsociacionNombre');
    if (el) el.textContent = nombre;
  },

  setUsuario(nombreCompleto, rol) {
    const el = document.getElementById('sidebarUserInfo');
    if (el) el.innerHTML = `<strong>${nombreCompleto}</strong><span>${rol}</span>`;
  },

  init() {
    document.querySelectorAll('.nav-item-main').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const submenu = item.closest('.nav-item-group').querySelector('.nav-submenu');
        const estabaAbierto = submenu.classList.contains('open');

        // Solo un acordeón abierto a la vez, para no acumular paneles desplegados sin razón.
        document.querySelectorAll('.nav-submenu.open').forEach(s => s.classList.remove('open'));
        document.querySelectorAll('.nav-item-main.open').forEach(m => m.classList.remove('open'));

        if (!estabaAbierto) {
          submenu.classList.add('open');
          item.classList.add('open');
        }

        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        App.loadPage(item.dataset.page);
      });
    });

    document.querySelectorAll('.nav-submenu-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        const tab = link.dataset.tab;

        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');

        App.loadPage(page, tab);
      });
    });
  }
};

Sidebar.init();
window.Sidebar = Sidebar;
