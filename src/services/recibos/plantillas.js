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
  const fecha = new Date(/^\d{4}-\d{2}-\d{2}$/.test(fechaString) ? fechaString + 'T00:00:00' : fechaString);
  return fecha.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatPeriodo(d) {
  if (!d.periodo_desde) return '-';
  return escapeHtml(d.periodo_desde) + (d.periodo_hasta && d.periodo_hasta !== d.periodo_desde ? ' - ' + escapeHtml(d.periodo_hasta) : '');
}

// Diseño original del recibo, sin cambios respecto al que existía antes de separar datos y
// presentación -- la única adición es el logo institucional (opcional, ausente = idéntico al
// HTML anterior byte a byte salvo por este comentario).
function renderCarta(datos) {
  const config = datos.config;

  const filasDetalle = datos.detalles.map(d => `
    <tr>
      <td>${escapeHtml(d.concepto)}</td>
      <td>${formatPeriodo(d)}</td>
      <td class="text-right">$${formatNumber(d.valor)}</td>
    </tr>
  `).join('');

  const bloqueTexto = `
    <h1>${escapeHtml(config.nombre_asociacion || 'Acueducto Veredal')}</h1>
    ${config.nit ? `<p>NIT: ${escapeHtml(config.nit)}</p>` : ''}
    ${config.direccion ? `<p>${escapeHtml(config.direccion)}</p>` : ''}
    ${config.telefono ? `<p>Tel: ${escapeHtml(config.telefono)}</p>` : ''}
  `;

  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Recibo No. ${escapeHtml(datos.numero_recibo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 32px; color: #1f2937; }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #1e40af; padding-bottom: 16px; }
  .header-flex { display: flex; align-items: center; justify-content: center; gap: 16px; }
  .header-logo { max-height: 64px; max-width: 140px; object-fit: contain; }
  .header-texto { text-align: left; }
  .header h1 { color: #1e40af; font-size: 22px; margin: 0 0 6px 0; }
  .header p { font-size: 12px; color: #475569; margin: 2px 0; }
  .recibo-numero { text-align: right; font-size: 18px; font-weight: bold; color: #1e40af; margin-bottom: 20px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 24px; font-size: 13px; }
  .info-grid div span { font-weight: bold; color: #334155; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #cbd5e1; padding: 10px 12px; font-size: 13px; text-align: left; }
  th { background: #f1f5f9; color: #334155; }
  .total-row td { font-weight: bold; font-size: 14px; background: #eff6ff; }
  .text-right { text-align: right; }
  .footer { margin-top: 32px; font-size: 11px; color: #64748b; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    ${config.logoBase64 ? `
    <div class="header-flex">
      <img class="header-logo" src="${config.logoBase64}" alt="Logo">
      <div class="header-texto">${bloqueTexto}</div>
    </div>
    ` : bloqueTexto}
  </div>

  <div class="recibo-numero">Recibo No. ${escapeHtml(datos.numero_recibo)}${datos.estado === 'Anulado' ? ' <span style="color:#dc2626;">— ANULADO</span>' : ''}</div>
  ${datos.estado === 'Anulado' ? `<p style="color:#dc2626; font-size: 12px; text-align: center; margin: -12px 0 16px 0;">Este recibo fue anulado${datos.motivo_anulacion ? ': ' + escapeHtml(datos.motivo_anulacion) : ''}</p>` : ''}

  <div class="info-grid">
    <div>Fecha: <span>${escapeHtml(formatFecha(datos.fecha_recibo))}</span></div>
    <div>Método de pago: <span>${escapeHtml(datos.metodo_pago)}</span></div>
    <div>Cuenta: <span>${escapeHtml(datos.cuenta_codigo)}</span></div>
    <div>Dirección: <span>${escapeHtml(datos.cuenta_direccion)}</span></div>
    <div>Propietario: <span>${escapeHtml(datos.propietario_nombre)}</span></div>
  </div>

  <table>
    <thead>
      <tr><th>Concepto</th><th>Período</th><th class="text-right">Valor</th></tr>
    </thead>
    <tbody>
      ${filasDetalle}
      <tr class="total-row"><td colspan="2">TOTAL</td><td class="text-right">$${formatNumber(datos.total)}</td></tr>
    </tbody>
  </table>

  ${datos.observaciones ? `<p style="font-size:13px;"><strong>Observaciones:</strong> ${escapeHtml(datos.observaciones)}</p>` : ''}

  <div class="footer">Documento generado por el sistema administrativo del acueducto. Gracias por contribuir al sostenimiento y funcionamiento de nuestra asociación.</div>
</body>
</html>
  `;
}

// Diseño propio para impresoras térmicas POS de 80mm: una sola columna, sin tablas, tipografía
// más grande para el número de recibo y el total (lo más visible del ticket), texto envuelto por
// palabra para que conceptos largos ("CUOTA DE SOSTENIMIENTO DE ENERO A DICIEMBRE 2024") no
// rompan el layout. El logo es opcional y pequeño (ausente = igual que antes): la mayoría de
// impresoras térmicas imprimen en blanco y negro, así que un logo con mucho detalle o color puede
// salir borroso -- queda a criterio del acueducto tener uno simple/alto contraste si lo usa aquí.
function renderTermico80mm(datos) {
  const config = datos.config;

  const bloquesDetalle = datos.detalles.map(d => `
    <div class="detalle">
      <div class="detalle-concepto">${escapeHtml(d.concepto)}</div>
      <div class="detalle-periodo">${formatPeriodo(d)}</div>
      <div class="detalle-valor">$${formatNumber(d.valor)}</div>
    </div>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Recibo No. ${escapeHtml(datos.numero_recibo)}</title>
<style>
  * { box-sizing: border-box; }
  /* 71mm, no el límite físico exacto de 72mm: un cabezal térmico no tiene margen propio (a
     diferencia de una impresora de tinta/láser), así que pedirle a Chromium exactamente el ancho
     máximo del cabezal deja cero margen de error entre el layout del navegador y lo que el driver
     interpreta -- se vio en pruebas de campo que el contenido queda al borde mismo del corte.
     Restar 1mm de colchón horizontal cuesta un margen imperceptible a cambio de no operar al
     límite en cada impresión (mismo criterio que ya usa MARGEN_ALTURA_TERMICO_MICRONES para el
     alto en recibosHandlers.js). Sin padding en el body: a este ancho ya estamos cerca del límite
     físico del cabezal, no en un margen de diseño sobre un ancho de papel más generoso -- restar
     padding aquí reduciría aún más el área útil. Los bloques internos no necesitan ancho explícito:
     heredan el 100% del body.
     Todo el texto en negro puro (#000), sin la jerarquía de grises que sí tiene sentido en pantalla
     o PDF: un cabezal térmico es 1 bit (blanco o negro), así que un gris se trama a puntos dispersos
     y sale "lavado"/apenas legible en papel -- se vio en pruebas de campo en los datos
     institucionales y el pie de página, que antes usaban gris. El ruido/pixelado en textos grandes
     (título, número de recibo) es otro fenómeno -- proviene del antialiasing con el que Chromium
     dibuja las fuentes, que el driver tiene que tramar a 1 bit -- y esto no lo corrige el color. */
  @page { size: 71mm auto; margin: 0; }
  /* Respaldo de los tamaños previos, por si hay que volver atrás: body/detalle-concepto/
     detalle-valor/recibo-fecha/anulado/total-etiqueta 11px, nombre-asociacion 13px,
     dato-institucional/detalle-periodo/observaciones 10px, recibo-numero 15px, total-valor 18px,
     pie 9px. Se subieron ~2px parejo a pedido de campo: en mano, con el papel real, se veían
     chicos. padding-bottom en 30mm (deliberadamente exagerado, no es el valor final): en pruebas
     de campo, 8mm de aire sumados a los 10mm que ya agrega MARGEN_ALTURA_TERMICO_MICRONES
     (recibosHandlers.js) no generaron NINGÚN margen visible antes del corte -- indicio de que el
     driver recorta el blanco sobrante en vez de alimentar papel de más. Este valor exagerado es
     para confirmar esa hipótesis: si tampoco se nota, el ajuste no puede resolverse por este
     lado y hay que buscarlo en las propiedades del driver (o aceptar el corte ajustado, que es
     el comportamiento normal de la mayoría de impresoras térmicas POS). */
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #000; width: 71mm; margin: 0; padding: 0 0 30mm 0; }
  .centro { text-align: center; }
  .separador { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .logo-termico { display: block; max-width: 60mm; max-height: 26mm; object-fit: contain; margin: 0 auto 4px auto; filter: grayscale(1) contrast(2); }
  .nombre-asociacion { font-size: 15px; font-weight: bold; margin: 0 0 2px 0; }
  .dato-institucional { font-size: 12px; margin: 1px 0; }
  .recibo-numero { font-size: 17px; font-weight: bold; margin: 6px 0 0 0; }
  .recibo-fecha { font-size: 13px; margin: 2px 0 0 0; }
  .anulado { color: #dc2626; font-weight: bold; font-size: 13px; }
  .campo { margin: 3px 0; word-wrap: break-word; overflow-wrap: break-word; }
  .campo-etiqueta { font-weight: bold; }
  .detalle { margin: 6px 0; word-wrap: break-word; overflow-wrap: break-word; }
  .detalle-concepto { font-size: 13px; }
  .detalle-periodo { font-size: 12px; }
  .detalle-valor { font-size: 13px; text-align: right; font-weight: bold; }
  .total-bloque { margin: 8px 0; padding: 6px; border: 1px solid #000; text-align: center; }
  .total-etiqueta { font-size: 13px; font-weight: bold; }
  .total-valor { font-size: 20px; font-weight: bold; }
  .observaciones { font-size: 12px; word-wrap: break-word; overflow-wrap: break-word; margin: 4px 0; }
  .pie { font-size: 11px; text-align: center; margin-top: 8px; }
</style>
</head>
<body>
  <div class="centro">
    ${config.logoBase64 ? `<img class="logo-termico" src="${config.logoBase64}" alt="Logo">` : ''}
    <p class="nombre-asociacion">${escapeHtml(config.nombre_asociacion || 'Acueducto Veredal')}</p>
    ${config.nit ? `<p class="dato-institucional">NIT: ${escapeHtml(config.nit)}</p>` : ''}
    ${config.direccion ? `<p class="dato-institucional">${escapeHtml(config.direccion)}</p>` : ''}
    ${config.telefono ? `<p class="dato-institucional">Tel: ${escapeHtml(config.telefono)}</p>` : ''}
  </div>

  <hr class="separador">

  <div class="centro">
    <p class="recibo-numero">RECIBO No. ${escapeHtml(datos.numero_recibo)}</p>
    <p class="recibo-fecha">${escapeHtml(formatFecha(datos.fecha_recibo))}</p>
    ${datos.estado === 'Anulado' ? `<p class="anulado">ANULADO${datos.motivo_anulacion ? ': ' + escapeHtml(datos.motivo_anulacion) : ''}</p>` : ''}
  </div>

  <hr class="separador">

  <div class="campo"><span class="campo-etiqueta">Cuenta:</span> ${escapeHtml(datos.cuenta_codigo)}</div>
  <div class="campo"><span class="campo-etiqueta">Dirección:</span> ${escapeHtml(datos.cuenta_direccion)}</div>
  <div class="campo"><span class="campo-etiqueta">Propietario:</span> ${escapeHtml(datos.propietario_nombre)}</div>

  <hr class="separador">

  ${bloquesDetalle}

  <div class="total-bloque">
    <div class="total-etiqueta">TOTAL</div>
    <div class="total-valor">$${formatNumber(datos.total)}</div>
  </div>

  <div class="campo"><span class="campo-etiqueta">Método de pago:</span> ${escapeHtml(datos.metodo_pago)}</div>
  ${datos.observaciones ? `<div class="observaciones"><span class="campo-etiqueta">Obs:</span> ${escapeHtml(datos.observaciones)}</div>` : ''}

  <hr class="separador">

  <p class="pie">Documento generado por el sistema administrativo del acueducto.<br>Gracias por contribuir al sostenimiento y funcionamiento de nuestra asociación.</p>
</body>
</html>
  `;
}

const PLANTILLAS = Object.assign(Object.create(null), {
  carta: renderCarta,
  termico_80mm: renderTermico80mm
});

module.exports = { PLANTILLAS };
