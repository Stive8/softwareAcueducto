const CarteraRepository = require('../repositories/CarteraRepository');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PagoRepository = require('../repositories/PagoRepository');
const NuevoPuntoRepository = require('../repositories/NuevoPuntoRepository');
const { codificarPeriodo, decodificarPeriodo, anioMesDeFecha, primerDiaDelMes, diaAnterior } =
  require('./cartera/periodos');
const { MODOS, distribuir, calcularCubiertoHasta, calcularAlDiaHasta } = require('./cartera/imputacion');
const { redondear, esMayor } = require('./cartera/dinero');
const { getMotivoDiferencia } = require('./cartera/motivosDiferencia');

// La cartera de un asociado como cuenta corriente en dinero.
//
// Deuda exigible = suma de los movimientos exigibles (cargos positivos, abonos negativos).
// Saldo opaco   = suma de los no exigibles: la deuda anterior al 01/01/2022, que se muestra
//                 pero no se cobra porque no hay con qué sustentarla.
//
// La causación NO genera asientos contables: el ingreso se sigue reconociendo al recaudar.
// Eso es lo que permite corregir meses de períodos ya cerrados sin reexpresar nada.
class CarteraService {
  constructor(dbService) {
    this.db = dbService.getDb();
    this.repository = new CarteraRepository(dbService);
    this.estadoRepository = new CuentaEstadoRepository(dbService);
    this.periodoContableRepository = new PeriodoContableRepository(dbService);
    this.pagoRepository = new PagoRepository(dbService);
    this.nuevoPuntoRepository = new NuevoPuntoRepository(dbService);
  }

  // Ancla de facturación: cuándo EMPEZÓ A FACTURARSE la cuenta, no cuándo pagó por primera vez
  // (el pago es consecuencia, no causa). Prioridad:
  //   1. Primer CargoMensual en cartera_movimientos -- es la fuente de verdad de cuándo se
  //      empezó a causar sostenimiento, exista o no un pago encima.
  //   2. Si no hay cargos causados todavía: el período más antiguo en pago_periodos (archivo
  //      histórico de la migración, ver README -- única lectura de esa tabla que queda en el
  //      flujo activo, a propósito). Es una señal más precisa que la fecha de emisión del
  //      recibo: un recibo puede emitirse mucho después del período que cubre (pago atrasado/
  //      retroactivo pagado todo junto, ej. PagoService.registrarPagoSostenimiento cobrando en
  //      abril tres meses de enero-marzo), pero el período elegido sigue siendo el mes real
  //      desde el que la cuenta se factura.
  //   3. Si tampoco hay pago_periodos: primer recibo (aproximación -- casi toda cuenta con
  //      historial real ha pagado alguna vez, pero conceptualmente es un sustituto; hay recibos
  //      reales, ej. abonos a deuda o a punto de conexión, que nunca se atribuyen a un mes
  //      concreto y por eso no aparecen en pago_periodos). Excluye los recibos anulados: un
  //      recibo anulado nunca representó un cobro real. A propósito NO se usa
  //      cuenta_categorias.fecha_inicio como fallback intermedio acá: una categoría puede
  //      asignarse administrativamente mucho antes de que la cuenta factura de verdad (caso
  //      real: categoría de 2020, primer recibo real de 2024) -- usarla correría la ancla hacia
  //      atrás y generaría años de mora que nunca existió (verificado 2026-08-11 contra 22
  //      cuentas reales que dependen de esta prioridad o la siguiente).
  //   4. Si no hay cargos, ni pago_periodos, ni recibos (cuenta recién dada de alta, sin nada
  //      facturado aún): fecha_creacion de la cuenta. Nota: en cuentas migradas desde el
  //      talonario físico esto es la fecha del lote de importación, no una fecha de alta real
  //      -- solo es correcto para cuentas nuevas creadas una por una desde la app.
  getFechaInicioFacturacion(cuentaId) {
    const cargo = this.db.prepare(`
      SELECT MIN(fecha) AS f FROM cartera_movimientos
      WHERE cuenta_id = ? AND tipo = 'CargoMensual'
    `).get(cuentaId);
    if (cargo && cargo.f) return String(cargo.f).split(' ')[0];

    const periodo = this.db.prepare(`
      SELECT MIN(anio * 12 + (mes - 1)) AS cod FROM pago_periodos WHERE cuenta_id = ?
    `).get(cuentaId);
    if (periodo && periodo.cod !== null) {
      const { anio, mes } = decodificarPeriodo(periodo.cod);
      return primerDiaDelMes(anio, mes);
    }

    const recibo = this.db.prepare(`
      SELECT MIN(fecha_recibo) AS f FROM recibos
      WHERE cuenta_id = ? AND estado != 'Anulado'
    `).get(cuentaId);
    if (recibo && recibo.f) return String(recibo.f).split(' ')[0];

    const cuenta = this.db.prepare(`SELECT fecha_creacion AS f FROM cuentas WHERE id = ?`).get(cuentaId);
    return cuenta && cuenta.f ? String(cuenta.f).split(' ')[0] : null;
  }

  // Estado del período contable de un mes, o null si el período todavía no existe (en ese
  // caso se trata como abierto: los períodos se crean sobre la marcha al primer movimiento).
  estadoPeriodoContable(anio, mes) {
    const fila = this.periodoContableRepository.getByAnioMes(anio, mes);
    return fila ? fila.estado : null;
  }

