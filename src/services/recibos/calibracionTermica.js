// Página de diagnóstico para validar el ancho imprimible real de una térmica de 80mm antes de
// confiar en la vía driver/GDI para recibos reales. No depende de ReciboService: es una regla en
// papel, no un documento del negocio. Pensada para borrarse (o quedar sin usar) una vez validado
// el ancho -- ver ANCHO_TERMICO_MICRONES en recibosHandlers.js para el contexto de por qué existe.
function generarHTMLCalibracion() {
  const marcas = [];
  for (let mm = 0; mm <= 72; mm += 10) {
    marcas.push(mm);
  }

  const divsMarca = marcas.map(mm => `
    <div class="marca" style="left:${mm}mm;"></div>
    <div class="etiqueta" style="left:${mm}mm;">${mm}</div>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Calibración térmica 72mm</title>
<style>
  * { box-sizing: border-box; }
  @page { size: 72mm auto; margin: 0; }
  body { width: 72mm; margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; }
  .lienzo { position: relative; width: 100%; height: 100mm; border: 1px solid #000; overflow: hidden; }
  .marca { position: absolute; top: 0; bottom: 0; border-left: 1px dashed #000; width: 0; }
  .etiqueta { position: absolute; top: 2mm; font-size: 8px; transform: translateX(-50%); }
  .borde-derecho { position: absolute; right: 1mm; top: 30mm; font-size: 8px; writing-mode: vertical-rl; }
  .pie { font-size: 9px; text-align: center; margin-top: 2mm; }
</style>
</head>
<body>
  <div class="lienzo">
    ${divsMarca}
    <div class="borde-derecho">BORDE DERECHO -- si esto no sale impreso, se está recortando</div>
  </div>
  <p class="pie">72mm = ancho imprimible real (GA-E200I). Medir con regla: cada marca debe caer a 0,10,20...70mm del borde izquierdo, y el borde derecho del recuadro debe coincidir con el borde del papel imprimible.</p>
</body>
</html>
  `;
}

module.exports = { generarHTMLCalibracion };
