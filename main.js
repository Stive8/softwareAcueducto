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
const DevToolsService = require('./src/services/DevToolsService');
const AuditoriaService = require('./src/services/AuditoriaService');
const PlanCuentaService = require('./src/services/PlanCuentaService');
const MapeoContableService = require('./src/services/MapeoContableService');

let mainWindow;
let dbService;
let cuentaService;
let dashboardService;
let propietarioService;
let categoriaService;
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
let devToolsService;
let auditoriaService;
let planCuentaService;
let mapeoContableService;

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
  'config:actualizar', 'backup:restaurar',
  'devtools:cargarDatosEjemplo', 'devtools:eliminarDatosOperativos',
  'auditoria:getAll',
  'plancuentas:create', 'plancuentas:update', 'plancuentas:toggleActivo',
  'mapeocontable:actualizar'
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
    if (!esLectura && sesionActual.rol === 'Consulta') {
      return { success: false, error: 'Su rol de Consulta solo permite ver información, no modificarla' };
    }

    const resultado = await fn(event, ...args);

    if (!esLectura && resultado && resultado.success) {
      const [modulo, metodo] = canal.split(':');
      const registroId = resultado.data?.id ?? resultado.data?.reciboId ?? (typeof args[0] === 'number' ? args[0] : null);
      let datosNuevos = null;
      try { datosNuevos = JSON.stringify(args[0] ?? null); } catch { /* no serializable, se omite */ }
      auditoriaService.registrar({ usuarioId: sesionActual.id, accion: metodo, tabla: modulo, registroId, datosNuevos });
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
  devToolsService = new DevToolsService(dbService);
  auditoriaService = new AuditoriaService(dbService);
  planCuentaService = new PlanCuentaService(dbService);
  mapeoContableService = new MapeoContableService(dbService);

  setupIpcHandlers();
  createWindow();

  // No bloquea el arranque: corre en segundo plano y solo actúa si ya pasó el intervalo.
  backupService.ejecutarSiCorresponde();
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
      return { success: true, data: dashboardService.getStats() };
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
      return { success: true, data: pagoService.registrarPagoSostenimiento(payload) };
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
      reciboService.anular(id, motivo);
      return { success: true };
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
      const id = gastoService.create(gastoData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('gastos:anular', async (event, id, motivo) => {
    try {
      gastoService.anular(id, motivo);
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
      cajaService.registrarConsignacion(payload);
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
      return { success: true, data: nuevoPuntoService.registrarAbono(payload) };
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
  envolverHandle('reportes:generarPDF', async (event, tipoReporte, params) => {
    let ventanaImpresion;
    try {
      const html = reporteService.generarHTML(tipoReporte, params);

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

      const pdfBuffer = await ventanaImpresion.webContents.printToPDF({ landscape: true });
      fs.writeFileSync(filePath, pdfBuffer);
      ventanaImpresion.close();
      if (mainWindow) mainWindow.focus();

      return { success: true, filePath };
    } catch (error) {
      if (ventanaImpresion) ventanaImpresion.close();
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

  envolverHandle('devtools:cargarDatosEjemplo', async () => {
    try {
      return { success: true, data: devToolsService.cargarDatosEjemplo() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('devtools:eliminarDatosOperativos', async () => {
    try {
      devToolsService.eliminarDatosOperativos();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}