  // Inserta los CargoMensual que falten hasta el mes indicado. Idempotente: el índice único
  // parcial idx_cartera_cargo_unico impide duplicar un mes, y además se consulta antes.
  //
  // No admite ningún parámetro para saltarse el bloqueo de períodos contables: la carga
  // inicial (que sí necesita escribir en el pasado) va por el script de migración, no por acá.
  //
  // desdeMinimo (opcional) es una cota inferior explícita, para cuando el LLAMADOR ya sabe con
  // certeza que hay que causar desde ahí -- caso real: PagoService.registrarPagoSostenimiento
  // cobrando el primer pago retroactivo de una cuenta nueva (ej. cobra en abril tres meses de
  // enero-marzo). getFechaInicioFacturacion no puede adivinar eso todavía: en ese momento la
  // cuenta no tiene cargo, ni pago_periodos, ni ningún recibo ANTERIOR a este mismo pago, así
  // que caía en fecha_creacion o en el propio recibo que se está creando (fechado en abril, no
  // en enero) -- la ancla quedaba DESPUÉS de los meses que había que cobrar y no causaba nada
  // (caso real de prueba, 2026-08-11). No se resuelve ampliando la prioridad de
  // getFechaInicioFacturacion (ver su comentario) porque esa función sirve a más llamadores para
  // los que una cota más temprana sería incorrecta -- acá el llamador ya validó (vía
  // construirPeriodos) que esos meses son cobrables, así que puede pedir la cota con seguridad.
  asegurarCausacion(cuentaId, hastaAnio, hastaMes, desdeMinimo = null) {
    const omitidos = [];
    const ancla = this.getFechaInicioFacturacion(cuentaId);
    if (!ancla && !desdeMinimo) {
      omitidos.push({ anio: null, mes: null, motivo: 'La cuenta no tiene recibos: sin ancla de facturación no se puede causar' });
      return { creados: 0, omitidos };
    }

    let desdeCod = ancla
      ? codificarPeriodo(anioMesDeFecha(ancla).anio, anioMesDeFecha(ancla).mes)
      : Infinity;
    if (desdeMinimo) {
      const desdeMinimoCod = codificarPeriodo(desdeMinimo.anio, desdeMinimo.mes);
      if (desdeMinimoCod < desdeCod) desdeCod = desdeMinimoCod;
    }
    const hastaCod = codificarPeriodo(hastaAnio, hastaMes);
    const yaCausados = this.repository.getMesesCausados(cuentaId);

    let creados = 0;
    this.repository.transaccion(() => {
      for (let cod = desdeCod; cod <= hastaCod; cod++) {
        const { anio, mes } = decodificarPeriodo(cod);
        if (yaCausados.has(cod)) continue;

        const estado = this.estadoRepository.estadoEnMes(cuentaId, anio, mes);
        if (estado !== 'Activo') {
          omitidos.push({ anio, mes, motivo: `La cuenta estaba ${estado} en ese mes` });
          continue;
        }

        const estadoPeriodo = this.estadoPeriodoContable(anio, mes);
        if (estadoPeriodo && estadoPeriodo !== 'Abierto') {
          omitidos.push({ anio, mes, motivo: `El período contable está ${estadoPeriodo}` });
          continue;
        }

        const tarifa = this.pagoRepository.getCategoriaTarifaParaMes(cuentaId, anio, mes);
        if (!tarifa) {
          omitidos.push({ anio, mes, motivo: 'No hay categoría o tarifa configurada para ese mes' });
          continue;
        }

        this.repository.crearMovimiento({
          cuentaId,
          fecha: primerDiaDelMes(anio, mes),
          tipo: 'CargoMensual',
          exigible: 1,
          monto: tarifa.tarifa_sostenimiento,
          anio, mes
        });
        creados++;
      }
    });

    return { creados, omitidos };
  }

  // Registra plata recibida y la imputa contra los cargos según el modo. Los cuatro modos
  // llenan cargos con la misma mecánica; lo único que cambia es contra cuáles.
  //
  // Lo que no alcanza a imputarse NO queda como saldo a favor implícito (un exigible
  // negativo): el Abono en cartera_movimientos se recorta a lo realmente imputado, y el
  // sobrante se registra aparte en cuenta_creditos como 'Abono' sin aplicar. Esto es a
  // propósito: la cifra principal de la cuenta no puede bajar sola porque alguien pagó de
  // más sin decir para qué -- alguien tiene que decidir redimirlo (ver redimirCredito).
  // Si el modo es ANTICIPO (o cualquier otro deja todo sin imputar), no se crea ningún
  // movimiento: el monto entero es crédito.
  //
  // TODO antes de conectar esto a IPC (todavía no lo está, ver main.js): en modo
  // AbonoDeudaFIFO no llama a asegurarCausacion antes de imputar contra getCargosPendientes,
  // a diferencia de redimirCredito (que sí lo hace desde 2026-08-11). Si el mes en curso
  // todavía no tiene su CargoMensual real, el FIFO lo salta -- calcularAPagar seguiría
  // mostrándolo como pendiente aunque haya plata suficiente (mismo caso real R007 que motivó
  // el fix en redimirCredito). Auditoría de entrega 2026-08-11, hallazgo 7 -- ver
  // docs/deuda-tecnica-auditoria-2026-08-11.md.
  registrarAbono({ cuentaId, fecha, monto, modo, cargosElegidos = [],
    reciboDetalleId = null, observaciones = null, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!fecha) throw new Error('La fecha del abono es obligatoria');
    if (!(Number(monto) > 0)) throw new Error('El monto del abono debe ser mayor a cero');
    if (!Object.values(MODOS).includes(modo)) throw new Error(`Modo de imputación inválido: ${modo}`);
    if (modo === MODOS.MESES_ESPECIFICOS && cargosElegidos.length === 0) {
      throw new Error('Debe elegir al menos un mes a cubrir');
    }

    const esOpaco = modo === MODOS.ABONO_SALDO_OPACO;
    const exigible = esOpaco ? 0 : 1;

    if (esOpaco) {
      const { saldoOpaco } = this.repository.getSaldos(cuentaId);
      if (esMayor(monto, saldoOpaco)) {
        throw new Error(
          `El abono ($${redondear(monto)}) no puede exceder el saldo histórico ` +
          `de la cuenta ($${saldoOpaco})`
        );
      }
    }

    return this.repository.transaccion(() => {
      const cargos = this.repository.getCargosPendientes(cuentaId, exigible);
      const { imputaciones, sobrante } = distribuir({ modo, cargos, monto, cargosElegidos });
      const imputado = redondear(imputaciones.reduce((s, i) => s + i.monto, 0));

      let abonoId = null;
      if (esMayor(imputado, 0)) {
        abonoId = this.repository.crearMovimiento({
          cuentaId, fecha, tipo: 'Abono', exigible,
          monto: -imputado,
          reciboDetalleId, observaciones, usuarioId
        });
        for (const imp of imputaciones) {
          this.repository.crearImputacion({ abonoId, cargoId: imp.cargoId, monto: imp.monto });
        }
      }

      let creditoId = null;
      if (esMayor(sobrante, 0)) {
        creditoId = this.repository.crearCredito({
          cuentaId, tipo: 'Abono', monto: sobrante, fecha, reciboDetalleId, observaciones
        });
      }

      return { abonoId, imputado, sobrante, creditoId };
    });
  }

