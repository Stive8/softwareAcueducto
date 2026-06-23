const AsientoContableRepository = require('../repositories/AsientoContableRepository');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');

// Centavos de tolerancia al comparar sumas de débito/crédito (los valores siempre son pesos
// colombianos sin decimales en este sistema, pero se deja margen por seguridad ante redondeos).
const TOLERANCIA = 0.01;

class AsientoContableService {
  constructor(dbService) {
    this.repository = new AsientoContableRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
  }

  getAll(params = {}) {
    return this.repository.findAll(params);
  }

  getById(id) {
    return this.repository.findById(id);
  }

  getLibroMayor(cuentaContableId, fechaDesde = '', fechaHasta = '') {
    const cuenta = this.planCuentaRepository.findById(cuentaContableId);
    if (!cuenta) throw new Error('Cuenta contable no encontrada');

    const movimientos = this.repository.getMovimientosPorCuenta(cuentaContableId, fechaDesde, fechaHasta);

    let saldo = 0;
    const conSaldo = movimientos.map(m => {
      saldo += cuenta.naturaleza === 'Debito' ? (m.debito - m.credito) : (m.credito - m.debito);
      return { ...m, saldo };
    });

    return { cuenta, movimientos: conSaldo, saldoFinal: saldo };
  }

  getBalancePrueba(fechaDesde = '', fechaHasta = '') {
    const filas = this.repository.getBalancePrueba(fechaDesde, fechaHasta).map(c => ({
      ...c,
      saldo: c.naturaleza === 'Debito' ? (c.total_debito - c.total_credito) : (c.total_credito - c.total_debito)
    }));

    const totalDebito = filas.reduce((s, f) => s + f.total_debito, 0);
    const totalCredito = filas.reduce((s, f) => s + f.total_credito, 0);

    return { filas, totalDebito, totalCredito, balanceado: Math.abs(totalDebito - totalCredito) < TOLERANCIA };
  }

  getLibroDiario(fechaDesde = '', fechaHasta = '') {
    return this.repository.getLibroDiario(fechaDesde, fechaHasta);
  }

  // Valida que las líneas sean correctas (cuentas imputables y activas, cada línea tiene
  // exactamente un lado, y los totales cuadran) y crea el asiento. Es el único punto de entrada
  // que de verdad inserta un asiento: tanto la generación automática como el asiento manual
  // pasan por aquí.
  crear({ fecha, concepto, tipoOrigen, referenciaId = null, referenciaTipo = null, usuarioId = null, lineas }) {
    if (!fecha) throw new Error('La fecha del asiento es obligatoria');
    if (!concepto || !concepto.trim()) throw new Error('El concepto del asiento es obligatorio');
    if (!Array.isArray(lineas) || lineas.length < 2) throw new Error('Un asiento debe tener al menos 2 líneas');

    let totalDebito = 0;
    let totalCredito = 0;

    for (const linea of lineas) {
      const debito = Number(linea.debito || 0);
      const credito = Number(linea.credito || 0);

      if (!linea.cuentaContableId) throw new Error('Toda línea del asiento debe tener una cuenta contable');
      if ((debito > 0 && credito > 0) || (debito === 0 && credito === 0)) {
        throw new Error('Cada línea del asiento debe tener un valor en débito o en crédito, no ambos ni ninguno');
      }

      const cuenta = this.planCuentaRepository.findById(linea.cuentaContableId);
      if (!cuenta) throw new Error('Una de las cuentas contables del asiento no existe');
      if (!cuenta.activo) throw new Error(`La cuenta "${cuenta.nombre}" está inactiva y no admite movimientos`);
      if (this.planCuentaRepository.tieneHijos(cuenta.id)) {
        throw new Error(`La cuenta "${cuenta.nombre}" es de agrupación (tiene subcuentas) y no admite movimientos directos`);
      }

      totalDebito += debito;
      totalCredito += credito;
    }

    if (Math.abs(totalDebito - totalCredito) >= TOLERANCIA) {
      throw new Error(`El asiento no está balanceado: débito $${totalDebito.toLocaleString('es-CO')} vs crédito $${totalCredito.toLocaleString('es-CO')}`);
    }

    return this.repository.transaccion(() => {
      const numero = this.repository.getConsecutivo();
      this.repository.incrementarConsecutivo(numero + 1);

      return this.repository.crear({ numero, fecha, concepto, tipoOrigen, referenciaId, referenciaTipo, usuarioId, lineas });
    });
  }

