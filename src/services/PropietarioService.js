const PropietarioRepository = require('../repositories/PropietarioRepository');

class PropietarioService {
  constructor(dbService) {
    this.repository = new PropietarioRepository(dbService);
  }

  getAll(params) {
    return this.repository.findAll(params);
  }

  getById(id) {
    return this.repository.findById(id);
  }

  getStats() {
    return this.repository.getStats();
  }

  create(propietarioData) {
    if (!propietarioData.nombre_completo || !propietarioData.nombre_completo.trim()) {
      throw new Error('El nombre completo es obligatorio');
    }

    if (propietarioData.numero_identificacion) {
      const existente = this.repository.findByIdentificacion(propietarioData.numero_identificacion);
      if (existente) {
        throw new Error('Ya existe un propietario con ese número de identificación');
      }
    }

    return this.repository.create(propietarioData);
  }

  update(id, propietarioData) {
    if (!propietarioData.nombre_completo || !propietarioData.nombre_completo.trim()) {
      throw new Error('El nombre completo es obligatorio');
    }

    const propietario = this.repository.findById(id);
    if (!propietario) {
      throw new Error('Propietario no encontrado');
    }

    if (propietarioData.numero_identificacion && 
        propietario.numero_identificacion !== propietarioData.numero_identificacion) {
      const existente = this.repository.findByIdentificacion(propietarioData.numero_identificacion);
      if (existente) {
        throw new Error('Ya existe otro propietario con ese número de identificación');
      }
    }

    this.repository.update(id, propietarioData);
  }

  getCuentasActuales(propietarioId) {
    return this.repository.getCuentasActuales(propietarioId);
  }

  getHistorialCuentas(propietarioId) {
    return this.repository.getHistorialCuentas(propietarioId);
  }

  asignarACuenta(cuentaId, propietarioId, fechaInicio, observaciones = null) {
    if (!cuentaId || !propietarioId) {
      throw new Error('Cuenta y propietario son obligatorios');
    }

    if (!fechaInicio) {
      fechaInicio = new Date().toISOString().split('T')[0];
    }

    return this.repository.asignarACuenta(cuentaId, propietarioId, fechaInicio, observaciones);
  }

  getPropietarioActualCuenta(cuentaId) {
    return this.repository.getPropietarioActualCuenta(cuentaId);
  }

  getHistorialPropietariosCuenta(cuentaId) {
    return this.repository.getHistorialPropietariosCuenta(cuentaId);
  }
}

module.exports = PropietarioService;
