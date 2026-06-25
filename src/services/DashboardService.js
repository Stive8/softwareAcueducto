const CuentaRepository = require('../repositories/CuentaRepository');
const DashboardRepository = require('../repositories/DashboardRepository');
const CajaRepository = require('../repositories/CajaRepository');
const CategoriaRepository = require('../repositories/CategoriaRepository');
const PagoService = require('./PagoService');

class DashboardService {
  constructor(dbService) {
    this.cuentaRepo = new CuentaRepository(dbService);
    this.dashboardRepo = new DashboardRepository(dbService);
    this.cajaRepo = new CajaRepository(dbService);
    this.categoriaRepo = new CategoriaRepository(dbService);
    // Reutiliza el mismo cálculo de deuda estimada por cuenta que ya usa la pantalla de Pagos
    // (mismo criterio: meses en mora x tarifa vigente de la categoría), en vez de duplicar la
    // fórmula aquí para la cartera pendiente agregada del dashboard.
    this.pagoService = new PagoService(dbService);
  }

  getStats() {
    const cuentasStats = this.cuentaRepo.getStats();
    const ingresosMes = this.dashboardRepo.getIngresosMes();
    const gastosMes = this.dashboardRepo.getGastosMes();
    const saldoCaja = this.cajaRepo.getSaldoCaja();
    const saldoBanco = this.cajaRepo.getSaldoBanco();
    const cuentasAlDia = this.dashboardRepo.getCuentasAlDia();
    const cuentasEnMoraIds = this.dashboardRepo.getCuentasEnMoraIds();
    const cuentasEnMora = cuentasEnMoraIds.length;
    const cuentasConSaldoAFavor = this.dashboardRepo.getCuentasConSaldoAFavor();

    const carteraPendiente = cuentasEnMoraIds.reduce((total, cuentaId) => {
      const estado = this.pagoService.getEstadoCuenta(cuentaId);
      return total + (estado.saldoPendienteEstimado || 0);
    }, 0);

    // Categorías activas sin ninguna tarifa vigente configurada: si alguien intenta registrar
    // un pago de sostenimiento para una cuenta de esa categoría, fallará. Mejor avisar antes.
    const categoriasSinTarifa = this.categoriaRepo.findAll({ soloActivas: true })
      .filter(c => !c.tarifa_actual)
      .map(c => ({ id: c.id, nombre: c.nombre }));

    return {
      totalCuentas: cuentasStats.total,
      cuentasActivas: cuentasStats.activas,
      cuentasInactivas: cuentasStats.inactivas,
      cuentasSuspendidas: cuentasStats.suspendidas,
      cuentasAlDia,
      cuentasEnMora,
      cuentasConSaldoAFavor,
      carteraPendiente,
      ingresosMes,
      gastosMes,
      saldoCaja,
      saldoBanco,
      categoriasSinTarifa
    };
  }

  getChartData() {
    return this.dashboardRepo.getIngresosVsGastosUltimos6Meses();
  }

  getActividadReciente() {
    return {
      ultimosPagos: this.dashboardRepo.getUltimosPagos(5),
      ultimosGastos: this.dashboardRepo.getUltimosGastos(5),
      ultimosMovimientosCaja: this.dashboardRepo.getUltimosMovimientosCaja(5)
    };
  }
}

module.exports = DashboardService;
