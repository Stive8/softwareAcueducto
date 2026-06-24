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

  // A diferencia de actualizar() (que reasigna un concepto que ya existe en la lista, como
  // "Mantenimiento"), esto agrega uno nuevo (ej. un tipo de gasto que no estaba contemplado).
  // Valida que no exista ya, para que el usuario use "Cambiar" si lo que quiere es reasignar.
  crear(modulo, concepto, cuentaContableId) {
    if (!modulo || !concepto || !concepto.trim()) throw new Error('Módulo y concepto son obligatorios');
    if (concepto.trim() === '__default__') throw new Error('Ese nombre está reservado para el sistema');

    const yaExiste = this.repository.findAll(modulo).some(m => m.concepto.toLowerCase() === concepto.trim().toLowerCase());
    if (yaExiste) throw new Error(`Ya existe "${concepto.trim()}" en esta lista; use "Cambiar" para reasignarle otra cuenta`);

    const cuenta = this.planCuentaRepository.findById(cuentaContableId);
    if (!cuenta) throw new Error('La cuenta contable seleccionada no existe');
    if (!cuenta.activo) throw new Error('No se puede asignar una cuenta contable inactiva');
    if (this.planCuentaRepository.tieneHijos(cuentaContableId)) {
      throw new Error(`La cuenta "${cuenta.nombre}" es de agrupación (tiene subcuentas); seleccione una subcuenta imputable`);
    }

    this.repository.upsert(modulo, concepto.trim(), cuentaContableId);
  }
}

module.exports = MapeoContableService;
