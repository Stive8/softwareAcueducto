// scripts/import-cartera/preview.js
const { leerCartera } = require('./leer-cartera');
const { leerDatosMaestros } = require('./leer-datos');
const { categoriaPorMensualidad } = require('./categorizar');
const { normalizarCodigo, resolverCodigo, HUERFANOS_A_CREAR, CODIGOS_PENDIENTES } = require('./codigos');

function cargarCodigosEnBase(dbService) {
  const filas = dbService.getDb().prepare(`SELECT codigo FROM cuentas`).all();
  return new Set(filas.map((f) => normalizarCodigo(f.codigo)));
}

async function generarPlan({ filePathCartera, filePathDatos, dbService }) {
  const [registrosCartera, registrosDatos] = await Promise.all([
    leerCartera(filePathCartera),
    leerDatosMaestros(filePathDatos)
  ]);

  const datosPorCodigo = new Map(registrosDatos.map((d) => [normalizarCodigo(d.codigo), d]));
  const codigosEnBase = cargarCodigosEnBase(dbService);
  const idPorCodigo = new Map(
    dbService.getDb().prepare(`SELECT id, codigo FROM cuentas`).all()
      .map((c) => [normalizarCodigo(c.codigo), c.id])
  );

  const cuentas = [];
  const discrepanciasTipo = [];
  const aperturasSinDato = [];
  const huerfanosACrear = [];
  const codigosPendientes = [];

  for (const c of registrosCartera) {
    const resolucion = resolverCodigo(c.codigo, codigosEnBase);

    if (resolucion.esPendiente) { codigosPendientes.push(normalizarCodigo(c.codigo)); continue; }
    if (resolucion.esHuerfano) {
      // Los únicos huérfanos reales son los de HUERFANOS_A_CREAR (C021 y S03321); cualquier otro
      // huérfano no anticipado se reporta aparte, para que quien corra el importador lo vea y lo
      // resuelva a mano. Todos los huérfanos conocidos son categoría 'Finca'.
      const huerfanoConocido = HUERFANOS_A_CREAR.find((h) => h.codigo === normalizarCodigo(c.codigo));
      if (huerfanoConocido) {
        huerfanosACrear.push({ ...huerfanoConocido, categoriaNombre: 'Finca', aperturaOpaca: c.aperturaOpaca });
      } else {
        aperturasSinDato.push({ codigo: c.codigo, motivo: 'huérfano no reconocido: revisar manualmente' });
      }
      continue;
    }

    const codigo = resolucion.codigoBase;
    const categoriaNombre = categoriaPorMensualidad(c.mensualidadVieja);
    const categoria2024 = categoriaPorMensualidad(c.mensualidad2024);
    const categoriaNombre2024 = (categoria2024 && categoria2024 !== categoriaNombre) ? categoria2024 : null;

    const datos = datosPorCodigo.get(normalizarCodigo(c.codigo));
    const candidatoSuspension = datos ? datos.candidatoSuspension : false;

    if (datos && datos.tipo) {
      const categoriaEsperadaPorTipo = { CASA: 'Finca', PISC: 'Finca con piscina', COML: 'Tienda', ALQL: 'Finca para alquiler' }[datos.tipo];
      if (categoriaEsperadaPorTipo && categoriaEsperadaPorTipo !== categoriaNombre) {
        discrepanciasTipo.push({ codigo, tipoDatosXlsx: datos.tipo, categoriaNombre });
      }
    }

    if (c.aperturaOpaca.fuente === 'ninguna' && !candidatoSuspension) {
      aperturasSinDato.push({ codigo });
    }

    cuentas.push({
      codigo,
      cuentaId: idPorCodigo.get(normalizarCodigo(codigo)),
      categoriaNombre,
      categoriaNombre2024,
      aperturaOpaca: c.aperturaOpaca,
      candidatoSuspension,
      cuandoEmpezo: c.cuandoEmpezo,
      saldoReferencia2025: c.saldoReferencia2025,
      tipoDatosXlsx: datos ? datos.tipo : null
    });
  }

  return { cuentas, huerfanosACrear, codigosPendientes, discrepanciasTipo, aperturasSinDato };
}

module.exports = { generarPlan };
