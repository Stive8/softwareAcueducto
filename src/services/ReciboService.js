const path = require('path');
const ReciboRepository = require('../repositories/ReciboRepository');
const AsientoContableService = require('./AsientoContableService');
const { esMayor } = require('./cartera/dinero');
const { obtenerLogoBase64 } = require('./shared/logoBase64');
const { PLANTILLAS } = require('./recibos/plantillas');

const METODOS_PAGO_VALIDOS = ['Efectivo', 'Transferencia'];
const CAMPOS_DE_RECIBO = ['numero_recibo', 'fecha_recibo'];
const CAMPOS_DE_DETALLE = ['concepto', 'valor'];

class ReciboService {
  constructor(dbService) {
    this.repository = new ReciboRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
    this.dataDir = path.dirname(dbService.getDbPath());
  }

  getAll(params) {
    return this.repository.findAll(params);
  }

  getById(id) {
    const recibo = this.repository.findById(id);
    if (!recibo) return null;

    recibo.detalles = this.repository.getDetalles(id);
    return recibo;
  }

  getConsecutivoRecibo() {
    return this.repository.getConsecutivoRecibo();
  }

  registrarAnuladoFisico({ numeroRecibo, fecha, motivo }) {
    if (!numeroRecibo || Number(numeroRecibo) <= 0) throw new Error('Debe indicar el número de recibo');
    if (!motivo || !motivo.trim()) throw new Error('Debe indicar el motivo de la anulación');
    if (this.repository.numeroRecibioExiste(Number(numeroRecibo))) {
      throw new Error(`El número de recibo ${numeroRecibo} ya está registrado (como recibo o como anulado)`);
    }
    return this.repository.crearAnuladoFisico({ numeroRecibo: Number(numeroRecibo), fecha, motivo });
  }

  getAnuladosFisicos() {
    return this.repository.getAnuladosFisicos();
  }

  anular(id, motivoAnulacion, usuarioId = null) {
    const recibo = this.repository.findById(id);
    if (!recibo) throw new Error('Recibo no encontrado');
    if (recibo.estado === 'Anulado') throw new Error('El recibo ya está anulado');
    if (!motivoAnulacion || !motivoAnulacion.trim()) throw new Error('Debe indicar el motivo de la anulación');

    // Si este recibo generó saldo a favor (sobrante) y parte de ese saldo ya fue redimido contra
    // deuda (CarteraService.redimirCredito), borrar el crédito de este recibo sin más dejaría el
    // saldo a favor de la cuenta en negativo -- corrupción silenciosa (ver
    // ReciboRepository.getImpactoCreditoAlAnular). Se bloquea en vez de intentar revertir la
    // redención: cuenta_creditos es un pool por cuenta, no hay forma de saber con certeza qué
    // redención vino de qué crédito puntual si la cuenta tuvo más de uno.
    const impacto = this.repository.getImpactoCreditoAlAnular(id, recibo.cuenta_id);
    if (esMayor(0, impacto.saldoTrasAnular)) {
      throw new Error(
        'No se puede anular este recibo: parte del saldo a favor que generó ya fue aplicado a otra deuda de esta cuenta. ' +
        'Anularlo dejaría el saldo a favor en negativo. Consulte con un administrador antes de continuar.'
      );
    }

    return this.repository.transaccion(() => {
      this.repository.anular(id, motivoAnulacion);

      // Si el recibo se cubrió totalmente con saldo a favor (total = 0), no entró ni salió
      // efectivo real de caja/banco, así que no hay nada que revertir en ese ledger.
      if (recibo.total > 0) {
        this.repository.crearMovimiento({
          tipo: 'Egreso',
          origen: recibo.metodo_pago === 'Efectivo' ? 'Caja' : 'Banco',
          monto: recibo.total,
          concepto: `Reversión por anulación de recibo No. ${recibo.numero_recibo}`,
          referenciaId: id,
          referenciaTipo: 'Recibo',
          fechaMovimiento: new Date().toISOString().split('T')[0],
          observaciones: motivoAnulacion
        });
      }

      this.asientoContableService.revertirPorReferencia('Recibo', id, motivoAnulacion, usuarioId);
    });
  }

  // Corrige a qué cuenta (Caja/Banco) quedó asociado el dinero de un recibo, sin anularlo: el
  // número, fecha, valor y propietario quedan intactos. Espejo de GastoService.corregirMetodoPago
  // pero invertido (el recibo es un Ingreso, su reversión es un Egreso).
  corregirMetodoPago(id, nuevoMetodoPago, motivo, usuarioId = null) {
    const recibo = this.repository.findById(id);
    if (!recibo) throw new Error('Recibo no encontrado');
    if (recibo.estado === 'Anulado') throw new Error('No se puede corregir el método de pago de un recibo anulado');
    if (!METODOS_PAGO_VALIDOS.includes(nuevoMetodoPago)) throw new Error('Método de pago inválido');
    if (nuevoMetodoPago === recibo.metodo_pago) throw new Error('El método de pago indicado es igual al actual');
    if (!motivo || !motivo.trim()) throw new Error('Debe indicar el motivo de la corrección');
    if (recibo.total <= 0) throw new Error('Este recibo se cubrió completamente con saldo a favor: no tiene movimiento de caja/banco asociado para corregir');

    return this.repository.transaccion(() => {
      this.repository.crearMovimiento({
        tipo: 'Egreso',
        origen: recibo.metodo_pago === 'Efectivo' ? 'Caja' : 'Banco',
        monto: recibo.total,
        concepto: `Corrección método de pago (reversión): Recibo No. ${recibo.numero_recibo}`,
        referenciaId: id,
        referenciaTipo: 'Recibo',
        fechaMovimiento: new Date().toISOString().split('T')[0],
        observaciones: motivo
      });

      this.repository.crearMovimiento({
        tipo: 'Ingreso',
        origen: nuevoMetodoPago === 'Efectivo' ? 'Caja' : 'Banco',
        monto: recibo.total,
        concepto: `Corrección método de pago: Recibo No. ${recibo.numero_recibo}`,
        referenciaId: id,
        referenciaTipo: 'Recibo',
        fechaMovimiento: new Date().toISOString().split('T')[0],
        observaciones: motivo
      });

      this.repository.actualizarMetodoPago(id, nuevoMetodoPago, motivo);

      this.asientoContableService.revertirPorReferencia('Recibo', id, `Corrección método de pago: ${motivo}`, usuarioId);
      this.asientoContableService.generarDesdeRecibo(id, usuarioId);
    });
  }

