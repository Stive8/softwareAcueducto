// scripts/import-gastos/preview.js
const fs = require('fs');
const path = require('path');
const { CONFIG_HOJAS } = require('./config-hojas');
const { leerHoja } = require('./leer-excel');
const { clasificarTipoGasto, resolverTercero, normalizarNombre } = require('./clasificar');
const { stringifyCsv } = require('./csv');

const COLUMNAS = [
  'fila_excel', 'hoja', 'accion', 'fecha', 'tercero_modo', 'tercero_id',
  'tercero_tipo_id', 'tercero_numero_id', 'tercero_nombre', 'tipo_gasto',
  'confianza', 'valor', 'concepto', 'observaciones',
];

function cargarTerceros(dbService) {
  const rows = dbService.getDb().prepare(`SELECT id, numero_identificacion, nombre_razon_social FROM terceros`).all();
  return rows.map((t) => ({ ...t, nombre_norm: normalizarNombre(t.nombre_razon_social) }));
}

function nombreHoja(hoja) {
  return `GASTOS GENERALES ${hoja}`;
}

async function generarPreview({ filePath, hoja, dbService, outDir }) {
  const config = CONFIG_HOJAS[hoja];
  if (!config) throw new Error(`Hoja desconocida: ${hoja}`);
  const { filas, excluidas } = await leerHoja(filePath, nombreHoja(hoja), config);
  const terceros = cargarTerceros(dbService);

  const filasCsv = filas.map((f) => {
    const { tipoGasto, confianza } = clasificarTipoGasto(f.concepto);
    const t = resolverTercero({ nombre: f.nombre, identificacion: f.identificacion }, { terceros });

    let terceroId = '', tipoId = '', numeroId = '', terceroNombre = '', observaciones = '';
    if (t.modo === 'existente') terceroId = t.terceroId;
    else if (t.modo === 'revisar_nombre') { terceroId = t.terceroIdSugerido; observaciones = `nombre Excel: ${t.nombreOriginal}`; }
    else if (t.modo === 'nuevo') { tipoId = t.tipoIdentificacion; numeroId = t.numeroIdentificacion; terceroNombre = t.nombreRazonSocial; }
    else if (t.modo === 'no_informado') observaciones = `nombre Excel: ${t.nombreOriginal}`;

    const revisar = !tipoGasto || t.modo === 'no_informado' || t.modo === 'revisar_nombre' || confianza === 'media';
    return {
      fila_excel: f.filaExcel, hoja, accion: revisar ? 'REVISAR' : 'IMPORTAR', fecha: f.fecha,
      tercero_modo: t.modo, tercero_id: terceroId, tercero_tipo_id: tipoId, tercero_numero_id: numeroId,
      tercero_nombre: terceroNombre, tipo_gasto: tipoGasto || '', confianza, valor: f.valor,
      concepto: f.concepto, observaciones,
    };
  });

  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, `${hoja}-preview.csv`);
  const excluidasPath = path.join(outDir, `${hoja}-excluidas.csv`);
  fs.writeFileSync(csvPath, stringifyCsv(COLUMNAS, filasCsv), 'utf8');
  // leerHoja devuelve { filaExcel, motivo } (camelCase); se remapea a fila_excel para que
  // stringifyCsv (que indexa row[header]) no escriba la columna vacía.
  const excluidasCsv = excluidas.map((e) => ({ fila_excel: e.filaExcel, motivo: e.motivo }));
  fs.writeFileSync(excluidasPath, stringifyCsv(['fila_excel', 'motivo'], excluidasCsv), 'utf8');

  const resumen = {
    total: filasCsv.length,
    importar: filasCsv.filter((f) => f.accion === 'IMPORTAR').length,
    revisar: filasCsv.filter((f) => f.accion === 'REVISAR').length,
    excluidas: excluidas.length,
    totalValor: filasCsv.reduce((s, f) => s + Number(f.valor), 0),
  };
  return { csvPath, excluidasPath, resumen };
}

module.exports = { generarPreview, COLUMNAS };

// --- CLI ---
if (require.main === module) {
  const DatabaseService = require('../../src/database/DatabaseService');
  const hoja = process.argv[2];
  const rutaXlsx = process.argv[3] || 'C:\\Users\\Brayhan\\Documents\\ACUEDUCTO\\Gastos Totales.xlsx';
  if (!hoja) { console.error('Uso: preview.js <hoja: 2022..2026> [rutaXlsx]'); process.exit(1); }
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();
  const outDir = path.join(__dirname, 'output');
  generarPreview({ filePath: rutaXlsx, hoja, dbService, outDir })
    .then(({ csvPath, resumen }) => {
      console.log(`Preview de ${hoja} → ${csvPath}`);
      console.log(`  Total ${resumen.total} | IMPORTAR ${resumen.importar} | REVISAR ${resumen.revisar} | excluidas ${resumen.excluidas}`);
      console.log(`  Suma valor: $${resumen.totalValor.toLocaleString('es-CO')}`);
      dbService.close();
    })
    .catch((e) => { console.error(e); dbService.close(); process.exit(1); });
}