  // Asiento manual, para todo lo que la generación automática no cubre (ajustes financieros,
  // depreciaciones, correcciones, partidas de apertura, etc).
  crearManual({ fecha, concepto, lineas, usuarioId = null }) {
    return this.crear({ fecha, concepto, tipoOrigen: 'Manual', usuarioId, lineas });
  }

  // --- Generación automática a partir de procesos existentes ---
  // Cada uno lee datos que YA quedaron guardados al registrar el gasto/recibo/movimiento
  // (incluida la cuenta contable, resuelta desde la migración 006), así que si más adelante
  // cambia cómo se clasifica un concepto, esta lógica no necesita tocarse.

  generarDesdeGasto(gastoId, usuarioId = null) {
    const gasto = this.repository.obtenerGastoParaAsiento(gastoId);
    if (!gasto) throw new Error('Gasto no encontrado para generar el asiento contable');
    if (!gasto.cuenta_contable_id) throw new Error('El gasto no tiene una cuenta contable asignada');

    const cuentaCajaBanco = this.repository.resolverCuentaContable('Movimiento', gasto.metodo_pago === 'Efectivo' ? 'Caja' : 'Banco');
    if (!cuentaCajaBanco) throw new Error('No hay una cuenta contable mapeada para Caja/Banco');

    return this.crear({
      fecha: gasto.fecha,
      concepto: `Gasto: ${gasto.concepto}`,
      tipoOrigen: 'Gasto',
      referenciaId: gastoId,
      referenciaTipo: 'Gasto',
      usuarioId,
      lineas: [
        { cuentaContableId: gasto.cuenta_contable_id, debito: gasto.valor },
        { cuentaContableId: cuentaCajaBanco, credito: gasto.valor }
      ]
    });
  }

  // Un recibo puede tener varios renglones (meses de sostenimiento, abono a conexión,
  // aplicación de saldo a favor) cobrados en un solo movimiento de caja/banco. Cada renglón
  // positivo es un crédito a su cuenta (normalmente un ingreso); uno negativo (como la
  // aplicación de saldo a favor, que no es un ingreso nuevo sino el uso de algo ya cobrado
  // antes) se registra como débito por su valor absoluto. La suma de las dos cosas siempre
  // coincide con el total del recibo, que es lo que entra a caja o banco.
  generarDesdeRecibo(reciboId, usuarioId = null) {
    const recibo = this.repository.obtenerReciboParaAsiento(reciboId);
    if (!recibo) throw new Error('Recibo no encontrado para generar el asiento contable');

    const detallesConValor = recibo.detalles.filter(d => d.valor !== 0);
    if (detallesConValor.length === 0) return null;
    if (detallesConValor.some(d => !d.cuenta_contable_id)) {
      throw new Error('Uno de los renglones del recibo no tiene una cuenta contable asignada');
    }

    const lineas = detallesConValor.map(d => d.valor >= 0
      ? { cuentaContableId: d.cuenta_contable_id, credito: d.valor }
      : { cuentaContableId: d.cuenta_contable_id, debito: -d.valor }
    );

    // El total cobrado en efectivo/banco puede ser menor a la suma de los renglones (si parte
    // se cubrió con saldo a favor) o incluso cero (si se cubrió todo con saldo a favor): en ese
    // caso no hay línea de Caja/Banco, y los renglones del recibo ya quedan balanceados entre sí.
    if (recibo.total > 0) {
      const cuentaCajaBanco = this.repository.resolverCuentaContable('Movimiento', recibo.metodo_pago === 'Efectivo' ? 'Caja' : 'Banco');
      if (!cuentaCajaBanco) throw new Error('No hay una cuenta contable mapeada para Caja/Banco');
      lineas.push({ cuentaContableId: cuentaCajaBanco, debito: recibo.total });
    }

    if (lineas.length < 2) return null;

    return this.crear({
      fecha: recibo.fecha,
      concepto: `Recibo No. ${recibo.numero_recibo}`,
      tipoOrigen: 'Recibo',
      referenciaId: reciboId,
      referenciaTipo: 'Recibo',
      usuarioId,
      lineas
    });
  }

