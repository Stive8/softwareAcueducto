const fs = require('fs');
const path = require('path');

// Reconstruye el logo institucional (guardado como solo el NOMBRE del archivo en
// configuracion.logo_path) a una data URI embebible en HTML, para no depender de una ruta
// absoluta que cambia entre equipos. Compartido por cualquier plantilla que muestre el logo
// (reportes en PDF/Excel, recibo en formato carta).
function obtenerLogoBase64(dataDir, logoPath) {
  if (!logoPath) return null;

  const logoFile = path.join(dataDir, logoPath);
  if (!fs.existsSync(logoFile)) return null;

  const ext = path.extname(logoFile).toLowerCase().replace('.', '');
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(logoFile).toString('base64')}`;
}

module.exports = { obtenerLogoBase64 };
