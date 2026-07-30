// scripts/import-cartera/leer-cartera.js
const { abrirLibro, hoja, valorCelda } = require('./leer-excel');
const { normalizarCodigo } = require('./codigos');

const HOJA_ESTADO = 'ESTADO DE CUENTA ASOCIADOS';
const HOJA_MOVIMIENTO = 'estado cta con movimiento';

const COL = {
  codigo: 4, nombre: 5, mensualidadVieja: 7, saldo2020: 8,
  saldoPagos2021: 15, mensualidad2024: 26, saldoReferencia2025: 33,
  observaciones: 40, cuandoEmpezo: 41
};

// Columnas de datos de "estado cta con movimiento". El encabezado de la fila 1 de esta hoja
// está desalineado respecto a los datos (arrastre de una edición manual vieja): la columna
// rotulada "Codigo Cta" en la fila 1 no es la misma que trae el código en las filas de datos.
// Se usa la columna que de verdad trae el código en los datos (verificado contra el archivo
// real: fila 3 en adelante, col 1 = código, col 4 = Saldo Mes Ant., col 7 = Saldo Mes).
const COL_MOV = { codigo: 1, saldoMes: 7 };
const PRIMERA_FILA_DATOS_MOV = 3;

const num = (v) => (typeof v === 'number' ? v : null);
const texto = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
};

// Resuelve el VLOOKUP que la hoja ESTADO DE CUENTA ASOCIADOS no alcanzó a guardar, buscando el
// código en la hoja fuente "estado cta con movimiento" (números planos, sin fórmulas).
//
// El mapa se indexa por el código NORMALIZADO, y se consulta igual: las dos hojas escriben el
// mismo código con formatos distintos (R-034 / R034), que es el desajuste que explica el 86% de
// los códigos huérfanos reales (ver codigos.js). Comparando el texto crudo, el lookup fallaba en
// silencio y la apertura opaca caía a saldo2020 o a 'ninguna', perdiendo el dato real.
function construirMapaMovimiento(ws) {
  const mapa = new Map();
  for (let i = PRIMERA_FILA_DATOS_MOV; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const codigo = texto(valorCelda(row.getCell(COL_MOV.codigo)));
    if (!codigo) continue;
    const codigoNorm = normalizarCodigo(codigo);
    const saldoMes = num(valorCelda(row.getCell(COL_MOV.saldoMes)));
    if (saldoMes !== null && !mapa.has(codigoNorm)) mapa.set(codigoNorm, saldoMes);
  }
  return mapa;
}

// Cascada de apertura opaca (spec §10.1):
//  1) celda 15 (SALDO PAGOS 31/12/2021) si tiene resultado guardado
//  2) si no, resolver contra la hoja fuente del VLOOKUP
//  3) si tampoco está ahí, SALDO A 31 12 2020 (número plano)
//  4) si no hay ningún dato, fuente 'ninguna' con monto 0 (preview.js decide si es legítimo)
function resolverApertura(celda15, codigo, mapaMovimiento, saldo2020) {
  if (typeof celda15 === 'number') return { monto: celda15, fuente: 'vlookup' };
  const codigoNorm = normalizarCodigo(codigo);
  if (mapaMovimiento.has(codigoNorm)) return { monto: mapaMovimiento.get(codigoNorm), fuente: 'vlookup' };
  if (typeof saldo2020 === 'number') return { monto: saldo2020, fuente: 'saldo2020' };
  return { monto: 0, fuente: 'ninguna' };
}

async function leerCartera(filePath) {
  const wb = await abrirLibro(filePath);
  const wsMov = hoja(wb, HOJA_MOVIMIENTO);
  const wsEst = hoja(wb, HOJA_ESTADO);
  const mapaMovimiento = construirMapaMovimiento(wsMov);

  const registros = [];
  for (let i = 2; i <= wsEst.rowCount; i++) {
    const row = wsEst.getRow(i);
    const codigo = texto(valorCelda(row.getCell(COL.codigo)));
    if (!codigo) continue;

    const celda15 = valorCelda(row.getCell(COL.saldoPagos2021));
    const saldo2020 = num(valorCelda(row.getCell(COL.saldo2020)));
    const mensualidadVieja = num(valorCelda(row.getCell(COL.mensualidadVieja)));
    const mensualidad2024 = num(valorCelda(row.getCell(COL.mensualidad2024))) ?? mensualidadVieja;

    registros.push({
      codigo,
      mensualidadVieja,
      mensualidad2024,
      aperturaOpaca: resolverApertura(typeof celda15 === 'number' ? celda15 : null, codigo, mapaMovimiento, saldo2020),
      saldoReferencia2025: num(valorCelda(row.getCell(COL.saldoReferencia2025))),
      cuandoEmpezo: texto(valorCelda(row.getCell(COL.cuandoEmpezo))),
      observaciones: texto(valorCelda(row.getCell(COL.observaciones)))
    });
  }
  return registros;
}

module.exports = { leerCartera };
