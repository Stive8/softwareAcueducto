const MapeoContableRepository = require('../repositories/MapeoContableRepository');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');

class MapeoContableService {
  constructor(dbService) {
    this.repository = new MapeoContableRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
  }

  getAll(modulo = '') {
    return this.repository.findAll(modulo);
  }

  resolverCuentaContableId(modulo, concepto) {
    return this.repository.resolverCuentaContableId(modulo, concepto);
  }

  actualizar(modulo, concepto, cuentaContableId) {
    if (!modulo || !concepto) throw new Error('Módulo y concepto son obligatorios');

    const cuenta = this.planCuentaRepository.findById(cuentaContableId);
    if (!cuenta) throw new Error('La cuenta contable seleccionada no existe');
    if (!cuenta.activo) throw new Error('No se puede asignar una cuenta contable inactiva');
    if (this.planCuentaRepository.tieneHijos(cuentaContableId)) {
      throw new Error(`La cuenta "${cuenta.nombre}" es de agrupación (tiene subcuentas); seleccione una subcuenta imputable`);
    }

    this.repository.upsert(modulo, concepto, cuentaContableId);
  }
}

module.exports = MapeoContableService;
