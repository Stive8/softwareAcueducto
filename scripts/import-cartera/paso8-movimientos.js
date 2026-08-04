// Paso 8 de la carga inicial (sección 14 del MD): generar movimientos SOLO para recibos >= 2024
// (regla de oro 1: los recibos anteriores al corte nunca generan movimiento, su plata ya está
// resumida en la apertura opaca del paso 5 / en abonado_pre_2024 del paso 6).
//
// `genera_movimiento_cartera` en el JSON ya resuelve exactamente esto (verificado: correlaciona
// 100% con fecha_recibo >= 2024, sin excepciones) -- se usa el flag tal cual, no se re-deriva del
// año.
//
// Cada registro con clasificacion:
//  - 'sostenimiento' -> UN movimiento en cartera_movimientos (tipo Abono, exigible=1, monto
//    negativo, igual que CarteraService.registrarAbono). Bucket 3.
//  - 'punto'          -> UN abono en nuevo_punto_abonos contra el nuevos_puntos de esa cuenta
//    (creado en el paso 6), con recibo_detalle_id real esta vez (a diferencia del paso 6, que usa
//    null para el abono consolidado de apertura). Bucket 2.
// Este paso NO imputa nada (ni FIFO ni por período) -- solo registra el abono. La imputación es
// el paso 10.
//
// cuenta_id se resuelve SIEMPRE desde el codigo_cuenta del JSON, nunca del cuenta_id que ya
// traiga el recibo en la base -- así los cruces de cuenta (ej. recibo repartido entre dos
// predios) y las fusiones (S063->S0365) quedan bien sin código especial.
//
// Un numero_recibo es 1 fila en recibo_detalles (ver paso 7), pero puede tener varios REGISTROS
// en el JSON (splits, mismo detalle, distinta cuenta y/o clasificación). La clave de idempotencia
// es (recibo_detalle_id, cuenta_id): un solo recibo_detalle_id no alcanza porque un split cruzado
// entre cuentas generaría 2 movimientos con el mismo recibo_detalle_id.
//
// Antes de insertar nada se valida, para cada numero_recibo con movimiento, que la suma de los
// valores de sus registros coincida con el valor real del recibo_detalle en la base -- eso es lo
// que habría atrapado un split mal calculado.
const { normalizarCodigo } = require('./normalizar');

const NUMERO_SINCODIFICAR_OMITIDO = 1284;

function agruparConMovimiento(recibosJson) {
  const porNumero = new Map();
  for (const r of recibosJson) {
    if (!r.genera_movimiento_cartera) continue;
    if (r.numero_recibo === NUMERO_SINCODIFICAR_OMITIDO) continue;
    if (!porNumero.has(r.numero_recibo)) porNumero.set(r.numero_recibo, []);
    porNumero.get(r.numero_recibo).push(r);
  }
  return porNumero;
}

