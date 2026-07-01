class CuentaAutomaticaService {
  constructor(cuentaAutomaticaRepository, planCuentaRepository) {
    this.repository = cuentaAutomaticaRepository;
    this.planCuentaRepository = planCuentaRepository;
  }

  getAll() {
    return this.repository.getAll();
  }

  getByClave(clave) {
    const registro = this.repository.getByClave(clave);
    if (!registro) throw new Error(`Cuenta automática "${clave}" no encontrada.`);
    return registro;
  }

  // Resuelve el id de cuenta contable para una clave automática.
  // Lanza excepción si la clave no existe — todas las claves semilla siempre deben existir.
  resolverCuentaId(clave) {
    const id = this.repository.getCuentaIdByClave(clave);
    if (!id) throw new Error(`Cuenta automática "${clave}" no está configurada en la base de datos.`);
    return id;
  }

  // Devuelve el código PUC (ej. '1105') de la cuenta automática indicada.
  resolverCodigo(clave) {
    const codigo = this.repository.getCodigoByClave(clave);
    if (!codigo) throw new Error(`Cuenta automática "${clave}" no está configurada en la base de datos.`);
    return codigo;
  }

  actualizar(clave, cuentaContableId) {
    // Validar que la cuenta existe y es imputable (sin hijos)
    const cuenta = this.planCuentaRepository.findById(cuentaContableId);
    if (!cuenta) throw new Error('La cuenta contable seleccionada no existe.');
    if (this.planCuentaRepository.tieneHijos(cuentaContableId)) {
      throw new Error('Solo se pueden asignar cuentas imputables (sin subcuentas) como cuentas automáticas.');
    }

    // Verificar que la clave existe
    const registro = this.repository.getByClave(clave);
    if (!registro) throw new Error(`La clave automática "${clave}" no existe.`);

    this.repository.actualizar(clave, cuentaContableId);
    return this.repository.getByClave(clave);
  }
}

module.exports = CuentaAutomaticaService;
