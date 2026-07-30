const CarteraRepository = require('../repositories/CarteraRepository');
const CuentaEstadoRepository = require('../repositories/CuentaEstadoRepository');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PagoRepository = require('../repositories/PagoRepository');
const { codificarPeriodo, decodificarPeriodo, anioMesDeFecha, primerDiaDelMes } =
  require('./cartera/periodos');

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
}

module.exports = CarteraService;
