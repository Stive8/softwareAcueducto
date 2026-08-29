const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');

// Esta es una app de escritorio monousuario sobre un único archivo SQLite
// (data/acueducto.db). Sin este candado, abrir el ejecutable dos veces crea dos procesos
// completamente independientes -dos conexiones SQLite, dos sesiones de usuario- escribiendo
// sobre el mismo archivo; los consecutivos (número de asiento, número de recibo) se calculan
// como "leer el máximo actual, sumar uno" y podrían leerse el mismo valor desde ambos procesos
// casi al mismo tiempo -hallazgo Alto A-6 de la auditoría de Contabilidad (2026-07-03)-. Si ya
// hay una instancia corriendo, esta nueva se cierra de inmediato y le pide a la primera que
// traiga su ventana al frente, en vez de dejar ambas abiertas.
const tieneCandadoUnico = app.requestSingleInstanceLock();
if (!tieneCandadoUnico) {
  app.quit();
}

const path = require('path');
const fs = require('fs');
const DatabaseService = require('./src/database/DatabaseService');
const CuentaService = require('./src/services/CuentaService');
const DashboardService = require('./src/services/DashboardService');
const PropietarioService = require('./src/services/PropietarioService');
const CategoriaService = require('./src/services/CategoriaService');
const PagoService = require('./src/services/PagoService');
const CarteraService = require('./src/services/CarteraService');
const ReciboService = require('./src/services/ReciboService');
const GastoService = require('./src/services/GastoService');
const CajaService = require('./src/services/CajaService');
const AuthService = require('./src/services/AuthService');
const ConfiguracionService = require('./src/services/ConfiguracionService');
const BackupService = require('./src/services/BackupService');
const NuevoPuntoService = require('./src/services/NuevoPuntoService');
const ReporteService = require('./src/services/ReporteService');
const ExcelExportService = require('./src/services/ExcelExportService');
const PlantillaReporteService = require('./src/services/PlantillaReporteService');
const DevToolsService = require('./src/services/DevToolsService');
const AuditoriaService = require('./src/services/AuditoriaService');
const PlanCuentaService = require('./src/services/PlanCuentaService');
const MapeoContableService = require('./src/services/MapeoContableService');
const AsientoContableService = require('./src/services/AsientoContableService');
const CajaMenorService = require('./src/services/CajaMenorService');
const CloudBackupOrchestratorService = require('./src/services/CloudBackupOrchestratorService');
const ComprobanteCloudService = require('./src/services/ComprobanteCloudService');
const TerceroService = require('./src/services/TerceroService');
const CuentaAutomaticaService = require('./src/services/CuentaAutomaticaService');
const CuentaAutomaticaRepository = require('./src/repositories/CuentaAutomaticaRepository');
const PlanCuentaRepository = require('./src/repositories/PlanCuentaRepository');
const PeriodoContableService = require('./src/services/PeriodoContableService');
const PeriodoContableRepository = require('./src/repositories/PeriodoContableRepository');
const PlantillaContabilizacionService = require('./src/services/PlantillaContabilizacionService');
const ImpuestoService = require('./src/services/ImpuestoService');
const MotorContabilizacionService = require('./src/services/MotorContabilizacionService');

let mainWindow;
let dbService;
let cuentaService;
let dashboardService;
let propietarioService;
let categoriaService;
let terceroService;
let pagoService;
let carteraService;
let reciboService;
let gastoService;
let cajaService;
let authService;
let configuracionService;
let backupService;
let nuevoPuntoService;
let reporteService;
let excelExportService;
let plantillaReporteService;
let devToolsService;
let auditoriaService;
let planCuentaService;
let mapeoContableService;
let asientoContableService;
let cajaMenorService;
let cuentaAutomaticaService;
let periodoContableService;
let plantillaContabilizacionService;
let impuestoService;
let motorContabilizacionService;
let cloudBackupService;
let comprobanteCloudService;

// Sesión activa del único usuario que puede estar usando esta app de escritorio a la vez.
// No es solo un dato de UI: la capa de permisos de abajo (envolverHandle) la usa para decidir
// qué canal de IPC puede ejecutar cada rol, y para saber a quién atribuir cada acción auditada.
let sesionActual = null;

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
  'cartera:recategorizar', 'cartera:recategorizarLote', 'cartera:reajustarTarifaCategoria'
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
// los canales sin tener que tocar cada handler uno por uno. auth:login es la única excepción
// (todavía no hay sesión cuando se llama), y auth:cambiarPassword solo exige estar logueado
// (cualquier rol puede cambiar su propia contraseña).
function envolverHandle(canal, fn) {
  ipcMain.handle(canal, async (event, ...args) => {
    if (canal === 'auth:login') {
      const resultado = await fn(event, ...args);
      if (resultado.success) {
        sesionActual = resultado.data;
        auditoriaService.registrar({ usuarioId: sesionActual.id, accion: 'login', tabla: 'usuarios', registroId: sesionActual.id });
      }
      return resultado;
    }

    if (!sesionActual) {
      if (CANALES_SIN_SESION.has(canal)) {
        return fn(event, ...args);
      }
      return { success: false, error: 'Debe iniciar sesión' };
    }

    if (canal === 'auth:logout') {
      auditoriaService.registrar({ usuarioId: sesionActual.id, accion: 'logout', tabla: 'usuarios', registroId: sesionActual.id });
      sesionActual = null;
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
      delete args[0].opId; // no debe llegar a la capa de servicio

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
    const resultado = await promesaResultado;
    if (opId) operacionesEnCurso.delete(opId);

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
  });
}

function createWindow() {
  // Esta es una app administrativa, no un navegador: el menú File/Edit/View de Electron
  // no aporta nada aquí y solo confunde al usuario final.
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile('src/renderer/index.html');
  
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

// La instancia perdedora del candado (tieneCandadoUnico === false) nunca debe llegar a este
// punto: app.quit() es asíncrono y no detiene por sí solo la ejecución del resto del archivo,
// así que todo el arranque real queda condicionado explícitamente al candado para que esa
// instancia no abra la base de datos ni una ventana antes de cerrarse.
if (tieneCandadoUnico) {
app.whenReady().then(async () => {
  // Empaquetada (instalada): app.getPath('userData'), la única carpeta escribible una vez
  // instalada en Program Files. En desarrollo (npm start): la carpeta del proyecto, para que
  // borrar/inspeccionar data/acueducto.db localmente tenga efecto real.
  const baseDirDb = app.isPackaged ? app.getPath('userData') : __dirname;
  dbService = new DatabaseService(baseDirDb);
  dbService.initialize();
  
  cuentaService = new CuentaService(dbService);
  dashboardService = new DashboardService(dbService);
  propietarioService = new PropietarioService(dbService);
  categoriaService = new CategoriaService(dbService);
  terceroService = new TerceroService(dbService);
  pagoService = new PagoService(dbService);
  // Solo lectura por ahora: pantalla de "Cartera (nuevo modelo)" colgada del modal de Pagos,
  // ver PUNTOS-CONFLICTIVOS.md. Ningún canal de escritura registrado todavía a propósito.
  carteraService = new CarteraService(dbService);
  reciboService = new ReciboService(dbService);
  gastoService = new GastoService(dbService);
  cajaService = new CajaService(dbService);
  authService = new AuthService(dbService);
  const passwordRecuperacionGenerada = authService.generarCredencialRecuperacionSiHaceFalta();
  backupService = new BackupService(dbService);
  nuevoPuntoService = new NuevoPuntoService(dbService);
  reporteService = new ReporteService(dbService);
  excelExportService = new ExcelExportService(dbService);
  plantillaReporteService = new PlantillaReporteService(dbService);
  devToolsService = new DevToolsService(dbService);
  auditoriaService = new AuditoriaService(dbService);
  planCuentaService = new PlanCuentaService(dbService);
  mapeoContableService = new MapeoContableService(dbService);
  asientoContableService = new AsientoContableService(dbService);
  configuracionService = new ConfiguracionService(dbService, asientoContableService);
  cajaMenorService = new CajaMenorService(dbService);
  cuentaAutomaticaService = new CuentaAutomaticaService(new CuentaAutomaticaRepository(dbService), new PlanCuentaRepository(dbService));
  periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService), dbService);
  plantillaContabilizacionService = new PlantillaContabilizacionService(dbService);
  impuestoService = new ImpuestoService(dbService);
  motorContabilizacionService = new MotorContabilizacionService(dbService);
  cloudBackupService = new CloudBackupOrchestratorService(dbService, baseDirDb);
  comprobanteCloudService = new ComprobanteCloudService(baseDirDb);

  if (passwordRecuperacionGenerada) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Cuenta de recuperación creada',
      message: 'Se generó una cuenta de recuperación de emergencia para este sistema.',
      detail:
        `Usuario: recuperacion\n` +
        `Contraseña: ${passwordRecuperacionGenerada}\n\n` +
        `Guarde esta contraseña en un lugar seguro (fuera de este equipo). No se volverá a ` +
        `mostrar, y sirve para recuperar el acceso si todas las demás cuentas Administrador ` +
        `quedan desactivadas o sin contraseña conocida.`
    });
  }

  setupIpcHandlers();
  createWindow();

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // No bloquea el arranque: corre en segundo plano y solo actúa si ya pasó el intervalo.
  backupService.ejecutarSiCorresponde();
}).catch((error) => {
  // Sin este catch, cualquier error durante el arranque (migración fallida, base de datos
  // corrupta, un Service que lanza en su constructor, etc.) quedaba como un rechazo de promesa
  // sin manejar: la ventana nunca se creaba, pero el proceso principal de Electron seguía vivo
  // e indefinido en Administrador de Tareas -sin ninguna pista de qué pasó-, y una nueva
  // instancia (doble clic, o el instalador intentando sobrescribir el .exe) quedaba bloqueada
  // por el candado de instancia única que ese proceso zombie seguía sosteniendo.
  console.error('Error fatal al iniciar la aplicación:', error);
  dialog.showErrorBox(
    'Acueducto Admin no pudo iniciar',
    `La aplicación encontró un error al arrancar y se cerrará.\n\n` +
    `Detalle técnico: ${error.message}\n\n` +
    `Si el problema persiste, comparta este mensaje con soporte técnico.`
  );
  app.exit(1);
});

