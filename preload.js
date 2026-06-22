const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  dashboard: {
    getStats: () => ipcRenderer.invoke('dashboard:getStats'),
    getChartData: () => ipcRenderer.invoke('dashboard:getChartData')
  },
  cuentas: {
    getAll: (params) => ipcRenderer.invoke('cuentas:getAll', params),
    getById: (id) => ipcRenderer.invoke('cuentas:getById', id),
    getCategorias: () => ipcRenderer.invoke('cuentas:getCategorias'),
    create: (cuentaData) => ipcRenderer.invoke('cuentas:create', cuentaData),
    update: (id, cuentaData) => ipcRenderer.invoke('cuentas:update', id, cuentaData),
    changeStatus: (id, estado) => ipcRenderer.invoke('cuentas:changeStatus', id, estado)
  },
  propietarios: {
    getAll: (params) => ipcRenderer.invoke('propietarios:getAll', params),
    getById: (id) => ipcRenderer.invoke('propietarios:getById', id),
    create: (propietarioData) => ipcRenderer.invoke('propietarios:create', propietarioData),
    update: (id, propietarioData) => ipcRenderer.invoke('propietarios:update', id, propietarioData),
    getCuentasActuales: (propietarioId) => ipcRenderer.invoke('propietarios:getCuentasActuales', propietarioId),
    getHistorialCuentas: (propietarioId) => ipcRenderer.invoke('propietarios:getHistorialCuentas', propietarioId),
    asignarACuenta: (cuentaId, propietarioId, fechaInicio, observaciones) => ipcRenderer.invoke('propietarios:asignarACuenta', cuentaId, propietarioId, fechaInicio, observaciones),
    getHistorialPropietariosCuenta: (cuentaId) => ipcRenderer.invoke('propietarios:getHistorialPropietariosCuenta', cuentaId)
  },
  categorias: {
    getAll: (params) => ipcRenderer.invoke('categorias:getAll', params),
    getById: (id) => ipcRenderer.invoke('categorias:getById', id),
    create: (categoriaData) => ipcRenderer.invoke('categorias:create', categoriaData),
    update: (id, categoriaData) => ipcRenderer.invoke('categorias:update', id, categoriaData),
    toggleActivo: (id) => ipcRenderer.invoke('categorias:toggleActivo', id),
    getTarifaVigente: (categoriaId, fecha) => ipcRenderer.invoke('categorias:getTarifaVigente', categoriaId, fecha),
    getHistorialTarifas: (categoriaId) => ipcRenderer.invoke('categorias:getHistorialTarifas', categoriaId),
    crearTarifa: (categoriaId, tarifa, fechaDesde, observaciones) => ipcRenderer.invoke('categorias:crearTarifa', categoriaId, tarifa, fechaDesde, observaciones),
    getCuentasConCategoria: (categoriaId) => ipcRenderer.invoke('categorias:getCuentasConCategoria', categoriaId),
    asignarACuenta: (cuentaId, categoriaId, fechaInicio, observaciones) => ipcRenderer.invoke('categorias:asignarACuenta', cuentaId, categoriaId, fechaInicio, observaciones),
    getHistorialCategoriasCuenta: (cuentaId) => ipcRenderer.invoke('categorias:getHistorialCategoriasCuenta', cuentaId)
  },
  pagos: {
    getCuentasConEstado: (params) => ipcRenderer.invoke('pagos:getCuentasConEstado', params),
    getEstadoCuenta: (cuentaId) => ipcRenderer.invoke('pagos:getEstadoCuenta', cuentaId),
    simularPago: (cuentaId, anioInicio, mesInicio, cantidadMeses) => ipcRenderer.invoke('pagos:simularPago', cuentaId, anioInicio, mesInicio, cantidadMeses),
    registrarPagoSostenimiento: (payload) => ipcRenderer.invoke('pagos:registrarPagoSostenimiento', payload),
    registrarAbono: (payload) => ipcRenderer.invoke('pagos:registrarAbono', payload),
    getHistorialPagos: (cuentaId) => ipcRenderer.invoke('pagos:getHistorialPagos', cuentaId)
  },
  recibos: {
    getAll: (params) => ipcRenderer.invoke('recibos:getAll', params),
    getById: (id) => ipcRenderer.invoke('recibos:getById', id),
    imprimir: (id) => ipcRenderer.invoke('recibos:imprimir', id),
    exportarPDF: (id) => ipcRenderer.invoke('recibos:exportarPDF', id)
  },
  gastos: {
    getAll: (params) => ipcRenderer.invoke('gastos:getAll', params),
    getById: (id) => ipcRenderer.invoke('gastos:getById', id),
    getTiposGasto: () => ipcRenderer.invoke('gastos:getTiposGasto'),
    create: (gastoData) => ipcRenderer.invoke('gastos:create', gastoData),
    anular: (id, motivo) => ipcRenderer.invoke('gastos:anular', id, motivo)
  },
  caja: {
    getSaldos: () => ipcRenderer.invoke('caja:getSaldos'),
    getMovimientos: (params) => ipcRenderer.invoke('caja:getMovimientos', params),
    registrarConsignacion: (payload) => ipcRenderer.invoke('caja:registrarConsignacion', payload)
  },
  auth: {
    login: (usuario, password) => ipcRenderer.invoke('auth:login', usuario, password),
    cambiarPassword: (usuarioId, passwordActual, passwordNueva) => ipcRenderer.invoke('auth:cambiarPassword', usuarioId, passwordActual, passwordNueva)
  },
  config: {
    getAll: () => ipcRenderer.invoke('config:getAll'),
    actualizar: (datos) => ipcRenderer.invoke('config:actualizar', datos)
  },
  backup: {
    crear: () => ipcRenderer.invoke('backup:crear'),
    restaurar: () => ipcRenderer.invoke('backup:restaurar')
  },
  nuevosPuntos: {
    getAll: (params) => ipcRenderer.invoke('nuevospuntos:getAll', params),
    getById: (id) => ipcRenderer.invoke('nuevospuntos:getById', id),
    create: (datos) => ipcRenderer.invoke('nuevospuntos:create', datos),
    registrarAbono: (payload) => ipcRenderer.invoke('nuevospuntos:registrarAbono', payload),
    cancelar: (id, motivo) => ipcRenderer.invoke('nuevospuntos:cancelar', id, motivo)
  },
  reportes: {
    generarPDF: (tipoReporte, params) => ipcRenderer.invoke('reportes:generarPDF', tipoReporte, params),
    generarExcel: (tipoReporte, params) => ipcRenderer.invoke('reportes:generarExcel', tipoReporte, params)
  }
});
