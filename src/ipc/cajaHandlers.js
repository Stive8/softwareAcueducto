const { getSesionActual } = require('./sesion');

function registrarCajaHandlers({ envolverHandle, cajaService, cajaMenorService }) {
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
      cajaService.registrarConsignacion(payload, getSesionActual().id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('caja:registrarRetiro', async (event, payload) => {
    try {
      cajaService.registrarRetiro(payload, getSesionActual().id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('caja:regularizarSaldos', async (event, payload) => {
    try {
      const resultado = cajaService.regularizarSaldos({ ...payload, usuarioId: getSesionActual().id });
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
      const id = cajaMenorService.reembolsar({ ...payload, usuarioId: getSesionActual().id });
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registrarCajaHandlers };
