// Paso 1 de la carga inicial (sección 14 del MD): propietarios.
//
// Regla acordada con el negocio: para las 292 cuentas que ya existen en la app se reutiliza el
// propietario vigente tal cual está -- NO se crea ni se toca ninguno, incluso si el `nombre` del
// JSON es distinto (ese campo es la etiqueta cruda de CARTERA, no una fuente de verdad para el
// propietario de una cuenta que la app ya tiene resuelta). Solo se crean propietarios nuevos para
// las cuentas que no existen todavía en la app, usando el NOMBRE limpio de
// DatosPropietariosCuentas.xlsx (no el `nombre` sucio del JSON).
//
// Casos especiales (decididos con el negocio, no inferidos):
//  - S0244: conflicto de propietario entre CARTERA y DATOS (personas distintas). Se omite --
//    la cuenta se crea en el paso 2 sin propietario asignado, con alerta.
//  - S0332S0382: código corrupto sin sustento en CARTERA ni DATOS. No se crea propietario; la
//    cuenta se desactiva en el paso 2.
const { normalizarCodigo } = require('./normalizar');

const SIN_PROPIETARIO = new Set(['S0244', 'S0332S0382']);

function limpiarNombreDeCartera(nombreCrudo, codigo) {
  // Fallback SOLO si DATOS no tiene el código: quita el código pegado al final del nombre de
  // CARTERA (ej. "BONILLA NELSON R002" -> "BONILLA NELSON") y lo marca para verificar a mano.
  const regex = new RegExp('\\s*' + codigo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
  const limpio = String(nombreCrudo || '').replace(regex, '').trim();
  return { nombre: limpio || String(nombreCrudo || '').trim(), nombrePorVerificar: true };
}

function ejecutarPaso1({ dbService, cuentasJson, datosPropietarios, usuarioId = null }) {
  const db = dbService.getDb();

  const cuentasDb = db.prepare('SELECT id, codigo FROM cuentas').all();
  const idPorCodigo = new Map(cuentasDb.map(c => [normalizarCodigo(c.codigo), c.id]));

  const reutilizados = [];
  const sinPropietarioVigente = [];
  const creados = [];
  const omitidos = [];

  const crearPropietario = db.prepare(`
    INSERT INTO propietarios (nombre_completo, numero_identificacion, telefono, email, observaciones)
    VALUES (?, ?, ?, ?, ?)
  `);
  const getPropietarioVigente = db.prepare(`
    SELECT propietario_id FROM cuenta_propietarios WHERE cuenta_id = ? AND fecha_fin IS NULL
    ORDER BY fecha_inicio DESC, id DESC LIMIT 1
  `);

  const transaccion = db.transaction(() => {
    for (const cuenta of cuentasJson) {
      const codigo = cuenta.codigo;
      const codigoNorm = normalizarCodigo(codigo);
      const cuentaId = idPorCodigo.get(codigoNorm);

      if (cuentaId !== undefined) {
        // Ya existe en la app: reutilizar el propietario vigente, sin excepción.
        const vigente = getPropietarioVigente.get(cuentaId);
        if (vigente) {
          reutilizados.push({ codigo, cuentaId, propietarioId: vigente.propietario_id });
        } else {
          sinPropietarioVigente.push({ codigo, cuentaId });
        }
        continue;
      }

      // No existe en la app todavía (paso 2 la crea).
      if (SIN_PROPIETARIO.has(codigo)) {
        omitidos.push({
          codigo,
          motivo: codigo === 'S0244'
            ? 'Conflicto de propietario entre CARTERA y DATOS: se crea la cuenta sin propietario asignado'
            : 'Código corrupto sin sustento en CARTERA ni DATOS: la cuenta se desactiva, no se crea propietario'
        });
        continue;
      }

      const datos = datosPropietarios.get(codigoNorm);
      let nombre, cedula, telefono, correo, nombrePorVerificar = false;
      if (datos && datos.nombre) {
        ({ nombre, cedula, telefono, correo } = datos);
      } else {
        const limpio = limpiarNombreDeCartera(cuenta.nombre, codigo);
        nombre = limpio.nombre;
        nombrePorVerificar = true;
        cedula = null; telefono = null; correo = null;
      }

      const observaciones = nombrePorVerificar
        ? 'Nombre por verificar: no encontrado en DatosPropietariosCuentas.xlsx, limpiado por regex desde CARTERA'
        : null;

      const propietarioId = crearPropietario.run(nombre, cedula, telefono, correo, observaciones).lastInsertRowid;
      creados.push({ codigo, propietarioId, nombre, nombrePorVerificar });
    }
  });
  transaccion();

  return { reutilizados, sinPropietarioVigente, creados, omitidos };
}

module.exports = { ejecutarPaso1, limpiarNombreDeCartera, SIN_PROPIETARIO };
