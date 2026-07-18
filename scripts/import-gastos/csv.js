// scripts/import-gastos/csv.js
// CSV mínimo (RFC-4180) suficiente para el flujo preview→revisión→commit. Los conceptos traen
// comas y comillas, así que hay que citar/escapar; NO se soportan saltos de línea dentro de un
// campo (leer-excel.js los colapsa antes de escribir), lo que permite parsear por líneas.
function escaparCampo(valor) {
  const s = valor == null ? '' : String(valor);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function stringifyCsv(headers, rows) {
  const lineas = [headers.map(escaparCampo).join(',')];
  for (const row of rows) {
    lineas.push(headers.map((h) => escaparCampo(row[h])).join(','));
  }
  return lineas.join('\n');
}

// Parseo de una línea CSV en campos, respetando comillas dobles y "" como comilla escapada.
function parsearLinea(linea) {
  const campos = [];
  let campo = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (enComillas) {
      if (ch === '"' && linea[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') { enComillas = false; }
      else { campo += ch; }
    } else {
      if (ch === '"') { enComillas = true; }
      else if (ch === ',') { campos.push(campo); campo = ''; }
      else { campo += ch; }
    }
  }
  campos.push(campo);
  return campos;
}

function parseCsv(texto) {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lineas.length === 0) return [];
  const headers = parsearLinea(lineas[0]);
  return lineas.slice(1).map((linea) => {
    const campos = parsearLinea(linea);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = campos[i] ?? ''; });
    return obj;
  });
}

module.exports = { stringifyCsv, parseCsv };
