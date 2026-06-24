const GastoRepository = require('../repositories/GastoRepository');
const AsientoContableService = require('./AsientoContableService');

const METODOS_PAGO_VALIDOS = ['Efectivo', 'Transferencia'];

class GastoService {
  constructor(dbService) {
    this.repository = new GastoRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
  }

  getAll(params) {
    return this.repository.findAll(params);
  }

  getById(id) {
    return this.repository.findById(id);
  }

  getTiposGasto() {
    return this.repository.getTiposGasto();
  }

  create(gastoData, usuarioId = null) {
    if (!gastoData.fechaGasto) throw new Error('La fecha del gasto es obligatoria');
    if (!gastoData.concepto || !gastoData.concepto.trim()) throw new Error('El concepto es obligatorio');
    if (!gastoData.tipoGasto || !gastoData.tipoGasto.trim()) throw new Error('El tipo de gasto es obligatorio (define la cuenta contable)');
    if (!this.repository.tipoGastoEsValido(gastoData.tipoGasto)) throw new Error('El tipo de gasto no es válido; selecciónelo de la lista');
    if (!gastoData.valor || gastoData.valor <= 0) throw new Error('El valor debe ser mayor a cero');
    if (!METODOS_PAGO_VALIDOS.includes(gastoData.metodoPago)) throw new Error('Método de pago inválido');

    return this.repository.transaccion(() => {
      const gastoId = this.repository.create(gastoData);

      this.repository.crearMovimiento({
        tipo: 'Egreso',
        origen: gastoData.metodoPago === 'Efectivo' ? 'Caja' : 'Banco',
        monto: gastoData.valor,
        concepto: `Gasto: ${gastoData.concepto}`,
        referenciaId: gastoId,
        referenciaTipo: 'Gasto',
        fechaMovimiento: gastoData.fechaGasto,
        observaciones: gastoData.observaciones
      });

      this.asientoContableService.generarDesdeGasto(gastoId, usuarioId);

      return gastoId;
    });
  }

  // Nunca se elimina un gasto: se anula y se registra un movimiento (y un asiento de reversión)
  // que revierte el efecto en caja/banco, dejando ambos eventos visibles en el historial.
  anular(id, motivoAnulacion, usuarioId = null) {
    const gasto = this.repository.findById(id);
    if (!gasto) throw new Error('Gasto no encontrado');
    if (gasto.estado === 'Anulado') throw new Error('El gasto ya está anulado');
    if (!motivoAnulacion || !motivoAnulacion.trim()) throw new Error('Debe indicar el motivo de la anulación');

    return this.repository.transaccion(() => {
      this.repository.anular(id, motivoAnulacion);

      this.repository.crearMovimiento({
        tipo: 'Ingreso',
        origen: gasto.metodo_pago === 'Efectivo' ? 'Caja' : 'Banco',
        monto: gasto.valor,
        concepto: `Reversión por anulación de gasto: ${gasto.concepto}`,
        referenciaId: id,
        referenciaTipo: 'Gasto',
        fechaMovimiento: new Date().toISOString().split('T')[0],
        observaciones: motivoAnulacion
      });

      this.asientoContableService.revertirPorReferencia('Gasto', id, motivoAnulacion, usuarioId);
    });
  }
}

module.exports = GastoService;