  // Convierte crédito disponible en un Abono real: FIFO contra los cargos exigibles
  // pendientes por defecto (nunca contra el bucket opaco -- el crédito solo redime deuda de
  // 2024 en adelante), o contra meses específicos si se los indican. Si el crédito alcanza
  // para más de lo que hay pendiente, el resto sigue disponible -- no se pierde ni se fuerza.
  redimirCredito({ cuentaId, fecha, monto, modo = MODOS.ABONO_DEUDA_FIFO, cargosElegidos = [],
    observaciones = null, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!fecha) throw new Error('La fecha es obligatoria');
    if (!(Number(monto) > 0)) throw new Error('El monto a redimir debe ser mayor a cero');
    if (modo === MODOS.ABONO_SALDO_OPACO || modo === MODOS.ANTICIPO) {
      throw new Error('El crédito solo se redime contra deuda exigible: use AbonoDeudaFIFO o MesesEspecificos');
    }

    // Causa el mes en curso antes de redimir. calcularAPagar/getIndicadoresMoraTodas ya lo
    // cuentan como deuda (cifra principal, desglose y reporte de mora), pero hasta que alguien
    // registra un pago o redime crédito contra él, cartera_movimientos no tiene el cargo real
    // -- mismo patrón que PagoService.registrarPagoSostenimiento (línea ~289). Sin esto, redimir
    // el saldo a favor completo dejaba el mes en curso "a pagar" pese a que el sistema entero ya
    // lo mostraba como deuda: correcto por dentro, confuso en mostrador (caso real R007,
    // 2026-08-11). asegurarCausacion ya es idempotente por (cuenta, año, mes) y ya respeta
    // cuenta_estados (omite meses Suspendida/Inactiva, ver estadoEnMes) -- no hace falta
    // duplicar ninguna de esas dos garantías acá. A diferencia de registrarPagoSostenimiento,
    // acá NO se lanza error si el mes queda omitido (ej. cuenta suspendida): no hay ningún
    // período específico que el operador haya prometido cubrir, así que se sigue de largo y se
    // redime lo que sí exista.
    const ahora = new Date();
    this.asegurarCausacion(cuentaId, ahora.getFullYear(), ahora.getMonth() + 1);

    const disponible = this.repository.getSaldoCreditoDisponible(cuentaId);
    if (esMayor(monto, disponible)) {
      throw new Error(`No hay $${redondear(monto)} de crédito disponible (disponible: $${disponible})`);
    }

    return this.repository.transaccion(() => {
      const cargos = this.repository.getCargosPendientes(cuentaId, 1);
      const { imputaciones } = distribuir({ modo, cargos, monto, cargosElegidos });
      const imputado = redondear(imputaciones.reduce((s, i) => s + i.monto, 0));

      if (!esMayor(imputado, 0)) {
        throw new Error('No hay deuda exigible pendiente contra la cual redimir este crédito');
      }

      const abonoId = this.repository.crearMovimiento({
        cuentaId, fecha, tipo: 'Abono', exigible: 1,
        monto: -imputado, observaciones, usuarioId
      });
      for (const imp of imputaciones) {
        this.repository.crearImputacion({ abonoId, cargoId: imp.cargoId, monto: imp.monto });
      }

      const creditoId = this.repository.crearCredito({
        cuentaId, tipo: 'Aplicado', monto: imputado, fecha, abonoMovimientoId: abonoId, observaciones
      });

      return { abonoId, creditoId, aplicado: imputado, saldoRestante: redondear(disponible - imputado) };
    });
  }

  // Aplica un saldo a favor YA VALIDADO por el llamador contra cargos elegidos: deja el mismo
  // rastro que redimirCredito (un Abono real + sus imputaciones + una fila 'Aplicado' en
  // cuenta_creditos), pero sin volver a consultar/descontar el saldo disponible -- quien llama
  // (PagoService.registrarPagoSostenimiento) ya lo hizo contra la MISMA tabla compartida
  // (cuenta_creditos no tiene una copia por modelo, ver migración 041). A diferencia de
  // redimirCredito (una acción de pantalla donde el operador elige cuánto redimir y el sistema
  // decide contra qué por FIFO), acá el destino ya está decidido: los meses de este recibo.
  aplicarCreditoAMeses({ cuentaId, monto, cargosElegidos, fecha, reciboDetalleId = null, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!fecha) throw new Error('La fecha es obligatoria');
    if (!(Number(monto) > 0)) throw new Error('El monto a aplicar debe ser mayor a cero');
    if (!cargosElegidos || cargosElegidos.length === 0) {
      throw new Error('Debe elegir al menos un mes contra el cual aplicar el crédito');
    }

    return this.repository.transaccion(() => {
      const cargos = this.repository.getCargosPendientes(cuentaId, 1);
      const { imputaciones } = distribuir({ modo: MODOS.MESES_ESPECIFICOS, cargos, monto, cargosElegidos });
      const imputado = redondear(imputaciones.reduce((s, i) => s + i.monto, 0));

      if (!esMayor(imputado, 0)) {
        throw new Error('Los meses elegidos no tienen deuda pendiente contra la cual aplicar este crédito');
      }

      const abonoId = this.repository.crearMovimiento({
        cuentaId, fecha, tipo: 'Abono', exigible: 1, monto: -imputado, reciboDetalleId, usuarioId
      });
      for (const imp of imputaciones) {
        this.repository.crearImputacion({ abonoId, cargoId: imp.cargoId, monto: imp.monto });
      }

      const creditoId = this.repository.crearCredito({
        cuentaId, tipo: 'Aplicado', monto: imputado, fecha, reciboDetalleId, abonoMovimientoId: abonoId
      });

      return { abonoId, creditoId, aplicado: imputado, sobrante: redondear(monto - imputado) };
    });
  }

