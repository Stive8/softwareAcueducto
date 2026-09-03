const { ipcMain } = require('electron');
const { getSesionActual, setSesionActual, limpiarSesionActual } = require('./sesion');

// Canales de solo lectura: identificados por el verbo del método (get/find/simular/...). Estos
// están permitidos para cualquier rol, incluido Consulta. Todo lo que no matchee aquí se considera
// una escritura y requiere rol Usuario o Administrador como mínimo.
const PREFIJOS_LECTURA = ['get', 'find', 'simular', 'tiene', 'imprimir', 'exportar', 'generar'];

// Acciones reservadas exclusivamente al rol Administrador, sin importar que no sean de lectura.
const CANALES_SOLO_ADMIN = new Set([
  'usuarios:getAll', 'usuarios:crear', 'usuarios:toggleActivo', 'usuarios:resetearPassword',
  'config:actualizar', 'config:subirLogo', 'config:quitarLogo', 'backup:restaurar',
  'auditoria:getAll',
  'plancuentas:create', 'plancuentas:update', 'plancuentas:toggleActivo',
  'mapeocontable:actualizar', 'mapeocontable:crear',
  'asientos:crearManual', 'asientos:revertir',
  'caja:regularizarSaldos',
  'cuentasautomaticas:actualizar',
  'periodos:cerrar', 'periodos:bloquear', 'periodos:reabrir', 'periodos:actualizarNotas',
  'plantillas:actualizarLineas',
  'impuestos:create', 'impuestos:update', 'impuestos:toggleActivo',
  'impuestos:asignarAPlantilla', 'impuestos:quitarDePlantilla',
  'cloudBackup:respaldarAhora',
  'cajaMenor:asignarResponsable', 'cajaMenor:reembolsar',
  'cartera:recategorizar', 'cartera:recategorizarLote', 'cartera:reajustarTarifaCategoria'
]);

// Excepciones puntuales a "Consulta no puede escribir": ver ARQUITECTURA.md, sección de
// respaldo en la nube.
const CANALES_PERMITIDOS_CONSULTA = new Set([
  'cloudBackup:conectar', 'cloudBackup:desconectar', 'cloudBackup:actualizarDesdeNube',
  'cloudBackup:configurarEquipo', 'cloudBackup:actualizarSiHayNuevo',
  'sistema:abrirEnlaceExterno'
]);

// Canales que funcionan incluso SIN sesión.
const CANALES_SIN_SESION = new Set([
  'config:getAll', 'devtools:tieneDatosOperativos',
  'cloudBackup:getEstado', 'cloudBackup:conectar', 'cloudBackup:actualizarDesdeNube'
]);

// Canales que crean un documento financiero nuevo: protegidos contra doble clic / reintento.
const CANALES_IDEMPOTENTES = new Set([
  'asientos:crearManual', 'gastos:create', 'caja:registrarConsignacion',
  'cajaMenor:reembolsar', 'pagos:registrarPagoSostenimiento', 'pagos:registrarAbonoDeudaAnterior', 'caja:regularizarSaldos',
  'caja:registrarRetiro', 'cartera:redimirCredito', 'cartera:suspender', 'cartera:reactivar', 'cartera:recategorizar',
  'nuevospuntos:create', 'nuevospuntos:registrarAbono',
  'cartera:recategorizar', 'cartera:recategorizarLote', 'cartera:reajustarTarifaCategoria'
]);

// opId -> Promise, mientras la operación sigue en curso.
const operacionesEnCurso = new Map();
// opId -> { resultado, expira }, solo para operaciones que YA terminaron con éxito.
const TTL_OPERACION_EXITOSA_MS = 30000;
const operacionesCompletadas = new Map();

function limpiarOperacionesCompletadasExpiradas() {
  const ahora = Date.now();
  for (const [opId, entry] of operacionesCompletadas) {
    if (entry.expira <= ahora) operacionesCompletadas.delete(opId);
  }
}

