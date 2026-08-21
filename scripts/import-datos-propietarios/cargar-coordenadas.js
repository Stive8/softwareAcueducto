// Carga las coordenadas GPS (acometida/conexión y vivienda/casa) desde
// C:\Users\Brayhan\Desktop\DatosPropietariosCuentas.xlsx hacia la tabla `cuentas`.
//
// Reglas:
// - Nunca sobrescribe una coordenada que la cuenta ya tenga en la base de datos.
// - El emparejamiento código Excel <-> cuenta usa resolver-cuentas.js (compartido con los
//   demás scripts de esta carpeta): normaliza guiones y resuelve las 11 colisiones de código
//   conocidas prefiriendo la cuenta Activo. Ver ese archivo para el detalle de esas reglas.
const fs = require('fs');
const path = require('path');
const { EXCEL_PATH, leerFilasExcel, crearResolverCuenta } = require('./resolver-cuentas');

// S0332: el Excel trae "latitud Casa" = -75.353526 (un valor de longitud metido en la
// celda de latitud; claramente mal digitado). Confirmado con el usuario 2026-08-21: usar
// la misma coordenada de conexión también para la casa, en vez del valor corrupto.
const CASA_IGUAL_A_CONEXION = ['S0332'];

async function cargarCoordenadas({ dbService }) {
  const CuentaService = require('../../src/services/CuentaService');
  const service = new CuentaService(dbService);
  const db = dbService.getDb();

  const filas = await leerFilasExcel();

  const listaCuentas = db.prepare(`
    SELECT id, codigo, direccion, nombre_predio, observaciones, estado,
           lat_acometida, lon_acometida, lat_vivienda, lon_vivienda
    FROM cuentas
  `).all();
  const resolverCuenta = crearResolverCuenta(listaCuentas);

  const resultados = {
    actualizadas: [],       // {codigo, conexion:bool, casa:bool}
    yaCompletas: [],        // codigo (ya tenía ambas coordenadas)
    sinCoordenadasEnExcel: [], // codigo (fila del Excel sin ninguna coordenada)
    noEncontradas: [],      // codigo del Excel sin cuenta correspondiente en la base
    colisionesSinResolver: [],
    sinTocar: [],           // CODIGOS_SIN_TOCAR
    errores: []
  };

  for (const fila of filas) {
    const codigoExcel = fila.COD;
    const { cuenta, motivo } = resolverCuenta(codigoExcel);

    if (motivo === 'sin_tocar') { resultados.sinTocar.push(codigoExcel); continue; }
    if (motivo === 'colision_sin_resolver') { resultados.colisionesSinResolver.push(codigoExcel); continue; }
    if (!cuenta) { resultados.noEncontradas.push(codigoExcel); continue; }

    const excelConex = (fila['latitud Conexión'] && fila['Longitud Conexión'])
      ? [Number(fila['latitud Conexión']), Number(fila['Longitud Conexión'])] : null;
    let excelCasa = (fila['latitud Casa'] && fila['Longitud Casa'])
      ? [Number(fila['latitud Casa']), Number(fila['Longitud Casa'])] : null;

    if (CASA_IGUAL_A_CONEXION.includes(codigoExcel) && excelConex) {
      excelCasa = excelConex;
    }

    if (!excelConex && !excelCasa) { resultados.sinCoordenadasEnExcel.push(codigoExcel); continue; }

    const dbHasConex = cuenta.lat_acometida != null && cuenta.lon_acometida != null;
    const dbHasCasa = cuenta.lat_vivienda != null && cuenta.lon_vivienda != null;

    const nuevoConex = !dbHasConex && excelConex;
    const nuevoCasa = !dbHasCasa && excelCasa;

    if (!nuevoConex && !nuevoCasa) { resultados.yaCompletas.push(cuenta.codigo); continue; }

    try {
      service.update(cuenta.id, {
        codigo: cuenta.codigo,
        direccion: cuenta.direccion,
        nombre_predio: cuenta.nombre_predio,
        observaciones: cuenta.observaciones,
        lat_acometida: nuevoConex ? excelConex[0] : cuenta.lat_acometida,
        lon_acometida: nuevoConex ? excelConex[1] : cuenta.lon_acometida,
        lat_vivienda: nuevoCasa ? excelCasa[0] : cuenta.lat_vivienda,
        lon_vivienda: nuevoCasa ? excelCasa[1] : cuenta.lon_vivienda
      });
      resultados.actualizadas.push({
        codigo: cuenta.codigo,
        codigoExcel,
        conexion: !!nuevoConex,
        casa: !!nuevoCasa
      });
    } catch (e) {
      resultados.errores.push({ codigo: cuenta.codigo, codigoExcel, error: e.message });
    }
  }

  return resultados;
}

module.exports = { cargarCoordenadas, EXCEL_PATH };

if (require.main === module) {
  (async () => {
    const DatabaseService = require('../../src/database/DatabaseService');
    const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
    dbService.initialize();

    const r = await cargarCoordenadas({ dbService });

    console.log(`\n=== Carga de coordenadas (${EXCEL_PATH}) ===`);
    console.log(`Cuentas actualizadas: ${r.actualizadas.length}`);
    const soloConex = r.actualizadas.filter(a => a.conexion && !a.casa).length;
    const soloCasa = r.actualizadas.filter(a => !a.conexion && a.casa).length;
    const ambas = r.actualizadas.filter(a => a.conexion && a.casa).length;
    console.log(`  - con conexión y casa nuevas: ${ambas}`);
    console.log(`  - solo conexión nueva: ${soloConex}`);
    console.log(`  - solo casa nueva: ${soloCasa}`);
    console.log(`Ya tenían ambas coordenadas (sin cambios): ${r.yaCompletas.length}`);
    console.log(`Filas del Excel sin ninguna coordenada: ${r.sinCoordenadasEnExcel.length} -> ${r.sinCoordenadasEnExcel.join(', ')}`);
    console.log(`Códigos del Excel sin cuenta correspondiente en la base: ${r.noEncontradas.length} -> ${r.noEncontradas.join(', ')}`);
    console.log(`Colisiones sin resolver: ${r.colisionesSinResolver.length} -> ${r.colisionesSinResolver.join(', ')}`);
    console.log(`Códigos dejados sin tocar a propósito: ${r.sinTocar.length} -> ${r.sinTocar.join(', ')}`);
    if (r.errores.length) {
      console.log(`\nERRORES (${r.errores.length}):`);
      r.errores.forEach(e => console.log(`  ${e.codigoExcel} (${e.codigo}): ${e.error}`));
    }

    const outDir = path.join(__dirname, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `coordenadas_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
    console.log(`\nReporte completo: ${outPath}`);

    dbService.close();
  })().catch(e => { console.error(e); process.exit(1); });
}
