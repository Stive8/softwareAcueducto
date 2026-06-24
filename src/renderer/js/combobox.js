// Convierte un <select> (con o sin <optgroup>) en un campo de texto con lista filtrable, para
// listas largas (cuentas de servicio, plan de cuentas) donde buscar escribiendo es más rápido
// que desplazarse por decenas de opciones. El <select> original se mantiene oculto en el DOM:
// sigue siendo la fuente de verdad de su valor, así que todo el código existente que lee
// document.getElementById(id).value (o lo marca required) sigue funcionando sin cambios.
const Combobox = {
  _listenerGlobalListo: false,

  // Acepta un id (para selects fijos en el formulario) o el elemento <select> directamente
  // (para selects dentro de filas generadas dinámicamente, como las líneas de un asiento, que
  // no tienen id propio y se ubican con querySelector por clase).
  attach(selectOrId) {
    const select = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId;
    if (!select || select.dataset.comboboxAttached) return;
    select.dataset.comboboxAttached = '1';

    const opciones = this._leerOpciones(select);
    select.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'combobox';
    wrapper.innerHTML = `
      <input type="text" class="combobox-input" autocomplete="off" placeholder="Buscar...">
      <div class="combobox-dropdown"></div>
    `;
    select.insertAdjacentElement('afterend', wrapper);

    const input = wrapper.querySelector('.combobox-input');
    const dropdown = wrapper.querySelector('.combobox-dropdown');

    const opcionSeleccionada = () => opciones.find(o => o.value === select.value);
    const inicial = opcionSeleccionada();
    input.value = inicial ? inicial.label : '';

    let filtradas = [];
    let resaltado = -1;

    const normalizar = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    const render = (filtro) => {
      const filtroNorm = normalizar(filtro);
      filtradas = opciones.filter(o => normalizar(o.label).includes(filtroNorm));
      resaltado = -1;

      if (filtradas.length === 0) {
        dropdown.innerHTML = '<div class="combobox-empty">Sin resultados</div>';
        return;
      }

      let html = '';
      let grupoActual;
      filtradas.forEach((o, i) => {
        if (o.group !== grupoActual) {
          grupoActual = o.group;
          if (grupoActual) html += `<div class="combobox-group-label">${grupoActual}</div>`;
        }
        html += `<div class="combobox-option" data-i="${i}">${o.label}</div>`;
      });
      dropdown.innerHTML = html;
    };

    const abrir = () => {
      render(input.value === (opcionSeleccionada()?.label || '') ? '' : input.value);
      dropdown.classList.add('open');
    };

    const cerrar = () => {
      dropdown.classList.remove('open');
    };

    const elegir = (opcion) => {
      select.value = opcion.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      input.value = opcion.label;
      cerrar();
    };

    const marcarResaltado = (i) => {
      dropdown.querySelectorAll('.combobox-option').forEach(el => el.classList.remove('highlighted'));
      resaltado = i;
      if (i < 0) return;
      const el = dropdown.querySelector(`.combobox-option[data-i="${i}"]`);
      if (el) {
        el.classList.add('highlighted');
        el.scrollIntoView({ block: 'nearest' });
      }
    };

    input.addEventListener('focus', () => {
      input.select();
      abrir();
    });

    input.addEventListener('input', () => {
      render(input.value);
      dropdown.classList.add('open');
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        const actual = opcionSeleccionada();
        input.value = actual ? actual.label : '';
        cerrar();
      }, 150);
    });

    input.addEventListener('keydown', (e) => {
      if (!dropdown.classList.contains('open') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        abrir();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        marcarResaltado(Math.min(resaltado + 1, filtradas.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        marcarResaltado(Math.max(resaltado - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (resaltado >= 0 && filtradas[resaltado]) elegir(filtradas[resaltado]);
      } else if (e.key === 'Escape') {
        cerrar();
        input.blur();
      }
    });

    dropdown.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.combobox-option');
      if (!item) return;
      e.preventDefault();
      const i = parseInt(item.dataset.i, 10);
      if (filtradas[i]) elegir(filtradas[i]);
    });

    dropdown.addEventListener('mouseover', (e) => {
      const item = e.target.closest('.combobox-option');
      if (!item) return;
      marcarResaltado(parseInt(item.dataset.i, 10));
    });

    this._registrarCierreGlobal();
  },

  _leerOpciones(select) {
    const opciones = [];
    Array.from(select.children).forEach(child => {
      if (child.tagName === 'OPTGROUP') {
        Array.from(child.children).forEach(opt => {
          if (opt.value !== '') opciones.push({ value: opt.value, label: opt.textContent, group: child.label });
        });
      } else if (child.tagName === 'OPTION' && child.value !== '') {
        opciones.push({ value: child.value, label: child.textContent, group: null });
      }
    });
    return opciones;
  },

  // Un solo listener para toda la app (no uno por cada vez que se abre un modal con un
  // combobox), para no ir acumulando listeners de document a lo largo de la sesión.
  _registrarCierreGlobal() {
    if (this._listenerGlobalListo) return;
    this._listenerGlobalListo = true;
    document.addEventListener('click', (e) => {
      document.querySelectorAll('.combobox-dropdown.open').forEach(dropdown => {
        if (!dropdown.closest('.combobox')?.contains(e.target)) dropdown.classList.remove('open');
      });
    });
  }
};

window.Combobox = Combobox;