function ejecutarPaso8({ dbService, recibosJson }) {
  const CarteraRepository = require('../../src/repositories/CarteraRepository');
  const NuevoPuntoRepository = require('../../src/repositories/NuevoPuntoRepository');
  const db = dbService.getDb();
  const carteraRepo = new CarteraRepository(dbService);
  const puntoRepo = new NuevoPuntoRepository(dbService);

  const idPorCodigo = new Map(
    db.prepare('SELECT id, codigo FROM cuentas').all().map(c => [normalizarCodigo(c.codigo), c.id])
  );
  const getDetalle = db.prepare(`
    SELECT rd.id, rd.valor FROM recibo_detalles rd
    JOIN recibos r ON r.id = rd.recibo_id
    WHERE r.numero_recibo = ?
  `);
  const getNuevoPuntoPorCuenta = db.prepare('SELECT id FROM nuevos_puntos WHERE cuenta_id = ?');
  const existeMovimientoCartera = db.prepare(`
    SELECT id FROM cartera_movimientos WHERE recibo_detalle_id = ? AND cuenta_id = ? AND tipo = 'Abono'
  `);
  const existeAbonoPunto = db.prepare(`
    SELECT id FROM nuevo_punto_abonos WHERE recibo_detalle_id = ? AND nuevo_punto_id = ?
  `);

  const porNumero = agruparConMovimiento(recibosJson);

  // Validación previa (todo antes de insertar nada, ver paso 6): la suma de los registros de cada
  // numero_recibo debe calzar con el valor real del recibo_detalle, y la clasificación debe ser
  // una de las dos conocidas.
  const violaciones = [];
  for (const [numeroRecibo, registros] of porNumero) {
    const detalle = getDetalle.get(numeroRecibo);
    if (!detalle) {
      violaciones.push(`${numeroRecibo}: no se encontró recibo_detalle -- ¿corrió el paso 7?`);
      continue;
    }
    const suma = registros.reduce((s, r) => s + r.valor, 0);
    if (suma !== detalle.valor) {
      violaciones.push(`${numeroRecibo}: suma de registros (${suma}) != valor del recibo_detalle (${detalle.valor})`);
    }
    for (const r of registros) {
      if (r.clasificacion !== 'sostenimiento' && r.clasificacion !== 'punto') {
        violaciones.push(`${numeroRecibo}: clasificación desconocida "${r.clasificacion}"`);
      }
    }
  }
  if (violaciones.length > 0) {
    throw new Error(`Paso 8 -- validación previa falló:\n${violaciones.join('\n')}`);
  }

  const movimientosCartera = [];
  const abonosPunto = [];
  const yaExistian = [];
  const omitidosSinPunto = [];
  const omitidosSinCuenta = [];

  const transaccion = db.transaction(() => {
    for (const [numeroRecibo, registros] of porNumero) {
      const detalle = getDetalle.get(numeroRecibo);

      for (const r of registros) {
        const cuentaId = idPorCodigo.get(normalizarCodigo(r.codigo_cuenta));
        if (cuentaId === undefined) {
          omitidosSinCuenta.push({ numeroRecibo, codigoCuenta: r.codigo_cuenta });
          continue;
        }

        if (r.clasificacion === 'sostenimiento') {
          if (existeMovimientoCartera.get(detalle.id, cuentaId)) {
            yaExistian.push({ numeroRecibo, cuentaId, tipo: 'sostenimiento' });
            continue;
          }
          const movId = carteraRepo.crearMovimiento({
            cuentaId, fecha: r.fecha_pago_real, tipo: 'Abono', exigible: 1,
            monto: -r.valor, reciboDetalleId: detalle.id
          });
          movimientosCartera.push({ numeroRecibo, cuentaId, movId, monto: r.valor });
        } else if (r.clasificacion === 'punto') {
          const nuevoPunto = getNuevoPuntoPorCuenta.get(cuentaId);
          if (!nuevoPunto) {
            omitidosSinPunto.push({ numeroRecibo, cuentaId, codigoCuenta: r.codigo_cuenta });
            continue;
          }
          if (existeAbonoPunto.get(detalle.id, nuevoPunto.id)) {
            yaExistian.push({ numeroRecibo, cuentaId, tipo: 'punto' });
            continue;
          }
          const abonoId = puntoRepo.crearAbono({
            nuevoPuntoId: nuevoPunto.id, monto: r.valor, fechaAbono: r.fecha_pago_real,
            reciboDetalleId: detalle.id, observaciones: null
          });
          puntoRepo.actualizarSaldoYEstado(nuevoPunto.id);
          abonosPunto.push({ numeroRecibo, cuentaId, abonoId, monto: r.valor });
        }
      }
    }
  });
  transaccion();

  return {
    movimientosCartera, abonosPunto, yaExistian, omitidosSinPunto, omitidosSinCuenta,
    totalSostenimiento: movimientosCartera.reduce((s, m) => s + m.monto, 0),
    totalPunto: abonosPunto.reduce((s, m) => s + m.monto, 0)
  };
}

module.exports = { ejecutarPaso8, agruparConMovimiento, NUMERO_SINCODIFICAR_OMITIDO };
