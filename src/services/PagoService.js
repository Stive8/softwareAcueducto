const PagoRepository = require('../repositories/PagoRepository');
const CuentaRepository = require('../repositories/CuentaRepository');
const PropietarioRepository = require('../repositories/PropietarioRepository');

const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const METODOS_PAGO_VALIDOS = ['Efectivo', 'Transferencia'];

// Codifica un período (año, mes 1-12) como un entero comparable: útil para calcular
// diferencias en meses y para ordenar sin tener que comparar año y mes por separado.
function codificarPeriodo(anio, mes) {
  return anio * 12 + (mes - 1);
}

function decodificarPeriodo(codigo) {
  return { anio: Math.floor(codigo / 12), mes: (codigo % 12) + 1 };
}

class PagoService {
  constructor(dbService) {
    this.repository = new PagoRepository(dbService);
    this.cuentaRepository = new CuentaRepository(dbService);
    this.propietarioRepository = new PropietarioRepository(dbService);
  }

  formatPeriodo(anio, mes) {
    return `${NOMBRES_MES[mes - 1]} ${anio}`;
  }

  sumarMeses(anio, mes, cantidad) {
    return decodificarPeriodo(codificarPeriodo(anio, mes) + cantidad);
  }

  // Estado de pagos de una cuenta: pagado hasta, próximo período sugerido, mora y saldo a favor
  getEstadoCuenta(cuentaId) {
    const cuenta = this.cuentaRepository.findById(cuentaId);
    if (!cuenta) {
      throw new Error('Cuenta no encontrada');
    }

    const ahora = new Date();
    const periodoActual = { anio: ahora.getFullYear(), mes: ahora.getMonth() + 1 };

    const ultimoPagado = this.repository.getUltimoPeriodoPagado(cuentaId);

    let siguiente;
    if (ultimoPagado) {
      siguiente = this.sumarMeses(ultimoPagado.anio, ultimoPagado.mes, 1);
    } else {
      const creacion = new Date(cuenta.fecha_creacion);
      siguiente = { anio: creacion.getFullYear(), mes: creacion.getMonth() + 1 };
    }

    const mesesMora = Math.max(codificarPeriodo(periodoActual.anio, periodoActual.mes) - codificarPeriodo(siguiente.anio, siguiente.mes) + 1, 0);
    const enMora = mesesMora > 0;
    const saldoAFavor = this.repository.getSaldoCredito(cuentaId);

    return {
      cuentaId,
      pagadoHasta: ultimoPagado
        ? { anio: ultimoPagado.anio, mes: ultimoPagado.mes, label: this.formatPeriodo(ultimoPagado.anio, ultimoPagado.mes) }
        : null,
      siguientePeriodo: { anio: siguiente.anio, mes: siguiente.mes, label: this.formatPeriodo(siguiente.anio, siguiente.mes) },
      mesesMora,
      estadoMora: enMora ? 'En mora' : 'Al día',
      saldoAFavor
    };
  }

  // Construye la lista de períodos a cobrar y valida que ninguno esté ya pagado
  construirPeriodos(cuentaId, anioInicio, mesInicio, cantidadMeses) {
    const periodos = [];
    let cursor = { anio: anioInicio, mes: mesInicio };

    for (let i = 0; i < cantidadMeses; i++) {
      if (this.repository.existePeriodoPagado(cuentaId, cursor.anio, cursor.mes)) {
        throw new Error(`El período ${this.formatPeriodo(cursor.anio, cursor.mes)} ya fue pagado`);
      }

      const tarifa = this.repository.getCategoriaTarifaParaMes(cuentaId, cursor.anio, cursor.mes);
      if (!tarifa) {
        throw new Error(`No hay categoría o tarifa de sostenimiento configurada para ${this.formatPeriodo(cursor.anio, cursor.mes)}`);
      }

      periodos.push({ anio: cursor.anio, mes: cursor.mes, valor: tarifa.tarifa_sostenimiento });
      cursor = this.sumarMeses(cursor.anio, cursor.mes, 1);
    }

    return periodos;
  }