  // La cifra principal: SOLO responde "¿cuánto paga esta persona hoy por su cuota corriente?".
  // Meses transcurridos entre el último mes cubierto (exclusive) y el actual (inclusive).
  // Nunca incluye deuda anterior al corte, punto de conexión ni saldo a favor.
  //
  // "Último mes cubierto" (cubiertoHasta) exige cobertura CONTIGUA desde el primer mes: se
  // detiene en el primer hueco aunque meses posteriores ya estén pagados (ver
  // calcularCubiertoHasta). Eso es correcto para esa cifra, pero significa que un mes DESPUÉS
  // del hueco puede ya estar total o parcialmente pagado por una imputación que no siguió el
  // orden cronológico (FIFO saltó al mes más viejo pendiente, no necesariamente el siguiente
  // al hueco). Por eso cada mes ya causado se cobra por lo que REALMENTE le falta (monto menos
  // lo ya imputado, vía getCargosConCobertura), no por su monto completo -- si no, se cobraría
  // dos veces lo que ya se pagó fuera de orden. Regla que debe cumplirse siempre: deudaExigible
  // (bucket "meses desde 2024") + la parte de aPagar que corresponde a meses aún no causados
  // = aPagar total.
  //
  // Si el mes YA tiene causación (CargoMensual/AjusteCategoria/AjusteAsamblea), ese monto es la
  // verdad y se usa tal cual -- nunca se recalcula contra categoria_tarifas. Hay causaciones
  // deliberadas que ninguna tarifa vigente reproduce: tarifa derogada corregida
  // (C021/R080/R091/S0244), cuentas suspendidas causadas a una tarifa reducida a propósito, o
  // meses con un monto fraccionario que no sale de ninguna tarifa. Recalcular en vivo perdería
  // esas decisiones.
  //
  // Solo se recalcula en vivo (vía categoria_tarifas) el mes que todavía NO se ha causado -- y
  // solo si la cuenta estaba Activa en ese mes, igual que asegurarCausacion. Si no hay tarifa
  // vigente para un mes que lo necesita, el mes se salta pero queda registrado en
  // mesesSinTarifa y se deja un console.warn: no puede pasar desapercibido.
  // cargosConCobertura (opcional): si el caller ya pidió getCargosConCobertura(cuentaId, 1)
  // para otra cosa (getEstadoCartera necesita el mismo dato para calcularCubiertoHasta), se lo
  // pasa acá para no volver a pedirlo -- misma consulta, mismos resultados, sin ida y vuelta
  // extra a la base (auditoría de entrega 2026-08-11: era una consulta redundante de las ~7 por
  // cuenta que hace getEstadoCartera). Si no se pasa, se calcula igual que siempre.
  calcularAPagar(cuentaId, cubiertoHasta, cargosConCobertura = null) {
    const ahora = new Date();
    const periodoActualCod = codificarPeriodo(ahora.getFullYear(), ahora.getMonth() + 1);

    let desdeCod;
    if (cubiertoHasta) {
      desdeCod = codificarPeriodo(cubiertoHasta.anio, cubiertoHasta.mes) + 1;
    } else {
      const ancla = this.getFechaInicioFacturacion(cuentaId);
      if (!ancla) return { meses: [], total: 0, mesesSinTarifa: [] };
      const inicio = anioMesDeFecha(ancla);
      desdeCod = codificarPeriodo(inicio.anio, inicio.mes);
    }

    const coberturaPorMes = new Map(
      (cargosConCobertura || this.repository.getCargosConCobertura(cuentaId, 1)).map(c => [`${c.anio}-${c.mes}`, c])
    );

    const meses = [];
    const mesesSinTarifa = [];
    for (let cod = desdeCod; cod <= periodoActualCod; cod++) {
      const { anio, mes } = decodificarPeriodo(cod);

      const cobertura = coberturaPorMes.get(`${anio}-${mes}`);
      if (cobertura) {
        const pendiente = redondear(cobertura.monto - cobertura.cubierto);
        // causado=true: ya existe un CargoMensual para este mes, con saldo pendiente (una deuda
        // real, ya facturada). causado=false (más abajo): mes futuro/actual que todavía no se ha
        // causado, esto es una proyección de lo que costaría -- distinción que necesita la
        // pantalla para no mostrar "diciembre 2024 (pendiente)" y "agosto 2026" como si fueran
        // la misma clase de deuda.
        if (esMayor(pendiente, 0)) meses.push({ anio, mes, valor: pendiente, causado: true });
        continue;
      }

      if (this.estadoRepository.estadoEnMes(cuentaId, anio, mes) !== 'Activo') continue;

      const tarifa = this.pagoRepository.getCategoriaTarifaParaMes(cuentaId, anio, mes);
      // 'Sin clasificar' tiene una fila en categoria_tarifas (monto $1) que es un marcador de
      // importación histórica, no una tarifa real (ver migración 038). Tratarla como tarifa
      // válida generaría meses "a pagar" fantasma de $1 para toda cuenta que siga sin
      // reclasificar -- se trata igual que no tener tarifa: se salta y se alerta.
      if (!tarifa || tarifa.categoria_nombre === 'Sin clasificar') {
        mesesSinTarifa.push({ anio, mes });
        console.warn(
          `[CarteraService.calcularAPagar] cuenta ${cuentaId}: ${!tarifa
            ? 'no hay tarifa vigente ni CargoMensual causado'
            : 'la cuenta sigue en la categoría placeholder "Sin clasificar" (sin CargoMensual causado)'
          } para ${anio}-${String(mes).padStart(2, '0')} -- ese mes no entra en "a pagar". ` +
          `Revisar categoria_tarifas / reclasificar la cuenta.`
        );
        continue;
      }
      meses.push({ anio, mes, valor: tarifa.tarifa_sostenimiento, causado: false });
    }

    return { meses, total: redondear(meses.reduce((s, m) => s + m.valor, 0)), mesesSinTarifa };
  }

