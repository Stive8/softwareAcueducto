// Paso 3 de la carga inicial (sección 14 del MD): categorías vigentes.
//
// Alcance real (verificado contra la base, no solo lo previsto por el MD): 293 de las 318
// cuentas de la app están en "Sin clasificar" (tarifa placeholder $1/mes) porque el import
// histórico de junio nunca cargó categoría real para nadie. De esas, 280 SÍ tienen categoría
// resuelta en el JSON (validada por dos fuentes independientes, sección 3 del MD) y nunca se
// aplicó -- corregirlas aquí no toca causación (no existe ninguna todavía) ni pisa historia
// legítima, porque "Sin clasificar" es un placeholder de tránsito, no una vigencia real.
//
// Seis cuentas (las de CORRECCIONES) no tienen categoría en el JSON pero SÍ una decisión de
// negocio explícita, tomada a mano contra DatosPropietariosCuentas.xlsx (columna TIPO). Las
// demás sin dato en el JSON se dejan intactas -- no se inventa nada.
const { normalizarCodigo } = require('./normalizar');

const CATEGORIA_JSON_A_DB = {
  'Finca': 'Finca',
  'Finca con piscina': 'Finca con piscina',
  'Comercial': 'Tienda',
  'Alquiler': 'Finca para alquiler'
};

const CORRECCIONES = {
  'R002': { categoriaDb: 'Finca' },
  'R0501': { categoriaDb: 'Finca' },
  'R0971': { categoriaDb: 'Finca' },
  'S009': { categoriaDb: 'Finca' },
  'R044': { categoriaDb: 'Tienda', observaciones: 'Punto exento de cobro - escuela' },
  'S03321': { categoriaDb: 'Finca', observaciones: 'Punto sin historial de cartera - definir fecha de inicio de cobro' }
};

function ejecutarPaso3({ dbService, cuentasJson }) {
  const db = dbService.getDb();

  const cuentasDb = db.prepare('SELECT id, codigo FROM cuentas').all();
  const idPorCodigo = new Map(cuentasDb.map(c => [normalizarCodigo(c.codigo), c.id]));
  const categoriaIdPorNombre = new Map(
    db.prepare('SELECT id, nombre FROM categorias').all().map(c => [c.nombre, c.id])
  );

  const getVigencia = db.prepare(`
    SELECT id, categoria_id FROM cuenta_categorias WHERE cuenta_id = ? AND fecha_fin IS NULL
    ORDER BY fecha_inicio DESC, id DESC LIMIT 1
  `);
  const actualizarCategoria = db.prepare('UPDATE cuenta_categorias SET categoria_id = ? WHERE id = ?');
  const actualizarObservaciones = db.prepare(
    'UPDATE cuentas SET observaciones = ?, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id = ?'
  );

  const corregidas = [];
  const yaCorrectas = [];
  const sinResolver = [];

  const transaccion = db.transaction(() => {
    for (const cuenta of cuentasJson) {
      if (cuenta.codigo === 'S0332S0382') continue; // desactivada en el paso 2, no participa

      const cuentaId = idPorCodigo.get(normalizarCodigo(cuenta.codigo));
      if (cuentaId === undefined) continue; // no debería pasar tras el paso 2, pero no rompe el resto

      let categoriaDb, observaciones;
      if (CORRECCIONES[cuenta.codigo]) {
        ({ categoriaDb, observaciones } = CORRECCIONES[cuenta.codigo]);
      } else if (cuenta.categoria) {
        categoriaDb = CATEGORIA_JSON_A_DB[cuenta.categoria];
        if (!categoriaDb) throw new Error(`Categoría JSON desconocida: "${cuenta.categoria}" (cuenta ${cuenta.codigo})`);
      } else {
        sinResolver.push({ codigo: cuenta.codigo, cuentaId });
        continue;
      }

      const categoriaId = categoriaIdPorNombre.get(categoriaDb);
      if (!categoriaId) throw new Error(`Categoría no encontrada en la base: "${categoriaDb}"`);

      const vigencia = getVigencia.get(cuentaId);
      if (!vigencia) throw new Error(`${cuenta.codigo}: no tiene vigencia de categoría abierta`);

      if (vigencia.categoria_id === categoriaId) {
        yaCorrectas.push({ codigo: cuenta.codigo, categoriaDb });
      } else {
        actualizarCategoria.run(categoriaId, vigencia.id);
        corregidas.push({ codigo: cuenta.codigo, categoriaDb });
      }

      if (observaciones) actualizarObservaciones.run(observaciones, cuentaId);
    }
  });
  transaccion();

  const sinClasificar = db.prepare(`
    SELECT cu.codigo FROM cuentas cu
    JOIN cuenta_categorias cc ON cc.cuenta_id = cu.id AND cc.fecha_fin IS NULL
    JOIN categorias c ON c.id = cc.categoria_id
    WHERE c.nombre = 'Sin clasificar'
  `).all().map(r => r.codigo);

  return { corregidas, yaCorrectas, sinResolver, sinClasificar };
}

module.exports = { ejecutarPaso3, CORRECCIONES, CATEGORIA_JSON_A_DB };
