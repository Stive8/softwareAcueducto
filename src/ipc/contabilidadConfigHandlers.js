const { getSesionActual } = require('./sesion');

function registrarContabilidadConfigHandlers({
  envolverHandle, planCuentaService, mapeoContableService, cuentaAutomaticaService,
  periodoContableService, reporteService, plantillaContabilizacionService,
  impuestoService, motorContabilizacionService
}) {
  // Plan de Cuentas (PUC) y mapeo contable. Preparación para una futura contabilidad de doble
  // partida: por ahora solo administra el catálogo y la clasificación, sin generar asientos.
  envolverHandle('plancuentas:getAll', async (event, params) => {
    try {
      return { success: true, data: planCuentaService.getAll(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('plancuentas:getImputables', async (event, params) => {
    try {
      return { success: true, data: planCuentaService.getImputables(params) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('plancuentas:getById', async (event, id) => {
    try {
      const cuenta = planCuentaService.getById(id);
      if (!cuenta) return { success: false, error: 'Cuenta contable no encontrada' };
      return { success: true, data: cuenta };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('plancuentas:create', async (event, cuentaData) => {
    try {
      const id = planCuentaService.create(cuentaData);
      return { success: true, data: { id } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('plancuentas:update', async (event, id, cuentaData) => {
    try {
      planCuentaService.update(id, cuentaData);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('plancuentas:toggleActivo', async (event, id) => {
    try {
      planCuentaService.toggleActivo(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('mapeocontable:getAll', async (event, modulo) => {
    try {
      return { success: true, data: mapeoContableService.getAll(modulo) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('mapeocontable:actualizar', async (event, modulo, concepto, cuentaContableId) => {
    try {
      mapeoContableService.actualizar(modulo, concepto, cuentaContableId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('mapeocontable:crear', async (event, modulo, concepto, cuentaContableId) => {
    try {
      mapeoContableService.crear(modulo, concepto, cuentaContableId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cuentas Automáticas: las cuentas contables que el sistema usa sin que el operador tenga que
  // elegirlas explícitamente (Caja, Banco, Cartera de Usuarios). Solo el Administrador puede
  // reasignar a qué cuenta PUC apunta cada clave.
  envolverHandle('cuentasautomaticas:getAll', async () => {
    try {
      return { success: true, data: cuentaAutomaticaService.getAll() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cuentasautomaticas:actualizar', async (event, clave, cuentaContableId) => {
    try {
      return { success: true, data: cuentaAutomaticaService.actualizar(clave, cuentaContableId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Períodos Contables: administración de aperturas y cierres de períodos mes/año.
  envolverHandle('periodos:getAll', async () => {
    try {
      return { success: true, data: periodoContableService.getAll() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('periodos:getByAnioMes', async (event, anio, mes) => {
    try {
      return { success: true, data: periodoContableService.getByAnioMes(anio, mes) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('periodos:cerrar', async (event, id, motivoCierre) => {
    try {
      return { success: true, data: periodoContableService.cerrar(id, getSesionActual().id, motivoCierre) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('periodos:bloquear', async (event, id, motivoCierre) => {
    try {
      return { success: true, data: periodoContableService.bloquear(id, getSesionActual().id, motivoCierre) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('periodos:reabrir', async (event, id) => {
    try {
      return { success: true, data: periodoContableService.reabrir(id) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('periodos:actualizarNotas', async (event, id, notas) => {
    try {
      return { success: true, data: periodoContableService.actualizarNotas(id, notas) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Dashboard contable: KPIs del módulo de Contabilidad.
  envolverHandle('contabilidad:getDashboard', async () => {
    try {
      return { success: true, data: reporteService.getDashboardContable() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Plantillas de contabilización: catálogo de patrones de asiento configurables.
  envolverHandle('plantillas:getAll', async () => {
    try { return { success: true, data: plantillaContabilizacionService.getAll() }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('plantillas:getById', async (event, id) => {
    try { return { success: true, data: plantillaContabilizacionService.getById(id) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('plantillas:getVersiones', async (event, codigo) => {
    try { return { success: true, data: plantillaContabilizacionService.getVersiones(codigo) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('plantillas:actualizarLineas', async (event, id, nuevasLineas) => {
    try { return { success: true, data: plantillaContabilizacionService.actualizarLineas(id, nuevasLineas) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  // Prefijo 'simular' → lectura automática (cualquier rol puede usar la herramienta de simulación)
  envolverHandle('plantillas:simularContabilizacion', async (event, plantillaId, contextoJson) => {
    try { return { success: true, data: motorContabilizacionService.simularContabilizacion(plantillaId, contextoJson) }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  // Motor tributario: impuestos configurables.
  envolverHandle('impuestos:getAll', async () => {
    try { return { success: true, data: impuestoService.getAll() }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:getById', async (event, id) => {
    try { return { success: true, data: impuestoService.getById(id) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:create', async (event, datos) => {
    try {
      const imp = impuestoService.create(datos);
      return { success: true, data: imp };
    } catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:update', async (event, id, datos) => {
    try {
      const imp = impuestoService.update(id, datos);
      return { success: true, data: imp };
    } catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:toggleActivo', async (event, id) => {
    try { return { success: true, data: impuestoService.toggleActivo(id) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:asignarAPlantilla', async (event, plantillaId, impuestoId, orden) => {
    try { impuestoService.asignarAPlantilla(plantillaId, impuestoId, orden); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:quitarDePlantilla', async (event, plantillaId, impuestoId) => {
    try { impuestoService.quitarDePlantilla(plantillaId, impuestoId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  envolverHandle('impuestos:getPlantillasAsignadas', async (event, impuestoId) => {
    try { return { success: true, data: impuestoService.getPlantillasAsignadas(impuestoId) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
}

module.exports = { registrarContabilidadConfigHandlers };
