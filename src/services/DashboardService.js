const CuentaRepository = require('../repositories/CuentaRepository');
const DashboardRepository = require('../repositories/DashboardRepository');
const CajaRepository = require('../repositories/CajaRepository');

class DashboardService {
  constructor(dbService) {
    this.cuentaRepo = new CuentaRepository(dbService);
    this.dashboardRepo = new DashboardRepository(dbService);
    this.cajaRepo = new CajaRepository(dbService);
  }

  getStats() {
    const cuentasStats = this.cuentaRepo.getStats();
    const ingresosMes = this.dashboardRepo.getIngresosMes();
    const gastosMes = this.dashboardRepo.getGastosMes();
    const saldoCaja = this.cajaRepo.getSaldoCaja();
    const saldoBanco = this.cajaRepo.getSaldoBanco();
    const cuentasAlDia = this.dashboardRepo.getCuentasAlDia();
    const cuentasEnMora = this.dashboardRepo.getCuentasEnMora();
    const cuentasConSaldoAFavor = this.dashboardRepo.getCuentasConSaldoAFavor();

    return {
      totalCuentas: cuentasStats.total,
      cuentasActivas: cuentasStats.activas,
      cuentasInactivas: cuentasStats.inactivas,
      cuentasSuspendidas: cuentasStats.suspendidas,
      cuentasAlDia,
      cuentasEnMora,
      cuentasConSaldoAFavor,
      ingresosMes,
      gastosMes,
      saldoCaja,
      saldoBanco
    };
  }

  getChartData() {
    return this.dashboardRepo.getIngresosVsGastosUltimos6Meses();
  }
}

module.exports = DashboardService;
