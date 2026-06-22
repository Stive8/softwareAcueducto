const CuentaService = require('./CuentaService');
const PropietarioService = require('./PropietarioService');
const CategoriaRepository = require('../repositories/CategoriaRepository');
const PagoService = require('./PagoService');
const GastoService = require('./GastoService');
const NuevoPuntoService = require('./NuevoPuntoService');

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
    this.pagoService = new PagoService(dbService);
    this.gastoService = new GastoService(dbService);
    this.nuevoPuntoService = new NuevoPuntoService(dbService);
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

      // Cuenta 3: con saldo a favor (abono libre, sin aplicar a meses)
      const cuenta3 = this.cuentaService.create({ codigo: 'DEMO-003', direccion: 'Vereda El Carmen, Sector Alto', categoria_id: finca.id, categoria_fecha_inicio: fechaInicioCategoria });
      const prop3 = this.propietarioService.create({ nombre_completo: 'Carlos Martínez (Ejemplo)', numero_identificacion: 'DEMO-34567890' });
      this.propietarioService.asignarACuenta(cuenta3, prop3, fechaInicioCategoria);
      this.pagoService.registrarAbono({ cuentaId: cuenta3, monto: 30000, fechaPago: hoy, metodoPago: 'Transferencia', observaciones: 'Abono de ejemplo' });

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

      // Gastos de ejemplo
      this.gastoService.create({ fechaGasto: hoy, concepto: 'Mantenimiento tubería principal (Ejemplo)', tipoGasto: 'Mantenimiento', proveedor: 'Fontanería El Río', nitCedula: '900111222-3', valor: 350000, metodoPago: 'Efectivo' });
      this.gastoService.create({ fechaGasto: hoy, concepto: 'Cloro para tratamiento (Ejemplo)', tipoGasto: 'Insumos', proveedor: 'Distribuidora Aguas', nitCedula: '900333444-5', valor: 85000, metodoPago: 'Efectivo' });
      this.gastoService.create({ fechaGasto: hoy, concepto: 'Pago energía eléctrica (Ejemplo)', tipoGasto: 'Servicios', proveedor: 'Empresa de Energía', nitCedula: '900555666-7', valor: 180000, metodoPago: 'Transferencia' });

      // Nuevo punto de ejemplo, pendiente con un abono parcial
      const nuevoPunto = this.nuevoPuntoService.create({ cuentaId: cuenta2, valorTotal: 500000, fechaRegistro: hoy, observaciones: 'Conexión nueva de ejemplo' });
      this.nuevoPuntoService.registrarAbono({ nuevoPuntoId: nuevoPunto, monto: 150000, fechaAbono: hoy, metodoPago: 'Efectivo' });

      return { cuentasCreadas: 5 };
    })();
  }

  eliminarDatosOperativos() {
    return this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM nuevo_punto_abonos;
        DELETE FROM nuevos_puntos;
        DELETE FROM pago_periodos;
        DELETE FROM cuenta_creditos;
        DELETE FROM recibo_detalles;
        DELETE FROM recibos;
        DELETE FROM movimientos;
        DELETE FROM gastos;
        DELETE FROM cuenta_categorias;
        DELETE FROM cuenta_propietarios;
        DELETE FROM cuentas;
        DELETE FROM propietarios;
        DELETE FROM sqlite_sequence WHERE name IN (
          'cuentas', 'propietarios', 'cuenta_propietarios', 'cuenta_categorias',
          'recibos', 'recibo_detalles', 'gastos', 'movimientos',
          'pago_periodos', 'cuenta_creditos', 'nuevos_puntos', 'nuevo_punto_abonos'
        );
      `);
      this.db.prepare("UPDATE configuracion SET valor = '1' WHERE clave = 'consecutivo_recibos'").run();
    })();
  }
}

module.exports = DevToolsService;
