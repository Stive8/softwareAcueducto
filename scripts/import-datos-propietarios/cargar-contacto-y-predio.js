// Carga, desde C:\Users\Brayhan\Desktop\DatosPropietariosCuentas.xlsx:
// - CEDULA/TELEFONO/CORREO -> propietarios.numero_identificacion/telefono/email
// - NOMBRE FINCA -> cuentas.nombre_predio
//
// Reglas:
// - Nunca sobrescribe un valor que ya exista en la base de datos (por campo, no por fila
//   completa: si falta solo el teléfono, se carga solo el teléfono).
// - NOMBRE FINCA es un dato del predio (la cuenta), independiente de quién sea el propietario
//   actual, así que se carga para toda cuenta resuelta sin más condición.
// - CEDULA/TELEFONO/CORREO son datos de una PERSONA. Antes de escribirlos se compara el
//   NOMBRE del Excel contra el nombre del propietario vigente en la base (comparación laxa,
//   por palabras en común); si no hay suficiente coincidencia, la cuenta se deja fuera y se
//   reporta en `nombreNoCoincide` en vez de arriesgarse a pegarle el dato de una persona a
//   otra. Ver DECISIONES-2026-08-21.md (o el reporte JSON) para la lista completa a revisar
//   a mano.
const fs = require('fs');
const path = require('path');
const { EXCEL_PATH, leerFilasExcel, crearResolverCuenta } = require('./resolver-cuentas');

const UMBRAL_COINCIDENCIA_NOMBRE = 0.5;

