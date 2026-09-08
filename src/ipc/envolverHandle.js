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
  // Los tres emiten AjusteCategoria retroactivo -- mismo nivel que asientos:crearManual y
  // caja:regularizarSaldos: puede mover deuda real de golpe (sobre una cuenta o sobre toda una
  // categoría) y necesita quedar detrás del mismo permiso.
  'cartera:recategorizar', 'cartera:recategorizarLote', 'cartera:reajustarTarifaCategoria',
  // Declara un saldo de apertura (antes de 2024) sin respaldo de cargos mes a mes -- mismo
  // riesgo que recategorizar/reajustarTarifaCategoria: mueve deuda real de golpe.
  'cartera:agregarDeudaApertura'
]);

// Excepciones puntuales a "Consulta no puede escribir": acciones que, aunque cambian estado
// local, su verdadera barrera de seguridad es otra. Conectar/desconectar una cuenta de Google es
// un dato de ESTE equipo (no algo compartido que requiera ser Administrador), y "traer/actualizar
// desde la nube" está deliberadamente abierto a cualquier rol porque el control real de acceso es
// si esa cuenta de Google tiene permiso sobre la carpeta de Drive — algo que se administra desde
// fuera de la app, no con los roles internos. Ver ARQUITECTURA.md, sección de respaldo en la nube.
const CANALES_PERMITIDOS_CONSULTA = new Set([
  'cloudBackup:conectar', 'cloudBackup:desconectar', 'cloudBackup:actualizarDesdeNube',
  'cloudBackup:configurarEquipo', 'cloudBackup:actualizarSiHayNuevo',
  // Abrir un enlace en el navegador externo no modifica ningún dato del sistema (es
  // funcionalmente una lectura), así que Consulta tampoco debe quedar bloqueado aquí aunque el
  // nombre del canal no empiece por un prefijo de lectura.
  'sistema:abrirEnlaceExterno'
]);

// Canales que funcionan incluso SIN sesión: la pantalla de "Configuración inicial" (un PC nuevo,
// con la base de datos vacía) necesita poder revisar si hay datos, y conectar/traer el respaldo
// de la nube, antes de que exista ningún usuario local con el que iniciar sesión. config:getAll
// también vive aquí porque la propia pantalla de login ya lo usaba para mostrar el nombre de la
// asociación (sin esto, fallaba en silencio).
const CANALES_SIN_SESION = new Set([
  'config:getAll', 'devtools:tieneDatosOperativos',
  'cloudBackup:getEstado', 'cloudBackup:conectar', 'cloudBackup:actualizarDesdeNube'
]);

// Canales que crean un documento financiero nuevo: doble clic o un reintento de red podían
// dispararlos dos veces, produciendo dos gastos/asientos/consignaciones/reembolsos idénticos
// (hallazgo Crítico C-2 de la auditoría de Contabilidad, 2026-07-03). El frontend envía un
// `opId` (uuid) generado al abrir el formulario, dentro del propio payload; ver Task 14 para el
// lado del renderer.
const CANALES_IDEMPOTENTES = new Set([
  'asientos:crearManual', 'gastos:create', 'caja:registrarConsignacion',
  'cajaMenor:reembolsar', 'pagos:registrarPagoSostenimiento', 'pagos:registrarAbonoDeudaAnterior', 'caja:regularizarSaldos',
  'cartera:agregarDeudaApertura',
  'caja:registrarRetiro', 'cartera:redimirCredito', 'cartera:suspender', 'cartera:reactivar', 'cartera:recategorizar',
  // Ambos crean un documento financiero real (un cargo de conexión con su valor, o un abono
  // con recibo propio) y no tenían protección -- mismo riesgo de doble clic que el resto de
  // esta lista (auditoría de entrega, hallazgo 8).
  'nuevospuntos:create', 'nuevospuntos:registrarAbono',
  // Emiten AjusteCategoria real; reajustarTarifaCategoria además inserta la tarifa nueva --
  // un doble clic no debe duplicar la corrección sobre toda una categoría.
  'cartera:recategorizar', 'cartera:recategorizarLote', 'cartera:reajustarTarifaCategoria'
]);

// opId -> Promise, mientras la operación sigue en curso (protege contra dos IPC casi
// simultáneos, el caso real de un doble clic).
const operacionesEnCurso = new Map();
// opId -> { resultado, expira }, solo para operaciones que YA terminaron con éxito. Un TTL
// corto es suficiente: solo hace falta cubrir la ventana de un doble clic o un reintento
// inmediato, no reintentos deliberados minutos después (que si fallaron por una validación de
// negocio, el usuario corrige el formulario y debe poder reenviar con normalidad).
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
            // Pasa, por ejemplo, en canales que cierran la base de datos para reiniciar la app
            // (restaurar/actualizar desde la nube): la acción ya tuvo éxito, así que esto no debe
            // hacer fallar la respuesta que el renderer ya recibió.
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
