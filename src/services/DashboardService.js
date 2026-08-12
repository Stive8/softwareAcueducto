const CuentaRepository = require('../repositories/CuentaRepository');
const DashboardRepository = require('../repositories/DashboardRepository');
const CajaRepository = require('../repositories/CajaRepository');
const CategoriaRepository = require('../repositories/CategoriaRepository');
const CarteraService = require('./CarteraService');
const { redondear } = require('./cartera/dinero');

class DashboardService {
  constructor(dbService) {
    this.cuentaRepo = new CuentaRepository(dbService);
    this.dashboardRepo = new DashboardRepository(dbService);
    this.cajaRepo = new CajaRepository(dbService);
    this.categoriaRepo = new CategoriaRepository(dbService);
    // Cartera pendiente se calcula directo desde CarteraService (deudaAntes2024 + deudaExigible
    // + deudaPuntoConexion), no reutilizando PagoService.getEstadoCuenta: ese método calcula
    // mesesMora/saldoPendienteEstimado desde alDiaHasta (para "próximo período sugerido"), que
    // ignora huecos viejos a propósito -- el concepto equivocado para "cuánto debe en total"
    // (ver docs/superpowers/specs/2026-08-10-fase2-reportes-dashboard-design.md).
    this.carteraService = new CarteraService(dbService);
  }

  getStats() {
    const cuentasStats = this.cuentaRepo.getStats();
    const ingresosMes = this.dashboardRepo.getIngresosMes();
    const gastosMes = this.dashboardRepo.getGastosMes();
    const saldoCaja = this.cajaRepo.getSaldoCaja();
    const saldoBanco = this.cajaRepo.getSaldoBanco();
    const cuentasConSaldoAFavor = this.dashboardRepo.getCuentasConSaldoAFavor();

    // idsActivas + getIndicadoresMoraTodas se calculan UNA sola vez y se reutilizan para
    // cuentasAlDia/cuentasEnMora/carteraPendiente -- antes cada uno llamaba a
    // getIndicadoresMoraTodas por su cuenta (vía getCuentasAlDia() y getCuentasEnMoraIds(), que
    // internamente lo vuelven a pedir), repitiendo la misma pasada de todas las cuentas activas
    // tres veces completas en una sola carga del dashboard (auditoría de entrega 2026-08-11:
    // 2.302 ms / 6.265 consultas SQL con 287 cuentas, bajó a ~800 ms / ~2.100 consultas con este
    // cambio -- mismo criterio DashboardRepository.esEnMora, mismos números mostrados).
    const idsActivas = this.dashboardRepo.getIdsActivas();
    const indicadoresMora = this.carteraService.getIndicadoresMoraTodas(idsActivas);
    const cuentasEnMoraIds = indicadoresMora.filter(DashboardRepository.esEnMora).map(ind => ind.cuentaId);
    const cuentasEnMora = cuentasEnMoraIds.length;
    const cuentasAlDia = idsActivas.length - cuentasEnMoraIds.length;

    // Sobre TODAS las cuentas activas, no solo las "en mora": una cuenta puede estar al día en
    // deuda pero tener un punto de conexión pendiente, y ese sí debe sumar acá (mismo criterio
    // que "cuentas por cobrar" del Balance General).
    const carteraPendiente = redondear(
      indicadoresMora.reduce((total, ind) => {
        const exigiblePositiva = ind.deudaExigible > 0 ? ind.deudaExigible : 0;
        return total + ind.deudaAntes2024 + exigiblePositiva + ind.deudaPuntoConexion;
      }, 0)
    );

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
