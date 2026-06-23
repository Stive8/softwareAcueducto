const NuevoPuntoRepository = require('../repositories/NuevoPuntoRepository');
const PropietarioRepository = require('../repositories/PropietarioRepository');
const AsientoContableService = require('./AsientoContableService');

const METODOS_PAGO_VALIDOS = ['Efectivo', 'Transferencia'];

class NuevoPuntoService {
  constructor(dbService) {
    this.repository = new NuevoPuntoRepository(dbService);
    this.propietarioRepository = new PropietarioRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
  }

  getAll(params) {
    return this.repository.findAll(params);
  }

  getById(id) {
    const punto = this.repository.findById(id);
    if (!punto) return null;
    punto.abonos = this.repository.getAbonos(id);
    return punto;
  }

  // Historial de cargos de conexión de una cuenta (normalmente uno solo, pero puede haber
  // varios si uno fue cancelado y se registró otro después), con sus abonos incluidos.
  getByCuentaId(cuentaId) {
    return this.repository.findByCuentaId(cuentaId).map(punto => ({
      ...punto,
      abonos: this.repository.getAbonos(punto.id)
    }));
  }

  create({ cuentaId, valorTotal, fechaRegistro, observaciones }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!valorTotal || valorTotal <= 0) throw new Error('El valor total debe ser mayor a cero');
    if (!fechaRegistro) throw new Error('La fecha de registro es obligatoria');

    return this.repository.create({ cuentaId, valorTotal, fechaRegistro, observaciones });
  }

  // Registra un abono a un punto nuevo: genera recibo (con la numeración consecutiva global)
  // y movimiento de caja/banco, igual que un pago de sostenimiento, según lo describe el negocio
  // ("Recibo 6500 - Detalle: Abono Punto Nuevo - Valor: 100.000").
  registrarAbono({ nuevoPuntoId, monto, fechaAbono, metodoPago, observaciones }, usuarioId = null) {
    if (!nuevoPuntoId) throw new Error('El punto nuevo es obligatorio');
    if (!monto || monto <= 0) throw new Error('El monto del abono debe ser mayor a cero');
    if (!fechaAbono) throw new Error('La fecha del abono es obligatoria');
    if (!METODOS_PAGO_VALIDOS.includes(metodoPago)) throw new Error('Método de pago inválido');

    const punto = this.repository.findById(nuevoPuntoId);
    if (!punto) throw new Error('Punto nuevo no encontrado');
    if (punto.estado !== 'Pendiente') throw new Error(`Este punto nuevo está en estado "${punto.estado}" y no admite más abonos`);
    if (monto > punto.saldo_pendiente) {
      throw new Error(`El abono ($${monto}) no puede ser mayor al saldo pendiente ($${punto.saldo_pendiente})`);
    }

    const propietario = this.propietarioRepository.getPropietarioActualCuenta(punto.cuenta_id);
    if (!propietario) {
      throw new Error('La cuenta no tiene un propietario asignado actualmente; asígnelo antes de registrar el abono');
    }

    return this.repository.transaccion(() => {
      const numeroRecibo = this.repository.getConsecutivoRecibo();

      const reciboId = this.repository.crearRecibo({
        numeroRecibo,
        cuentaId: punto.cuenta_id,
        propietarioId: propietario.id,
        fechaRecibo: fechaAbono,
        total: monto,
        metodoPago,
        observaciones
      });

      this.repository.incrementarConsecutivoRecibo(numeroRecibo + 1);

      const detalleId = this.repository.crearReciboDetalle({
        reciboId,
        concepto: `Abono Punto Nuevo - Cuenta ${punto.cuenta_codigo}`,
        valor: monto
      });

      this.repository.crearAbono({ nuevoPuntoId, monto, fechaAbono, reciboDetalleId: detalleId, observaciones });
      const estadoActualizado = this.repository.actualizarSaldoYEstado(nuevoPuntoId);

      this.repository.crearMovimiento({
        tipo: 'Ingreso',
        origen: metodoPago === 'Efectivo' ? 'Caja' : 'Banco',
        monto,
        concepto: `Recibo No. ${numeroRecibo} - Abono Punto Nuevo`,
        referenciaId: reciboId,
        referenciaTipo: 'Recibo',
        fechaMovimiento: fechaAbono
      });

      this.asientoContableService.generarDesdeRecibo(reciboId, usuarioId);

      return { reciboId, numeroRecibo, ...estadoActualizado };
    });
  }

  cancelar(id, motivo) {
    const punto = this.repository.findById(id);
    if (!punto) throw new Error('Punto nuevo no encontrado');
    if (punto.estado === 'Pagado') throw new Error('No se puede cancelar un punto nuevo ya pagado en su totalidad');
    if (punto.estado === 'Cancelado') throw new Error('Este punto nuevo ya está cancelado');
    if (!motivo || !motivo.trim()) throw new Error('Debe indicar el motivo de la cancelación');

    this.repository.cancelar(id, motivo);
  }
}

module.exports = NuevoPuntoService;
