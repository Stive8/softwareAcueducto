// Paso 6 de la carga inicial (sección 14 del MD): punto de conexión.
//
// Bucket 2 (deudaPuntoConexion) vive ENTERAMENTE en nuevos_puntos/nuevo_punto_abonos, nunca en
// cartera_movimientos -- así queda estructuralmente separado del bucket 3 (sostenimiento), sin
// necesidad de un tipo de movimiento nuevo ni de un flag que alguien pueda olvidar filtrar.
//
// No se deriva ninguna cifra de los recibos: precio/abonado/saldo/abonado_pre_2024/
// abonado_desde_2024 salen tal cual del JSON, que ya resolvió los casos de recibos mixtos o
// repartidos entre varias cuentas (ver notas de S0331/S03311/S0362/S008/S044 en el JSON).
//
// Los abonos_desde_2024 (con recibo_detalle_id real) se registran en el paso 8, no aquí -- este
// paso solo cubre lo anterior al corte, igual que el paso 5 para el sostenimiento.
//
// Validación exigida por el usuario (fue la que destapó el bug de S0331 y luego los de S008/
// S0362/S044 en revisiones sucesivas del JSON): para cada cuenta con punto,
//   abonado_pre_2024 + abonado_desde_2024 === abonado
//   precio - abonado === saldo
// Se valida TODO antes de insertar nada (no solo la primera cuenta que falle), para no dejar
// escrituras a medias si el JSON trae más de un problema a la vez.
const { normalizarCodigo } = require('./normalizar');

const FECHA_APERTURA = '2023-12-31';
const OBSERVACION_GENERICA = 'Abonos al punto anteriores al corte (consolidados)';

function validar(cuentasConPunto) {
  const violaciones = [];
  for (const { codigo, p } of cuentasConPunto) {
    const abonadoPre = p.abonado_pre_2024 || 0;
    const abonadoDesde = p.abonado_desde_2024 || 0;
    if (abonadoPre + abonadoDesde !== p.abonado) {
      violaciones.push(
        `${codigo}: abonado_pre_2024 (${abonadoPre}) + abonado_desde_2024 (${abonadoDesde}) ` +
        `!= abonado (${p.abonado})`
      );
    }
    if (p.precio - p.abonado !== p.saldo) {
      violaciones.push(`${codigo}: precio (${p.precio}) - abonado (${p.abonado}) != saldo (${p.saldo})`);
    }
  }
  return violaciones;
}

function ejecutarPaso6({ dbService, cuentasJson }) {
  const NuevoPuntoRepository = require('../../src/repositories/NuevoPuntoRepository');
  const db = dbService.getDb();
  const repo = new NuevoPuntoRepository(dbService);

  const idPorCodigo = new Map(
    db.prepare('SELECT id, codigo FROM cuentas').all().map(c => [normalizarCodigo(c.codigo), c.id])
  );

  const cuentasConPunto = cuentasJson
    .filter(c => c.codigo !== 'S0332S0382' && c.punto_conexion)
    .map(c => ({ codigo: c.codigo, primerAbono: c.punto_conexion.primer_abono, p: c.punto_conexion }));

  const violaciones = validar(cuentasConPunto);
  if (violaciones.length > 0) {
    throw new Error(`Paso 6 -- validación de punto de conexión falló:\n${violaciones.join('\n')}`);
  }

  const creados = [];
  const conAbonoApertura = [];
  const sinAbonoApertura = [];

  for (const { codigo, primerAbono, p } of cuentasConPunto) {
    const cuentaId = idPorCodigo.get(normalizarCodigo(codigo));
    if (cuentaId === undefined) throw new Error(`${codigo}: no existe en la base -- ¿corrieron los pasos 1-2?`);

    const fechaRegistro = primerAbono || FECHA_APERTURA;
    const nuevoPuntoId = repo.create({
      cuentaId, valorTotal: p.precio, fechaRegistro,
      observaciones: 'Carga inicial de cartera'
    });
    creados.push({ codigo, cuentaId, nuevoPuntoId, valorTotal: p.precio });

    const abonadoPre = p.abonado_pre_2024 || 0;
    if (abonadoPre > 0) {
      repo.crearAbono({
        nuevoPuntoId, monto: abonadoPre, fechaAbono: FECHA_APERTURA,
        reciboDetalleId: null,
        observaciones: p.nota || OBSERVACION_GENERICA
      });
      repo.actualizarSaldoYEstado(nuevoPuntoId);
      conAbonoApertura.push({ codigo, nuevoPuntoId, monto: abonadoPre });
    } else {
      sinAbonoApertura.push({ codigo, nuevoPuntoId });
    }
  }

  return {
    creados, conAbonoApertura, sinAbonoApertura,
    totalCreados: creados.length,
    totalAperturaAbonos: conAbonoApertura.reduce((s, a) => s + a.monto, 0)
  };
}

module.exports = { ejecutarPaso6, FECHA_APERTURA, OBSERVACION_GENERICA };
