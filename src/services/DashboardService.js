const CuentaRepository = require('../repositories/CuentaRepository');
const DashboardRepository = require('../repositories/DashboardRepository');
const CajaRepository = require('../repositories/CajaRepository');
const CategoriaRepository = require('../repositories/CategoriaRepository');

class DashboardService {
  constructor(dbService) {
    this.cuentaRepo = new CuentaRepository(dbService);
    this.dashboardRepo = new DashboardRepository(dbService);
    this.cajaRepo = new CajaRepository(dbService);
    this.categoriaRepo = new CategoriaRepository(dbService);
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
}

module.exports = DashboardService;
