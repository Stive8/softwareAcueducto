const CajaRepository = require('../repositories/CajaRepository');

class CajaService {
  constructor(dbService) {
    this.repository = new CajaRepository(dbService);
  }

  getSaldos() {
    return {
      saldoCaja: this.repository.getSaldoCaja(),
      saldoBanco: this.repository.getSaldoBanco()
    };
  }

  getMovimientos(params) {
    return this.repository.findAllMovimientos(params);
  }

  getResumenPeriodo(fechaDesde, fechaHasta) {
    return this.repository.getResumenPeriodo(fechaDesde, fechaHasta);
  }

  // Consignación: el dinero recaudado en efectivo se deposita en el banco.
  // Disminuye caja, aumenta banco (un único movimiento de tipo Traslado).
  registrarConsignacion({ monto, fecha, observaciones }) {
    if (!monto || monto <= 0) throw new Error('El monto a consignar debe ser mayor a cero');
    if (!fecha) throw new Error('La fecha es obligatoria');

    const saldoCaja = this.repository.getSaldoCaja();
    if (monto > saldoCaja) {
      throw new Error(`El monto a consignar ($${monto}) supera el saldo disponible en caja ($${saldoCaja})`);
    }

    return this.repository.crearMovimiento({
      tipo: 'Traslado',
      origen: 'Caja',
      destino: 'Banco',
      monto,
      concepto: 'Consignación de caja a banco',
      referenciaTipo: 'Consignacion',
      fechaMovimiento: fecha,
      observaciones
    });
  }
}

module.exports = CajaService;
