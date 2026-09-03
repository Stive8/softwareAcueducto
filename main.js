const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const { crearEnvolverHandle } = require('./src/ipc/envolverHandle');
const { getSesionActual, setSesionActual, limpiarSesionActual } = require('./src/ipc/sesion');
const { registrarDashboardHandlers } = require('./src/ipc/dashboardHandlers');
const { registrarCuentasHandlers } = require('./src/ipc/cuentasHandlers');
const { registrarContabilidadConfigHandlers } = require('./src/ipc/contabilidadConfigHandlers');
const { registrarAsientosHandlers } = require('./src/ipc/asientosHandlers');
const { registrarPagosHandlers } = require('./src/ipc/pagosHandlers');
const { registrarCarteraHandlers } = require('./src/ipc/carteraHandlers');
const { registrarRecibosHandlers } = require('./src/ipc/recibosHandlers');
const { registrarGastosHandlers } = require('./src/ipc/gastosHandlers');
const { registrarCajaHandlers } = require('./src/ipc/cajaHandlers');
const { registrarAuthHandlers } = require('./src/ipc/authHandlers');
const { registrarConfigHandlers } = require('./src/ipc/configHandlers');
const { registrarCloudBackupHandlers } = require('./src/ipc/cloudBackupHandlers');

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
  const sesionActual = getSesionActual(); // TEMPORAL: se retira en la Task final cuando cada handler pase a leer getSesionActual() directamente
  const envolverHandle = crearEnvolverHandle({ auditoriaService });

  // Register dashboard handlers
  registrarDashboardHandlers({ envolverHandle, dashboardService, cloudBackupService, asientoContableService });
  registrarCuentasHandlers({ envolverHandle, cuentaService, propietarioService, categoriaService, terceroService });
  registrarContabilidadConfigHandlers({
    envolverHandle, planCuentaService, mapeoContableService, cuentaAutomaticaService,
    periodoContableService, reporteService, plantillaContabilizacionService,
    impuestoService, motorContabilizacionService
  });
  registrarAsientosHandlers({ envolverHandle, asientoContableService, getMainWindow: () => mainWindow });
  registrarPagosHandlers({ envolverHandle, pagoService, cuentaService, getMainWindow: () => mainWindow });
  registrarCarteraHandlers({ envolverHandle, carteraService });
  registrarRecibosHandlers({ envolverHandle, reciboService, getMainWindow: () => mainWindow });
  registrarGastosHandlers({ envolverHandle, gastoService, comprobanteCloudService, getMainWindow: () => mainWindow });
  registrarCajaHandlers({ envolverHandle, cajaService, cajaMenorService });

  registrarAuthHandlers({ envolverHandle, authService, auditoriaService });

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
  //
  // Vive en main.js (en vez de src/ipc/configHandlers.js, aunque backup:restaurar es quien más
  // la usa) porque también la comparte aplicarRespaldoDescargado(), definida en
  // src/ipc/cloudBackupHandlers.js, que la recibe inyectada como dependencia.
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

  registrarConfigHandlers({
    envolverHandle, configuracionService, backupService, dbService,
    plantillaReporteService, getMainWindow: () => mainWindow, restaurarBaseDeDatosDesde
  });

  registrarCloudBackupHandlers({
    envolverHandle, cloudBackupService, backupService,
    getMainWindow: () => mainWindow, restaurarBaseDeDatosDesde
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
