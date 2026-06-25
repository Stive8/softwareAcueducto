// Iconos SVG inline (trazo, estilo lineal moderno) para reemplazar los emojis del sidebar y de
// las tarjetas de stat-card/reporte-card. Sin dependencia de internet ni de una librería externa
// (la app es de escritorio offline): cada icono es un string SVG autocontenido de 20x20.
const Icons = {
  dashboard: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.2"/><rect x="11" y="2.5" width="6.5" height="4" rx="1.2"/><rect x="11" y="9" width="6.5" height="8.5" rx="1.2"/><rect x="2.5" y="11.5" width="6.5" height="6" rx="1.2"/></svg>',
  home: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 9.5 10 3l7 6.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 8.5V16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  users: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7.2" cy="6.5" r="2.5"/><path d="M2.5 17v-1.2a3.8 3.8 0 0 1 3.8-3.8h1.8a3.8 3.8 0 0 1 3.8 3.8V17" stroke-linecap="round"/><path d="M13.2 4.5a2.5 2.5 0 0 1 0 5" stroke-linecap="round"/><path d="M14.8 12.1a3.8 3.8 0 0 1 2.7 3.6V17" stroke-linecap="round"/></svg>',
  tag: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9.4 2.5h-3a1.4 1.4 0 0 0-1 .4L2.9 6.4a1.4 1.4 0 0 0 0 2l8.7 8.7a1.4 1.4 0 0 0 2 0l4.5-4.5a1.4 1.4 0 0 0 0-2L9.4 2.5Z" stroke-linejoin="round"/><circle cx="7.2" cy="7.2" r="1.2"/></svg>',
  wallet: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="5.5" width="15" height="10.5" rx="2"/><path d="M2.5 8.5h15" stroke-linecap="round"/><circle cx="13.7" cy="11.7" r="1"/></svg>',
  fileText: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5.5 2.5h6l3 3v10a1.5 1.5 0 0 1-1.5 1.5h-7.5A1.5 1.5 0 0 1 4 15.5v-11A1.5 1.5 0 0 1 5.5 2.5Z" stroke-linejoin="round"/><path d="M7 9h6M7 12h6M7 6h2.5" stroke-linecap="round"/></svg>',
  trendingDown: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 5.5 8 11l3-3 6.5 6.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 14.5h4.5V10" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  building: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="2.5" width="9" height="15" rx="1"/><path d="M14 7.5h2.5a1 1 0 0 1 1 1V17H14" stroke-linejoin="round"/><path d="M6 6h3M6 9h3M6 12h3M6 15h3" stroke-linecap="round"/></svg>',
  landmark: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 7 10 2.5 17.5 7" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 7h13v1.5h-13Z" stroke-linejoin="round"/><path d="M5 8.5V15M9 8.5V15M11 8.5V15M15 8.5V15" stroke-linecap="round"/><path d="M3 17h14" stroke-linecap="round"/></svg>',
  book: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3.8c1.6-.7 3.7-.8 5.5 0 .5.2.9.6.9 1.2v10.8c-1.8-1-3.9-.9-5.5-.2-.5.2-.9-.1-.9-.6Z" stroke-linejoin="round"/><path d="M17 3.8c-1.6-.7-3.7-.8-5.5 0-.5.2-.9.6-.9 1.2v10.8c1.8-1 3.9-.9 5.5-.2.5.2.9-.1.9-.6Z" stroke-linejoin="round"/></svg>',
  barChart: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 17V3M3 17h14" stroke-linecap="round" stroke-linejoin="round"/><rect x="5.5" y="10" width="2.4" height="5" rx="0.5"/><rect x="9.5" y="7" width="2.4" height="8" rx="0.5"/><rect x="13.5" y="4.5" width="2.4" height="10.5" rx="0.5"/></svg>',
  fileChart: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5.5 2.5h6l3 3v10a1.5 1.5 0 0 1-1.5 1.5h-7.5A1.5 1.5 0 0 1 4 15.5v-11A1.5 1.5 0 0 1 5.5 2.5Z" stroke-linejoin="round"/><path d="M7.3 13V11M9.8 13V9.5M12.3 13V8" stroke-linecap="round"/></svg>',
  settings: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="2.6"/><path d="M10 2.7v2M10 15.3v2M17.3 10h-2M4.7 10h-2M15.2 4.8l-1.4 1.4M6.2 13.8l-1.4 1.4M15.2 15.2l-1.4-1.4M6.2 6.2 4.8 4.8" stroke-linecap="round"/></svg>',
  logOut: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7.5 17H4.5a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 4.5 3h3" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.5 13.5 17 9l-4.5-4.5M17 9H7.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  map: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 4.5 7 3l6 1.5 4.5-1.5v12L13 16.5 7 15l-4.5 1.5Z" stroke-linejoin="round"/><path d="M7 3v12M13 4.5v12" /></svg>',
  edit: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11.5 3.5 16 8l-8.5 8.5H3v-4.5Z" stroke-linejoin="round"/></svg>',
};

// Sirve el icono ya envuelto en su contenedor (`.nav-icon`, `.stat-card-icon-svg`, etc.) para no
// repetir el wrapper en cada llamada de los módulos.
function renderIcon(key, className = 'icon-svg') {
  return `<span class="${className}">${Icons[key] || ''}</span>`;
}
