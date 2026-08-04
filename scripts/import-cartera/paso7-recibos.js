// Paso 7 de la carga inicial (sección 14 del MD): cargar todos los recibos, histórico completo,
// inmutables.
//
// El JSON trae ~2.477 REGISTROS (una fila por concepto), pero `recibos` en la base es 1 fila por
// NÚMERO de recibo (numero_recibo es UNIQUE). Se agrupa por numero_recibo antes de tocar la base:
// la inmensa mayoría son grupos de 1, y 15 son grupos de 2 (recibos "partidos" -- mismo numero_
// recibo, dos conceptos, ej. sostenimiento + punto). Un recibo YA existente en la base nunca se
// toca salvo por fecha_pago_real (regla 3: numero/fecha/valor/concepto no se mutan); el reparto
// conceptual de un recibo partido es responsabilidad del paso 8, no de este.
//
// Solo se INSERTA un recibo nuevo cuando su numero_recibo no existe todavía en la base --  son los
// ~32 marcados por el JSON con nota "PENDIENTE DE CARGA..." (existen en el talonario físico pero
// no llegaron a historial-aportes).
//
// El recibo #1284 (codigo_cuenta "SINCODIFICAR") es un caso aparte: no tiene cuenta identificada
// en el talonario. No se inventa una cuenta -- se omite aquí y queda para revisión manual en el
// reporte final (paso 12). Es anterior a 2024, así que aunque se cargue más adelante no genera
// movimiento de cartera por la regla de oro 1.
//
// metodo_pago no viene resuelto en el JSON para los recibos nuevos. Se infiere del texto de
// concepto_original solo cuando el texto lo dice explícitamente (TRANSFERENCIA/CONSIGNACION/
// EFECTIVO); si no lo dice, se deja NULL -- no se inventa el dato.
const { normalizarCodigo } = require('./normalizar');

const NUMERO_SINCODIFICAR_OMITIDO = 1284;
const OBSERVACION_CREADO = 'Carga inicial de cartera: recibo pendiente de carga (existía en el talonario, no en historial-aportes)';

function inferirMetodoPago(conceptoOriginal) {
  const texto = (conceptoOriginal || '').toUpperCase();
  if (/TRANSFERENC/.test(texto)) return 'Transferencia';
  if (/CONSIGNACI/.test(texto)) return 'Consignacion';
  if (/EFECTIVO/.test(texto)) return 'Efectivo';
  return null;
}

function agruparPorNumero(recibosJson) {
  const porNumero = new Map();
  for (const r of recibosJson) {
    if (r.numero_recibo === NUMERO_SINCODIFICAR_OMITIDO) continue;
    if (!porNumero.has(r.numero_recibo)) porNumero.set(r.numero_recibo, []);
    porNumero.get(r.numero_recibo).push(r);
  }
  return porNumero;
}

function ejecutarPaso7({ dbService, recibosJson }) {
  const db = dbService.getDb();

  const idPorCodigo = new Map(
    db.prepare('SELECT id, codigo FROM cuentas').all().map(c => [normalizarCodigo(c.codigo), c.id])
  );
  const getVigente = db.prepare(`
    SELECT propietario_id FROM cuenta_propietarios WHERE cuenta_id = ? AND fecha_fin IS NULL
    ORDER BY fecha_inicio DESC, id DESC LIMIT 1
  `);
  const getRecibo = db.prepare('SELECT id, fecha_pago_real FROM recibos WHERE numero_recibo = ?');
  const insertRecibo = db.prepare(`
    INSERT INTO recibos (numero_recibo, cuenta_id, propietario_id, fecha_recibo, total, metodo_pago, observaciones, fecha_pago_real)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDetalle = db.prepare(`
    INSERT INTO recibo_detalles (recibo_id, concepto, periodo_desde, periodo_hasta, valor)
    VALUES (?, ?, ?, ?, ?)
  `);
  const updateFechaPagoReal = db.prepare('UPDATE recibos SET fecha_pago_real = ? WHERE id = ?');

  const porNumero = agruparPorNumero(recibosJson);

  const creados = [];
  const fechaPagoRealActualizada = [];
  const yaCorrecta = [];
  const omitidosSinCuenta = [];

  const transaccion = db.transaction(() => {
    for (const [numeroRecibo, registros] of porNumero) {
      const existente = getRecibo.get(numeroRecibo);
      const fechaPagoRealJson = registros[0].fecha_pago_real;

      if (existente) {
        if (existente.fecha_pago_real !== fechaPagoRealJson) {
          updateFechaPagoReal.run(fechaPagoRealJson, existente.id);
          fechaPagoRealActualizada.push({
            numeroRecibo, reciboId: existente.id,
            anterior: existente.fecha_pago_real, nueva: fechaPagoRealJson
          });
        } else {
          yaCorrecta.push(numeroRecibo);
        }
        continue;
      }

      const codigoCuenta = registros[0].codigo_cuenta;
      const cuentaId = idPorCodigo.get(normalizarCodigo(codigoCuenta));
      if (cuentaId === undefined) {
        omitidosSinCuenta.push({ numeroRecibo, codigoCuenta, motivo: 'cuenta no existe en la base' });
        continue;
      }
      const vigente = getVigente.get(cuentaId);
      if (!vigente) {
        omitidosSinCuenta.push({ numeroRecibo, codigoCuenta, motivo: 'sin propietario vigente' });
        continue;
      }

      const total = registros.reduce((s, r) => s + r.valor, 0);
      const metodoPago = inferirMetodoPago(registros[0].concepto_original);
      const reciboId = insertRecibo.run(
        numeroRecibo, cuentaId, vigente.propietario_id, registros[0].fecha_recibo,
        total, metodoPago, OBSERVACION_CREADO, fechaPagoRealJson
      ).lastInsertRowid;

      for (const r of registros) {
        insertDetalle.run(reciboId, r.concepto_original, r.periodo_desde, r.periodo_hasta, r.valor);
      }

      creados.push({ numeroRecibo, codigoCuenta, cuentaId, reciboId, total, metodoPago });
    }
  });
  transaccion();

  return {
    creados, fechaPagoRealActualizada, yaCorrecta, omitidosSinCuenta,
    totalCreados: creados.reduce((s, c) => s + c.total, 0)
  };
}

module.exports = { ejecutarPaso7, inferirMetodoPago, agruparPorNumero, NUMERO_SINCODIFICAR_OMITIDO, OBSERVACION_CREADO };