function esCanalDeLectura(canal) {
  const metodo = canal.split(':')[1] || '';
  return PREFIJOS_LECTURA.some(prefijo => metodo.startsWith(prefijo));
}

// Envuelve ipcMain.handle para aplicar sesión, permisos por rol y auditoría automática a TODOS
// los canales sin tener que tocar cada handler uno por uno.
function crearEnvolverHandle({ auditoriaService }) {
  return function envolverHandle(canal, fn) {
    ipcMain.handle(canal, async (event, ...args) => {
      if (canal === 'auth:login') {
        const resultado = await fn(event, ...args);
        if (resultado.success) {
          setSesionActual(resultado.data);
          auditoriaService.registrar({ usuarioId: resultado.data.id, accion: 'login', tabla: 'usuarios', registroId: resultado.data.id });
        }
        return resultado;
      }

      const sesionActual = getSesionActual();

      if (!sesionActual) {
        if (CANALES_SIN_SESION.has(canal)) {
          return fn(event, ...args);
        }
        return { success: false, error: 'Debe iniciar sesión' };
      }

      if (canal === 'auth:logout') {
        auditoriaService.registrar({ usuarioId: sesionActual.id, accion: 'logout', tabla: 'usuarios', registroId: sesionActual.id });
        limpiarSesionActual();
        return { success: true };
      }

      if (canal === 'auth:cambiarPassword') {
        return fn(event, ...args);
      }

      if (CANALES_SOLO_ADMIN.has(canal) && sesionActual.rol !== 'Administrador') {
        return { success: false, error: 'Esta acción requiere permisos de Administrador' };
      }

      const esLectura = esCanalDeLectura(canal);
      if (!esLectura && !CANALES_PERMITIDOS_CONSULTA.has(canal) && sesionActual.rol === 'Consulta') {
        return { success: false, error: 'Su rol de Consulta solo permite ver información, no modificarla' };
      }

      let opId = null;
      if (CANALES_IDEMPOTENTES.has(canal) && args[0] && typeof args[0] === 'object' && args[0].opId) {
        opId = args[0].opId;
        delete args[0].opId;

        limpiarOperacionesCompletadasExpiradas();

        const completada = operacionesCompletadas.get(opId);
        if (completada) return completada.resultado;

        const enCurso = operacionesEnCurso.get(opId);
        if (enCurso) return enCurso;
      }

      const promesaResultado = (async () => {
        const r = await fn(event, ...args);
        if (opId && r && r.success) {
          operacionesCompletadas.set(opId, { resultado: r, expira: Date.now() + TTL_OPERACION_EXITOSA_MS });
        }
        return r;
      })();

      if (opId) operacionesEnCurso.set(opId, promesaResultado);
      try {
        const resultado = await promesaResultado;

        if (!esLectura && resultado && resultado.success) {
          try {
            const [modulo, metodo] = canal.split(':');
            const registroId = resultado.data?.id ?? resultado.data?.reciboId ?? (typeof args[0] === 'number' ? args[0] : null);
            let datosNuevos = null;
            try { datosNuevos = JSON.stringify(args[0] ?? null); } catch { /* no serializable, se omite */ }
            auditoriaService.registrar({ usuarioId: sesionActual.id, accion: metodo, tabla: modulo, registroId, datosNuevos });
          } catch (errorAuditoria) {
            console.error('No se pudo registrar la auditoría:', errorAuditoria.message);
          }
        }

        return resultado;
      } finally {
        // Antes solo se borraba tras un await exitoso: si promesaResultado rechazaba, el opId
        // quedaba en operacionesEnCurso para siempre y todo reintento posterior con ese mismo
        // opId (justo el caso de doble clic que esto protege) devolvía la misma promesa ya
        // rechazada en vez de reintentar. Hallazgo de la auditoría de calidad, 2026-09-03.
        if (opId) operacionesEnCurso.delete(opId);
      }
    });
  };
}

module.exports = { crearEnvolverHandle };
