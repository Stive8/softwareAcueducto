const CuentaRepository = require('../repositories/CuentaRepository');

class CuentaService {
  constructor(dbService) {
    this.repository = new CuentaRepository(dbService);
  }

  getAll(params) {
    return this.repository.findAll(params);
  }

  getById(id) {
    return this.repository.findById(id);
  }

  getCategorias() {
    return this.repository.getCategorias();
  }

  create(cuentaData) {
    if (!cuentaData.codigo || !cuentaData.codigo.trim()) {
      throw new Error('El código de cuenta es obligatorio');
    }

    if (!cuentaData.direccion || !cuentaData.direccion.trim()) {
      throw new Error('La dirección es obligatoria');
    }

    if (!cuentaData.categoria_id) {
      throw new Error('La categoría es obligatoria');
    }

    const existente = this.repository.findByCodigo(cuentaData.codigo);
    if (existente) {
      throw new Error('Ya existe una cuenta con ese código');
    }

    return this.repository.create(cuentaData);
  }

  update(id, cuentaData) {
    if (!cuentaData.codigo || !cuentaData.codigo.trim()) {
      throw new Error('El código de cuenta es obligatorio');
    }

    if (!cuentaData.direccion || !cuentaData.direccion.trim()) {
      throw new Error('La dirección es obligatoria');
    }

    const cuenta = this.repository.findById(id);
    if (!cuenta) {
      throw new Error('Cuenta no encontrada');
    }

    if (cuenta.codigo !== cuentaData.codigo) {
      const existente = this.repository.findByCodigo(cuentaData.codigo);
      if (existente) {
        throw new Error('Ya existe otra cuenta con ese código');
      }
    }

    this.repository.update(id, cuentaData);
  }

  changeStatus(id, estado) {
    const estadosValidos = ['Activo', 'Inactivo', 'Suspendido'];
    if (!estadosValidos.includes(estado)) {
      throw new Error('Estado inválido');
    }

    const cuenta = this.repository.findById(id);
    if (!cuenta) {
      throw new Error('Cuenta no encontrada');
    }

    this.repository.changeStatus(id, estado);
  }
}

module.exports = CuentaService;
