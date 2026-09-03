const { getSesionActual } = require('./sesion');

function registrarAuthHandlers({ envolverHandle, authService, auditoriaService }) {
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
      authService.toggleActivoUsuario(id, activo, getSesionActual()?.id);
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
}

module.exports = { registrarAuthHandlers };