  // Corrige numero_recibo/fecha_recibo (a nivel de recibo) o concepto/valor (a nivel de un
  // recibo_detalle puntual) SIN sobrescribir la columna original: regla 3 de la carga inicial
  // ("el recibo se guarda literal e inmutable"). Cada llamada agrega una fila a
  // recibo_correcciones; el valor vigente es el de la corrección más reciente.
  corregirCampo({ reciboId, reciboDetalleId = null, campo, valorNuevo, motivo, usuarioId = null }) {
    const recibo = this.repository.findById(reciboId);
    if (!recibo) throw new Error('Recibo no encontrado');
    if (recibo.estado === 'Anulado') throw new Error('No se puede corregir un recibo anulado');
    if (!motivo || !motivo.trim()) throw new Error('Debe indicar el motivo de la corrección');
    if (valorNuevo === undefined || valorNuevo === null || String(valorNuevo).trim() === '') {
      throw new Error('Debe indicar el valor nuevo');
    }

    let valorAnterior;
    if (CAMPOS_DE_RECIBO.includes(campo)) {
      if (reciboDetalleId) throw new Error(`El campo "${campo}" pertenece al recibo, no a un detalle`);
      valorAnterior = this.repository.getValorVigente(reciboId, campo, null) ?? String(recibo[campo]);
    } else if (CAMPOS_DE_DETALLE.includes(campo)) {
      if (!reciboDetalleId) throw new Error(`El campo "${campo}" requiere indicar el recibo_detalle`);
      const detalle = this.repository.getDetalles(reciboId).find(d => d.id === reciboDetalleId);
      if (!detalle) throw new Error('recibo_detalle no encontrado en este recibo');
      valorAnterior = this.repository.getValorVigente(reciboId, campo, reciboDetalleId) ?? String(detalle[campo]);
    } else {
      throw new Error(`Campo no editable: ${campo}`);
    }

    if (String(valorAnterior) === String(valorNuevo)) {
      throw new Error('El valor nuevo es igual al valor vigente');
    }

    return this.repository.crearCorreccion({
      reciboId, reciboDetalleId, campo,
      valorAnterior: String(valorAnterior), valorNuevo: String(valorNuevo),
      motivo, usuarioId
    });
  }

  getValorVigente(reciboId, campo, reciboDetalleId = null) {
    return this.repository.getValorVigente(reciboId, campo, reciboDetalleId);
  }

  getHistorialCorrecciones(reciboId) {
    return this.repository.getCorrecciones(reciboId);
  }

  // Junta los datos vigentes de un recibo (aplicando cualquier corrección posterior, ver
  // getValorVigente) con la información institucional, en un único objeto formato-agnóstico
  // que consumen las plantillas de src/services/recibos/plantillas.js.
  obtenerDatosParaImprimir(id) {
    const recibo = this.getById(id);
    if (!recibo) throw new Error('Recibo no encontrado');

    const numeroRecibo = this.repository.getValorVigente(id, 'numero_recibo') ?? recibo.numero_recibo;
    const fechaRecibo = this.repository.getValorVigente(id, 'fecha_recibo') ?? recibo.fecha_recibo;

    const detalles = recibo.detalles.map(d => ({
      ...d,
      concepto: this.repository.getValorVigente(id, 'concepto', d.id) ?? d.concepto,
      valor: this.repository.getValorVigente(id, 'valor', d.id) ?? d.valor
    }));

    const configBase = this.repository.getConfiguracionAsociacion();
    const logoBase64 = obtenerLogoBase64(this.dataDir, configBase.logo_path);

    return {
      ...recibo,
      numero_recibo: numeroRecibo,
      fecha_recibo: fechaRecibo,
      detalles,
      config: { ...configBase, logoBase64 }
    };
  }

  // Genera el documento HTML imprimible de un recibo, en el formato pedido (usado tanto para
  // imprimir como para exportar a PDF). formatoOverride ausente/vacío = usar el predeterminado
  // configurado para el acueducto (configuracion.formato_impresion_recibo).
  generarHTML(id, formatoOverride) {
    const datos = this.obtenerDatosParaImprimir(id);
    const formato = formatoOverride || this.repository.getFormatoImpresionPredeterminado();
    const render = PLANTILLAS[formato] || PLANTILLAS.carta;
    return render(datos);
  }
}

module.exports = ReciboService;
