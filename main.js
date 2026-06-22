const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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

function createWindow() {
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
  dbService = new DatabaseService(app.getPath('userData'));
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

  setupIpcHandlers();
  createWindow();
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
  ipcMain.handle('dashboard:getStats', async () => {
    try {
      return { success: true, data: dashboardService.getStats() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('dashboard:getChartData', async () => {
    try {
      return { success: true, data: dashboardService.getChartData() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cuentas
  ipcMain.handle('cuentas:getAll', async (event, params) => {
    try {
      return { success: true, data: cuentaService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('cuentas:getById', async (event, id) => {
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

  ipcMain.handle('cuentas:getCategorias', async () => {
    try {
      return { success: true, data: cuentaService.getCategorias() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('cuentas:create', async (event, cuentaData) => {
    try {
      const id = cuentaService.create(cuentaData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('cuentas:update', async (event, id, cuentaData) => {
    try {
      cuentaService.update(id, cuentaData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('cuentas:changeStatus', async (event, id, estado) => {
    try {
      cuentaService.changeStatus(id, estado);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Propietarios
  ipcMain.handle('propietarios:getAll', async (event, params) => {
    try {
      return { success: true, data: propietarioService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('propietarios:getById', async (event, id) => {
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

  ipcMain.handle('propietarios:create', async (event, propietarioData) => {
    try {
      const id = propietarioService.create(propietarioData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('propietarios:update', async (event, id, propietarioData) => {
    try {
      propietarioService.update(id, propietarioData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('propietarios:getCuentasActuales', async (event, propietarioId) => {
    try {
      return { success: true, data: propietarioService.getCuentasActuales(propietarioId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('propietarios:getHistorialCuentas', async (event, propietarioId) => {
    try {
      return { success: true, data: propietarioService.getHistorialCuentas(propietarioId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('propietarios:asignarACuenta', async (event, cuentaId, propietarioId, fechaInicio, observaciones) => {
    try {
      propietarioService.asignarACuenta(cuentaId, propietarioId, fechaInicio, observaciones);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('propietarios:getHistorialPropietariosCuenta', async (event, cuentaId) => {
    try {
      return { success: true, data: propietarioService.getHistorialPropietariosCuenta(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Categorías
  ipcMain.handle('categorias:getAll', async (event, params) => {
    try {
      return { success: true, data: categoriaService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categorias:getById', async (event, id) => {
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

  ipcMain.handle('categorias:create', async (event, categoriaData) => {
    try {
      const id = categoriaService.create(categoriaData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categorias:update', async (event, id, categoriaData) => {
    try {
      categoriaService.update(id, categoriaData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categorias:toggleActivo', async (event, id) => {
    try {
      categoriaService.toggleActivo(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categorias:getTarifaVigente', async (event, categoriaId, fecha) => {
    try {
      return { success: true, data: categoriaService.getTarifaVigente(categoriaId, fecha) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categorias:getHistorialTarifas', async (event, categoriaId) => {
    try {
      return { success: true, data: categoriaService.getHistorialTarifas(categoriaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categorias:crearTarifa', async (event, categoriaId, tarifa, fechaDesde, observaciones) => {
    try {
      categoriaService.crearTarifa(categoriaId, tarifa, fechaDesde, observaciones);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categorias:getCuentasConCategoria', async (event, categoriaId) => {
    try {
      return { success: true, data: categoriaService.getCuentasConCategoria(categoriaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categorias:asignarACuenta', async (event, cuentaId, categoriaId, fechaInicio, observaciones) => {
    try {
      categoriaService.asignarACuenta(cuentaId, categoriaId, fechaInicio, observaciones);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('categorias:getHistorialCategoriasCuenta', async (event, cuentaId) => {
    try {
      return { success: true, data: categoriaService.getHistorialCategoriasCuenta(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Pagos
  ipcMain.handle('pagos:getCuentasConEstado', async (event, params) => {
    try {
      return { success: true, data: pagoService.getCuentasConEstado(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pagos:getEstadoCuenta', async (event, cuentaId) => {
    try {
      return { success: true, data: pagoService.getEstadoCuenta(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pagos:simularPago', async (event, cuentaId, anioInicio, mesInicio, cantidadMeses) => {
    try {
      return { success: true, data: pagoService.simularPago(cuentaId, anioInicio, mesInicio, cantidadMeses) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pagos:registrarPagoSostenimiento', async (event, payload) => {
    try {
      return { success: true, data: pagoService.registrarPagoSostenimiento(payload) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pagos:registrarAbono', async (event, payload) => {
    try {
      return { success: true, data: pagoService.registrarAbono(payload) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pagos:getHistorialPagos', async (event, cuentaId) => {
    try {
      return { success: true, data: pagoService.getHistorialPagos(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Recibos
  ipcMain.handle('recibos:getAll', async (event, params) => {
    try {
      return { success: true, data: reciboService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('recibos:getById', async (event, id) => {
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

  ipcMain.handle('recibos:imprimir', async (event, id) => {
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

  ipcMain.handle('recibos:exportarPDF', async (event, id) => {
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
  ipcMain.handle('gastos:getAll', async (event, params) => {
    try {
      return { success: true, data: gastoService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('gastos:getById', async (event, id) => {
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

  ipcMain.handle('gastos:getTiposGasto', async () => {
    try {
      return { success: true, data: gastoService.getTiposGasto() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('gastos:create', async (event, gastoData) => {
    try {
      const id = gastoService.create(gastoData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('gastos:anular', async (event, id, motivo) => {
    try {
      gastoService.anular(id, motivo);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Caja y Bancos
  ipcMain.handle('caja:getSaldos', async () => {
    try {
      return { success: true, data: cajaService.getSaldos() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('caja:getMovimientos', async (event, params) => {
    try {
      return { success: true, data: cajaService.getMovimientos(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('caja:registrarConsignacion', async (event, payload) => {
    try {
      cajaService.registrarConsignacion(payload);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('caja:getResumenPeriodo', async (event, fechaDesde, fechaHasta) => {
    try {
      return { success: true, data: cajaService.getResumenPeriodo(fechaDesde, fechaHasta) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Autenticación
  ipcMain.handle('auth:login', async (event, usuario, password) => {
    try {
      return { success: true, data: authService.login(usuario, password) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('auth:cambiarPassword', async (event, usuarioId, passwordActual, passwordNueva) => {
    try {
      authService.cambiarPassword(usuarioId, passwordActual, passwordNueva);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Configuración
  ipcMain.handle('config:getAll', async () => {
    try {
      return { success: true, data: configuracionService.getAll() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('config:actualizar', async (event, datos) => {
    try {
      configuracionService.actualizar(datos);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Copias de seguridad
  ipcMain.handle('backup:crear', async () => {
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

  ipcMain.handle('backup:restaurar', async () => {
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
  ipcMain.handle('nuevospuntos:getAll', async (event, params) => {
    try {
      return { success: true, data: nuevoPuntoService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nuevospuntos:getById', async (event, id) => {
    try {
      const punto = nuevoPuntoService.getById(id);
      if (!punto) return { success: false, error: 'Punto nuevo no encontrado' };
      return { success: true, data: punto };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nuevospuntos:create', async (event, datos) => {
    try {
      const id = nuevoPuntoService.create(datos);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nuevospuntos:registrarAbono', async (event, payload) => {
    try {
      return { success: true, data: nuevoPuntoService.registrarAbono(payload) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('nuevospuntos:cancelar', async (event, id, motivo) => {
    try {
      nuevoPuntoService.cancelar(id, motivo);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Reportes
  ipcMain.handle('reportes:generarPDF', async (event, tipoReporte, params) => {
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

  ipcMain.handle('reportes:generarExcel', async (event, tipoReporte, params) => {
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
}