  // Estado de la cartera de una cuenta. La cifra principal (aPagar) es la única que se destaca:
  // responde solo "¿cuánto paga hoy por su cuota corriente?". Todo lo demás -- deuda anterior al
  // corte, punto de conexión, saldo a favor -- son avisos independientes que NINGUNO suma ni
  // resta de esa cifra; cada uno tiene su propia acción (abonar, redimir) en vez de mezclarse.
  getEstadoCartera(cuentaId) {
    const { deudaExigible, saldoOpaco } = this.repository.getSaldos(cuentaId);
    const cargosConCobertura = this.repository.getCargosConCobertura(cuentaId, 1);
    const cubiertoHasta = calcularCubiertoHasta(cargosConCobertura);
    const totalCobrarHoy = deudaExigible > 0 ? deudaExigible : 0;
    const { meses: mesesAPagar, total: aPagar, mesesSinTarifa } = this.calcularAPagar(cuentaId, cubiertoHasta, cargosConCobertura);

    const deudaPuntoConexion = redondear(
      this.nuevoPuntoRepository.findByCuentaId(cuentaId)
        .filter(p => p.estado !== 'Cancelado')
        .reduce((s, p) => s + p.saldo_pendiente, 0)
    );

    // El crédito vive en cuenta_creditos (ver registrarAbono/redimirCredito) y ya no baja la
    // deuda exigible por sí solo. deuda_exigible puede seguir yendo negativa por otra vía
    // (recategorizar hacia abajo sobre un mes ya pagado, sección "recategorizar" más arriba):
    // ese caso no está en cuenta_creditos todavía, así que se suma aparte para no esconderlo.
    const saldoCreditoDisponible = this.repository.getSaldoCreditoDisponible(cuentaId);
    const saldoAFavor = redondear(saldoCreditoDisponible + (deudaExigible < 0 ? -deudaExigible : 0));

    return {
      // Cifra principal: la única que se presenta como "el número" de la cuenta.
      ultimoMesCubierto: cubiertoHasta,
      aPagar,
      mesesAPagar,
      // Meses que se saltaron de aPagar por no tener ni CargoMensual causado ni tarifa vigente
      // (ver console.warn de calcularAPagar). Vacío en el caso normal; si no está vacío, aPagar
      // está subestimado y hay que completar categoria_tarifas para esa categoría/fecha.
      mesesSinTarifa,

      // Avisos independientes: cada uno con su propia acción, ninguno entra en aPagar.
      deudaAntes2024: saldoOpaco,
      deudaPuntoConexion,
      saldoCreditoDisponible,

      // Los 4 buckets de primera clase (se conservan para quien ya los consume).
      deudaMesesDesde2024: deudaExigible,
      deudaTotal: redondear(totalCobrarHoy + saldoOpaco + deudaPuntoConexion),

      // Se conservan los nombres previos para no romper a quien ya consume este método.
      deudaExigible,
      saldoOpaco,
      saldoAFavor,
      cubiertoHasta,
      totalCobrarHoy,
      totalReferencia: redondear(totalCobrarHoy + saldoOpaco)
    };
  }

  // Para reportes y dashboard (Fase 2 del decommission del modelo viejo, ver
  // docs/superpowers/specs/2026-08-10-fase2-reportes-dashboard-design.md): los ingredientes
  // crudos de mora/deuda de cada cuenta de `cuentaIds`, en un solo lugar, para que
  // ReporteRepository/DashboardRepository/DashboardService no repitan cada uno su propio loop
  // ni su propia idea de qué cuenta como deuda -- todos leen de acá. Deliberadamente NO decide
  // qué es "estar en mora": eso es una decisión de presentación de cada reporte (ver el spec),
  // no una pregunta que cartera deba responder por sí sola.
  //
  // mesesImpagos/mesMasAntiguoImpago vienen de mesesAPagar (calcularAPagar), NO de restar
  // cubiertoHasta contra el mes actual: ese rango cuenta TODOS los meses desde el primer hueco,
  // aunque ya estén pagados (cubiertoHasta se congela ahí a propósito, ver S050/R007). mesesAPagar
  // ya filtra uno por uno cuáles de esos meses tienen saldo pendiente de verdad, así que su
  // longitud es la cuenta real de meses impagos -- y aPagar, la suma en pesos, ya coincide con
  // deudaExigible (misma fuente).
  getIndicadoresMoraTodas(cuentaIds) {
    return cuentaIds.map(cuentaId => {
      const estado = this.getEstadoCartera(cuentaId);
      return {
        cuentaId,
        cubiertoHasta: estado.cubiertoHasta,
        deudaExigible: estado.deudaExigible,
        deudaAntes2024: estado.deudaAntes2024,
        deudaPuntoConexion: estado.deudaPuntoConexion,
        mesesImpagos: estado.mesesAPagar.length,
        mesMasAntiguoImpago: estado.mesesAPagar[0] || null,
        aPagar: estado.aPagar
      };
    });
  }

  // "Próximo período sugerido": el mes siguiente al último cubierto (alDiaHasta), IGNORANDO
  // huecos históricos -- esos siguen contando como deuda en getEstadoCartera/calcularAPagar, no
  // acá. Puede devolver un mes que todavía no tiene CargoMensual causado (ej. una cuenta al día
  // hasta julio cuando ya es agosto, o una cuenta con un pago anticipado que la causación
  // todavía no alcanzó): es intencional, asegurarCausacion lo crea al registrar el pago, y si
  // había un pago anticipado sin causar ya quedó como saldo a favor (ver registrarAbono).
  getProximoPeriodoSugerido(cuentaId) {
    const alDiaHasta = calcularAlDiaHasta(this.repository.getCargosConCobertura(cuentaId, 1));

    if (alDiaHasta) {
      const cod = codificarPeriodo(alDiaHasta.anio, alDiaHasta.mes) + 1;
      return { alDiaHasta, siguiente: decodificarPeriodo(cod) };
    }

    const ancla = this.getFechaInicioFacturacion(cuentaId);
    return { alDiaHasta: null, siguiente: ancla ? anioMesDeFecha(ancla) : null };
  }

