// Paso 4 de la carga inicial (sección 14 del MD): estados y suspensiones.
//
// CORRECCIÓN DEL NEGOCIO (no lo que dice el MD original): las 11 suspendidas NO se suspenden
// retroactivamente. CARTERA les siguió causando cuotas 2024-2026 con normalidad -- suspenderlas
// antes de esa fecha habría dejado el sistema 2.067.000 por debajo del Excel. Se suspenden desde
// HOY (2026-07-31): causan normal enero 2024 -> julio 2026 (eso lo hace el paso 9, no este), y
// desde agosto en adelante ya no. El campo `fecha_suspension` del JSON se ignora para estas 11
// -- quedó mal especificado.
//
// S004 es aparte: no se maneja aquí. CARTERA la causó en 2024 y la dejó en 0 (castigo de cartera
// de facto); ese tratamiento especial de causación va en el paso 9, no en el estado -- su
// suspensión sigue el mismo patrón que las otras 10 (2026-07-31).
// 2026-08-01, no 2026-07-31: estadoEnMes trabaja por mes completo. Con el último día de julio
// como fecha_inicio, julio entero se leería como Suspendido pese a que la cuenta estuvo activa
// los 31 días. "Causan hasta julio inclusive, suspendidas desde agosto" solo queda sin ambigüedad
// si la vigencia Suspendido arranca el primer día de agosto.
const FECHA_SUSPENSION = '2026-08-01';
const MOTIVO = 'Carga inicial de cartera: suspendida desde 2026-08-01, no retroactiva -- CARTERA causó con normalidad 2024-jul.2026';

const SUSPENDIDAS_SIN_PAGOS = ['R002', 'R0211', 'R044', 'R0501', 'R0971', 'S009', 'S025'];
const SUSPENDIDAS_CON_PAGOS = ['S004', 'S0141', 'S0395', 'S0441'];
const TODAS_LAS_SUSPENDIDAS = [...SUSPENDIDAS_SIN_PAGOS, ...SUSPENDIDAS_CON_PAGOS];

function ejecutarPaso4({ dbService, usuarioId = null }) {
  const CuentaEstadoRepository = require('../../src/repositories/CuentaEstadoRepository');
  const db = dbService.getDb();
  const estadoRepo = new CuentaEstadoRepository(dbService);

  const suspendidas = [];
  for (const codigo of TODAS_LAS_SUSPENDIDAS) {
    const cuenta = db.prepare('SELECT id FROM cuentas WHERE codigo = ?').get(codigo);
    if (!cuenta) throw new Error(`${codigo}: no existe en la base -- ¿corrió el paso 2?`);

    estadoRepo.cambiarEstado({
      cuentaId: cuenta.id, estado: 'Suspendido', fechaInicio: FECHA_SUSPENSION, motivo: MOTIVO, usuarioId
    });
    suspendidas.push({ codigo, cuentaId: cuenta.id });
  }

  return { suspendidas, fechaSuspension: FECHA_SUSPENSION };
}

module.exports = { ejecutarPaso4, SUSPENDIDAS_SIN_PAGOS, SUSPENDIDAS_CON_PAGOS, TODAS_LAS_SUSPENDIDAS, FECHA_SUSPENSION };
