const CarteraRepository = require('../repositories/CarteraRepository');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PagoRepository = require('../repositories/PagoRepository');
const { codificarPeriodo, decodificarPeriodo, anioMesDeFecha, primerDiaDelMes, diaAnterior } =
  require('./cartera/periodos');
const { MODOS, distribuir, calcularCubiertoHasta } = require('./cartera/imputacion');
const { redondear, esMayor } = require('./cartera/dinero');

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
  }

  // Ancla de facturación: el mes del primer recibo de la cuenta (no el primer mes de
  // pago_periodos). Hay cuentas reales con recibos -- abonos a la deuda, pagos de conexión --
  // que nunca se atribuyeron a un mes concreto, así que pago_periodos no sirve como ancla.
  // Excluye los recibos anulados: un recibo anulado nunca representó un cobro real.
  getFechaInicioFacturacion(cuentaId) {
    const fila = this.db.prepare(`
      SELECT MIN(fecha_recibo) AS f FROM recibos
      WHERE cuenta_id = ? AND estado != 'Anulado'
    `).get(cuentaId);
    return fila && fila.f ? String(fila.f).split(' ')[0] : null;
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
  asegurarCausacion(cuentaId, hastaAnio, hastaMes) {
    const omitidos = [];
    const ancla = this.getFechaInicioFacturacion(cuentaId);
    if (!ancla) {
      omitidos.push({ anio: null, mes: null, motivo: 'La cuenta no tiene recibos: sin ancla de facturación no se puede causar' });
      return { creados: 0, omitidos };
    }

    const inicio = anioMesDeFecha(ancla);
    const desdeCod = codificarPeriodo(inicio.anio, inicio.mes);
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
  // crean UN solo Abono; lo único que cambia es contra qué cargos se computa la cobertura.
  // Lo que no alcanza a imputarse queda como saldo a favor (un exigible negativo), sin tabla
  // aparte: por eso cuenta_creditos queda sin uso.
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

      const abonoId = this.repository.crearMovimiento({
        cuentaId, fecha, tipo: 'Abono', exigible,
        monto: -redondear(monto),
        reciboDetalleId, observaciones, usuarioId
      });

      for (const imp of imputaciones) {
        this.repository.crearImputacion({ abonoId, cargoId: imp.cargoId, monto: imp.monto });
      }

      const imputado = redondear(imputaciones.reduce((s, i) => s + i.monto, 0));
      return { abonoId, imputado, sobrante };
    });
  }

  // Estado de la cartera de una cuenta. El saldo opaco va SIEMPRE separado y nunca entra al
  // total a cobrar: es informativo, no exigible.
  getEstadoCartera(cuentaId) {
    const { deudaExigible, saldoOpaco } = this.repository.getSaldos(cuentaId);
    const cubiertoHasta = calcularCubiertoHasta(this.repository.getCargosConCobertura(cuentaId, 1));

    return {
      deudaExigible,
      saldoOpaco,
      saldoAFavor: deudaExigible < 0 ? redondear(-deudaExigible) : 0,
      cubiertoHasta,
      totalCobrarHoy: deudaExigible > 0 ? deudaExigible : 0,
      totalReferencia: redondear((deudaExigible > 0 ? deudaExigible : 0) + saldoOpaco)
    };
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
}

CarteraService.MODOS = MODOS;

module.exports = CarteraService;