  // Detalle de solo lectura para mostrar en pantalla: los movimientos de cartera_movimientos
  // (con su observación, que es donde queda la trazabilidad de cada corrección: "Causación
  // inferida...", "Tarifa corregida...") y, aparte, los puntos de conexión de la cuenta con sus
  // abonos (nuevos_puntos/nuevo_punto_abonos, fuera de cartera_movimientos). No escribe nada.
  getDetalleCartera(cuentaId) {
    // Un Abono no guarda anio/mes propio (puede cubrir varios meses o parte de uno) -- su
    // período solo existe a través de cartera_imputaciones. Se completa acá, no en el repo,
    // porque es exclusivamente para mostrar en pantalla.
    const movimientos = this.repository.getMovimientos(cuentaId).map(m =>
      m.tipo === 'Abono' ? { ...m, periodos: this.repository.getPeriodosDeAbono(m.id) } : m
    );

    const puntosConexion = this.nuevoPuntoRepository.findByCuentaId(cuentaId).map(punto => ({
      ...punto,
      abonos: this.nuevoPuntoRepository.getAbonos(punto.id)
    }));

    return { movimientos, puntosConexion };
  }

  // Para la lista de cuentas: qué cuentas tienen algún aviso pendiente (deuda anterior al
  // corte, punto de conexión, saldo a favor), en 3 consultas agregadas -- no una por cuenta --
  // para que listar 300 cuentas no dispare 300 lecturas de cartera_movimientos.
  getIndicadoresBulk() {
    const opacas = this.db.prepare(`
      SELECT cuenta_id FROM cartera_movimientos WHERE exigible = 0
      GROUP BY cuenta_id HAVING SUM(monto) > 0
    `).all().map(f => f.cuenta_id);
    const conCredito = this.db.prepare(`
      SELECT cuenta_id FROM cuenta_creditos
      GROUP BY cuenta_id HAVING SUM(CASE WHEN tipo = 'Abono' THEN monto ELSE -monto END) > 0
    `).all().map(f => f.cuenta_id);
    const conPunto = this.db.prepare(`
      SELECT DISTINCT cuenta_id FROM nuevos_puntos WHERE estado = 'Pendiente'
    `).all().map(f => f.cuenta_id);

    const resultado = {};
    const marcar = (cuentaId, campo) => {
      if (!resultado[cuentaId]) {
        resultado[cuentaId] = { deudaAntes2024: false, saldoCreditoDisponible: false, puntoConexion: false };
      }
      resultado[cuentaId][campo] = true;
    };
    opacas.forEach(id => marcar(id, 'deudaAntes2024'));
    conCredito.forEach(id => marcar(id, 'saldoCreditoDisponible'));
    conPunto.forEach(id => marcar(id, 'puntoConexion'));
    return resultado;
  }

  // Motivo documentado (texto fijo) cuando el saldo de esta cuenta en el nuevo modelo no
  // coincide con el Excel de CARTERA. Ver src/services/cartera/motivosDiferencia.js. Recibe
  // cuentaId (no código) para que quien llama no tenga que cargar el código aparte.
  getMotivoDiferencia(cuentaId) {
    const cuenta = this.db.prepare('SELECT codigo FROM cuentas WHERE id = ?').get(cuentaId);
    return cuenta ? getMotivoDiferencia(cuenta.codigo) : null;
  }

  // Cambia la categoría de una cuenta con una fecha de vigencia que puede ser pasada, y
  // corrige los cargos ya emitidos desde esa fecha.
  //
  // NUNCA muta un CargoMensual emitido: emite un AjusteCategoria por la diferencia. Así:
  //  - no se reescribe historia (queda qué se cobró, cuánto se corrigió, cuándo y con qué acta);
  //  - ninguna imputación se deshace: si el cargo sube, el ajuste es un pendiente más que el
  //    FIFO ve normalmente; si baja, el ajuste negativo reduce el saldo directo y, si el mes
  //    ya estaba pagado, eso se vuelve saldo a favor por la propia fórmula del saldo.
  // Funciona porque el saldo sale de los movimientos, no de las imputaciones.
  //
  // No genera asientos contables (la causación tampoco), así que corregir meses de un período
  // contable cerrado no lo reexpresa.
  recategorizar({ cuentaId, categoriaId, fechaVigencia, documento = null,
    observaciones = null, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!categoriaId) throw new Error('La categoría es obligatoria');
    if (!fechaVigencia) throw new Error('La fecha de vigencia es obligatoria');

    const categoria = this.db.prepare(`SELECT id, nombre FROM categorias WHERE id = ?`).get(categoriaId);
    if (!categoria) throw new Error(`Categoría no encontrada: ${categoriaId}`);

    const hoy = new Date();
    const hastaCod = codificarPeriodo(hoy.getFullYear(), hoy.getMonth() + 1);
    const desde = anioMesDeFecha(fechaVigencia);
    const desdeCod = codificarPeriodo(desde.anio, desde.mes);

    return this.repository.transaccion(() => {
      // 1) Mover la vigencia de categoría.
      const vigenciaAbierta = this.db.prepare(`
        SELECT id, categoria_id, fecha_inicio FROM cuenta_categorias
        WHERE cuenta_id = ? AND fecha_fin IS NULL
        ORDER BY fecha_inicio DESC, id DESC LIMIT 1
      `).get(cuentaId);

      const yaEstaEnEsaCategoria = vigenciaAbierta
        && vigenciaAbierta.categoria_id === categoriaId
        && vigenciaAbierta.fecha_inicio <= fechaVigencia;

      if (!yaEstaEnEsaCategoria) {
        if (vigenciaAbierta) {
          if (fechaVigencia < vigenciaAbierta.fecha_inicio) {
            throw new Error(
              `La fecha ${fechaVigencia} es anterior al inicio de la categoría actual ` +
              `(${vigenciaAbierta.fecha_inicio}); corrija esa vigencia primero`
            );
          }
          if (fechaVigencia === vigenciaAbierta.fecha_inicio) {
            // La vigencia abierta arrancó el mismo día que la corrección: nunca debió tener
            // esa categoría, se reemplaza entera en vez de "cerrarla el día anterior" (eso
            // dejaría fecha_fin antes que fecha_inicio en esa misma fila).
            this.db.prepare(`DELETE FROM cuenta_categorias WHERE id = ?`).run(vigenciaAbierta.id);
          } else {
            this.db.prepare(`UPDATE cuenta_categorias SET fecha_fin = ? WHERE id = ?`)
              .run(diaAnterior(fechaVigencia), vigenciaAbierta.id);
          }
        }
        this.db.prepare(`
          INSERT INTO cuenta_categorias (cuenta_id, categoria_id, fecha_inicio, observaciones)
          VALUES (?, ?, ?, ?)
        `).run(cuentaId, categoriaId, fechaVigencia, observaciones);
      }

      // 2) Corregir por diferencia los meses ya causados desde la vigencia.
      const ajustes = [];
      const fechaAjuste = new Date().toISOString().split('T')[0];

      for (let cod = desdeCod; cod <= hastaCod; cod++) {
        const { anio, mes } = decodificarPeriodo(cod);

        const cargoOriginal = this.repository.getCargoMensual(cuentaId, anio, mes);
        if (!cargoOriginal) continue;   // mes no causado: no hay nada que corregir

        const tarifaCorrecta = this.pagoRepository.getCategoriaTarifaParaMes(cuentaId, anio, mes);
        if (!tarifaCorrecta) continue;

        // Lo cobrado hoy por ese mes es el cargo más los ajustes previos.
        const cobrado = this.db.prepare(`
          SELECT COALESCE(SUM(monto), 0) AS total FROM cartera_movimientos
          WHERE cuenta_id = ? AND anio = ? AND mes = ?
            AND tipo IN ('CargoMensual', 'AjusteCategoria')
        `).get(cuentaId, anio, mes).total;

        const diferencia = redondear(tarifaCorrecta.tarifa_sostenimiento - cobrado);
        if (!esMayor(Math.abs(diferencia), 0)) continue;

        this.repository.crearMovimiento({
          cuentaId,
          fecha: fechaAjuste,
          tipo: 'AjusteCategoria',
          exigible: 1,
          monto: diferencia,
          anio, mes,
          documento,
          observaciones: observaciones
            || `Recategorización a ${categoria.nombre} con vigencia ${fechaVigencia}`,
          usuarioId
        });
        ajustes.push({ anio, mes, diferencia });
      }

      return {
        ajustes,
        totalAjustado: redondear(ajustes.reduce((s, a) => s + a.diferencia, 0))
      };
    });
  }

