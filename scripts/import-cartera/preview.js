// scripts/import-cartera/preview.js
const { leerCartera } = require('./leer-cartera');
const { leerDatosMaestros } = require('./leer-datos');
const { categoriaPorMensualidad } = require('./categorizar');
const { normalizarCodigo, resolverCodigo, HUERFANOS_A_CREAR } = require('./codigos');

async function generarPlan({ filePathCartera, filePathDatos, dbService }) {
  const [registrosCartera, registrosDatos] = await Promise.all([
    leerCartera(filePathCartera),
    leerDatosMaestros(filePathDatos)
  ]);

  const datosPorCodigo = new Map(registrosDatos.map((d) => [normalizarCodigo(d.codigo), d]));
  const filasCuentas = dbService.getDb().prepare(`SELECT id, codigo FROM cuentas`).all();
  const codigosEnBase = new Set(filasCuentas.map((c) => normalizarCodigo(c.codigo)));
  const idPorCodigo = new Map(filasCuentas.map((c) => [normalizarCodigo(c.codigo), c.id]));

  const cuentas = [];
  const codigosCuentasVistos = new Set();
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
    const codigoNormalizado = normalizarCodigo(codigo);

    // Una equivalencia (ej. R0081 -> S058) puede tener fila propia en el Excel para AMBOS
    // códigos: si eso pasa, la segunda fila no se descarta en silencio -- se reporta, para no
    // duplicar la apertura opaca de la misma cuenta real.
    if (codigosCuentasVistos.has(codigoNormalizado)) {
      aperturasSinDato.push({ codigo, motivo: `fila duplicada para la misma cuenta (código Excel original: ${c.codigo}): revisar manualmente, no se aplicó` });
      continue;
    }

    const cuentaId = idPorCodigo.get(codigoNormalizado);
    if (cuentaId === undefined) {
      aperturasSinDato.push({ codigo, motivo: 'resolvió a una cuenta que no existe en la base: revisar manualmente' });
      continue;
    }

    const categoriaNombre = categoriaPorMensualidad(c.mensualidadVieja);
    if (categoriaNombre === null) {
      aperturasSinDato.push({ codigo, motivo: `mensualidad ${c.mensualidadVieja} no corresponde a ninguna categoría conocida: revisar manualmente` });
      continue;
    }

    codigosCuentasVistos.add(codigoNormalizado);

    const categoria2024 = categoriaPorMensualidad(c.mensualidad2024);
    const categoriaNombre2024 = (categoria2024 && categoria2024 !== categoriaNombre) ? categoria2024 : null;

    // Se busca por el código YA RESUELTO (el de la cuenta real), no por el código crudo del
    // Excel: si el código venía por equivalencia (ej. R0081 -> S058), el TIPO/observación que
    // cuenta es el de la fila de Datos.xlsx de la cuenta real (S058), no el de su alias.
    const datos = datosPorCodigo.get(codigoNormalizado);
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
      cuentaId,
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
