const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  dashboard: {
    getStats: () => ipcRenderer.invoke('dashboard:getStats'),
    getChartData: () => ipcRenderer.invoke('dashboard:getChartData'),
    getActividadReciente: () => ipcRenderer.invoke('dashboard:getActividadReciente')
  },
  cuentas: {
    getAll: (params) => ipcRenderer.invoke('cuentas:getAll', params),
    getById: (id) => ipcRenderer.invoke('cuentas:getById', id),
    getCategorias: () => ipcRenderer.invoke('cuentas:getCategorias'),
    getStats: () => ipcRenderer.invoke('cuentas:getStats'),
    create: (cuentaData) => ipcRenderer.invoke('cuentas:create', cuentaData),
    update: (id, cuentaData) => ipcRenderer.invoke('cuentas:update', id, cuentaData),
    changeStatus: (id, estado) => ipcRenderer.invoke('cuentas:changeStatus', id, estado)
  },
  propietarios: {
    getAll: (params) => ipcRenderer.invoke('propietarios:getAll', params),
    getById: (id) => ipcRenderer.invoke('propietarios:getById', id),
    getStats: () => ipcRenderer.invoke('propietarios:getStats'),
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
  terceros: {
    getAll: (params) => ipcRenderer.invoke('terceros:getAll', params),
    getById: (id) => ipcRenderer.invoke('terceros:getById', id),
    create: (terceroData) => ipcRenderer.invoke('terceros:create', terceroData),
    update: (id, terceroData) => ipcRenderer.invoke('terceros:update', id, terceroData),
    toggleActivo: (id) => ipcRenderer.invoke('terceros:toggleActivo', id),
    getHistorialMovimientos: (id) => ipcRenderer.invoke('terceros:getHistorialMovimientos', id)
  },
  pagos: {
    getCuentasConEstado: (params) => ipcRenderer.invoke('pagos:getCuentasConEstado', params),
    getEstadoCuenta: (cuentaId) => ipcRenderer.invoke('pagos:getEstadoCuenta', cuentaId),
    simularPago: (cuentaId, anioInicio, mesInicio, cantidadMeses) => ipcRenderer.invoke('pagos:simularPago', cuentaId, anioInicio, mesInicio, cantidadMeses),
    registrarPagoSostenimiento: (payload) => ipcRenderer.invoke('pagos:registrarPagoSostenimiento', payload),
    getHistorialPagos: (cuentaId) => ipcRenderer.invoke('pagos:getHistorialPagos', cuentaId),
    imprimirEstadoCuenta: (cuentaId) => ipcRenderer.invoke('pagos:imprimirEstadoCuenta', cuentaId),
    exportarEstadoCuentaPDF: (cuentaId) => ipcRenderer.invoke('pagos:exportarEstadoCuentaPDF', cuentaId)
  },
  cartera: {
    getEstadoCartera: (cuentaId) => ipcRenderer.invoke('cartera:getEstadoCartera', cuentaId),
    getDetalleCartera: (cuentaId) => ipcRenderer.invoke('cartera:getDetalleCartera', cuentaId),
    getMotivoDiferencia: (cuentaId) => ipcRenderer.invoke('cartera:getMotivoDiferencia', cuentaId)
  },
  recibos: {
    getAll: (params) => ipcRenderer.invoke('recibos:getAll', params),
    getById: (id) => ipcRenderer.invoke('recibos:getById', id),
    anular: (id, motivo) => ipcRenderer.invoke('recibos:anular', id, motivo),
    corregirMetodoPago: (id, nuevoMetodoPago, motivo) => ipcRenderer.invoke('recibos:corregirMetodoPago', id, nuevoMetodoPago, motivo),
    registrarAnuladoFisico: (datos) => ipcRenderer.invoke('recibos:registrarAnuladoFisico', datos),
    getConsecutivo: () => ipcRenderer.invoke('recibos:getConsecutivo'),
    getAnuladosFisicos: () => ipcRenderer.invoke('recibos:getAnuladosFisicos'),
    imprimir: (id) => ipcRenderer.invoke('recibos:imprimir', id),
    exportarPDF: (id) => ipcRenderer.invoke('recibos:exportarPDF', id)
  },
  gastos: {
    getAll: (params) => ipcRenderer.invoke('gastos:getAll', params),
    getStats: (params) => ipcRenderer.invoke('gastos:getStats', params),
    getById: (id) => ipcRenderer.invoke('gastos:getById', id),
    getTiposGasto: () => ipcRenderer.invoke('gastos:getTiposGasto'),
    create: (gastoData) => ipcRenderer.invoke('gastos:create', gastoData),
    anular: (id, motivo) => ipcRenderer.invoke('gastos:anular', id, motivo),
    corregirMetodoPago: (id, nuevoMetodoPago, motivo) => ipcRenderer.invoke('gastos:corregirMetodoPago', id, nuevoMetodoPago, motivo),
    actualizarDatos: (payload) => ipcRenderer.invoke('gastos:actualizarDatos', payload),
    adjuntarSoporte: (gastoId, tipoSoporte) => ipcRenderer.invoke('gastos:adjuntarSoporte', gastoId, tipoSoporte),
    getSoportes: (gastoId) => ipcRenderer.invoke('gastos:getSoportes', gastoId),
    getSoporte: (gastoId, soporteId) => ipcRenderer.invoke('gastos:getSoporte', gastoId, soporteId)
  },
  caja: {
    getSaldos: () => ipcRenderer.invoke('caja:getSaldos'),
    getMovimientos: (params) => ipcRenderer.invoke('caja:getMovimientos', params),
    registrarConsignacion: (payload) => ipcRenderer.invoke('caja:registrarConsignacion', payload),
    registrarRetiro: (payload) => ipcRenderer.invoke('caja:registrarRetiro', payload),
    regularizarSaldos: (payload) => ipcRenderer.invoke('caja:regularizarSaldos', payload),
    getResumenPeriodo: (fechaDesde, fechaHasta) => ipcRenderer.invoke('caja:getResumenPeriodo', fechaDesde, fechaHasta)
  },
  cajaMenor: {
    getEstado: () => ipcRenderer.invoke('cajaMenor:getEstado'),
    getHistorialResponsables: () => ipcRenderer.invoke('cajaMenor:getHistorialResponsables'),
    asignarResponsable: (terceroId, fechaInicio, observaciones) => ipcRenderer.invoke('cajaMenor:asignarResponsable', terceroId, fechaInicio, observaciones),
    reembolsar: (payload) => ipcRenderer.invoke('cajaMenor:reembolsar', payload)
  },
  auth: {
    login: (usuario, password) => ipcRenderer.invoke('auth:login', usuario, password),
    logout: () => ipcRenderer.invoke('auth:logout'),
    cambiarPassword: (usuarioId, passwordActual, passwordNueva) => ipcRenderer.invoke('auth:cambiarPassword', usuarioId, passwordActual, passwordNueva)
  },
  usuarios: {
    getAll: () => ipcRenderer.invoke('usuarios:getAll'),
    crear: (datos) => ipcRenderer.invoke('usuarios:crear', datos),
    toggleActivo: (id, activo) => ipcRenderer.invoke('usuarios:toggleActivo', id, activo),
    resetearPassword: (id, passwordNueva) => ipcRenderer.invoke('usuarios:resetearPassword', id, passwordNueva)
  },
  auditoria: {
    getAll: (params) => ipcRenderer.invoke('auditoria:getAll', params)
  },
  config: {
    getAll: () => ipcRenderer.invoke('config:getAll'),
    actualizar: (datos) => ipcRenderer.invoke('config:actualizar', datos),
    subirLogo: () => ipcRenderer.invoke('config:subirLogo'),
    quitarLogo: () => ipcRenderer.invoke('config:quitarLogo'),
    getLogoBase64: () => ipcRenderer.invoke('config:getLogoBase64')
  },
  backup: {
    crear: () => ipcRenderer.invoke('backup:crear'),
    restaurar: () => ipcRenderer.invoke('backup:restaurar'),
    getEstadoAutomatico: () => ipcRenderer.invoke('backup:getEstadoAutomatico')
  },
  nuevosPuntos: {
    getAll: (params) => ipcRenderer.invoke('nuevospuntos:getAll', params),
    getById: (id) => ipcRenderer.invoke('nuevospuntos:getById', id),
    getByCuentaId: (cuentaId) => ipcRenderer.invoke('nuevospuntos:getByCuentaId', cuentaId),
    create: (datos) => ipcRenderer.invoke('nuevospuntos:create', datos),
    registrarAbono: (payload) => ipcRenderer.invoke('nuevospuntos:registrarAbono', payload),
    cancelar: (id, motivo) => ipcRenderer.invoke('nuevospuntos:cancelar', id, motivo)
  },
  reportes: {
    getDatos: (tipoReporte, params) => ipcRenderer.invoke('reportes:getDatos', tipoReporte, params),
    getVistaPreviaHTML: (tipoReporte, params) => ipcRenderer.invoke('reportes:getVistaPreviaHTML', tipoReporte, params),
    generarPDF: (tipoReporte, params) => ipcRenderer.invoke('reportes:generarPDF', tipoReporte, params),
    generarExcel: (tipoReporte, params) => ipcRenderer.invoke('reportes:generarExcel', tipoReporte, params)
  },
  planCuentas: {
    getAll: (params) => ipcRenderer.invoke('plancuentas:getAll', params),
    getImputables: (params) => ipcRenderer.invoke('plancuentas:getImputables', params),
    getById: (id) => ipcRenderer.invoke('plancuentas:getById', id),
    create: (cuentaData) => ipcRenderer.invoke('plancuentas:create', cuentaData),
    update: (id, cuentaData) => ipcRenderer.invoke('plancuentas:update', id, cuentaData),
    toggleActivo: (id) => ipcRenderer.invoke('plancuentas:toggleActivo', id)
  },
  mapeoContable: {
    getAll: (modulo) => ipcRenderer.invoke('mapeocontable:getAll', modulo),
    actualizar: (modulo, concepto, cuentaContableId) => ipcRenderer.invoke('mapeocontable:actualizar', modulo, concepto, cuentaContableId),
    crear: (modulo, concepto, cuentaContableId) => ipcRenderer.invoke('mapeocontable:crear', modulo, concepto, cuentaContableId)
  },
  asientos: {
    getAll: (params) => ipcRenderer.invoke('asientos:getAll', params),
    getById: (id) => ipcRenderer.invoke('asientos:getById', id),
    crearManual: (datos) => ipcRenderer.invoke('asientos:crearManual', datos),
    revertir: (id, motivo) => ipcRenderer.invoke('asientos:revertir', id, motivo),
    getLibroMayor: (cuentaContableId, fechaDesde, fechaHasta) => ipcRenderer.invoke('asientos:getLibroMayor', cuentaContableId, fechaDesde, fechaHasta),
    getBalancePrueba: (fechaDesde, fechaHasta) => ipcRenderer.invoke('asientos:getBalancePrueba', fechaDesde, fechaHasta),
    getConciliacionCajaBanco: () => ipcRenderer.invoke('asientos:getConciliacionCajaBanco'),
    imprimir: (id) => ipcRenderer.invoke('asientos:imprimir', id),
    exportarPDF: (id) => ipcRenderer.invoke('asientos:exportarPDF', id)
  },
  cuentasAutomaticas: {
    getAll: () => ipcRenderer.invoke('cuentasautomaticas:getAll'),
    actualizar: (clave, cuentaContableId) => ipcRenderer.invoke('cuentasautomaticas:actualizar', clave, cuentaContableId)
  },
  periodos: {
    getAll: () => ipcRenderer.invoke('periodos:getAll'),
    getByAnioMes: (anio, mes) => ipcRenderer.invoke('periodos:getByAnioMes', anio, mes),
    cerrar: (id, motivoCierre) => ipcRenderer.invoke('periodos:cerrar', id, motivoCierre),
    bloquear: (id, motivoCierre) => ipcRenderer.invoke('periodos:bloquear', id, motivoCierre),
    reabrir: (id) => ipcRenderer.invoke('periodos:reabrir', id),
    actualizarNotas: (id, notas) => ipcRenderer.invoke('periodos:actualizarNotas', id, notas)
  },
  contabilidad: {
    getDashboard: () => ipcRenderer.invoke('contabilidad:getDashboard')
  },
  plantillas: {
    getAll: () => ipcRenderer.invoke('plantillas:getAll'),
    getById: (id) => ipcRenderer.invoke('plantillas:getById', id),
    getVersiones: (codigo) => ipcRenderer.invoke('plantillas:getVersiones', codigo),
    actualizarLineas: (id, nuevasLineas) => ipcRenderer.invoke('plantillas:actualizarLineas', id, nuevasLineas),
    simularContabilizacion: (plantillaId, contextoJson) => ipcRenderer.invoke('plantillas:simularContabilizacion', plantillaId, contextoJson)
  },
  impuestos: {
    getAll: () => ipcRenderer.invoke('impuestos:getAll'),
    getById: (id) => ipcRenderer.invoke('impuestos:getById', id),
    create: (datos) => ipcRenderer.invoke('impuestos:create', datos),
    update: (id, datos) => ipcRenderer.invoke('impuestos:update', id, datos),
    toggleActivo: (id) => ipcRenderer.invoke('impuestos:toggleActivo', id),
    asignarAPlantilla: (plantillaId, impuestoId, orden) => ipcRenderer.invoke('impuestos:asignarAPlantilla', plantillaId, impuestoId, orden),
    quitarDePlantilla: (plantillaId, impuestoId) => ipcRenderer.invoke('impuestos:quitarDePlantilla', plantillaId, impuestoId),
    getPlantillasAsignadas: (impuestoId) => ipcRenderer.invoke('impuestos:getPlantillasAsignadas', impuestoId)
  },
  devtools: {
    tieneDatosOperativos: () => ipcRenderer.invoke('devtools:tieneDatosOperativos')
  },
  sistema: {
    abrirEnlaceExterno: (url) => ipcRenderer.invoke('sistema:abrirEnlaceExterno', url)
  },
  cloudBackup: {
    getEstado: () => ipcRenderer.invoke('cloudBackup:getEstado'),
    getRespaldosDisponibles: () => ipcRenderer.invoke('cloudBackup:getRespaldosDisponibles'),
    conectar: () => ipcRenderer.invoke('cloudBackup:conectar'),
    desconectar: () => ipcRenderer.invoke('cloudBackup:desconectar'),
    configurarEquipo: (nombreEquipo) => ipcRenderer.invoke('cloudBackup:configurarEquipo', nombreEquipo),
    respaldarAhora: (opciones) => ipcRenderer.invoke('cloudBackup:respaldarAhora', opciones),
    actualizarDesdeNube: () => ipcRenderer.invoke('cloudBackup:actualizarDesdeNube'),
    actualizarSiHayNuevo: () => ipcRenderer.invoke('cloudBackup:actualizarSiHayNuevo'),
    getActualizacionPendiente: () => ipcRenderer.invoke('cloudBackup:getActualizacionPendiente')
  }
});
