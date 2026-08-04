// Paso 2 de la carga inicial (sección 14 del MD): cuentas.
//
// Solo procesa las cuentas del JSON que NO existen todavía en la app (las 14). Para cada una:
// dirección por prefijo de vereda (C/R/S -> Cural/Rodeo/Salitre, sin excepción verificada en las
// 293 cuentas reales), coordenadas del JSON si las trae, categoría vigente (mapeada al nombre que
// ya usa la base: Comercial->Tienda, Alquiler->Finca para alquiler), y el propietario creado en
// el paso 1 (o ninguno para S0244).
//
// El estado inicial de las 14 se deja SIEMPRE 'Activo': la suspensión real (con las fechas
// corregidas por el negocio -- 2026-07-31, no la fecha de creación) se aplica en el paso 4, no
// aquí. Mezclar los dos pasos duplicaría la lógica de causación/suspensión en dos lugares.
const CuentaRepository = require('../../src/repositories/CuentaRepository');
const CuentaEstadoRepository = require('../../src/repositories/CuentaEstadoRepository');
const { normalizarCodigo } = require('./normalizar');

const CATEGORIA_JSON_A_DB = {
  'Finca': 'Finca',
  'Finca con piscina': 'Finca con piscina',
  'Comercial': 'Tienda',
  'Alquiler': 'Finca para alquiler'
};

function resolverDireccion(codigo) {
  const prefijo = codigo[0];
  if (prefijo === 'C') return 'Vereda El Cural';
  if (prefijo === 'R') return 'Vereda El Rodeo';
  if (prefijo === 'S') return 'Vereda El Salitre';
  return 'Dirección no registrada - verificar';
}

function resolverCategoria(db, categoriaJson) {
  const nombreDb = categoriaJson ? (CATEGORIA_JSON_A_DB[categoriaJson] || null) : null;
  const nombreFinal = nombreDb || 'Sin clasificar';
  const fila = db.prepare('SELECT id FROM categorias WHERE nombre = ?').get(nombreFinal);
  if (!fila) throw new Error(`Categoría no encontrada en la base: "${nombreFinal}" (mapeada de "${categoriaJson}")`);
  return { categoriaId: fila.id, categoriaNombre: nombreFinal, esPlaceholder: nombreFinal === 'Sin clasificar' };
}

// cuentasJson: data.cuentas (306). propietariosCreados: `creados` del paso 1
// ([{codigo, propietarioId, nombre}]) -- se usa para enlazar el propietario recién creado a la
// cuenta recién creada (el vínculo cuenta_propietarios no puede existir antes de que ambas filas
// existan, así que se hace aquí, no en el paso 1).
function ejecutarPaso2({ dbService, cuentasJson, propietariosCreados, fechaAnclaje = '2023-12-31' }) {
  const db = dbService.getDb();
  const cuentaRepo = new CuentaRepository(dbService);
  const propietarioPorCodigo = new Map(propietariosCreados.map(p => [p.codigo, p.propietarioId]));

  const codigosEnDb = new Set(db.prepare('SELECT codigo FROM cuentas').all().map(c => normalizarCodigo(c.codigo)));

  const creadas = [];
  const categoriaPlaceholder = [];

  for (const cuenta of cuentasJson) {
    if (codigosEnDb.has(normalizarCodigo(cuenta.codigo))) continue; // ya existe: no es una de las 14

    const { categoriaId, categoriaNombre, esPlaceholder } = resolverCategoria(db, cuenta.categoria);
    if (esPlaceholder) {
      categoriaPlaceholder.push({
        codigo: cuenta.codigo,
        motivo: 'El JSON no trae categoría/mensualidad resuelta; queda "Sin clasificar" hasta revisar antes de causar'
      });
    }

    const cuentaId = cuentaRepo.create({
      codigo: cuenta.codigo,
      direccion: resolverDireccion(cuenta.codigo),
      nombre_predio: cuenta.nombre_predio || null,
      estado: 'Activo',
      lat_acometida: cuenta.lat_acometida ?? null,
      lon_acometida: cuenta.lon_acometida ?? null,
      categoria_id: categoriaId,
      categoria_fecha_inicio: fechaAnclaje
    });

    const propietarioId = propietarioPorCodigo.get(cuenta.codigo) || null;
    if (propietarioId) {
      db.prepare(`
        INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, ?)
      `).run(cuentaId, propietarioId, fechaAnclaje);
    }

    creadas.push({
      codigo: cuenta.codigo, cuentaId, categoriaNombre,
      direccion: resolverDireccion(cuenta.codigo), propietarioId
    });
  }

  return { creadas, categoriaPlaceholder };
}

// Casos especiales de cuentas ya existentes (no se crean, se corrigen).
function aplicarCasosEspeciales({ dbService, fechaHoy, usuarioId = null }) {
  const db = dbService.getDb();
  const estadoRepo = new CuentaEstadoRepository(dbService);
  const resultado = {};

  // S0332S0382: código corrupto sin sustento en CARTERA ni DATOS (ver paso 1). Se desactiva;
  // su propietario (ya existente, id 107 en la base real) se deja huérfano a propósito -- no se
  // borra, porque no rompe nada y borrar propietarios está fuera del alcance de este import.
  const s0332s0382 = db.prepare(`SELECT id, estado FROM cuentas WHERE codigo = ?`).get('S0332 - S0382');
  if (s0332s0382) {
    db.prepare(`UPDATE cuentas SET observaciones = ?, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = ?`)
      .run('Código corrupto, repartida entre S0332 y S0382', s0332s0382.id);
    if (s0332s0382.estado !== 'Inactivo') {
      estadoRepo.cambiarEstado({
        cuentaId: s0332s0382.id, estado: 'Inactivo', fechaInicio: fechaHoy,
        motivo: 'Código corrupto, repartida entre S0332 y S0382', usuarioId
      });
    }
    resultado.s0332s0382 = { cuentaId: s0332s0382.id, accion: 'desactivada' };
  }

  // S063: fusionada en S0365 (ver paso 1 / CarteraRepository -- sus movimientos de cartera se
  // generan contra S0365 vía codigo_cuenta, no contra su propio cuenta_id). Solo se documenta;
  // el negocio pidió explícitamente que no lleve ninguna otra acción (no se desactiva).
  const s063 = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get('S063');
  if (s063) {
    db.prepare(`UPDATE cuentas SET observaciones = ?, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = ?`)
      .run('Fusionada con S0365, ver esa cuenta', s063.id);
    resultado.s063 = { cuentaId: s063.id, accion: 'observación agregada' };
  }

  return resultado;
}

module.exports = { ejecutarPaso2, aplicarCasosEspeciales, resolverDireccion, resolverCategoria };
