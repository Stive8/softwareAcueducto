const { app, dialog } = require('electron');
const fs = require('fs');
const { getSesionActual } = require('./sesion');

function registrarCloudBackupHandlers({
  envolverHandle, cloudBackupService, backupService, getMainWindow, restaurarBaseDeDatosDesde
}) {
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

      const confirmacion = await dialog.showMessageBox(getMainWindow(), {
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
      if (!getSesionActual() || getSesionActual().rol !== 'Consulta' || !cloudBackupService.estaConectado()) {
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
      if (!hayConflicto || !getSesionActual() || getSesionActual().rol !== 'Consulta') {
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
}

module.exports = { registrarCloudBackupHandlers };
