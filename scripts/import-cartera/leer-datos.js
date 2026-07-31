// scripts/import-cartera/leer-datos.js
const { abrirLibro, hoja, valorCelda } = require('./leer-excel');

const HOJA = 'Hoja1';
const COL = { codigo: 1, tipo: 10, observacion: 12 };
const PRIMERA_FILA = 2;
const ULTIMA_FILA = 300;   // 301+ son puntos "piratas" sin código, fuera de alcance (spec §12)

const PATRON_SUSPENSION = /SUSPEND|NO EXISTE|NO ENCONTRADO|ABANDONADA/i;

const texto = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
};

async function leerDatosMaestros(filePath) {
  const wb = await abrirLibro(filePath);
  const ws = hoja(wb, HOJA);

  const registros = [];
  const hasta = Math.min(ws.rowCount, ULTIMA_FILA);
  for (let i = PRIMERA_FILA; i <= hasta; i++) {
    const row = ws.getRow(i);
    const codigo = texto(valorCelda(row.getCell(COL.codigo)));
    if (!codigo) continue;

    const observacion = texto(valorCelda(row.getCell(COL.observacion)));
    registros.push({
      codigo,
      tipo: texto(valorCelda(row.getCell(COL.tipo))),
      observacion,
      candidatoSuspension: observacion ? PATRON_SUSPENSION.test(observacion) : false
    });
  }
  return registros;
}

module.exports = { leerDatosMaestros, PATRON_SUSPENSION };