// Respaldo automático en la nube al cerrar la app (no a una hora fija: esta es una app de
// escritorio que puede estar apagada días enteros, así que "el final del día de trabajo" en la
// práctica es "cuando se cierra la app"). Solo si hay una cuenta conectada y hubo cambios reales
// desde el último respaldo exitoso (evita subir copias idénticas si solo se abrió a consultar
// algo). Se fuerza (forzar=true) porque aquí no hay nadie para decidir sobre un aviso de
// conflicto; mejor que el trabajo de hoy quede respaldado igual, y revisar el conflicto después
// manualmente. Un límite de tiempo evita que una conexión lenta retrase cerrar la app.
let yaIntentoRespaldoAlCerrar = false;
app.on('before-quit', async (event) => {
  if (yaIntentoRespaldoAlCerrar) return;
  if (!cloudBackupService || !cloudBackupService.estaConectado()) return;
  if (!cloudBackupService.hayCambiosSinRespaldar()) return;

  event.preventDefault();
  yaIntentoRespaldoAlCerrar = true;

  try {
    await Promise.race([
      cloudBackupService.respaldarAhora(backupService, { forzar: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado')), 20000))
    ]);
  } catch (error) {
    const esTokenInvalido =
      error.message?.includes('invalid_grant') ||
      error.response?.data?.error === 'invalid_grant';
    if (esTokenInvalido) {
      // El refresh token expiró o fue revocado desde Google. Se limpia el archivo de token
      // para que la app no lo intente en el próximo inicio. El usuario deberá reconectar
      // la cuenta desde Configuración.
      try { cloudBackupService.desconectar(); } catch { /* ignorar errores de limpieza */ }
      console.warn('Token de Google Drive expirado o revocado. La cuenta fue desconectada. Reconecte desde Configuración.');
    } else {
      console.error('No se pudo respaldar en la nube al cerrar la app:', error.message);
    }
  } finally {
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
}

function setupIpcHandlers() {
  // Dashboard
  envolverHandle('dashboard:getStats', async () => {
    try {
      const stats = dashboardService.getStats();
      const estadoNube = cloudBackupService.getEstado();

      let diasSinRespaldar = null;
      if (estadoNube.ultimaFechaExitosa) {
        diasSinRespaldar = Math.floor((Date.now() - new Date(estadoNube.ultimaFechaExitosa).getTime()) / 86400000);
      }

      // verificarConciliacionCajaBanco ya existía (conectado a IPC vía asientos:getConciliacionCajaBanco)
      // pero ninguna pantalla lo llamaba -- su propio comentario decía "pensado para invocarse desde
      // una pantalla de diagnóstico" y nunca se conectó a una (auditoría 2026-08-29). Se agrega acá,
      // no como alerta aparte, para que quien abre el Dashboard vea sin buscarlo si Caja/Banco
      // dejaron de cuadrar contra la contabilidad de doble partida.
      const conciliacionCajaBanco = asientoContableService.verificarConciliacionCajaBanco();

      return {
        success: true,
        data: { ...stats, respaldoNube: { conectado: estadoNube.conectado, diasSinRespaldar }, conciliacionCajaBanco }
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('dashboard:getChartData', async () => {
    try {
      return { success: true, data: dashboardService.getChartData() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('dashboard:getActividadReciente', async () => {
    try {
      return { success: true, data: dashboardService.getActividadReciente() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cuentas
  envolverHandle('cuentas:getAll', async (event, params) => {
    try {
      return { success: true, data: cuentaService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentas:getById', async (event, id) => {
    try {
      const cuenta = cuentaService.getById(id);
      if (!cuenta) {
        return { success: false, error: 'Cuenta no encontrada' };
      }
      return { success: true, data: cuenta };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentas:getCategorias', async () => {
    try {
      return { success: true, data: cuentaService.getCategorias() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentas:getStats', async () => {
    try {
      return { success: true, data: cuentaService.getStats() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentas:create', async (event, cuentaData) => {
    try {
      const id = cuentaService.create(cuentaData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentas:update', async (event, id, cuentaData) => {
    try {
      cuentaService.update(id, cuentaData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Propietarios
  envolverHandle('propietarios:getAll', async (event, params) => {
    try {
      return { success: true, data: propietarioService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:getStats', async () => {
    try {
      return { success: true, data: propietarioService.getStats() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:getById', async (event, id) => {
    try {
      const propietario = propietarioService.getById(id);
      if (!propietario) {
        return { success: false, error: 'Propietario no encontrado' };
      }
      return { success: true, data: propietario };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:create', async (event, propietarioData) => {
    try {
      const id = propietarioService.create(propietarioData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:update', async (event, id, propietarioData) => {
    try {
      propietarioService.update(id, propietarioData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:getCuentasActuales', async (event, propietarioId) => {
    try {
      return { success: true, data: propietarioService.getCuentasActuales(propietarioId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:getHistorialCuentas', async (event, propietarioId) => {
    try {
      return { success: true, data: propietarioService.getHistorialCuentas(propietarioId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:asignarACuenta', async (event, cuentaId, propietarioId, fechaInicio, observaciones) => {
    try {
      propietarioService.asignarACuenta(cuentaId, propietarioId, fechaInicio, observaciones);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:getHistorialPropietariosCuenta', async (event, cuentaId) => {
    try {
      return { success: true, data: propietarioService.getHistorialPropietariosCuenta(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Categorías
  envolverHandle('categorias:getAll', async (event, params) => {
    try {
      return { success: true, data: categoriaService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:getById', async (event, id) => {
    try {
      const categoria = categoriaService.getById(id);
      if (!categoria) {
        return { success: false, error: 'Categoría no encontrada' };
      }
      return { success: true, data: categoria };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:create', async (event, categoriaData) => {
    try {
      const id = categoriaService.create(categoriaData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:update', async (event, id, categoriaData) => {
    try {
      categoriaService.update(id, categoriaData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:toggleActivo', async (event, id) => {
    try {
      categoriaService.toggleActivo(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:getTarifaVigente', async (event, categoriaId, fecha) => {
    try {
      return { success: true, data: categoriaService.getTarifaVigente(categoriaId, fecha) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Terceros (proveedores y otros aliados; los clientes siguen siendo Propietarios)
  envolverHandle('terceros:getAll', async (event, params) => {
    try {
      return { success: true, data: terceroService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('terceros:getById', async (event, id) => {
    try {
      const tercero = terceroService.getById(id);
      if (!tercero) {
        return { success: false, error: 'Tercero no encontrado' };
      }
      return { success: true, data: tercero };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('terceros:create', async (event, terceroData) => {
    try {
      const id = terceroService.create(terceroData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('terceros:update', async (event, id, terceroData) => {
    try {
      terceroService.update(id, terceroData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('terceros:toggleActivo', async (event, id) => {
    try {
      terceroService.toggleActivo(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('terceros:getHistorialMovimientos', async (event, id) => {
    try {
      return { success: true, data: terceroService.getHistorialMovimientos(id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:getHistorialTarifas', async (event, categoriaId) => {
    try {
      return { success: true, data: categoriaService.getHistorialTarifas(categoriaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:crearTarifa', async (event, categoriaId, tarifa, fechaDesde, observaciones) => {
    try {
      categoriaService.crearTarifa(categoriaId, tarifa, fechaDesde, observaciones);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:getCuentasConCategoria', async (event, categoriaId) => {
    try {
      return { success: true, data: categoriaService.getCuentasConCategoria(categoriaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:getHistorialCategoriasCuenta', async (event, cuentaId) => {
    try {
      return { success: true, data: categoriaService.getHistorialCategoriasCuenta(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Plan de Cuentas (PUC) y mapeo contable. Preparación para una futura contabilidad de doble
  // partida: por ahora solo administra el catálogo y la clasificación, sin generar asientos.
  envolverHandle('plancuentas:getAll', async (event, params) => {
    try {
      return { success: true, data: planCuentaService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('plancuentas:getImputables', async (event, params) => {
    try {
      return { success: true, data: planCuentaService.getImputables(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('plancuentas:getById', async (event, id) => {
    try {
      const cuenta = planCuentaService.getById(id);
      if (!cuenta) return { success: false, error: 'Cuenta contable no encontrada' };
      return { success: true, data: cuenta };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('plancuentas:create', async (event, cuentaData) => {
    try {
      const id = planCuentaService.create(cuentaData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('plancuentas:update', async (event, id, cuentaData) => {
    try {
      planCuentaService.update(id, cuentaData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('plancuentas:toggleActivo', async (event, id) => {
    try {
      planCuentaService.toggleActivo(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('mapeocontable:getAll', async (event, modulo) => {
    try {
      return { success: true, data: mapeoContableService.getAll(modulo) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('mapeocontable:actualizar', async (event, modulo, concepto, cuentaContableId) => {
    try {
      mapeoContableService.actualizar(modulo, concepto, cuentaContableId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('mapeocontable:crear', async (event, modulo, concepto, cuentaContableId) => {
    try {
      mapeoContableService.crear(modulo, concepto, cuentaContableId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cuentas Automáticas: las cuentas contables que el sistema usa sin que el operador tenga que
  // elegirlas explícitamente (Caja, Banco, Cartera de Usuarios). Solo el Administrador puede
  // reasignar a qué cuenta PUC apunta cada clave.
  envolverHandle('cuentasautomaticas:getAll', async () => {
    try {
      return { success: true, data: cuentaAutomaticaService.getAll() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentasautomaticas:actualizar', async (event, clave, cuentaContableId) => {
    try {
      return { success: true, data: cuentaAutomaticaService.actualizar(clave, cuentaContableId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Períodos Contables: administración de aperturas y cierres de períodos mes/año.
  envolverHandle('periodos:getAll', async () => {
    try {
      return { success: true, data: periodoContableService.getAll() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('periodos:getByAnioMes', async (event, anio, mes) => {
    try {
      return { success: true, data: periodoContableService.getByAnioMes(anio, mes) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('periodos:cerrar', async (event, id, motivoCierre) => {
    try {
      return { success: true, data: periodoContableService.cerrar(id, sesionActual.id, motivoCierre) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('periodos:bloquear', async (event, id, motivoCierre) => {
    try {
      return { success: true, data: periodoContableService.bloquear(id, sesionActual.id, motivoCierre) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('periodos:reabrir', async (event, id) => {
    try {
      return { success: true, data: periodoContableService.reabrir(id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('periodos:actualizarNotas', async (event, id, notas) => {
    try {
      return { success: true, data: periodoContableService.actualizarNotas(id, notas) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Dashboard contable: KPIs del módulo de Contabilidad.
  envolverHandle('contabilidad:getDashboard', async () => {
    try {
      return { success: true, data: reporteService.getDashboardContable() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Plantillas de contabilización: catálogo de patrones de asiento configurables.
  envolverHandle('plantillas:getAll', async () => {
    try { return { success: true, data: plantillaContabilizacionService.getAll() }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('plantillas:getById', async (event, id) => {
    try { return { success: true, data: plantillaContabilizacionService.getById(id) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('plantillas:getVersiones', async (event, codigo) => {
    try { return { success: true, data: plantillaContabilizacionService.getVersiones(codigo) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('plantillas:actualizarLineas', async (event, id, nuevasLineas) => {
    try { return { success: true, data: plantillaContabilizacionService.actualizarLineas(id, nuevasLineas) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  // Prefijo 'simular' → lectura automática (cualquier rol puede usar la herramienta de simulación)
  envolverHandle('plantillas:simularContabilizacion', async (event, plantillaId, contextoJson) => {
    try { return { success: true, data: motorContabilizacionService.simularContabilizacion(plantillaId, contextoJson) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  // Motor tributario: impuestos configurables.
  envolverHandle('impuestos:getAll', async () => {
    try { return { success: true, data: impuestoService.getAll() }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:getById', async (event, id) => {
    try { return { success: true, data: impuestoService.getById(id) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:create', async (event, datos) => {
    try {
      const imp = impuestoService.create(datos);
      return { success: true, data: imp };
    } catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:update', async (event, id, datos) => {
    try {
      const imp = impuestoService.update(id, datos);
      return { success: true, data: imp };
    } catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:toggleActivo', async (event, id) => {
    try { return { success: true, data: impuestoService.toggleActivo(id) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:asignarAPlantilla', async (event, plantillaId, impuestoId, orden) => {
    try { impuestoService.asignarAPlantilla(plantillaId, impuestoId, orden); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:quitarDePlantilla', async (event, plantillaId, impuestoId) => {
    try { impuestoService.quitarDePlantilla(plantillaId, impuestoId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:getPlantillasAsignadas', async (event, impuestoId) => {
    try { return { success: true, data: impuestoService.getPlantillasAsignadas(impuestoId) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  // Asientos contables (doble partida). La generación automática ocurre dentro de los servicios
  // de gastos/pagos/caja; aquí solo se exponen consulta, el asiento manual (ajustes) y reversión.
  envolverHandle('asientos:getAll', async (event, params) => {
    try {
      return { success: true, data: asientoContableService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:getById', async (event, id) => {
    try {
      const asiento = asientoContableService.getById(id);
      if (!asiento) return { success: false, error: 'Asiento no encontrado' };
      return { success: true, data: asiento };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:crearManual', async (event, datos) => {
    try {
      const id = asientoContableService.crearManual({ ...datos, usuarioId: sesionActual.id });
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:revertir', async (event, id, motivo) => {
    try {
      const reversionId = asientoContableService.revertirManual(id, motivo, sesionActual.id);
      return { success: true, data: { id: reversionId } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:getLibroMayor', async (event, cuentaContableId, fechaDesde, fechaHasta) => {
    try {
      return { success: true, data: asientoContableService.getLibroMayor(cuentaContableId, fechaDesde, fechaHasta) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:getBalancePrueba', async (event, fechaDesde, fechaHasta) => {
    try {
      return { success: true, data: asientoContableService.getBalancePrueba(fechaDesde, fechaHasta) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:getConciliacionCajaBanco', async () => {
    try {
      return { success: true, data: asientoContableService.verificarConciliacionCajaBanco() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:imprimir', async (event, id) => {
    let ventanaImpresion;
    try {
      const html = asientoContableService.generarHTML(id);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      return await new Promise((resolve) => {
        ventanaImpresion.webContents.print({ silent: false }, (success, errorType) => {
          ventanaImpresion.close();
          if (mainWindow) mainWindow.focus();
          if (success) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: errorType || 'No se pudo imprimir el registro contable' });
          }
        });
      });
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  envolverHandle('asientos:exportarPDF', async (event, id) => {
    let ventanaImpresion;
    try {
      const asiento = asientoContableService.getById(id);
      if (!asiento) {
        return { success: false, error: 'Asiento no encontrado' };
      }

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar Registro Contable como PDF',
        defaultPath: `RegistroContable_${asiento.numero}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const html = asientoContableService.generarHTML(id);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const pdfBuffer = await ventanaImpresion.webContents.printToPDF({});
      fs.writeFileSync(filePath, pdfBuffer);
      ventanaImpresion.close();

      return { success: true, filePath };
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  // Pagos
  envolverHandle('pagos:getCuentasConEstado', async (event, params) => {
    try {
      return { success: true, data: pagoService.getCuentasConEstado(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:getEstadoCuenta', async (event, cuentaId) => {
    try {
      return { success: true, data: pagoService.getEstadoCuenta(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:simularPago', async (event, cuentaId, anioInicio, mesInicio, cantidadMeses, usarSaldoAFavor) => {
    try {
      return { success: true, data: pagoService.simularPago(cuentaId, anioInicio, mesInicio, cantidadMeses, usarSaldoAFavor) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:registrarPagoSostenimiento', async (event, payload) => {
    try {
      return { success: true, data: pagoService.registrarPagoSostenimiento(payload, sesionActual.id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:registrarAbonoDeudaAnterior', async (event, payload) => {
    try {
      return { success: true, data: pagoService.registrarAbonoDeudaAnterior(payload, sesionActual.id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:getHistorialPagos', async (event, cuentaId) => {
    try {
      return { success: true, data: pagoService.getHistorialPagos(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cartera (nuevo modelo) -- solo lectura. Ver PUNTOS-CONFLICTIVOS.md: el sistema activo de
  // cobro sigue siendo pagos:*; estos canales solo muestran el modelo nuevo en paralelo para
  // poder validarlo con datos reales antes de conectarle escritura.
  envolverHandle('cartera:getEstadoCartera', async (event, cuentaId) => {
    try {
      return { success: true, data: carteraService.getEstadoCartera(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cartera:getDetalleCartera', async (event, cuentaId) => {
    try {
      return { success: true, data: carteraService.getDetalleCartera(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cartera:getMotivoDiferencia', async (event, cuentaId) => {
    try {
      return { success: true, data: carteraService.getMotivoDiferencia(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cartera:getIndicadoresBulk', async () => {
    try {
      return { success: true, data: carteraService.getIndicadoresBulk() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Primera escritura conectada del modelo nuevo de cartera: redime saldo a favor ya
  // existente (cuenta_creditos) contra deuda exigible por FIFO. No genera recibo -- no es
  // plata nueva, es reasignar la que la cuenta ya tiene guardada. El resto de las escrituras
  // (recategorizar, suspender, reactivar, ajustarDeuda, reclasificarAbono) sigue sin conectar.
  envolverHandle('cartera:redimirCredito', async (event, payload) => {
    try {
      return { success: true, data: carteraService.redimirCredito({ ...payload, usuarioId: sesionActual.id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Suspende/reactiva UNA cuenta anulando (suspender) o dejando anulados (reactivar, no
  // recausa retroactivo) los cargos que correspondan. Reemplaza los botones "Suspender"/
  // "Activar" de Cuentas (auditoría 2026-08-29): antes cambiaban cuentas.estado directo
  // (cuentas:changeStatus, retirado) sin dejar rastro en cuenta_estados ni anular
  // cartera_movimientos -- una cuenta marcada Suspendido en pantalla seguía causando y
  // contando en mora en el motor nuevo, porque calcularAPagar/asegurarCausacion leen
  // cuenta_estados, no cuentas.estado.
  envolverHandle('cartera:suspender', async (event, payload) => {
    try {
      return { success: true, data: carteraService.suspender({ ...payload, usuarioId: sesionActual.id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cartera:reactivar', async (event, payload) => {
    try {
      return { success: true, data: carteraService.reactivar({ ...payload, usuarioId: sesionActual.id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cambia la categoría de UNA cuenta (ej. "esta casa en realidad tiene piscina desde tal
  // fecha"), sin cambiar la tarifa de la categoría en sí. Para reajustar la tarifa de una
  // categoría completa (todas sus cuentas a la vez, con efecto retroactivo), ver
  // cartera:reajustarTarifaCategoria más abajo.
  envolverHandle('cartera:recategorizar', async (event, payload) => {
    try {
      return { success: true, data: carteraService.recategorizar({ ...payload, usuarioId: sesionActual.id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Vista previa de recategorizar sobre varias cuentas CON la tarifa que ya está en la base
  // (a diferencia de simularReajustarTarifaCategoria, que además prueba una tarifa nueva que
  // todavía no existe) -- para el aviso que se dispara después de categorias:crearTarifa (ver
  // Categorias.showTarifaModal): si la tarifa que se acaba de guardar dejó cargos ya causados
  // desalineados, esto lo detecta sin insertar nada más.
  envolverHandle('cartera:simularRecategorizarLote', async (event, payload) => {
    try {
      return { success: true, data: carteraService.simularRecategorizarLote(payload) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Aplica recategorizar sobre varias cuentas SIN tocar categoria_tarifas -- para cuando la
  // tarifa ya se creó por separado (ver cartera:simularRecategorizarLote) y solo falta corregir
  // los cargos ya causados.
  envolverHandle('cartera:recategorizarLote', async (event, payload) => {
    try {
      return { success: true, data: carteraService.recategorizarLote({ ...payload, usuarioId: sesionActual.id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Vista previa del reajuste de tarifa de una categoría completa: NO escribe nada -- corre la
  // misma transacción real (crear la tarifa nueva + AjusteCategoria a cada cuenta) y la
  // revierte a propósito, así nunca se puede desincronizar de lo que aplicar() haría de
  // verdad. cuentaIds normalmente sale de categorias:getCuentasConCategoria(categoriaId).
  envolverHandle('cartera:simularReajustarTarifaCategoria', async (event, payload) => {
    try {
      return { success: true, data: carteraService.simularReajustarTarifaCategoria(payload) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Aplica el reajuste de tarifa: crea la tarifa nueva (categoria_tarifas) y corrige con
  // AjusteCategoria a cada cuenta de cuentaIds -- en una sola transacción. Solo Administrador:
  // puede mover mucha plata de golpe y con efecto retroactivo, mismo nivel que
  // asientos:crearManual/caja:regularizarSaldos (ver CANALES_SOLO_ADMIN).
  envolverHandle('cartera:reajustarTarifaCategoria', async (event, payload) => {
    try {
      return { success: true, data: carteraService.reajustarTarifaCategoria({ ...payload, usuarioId: sesionActual.id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Recibos
  envolverHandle('recibos:getAll', async (event, params) => {
    try {
      return { success: true, data: reciboService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:getById', async (event, id) => {
    try {
      const recibo = reciboService.getById(id);
      if (!recibo) {
        return { success: false, error: 'Recibo no encontrado' };
      }
      return { success: true, data: recibo };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:anular', async (event, id, motivo) => {
    try {
      reciboService.anular(id, motivo, sesionActual.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:corregirMetodoPago', async (event, id, nuevoMetodoPago, motivo) => {
    try {
      reciboService.corregirMetodoPago(id, nuevoMetodoPago, motivo, sesionActual.id);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:getConsecutivo', async () => {
    try {
      return { success: true, data: reciboService.getConsecutivoRecibo() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:registrarAnuladoFisico', async (event, datos) => {
    try {
      return { success: true, data: reciboService.registrarAnuladoFisico(datos) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:getAnuladosFisicos', async () => {
    try {
      return { success: true, data: reciboService.getAnuladosFisicos() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:imprimirEstadoCuenta', async (event, cuentaId) => {
    let ventanaImpresion;
    try {
      const html = pagoService.generarHTMLEstadoCuenta(cuentaId);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      return await new Promise((resolve) => {
        ventanaImpresion.webContents.print({ silent: false }, (success, errorType) => {
          ventanaImpresion.close();
          if (mainWindow) mainWindow.focus();
          if (success) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: errorType || 'No se pudo imprimir el estado de cuenta' });
          }
        });
      });
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  envolverHandle('pagos:exportarEstadoCuentaPDF', async (event, cuentaId) => {
    let ventanaImpresion;
    try {
      const cuenta = cuentaService.getById(cuentaId);
      if (!cuenta) {
        return { success: false, error: 'Cuenta no encontrada' };
      }

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar Estado de Cuenta como PDF',
        defaultPath: `Estado_Cuenta_${cuenta.codigo}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const html = pagoService.generarHTMLEstadoCuenta(cuentaId);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const pdfBuffer = await ventanaImpresion.webContents.printToPDF({});
      fs.writeFileSync(filePath, pdfBuffer);
      ventanaImpresion.close();
      if (mainWindow) mainWindow.focus();
      return { success: true, filePath };
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  // Chromium exige alto Y ancho fijos en pageSize (no hay "alto automático" como en una impresora
  // térmica física de papel continuo). Como el recibo térmico varía de largo según cuántos
  // conceptos tenga, se mide el contenido ya cargado en la ventana oculta y se calcula el alto en
  // micrones a partir de eso, en vez de asumir un tamaño fijo que podría cortar el recibo o
  // desperdiciar papel.
  const ANCHO_TERMICO_MICRONES = 80000; // 80mm
  const MARGEN_ALTURA_TERMICO_MICRONES = 10000; // 10mm de margen de seguridad
  const MICRONES_POR_PX = 25400 / 96; // 1 CSS px = 1/96 pulgada = 25400/96 micrones
  const MICRONES_POR_PULGADA = 25400;

  async function calcularPageSizeTermico(ventana) {
    const alturaPx = await ventana.webContents.executeJavaScript('document.body.scrollHeight');
    const alturaMicrones = Math.round(alturaPx * MICRONES_POR_PX) + MARGEN_ALTURA_TERMICO_MICRONES;
    return { width: ANCHO_TERMICO_MICRONES, height: alturaMicrones };
  }

  // webContents.print() y webContents.printToPDF() usan unidades DISTINTAS para pageSize pese a
  // aceptar la misma forma { width, height }: print() espera micrones (mismo pipeline nativo de
  // impresión de Chromium), printToPDF() espera PULGADAS (documentado explícitamente en los docs
  // de Electron). Pasar micrones a printToPDF sin convertir generaba una página de ~2 km de ancho
  // (80000 interpretado como pulgadas), con el recibo real reducido a un punto en la esquina.
  function pageSizeMicronesAPulgadas(pageSizeMicrones) {
    return {
      width: pageSizeMicrones.width / MICRONES_POR_PULGADA,
      height: pageSizeMicrones.height / MICRONES_POR_PULGADA
    };
  }

  envolverHandle('recibos:imprimir', async (event, id, formato) => {
    let ventanaImpresion;
    try {
      const formatoEfectivo = reciboService.resolverFormato(formato);
      const html = reciboService.generarHTML(id, formatoEfectivo);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const opcionesImpresion = { silent: false };
      if (formatoEfectivo === 'termico_80mm') {
        opcionesImpresion.pageSize = await calcularPageSizeTermico(ventanaImpresion);
        opcionesImpresion.margins = { marginType: 'none' };
      }

      return await new Promise((resolve) => {
        ventanaImpresion.webContents.print(opcionesImpresion, (success, errorType) => {
          ventanaImpresion.close();
          // El diálogo nativo de impresión deja a veces el foco de teclado sin volver
          // correctamente a la ventana principal; se restaura explícitamente.
          if (mainWindow) mainWindow.focus();
          if (success) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: errorType || 'No se pudo imprimir el recibo' });
          }
        });
      });
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  envolverHandle('recibos:exportarPDF', async (event, id, formato) => {
    let ventanaImpresion;
    try {
      const recibo = reciboService.getById(id);
      if (!recibo) {
        return { success: false, error: 'Recibo no encontrado' };
      }

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar Recibo como PDF',
        defaultPath: `Recibo_${recibo.numero_recibo}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const formatoEfectivo = reciboService.resolverFormato(formato);
      const html = reciboService.generarHTML(id, formatoEfectivo);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const opcionesPDF = {};
      if (formatoEfectivo === 'termico_80mm') {
        const pageSizeMicrones = await calcularPageSizeTermico(ventanaImpresion);
        opcionesPDF.pageSize = pageSizeMicronesAPulgadas(pageSizeMicrones);
        // printToPDF no tiene marginType (a diferencia de print()): solo acepta top/bottom/left/
        // right en pulgadas, por eso van en 0 explícitos en vez de 'none'.
        opcionesPDF.margins = { top: 0, bottom: 0, left: 0, right: 0 };
      }

      const pdfBuffer = await ventanaImpresion.webContents.printToPDF(opcionesPDF);
      fs.writeFileSync(filePath, pdfBuffer);
      ventanaImpresion.close();
      if (mainWindow) mainWindow.focus();

      return { success: true, filePath };
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  // Gastos
  envolverHandle('gastos:getAll', async (event, params) => {
    try {
      return { success: true, data: gastoService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:getStats', async (event, params) => {
    try {
      return { success: true, data: gastoService.getStats(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:getById', async (event, id) => {
    try {
      const gasto = gastoService.getById(id);
      if (!gasto) {
        return { success: false, error: 'Gasto no encontrado' };
      }
      return { success: true, data: gasto };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:getTiposGasto', async () => {
    try {
      return { success: true, data: gastoService.getTiposGasto() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:create', async (event, gastoData) => {
    try {
      const id = gastoService.create(gastoData, sesionActual.id);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:anular', async (event, id, motivo) => {
    try {
      gastoService.anular(id, motivo, sesionActual.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:corregirMetodoPago', async (event, id, nuevoMetodoPago, motivo) => {
    try {
      gastoService.corregirMetodoPago(id, nuevoMetodoPago, motivo, sesionActual.id);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:actualizarDatos', async (event, payload) => {
    try {
      const { id, concepto, observaciones } = payload;
      gastoService.actualizarDatos(id, { concepto, observaciones });
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Soportes documentales de gastos (facturas, recibos, imágenes), guardados en Google Drive —
  // ver ComprobanteCloudService. El archivo nunca se queda en disco local de forma permanente.
  envolverHandle('gastos:adjuntarSoporte', async (event, gastoId, tipoSoporte) => {
    try {
      if (!comprobanteCloudService.estaConectado()) {
        return { success: false, error: 'No hay una cuenta de Google conectada. Ve a Configuración → Respaldo en la Nube para conectarla.' };
      }

      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Seleccionar soporte',
        filters: [{ name: 'PDF o imagen', extensions: ['pdf', 'png', 'jpg', 'jpeg'] }],
        properties: ['openFile']
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const filePath = filePaths[0];
      const extension = path.extname(filePath).toLowerCase().replace('.', '');
      if (!['pdf', 'png', 'jpg', 'jpeg'].includes(extension)) {
        return { success: false, error: 'El archivo debe ser PDF, PNG o JPG.' };
      }

      const tamanioMb = fs.statSync(filePath).size / (1024 * 1024);
      if (tamanioMb > 15) {
        return { success: false, error: 'El archivo supera el límite de 15 MB.' };
      }

      const nombreArchivo = path.basename(filePath);
      const subida = await comprobanteCloudService.subirSoporte(filePath, nombreArchivo);

      gastoService.adjuntarSoporte(gastoId, { tipoSoporte, driveFileId: subida.id, nombreArchivo: subida.name });
      return { success: true, data: { id: gastoId } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:getSoportes', async (event, gastoId) => {
    try {
      return { success: true, data: gastoService.getSoportes(gastoId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:getSoporte', async (event, gastoId, soporteId) => {
    try {
      const soporte = gastoService.getSoporte(soporteId);
      if (!soporte) return { success: false, error: 'Soporte no encontrado' };

      await comprobanteCloudService.descargarYAbrir(soporte.drive_file_id, soporte.nombre_archivo);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Caja y Bancos
  envolverHandle('caja:getSaldos', async () => {
    try {
      return { success: true, data: cajaService.getSaldos() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('caja:getMovimientos', async (event, params) => {
    try {
      return { success: true, data: cajaService.getMovimientos(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('caja:registrarConsignacion', async (event, payload) => {
    try {
      cajaService.registrarConsignacion(payload, sesionActual.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('caja:registrarRetiro', async (event, payload) => {
    try {
      cajaService.registrarRetiro(payload, sesionActual.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('caja:regularizarSaldos', async (event, payload) => {
    try {
      const resultado = cajaService.regularizarSaldos({ ...payload, usuarioId: sesionActual.id });
      return { success: true, data: resultado };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('caja:getResumenPeriodo', async (event, fechaDesde, fechaHasta) => {
    try {
      return { success: true, data: cajaService.getResumenPeriodo(fechaDesde, fechaHasta) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Caja Menor
  envolverHandle('cajaMenor:getEstado', async () => {
    try {
      return { success: true, data: cajaMenorService.getEstado() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cajaMenor:getHistorialResponsables', async () => {
    try {
      return { success: true, data: cajaMenorService.getHistorialResponsables() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cajaMenor:asignarResponsable', async (event, terceroId, fechaInicio, observaciones) => {
    try {
      cajaMenorService.asignarResponsable(terceroId, fechaInicio, observaciones);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cajaMenor:reembolsar', async (event, payload) => {
    try {
      const id = cajaMenorService.reembolsar({ ...payload, usuarioId: sesionActual.id });
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Autenticación
  envolverHandle('auth:login', async (event, usuario, password) => {
    try {
      return { success: true, data: authService.login(usuario, password) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('auth:cambiarPassword', async (event, usuarioId, passwordActual, passwordNueva) => {
    try {
      authService.cambiarPassword(usuarioId, passwordActual, passwordNueva);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('auth:logout', async () => {
    return { success: true };
  });

  // Gestión de usuarios (solo Administrador, ver CANALES_SOLO_ADMIN)
  envolverHandle('usuarios:getAll', async () => {
    try {
      return { success: true, data: authService.getAll() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('usuarios:crear', async (event, datos) => {
    try {
      return { success: true, data: { id: authService.crearUsuario(datos) } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('usuarios:toggleActivo', async (event, id, activo) => {
    try {
      authService.toggleActivoUsuario(id, activo, sesionActual?.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('usuarios:resetearPassword', async (event, id, passwordNueva) => {
    try {
      authService.resetearPassword(id, passwordNueva);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Auditoría (solo lectura, pero restringida a Administrador en CANALES_SOLO_ADMIN)
  envolverHandle('auditoria:getAll', async (event, params) => {
    try {
      return { success: true, data: auditoriaService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Configuración
  envolverHandle('config:getAll', async () => {
    try {
      return { success: true, data: configuracionService.getAll() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('config:actualizar', async (event, datos) => {
    try {
      configuracionService.actualizar(datos, sesionActual.id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // El logo se guarda en disco LOCAL (no en Drive como los soportes de gastos): debe estar
  // disponible sin internet para poder generar un PDF. Vive en la misma carpeta 'data' que el
  // .db, no en __dirname (no es escribible/persistente en la app empaquetada).
  envolverHandle('config:subirLogo', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Seleccionar logo',
        filters: [{ name: 'Imagen', extensions: ['png', 'jpg', 'jpeg'] }],
        properties: ['openFile']
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const filePath = filePaths[0];
      const extension = path.extname(filePath).toLowerCase().replace('.', '');
      if (!['png', 'jpg', 'jpeg'].includes(extension)) {
        return { success: false, error: 'El logo debe ser PNG o JPG.' };
      }

      const tamanioMb = fs.statSync(filePath).size / (1024 * 1024);
      if (tamanioMb > 0.5) {
        return { success: false, error: 'El logo supera el límite de 500 KB (se incrusta en cada PDF generado). Usa una imagen más liviana.' };
      }

      const dataDir = path.dirname(dbService.getDbPath());
      // Borra cualquier logo previo con otra extensión, para no acumular archivos huérfanos si
      // cambian de formato (ej. tenían logo.png y ahora suben uno .jpg).
      ['png', 'jpg', 'jpeg'].forEach(ext => {
        const previo = path.join(dataDir, `logo.${ext}`);
        if (fs.existsSync(previo)) fs.unlinkSync(previo);
      });

      const nombreArchivo = `logo.${extension}`;
      fs.copyFileSync(filePath, path.join(dataDir, nombreArchivo));
      configuracionService.actualizarLogoPath(nombreArchivo);

      return { success: true, data: { logo_path: nombreArchivo } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('config:quitarLogo', async () => {
    try {
      const dataDir = path.dirname(dbService.getDbPath());
      ['png', 'jpg', 'jpeg'].forEach(ext => {
        const archivo = path.join(dataDir, `logo.${ext}`);
        if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
      });
      configuracionService.actualizarLogoPath('');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // El renderer no puede leer archivos locales directamente (contextIsolation): para mostrar la
  // miniatura del logo en Configuración se pide ya codificado en base64.
  envolverHandle('config:getLogoBase64', async () => {
    try {
      const { logoBase64 } = plantillaReporteService.obtenerConfiguracionInstitucional();
      return { success: true, data: logoBase64 };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Copias de seguridad
  envolverHandle('backup:crear', async () => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Crear copia de seguridad',
        defaultPath: `acueducto_backup_${new Date().toISOString().split('T')[0]}.db`,
        filters: [{ name: 'Base de datos SQLite', extensions: ['db'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      await backupService.crearBackup(filePath);
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('backup:getEstadoAutomatico', async () => {
    try {
      return { success: true, data: backupService.getEstadoAutomatico() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Reemplaza el .db actual por origenPath de forma segura, para los tres caminos de
  // restauración (manual, "actualizar desde la nube", y la actualización silenciosa de
  // Consulta). Dos protecciones, en este orden:
  //  1. Respalda el .db actual en rutaBackupPrevio ANTES de tocar nada -- si el archivo
  //     elegido resulta ser el equivocado, o la restauración se corta a mitad de camino, los
  //     datos de producción actuales quedan recuperables.
  //  2. Copia el archivo nuevo a un temporal junto al destino y recién entonces lo renombra
  //     sobre el .db real, en vez de copiar directo encima: un fallo a mitad de la copia (disco
  //     lleno, antivirus, corte de luz) deja el .db original intacto, nunca uno truncado.
  // rutaBackupPrevio se recibe ya calculada cuando el caller necesita mostrarla en un diálogo
  // de confirmación antes de ejecutar esto; si no se pasa, se calcula aquí mismo.
  async function restaurarBaseDeDatosDesde(origenPath, rutaBackupPrevio) {
    const destinoBackup = rutaBackupPrevio || backupService.rutaBackupPreRestauracion();
    await backupService.crearBackup(destinoBackup);

    const dbPath = dbService.getDbPath();
    dbService.close();

    const rutaTemporal = `${dbPath}.tmp-restore`;
    fs.copyFileSync(origenPath, rutaTemporal);
    fs.renameSync(rutaTemporal, dbPath);

    for (const ext of ['-wal', '-shm']) {
      const residual = dbPath + ext;
      if (fs.existsSync(residual)) fs.unlinkSync(residual);
    }

    return destinoBackup;
  }

  envolverHandle('backup:restaurar', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Restaurar copia de seguridad',
        filters: [{ name: 'Base de datos SQLite', extensions: ['db'] }],
        properties: ['openFile']
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const origenPath = filePaths[0];
      const validacion = backupService.validarArchivoRestauracion(origenPath);
      const rutaBackupPrevio = backupService.rutaBackupPreRestauracion();

      const avisoMigraciones = validacion.migracionesPendientes.length > 0
        ? `\n\nEste archivo corresponde a una versión anterior de la aplicación: al reiniciar se aplicarán ${validacion.migracionesPendientes.length} actualización(es) de base de datos pendientes.`
        : '';

      const confirmacion = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancelar', 'Restaurar y reiniciar'],
        defaultId: 0,
        cancelId: 0,
        title: 'Confirmar restauración',
        message: `Esto reemplazará todos los datos actuales con los del archivo seleccionado (${validacion.totalCuentas} cuentas).\n\nAntes de reemplazarlos, se guardará una copia de seguridad de los datos actuales en:\n${rutaBackupPrevio}${avisoMigraciones}\n\nLa aplicación se reiniciará. ¿Desea continuar?`
      });

      if (confirmacion.response !== 1) {
        return { success: false, canceled: true };
      }

      await restaurarBaseDeDatosDesde(origenPath, rutaBackupPrevio);

      app.relaunch();
      app.exit();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Respaldo en la Nube (Google Drive)
  envolverHandle('cloudBackup:getEstado', async () => {
    try {
      return { success: true, data: cloudBackupService.getEstado() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cloudBackup:getRespaldosDisponibles', async () => {
    try {
      return { success: true, data: await cloudBackupService.getRespaldosDisponibles() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cloudBackup:conectar', async () => {
    try {
      await cloudBackupService.conectar();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cloudBackup:configurarEquipo', async (event, nombreEquipo) => {
    try {
      cloudBackupService.configurarNombreEquipo(nombreEquipo);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cloudBackup:desconectar', async () => {
    try {
      cloudBackupService.desconectar();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cloudBackup:respaldarAhora', async (event, { forzar = false } = {}) => {
    try {
      const resultado = await cloudBackupService.respaldarAhora(backupService, { forzar });
      return { success: true, data: resultado };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Reemplaza la base de datos local por un archivo ya descargado y válido, y reinicia la app
  // (mismo patrón que backup:restaurar, incluida la protección de restaurarBaseDeDatosDesde).
  // Lo comparten el botón manual "Actualizar desde la nube" y la actualización silenciosa
  // automática para Consulta.
  //
  // secuencia es la del respaldo que se está aplicando: hay que guardarla en el estado local
  // ANTES de reiniciar, porque ese estado vive en un archivo aparte del .db (ver comentario en
  // CloudBackupOrchestratorService) y no viaja solo con el archivo que se acaba de copiar. Sin
  // esto, la app seguiría pensando para siempre que hay algo nuevo sin traer, y lo volvería a
  // descargar y aplicar en cada login.
  async function aplicarRespaldoDescargado(rutaLocal, secuencia, rutaBackupPrevio) {
    cloudBackupService.marcarRespaldoTraido(secuencia);

    await restaurarBaseDeDatosDesde(rutaLocal, rutaBackupPrevio);

    app.relaunch();
    app.exit();
  }

  // actualizandoDesdeNube evita que dos clics (o una doble invocación por cualquier motivo)
  // entren a la vez: la primera ya cierra la conexión a la base de datos antes de reiniciar la
  // app, y si una segunda llamada alcanza a correr en ese instante, la encuentra cerrada
  // ("The database connection is not open"). La comparten ambos canales de abajo, ya que los dos
  // terminan en el mismo reemplazo de archivo.
  let actualizandoDesdeNube = false;

  // Descarga el respaldo más reciente de la nube y, tras confirmación del usuario, la reemplaza.
  envolverHandle('cloudBackup:actualizarDesdeNube', async () => {
    if (actualizandoDesdeNube) {
      return { success: false, error: 'Ya hay una actualización desde la nube en curso' };
    }
    actualizandoDesdeNube = true;

    let archivoTemporal;
    try {
      const { archivo, rutaLocal } = await cloudBackupService.descargarUltimoRespaldo();
      archivoTemporal = rutaLocal;
      const validacion = backupService.validarArchivoRestauracion(rutaLocal);
      const rutaBackupPrevio = backupService.rutaBackupPreRestauracion();

      const secuenciaRemota = Number(archivo.properties?.secuencia || 0);
      const secuenciaLocal = cloudBackupService.getEstado().secuenciaLocal;
      const advertenciaConflicto = secuenciaRemota < secuenciaLocal
        ? '\n\nAviso: este respaldo de la nube parece ser MÁS VIEJO que los datos que ya tienes en este equipo. Si continúas, podrías perder información reciente.'
        : '';
      const avisoMigraciones = validacion.migracionesPendientes.length > 0
        ? `\n\nEste respaldo corresponde a una versión anterior de la aplicación: al reiniciar se aplicarán ${validacion.migracionesPendientes.length} actualización(es) de base de datos pendientes.`
        : '';

      const fechaLegible = new Date(archivo.createdTime).toLocaleString('es-CO', {
        dateStyle: 'long', timeStyle: 'short'
      });

      const confirmacion = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancelar', 'Actualizar y reiniciar'],
        defaultId: 0,
        cancelId: 0,
        title: 'Confirmar actualización desde la nube',
        message: `Esto reemplazará todos los datos actuales con el respaldo más reciente de Google Drive (subido desde "${archivo.properties?.nombreEquipo || 'otro equipo'}" el ${fechaLegible}, ${validacion.totalCuentas} cuentas). La aplicación se reiniciará.\n\nAntes de reemplazarlos, se guardará una copia de seguridad de los datos actuales en:\n${rutaBackupPrevio}${advertenciaConflicto}${avisoMigraciones}\n\n¿Desea continuar?`
      });

      if (confirmacion.response !== 1) {
        return { success: false, canceled: true };
      }

      await aplicarRespaldoDescargado(rutaLocal, secuenciaRemota, rutaBackupPrevio);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      actualizandoDesdeNube = false;
      if (archivoTemporal && fs.existsSync(archivoTemporal)) fs.unlinkSync(archivoTemporal);
    }
  });

  // Chequeo de solo lectura, para que el renderer pueda avisar ANTES de traer y aplicar el
  // respaldo (la actualización en sí no da tiempo de leer ningún aviso, porque reinicia la app
  // de inmediato). Mismo criterio que abajo: solo tiene sentido para Consulta.
  envolverHandle('cloudBackup:getActualizacionPendiente', async () => {
    try {
      if (!sesionActual || sesionActual.rol !== 'Consulta' || !cloudBackupService.estaConectado()) {
        return { success: true, data: { hay: false } };
      }
      const estado = cloudBackupService.getEstado();
      const { hayConflicto } = await cloudBackupService.cloud.detectarConflicto(estado.secuenciaLocal);
      return { success: true, data: { hay: !!hayConflicto } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Variante silenciosa: solo aplica si hay algo más nuevo en la nube que este equipo no conoce,
  // y solo se aplica sin pedir confirmación si quien está logueado es Consulta (nunca tiene
  // cambios locales propios que perder; para cualquier otro rol, solo informa que hay algo nuevo
  // pero no reemplaza nada por sí sola). Pensada para dispararse sola al iniciar sesión.
  envolverHandle('cloudBackup:actualizarSiHayNuevo', async () => {
    if (actualizandoDesdeNube) {
      return { success: true, data: { actualizado: false } };
    }

    try {
      if (!cloudBackupService.estaConectado()) {
        return { success: true, data: { actualizado: false } };
      }

      const estado = cloudBackupService.getEstado();
      const { hayConflicto, ultimo } = await cloudBackupService.cloud.detectarConflicto(estado.secuenciaLocal);
      if (!hayConflicto || !sesionActual || sesionActual.rol !== 'Consulta') {
        return { success: true, data: { actualizado: false } };
      }

      actualizandoDesdeNube = true;
      const { rutaLocal } = await cloudBackupService.descargarUltimoRespaldo();
      try {
        backupService.validarArchivoRestauracion(rutaLocal);
        const secuenciaRemota = Number(ultimo.properties?.secuencia || 0);
        await aplicarRespaldoDescargado(rutaLocal, secuenciaRemota);
        return { success: true, data: { actualizado: true } };
      } finally {
        if (fs.existsSync(rutaLocal)) fs.unlinkSync(rutaLocal);
      }
    } catch (error) {
      return { success: false, error: error.message };
    } finally {
      actualizandoDesdeNube = false;
    }
  });

  // Nuevos Puntos
  envolverHandle('nuevospuntos:getAll', async (event, params) => {
    try {
      return { success: true, data: nuevoPuntoService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('nuevospuntos:getById', async (event, id) => {
    try {
      const punto = nuevoPuntoService.getById(id);
      if (!punto) return { success: false, error: 'Punto nuevo no encontrado' };
      return { success: true, data: punto };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('nuevospuntos:getByCuentaId', async (event, cuentaId) => {
    try {
      return { success: true, data: nuevoPuntoService.getByCuentaId(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('nuevospuntos:create', async (event, datos) => {
    try {
      const id = nuevoPuntoService.create(datos);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('nuevospuntos:registrarAbono', async (event, payload) => {
    try {
      return { success: true, data: nuevoPuntoService.registrarAbono(payload, sesionActual.id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('nuevospuntos:cancelar', async (event, id, motivo) => {
    try {
      nuevoPuntoService.cancelar(id, motivo);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Reportes
  // Lectura genérica para mostrar el listado en pantalla antes de exportar (botón "Buscar"),
  // reutilizable por cualquier reporte que en el futuro quiera el mismo patrón de previsualización.
  envolverHandle('reportes:getDatos', async (event, tipoReporte, params) => {
    try {
      return { success: true, data: reporteService.getReporte(tipoReporte, params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('reportes:generarPDF', async (event, tipoReporte, params) => {
    let ventanaImpresion;
    try {
      const reporte = reporteService.getReporte(tipoReporte, params);
      const orientacion = plantillaReporteService.decidirOrientacion(reporte);
      const config = plantillaReporteService.obtenerConfiguracionInstitucional();
      const html = plantillaReporteService.construirHTML(reporte, config, sesionActual.nombreCompleto);

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar Reporte como PDF',
        defaultPath: `${tipoReporte}_${new Date().toISOString().split('T')[0]}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      const pdfBuffer = await ventanaImpresion.webContents.printToPDF({
        landscape: orientacion === 'horizontal',
        displayHeaderFooter: true,
        headerTemplate: plantillaReporteService.construirHeaderTemplate(config),
        footerTemplate: plantillaReporteService.construirFooterTemplate(sesionActual.nombreCompleto),
        // Suficiente para que el header/footer compactos no se corten (el área que reserva
        // Electron por defecto es muy pequeña para contenido propio).
        margins: { top: 0.6, bottom: 0.6, left: 0.4, right: 0.4 }
      });
      fs.writeFileSync(filePath, pdfBuffer);
      ventanaImpresion.close();
      if (mainWindow) mainWindow.focus();

      return { success: true, filePath };
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
      return { success: false, error: error.message };
    }
  });

  // Vista previa: el MISMO HTML que produce el PDF (vía PlantillaReporteService), para que lo que
  // se ve en pantalla sea literalmente el mismo documento. El header/footerTemplate de paginación
  // repetida por página no aplica aquí (es exclusivo de printToPDF, ver PlantillaReporteService).
  envolverHandle('reportes:getVistaPreviaHTML', async (event, tipoReporte, params) => {
    try {
      const reporte = reporteService.getReporte(tipoReporte, params);
      const config = plantillaReporteService.obtenerConfiguracionInstitucional();
      const html = plantillaReporteService.construirHTML(reporte, config, sesionActual.nombreCompleto);
      return { success: true, data: html };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('reportes:generarExcel', async (event, tipoReporte, params) => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Guardar Reporte como Excel',
        defaultPath: `${tipoReporte}_${new Date().toISOString().split('T')[0]}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }]
      });

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const buffer = await excelExportService.generarExcel(tipoReporte, params);
      fs.writeFileSync(filePath, buffer);

      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Herramientas de prueba (solo datos de ejemplo, nunca se ejecutan automáticamente)
  envolverHandle('devtools:tieneDatosOperativos', async () => {
    try {
      return { success: true, data: devToolsService.tieneDatosOperativos() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Utilidades generales de sistema
  envolverHandle('sistema:abrirEnlaceExterno', async (event, url) => {
    try {
      // Solo se permite https: evita que este canal genérico se use para abrir esquemas
      // arbitrarios (file:, javascript:, etc.) si algún día recibe una URL no controlada.
      if (typeof url !== 'string' || !/^https:\/\//.test(url)) {
        throw new Error('Enlace externo inválido');
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

}
