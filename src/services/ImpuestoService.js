const ImpuestoRepository = require('../repositories/ImpuestoRepository');
const PlantillaContabilizacionRepository = require('../repositories/PlantillaContabilizacionRepository');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');

class ImpuestoService {
  constructor(dbService) {
    this.repository = new ImpuestoRepository(dbService);
    this.plantillaRepository = new PlantillaContabilizacionRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
  }

  getAll() {
    return this.repository.findAll();
  }

  getById(id) {
    const imp = this.repository.findById(id);
    if (!imp) throw new Error(`Impuesto ${id} no encontrado`);
    return imp;
  }

  create(datos) {
    this._validar(datos);
    const id = this.repository.create(datos);
    return this.repository.findById(id);
  }

  update(id, datos) {
    const existente = this.repository.findById(id);
    if (!existente) throw new Error('Impuesto no encontrado');
    if (existente.es_sistema) throw new Error('Los impuestos del sistema no pueden modificarse desde la UI');
    this._validar(datos);
    this.repository.update(id, datos);
    return this.repository.findById(id);
  }

  toggleActivo(id) {
    const imp = this.repository.findById(id);
    if (!imp) throw new Error('Impuesto no encontrado');
    return this.repository.toggleActivo(id);
  }

  asignarAPlantilla(plantillaId, impuestoId, orden = 100) {
    const plantilla = this.plantillaRepository.findById(plantillaId);
    if (!plantilla) throw new Error('Plantilla no encontrada');
    const imp = this.repository.findById(impuestoId);
    if (!imp) throw new Error('Impuesto no encontrado');
    this.repository.asignarAPlantilla(plantillaId, impuestoId, orden);
  }

  quitarDePlantilla(plantillaId, impuestoId) {
    this.repository.quitarDePlantilla(plantillaId, impuestoId);
  }

  getPlantillasAsignadas(impuestoId) {
    return this.repository.getPlantillasAsignadas(impuestoId);
  }

  _validar({ nombre, tipo, porcentaje, cuentaId, ladoAjuste }) {
    if (!nombre || !nombre.trim())       throw new Error('El nombre del impuesto es obligatorio');
    if (!tipo)                           throw new Error('El tipo de impuesto es obligatorio');
    if (!porcentaje || porcentaje <= 0)  throw new Error('El porcentaje debe ser mayor a cero');
    if (porcentaje > 100)                throw new Error('El porcentaje no puede superar 100');
    if (!['Debito', 'Credito'].includes(ladoAjuste)) {
      throw new Error("lado_ajuste debe ser 'Debito' (IVA descontable) o 'Credito' (ReteFuente/ICA)");
    }

    const cuenta = this.planCuentaRepository.findById(cuentaId);
    if (!cuenta) throw new Error('La cuenta del impuesto no existe en el PUC');
    if (this.planCuentaRepository.tieneHijos(cuentaId)) {
      throw new Error(`La cuenta "${cuenta.nombre}" es de agrupación y no admite movimientos (no es imputable)`);
    }
  }
}

module.exports = ImpuestoService;
