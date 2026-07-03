const AsientoContableRepository = require('../repositories/AsientoContableRepository');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');
const CuentaAutomaticaRepository = require('../repositories/CuentaAutomaticaRepository');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');
const MotorContabilizacionService = require('./MotorContabilizacionService');
const CajaRepository = require('../repositories/CajaRepository');

// Centavos de tolerancia al comparar sumas de débito/crédito (los valores siempre son pesos
// colombianos sin decimales en este sistema, pero se deja margen por seguridad ante redondeos).
const TOLERANCIA = 0.01;

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(num) {
  return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatFecha(fechaString) {
  const fecha = new Date(fechaString);
  return fecha.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

class AsientoContableService {
  constructor(dbService) {
    this.repository = new AsientoContableRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
    this.cuentaAutomaticaRepository = new CuentaAutomaticaRepository(dbService);
    this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService), dbService);
    this.motorService = new MotorContabilizacionService(dbService);
    this.cajaRepository = new CajaRepository(dbService);
  }

  // Códigos PUC del ancestro de nivel 3 de Caja y de Banco, cacheados para la sesión (evitar un
  // SELECT por cada línea en sincronizarLineaConCajaBanco). Se resuelven a partir del ANCESTRO
  // de nivel 3 de la cuenta automática configurada (no del código exacto de esa cuenta): así,
  // sin importar cuántas subcuentas de detalle existan bajo Caja o Banco (Caja General, Caja
  // Menor, Cuenta Corriente, Cuenta de Ahorros...), todas se reconocen como la misma "familia"
  // de efectivo. Esto es justamente lo que se perdió cuando la migración 029 movió la cuenta
  // automática CAJA del nodo padre '1105' a la hoja '110505': antes, cualquier subcuenta nueva
  // bajo '1105' quedaba cubierta automáticamente por el prefijo; ahora se recalcula subiendo la
  // jerarquía en vez de depender de que el código de la automática sea justo el prefijo correcto.
  // Se invalidan con _codigosCajaBancoCache = null.
  _getCodigosCajaBanco() {
    if (!this._codigosCajaBancoCache) {
      const cajaId = this.cuentaAutomaticaRepository.getCuentaIdByClave('CAJA');
      const bancoId = this.cuentaAutomaticaRepository.getCuentaIdByClave('BANCO');
      const ancestroCaja = cajaId ? this.planCuentaRepository.getAncestroHastaNivel(cajaId, 3) : null;
      const ancestroBanco = bancoId ? this.planCuentaRepository.getAncestroHastaNivel(bancoId, 3) : null;
      this._codigosCajaBancoCache = {
        caja: ancestroCaja ? ancestroCaja.codigo : null,
        banco: ancestroBanco ? ancestroBanco.codigo : null
      };
    }
    return this._codigosCajaBancoCache;
  }

  getAll(params = {}) {
    return this.repository.findAll(params);
  }

  getById(id) {
    return this.repository.findById(id);
  }

  // Documento imprimible de un asiento individual ("Registro Contable"), en el orden que maneja
  // la contadora: nombre de la cuenta, código, débito, crédito.
  generarHTML(id) {
    const asiento = this.repository.findById(id);
    if (!asiento) throw new Error('Asiento no encontrado');

    const config = this.repository.getConfiguracionAsociacion();
    const totalDebito = asiento.lineas.reduce((s, l) => s + l.debito, 0);
    const totalCredito = asiento.lineas.reduce((s, l) => s + l.credito, 0);

    const filasLineas = asiento.lineas.map(l => `
      <tr>
        <td>${escapeHtml(l.cuenta_nombre)}</td>
        <td>${escapeHtml(l.cuenta_codigo)}</td>
        <td class="text-right">${l.debito > 0 ? '$' + formatNumber(l.debito) : ''}</td>
        <td class="text-right">${l.credito > 0 ? '$' + formatNumber(l.credito) : ''}</td>
      </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Registro Contable No. ${asiento.numero}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 32px; color: #1f2937; }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #1e40af; padding-bottom: 16px; }
  .header h1 { color: #1e40af; font-size: 22px; margin: 0 0 6px 0; }
  .header p { font-size: 12px; color: #475569; margin: 2px 0; }
  .registro-numero { text-align: right; font-size: 18px; font-weight: bold; color: #1e40af; margin-bottom: 20px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 24px; font-size: 13px; }
  .info-grid div span { font-weight: bold; color: #334155; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #cbd5e1; padding: 10px 12px; font-size: 13px; text-align: left; }
  th { background: #f1f5f9; color: #334155; }
  .total-row td { font-weight: bold; font-size: 14px; background: #eff6ff; }
  .text-right { text-align: right; }
  .footer { margin-top: 32px; font-size: 11px; color: #64748b; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(config.nombre_asociacion || 'Acueducto Veredal')}</h1>
    ${config.nit ? `<p>NIT: ${escapeHtml(config.nit)}</p>` : ''}
  </div>

  <div class="registro-numero">Registro Contable No. ${asiento.numero}${asiento.estado === 'Anulado' ? ' <span style="color:#dc2626;">— ANULADO</span>' : ''}</div>
  ${asiento.estado === 'Anulado' ? `<p style="color:#dc2626; font-size: 12px; text-align: center; margin: -12px 0 16px 0;">Este registro fue revertido${asiento.motivo_anulacion ? ': ' + escapeHtml(asiento.motivo_anulacion) : ''}</p>` : ''}

  <div class="info-grid">
    <div>Fecha: <span>${formatFecha(asiento.fecha)}</span></div>
    <div>Origen: <span>${escapeHtml(asiento.tipo_origen)}</span></div>
    <div style="grid-column: 1 / -1;">Concepto: <span>${escapeHtml(asiento.concepto)}</span></div>
  </div>

  <table>
    <thead>
      <tr><th>Nombre de la Cuenta Contable</th><th>Código</th><th class="text-right">Débito</th><th class="text-right">Crédito</th></tr>
    </thead>
    <tbody>
      ${filasLineas}
      <tr class="total-row"><td colspan="2">TOTAL</td><td class="text-right">$${formatNumber(totalDebito)}</td><td class="text-right">$${formatNumber(totalCredito)}</td></tr>
    </tbody>
  </table>

  <div class="footer">Documento generado por el sistema administrativo del acueducto.</div>
</body>
</html>
    `;
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

  getBalancePrueba(fechaDesde = '', fechaHasta = '', tipoCuenta = '') {
    const filas = this.repository.getBalancePrueba(fechaDesde, fechaHasta, tipoCuenta).map(c => ({
      ...c,
      saldo: c.naturaleza === 'Debito' ? (c.total_debito - c.total_credito) : (c.total_credito - c.total_debito)
    }));

    const totalDebito = filas.reduce((s, f) => s + f.total_debito, 0);
    const totalCredito = filas.reduce((s, f) => s + f.total_credito, 0);

    return { filas, totalDebito, totalCredito, balanceado: Math.abs(totalDebito - totalCredito) < TOLERANCIA };
  }

  // A diferencia del Balance de Prueba general (que no tiene "saldo inicial", solo totales del
  // período), aquí sí hace falta: para saber el saldo que trae un tercero al empezar el rango
  // consultado. Por eso fechaDesde y fechaHasta son obligatorios.
  getBalancePruebaPorTercero(filtros = {}) {
    const { fechaDesde, fechaHasta } = filtros;
    if (!fechaDesde || !fechaHasta) throw new Error('Debe indicar el rango de fechas (año fiscal y meses) para este reporte');

    return this.repository.getBalancePruebaPorTercero(filtros).map(f => {
      const esDebito = f.naturaleza === 'Debito';
      const saldoInicial = esDebito ? (f.debito_anterior - f.credito_anterior) : (f.credito_anterior - f.debito_anterior);
      const saldoFinal = esDebito
        ? saldoInicial + (f.debito_periodo - f.credito_periodo)
        : saldoInicial + (f.credito_periodo - f.debito_periodo);

      return {
        ...f,
        saldo_inicial: saldoInicial,
        movimiento_debito: f.debito_periodo,
        movimiento_credito: f.credito_periodo,
        saldo_final: saldoFinal
      };
    });
  }

  getLibroDiario(fechaDesde = '', fechaHasta = '', tipoCuenta = '') {
    return this.repository.getLibroDiario(fechaDesde, fechaHasta, tipoCuenta);
  }

  // Valida que las líneas sean correctas (cuentas imputables y activas, cada línea tiene
  // exactamente un lado, y los totales cuadran) y crea el asiento. Es el único punto de entrada
  // que de verdad inserta un asiento: tanto la generación automática como el asiento manual
  // pasan por aquí.
  //
  // sincronizarLedgerSimple: la generación automática (Gasto/Recibo/Movimiento) ya crea su propia
  // fila en la tabla `movimientos` (el ledger simple de caja/banco que usan el Dashboard y el
  // módulo de Caja) ANTES de llegar aquí, así que no hay que duplicarla. Pero una nota contable
  // manual que afecte Caja o Bancos (p.ej. registrar el saldo inicial al migrar al sistema, o un
  // ajuste por una comisión bancaria) solo pasa por aquí, y si no se replica en `movimientos` el
  // saldo de caja/banco que muestra el resto de la app quedaría desincronizado del Balance de
  // Prueba. Por eso solo se activa para asientos manuales (y sus reversiones).
  crear({ fecha, concepto, tipoOrigen, tipoComprobante = null, referenciaId = null, referenciaTipo = null, usuarioId = null, lineas, sincronizarLedgerSimple = false }) {
    if (!fecha) throw new Error('La fecha del asiento es obligatoria');
    if (!concepto || !concepto.trim()) throw new Error('El concepto del asiento es obligatorio');
    if (!Array.isArray(lineas) || lineas.length < 2) throw new Error('Un asiento debe tener al menos 2 líneas');

    // Verifica que el período contable de la fecha esté Abierto.
    // Si el período no existe aún se crea automáticamente como Abierto.
    // Las reversiones (tipoOrigen = 'Reversion') siempre usan la fecha actual (hoy),
    // que normalmente es un período Abierto; si también está Cerrado/Bloqueado el
    // administrador deberá reabrirlo antes de continuar.
    this.periodoContableService.validarFechaPermitida(fecha);

    let totalDebito = 0;
    let totalCredito = 0;
    const cuentasPorLinea = [];

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
      cuentasPorLinea.push(cuenta);
    }

    if (Math.abs(totalDebito - totalCredito) >= TOLERANCIA) {
      throw new Error(`El asiento no está balanceado: débito $${totalDebito.toLocaleString('es-CO')} vs crédito $${totalCredito.toLocaleString('es-CO')}`);
    }

    return this.repository.transaccion(() => {
      const numero = this.repository.getConsecutivo();
      this.repository.incrementarConsecutivo(numero + 1);

      const asientoId = this.repository.crear({ numero, fecha, concepto, tipoOrigen, tipoComprobante, referenciaId, referenciaTipo, usuarioId, lineas });

      if (sincronizarLedgerSimple) {
        lineas.forEach((linea, i) => this.sincronizarLineaConCajaBanco(cuentasPorLinea[i], linea, fecha, concepto, asientoId));
      }

      return asientoId;
    });
  }

  // Si la cuenta de una línea es Caja o Banco (según cuentas_automaticas), refleja ese mismo
  // movimiento en la tabla `movimientos` para que el saldo que ve el resto de la app (Dashboard,
  // Caja/Banco) coincida con el de la contabilidad de doble partida. La detección se hace por
  // prefijo de código: si el código PUC de la cuenta empieza por el código configurado en
  // cuentas_automaticas, cubre también todas las subcuentas auxiliares bajo ese nodo.
  sincronizarLineaConCajaBanco(cuenta, linea, fecha, concepto, asientoId) {
    const { caja, banco } = this._getCodigosCajaBanco();
    const esCaja = caja && cuenta.codigo.startsWith(caja);
    const esBanco = banco && cuenta.codigo.startsWith(banco);
    if (!esCaja && !esBanco) return;

    const debito = Number(linea.debito || 0);
    this.repository.crearMovimientoSimple({
      tipo: debito > 0 ? 'Ingreso' : 'Egreso',
      origen: esCaja ? 'Caja' : 'Banco',
      monto: debito > 0 ? debito : Number(linea.credito || 0),
      concepto,
      referenciaId: asientoId,
      referenciaTipo: 'Asiento',
      fechaMovimiento: fecha
    });
  }

  // Compara, para Caja y para Banco, el saldo del libro simple (tabla `movimientos`, la fuente
  // del Dashboard y de la pantalla de Caja) contra el saldo de la cuenta de doble partida
  // correspondiente (incluidas todas sus subcuentas). Si difieren, algo quedó desincronizado
  // entre los dos libros — ver hallazgo Alto A-9 de la auditoría de Contabilidad (2026-07-03).
  // Pensado para invocarse desde una pantalla de diagnóstico o, como aquí, desde pruebas
  // automatizadas que protejan contra que el defecto vuelva a aparecer.
  verificarConciliacionCajaBanco() {
    const { caja: codigoCaja, banco: codigoBanco } = this._getCodigosCajaBanco();
    const resultado = [];

    if (codigoCaja) {
      const cuentaCaja = this.planCuentaRepository.findByCodigo(codigoCaja);
      resultado.push(this._compararSaldoLedgers(
        'Caja',
        this.cajaRepository.getSaldoCaja(),
        this.repository.getSaldoConSubcuentas(cuentaCaja.id)
      ));
    }
    if (codigoBanco) {
      const cuentaBanco = this.planCuentaRepository.findByCodigo(codigoBanco);
      resultado.push(this._compararSaldoLedgers(
        'Banco',
        this.cajaRepository.getSaldoBanco(),
        this.repository.getSaldoConSubcuentas(cuentaBanco.id)
      ));
    }
    return resultado;
  }

  _compararSaldoLedgers(nombreCuenta, saldoLedgerSimple, saldoDoblePartida) {
    const diferencia = Math.round((saldoLedgerSimple - saldoDoblePartida) * 100) / 100;
    return {
      cuenta: nombreCuenta,
      saldoLedgerSimple,
      saldoDoblePartida,
      diferencia,
      conciliado: Math.abs(diferencia) < 1
    };
  }

  // Asiento manual, para todo lo que la generación automática no cubre (ajustes financieros,
  // depreciaciones, correcciones, partidas de apertura, etc).
  crearManual({ fecha, concepto, tipoComprobante = 'Asiento Contable', lineas, usuarioId = null, sincronizarLedgerSimple = true }) {
    return this.crear({ fecha, concepto, tipoOrigen: 'Manual', tipoComprobante, usuarioId, lineas, sincronizarLedgerSimple });
  }

  // --- Generación automática a partir de procesos existentes ---
  // Cada uno lee datos que YA quedaron guardados al registrar el gasto/recibo/movimiento
  // (incluida la cuenta contable, resuelta desde la migración 006), así que si más adelante
  // cambia cómo se clasifica un concepto, esta lógica no necesita tocarse.

  generarDesdeGasto(gastoId, usuarioId = null) {
    const contexto = this.repository.obtenerGastoParaAsiento(gastoId);
    if (!contexto) throw new Error('Gasto no encontrado para generar el asiento contable');
    if (!contexto.cuenta_contable_id) throw new Error('El gasto no tiene una cuenta contable asignada');

    const subtipo   = this.motorService.resolverSubtipo('Gasto', contexto);
    const plantilla = this.motorService.resolverPlantilla('Gasto', subtipo, contexto.fecha);
    const lineas    = this.motorService.generarLineas(plantilla, contexto);

    return this.crear({
      fecha: contexto.fecha,
      concepto: `Gasto: ${contexto.concepto}`,
      tipoOrigen: 'Gasto',
      referenciaId: gastoId,
      referenciaTipo: 'Gasto',
      usuarioId,
      lineas
    });
  }

  generarDesdeRecibo(reciboId, usuarioId = null) {
    const contexto = this.repository.obtenerReciboParaAsiento(reciboId);
    if (!contexto) throw new Error('Recibo no encontrado para generar el asiento contable');

    const detallesConValor = (contexto.detalles || []).filter(d => d.valor !== 0);
    if (detallesConValor.length === 0) return null;
    if (detallesConValor.some(d => !d.cuenta_contable_id)) {
      throw new Error('Uno de los renglones del recibo no tiene una cuenta contable asignada');
    }

    // El motor procesa detalles ya con valor != 0; pasamos el contexto completo con
    // el subconjunto filtrado para que PorSigno funcione sobre los valores originales.
    const contextoFiltrado = { ...contexto, detalles: detallesConValor };

    const subtipo   = this.motorService.resolverSubtipo('Recibo', contextoFiltrado);
    const plantilla = this.motorService.resolverPlantilla('Recibo', subtipo, contextoFiltrado.fecha);
    const lineas    = this.motorService.generarLineas(plantilla, contextoFiltrado);

    if (lineas.length < 2) return null;

    return this.crear({
      fecha: contextoFiltrado.fecha,
      concepto: `Recibo No. ${contextoFiltrado.numero_recibo}`,
      tipoOrigen: 'Recibo',
      referenciaId: reciboId,
      referenciaTipo: 'Recibo',
      usuarioId,
      lineas
    });
  }

  generarDesdeMovimientoTraslado(movimientoId, usuarioId = null) {
    const contexto = this.repository.obtenerMovimientoParaAsiento(movimientoId);
    if (!contexto) throw new Error('Movimiento no encontrado para generar el asiento contable');
    if (contexto.tipo !== 'Traslado') throw new Error('Solo los movimientos de tipo Traslado generan este asiento');

    const plantilla = this.motorService.resolverPlantilla('Movimiento', 'Traslado', contexto.fecha);
    const lineas    = this.motorService.generarLineas(plantilla, contexto);

    return this.crear({
      fecha: contexto.fecha,
      concepto: contexto.concepto,
      tipoOrigen: 'Movimiento',
      referenciaId: movimientoId,
      referenciaTipo: 'Movimiento',
      usuarioId,
      lineas
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
      // Si el asiento original era una nota contable manual que afectaba Caja/Banco, su reversión
      // también debe reflejarse ahí (ver crear()). Si era de Gasto/Recibo/Movimiento, el Service
      // que pidió la reversión (GastoService.anular, ReciboService.anular) ya crea su propia
      // contrapartida en `movimientos`, así que no se duplica aquí.
      //
      // Excepción: un Reembolso de Caja Menor es 'Manual' pero se creó a propósito con
      // sincronizarLedgerSimple=false (es un traslado interno Caja General <-> Caja Menor que no
      // cambia el efectivo total). Si su reversión sincronizara, el lado Caja General de la
      // reversión SÍ calzaría con el prefijo de detección de "Caja" (a diferencia del lado Caja
      // Menor, que ya no coincide desde que CAJA automática apunta a la subcuenta hoja 110505),
      // generando una fila fantasma de Ingreso sin contrapartida. Se detecta por tipo_comprobante,
      // el único campo que distingue este caso de una nota manual real que sí debe sincronizar.
      const esReversionDeReembolsoCajaMenor = asiento.tipo_origen === 'Manual' && asiento.tipo_comprobante === 'Reembolso Caja Menor';
      const reversionId = this.crear({
        fecha: new Date().toISOString().split('T')[0],
        concepto: `Reversión: ${asiento.concepto}`,
        tipoOrigen: 'Reversion',
        tipoComprobante: asiento.tipo_comprobante,
        referenciaId: asiento.id,
        referenciaTipo: 'Asiento',
        usuarioId,
        sincronizarLedgerSimple: asiento.tipo_origen === 'Manual' && !esReversionDeReembolsoCajaMenor,
        lineas: asiento.lineas.map(l => ({
          cuentaContableId: l.cuenta_id,
          debito: l.credito,
          credito: l.debito,
          terceroIdentificacion: l.tercero_identificacion,
          terceroNombre: l.tercero_nombre,
          terceroId: l.tercero_id || null,
          propietarioId: l.propietario_id || null
        }))
      });

      this.repository.marcarAnulado(asiento.id, motivo, reversionId);

      return reversionId;
    });
  }

  // Punto de entrada directo (usado por la pantalla de Asientos / canal IPC asientos:revertir):
  // a diferencia de revertir(), SOLO acepta revertir notas contables manuales. Un asiento
  // generado automáticamente (Gasto/Recibo/Movimiento) o uno que ya es en sí mismo una reversión
  // debe deshacerse desde su propio módulo (anular el gasto/recibo/traslado, que internamente
  // llama a revertir() vía revertirPorReferencia() y sí coordina correctamente TANTO la doble
  // partida como el libro simple `movimientos` y el estado del documento origen). Revertir aquí
  // directamente un asiento automático solo actualizaba la doble partida, dejando el "Saldo en
  // Caja/Banco" del Dashboard sin revertir y el documento origen con estado "Activo" pese a que
  // su único asiento quedaba "Anulado" (hallazgo Alto A-8 de la auditoría de Contabilidad,
  // 2026-07-03). La restricción vive aquí y NO en revertir() para no bloquear el uso interno de
  // revertirPorReferencia() que GastoService.anular()/ReciboService.anular() sí necesitan.
  revertirManual(asientoId, motivo, usuarioId = null) {
    const asiento = this.repository.findById(asientoId);
    if (!asiento) throw new Error('Asiento no encontrado');
    if (asiento.tipo_origen !== 'Manual') {
      const nombreModulo = { Gasto: 'Gastos', Recibo: 'Recibos', Movimiento: 'Caja', Reversion: null }[asiento.tipo_origen];
      throw new Error(
        nombreModulo
          ? `Este asiento se generó automáticamente y debe anularse desde el módulo de ${nombreModulo}, no revertirse aquí directamente.`
          : `Un asiento de Reversión no se puede revertir directamente; si necesita deshacer su efecto, anule el documento original.`
      );
    }
    return this.revertir(asientoId, motivo, usuarioId);
  }
}

module.exports = AsientoContableService;
