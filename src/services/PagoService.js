const PagoRepository = require('../repositories/PagoRepository');
const CuentaRepository = require('../repositories/CuentaRepository');
const PropietarioRepository = require('../repositories/PropietarioRepository');
const NuevoPuntoRepository = require('../repositories/NuevoPuntoRepository');
const AsientoContableService = require('./AsientoContableService');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');
const CarteraService = require('./CarteraService');
const { MODOS } = require('./cartera/imputacion');
const { redondear, esMayor } = require('./cartera/dinero');

const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const METODOS_PAGO_VALIDOS = ['Efectivo', 'Transferencia'];

const ETIQUETA_MOTIVO_MORA = { meses_corrientes: 'Meses corrientes', deuda_anterior_2024: 'Deuda anterior al corte' };

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumeroDinero(num) {
  return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Formatea 'YYYY-MM-DD' a 'DD/MM/AAAA' sin pasar por new Date() (ver nota de zona horaria arriba).
function formatFechaCorta(fechaString) {
  if (!fechaString) return '-';
  const [anio, mes, dia] = fechaString.split(' ')[0].split('-');
  return `${dia}/${mes}/${anio}`;
}

// Codifica un período (año, mes 1-12) como un entero comparable: útil para calcular
// diferencias en meses y para ordenar sin tener que comparar año y mes por separado.
function codificarPeriodo(anio, mes) {
  return anio * 12 + (mes - 1);
}

function decodificarPeriodo(codigo) {
  return { anio: Math.floor(codigo / 12), mes: (codigo % 12) + 1 };
}

// Extrae año/mes de una fecha 'YYYY-MM-DD' sin pasar por new Date(): un string de solo fecha
// se interpreta como medianoche UTC, y en una zona horaria negativa (ej. Colombia, UTC-5) eso
// puede retroceder la fecha un día y, si era el día 1, retroceder el mes entero.
function anioMesDeFecha(fechaString) {
  const [anio, mes] = fechaString.split(' ')[0].split('-').map(Number);
  return { anio, mes };
}

class PagoService {
  constructor(dbService) {
    this.repository = new PagoRepository(dbService);
    this.cuentaRepository = new CuentaRepository(dbService);
    this.propietarioRepository = new PropietarioRepository(dbService);
    this.nuevoPuntoRepository = new NuevoPuntoRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
    this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService), dbService);
    this.carteraService = new CarteraService(dbService);
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

    // "Pagado hasta"/"próximo período sugerido" se calculan desde cartera_movimientos (vía
    // CarteraService.getProximoPeriodoSugerido), no desde pago_periodos: cartera es la fuente
    // completa -- recibe tanto la carga inicial como cada pago nuevo por la doble escritura --
    // mientras que pago_periodos puede tener huecos para recibos que se causaron directo en
    // cartera durante la carga inicial (caso real: R001, 2026-08, ver
    // docs/superpowers/specs/2026-08-09-proximo-periodo-sugerido-design.md). Usar pago_periodos
    // acá sugería un período que cartera ya tenía cubierto, y el guardián de
    // registrarPagoSostenimiento lo rechazaba: bloqueaba el cobro por completo para esas cuentas.
    //
    // alDiaHasta ignora huecos históricos a propósito (esos siguen siendo deuda real, ver
    // CarteraService.getEstadoCartera/calcularAPagar, que esta función no toca) -- es
    // deliberadamente distinto de "cuánto debe en total".
    const { alDiaHasta, siguiente: siguienteCartera } = this.carteraService.getProximoPeriodoSugerido(cuentaId);
    const ultimoPagado = alDiaHasta;
    const siguiente = siguienteCartera || anioMesDeFecha(cuenta.fecha_creacion);

    const saldoAFavor = this.repository.getSaldoCredito(cuentaId);
    const { totalPagado, totalMesesPagados } = this.repository.getResumenPagos(cuentaId);

    // mesesMora/estadoMora/saldoPendienteEstimado ya NO salen del rango contra alDiaHasta (ese
    // concepto es correcto solo para "próximo período sugerido", arriba, no para "cuánto debe" --
    // ver CarteraService.getEstadoCartera). Mismo criterio que ReporteService.procesarEstadoCuentas:
    // CarteraService.getIndicadoresMoraTodas, meses_impagos (no el rango completo desde el hueco,
    // caso real R007) + deuda_antes_2024, con su motivo_mora.
    const [ind] = this.carteraService.getIndicadoresMoraTodas([cuentaId]);
    const mesesMora = ind.mesesImpagos;
    const deudaAntes2024 = ind.deudaAntes2024;
    const motivoMora = [];
    if (mesesMora > 0) motivoMora.push('meses_corrientes');
    if (deudaAntes2024 > 0) motivoMora.push('deuda_anterior_2024');
    const enMora = motivoMora.length > 0;
    const saldoPendienteEstimado = redondear(deudaAntes2024 + (ind.deudaExigible > 0 ? ind.deudaExigible : 0));

    return {
      cuentaId,
      pagadoHasta: ultimoPagado
        ? { anio: ultimoPagado.anio, mes: ultimoPagado.mes, label: this.formatPeriodo(ultimoPagado.anio, ultimoPagado.mes) }
        : null,
      siguientePeriodo: { anio: siguiente.anio, mes: siguiente.mes, label: this.formatPeriodo(siguiente.anio, siguiente.mes) },
      mesesMora,
      deudaAntes2024,
      motivoMora,
      estadoMora: enMora ? 'En mora' : 'Al día',
      saldoAFavor,
      totalPagado,
      totalMesesPagados,
      saldoPendienteEstimado
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

  // Previsualización: cuánto costaría pagar N meses desde un período de inicio, sin registrar nada.
  // usarSaldoAFavor por defecto en false, igual que registrarPagoSostenimiento (ver el porqué ahí):
  // la previsualización nunca debe prometer un total distinto del que el registro real va a cobrar.
  // saldoAFavorDisponible se informa siempre, se use o no, para que quien cobra sepa que existe.
  simularPago(cuentaId, anioInicio, mesInicio, cantidadMeses, usarSaldoAFavor = false) {
    const periodos = this.construirPeriodos(cuentaId, anioInicio, mesInicio, cantidadMeses);
    const saldoAFavor = this.repository.getSaldoCredito(cuentaId);
    const subtotal = periodos.reduce((sum, p) => sum + p.valor, 0);
    const creditoAplicado = usarSaldoAFavor ? Math.min(saldoAFavor, subtotal) : 0;

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

  // Registra el pago de sostenimiento de uno o varios meses (atrasados, futuros o varios años) y genera el
  // recibo. Opcionalmente, en el MISMO recibo (mismo número, mismo movimiento de caja) puede incluir un abono
  // al cargo de conexión pendiente de la cuenta (nuevoPuntoId + abonoConexion), para el caso real de que la
  // persona pague meses y conexión juntos en un solo recibo físico.
  //
  // usarSaldoAFavor por defecto en false (cambio 2026-08-09; antes true): el saldo a favor NUNCA
  // se aplica solo. Antes de este cambio, cualquier pago consumía automáticamente el crédito
  // disponible sin que nadie lo pidiera -- alguien con saldo a favor que nunca supo que lo tenía
  // llegaba a pagar su cuota normal y esta función se la cobraba de menos (o en cero) sin avisarle,
  // consumiendo un crédito que quizás quería guardar. Mismo criterio que ya rige la pantalla de
  // cartera nueva (avisos aparte, nada se aplica sin decisión explícita, ver CarteraService.js) --
  // acá faltaba aplicarlo. Aplicar el crédito ahora es un acto explícito (usarSaldoAFavor: true).
  registrarPagoSostenimiento({ cuentaId, anioInicio, mesInicio, cantidadMeses, fechaPago, metodoPago, observaciones, usarSaldoAFavor = false, nuevoPuntoId = null, abonoConexion = 0 }, usuarioId = null) {
    this.validarDatosComunes({ cuentaId, fechaPago, metodoPago });
    if (!anioInicio || !mesInicio) throw new Error('El período inicial es obligatorio');
    if (!cantidadMeses || cantidadMeses < 1) throw new Error('La cantidad de meses debe ser al menos 1');

    // Valida que el período contable de la fecha de pago esté Abierto (fail-fast antes de escrituras).
    this.periodoContableService.validarFechaPermitida(fechaPago);

    let puntoConexion = null;
    if (abonoConexion > 0) {
      if (!nuevoPuntoId) throw new Error('Debe indicar a qué cargo de conexión aplica el abono');
      puntoConexion = this.nuevoPuntoRepository.findById(nuevoPuntoId);
      if (!puntoConexion || puntoConexion.cuenta_id !== cuentaId) throw new Error('El cargo de conexión no corresponde a esta cuenta');
      if (puntoConexion.estado !== 'Pendiente') throw new Error(`Este cargo de conexión está en estado "${puntoConexion.estado}" y no admite más abonos`);
      if (abonoConexion > puntoConexion.saldo_pendiente) {
        throw new Error(`El abono a conexión ($${abonoConexion}) no puede ser mayor al saldo pendiente ($${puntoConexion.saldo_pendiente})`);
      }
    }

    const propietario = this.obtenerPropietarioVigente(cuentaId);
    const periodos = this.construirPeriodos(cuentaId, anioInicio, mesInicio, cantidadMeses);
    const subtotal = periodos.reduce((sum, p) => sum + p.valor, 0);
    const saldoDisponible = usarSaldoAFavor ? this.repository.getSaldoCredito(cuentaId) : 0;
    const creditoAplicado = Math.min(saldoDisponible, subtotal);
    const totalACobrar = subtotal - creditoAplicado + abonoConexion;

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
      let primerDetalleId = null;
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
        if (primerDetalleId === null) primerDetalleId = detalleId;

        for (const periodo of grupo.periodos) {
          this.repository.crearPeriodoPago(cuentaId, periodo.anio, periodo.mes, periodo.valor, detalleId, fechaPago);
        }
      }

      // Espejo en el motor de cartera nuevo: causar los meses que falten y abonarlos con la
      // porción en efectivo de este pago. MesesEspecificos (no FIFO) porque el operador ya
      // decidió, con anioInicio/mesInicio/cantidadMeses, exactamente qué meses cubre este recibo
      // -- igual criterio que ya usa paso10-imputacion.js para los recibos con período declarado.
      const ultimoPeriodo = periodos[periodos.length - 1];
      const resultadoCausacion = this.carteraService.asegurarCausacion(cuentaId, ultimoPeriodo.anio, ultimoPeriodo.mes);
      if (resultadoCausacion.omitidos.length > 0) {
        throw new Error(
          'No se pudo causar en el motor de cartera: ' +
          resultadoCausacion.omitidos.map(o => `${o.anio}-${o.mes}: ${o.motivo}`).join('; ')
        );
      }

      const cargosPendientesCartera = this.carteraService.repository.getCargosPendientes(cuentaId, 1);
      const cargosDeEstePago = cargosPendientesCartera
        .filter(c => periodos.some(p => p.anio === c.anio && p.mes === c.mes))
        .map(c => c.id);

      // Respaldo del check de arriba: asegurarCausacion puede devolver omitidos vacío y aun así
      // no haber dejado un cargo PENDIENTE para alguno de los meses que este recibo va a cobrar.
      // Dos casos reales: (1) el ancla de facturación cae DESPUÉS de alguno de los meses pedidos
      // (ej. pagar diciembre de 2021 cuando la causación empieza en enero de 2022) -- el rango
      // interno de asegurarCausacion se invierte y su bucle nunca corre, así que nunca llega a
      // poblar omitidos; (2) la carga inicial ya cubrió ese mes por FIFO (paso10-imputacion.js)
      // sin que exista una fila en pago_periodos para ese mes exacto, o con el cargo ya en cero
      // -- getCargosPendientes lo filtra por no tener saldo. En cualquiera de los dos casos,
      // cargosDeEstePago queda corto frente a periodos: nunca hay que seguir en silencio, mejor
      // que el recibo no se registre a que se registre sin su espejo completo en cartera.
      if (cargosDeEstePago.length !== periodos.length) {
        throw new Error(
          'No se pudo causar en el motor de cartera: se esperaban ' +
          `${periodos.length} cargo(s) pendiente(s) para los meses de este recibo y solo se ` +
          `encontraron ${cargosDeEstePago.length}`
        );
      }

      const montoEfectivoSostenimiento = redondear(totalACobrar - abonoConexion);
      if (montoEfectivoSostenimiento > 0) {
        const resultadoAbono = this.carteraService.registrarAbono({
          cuentaId, fecha: fechaPago, monto: montoEfectivoSostenimiento,
          modo: MODOS.MESES_ESPECIFICOS, cargosElegidos: cargosDeEstePago,
          reciboDetalleId: primerDetalleId, usuarioId
        });
        // Si distribuir() dejó un sobrante, es porque cargosDeEstePago no absorbió el monto
        // completo (ej. algún cargo ya traía saldo parcial de otro lado) -- CarteraService lo
        // convertiría en un crédito fantasma en cuenta_creditos que el operador nunca pidió,
        // mientras el modelo viejo ya muestra el recibo como pagado completo. Mismo criterio que
        // arriba: no dejarlo pasar en silencio.
        if (esMayor(resultadoAbono.sobrante, 0)) {
          throw new Error(
            'El motor de cartera no pudo imputar completa la porción en efectivo de este pago: ' +
            `sobraron $${resultadoAbono.sobrante} sin poder aplicarse a los meses elegidos`
          );
        }
      }

      if (creditoAplicado > 0) {
        const detalleCreditoId = this.repository.crearReciboDetalle({
          reciboId,
          concepto: 'Aplicación de saldo a favor',
          valor: -creditoAplicado,
          tipoConceptoContable: 'AplicacionSaldoFavor'
        });
        // Reemplaza el crearMovimientoCredito('Aplicado', ...) que había antes: cuenta_creditos
        // es la MISMA tabla para los dos modelos (migración 041), así que esto no descuenta el
        // saldo dos veces -- lo descuenta igual, pero además deja la imputación contra los
        // cargos reales de cartera_movimientos, que antes no quedaba en ningún lado.
        const resultadoCredito = this.carteraService.aplicarCreditoAMeses({
          cuentaId, monto: creditoAplicado, cargosElegidos: cargosDeEstePago,
          fecha: fechaPago, reciboDetalleId: detalleCreditoId, usuarioId
        });
        // Mismo criterio que con la porción en efectivo (arriba): si distribuir() dejó un
        // sobrante es porque cargosDeEstePago ya no tenía pendiente suficiente para absorber
        // todo el crédito -- el recibo viejo ya mostraría el saldo a favor como aplicado por
        // completo, mientras cartera_movimientos se quedaría corto. No dejarlo pasar en silencio.
        if (esMayor(resultadoCredito.sobrante, 0)) {
          throw new Error(
            'El motor de cartera no pudo imputar completa la porción de saldo a favor de este pago: ' +
            `sobraron $${resultadoCredito.sobrante} sin poder aplicarse a los meses elegidos`
          );
        }
      }

      let estadoConexion = null;
      if (abonoConexion > 0) {
        const detalleConexionId = this.repository.crearReciboDetalle({
          reciboId,
          concepto: `Abono Punto Nuevo - Cuenta ${puntoConexion.cuenta_codigo || ''}`.trim(),
          valor: abonoConexion,
          tipoConceptoContable: 'AbonoPuntoNuevo'
        });
        this.nuevoPuntoRepository.crearAbono({ nuevoPuntoId, monto: abonoConexion, fechaAbono: fechaPago, reciboDetalleId: detalleConexionId, observaciones });
        estadoConexion = this.nuevoPuntoRepository.actualizarSaldoYEstado(nuevoPuntoId);
      }

      if (totalACobrar > 0) {
        this.repository.crearMovimiento({
          tipo: 'Ingreso',
          origen: metodoPago === 'Efectivo' ? 'Caja' : 'Banco',
          monto: totalACobrar,
          concepto: `Recibo No. ${numeroRecibo} - Sostenimiento${abonoConexion > 0 ? ' + Abono Conexión' : ''}`,
          referenciaId: reciboId,
          referenciaTipo: 'Recibo',
          fechaMovimiento: fechaPago
        });
      }

      this.asientoContableService.generarDesdeRecibo(reciboId, usuarioId);

      return { reciboId, numeroRecibo, total: totalACobrar, creditoAplicado, estadoConexion };
    });
  }

  getHistorialPagos(cuentaId) {
    return this.repository.getHistorialRecibosSostenimiento(cuentaId);
  }

  // Documento imprimible/exportable de estado de cuenta: resumen + historial agrupado por
  // recibo (no mes por mes), para entregar o archivar sin tener que mirar el módulo en pantalla.
  generarHTMLEstadoCuenta(cuentaId) {
    const cuenta = this.cuentaRepository.findById(cuentaId);
    if (!cuenta) throw new Error('Cuenta no encontrada');

    const propietario = this.propietarioRepository.getPropietarioActualCuenta(cuentaId);
    const estado = this.getEstadoCuenta(cuentaId);
    const historial = this.getHistorialPagos(cuentaId);
    const config = this.repository.getConfiguracionAsociacion();

    const filasHistorial = historial.map(h => `
      <tr>
        <td>${escapeHtml(h.periodo_desde === h.periodo_hasta ? h.periodo_desde : `${h.periodo_desde} - ${h.periodo_hasta}`)}</td>
        <td class="text-right">$${formatNumeroDinero(h.valor)}</td>
        <td>${formatFechaCorta(h.fecha_recibo)}</td>
        <td>No. ${h.numero_recibo}</td>
      </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Estado de Cuenta - ${escapeHtml(cuenta.codigo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 32px; color: #1f2937; }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #1e40af; padding-bottom: 16px; }
  .header h1 { color: #1e40af; font-size: 20px; margin: 0 0 6px 0; }
  .header p { font-size: 12px; color: #475569; margin: 2px 0; }
  .titulo { text-align: center; font-size: 16px; font-weight: bold; color: #1e40af; margin-bottom: 20px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; font-size: 13px; }
  .info-grid div span { font-weight: bold; color: #334155; }
  .resumen { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; }
  .resumen-card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; text-align: center; }
  .resumen-card .label { font-size: 11px; color: #64748b; text-transform: uppercase; }
  .resumen-card .valor { font-size: 15px; font-weight: bold; color: #1e293b; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 10px; font-size: 12px; text-align: left; }
  th { background: #f1f5f9; color: #334155; }
  .text-right { text-align: right; }
  .footer { margin-top: 32px; font-size: 11px; color: #64748b; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(config.nombre_asociacion || 'Acueducto Veredal')}</h1>
    ${config.nit ? `<p>NIT: ${escapeHtml(config.nit)}</p>` : ''}
    ${config.direccion ? `<p>${escapeHtml(config.direccion)}</p>` : ''}
    ${config.telefono ? `<p>Tel: ${escapeHtml(config.telefono)}</p>` : ''}
  </div>

  <div class="titulo">Estado de Cuenta</div>

  <div class="info-grid">
    <div>Cuenta: <span>${escapeHtml(cuenta.codigo)}</span></div>
    <div>Dirección: <span>${escapeHtml(cuenta.direccion)}</span></div>
    <div>Propietario: <span>${escapeHtml(propietario?.nombre_completo || 'Sin asignar')}</span></div>
    <div>Identificación: <span>${escapeHtml(propietario?.numero_identificacion || '-')}</span></div>
  </div>

  <div class="resumen">
    <div class="resumen-card">
      <div class="label">Pagado Hasta</div>
      <div class="valor">${estado.pagadoHasta ? estado.pagadoHasta.label : 'Sin pagos'}</div>
    </div>
    <div class="resumen-card">
      <div class="label">Estado</div>
      <div class="valor">${estado.estadoMora === 'En mora'
        ? `En mora (${estado.mesesMora}) — ${estado.motivoMora.map(m => ETIQUETA_MOTIVO_MORA[m]).join(', ')}`
        : 'Al día'}</div>
    </div>
    <div class="resumen-card">
      <div class="label">Total Pagado</div>
      <div class="valor">$${formatNumeroDinero(estado.totalPagado)}</div>
    </div>
    <div class="resumen-card">
      <div class="label">Saldo a Favor</div>
      <div class="valor">$${formatNumeroDinero(estado.saldoAFavor)}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Período</th><th class="text-right">Valor</th><th>Fecha de Pago</th><th>Recibo</th></tr>
    </thead>
    <tbody>
      ${filasHistorial || '<tr><td colspan="4" style="text-align:center; color:#64748b;">Sin pagos registrados</td></tr>'}
    </tbody>
  </table>

  <div class="footer">Documento generado por el sistema administrativo del acueducto el ${formatFechaCorta(new Date().toISOString())}.</div>
</body>
</html>
    `;
  }

  // meses_mora/estado_mora/motivo_mora salen de CarteraService.getIndicadoresMoraTodas
  // (mesesImpagos/deudaAntes2024), NO de pago_periodos ni de un rango (periodo_actual -
  // ultimo_periodo_num): ese rango cuenta todo lo que pasó desde el primer hueco aunque ya se
  // haya puesto al día después (cubiertoHasta se congela ahí a propósito -- caso real R007,
  // 21 meses de rango vs 2 meses de deuda real). Mismo criterio de "en mora" que
  // ReporteService.procesarEstadoCuentas: meses_impagos > 0 O deuda_antes_2024 > 0 (ver
  // docs/superpowers/specs/2026-08-10-fase2-reportes-dashboard-design.md) -- así esta lista y el
  // detalle de cartera de la misma cuenta nunca se contradicen.
  getCuentasConEstado(params) {
    const { page = 1, limit = 10, filtroPago = '' } = params;
    const filas = this.repository.getCuentasConEstado(params);
    const indicadores = new Map(
      this.carteraService.getIndicadoresMoraTodas(filas.map(f => f.id)).map(i => [i.cuentaId, i])
    );

    let procesadas = filas.map(row => {
      const ind = indicadores.get(row.id);
      const pagadoHasta = ind.cubiertoHasta ? this.formatPeriodo(ind.cubiertoHasta.anio, ind.cubiertoHasta.mes) : null;
      const mesesMora = ind.mesesImpagos;
      const deudaAntes2024 = ind.deudaAntes2024;
      const motivoMora = [];
      if (mesesMora > 0) motivoMora.push('meses_corrientes');
      if (deudaAntes2024 > 0) motivoMora.push('deuda_anterior_2024');
      const enMora = motivoMora.length > 0;

      return {
        ...row,
        pagado_hasta: pagadoHasta,
        meses_mora: mesesMora,
        deuda_antes_2024: deudaAntes2024,
        motivo_mora: motivoMora,
        en_mora: enMora,
        estado_mora: enMora ? 'En mora' : 'Al día',
        saldo_favor: row.saldo_favor
      };
    });

    if (filtroPago === 'al_dia') {
      procesadas = procesadas.filter(c => !c.en_mora);
    } else if (filtroPago === 'en_mora') {
      procesadas = procesadas.filter(c => c.en_mora);
    } else if (filtroPago === 'saldo_favor') {
      procesadas = procesadas.filter(c => c.saldo_favor > 0);
    }

    const total = procesadas.length;
    const offset = (page - 1) * limit;
    const data = procesadas.slice(offset, offset + limit);

    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }
}

module.exports = PagoService;
