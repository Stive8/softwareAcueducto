const CategoriaRepository = require('../repositories/CategoriaRepository');

class CategoriaService {
  constructor(dbService) {
    this.repository = new CategoriaRepository(dbService);
  }

  getAll(params = {}) {
    return this.repository.findAll(params);
  }

  getById(id) {
    return this.repository.findById(id);
  }

  create(categoriaData) {
    if (!categoriaData.nombre || !categoriaData.nombre.trim()) {
      throw new Error('El nombre de la categoría es obligatorio');
    }

    const existente = this.repository.findByNombre(categoriaData.nombre);
    if (existente) {
      throw new Error('Ya existe una categoría con ese nombre');
    }

    return this.repository.create(categoriaData);
  }

  update(id, categoriaData) {
    if (!categoriaData.nombre || !categoriaData.nombre.trim()) {
      throw new Error('El nombre de la categoría es obligatorio');
    }

    const categoria = this.repository.findById(id);
    if (!categoria) {
      throw new Error('Categoría no encontrada');
    }

    if (categoria.nombre !== categoriaData.nombre) {
      const existente = this.repository.findByNombre(categoriaData.nombre);
      if (existente) {
        throw new Error('Ya existe otra categoría con ese nombre');
      }
    }

    this.repository.update(id, categoriaData);
  }

  toggleActivo(id) {
    const categoria = this.repository.findById(id);
    if (!categoria) {
      throw new Error('Categoría no encontrada');
    }

    this.repository.toggleActivo(id);
  }

  // Tarifas
  getTarifaVigente(categoriaId, fecha = null) {
    return this.repository.getTarifaVigente(categoriaId, fecha);
  }

  getHistorialTarifas(categoriaId) {
    return this.repository.getHistorialTarifas(categoriaId);
  }

  crearTarifa(categoriaId, tarifa, fechaDesde, observaciones = null) {
    if (!categoriaId || !tarifa) {
      throw new Error('Categoría y tarifa son obligatorios');
    }

    if (tarifa <= 0) {
      throw new Error('La tarifa debe ser mayor a cero');
    }

    if (!fechaDesde) {
      fechaDesde = new Date().toISOString().split('T')[0];
    }

    return this.repository.crearTarifa(categoriaId, tarifa, fechaDesde, observaciones);
  }

  // Asignación a cuentas
  getCuentasConCategoria(categoriaId) {
    return this.repository.getCuentasConCategoria(categoriaId);
  }

  getCategoriaActualCuenta(cuentaId) {
    return this.repository.getCategoriaActualCuenta(cuentaId);
  }

  getHistorialCategoriasCuenta(cuentaId) {
    return this.repository.getHistorialCategoriasCuenta(cuentaId);
  }
}

module.exports = CategoriaService;
