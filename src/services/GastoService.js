const GastoRepository = require('../repositories/GastoRepository');
const AsientoContableService = require('./AsientoContableService');
const DashboardRepository = require('../repositories/DashboardRepository');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

const METODOS_PAGO_VALIDOS = ['Efectivo', 'Transferencia'];
const TIPOS_OPERACION_VALIDOS = ['Compra directa', 'Reembolso'];
const TIPOS_SOPORTE_VALIDOS = ['Factura electrónica', 'Factura física', 'Recibo simple', 'Comprobante interno', 'Imagen', 'PDF'];

class GastoService {
  constructor(dbService) {
    this.repository = new GastoRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
    this.dashboardRepo = new DashboardRepository(dbService);
    this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService), dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
    this.configuracionRepository = new ConfiguracionRepository(dbService);
  }

  getAll(params) {
    return this.repository.findAll(params);
  }

  getById(id) {
    return this.repository.findById(id);
  }

  // Métricas rápidas para la fila de stat-cards del listado de Gastos: total del mes actual
  // (mismo criterio que el Dashboard) y total/cantidad del filtro activo en la pantalla.
  getStats(filtros = {}) {
    const totalMes = this.dashboardRepo.getGastosMes();
    const filtrado = this.repository.getTotalFiltrado(filtros);
    return { totalMes, totalFiltrado: filtrado.total, cantidadFiltrado: filtrado.cantidad };
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
    if (!gastoData.terceroId) throw new Error('Debe seleccionar un tercero');

    gastoData.tipoOperacion = gastoData.tipoOperacion || 'Compra directa';
    if (!TIPOS_OPERACION_VALIDOS.includes(gastoData.tipoOperacion)) throw new Error('Tipo de operación inválido');

    gastoData.cajaEfectivoId = gastoData.metodoPago === 'Efectivo'
      ? this._resolverCajaEfectivoId(gastoData.valor, gastoData.cajaEfectivo)
      : null;

    // Valida que el período contable de la fecha del gasto esté Abierto.
    // Si no existe aún, se crea automáticamente como Abierto (primer movimiento del mes).
    this.periodoContableService.validarFechaPermitida(gastoData.fechaGasto);

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

  // Resuelve de cuál subcuenta de efectivo sale/entra un gasto ('Menor' solo se respeta si Caja
  // Menor está activa; en cualquier otro caso se usa Caja General), y valida que no deje la caja
  // física en negativo. Compartido por create() y corregirMetodoPago() (antes duplicado solo en
  // create(), lo que dejó a corregirMetodoPago() sin esta validación -- hallazgo Alto A4 de la
  // auditoría de Contabilidad, 2026-09-11).
  _resolverCajaEfectivoId(valor, cajaEfectivo) {
    const config = this.configuracionRepository.getAll();
    const usarCajaMenor = config.caja_menor_activa === 'true' && cajaEfectivo === 'Menor';
    const codigoCaja = usarCajaMenor ? '110510' : '110505';
    const cuentaCaja = this.planCuentaRepository.findByCodigo(codigoCaja);
    if (!cuentaCaja) throw new Error(`No se encontró la cuenta contable ${codigoCaja}; verifique el plan de cuentas`);

    // Un gasto en efectivo no puede dejar la caja física en negativo: eso sería un faltante de
    // efectivo que el sistema debe advertir en el momento de la captura, no descubrirse después
    // en un arqueo -- hallazgo Alto A-7 de la auditoría de Contabilidad (2026-07-03).
    const saldoDisponible = this.asientoContableService.getLibroMayor(cuentaCaja.id).saldoFinal;
    if (valor > saldoDisponible) {
      throw new Error(
        `Saldo insuficiente en ${usarCajaMenor ? 'Caja Menor' : 'Caja General'}: disponible $${saldoDisponible.toLocaleString('es-CO')}, ` +
        `se requieren $${Number(valor).toLocaleString('es-CO')}.`
      );
    }
    return cuentaCaja.id;
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

  // Corrige a qué cuenta (Caja/Banco) quedó asociado el dinero de un gasto, sin anularlo: el
  // número, fecha, valor y tercero quedan intactos. Revierte el asiento activo y genera uno
  // nuevo (generarDesdeGasto relee metodo_pago/caja_efectivo_id ya actualizados), y crea su
  // propia contrapartida en el ledger simple `movimientos` porque revertirPorReferencia no lo
  // hace por sí sola.
  //
  // Al corregir hacia Efectivo, caja_efectivo_id debe resolverse igual que en create() -- sin
  // esto, GASTO_EFECTIVO (que lo usa como cuenta_contexto_campo) no podía generar el asiento y la
  // corrección fallaba siempre con un error incomprensible -- hallazgo Alto A4 de la auditoría de
  // Contabilidad (2026-09-11). Siempre resuelve contra Caja General (no ofrece elegir Caja
  // Menor): mismo comportamiento por defecto que ya tenía create() antes de que existiera Caja
  // Menor.
  corregirMetodoPago(id, nuevoMetodoPago, motivo, usuarioId = null) {
    const gasto = this.repository.findById(id);
    if (!gasto) throw new Error('Gasto no encontrado');
    if (gasto.estado === 'Anulado') throw new Error('No se puede corregir el método de pago de un gasto anulado');
    if (!METODOS_PAGO_VALIDOS.includes(nuevoMetodoPago)) throw new Error('Método de pago inválido');
    if (nuevoMetodoPago === gasto.metodo_pago) throw new Error('El método de pago indicado es igual al actual');
    if (!motivo || !motivo.trim()) throw new Error('Debe indicar el motivo de la corrección');

    const cajaEfectivoId = nuevoMetodoPago === 'Efectivo'
      ? this._resolverCajaEfectivoId(gasto.valor)
      : null;

    return this.repository.transaccion(() => {
      this.repository.crearMovimiento({
        tipo: 'Ingreso',
        origen: gasto.metodo_pago === 'Efectivo' ? 'Caja' : 'Banco',
        monto: gasto.valor,
        concepto: `Corrección método de pago (reversión): ${gasto.concepto}`,
        referenciaId: id,
        referenciaTipo: 'Gasto',
        fechaMovimiento: new Date().toISOString().split('T')[0],
        observaciones: motivo
      });

      this.repository.crearMovimiento({
        tipo: 'Egreso',
        origen: nuevoMetodoPago === 'Efectivo' ? 'Caja' : 'Banco',
        monto: gasto.valor,
        concepto: `Corrección método de pago: ${gasto.concepto}`,
        referenciaId: id,
        referenciaTipo: 'Gasto',
        fechaMovimiento: new Date().toISOString().split('T')[0],
        observaciones: motivo
      });

      this.repository.actualizarMetodoPago(id, nuevoMetodoPago, motivo, cajaEfectivoId);

      this.asientoContableService.revertirPorReferencia('Gasto', id, `Corrección método de pago: ${motivo}`, usuarioId);
      this.asientoContableService.generarDesdeGasto(id, usuarioId);
    });
  }

  // Corrige el concepto y/o las observaciones de un gasto, sin tocar contabilidad: estos dos
  // campos nunca se copian a las líneas de un asiento (MotorContabilizacionService solo copia
  // cuenta_contable_id, montos y datos de tercero), así que no hace falta revertir/regenerar
  // nada. Por eso tampoco pasa por validarFechaPermitida: a diferencia de corregirMetodoPago,
  // esto funciona aunque el período contable de la fecha del gasto ya esté Cerrado.
  actualizarDatos(id, { concepto, observaciones }) {
    const gasto = this.repository.findById(id);
    if (!gasto) throw new Error('Gasto no encontrado');
    if (gasto.estado === 'Anulado') throw new Error('No se puede editar un gasto anulado');
    if (!concepto || !concepto.trim()) throw new Error('El concepto es obligatorio');

    this.repository.actualizarDatos(id, { concepto, observaciones });
  }

  // Adjuntar un soporte es solo metadata (referencia a Drive): no toca movimientos ni asientos
  // contables, así que no necesita transacción ni puede revertir nada al "deshacerse".
  adjuntarSoporte(gastoId, { tipoSoporte, driveFileId, nombreArchivo }) {
    const gasto = this.repository.findById(gastoId);
    if (!gasto) throw new Error('Gasto no encontrado');
    if (gasto.estado === 'Anulado') throw new Error('No se puede adjuntar un soporte a un gasto anulado');
    if (!TIPOS_SOPORTE_VALIDOS.includes(tipoSoporte)) throw new Error('Tipo de soporte inválido');

    return this.repository.crearSoporte(gastoId, { tipoSoporte, driveFileId, nombreArchivo });
  }

  getSoportes(gastoId) {
    return this.repository.getSoportes(gastoId);
  }

  getSoporte(soporteId) {
    return this.repository.getSoporteById(soporteId);
  }
}

module.exports = GastoService;
