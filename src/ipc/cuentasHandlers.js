function registrarCuentasHandlers({ envolverHandle, cuentaService, propietarioService, categoriaService, terceroService }) {
  // Cuentas
  envolverHandle('cuentas:getAll', async (event, params) => {
    try {
      return { success: true, data: cuentaService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentas:getById', async (event, id) => {
    try {
      const cuenta = cuentaService.getById(id);
      if (!cuenta) {
        return { success: false, error: 'Cuenta no encontrada' };
      }
      return { success: true, data: cuenta };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentas:getCategorias', async () => {
    try {
      return { success: true, data: cuentaService.getCategorias() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentas:getStats', async () => {
    try {
      return { success: true, data: cuentaService.getStats() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentas:create', async (event, cuentaData) => {
    try {
      const id = cuentaService.create(cuentaData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentas:update', async (event, id, cuentaData) => {
    try {
      cuentaService.update(id, cuentaData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Propietarios
  envolverHandle('propietarios:getAll', async (event, params) => {
    try {
      return { success: true, data: propietarioService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:getStats', async () => {
    try {
      return { success: true, data: propietarioService.getStats() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:getById', async (event, id) => {
    try {
      const propietario = propietarioService.getById(id);
      if (!propietario) {
        return { success: false, error: 'Propietario no encontrado' };
      }
      return { success: true, data: propietario };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:create', async (event, propietarioData) => {
    try {
      const id = propietarioService.create(propietarioData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:update', async (event, id, propietarioData) => {
    try {
      propietarioService.update(id, propietarioData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:getCuentasActuales', async (event, propietarioId) => {
    try {
      return { success: true, data: propietarioService.getCuentasActuales(propietarioId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:getHistorialCuentas', async (event, propietarioId) => {
    try {
      return { success: true, data: propietarioService.getHistorialCuentas(propietarioId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:asignarACuenta', async (event, cuentaId, propietarioId, fechaInicio, observaciones) => {
    try {
      propietarioService.asignarACuenta(cuentaId, propietarioId, fechaInicio, observaciones);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('propietarios:getHistorialPropietariosCuenta', async (event, cuentaId) => {
    try {
      return { success: true, data: propietarioService.getHistorialPropietariosCuenta(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Categorías
  envolverHandle('categorias:getAll', async (event, params) => {
    try {
      return { success: true, data: categoriaService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:getById', async (event, id) => {
    try {
      const categoria = categoriaService.getById(id);
      if (!categoria) {
        return { success: false, error: 'Categoría no encontrada' };
      }
      return { success: true, data: categoria };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:create', async (event, categoriaData) => {
    try {
      const id = categoriaService.create(categoriaData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:update', async (event, id, categoriaData) => {
    try {
      categoriaService.update(id, categoriaData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:toggleActivo', async (event, id) => {
    try {
      categoriaService.toggleActivo(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:getTarifaVigente', async (event, categoriaId, fecha) => {
    try {
      return { success: true, data: categoriaService.getTarifaVigente(categoriaId, fecha) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Terceros (proveedores y otros aliados; los clientes siguen siendo Propietarios)
  envolverHandle('terceros:getAll', async (event, params) => {
    try {
      return { success: true, data: terceroService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('terceros:getById', async (event, id) => {
    try {
      const tercero = terceroService.getById(id);
      if (!tercero) {
        return { success: false, error: 'Tercero no encontrado' };
      }
      return { success: true, data: tercero };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('terceros:create', async (event, terceroData) => {
    try {
      const id = terceroService.create(terceroData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('terceros:update', async (event, id, terceroData) => {
    try {
      terceroService.update(id, terceroData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('terceros:toggleActivo', async (event, id) => {
    try {
      terceroService.toggleActivo(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('terceros:getHistorialMovimientos', async (event, id) => {
    try {
      return { success: true, data: terceroService.getHistorialMovimientos(id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:getHistorialTarifas', async (event, categoriaId) => {
    try {
      return { success: true, data: categoriaService.getHistorialTarifas(categoriaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:crearTarifa', async (event, categoriaId, tarifa, fechaDesde, observaciones) => {
    try {
      categoriaService.crearTarifa(categoriaId, tarifa, fechaDesde, observaciones);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:getCuentasConCategoria', async (event, categoriaId) => {
    try {
      return { success: true, data: categoriaService.getCuentasConCategoria(categoriaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('categorias:getHistorialCategoriasCuenta', async (event, cuentaId) => {
    try {
      return { success: true, data: categoriaService.getHistorialCategoriasCuenta(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registrarCuentasHandlers };
