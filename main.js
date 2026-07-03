const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const DatabaseService = require('./src/database/DatabaseService');
const CuentaService = require('./src/services/CuentaService');
const DashboardService = require('./src/services/DashboardService');
const PropietarioService = require('./src/services/PropietarioService');
const CategoriaService = require('./src/services/CategoriaService');
const PagoService = require('./src/services/PagoService');
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
  'cuentasautomaticas:actualizar',
  'periodos:cerrar', 'periodos:bloquear', 'periodos:reabrir', 'periodos:actualizarNotas',
  'plantillas:actualizarLineas',
  'impuestos:create', 'impuestos:update', 'impuestos:toggleActivo',
  'impuestos:asignarAPlantilla', 'impuestos:quitarDePlantilla',
  'cloudBackup:respaldarAhora',
  'cajaMenor:asignarResponsable', 'cajaMenor:reembolsar'
]);

// Excepciones puntuales a "Consulta no puede escribir": acciones que, aunque cambian estado
// local, su verdadera barrera de seguridad es otra. Conectar/desconectar una cuenta de Google es
// un dato de ESTE equipo (no algo compartido que requiera ser Administrador), y "traer/actualizar
// desde la nube" está deliberadamente abierto a cualquier rol porque el control real de acceso es
// si esa cuenta de Google tiene permiso sobre la carpeta de Drive — algo que se administra desde
// fuera de la app, no con los roles internos. Ver ARQUITECTURA.md, sección de respaldo en la nube.
const CANALES_PERMITIDOS_CONSULTA = new Set([
  'cloudBackup:conectar', 'cloudBackup:desconectar', 'cloudBackup:actualizarDesdeNube',
  'cloudBackup:configurarEquipo', 'cloudBackup:actualizarSiHayNuevo'
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

    const resultado = await fn(event, ...args);

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

app.whenReady().then(() => {
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
  reciboService = new ReciboService(dbService);
  gastoService = new GastoService(dbService);
  cajaService = new CajaService(dbService);
  authService = new AuthService(dbService);
  configuracionService = new ConfiguracionService(dbService);
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
  cajaMenorService = new CajaMenorService(dbService);
  cuentaAutomaticaService = new CuentaAutomaticaService(new CuentaAutomaticaRepository(dbService), new PlanCuentaRepository(dbService));
  periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService));
  plantillaContabilizacionService = new PlantillaContabilizacionService(dbService);
  impuestoService = new ImpuestoService(dbService);
  motorContabilizacionService = new MotorContabilizacionService(dbService);
  cloudBackupService = new CloudBackupOrchestratorService(dbService, baseDirDb);
  comprobanteCloudService = new ComprobanteCloudService(baseDirDb);

  setupIpcHandlers();
  createWindow();

  // No bloquea el arranque: corre en segundo plano y solo actúa si ya pasó el intervalo.
  backupService.ejecutarSiCorresponde();
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

      return {
        success: true,
        data: { ...stats, respaldoNube: { conectado: estadoNube.conectado, diasSinRespaldar } }
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

  envolverHandle('cuentas:changeStatus', async (event, id, estado) => {
    try {
      cuentaService.changeStatus(id, estado);
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

  envolverHandle('categorias:asignarACuenta', async (event, cuentaId, categoriaId, fechaInicio, observaciones) => {
    try {
      categoriaService.asignarACuenta(cuentaId, categoriaId, fechaInicio, observaciones);
      return { success: true };
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

  envolverHandle('pagos:simularPago', async (event, cuentaId, anioInicio, mesInicio, cantidadMeses) => {
    try {
      return { success: true, data: pagoService.simularPago(cuentaId, anioInicio, mesInicio, cantidadMeses) };
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

  envolverHandle('pagos:getHistorialPagos', async (event, cuentaId) => {
    try {
      return { success: true, data: pagoService.getHistorialPagos(cuentaId) };
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

  envolverHandle('recibos:imprimir', async (event, id) => {
    let ventanaImpresion;
    try {
      const html = reciboService.generarHTML(id);
      ventanaImpresion = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
      await ventanaImpresion.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      return await new Promise((resolve) => {
        ventanaImpresion.webContents.print({ silent: false }, (success, errorType) => {
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

  envolverHandle('recibos:exportarPDF', async (event, id) => {
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

      const html = reciboService.generarHTML(id);
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
      configuracionService.actualizar(datos);
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
      backupService.validarArchivoRestauracion(origenPath);

      const confirmacion = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancelar', 'Restaurar y reiniciar'],
        defaultId: 0,
        cancelId: 0,
        title: 'Confirmar restauración',
        message: 'Esto reemplazará todos los datos actuales con los del archivo seleccionado. La aplicación se reiniciará. ¿Desea continuar?'
      });

      if (confirmacion.response !== 1) {
        return { success: false, canceled: true };
      }

      const dbPath = dbService.getDbPath();
      dbService.close();

      fs.copyFileSync(origenPath, dbPath);
      for (const ext of ['-wal', '-shm']) {
        const residual = dbPath + ext;
        if (fs.existsSync(residual)) fs.unlinkSync(residual);
      }

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
  // (mismo patrón que backup:restaurar). Lo comparten el botón manual "Actualizar desde la nube"
  // y la actualización silenciosa automática para Consulta.
  //
  // secuencia es la del respaldo que se está aplicando: hay que guardarla en el estado local
  // ANTES de reiniciar, porque ese estado vive en un archivo aparte del .db (ver comentario en
  // CloudBackupOrchestratorService) y no viaja solo con el archivo que se acaba de copiar. Sin
  // esto, la app seguiría pensando para siempre que hay algo nuevo sin traer, y lo volvería a
  // descargar y aplicar en cada login.
  function aplicarRespaldoDescargado(rutaLocal, secuencia) {
    cloudBackupService.marcarRespaldoTraido(secuencia);

    const dbPath = dbService.getDbPath();
    dbService.close();

    fs.copyFileSync(rutaLocal, dbPath);
    for (const ext of ['-wal', '-shm']) {
      const residual = dbPath + ext;
      if (fs.existsSync(residual)) fs.unlinkSync(residual);
    }

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
      backupService.validarArchivoRestauracion(rutaLocal);

      const secuenciaRemota = Number(archivo.properties?.secuencia || 0);
      const secuenciaLocal = cloudBackupService.getEstado().secuenciaLocal;
      const advertenciaConflicto = secuenciaRemota < secuenciaLocal
        ? '\n\nAviso: este respaldo de la nube parece ser MÁS VIEJO que los datos que ya tienes en este equipo. Si continúas, podrías perder información reciente.'
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
        message: `Esto reemplazará todos los datos actuales con el respaldo más reciente de Google Drive (subido desde "${archivo.properties?.nombreEquipo || 'otro equipo'}" el ${fechaLegible}). La aplicación se reiniciará.${advertenciaConflicto}\n\n¿Desea continuar?`
      });

      if (confirmacion.response !== 1) {
        return { success: false, canceled: true };
      }

      aplicarRespaldoDescargado(rutaLocal, secuenciaRemota);
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
        aplicarRespaldoDescargado(rutaLocal, secuenciaRemota);
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

}
