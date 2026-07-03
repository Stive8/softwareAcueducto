const CajaMenorRepository = require('../repositories/CajaMenorRepository');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');
const TerceroRepository = require('../repositories/TerceroRepository');
const PeriodoContableRepository = require('../repositories/PeriodoContableRepository');
const PeriodoContableService = require('./PeriodoContableService');
const AsientoContableService = require('./AsientoContableService');

class CajaMenorService {
  constructor(dbService) {
    this.repository = new CajaMenorRepository(dbService);
    this.configuracionRepository = new ConfiguracionRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
    this.terceroRepository = new TerceroRepository(dbService);
    this.periodoContableService = new PeriodoContableService(new PeriodoContableRepository(dbService), dbService);
    this.asientoContableService = new AsientoContableService(dbService);
  }

  getEstado() {
    const config = this.configuracionRepository.getAll();
    const activa = config.caja_menor_activa === 'true';
    const saldoObjetivo = Number(config.caja_menor_saldo_objetivo || 0);

    const cuentaCajaMenor = this.planCuentaRepository.findByCodigo('110510');
    const saldoActual = cuentaCajaMenor
      ? this.asientoContableService.getLibroMayor(cuentaCajaMenor.id).saldoFinal
      : 0;

    const responsable = this.repository.getResponsableActual() || null;
    const montoReembolso = Math.max(0, saldoObjetivo - saldoActual);

    return { activa, saldoObjetivo, saldoActual, responsable, montoReembolso };
  }

  getHistorialResponsables() {
    return this.repository.getHistorialResponsables();
  }

  asignarResponsable(terceroId, fechaInicio, observaciones = null) {
    if (!terceroId) throw new Error('Debe seleccionar un tercero responsable');
    const tercero = this.terceroRepository.findById(terceroId);
    if (!tercero) throw new Error('El tercero seleccionado no existe');
    if (!fechaInicio) throw new Error('La fecha de inicio es obligatoria');

    return this.repository.asignarResponsable(terceroId, fechaInicio, observaciones);
  }

  // Traslada Caja General -> Caja Menor hasta el saldo objetivo vigente. Se contabiliza como
  // asiento manual de dos líneas fijas, sin pasar por el motor de plantillas (no hace falta para
  // dos líneas con cuentas conocidas), y con sincronizarLedgerSimple=false porque es un traslado
  // interno dentro de "Caja": el efectivo total de la organización no cambia, así que no debe
  // tocar el ledger simple que alimenta "Saldo en Caja" del Dashboard.
  reembolsar({ fecha, observaciones = null, usuarioId = null }) {
    if (!fecha) throw new Error('La fecha es obligatoria');

    const config = this.configuracionRepository.getAll();
    if (config.caja_menor_activa !== 'true') throw new Error('Caja Menor no está activa');

    const cuentaCajaMenor = this.planCuentaRepository.findByCodigo('110510');
    const cuentaCajaGeneral = this.planCuentaRepository.findByCodigo('110505');
    if (!cuentaCajaMenor || !cuentaCajaGeneral) {
      throw new Error('No se encontraron las cuentas de Caja Menor / Caja General en el plan de cuentas');
    }

    const saldoObjetivo = Number(config.caja_menor_saldo_objetivo || 0);
    const saldoActual = this.asientoContableService.getLibroMayor(cuentaCajaMenor.id).saldoFinal;
    const monto = saldoObjetivo - saldoActual;
    if (monto <= 0) {
      throw new Error('La Caja Menor ya tiene el saldo objetivo o más; no hay nada que reembolsar');
    }

    const responsable = this.repository.getResponsableActual();
    if (!responsable) {
      throw new Error('No hay un responsable de Caja Menor asignado. Configúralo en Configuración → Caja Menor antes de reembolsar.');
    }

    this.periodoContableService.validarFechaPermitida(fecha);

    const lineas = [
      {
        cuentaContableId: cuentaCajaMenor.id,
        debito: monto,
        terceroId: responsable.tercero_id,
        terceroNombre: responsable.nombre_razon_social,
        terceroIdentificacion: responsable.numero_identificacion
      },
      { cuentaContableId: cuentaCajaGeneral.id, credito: monto }
    ];

    return this.asientoContableService.crearManual({
      fecha,
      concepto: `Reembolso de Caja Menor a ${responsable.nombre_razon_social}`,
      tipoComprobante: 'Reembolso Caja Menor',
      lineas,
      usuarioId,
      sincronizarLedgerSimple: false
    });
  }
}

module.exports = CajaMenorService;
