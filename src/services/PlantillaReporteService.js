const path = require('path');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');
const { obtenerLogoBase64 } = require('./shared/logoBase64');

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(num) {
  return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatFecha(fechaString) {
  if (!fechaString) return '-';
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaString) ? fechaString + 'T00:00:00' : fechaString;
  return new Date(fecha).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatValorResumen(item) {
  return item.tipo === 'numero' ? String(item.valor) : `$${formatNumber(item.valor)}`;
}

const NOMBRE_SISTEMA = 'Sistema Administrativo Acueducto Veredal';

// Por encima de esta suma de "unidades de ancho" estimadas entre todas las columnas, el reporte
// se considera demasiado ancho para verse bien en vertical.
const UMBRAL_ANCHO_HORIZONTAL = 90;

// Único punto de verdad para construir el documento de un reporte (encabezado institucional,
// info del reporte, filtros, contenido, pie de página): lo usan tanto la vista previa en pantalla
// como la exportación a PDF (vía generarHTML) y, para los datos institucionales/orientación,
// también la exportación a Excel. Mejorar la plantilla aquí beneficia a los ~20 reportes
// existentes sin tocarlos uno por uno.
class PlantillaReporteService {
  constructor(dbService) {
    this.configuracionRepository = new ConfiguracionRepository(dbService);
    // La carpeta 'data' donde vive el .db es la misma donde se guarda el logo (ver
    // config:subirLogo en main.js) — se deriva de la ruta del .db en vez de recibir baseDir
    // aparte, para no tener que hacer pasar un parámetro nuevo por cada constructor de la cadena.
    this.dataDir = path.dirname(dbService.getDbPath());
  }

  obtenerConfiguracionInstitucional() {
    const config = this.configuracionRepository.getAll();
    const logoBase64 = obtenerLogoBase64(this.dataDir, config.logo_path);

    return {
      nombreAsociacion: config.nombre_asociacion || 'Acueducto Veredal',
      nit: config.nit || '',
      direccion: config.direccion || '',
      ciudad: config.ciudad || '',
      telefono: config.telefono || '',
      email: config.email || '',
      logoBase64
    };
  }

  // Ancho mínimo "en caracteres" por columna según su tipo: moneda/fecha tienen un ancho típico
  // de dato aunque su label sea corto (ej. "Valor" mide 5 letras pero el dato "$1.234.567" no
  // cabe en eso); texto libre usa el label con un piso razonable.
  _anchoEstimadoColumna(col) {
    if (col.tipo === 'moneda') return Math.max((col.label || '').length, 12);
    if (col.tipo === 'fecha') return Math.max((col.label || '').length, 10);
    return Math.max((col.label || '').length, 14);
  }

  decidirOrientacion(documento) {
    let columnasPorParte = [];
    if (documento.tipo === 'compuesto') {
      columnasPorParte = (documento.partes || []).filter(p => p.tipo === 'tabla').map(p => p.columnas || []);
    } else if (documento.tipo === 'tabla') {
      columnasPorParte = [documento.columnas || []];
    }

    const anchoMaximo = columnasPorParte.reduce((max, columnas) => {
      const ancho = columnas.reduce((s, c) => s + this._anchoEstimadoColumna(c), 0);
      return Math.max(max, ancho);
    }, 0);

    return anchoMaximo > UMBRAL_ANCHO_HORIZONTAL ? 'horizontal' : 'vertical';
  }

  _renderEncabezadoInstitucional(config) {
    const lineaDatos = [
      config.nit && `NIT: ${escapeHtml(config.nit)}`,
      [config.direccion, config.ciudad].filter(Boolean).map(escapeHtml).join(', '),
      config.telefono && `Tel: ${escapeHtml(config.telefono)}`,
      config.email && escapeHtml(config.email)
    ].filter(Boolean).join(' &nbsp;|&nbsp; ');

    return `
      <div class="plantilla-encabezado">
        ${config.logoBase64 ? `<img class="plantilla-logo" src="${config.logoBase64}" alt="Logo">` : ''}
        <div class="plantilla-datos-institucionales">
          <h1>${escapeHtml(config.nombreAsociacion)}</h1>
          ${lineaDatos ? `<p>${lineaDatos}</p>` : ''}
        </div>
      </div>
    `;
  }

  _renderInfoReporte(documento) {
    const ahora = new Date();
    const fechaGeneracion = ahora.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
    const horaGeneracion = ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

    let lineaPeriodo = '';
    if (documento.periodo?.tipo === 'rango' && (documento.periodo.fechaDesde || documento.periodo.fechaHasta)) {
      const { fechaDesde, fechaHasta } = documento.periodo;
      lineaPeriodo = `<div>Período: <span>${fechaDesde ? formatFecha(fechaDesde) : 'inicio'} - ${fechaHasta ? formatFecha(fechaHasta) : 'hoy'}</span></div>`;
    } else if (documento.periodo?.tipo === 'corte') {
      lineaPeriodo = `<div>Fecha de corte: <span>${formatFecha(documento.periodo.fecha)}</span></div>`;
    }

    return `
      <div class="plantilla-info-reporte">
        <h2>${escapeHtml(documento.titulo)}</h2>
        <div class="plantilla-info-grid">
          ${lineaPeriodo}
          <div>Generado el: <span>${fechaGeneracion}, ${horaGeneracion}</span></div>
        </div>
      </div>
    `;
  }

  _renderFiltros(documento) {
    if (!documento.filtros || documento.filtros.length === 0) return '';
    return `
      <div class="plantilla-filtros">
        <strong>Filtros utilizados:</strong>
        ${documento.filtros.map(f => `<span class="plantilla-filtro-chip">${escapeHtml(f.label)}: ${escapeHtml(f.valor)}</span>`).join('')}
      </div>
    `;
  }

  _renderTabla(parte) {
    if (!parte.filas || parte.filas.length === 0) {
      return '<p style="text-align:center; color:#64748b; padding: 24px;">No hay datos para mostrar con los filtros seleccionados</p>';
    }

    const filasHtml = parte.filas.map(fila => `
      <tr>
        ${parte.columnas.map(col => {
          const valor = fila[col.key];
          if (col.tipo === 'moneda') return `<td class="text-right">$${formatNumber(valor)}</td>`;
          if (col.tipo === 'fecha') return `<td>${formatFecha(valor)}</td>`;
          return `<td>${escapeHtml(valor)}</td>`;
        }).join('')}
      </tr>
    `).join('');

    const filaTotales = parte.totales ? `
      <tr class="total-row">
        ${parte.columnas.map((col, i) => {
          if (i === 0) return '<td>TOTAL</td>';
          if (parte.totales[col.key] !== undefined) return `<td class="text-right">$${formatNumber(parte.totales[col.key])}</td>`;
          return '<td></td>';
        }).join('')}
      </tr>
    ` : '';

    return `
      <table>
        <thead><tr>${parte.columnas.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${filasHtml}${filaTotales}</tbody>
      </table>
    `;
  }

  _renderResumen(parte) {
    return parte.secciones.map(seccion => `
      <div class="resumen-section">
        <h3>${escapeHtml(seccion.titulo)}</h3>
        ${seccion.items.map(item => `
          <div class="resumen-row"><span>${escapeHtml(item.label)}</span><span>${formatValorResumen(item)}</span></div>
        `).join('')}
        <div class="resumen-total"><span>Total ${escapeHtml(seccion.titulo)}</span><span>${formatValorResumen({ valor: seccion.total, tipo: seccion.tipoValor })}</span></div>
      </div>
    `).join('');
  }

  _renderContenido(documento) {
    if (documento.tipo === 'compuesto') {
      return documento.partes.map(parte => `
        <h2 class="plantilla-subtitulo">${escapeHtml(parte.titulo)}</h2>
        ${parte.tipo === 'resumen' ? this._renderResumen(parte) : this._renderTabla(parte)}
      `).join('');
    }
    return documento.tipo === 'resumen' ? this._renderResumen(documento) : this._renderTabla(documento);
  }

  _renderPiePagina(nombreUsuario) {
    const ahora = new Date();
    return `
      <div class="plantilla-pie">
        Generado por ${escapeHtml(nombreUsuario || 'Usuario del sistema')} el ${ahora.toLocaleDateString('es-CO')} a las ${ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} &mdash; ${NOMBRE_SISTEMA}
      </div>
    `;
  }

  // Cuerpo completo del documento: igual en la vista previa (iframe) y en el PDF. El header/footer
  // que se repite por página en el PDF (paginación real) es aparte, ver construirHeaderTemplate/
  // construirFooterTemplate — Chromium los renderiza en un contexto aislado solo durante printToPDF,
  // no existe equivalente en pantalla.
  construirHTML(documento, config, nombreUsuario = null) {
    const orientacion = this.decidirOrientacion(documento);

    return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHtml(documento.titulo)}</title>
<style>
  @page { size: A4 ${orientacion === 'horizontal' ? 'landscape' : 'portrait'}; margin: 16mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #1f2937; }
  .plantilla-encabezado { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #1e40af; padding-bottom: 14px; margin-bottom: 16px; }
  .plantilla-logo { max-height: 56px; max-width: 120px; object-fit: contain; }
  .plantilla-datos-institucionales h1 { color: #1e40af; font-size: 19px; margin: 0 0 4px 0; }
  .plantilla-datos-institucionales p { font-size: 11px; color: #64748b; margin: 0; }
  .plantilla-info-reporte { margin-bottom: 12px; }
  .plantilla-info-reporte h2 { font-size: 16px; color: #1e293b; margin: 0 0 6px 0; }
  .plantilla-info-grid { display: flex; gap: 24px; font-size: 12px; color: #475569; }
  .plantilla-info-grid div span { font-weight: bold; color: #334155; }
  .plantilla-filtros { font-size: 12px; color: #475569; margin-bottom: 16px; padding: 8px 10px; background: #f8fafc; border-radius: 4px; }
  .plantilla-filtro-chip { display: inline-block; background: #e2e8f0; border-radius: 4px; padding: 2px 8px; margin: 2px 4px 2px 0; }
  .plantilla-subtitulo { color:#1e40af; font-size:16px; margin: 24px 0 8px 0; border-bottom: 2px solid #1e40af; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 12px; text-align: left; }
  th { background: #f1f5f9; color: #334155; }
  .text-right { text-align: right; }
  .total-row td { font-weight: bold; background: #eff6ff; }
  .resumen-section { margin-bottom: 20px; }
  .resumen-section h3 { color: #1e40af; font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .resumen-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
  .resumen-total { display: flex; justify-content: space-between; font-weight: bold; padding-top: 6px; border-top: 1px solid #cbd5e1; margin-top: 4px; font-size: 13px; }
  .plantilla-pie { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
</style>
</head>
<body>
  ${this._renderEncabezadoInstitucional(config)}
  ${this._renderInfoReporte(documento)}
  ${this._renderFiltros(documento)}
  ${this._renderContenido(documento)}
  ${this._renderPiePagina(nombreUsuario)}
</body>
</html>
    `;
  }

  // Chromium renderiza header/footerTemplate en un contexto aislado, sin la hoja de estilos de
  // la página principal: todo va con estilos inline, sin imágenes externas (por eso se mantiene
  // compacto, solo texto) y el espacio real disponible es pequeño.
  construirHeaderTemplate(config) {
    return `
      <div style="font-family: Arial, sans-serif; font-size: 8px; color: #475569; width: 100%; text-align: center; padding: 0 10mm;">
        ${escapeHtml(config.nombreAsociacion)}${config.nit ? ' &mdash; NIT: ' + escapeHtml(config.nit) : ''}
      </div>
    `;
  }

  // pageNumber/totalPages son clases que Electron/Chromium reemplaza automáticamente por el
  // número de página real y el total, calculado después de paginar todo el documento.
  construirFooterTemplate(nombreUsuario) {
    return `
      <div style="font-family: Arial, sans-serif; font-size: 8px; color: #94a3b8; width: 100%; text-align: center; padding: 0 10mm;">
        ${escapeHtml(nombreUsuario || '')} &mdash; Página <span class="pageNumber"></span> de <span class="totalPages"></span> &mdash; ${NOMBRE_SISTEMA}
      </div>
    `;
  }
}

module.exports = PlantillaReporteService;
