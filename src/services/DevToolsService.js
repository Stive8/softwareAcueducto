const CuentaService = require('./CuentaService');
const PropietarioService = require('./PropietarioService');
const CategoriaRepository = require('../repositories/CategoriaRepository');
const CategoriaService = require('./CategoriaService');
const PagoService = require('./PagoService');
const GastoService = require('./GastoService');
const NuevoPuntoService = require('./NuevoPuntoService');
const TerceroService = require('./TerceroService');
const AsientoContableService = require('./AsientoContableService');

// Utilidad exclusiva para pruebas/demostración: nunca se ejecuta automáticamente (no hay
// migración ni arranque que la dispare), solo a través de un botón explícito en Configuración.
// Permite cargar y eliminar datos de ejemplo mientras se valida el sistema, sin que esos datos
// terminen empaquetados en una instalación real (a diferencia de la antigua migración 002).
class DevToolsService {
  constructor(dbService) {
    this.db = dbService.getDb();
    this.cuentaService = new CuentaService(dbService);
    this.propietarioService = new PropietarioService(dbService);
    this.categoriaRepository = new CategoriaRepository(dbService);
    this.categoriaService = new CategoriaService(dbService);
    this.pagoService = new PagoService(dbService);
    this.gastoService = new GastoService(dbService);
    this.nuevoPuntoService = new NuevoPuntoService(dbService);
    this.terceroService = new TerceroService(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
  }

  tieneDatosOperativos() {
    const { c } = this.db.prepare('SELECT COUNT(*) as c FROM cuentas').get();
    return c > 0;
  }

  cargarDatosEjemplo() {
    if (this.tieneDatosOperativos()) {
      throw new Error('Ya existen cuentas registradas. Elimina los datos operativos antes de cargar datos de ejemplo.');
    }

    const finca = this.categoriaRepository.findByNombre('Finca');
    const fincaPiscina = this.categoriaRepository.findByNombre('Finca con piscina');
    const tienda = this.categoriaRepository.findByNombre('Tienda');
    if (!finca || !fincaPiscina || !tienda) {
      throw new Error('No se encontraron las categorías base; verifique que la migración inicial se haya ejecutado');
    }

    const anio = new Date().getFullYear();
    const fechaInicioCategoria = `${anio}-01-01`;
    const hoy = new Date().toISOString().split('T')[0];
    const mesActual = new Date().getMonth() + 1;
    const mesesAlDia = Math.max(mesActual - 1, 1);

    return this.db.transaction(() => {
      // Las categorías ya no traen una tarifa sembrada por defecto (serían precios ficticios
      // en una instalación real), así que el modo de pruebas registra sus propias tarifas de
      // ejemplo, claramente marcadas como tales, solo para poder simular pagos.
      this.categoriaService.crearTarifa(finca.id, 10000, fechaInicioCategoria, 'Tarifa de ejemplo (Modo de Pruebas)');
      this.categoriaService.crearTarifa(fincaPiscina.id, 16000, fechaInicioCategoria, 'Tarifa de ejemplo (Modo de Pruebas)');
      this.categoriaService.crearTarifa(tienda.id, 20000, fechaInicioCategoria, 'Tarifa de ejemplo (Modo de Pruebas)');

      // Cuenta 1: al día (paga todos los meses transcurridos hasta el anterior al actual)
      const cuenta1 = this.cuentaService.create({ codigo: 'DEMO-001', direccion: 'Vereda El Porvenir, Casa Principal', categoria_id: finca.id, categoria_fecha_inicio: fechaInicioCategoria });
      const prop1 = this.propietarioService.create({ nombre_completo: 'Juan Pérez Gómez (Ejemplo)', numero_identificacion: 'DEMO-12345678', telefono: '3101234567' });
      this.propietarioService.asignarACuenta(cuenta1, prop1, fechaInicioCategoria);
      if (mesesAlDia > 0) {
        this.pagoService.registrarPagoSostenimiento({ cuentaId: cuenta1, anioInicio: anio, mesInicio: 1, cantidadMeses: mesesAlDia, fechaPago: hoy, metodoPago: 'Efectivo' });
      }

      // Cuenta 2: en mora (sin ningún pago registrado)
      const cuenta2 = this.cuentaService.create({ codigo: 'DEMO-002', direccion: 'Vereda San José, Km 2 vía principal', categoria_id: tienda.id, categoria_fecha_inicio: fechaInicioCategoria });
      const prop2 = this.propietarioService.create({ nombre_completo: 'María Rodríguez (Ejemplo)', numero_identificacion: 'DEMO-23456789', telefono: '3109876543' });
      this.propietarioService.asignarACuenta(cuenta2, prop2, fechaInicioCategoria);

      // Cuenta 3: pagó varios meses por adelantado (para probar el caso de cuentas al día con margen)
      const cuenta3 = this.cuentaService.create({ codigo: 'DEMO-003', direccion: 'Vereda El Carmen, Sector Alto', categoria_id: finca.id, categoria_fecha_inicio: fechaInicioCategoria });
      const prop3 = this.propietarioService.create({ nombre_completo: 'Carlos Martínez (Ejemplo)', numero_identificacion: 'DEMO-34567890' });
      this.propietarioService.asignarACuenta(cuenta3, prop3, fechaInicioCategoria);
      this.pagoService.registrarPagoSostenimiento({ cuentaId: cuenta3, anioInicio: anio, mesInicio: 1, cantidadMeses: mesesAlDia + 3, fechaPago: hoy, metodoPago: 'Transferencia', observaciones: 'Pago de ejemplo por adelantado' });

      // Cuenta 4: suspendida (sin pagos, para probar el filtro de estado)
      const cuenta4 = this.cuentaService.create({ codigo: 'DEMO-004', direccion: 'Vereda El Porvenir, Lote 3', categoria_id: finca.id, categoria_fecha_inicio: fechaInicioCategoria, estado: 'Suspendido', observaciones: 'Suspendida por falta de pago (ejemplo)' });
      const prop4 = this.propietarioService.create({ nombre_completo: 'Pedro Gutiérrez (Ejemplo)', numero_identificacion: 'DEMO-45678901' });
      this.propietarioService.asignarACuenta(cuenta4, prop4, fechaInicioCategoria);

      // Cuenta 5: finca con piscina, al día, para variedad de categoría/tarifa
      const cuenta5 = this.cuentaService.create({ codigo: 'DEMO-005', direccion: 'Vereda El Porvenir, Hotel Rural', categoria_id: fincaPiscina.id, categoria_fecha_inicio: fechaInicioCategoria });
      const prop5 = this.propietarioService.create({ nombre_completo: 'Turismo Rural SAS (Ejemplo)', numero_identificacion: 'DEMO-900123456' });
      this.propietarioService.asignarACuenta(cuenta5, prop5, fechaInicioCategoria);
      if (mesesAlDia > 0) {
        this.pagoService.registrarPagoSostenimiento({ cuentaId: cuenta5, anioInicio: anio, mesInicio: 1, cantidadMeses: mesesAlDia, fechaPago: hoy, metodoPago: 'Transferencia' });
      }

      // Terceros de ejemplo: dos proveedores (uno persona, uno empresa) y uno que presta un
      // servicio profesional (marcado "Otro", no "Proveedor", para probar esa distinción).
      const provFontaneria = this.terceroService.create({
        tipoIdentificacion: 'NIT', numeroIdentificacion: '900111222', nombreRazonSocial: 'Fontanería El Río SAS (Ejemplo)',
        telefono: '3201112233', esProveedor: true, esOtro: false
      });
      const provFerreteria = this.terceroService.create({
        tipoIdentificacion: 'NIT', numeroIdentificacion: '900333444', nombreRazonSocial: 'Ferretería El Tubo SAS (Ejemplo)',
        telefono: '3204445566', esProveedor: true, esOtro: false
      });
      const provEnergia = this.terceroService.create({
        tipoIdentificacion: 'NIT', numeroIdentificacion: '900555666', nombreRazonSocial: 'Empresa de Energía (Ejemplo)',
        telefono: '6017778899', esProveedor: true, esOtro: false
      });
      const contadorExterno = this.terceroService.create({
        tipoIdentificacion: 'Cédula de Ciudadanía', numeroIdentificacion: '10203040', nombreRazonSocial: 'Ana Contreras, Contadora (Ejemplo)',
        telefono: '3159998877', esProveedor: false, esOtro: true
      });

      // Gastos de ejemplo: cubren varios tipos distintos (varias cuentas del plan de cuentas),
      // cada uno con su tercero real, y uno se anula para poder probar la reversión contable.
      this.gastoService.create({ fechaGasto: hoy, concepto: 'Mantenimiento tubería principal (Ejemplo)', tipoGasto: 'Mantenimiento', terceroId: provFontaneria, valor: 350000, metodoPago: 'Efectivo' });
      this.gastoService.create({ fechaGasto: hoy, concepto: 'Accesorios y tubería PVC (Ejemplo)', tipoGasto: 'Accesorios y Materiales', terceroId: provFerreteria, valor: 85000, metodoPago: 'Efectivo' });
      this.gastoService.create({ fechaGasto: hoy, concepto: 'Pago energía eléctrica (Ejemplo)', tipoGasto: 'Energía Eléctrica', terceroId: provEnergia, valor: 180000, metodoPago: 'Transferencia' });
      this.gastoService.create({ fechaGasto: hoy, concepto: 'Honorarios contables del mes (Ejemplo)', tipoGasto: 'Honorarios', terceroId: contadorExterno, valor: 250000, metodoPago: 'Transferencia' });
      const gastoIdAnulado = this.gastoService.create({ fechaGasto: hoy, concepto: 'Papelería pedida por error (Ejemplo)', tipoGasto: 'Papelería', terceroId: provFerreteria, valor: 45000, metodoPago: 'Efectivo' });
      this.gastoService.anular(gastoIdAnulado, 'Pedido duplicado por error (Ejemplo, para probar la reversión contable)');

      // Notas Contables manuales de ejemplo: para que se pueda probar el módulo de Contabilidad
      // más allá de lo que generan automáticamente los pagos y gastos (Libro Diario, Balance de
      // Prueba y Balance General con movimiento real en Pasivo y Patrimonio, no solo en Activo).
      this.asientoContableService.crearManual({
        fecha: fechaInicioCategoria,
        concepto: 'Aporte inicial de la junta directiva (Ejemplo, Nota Contable manual)',
        lineas: [
          { cuentaContableId: this._idCuentaPorCodigo('111005'), debito: 1000000, credito: 0 },
          { cuentaContableId: this._idCuentaPorCodigo('3105'), debito: 0, credito: 1000000 }
        ]
      });
      this.asientoContableService.crearManual({
        fecha: hoy,
        concepto: 'Préstamo recibido para repuestos de la bomba (Ejemplo, Nota Contable manual)',
        lineas: [
          { cuentaContableId: this._idCuentaPorCodigo('111005'), debito: 500000, credito: 0 },
          { cuentaContableId: this._idCuentaPorCodigo('2105'), debito: 0, credito: 500000 }
        ]
      });

      // Nuevo punto de ejemplo, pendiente con un abono parcial
      const nuevoPunto = this.nuevoPuntoService.create({ cuentaId: cuenta2, valorTotal: 500000, fechaRegistro: hoy, observaciones: 'Conexión nueva de ejemplo' });
      this.nuevoPuntoService.registrarAbono({ nuevoPuntoId: nuevoPunto, monto: 150000, fechaAbono: hoy, metodoPago: 'Efectivo' });

      return { cuentasCreadas: 5 };
    })();
  }

  _idCuentaPorCodigo(codigo) {
    const cuenta = this.db.prepare('SELECT id FROM plan_cuentas WHERE codigo = ?').get(codigo);
    if (!cuenta) throw new Error(`No se encontró la cuenta contable ${codigo} (¿faltó ejecutar la migración del plan de cuentas?)`);
    return cuenta.id;
  }

  eliminarDatosOperativos() {
    return this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM movimientos_contables;
        DELETE FROM asientos_contables;
        DELETE FROM nuevo_punto_abonos;
        DELETE FROM nuevos_puntos;
        DELETE FROM pago_periodos;
        DELETE FROM cuenta_creditos;
        DELETE FROM recibo_detalles;
        DELETE FROM recibos;
        DELETE FROM recibos_anulados_fisicos;
        DELETE FROM movimientos;
        DELETE FROM gastos;
        DELETE FROM cuenta_categorias;
        DELETE FROM cuenta_propietarios;
        DELETE FROM cuentas;
        DELETE FROM propietarios;
        DELETE FROM terceros;
        DELETE FROM sqlite_sequence WHERE name IN (
          'cuentas', 'propietarios', 'cuenta_propietarios', 'cuenta_categorias',
          'recibos', 'recibo_detalles', 'recibos_anulados_fisicos', 'gastos', 'movimientos',
          'pago_periodos', 'cuenta_creditos', 'nuevos_puntos', 'nuevo_punto_abonos',
          'asientos_contables', 'movimientos_contables', 'terceros'
        );
      `);
      this.db.prepare("UPDATE configuracion SET valor = '1' WHERE clave = 'consecutivo_recibos'").run();
      this.db.prepare("UPDATE configuracion SET valor = '1' WHERE clave = 'consecutivo_asientos'").run();
    })();
  }
}

module.exports = DevToolsService;
