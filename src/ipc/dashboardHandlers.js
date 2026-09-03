function registrarDashboardHandlers({ envolverHandle, dashboardService, cloudBackupService, asientoContableService }) {
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
}

module.exports = { registrarDashboardHandlers };