  // Suspende una cuenta a partir de una fecha que puede ser pasada, y anula los cargos ya
  // causados desde ahí. La suspensión significa que en ese lapso no había servicio que
  // cobrar, así que la deuda de esos meses no debe existir.
  //
  // Los cargos NO se borran: se anulan con una contrapartida negativa, igual que en
  // recategorizar. Queda el rastro de que se causaron y de que se anularon.
  suspender({ cuentaId, fechaDesde, motivo, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!fechaDesde) throw new Error('La fecha desde la que se suspende es obligatoria');
    if (!motivo || !String(motivo).trim()) throw new Error('Debe indicar el motivo de la suspensión');

    return this.repository.transaccion(() => {
      const vigenciaId = this.estadoRepository.cambiarEstado({
        cuentaId, estado: 'Suspendido', fechaInicio: fechaDesde, motivo, usuarioId
      });

      const desde = anioMesDeFecha(fechaDesde);
      const desdeCod = codificarPeriodo(desde.anio, desde.mes);
      const hoy = new Date();
      const hastaCod = codificarPeriodo(hoy.getFullYear(), hoy.getMonth() + 1);
      const fechaAjuste = new Date().toISOString().split('T')[0];

      let cargosAnulados = 0;
      let totalAnulado = 0;

      for (let cod = desdeCod; cod <= hastaCod; cod++) {
        const { anio, mes } = decodificarPeriodo(cod);
        const neto = this.db.prepare(`
          SELECT COALESCE(SUM(monto), 0) AS total FROM cartera_movimientos
          WHERE cuenta_id = ? AND anio = ? AND mes = ?
            AND tipo IN ('CargoMensual', 'AjusteCategoria')
        `).get(cuentaId, anio, mes).total;

        if (!esMayor(Math.abs(neto), 0)) continue;

        this.repository.crearMovimiento({
          cuentaId,
          fecha: fechaAjuste,
          tipo: 'AjusteCategoria',
          exigible: 1,
          monto: redondear(-neto),
          anio, mes,
          observaciones: `Anulación por suspensión desde ${fechaDesde}: ${motivo}`,
          usuarioId
        });
        cargosAnulados++;
        totalAnulado = redondear(totalAnulado - neto);
      }

      return { vigenciaId, cargosAnulados, totalAnulado };
    });
  }

  // Reactiva una cuenta. La causación se reanuda desde fechaDesde; los meses en que estuvo
  // suspendida NO se causan retroactivamente. Si en algún caso se quisiera cobrarlos, es un
  // AjusteAsamblea explícito y documentado, nunca un efecto automático de reactivar.
  reactivar({ cuentaId, fechaDesde, motivo = null, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!fechaDesde) throw new Error('La fecha desde la que se reactiva es obligatoria');

    const vigenciaId = this.estadoRepository.cambiarEstado({
      cuentaId, estado: 'Activo', fechaInicio: fechaDesde, motivo, usuarioId
    });
    return { vigenciaId };
  }

  // Ajuste manual de deuda con rastro obligatorio (motivo + usuario). Dos usos:
  //  - AjusteAsamblea: corrección o condonación decidida por la junta después de la carga.
  //  - AjusteCargaInicial: el residuo de conciliación contra CARTERA.xlsx (ver sección 7 del
  //    MD de la carga inicial) para las ~15 cuentas donde la aritmética del propio Excel no
  //    cierra al centavo.
  // No pasa por causación ni por imputación: es un movimiento directo, igual que AjusteCategoria.
  //
  // TODO antes de conectar esto a IPC (todavía no lo está, ver main.js): la guarda de abajo no
  // rechaza NaN/Infinity/strings no numéricos en monto -- Number(NaN) === 0 es false, así que
  // pasa. Cambiar a algo como !Number.isFinite(Number(monto)) || Number(monto) === 0 antes de
  // exponerlo. Auditoría de entrega 2026-08-11, hallazgo 10 -- ver
  // docs/deuda-tecnica-auditoria-2026-08-11.md.
  ajustarDeuda({ cuentaId, tipo, monto, fecha, exigible = 1, documento = null,
    observaciones, usuarioId = null }) {
    if (!cuentaId) throw new Error('La cuenta es obligatoria');
    if (!['AjusteAsamblea', 'AjusteCargaInicial'].includes(tipo)) {
      throw new Error(`Tipo de ajuste inválido: ${tipo}`);
    }
    if (!fecha) throw new Error('La fecha del ajuste es obligatoria');
    if (monto === undefined || monto === null || Number(monto) === 0) {
      throw new Error('El monto del ajuste no puede ser cero');
    }
    if (!observaciones || !String(observaciones).trim()) {
      throw new Error('Debe documentar el motivo del ajuste');
    }

    const movimientoId = this.repository.crearMovimiento({
      cuentaId, fecha, tipo, exigible, monto: Number(monto), documento, observaciones, usuarioId
    });
    return { movimientoId };
  }

