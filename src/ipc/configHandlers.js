const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { getSesionActual } = require('./sesion');

function registrarConfigHandlers({
  envolverHandle, configuracionService, backupService, dbService,
  plantillaReporteService, getMainWindow, restaurarBaseDeDatosDesde
}) {
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
      configuracionService.actualizar(datos, getSesionActual().id);
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
      const { canceled, filePaths } = await dialog.showOpenDialog(getMainWindow(), {
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
      const { canceled, filePath } = await dialog.showSaveDialog(getMainWindow(), {
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
      const { canceled, filePaths } = await dialog.showOpenDialog(getMainWindow(), {
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

      const confirmacion = await dialog.showMessageBox(getMainWindow(), {
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
}

module.exports = { registrarConfigHandlers };