  // Traslado de caja a banco (consignación): no hay ingreso ni gasto real, solo cambia dónde
  // está la plata, así que ambos lados son las mismas dos cuentas de Disponible.
  generarDesdeMovimientoTraslado(movimientoId, usuarioId = null) {
    const movimiento = this.repository.obtenerMovimientoParaAsiento(movimientoId);
    if (!movimiento) throw new Error('Movimiento no encontrado para generar el asiento contable');
    if (movimiento.tipo !== 'Traslado') throw new Error('Solo los movimientos de tipo Traslado generan este asiento');

    const cuentaOrigen = this.repository.resolverCuentaContable('Movimiento', movimiento.origen);
    const cuentaDestino = this.repository.resolverCuentaContable('Movimiento', movimiento.destino);
    if (!cuentaOrigen || !cuentaDestino) throw new Error('No hay cuentas contables mapeadas para el traslado');

    return this.crear({
      fecha: movimiento.fecha,
      concepto: movimiento.concepto,
      tipoOrigen: 'Movimiento',
      referenciaId: movimientoId,
      referenciaTipo: 'Movimiento',
      usuarioId,
      lineas: [
        { cuentaContableId: cuentaDestino, debito: movimiento.monto },
        { cuentaContableId: cuentaOrigen, credito: movimiento.monto }
      ]
    });
  }

  // Revierte el asiento activo asociado a una referencia (un gasto o recibo anulado), creando
  // un nuevo asiento con las líneas invertidas y enlazando ambos. El asiento original nunca se
  // borra ni se modifica: queda como estaba, marcado "Anulado" solo para que sea fácil ubicarlo
  // en pantalla, pero su efecto numérico se neutraliza por el de la reversión.
  revertirPorReferencia(referenciaTipo, referenciaId, motivo, usuarioId = null) {
    const asiento = this.repository.findByReferenciaActiva(referenciaTipo, referenciaId);
    if (!asiento) return null; // no había asiento (p.ej. registros previos a esta funcionalidad)

    return this.revertir(asiento.id, motivo, usuarioId);
  }

  revertir(asientoId, motivo, usuarioId = null) {
    const asiento = this.repository.findById(asientoId);
    if (!asiento) throw new Error('Asiento no encontrado');
    if (asiento.estado === 'Anulado') throw new Error('Este asiento ya fue revertido');
    if (!motivo || !motivo.trim()) throw new Error('Debe indicar el motivo de la reversión');

    return this.repository.transaccion(() => {
      const reversionId = this.crear({
        fecha: new Date().toISOString().split('T')[0],
        concepto: `Reversión: ${asiento.concepto}`,
        tipoOrigen: 'Reversion',
        referenciaId: asiento.id,
        referenciaTipo: 'Asiento',
        usuarioId,
        lineas: asiento.lineas.map(l => ({
          cuentaContableId: l.cuenta_id,
          debito: l.credito,
          credito: l.debito
        }))
      });

      this.repository.marcarAnulado(asiento.id, motivo, reversionId);

      return reversionId;
    });
  }
}

module.exports = AsientoContableService;