  // Mueve el destino de un abono ya cargado entre sostenimiento y punto de conexión, SIN
  // rehacer el recibo (regla 3 de la carga inicial: el recibo es literal e inmutable). Caso
  // real: el recibo 1347 de S0365 decía "TERMINA DE PAGAR EL PUNTO DE AGUA" pero el punto ya
  // estaba saldado desde 2019, así que en realidad era sostenimiento.
  //
  // El lado de origen NUNCA se borra ni se muta: se cancela con un movimiento de contrapartida
  // (mismo patrón que AjusteCategoria/suspender), y solo entonces se registra el lado nuevo.
  // Si el origen era sostenimiento, además hay que liberar las imputaciones de ese abono: sin
  // eso, los cargos que cubría seguirían viéndose "cubiertos" pese a que la plata que los cubrió
  // ya no cuenta ahí.
  reclasificarAbono({ reciboDetalleId, destino, motivo, usuarioId = null,
    fecha = null, nuevoPuntoId = null, modo = MODOS.ABONO_DEUDA_FIFO, cargosElegidos = [] }) {
    if (!reciboDetalleId) throw new Error('El recibo_detalle es obligatorio');
    if (!['sostenimiento', 'punto'].includes(destino)) {
      throw new Error(`Destino de reclasificación inválido: ${destino}`);
    }
    if (!motivo || !String(motivo).trim()) throw new Error('Debe indicar el motivo de la reclasificación');

    const detalle = this.db.prepare(`
      SELECT rd.id, rd.valor, r.cuenta_id, r.fecha_recibo, r.fecha_pago_real
      FROM recibo_detalles rd JOIN recibos r ON r.id = rd.recibo_id
      WHERE rd.id = ?
    `).get(reciboDetalleId);
    if (!detalle) throw new Error(`recibo_detalle no encontrado: ${reciboDetalleId}`);

    const abonoSostenimiento = this.repository.getAbonoPorReciboDetalle(reciboDetalleId);
    const abonoPunto = this.db.prepare(`
      SELECT * FROM nuevo_punto_abonos WHERE recibo_detalle_id = ?
    `).get(reciboDetalleId);

    if (abonoSostenimiento && abonoPunto) {
      throw new Error(`El recibo_detalle ${reciboDetalleId} tiene abono en ambos lados; no se puede reclasificar automáticamente`);
    }
    if (!abonoSostenimiento && !abonoPunto) {
      throw new Error(`El recibo_detalle ${reciboDetalleId} no tiene ningún abono cargado todavía`);
    }

    const origen = abonoSostenimiento ? 'sostenimiento' : 'punto';
    if (origen === destino) throw new Error(`El abono ya está clasificado como ${destino}`);

    const fechaMovimiento = fecha || detalle.fecha_pago_real || detalle.fecha_recibo;

    return this.repository.transaccion(() => {
      // 1) Cancelar el lado de origen con una contrapartida, sin borrar nada.
      if (origen === 'sostenimiento') {
        this.repository.eliminarImputacionesDeAbono(abonoSostenimiento.id);
        this.repository.crearMovimiento({
          cuentaId: detalle.cuenta_id,
          fecha: fechaMovimiento,
          tipo: 'Abono',
          exigible: abonoSostenimiento.exigible,
          monto: -abonoSostenimiento.monto,
          reciboDetalleId,
          observaciones: `Reversión por reclasificación a punto: ${motivo}`,
          usuarioId
        });
      } else {
        this.nuevoPuntoRepository.crearAbono({
          nuevoPuntoId: abonoPunto.nuevo_punto_id,
          monto: -abonoPunto.monto,
          fechaAbono: fechaMovimiento,
          reciboDetalleId,
          observaciones: `Reversión por reclasificación a sostenimiento: ${motivo}`
        });
        this.nuevoPuntoRepository.actualizarSaldoYEstado(abonoPunto.nuevo_punto_id);
      }

      // 2) Registrar el lado nuevo.
      if (destino === 'sostenimiento') {
        const r = this.registrarAbono({
          cuentaId: detalle.cuenta_id, fecha: fechaMovimiento, monto: detalle.valor,
          modo, cargosElegidos, reciboDetalleId,
          observaciones: `Reclasificado desde punto: ${motivo}`, usuarioId
        });
        return { origen, destino, ...r };
      }

      const punto = nuevoPuntoId
        ? this.nuevoPuntoRepository.findById(nuevoPuntoId)
        : this.nuevoPuntoRepository.findByCuentaId(detalle.cuenta_id).find(p => p.estado === 'Pendiente');
      if (!punto) {
        throw new Error(`La cuenta ${detalle.cuenta_id} no tiene un cargo de punto pendiente al que reclasificar; créelo primero`);
      }

      this.nuevoPuntoRepository.crearAbono({
        nuevoPuntoId: punto.id, monto: detalle.valor, fechaAbono: fechaMovimiento,
        reciboDetalleId, observaciones: `Reclasificado desde sostenimiento: ${motivo}`
      });
      const estado = this.nuevoPuntoRepository.actualizarSaldoYEstado(punto.id);
      return { origen, destino, nuevoPuntoId: punto.id, ...estado };
    });
  }
}

CarteraService.MODOS = MODOS;

module.exports = CarteraService;