function normalizarNombre(s) {
  return (s || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// Coincidencia laxa por palabras en común (no se puede exigir exactitud: el mismo nombre
// aparece con distinto orden, apodos entre paréntesis, o un solo apellido en la base).
function nombresCoinciden(excelNombre, dbNombre) {
  const a = normalizarNombre(excelNombre);
  const b = normalizarNombre(dbNombre);
  if (!a || !b) return false;
  const tokensA = new Set(a.split(' ').filter(Boolean));
  const tokensB = new Set(b.split(' ').filter(Boolean));
  let overlap = 0;
  for (const t of tokensA) if (tokensB.has(t)) overlap++;
  return (overlap / Math.max(tokensA.size, 1)) >= UMBRAL_COINCIDENCIA_NOMBRE;
}

async function cargarContactoYPredio({ dbService }) {
  const CuentaService = require('../../src/services/CuentaService');
  const PropietarioService = require('../../src/services/PropietarioService');
  const cuentaService = new CuentaService(dbService);
  const propietarioService = new PropietarioService(dbService);
  const db = dbService.getDb();

  const filas = await leerFilasExcel();

  const listaCuentas = db.prepare(`
    SELECT id, codigo, direccion, nombre_predio, observaciones, estado,
           lat_acometida, lon_acometida, lat_vivienda, lon_vivienda
    FROM cuentas
  `).all();
  const resolverCuenta = crearResolverCuenta(listaCuentas);

  const resultados = {
    predioActualizado: [],      // codigo
    predioYaTenia: [],          // codigo
    contactoActualizado: [],    // {codigo, cedula:bool, telefono:bool, correo:bool}
    contactoYaCompleto: [],     // codigo
    sinPropietarioVigente: [],  // codigo (no se puede cargar contacto, sí predio)
    nombreNoCoincide: [],       // {codigo, excel, db} -- se reporta, no se carga contacto
    noEncontradas: [],
    colisionesSinResolver: [],
    sinTocar: [],
    errores: []
  };

  for (const fila of filas) {
    const codigoExcel = fila.COD;
    const { cuenta, motivo } = resolverCuenta(codigoExcel);

    if (motivo === 'sin_tocar') { resultados.sinTocar.push(codigoExcel); continue; }
    if (motivo === 'colision_sin_resolver') { resultados.colisionesSinResolver.push(codigoExcel); continue; }
    if (!cuenta) { resultados.noEncontradas.push(codigoExcel); continue; }

    // --- NOMBRE FINCA -> cuentas.nombre_predio ---
    const nombreFinca = fila['NOMBRE FINCA'];
    if (nombreFinca && !cuenta.nombre_predio) {
      try {
        cuentaService.update(cuenta.id, {
          codigo: cuenta.codigo,
          direccion: cuenta.direccion,
          nombre_predio: nombreFinca,
          observaciones: cuenta.observaciones,
          lat_acometida: cuenta.lat_acometida,
          lon_acometida: cuenta.lon_acometida,
          lat_vivienda: cuenta.lat_vivienda,
          lon_vivienda: cuenta.lon_vivienda
        });
        resultados.predioActualizado.push(cuenta.codigo);
      } catch (e) {
        resultados.errores.push({ codigo: cuenta.codigo, codigoExcel, campo: 'nombre_predio', error: e.message });
      }
    } else if (nombreFinca && cuenta.nombre_predio) {
      resultados.predioYaTenia.push(cuenta.codigo);
    }

    // --- CEDULA/TELEFONO/CORREO -> propietarios (del propietario vigente de la cuenta) ---
    const propietario = db.prepare(`
      SELECT p.* FROM propietarios p
      INNER JOIN cuenta_propietarios cp ON cp.propietario_id = p.id
      WHERE cp.cuenta_id = ? AND cp.fecha_fin IS NULL
    `).get(cuenta.id);

    if (!propietario) { resultados.sinPropietarioVigente.push(codigoExcel); continue; }

    if (!nombresCoinciden(fila.NOMBRE, propietario.nombre_completo)) {
      resultados.nombreNoCoincide.push({ codigo: cuenta.codigo, excel: fila.NOMBRE, db: propietario.nombre_completo });
      continue;
    }

    const faltaCedula = fila.CEDULA && !propietario.numero_identificacion;
    const faltaTelefono = fila.TELEFONO && !propietario.telefono;
    const faltaCorreo = fila.CORREO && !propietario.email;

    if (!faltaCedula && !faltaTelefono && !faltaCorreo) {
      resultados.contactoYaCompleto.push(cuenta.codigo);
      continue;
    }

    // La cédula es lo único con restricción de unicidad entre propietarios. Cuando dos
    // cuentas son de la misma persona pero el historial nunca fusionó sus registros de
    // propietario (ej.: R098/R099 "VARON ROBERTO", S053/S056 "HERRERA DE MACHADO GLADYS"),
    // la segunda cuenta choca al intentar repetir la cédula. En ese caso no se pierde el
    // teléfono/correo: se reintenta sin tocar la cédula.
    function intentarActualizar(incluirCedula) {
      propietarioService.update(propietario.id, {
        nombre_completo: propietario.nombre_completo,
        numero_identificacion: (incluirCedula && faltaCedula) ? fila.CEDULA : propietario.numero_identificacion,
        telefono: faltaTelefono ? fila.TELEFONO : propietario.telefono,
        email: faltaCorreo ? fila.CORREO : propietario.email,
        observaciones: propietario.observaciones
      });
    }

    try {
      intentarActualizar(true);
      resultados.contactoActualizado.push({
        codigo: cuenta.codigo,
        cedula: !!faltaCedula,
        telefono: !!faltaTelefono,
        correo: !!faltaCorreo
      });
    } catch (e) {
      if (faltaCedula && e.message.includes('Ya existe otro propietario con ese número de identificación') && (faltaTelefono || faltaCorreo)) {
        try {
          intentarActualizar(false);
          resultados.contactoActualizado.push({
            codigo: cuenta.codigo,
            cedula: false,
            telefono: !!faltaTelefono,
            correo: !!faltaCorreo
          });
          resultados.errores.push({ codigo: cuenta.codigo, codigoExcel, campo: 'cedula', error: `${e.message} (teléfono/correo sí se cargaron)` });
        } catch (e2) {
          resultados.errores.push({ codigo: cuenta.codigo, codigoExcel, campo: 'contacto', error: e2.message });
        }
      } else {
        resultados.errores.push({ codigo: cuenta.codigo, codigoExcel, campo: 'contacto', error: e.message });
      }
    }
  }

  return resultados;
}

module.exports = { cargarContactoYPredio, EXCEL_PATH, UMBRAL_COINCIDENCIA_NOMBRE };

if (require.main === module) {
  (async () => {
    const DatabaseService = require('../../src/database/DatabaseService');
    const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
    dbService.initialize();

    const r = await cargarContactoYPredio({ dbService });

    console.log(`\n=== Carga de contacto y predio (${EXCEL_PATH}) ===`);
    console.log(`Nombre de predio cargado: ${r.predioActualizado.length}`);
    console.log(`Nombre de predio ya existía: ${r.predioYaTenia.length}`);
    console.log(`\nContacto actualizado: ${r.contactoActualizado.length}`);
    console.log(`  - cédula: ${r.contactoActualizado.filter(c => c.cedula).length}`);
    console.log(`  - teléfono: ${r.contactoActualizado.filter(c => c.telefono).length}`);
    console.log(`  - correo: ${r.contactoActualizado.filter(c => c.correo).length}`);
    console.log(`Contacto ya estaba completo (para lo que trae el Excel): ${r.contactoYaCompleto.length}`);
    console.log(`Sin propietario vigente (no se pudo cargar contacto): ${r.sinPropietarioVigente.length} -> ${r.sinPropietarioVigente.join(', ')}`);
    console.log(`\nNOMBRE NO COINCIDE (contacto NO cargado, requiere revisión manual): ${r.nombreNoCoincide.length}`);
    r.nombreNoCoincide.forEach(x => console.log(`  ${x.codigo}: Excel="${x.excel}" | DB="${x.db}"`));
    console.log(`\nCódigos sin cuenta correspondiente en la base: ${r.noEncontradas.length} -> ${r.noEncontradas.join(', ')}`);
    console.log(`Colisiones sin resolver: ${r.colisionesSinResolver.length} -> ${r.colisionesSinResolver.join(', ')}`);
    console.log(`Códigos dejados sin tocar a propósito: ${r.sinTocar.length} -> ${r.sinTocar.join(', ')}`);
    if (r.errores.length) {
      console.log(`\nERRORES (${r.errores.length}):`);
      r.errores.forEach(e => console.log(`  ${e.codigoExcel} (${e.codigo}, ${e.campo}): ${e.error}`));
    }

    const outDir = path.join(__dirname, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `contacto-predio_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
    console.log(`\nReporte completo: ${outPath}`);

    dbService.close();
  })().catch(e => { console.error(e); process.exit(1); });
}
