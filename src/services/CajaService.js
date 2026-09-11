const CajaRepository = require('../repositories/CajaRepository');
const AsientoContableService = require('./AsientoContableService');
const CuentaAutomaticaRepository = require('../repositories/CuentaAutomaticaRepository');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');

class CajaService {
  constructor(dbService) {
    this.repository = new CajaRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
    this.cuentaAutomaticaRepository = new CuentaAutomaticaRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
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

  getResumenPeriodo(fechaDesde, fechaHasta, cuenta) {
    return this.repository.getResumenPeriodo(fechaDesde, fechaHasta, cuenta);
  }

  // Consignación: el dinero recaudado en efectivo se deposita en el banco.
  // Disminuye caja, aumenta banco (un único movimiento de tipo Traslado).
  registrarConsignacion({ monto, fecha, observaciones }, usuarioId = null) {
    if (!monto || monto <= 0) throw new Error('El monto a consignar debe ser mayor a cero');
    if (!fecha) throw new Error('La fecha es obligatoria');

    const saldoCaja = this.repository.getSaldoCaja();
    if (monto > saldoCaja) {
      throw new Error(`El monto a consignar ($${monto}) supera el saldo disponible en caja ($${saldoCaja})`);
    }

    return this.repository.transaccion(() => {
      const movimientoId = this.repository.crearMovimiento({
        tipo: 'Traslado',
        origen: 'Caja',
        destino: 'Banco',
        monto,
        concepto: 'Consignación de caja a banco',
        referenciaTipo: 'Consignacion',
        fechaMovimiento: fecha,
        observaciones
      });

      this.asientoContableService.generarDesdeMovimientoTraslado(movimientoId, usuarioId);

      return movimientoId;
    });
  }

  // Retiro: se saca efectivo del banco para tener caja disponible.
  // Aumenta caja, disminuye banco (un único movimiento de tipo Traslado). Espejo de
  // registrarConsignacion con la dirección invertida — reutiliza el mismo motor de
  // plantillas (TRASLADO_CAJA_BANCO ya resuelve la cuenta dinámicamente desde
  // origen/destino, no hace falta ningún cambio ahí).
  registrarRetiro({ monto, fecha, observaciones }, usuarioId = null) {
    if (!monto || monto <= 0) throw new Error('El monto a retirar debe ser mayor a cero');
    if (!fecha) throw new Error('La fecha es obligatoria');

    const saldoBanco = this.repository.getSaldoBanco();
    if (monto > saldoBanco) {
      throw new Error(`El monto a retirar ($${monto}) supera el saldo disponible en banco ($${saldoBanco})`);
    }

    return this.repository.transaccion(() => {
      const movimientoId = this.repository.crearMovimiento({
        tipo: 'Traslado',
        origen: 'Banco',
        destino: 'Caja',
        monto,
        concepto: 'Retiro de banco a caja',
        referenciaTipo: 'Retiro',
        fechaMovimiento: fecha,
        observaciones
      });

      this.asientoContableService.generarDesdeMovimientoTraslado(movimientoId, usuarioId);

      return movimientoId;
    });
  }

  // Ajusta el saldo de Caja y/o Banco al valor real (arqueo físico / extracto bancario),
  // registrando la diferencia como un asiento de "Regularización de Saldos" contra Patrimonio
  // (3105). Reutiliza AsientoContableService.crearManual con sincronizarLedgerSimple (su valor
  // por defecto), que sincroniza a la vez la doble partida y el libro simple `movimientos` que
  // alimenta el Dashboard. Reutilizable: cada llamada lleva del saldo calculado actual al nuevo
  // saldo real indicado, sin acumular con ajustes anteriores.
  regularizarSaldos({ fecha, saldoRealCaja, saldoRealBanco, motivo, usuarioId = null }) {
    if (!fecha) throw new Error('La fecha del ajuste es obligatoria');
    if (typeof saldoRealCaja !== 'number' || Number.isNaN(saldoRealCaja) || saldoRealCaja < 0) {
      throw new Error('El saldo real de Caja debe ser un número mayor o igual a cero');
    }
    if (typeof saldoRealBanco !== 'number' || Number.isNaN(saldoRealBanco) || saldoRealBanco < 0) {
      throw new Error('El saldo real de Banco debe ser un número mayor o igual a cero');
    }
    if (!motivo || !motivo.trim()) throw new Error('Debe indicar el motivo del ajuste');

    const diferenciaCaja = saldoRealCaja - this.repository.getSaldoCaja();
    const diferenciaBanco = saldoRealBanco - this.repository.getSaldoBanco();

    if (diferenciaCaja === 0 && diferenciaBanco === 0) {
      throw new Error('No hay ninguna diferencia que ajustar: los saldos ya coinciden con los valores ingresados');
    }

    return this.repository.transaccion(() => {
      const ajusteCaja = diferenciaCaja !== 0
        ? this._crearAsientoAjuste('CAJA', 'Caja', diferenciaCaja, fecha, motivo, usuarioId)
        : null;
      const ajusteBanco = diferenciaBanco !== 0
        ? this._crearAsientoAjuste('BANCO', 'Banco', diferenciaBanco, fecha, motivo, usuarioId)
        : null;

      return {
        ajusteCaja,
        ajusteBanco,
        saldoFinalCaja: this.repository.getSaldoCaja(),
        saldoFinalBanco: this.repository.getSaldoBanco()
      };
    });
  }

  // Un asiento por cuenta: si la diferencia es negativa (saldo real menor al calculado, el caso
  // típico de egresos históricos no registrados), se acredita Caja/Banco y se debita Patrimonio.
  // Si es positiva, al revés.
  _crearAsientoAjuste(claveCuentaAutomatica, nombreCuenta, diferencia, fecha, motivo, usuarioId) {
    const cuentaId = this.cuentaAutomaticaRepository.getCuentaIdByClave(claveCuentaAutomatica);
    if (!cuentaId) throw new Error(`No hay una cuenta automática configurada para ${nombreCuenta}`);

    const patrimonio = this.planCuentaRepository.findByCodigo('3105');
    if (!patrimonio) throw new Error('No se encontró la cuenta de Patrimonio (3105) para registrar el ajuste');

    const monto = Math.abs(diferencia);
    const lineas = diferencia > 0
      ? [
          { cuentaContableId: cuentaId, debito: monto, credito: 0 },
          { cuentaContableId: patrimonio.id, debito: 0, credito: monto }
        ]
      : [
          { cuentaContableId: patrimonio.id, debito: monto, credito: 0 },
          { cuentaContableId: cuentaId, debito: 0, credito: monto }
        ];

    return this.asientoContableService.crearManual({
      fecha,
      concepto: `Regularización de saldo de ${nombreCuenta} al ${fecha}: ${motivo}`,
      tipoComprobante: 'Regularización de Saldos',
      usuarioId,
      lineas
    });
  }
}

module.exports = CajaService;