  // Agrupa meses consecutivos con la misma tarifa en un solo segmento (una línea de recibo)
  agruparPeriodos(periodos) {
    const grupos = [];
    for (const periodo of periodos) {
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.valorUnitario === periodo.valor) {
        ultimo.periodos.push(periodo);
        ultimo.valor += periodo.valor;
      } else {
        grupos.push({ valorUnitario: periodo.valor, valor: periodo.valor, periodos: [periodo] });
      }
    }
    return grupos;
  }

  // Previsualización: cuánto costaría pagar N meses desde un período de inicio, sin registrar nada
  simularPago(cuentaId, anioInicio, mesInicio, cantidadMeses) {
    const periodos = this.construirPeriodos(cuentaId, anioInicio, mesInicio, cantidadMeses);
    const saldoAFavor = this.repository.getSaldoCredito(cuentaId);
    const subtotal = periodos.reduce((sum, p) => sum + p.valor, 0);
    const creditoAplicado = Math.min(saldoAFavor, subtotal);

    return {
      periodos: periodos.map(p => ({ ...p, label: this.formatPeriodo(p.anio, p.mes) })),
      subtotal,
      saldoAFavorDisponible: saldoAFavor,
      creditoAplicado,
      totalACobrar: subtotal - creditoAplicado
    };
  }

  validarDatosComunes({ cuentaId, fechaPago, metodoPago }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!fechaPago) throw new Error('La fecha de pago es obligatoria');
    if (!METODOS_PAGO_VALIDOS.includes(metodoPago)) throw new Error('Método de pago inválido');
  }

  obtenerPropietarioVigente(cuentaId) {
    const propietario = this.propietarioRepository.getPropietarioActualCuenta(cuentaId);
    if (!propietario) {
      throw new Error('La cuenta no tiene un propietario asignado actualmente; asígnelo antes de registrar el pago');
    }
    return propietario;
  }

  // Registra el pago de sostenimiento de uno o varios meses (atrasados, futuros o varios años) y genera el recibo
  registrarPagoSostenimiento({ cuentaId, anioInicio, mesInicio, cantidadMeses, fechaPago, metodoPago, observaciones, usarSaldoAFavor = true }) {
    this.validarDatosComunes({ cuentaId, fechaPago, metodoPago });
    if (!anioInicio || !mesInicio) throw new Error('El período inicial es obligatorio');
    if (!cantidadMeses || cantidadMeses < 1) throw new Error('La cantidad de meses debe ser al menos 1');

    const propietario = this.obtenerPropietarioVigente(cuentaId);
    const periodos = this.construirPeriodos(cuentaId, anioInicio, mesInicio, cantidadMeses);
    const subtotal = periodos.reduce((sum, p) => sum + p.valor, 0);
    const saldoDisponible = usarSaldoAFavor ? this.repository.getSaldoCredito(cuentaId) : 0;
    const creditoAplicado = Math.min(saldoDisponible, subtotal);
    const totalACobrar = subtotal - creditoAplicado;

    return this.repository.transaccion(() => {
      const numeroRecibo = this.repository.getConsecutivoRecibo();

      const reciboId = this.repository.crearRecibo({
        numeroRecibo,
        cuentaId,
        propietarioId: propietario.id,
        fechaRecibo: fechaPago,
        total: totalACobrar,
        metodoPago,
        observaciones
      });

      this.repository.incrementarConsecutivoRecibo(numeroRecibo + 1);

      const grupos = this.agruparPeriodos(periodos);
      for (const grupo of grupos) {
        const primero = grupo.periodos[0];
        const ultimo = grupo.periodos[grupo.periodos.length - 1];
        const concepto = grupo.periodos.length > 1
          ? `Sostenimiento ${this.formatPeriodo(primero.anio, primero.mes)} - ${this.formatPeriodo(ultimo.anio, ultimo.mes)}`
          : `Sostenimiento ${this.formatPeriodo(primero.anio, primero.mes)}`;

        const detalleId = this.repository.crearReciboDetalle({
          reciboId,
          concepto,
          periodoDesde: this.formatPeriodo(primero.anio, primero.mes),
          periodoHasta: this.formatPeriodo(ultimo.anio, ultimo.mes),
          valor: grupo.valor
        });

        for (const periodo of grupo.periodos) {
          this.repository.crearPeriodoPago(cuentaId, periodo.anio, periodo.mes, periodo.valor, detalleId, fechaPago);
        }
      }

      if (creditoAplicado > 0) {
        const detalleCreditoId = this.repository.crearReciboDetalle({
          reciboId,
          concepto: 'Aplicación de saldo a favor',
          valor: -creditoAplicado
        });
        this.repository.crearMovimientoCredito(cuentaId, 'Aplicado', creditoAplicado, detalleCreditoId, fechaPago, 'Aplicado a pago de sostenimiento');
      }

      if (totalACobrar > 0) {
        this.repository.crearMovimiento({
          tipo: 'Ingreso',
          origen: metodoPago === 'Efectivo' ? 'Caja' : 'Banco',
          monto: totalACobrar,
          concepto: `Recibo No. ${numeroRecibo} - Sostenimiento`,
          referenciaId: reciboId,
          referenciaTipo: 'Recibo',
          fechaMovimiento: fechaPago
        });
      }

      return { reciboId, numeroRecibo, total: totalACobrar, creditoAplicado };
    });
  }

  // Abono libre: no se asocia a meses específicos, queda como saldo a favor de la cuenta
  registrarAbono({ cuentaId, monto, fechaPago, metodoPago, observaciones }) {
    this.validarDatosComunes({ cuentaId, fechaPago, metodoPago });
    if (!monto || monto <= 0) throw new Error('El monto del abono debe ser mayor a cero');

    const propietario = this.obtenerPropietarioVigente(cuentaId);

    return this.repository.transaccion(() => {
      const numeroRecibo = this.repository.getConsecutivoRecibo();

      const reciboId = this.repository.crearRecibo({
        numeroRecibo,
        cuentaId,
        propietarioId: propietario.id,
        fechaRecibo: fechaPago,
        total: monto,
        metodoPago,
        observaciones
      });

      this.repository.incrementarConsecutivoRecibo(numeroRecibo + 1);

      const detalleId = this.repository.crearReciboDetalle({
        reciboId,
        concepto: 'Abono a saldo a favor',
        valor: monto
      });

      this.repository.crearMovimientoCredito(cuentaId, 'Abono', monto, detalleId, fechaPago, observaciones);

      this.repository.crearMovimiento({
        tipo: 'Ingreso',
        origen: metodoPago === 'Efectivo' ? 'Caja' : 'Banco',
        monto,
        concepto: `Recibo No. ${numeroRecibo} - Abono`,
        referenciaId: reciboId,
        referenciaTipo: 'Recibo',
        fechaMovimiento: fechaPago
      });

      return { reciboId, numeroRecibo, total: monto };
    });
  }

  getHistorialPagos(cuentaId) {
    return this.repository.getMesesPagados(cuentaId);
  }

  getCuentasConEstado(params) {
    const resultado = this.repository.getCuentasConEstado(params);
    const ahora = new Date();
    const periodoActualCod = codificarPeriodo(ahora.getFullYear(), ahora.getMonth() + 1);

    resultado.data = resultado.data.map(row => {
      let pagadoHasta = null;
      let siguienteCod;

      if (row.ultimo_periodo_num !== null && row.ultimo_periodo_num !== undefined) {
        const periodo = decodificarPeriodo(row.ultimo_periodo_num);
        pagadoHasta = this.formatPeriodo(periodo.anio, periodo.mes);
        siguienteCod = row.ultimo_periodo_num + 1;
      } else {
        const creacion = new Date(row.fecha_creacion);
        siguienteCod = codificarPeriodo(creacion.getFullYear(), creacion.getMonth() + 1);
      }

      const mesesMora = Math.max(periodoActualCod - siguienteCod + 1, 0);

      return {
        ...row,
        pagado_hasta: pagadoHasta,
        meses_mora: mesesMora,
        estado_mora: mesesMora > 0 ? 'En mora' : 'Al día',
        saldo_favor: row.saldo_favor
      };
    });

    return resultado;
  }
}

module.exports = PagoService;
