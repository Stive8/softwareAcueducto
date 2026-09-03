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
