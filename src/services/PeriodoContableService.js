const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

class PeriodoContableService {
  constructor(periodoContableRepository, dbService) {
    this.repository = periodoContableRepository;
    this.configuracionRepository = dbService ? new ConfiguracionRepository(dbService) : null;
  }

  getAll() {
    return this.repository.getAll();
  }

  getByAnioMes(anio, mes) {
    return this.repository.getByAnioMes(anio, mes);
  }

  getPeriodosAbiertos() {
    return this.repository.getPeriodosAbiertos();
  }

  // Valida que la fecha ISO (YYYY-MM-DD) pertenece a un período Abierto y que no cae antes del
  // límite de bloqueo configurado (si hay uno). Crea el período automáticamente si no existe
  // (la primera operación del mes lo abre). Lanza un error descriptivo si el período está
  // Cerrado, Bloqueado, o la fecha cae antes del límite configurado.
  validarFechaPermitida(fechaISO) {
    if (!fechaISO) throw new Error('La fecha del movimiento es requerida.');

    if (this.configuracionRepository) {
      const limite = this.configuracionRepository.getAll().periodo_bloqueo_anterior_a;
      if (limite && fechaISO < limite) {
        throw new Error(
          `No se permite contabilizar en fechas anteriores a ${limite}: ese rango quedó bloqueado ` +
          `desde Configuración. Si necesita registrar un movimiento en esa fecha, un administrador ` +
          `debe ajustar el límite en Configuración → Períodos primero.`
        );
      }
    }

    const d = new Date(fechaISO + 'T00:00:00');
    const anio = d.getFullYear();
    const mes = d.getMonth() + 1;

    const periodo = this.repository.crearSiNoExiste(anio, mes);

    if (periodo.estado === 'Cerrado') {
      const nombreMes = this._nombreMes(mes);
      throw new Error(
        `El período ${nombreMes} ${anio} está Cerrado y no admite nuevos movimientos. ` +
        `Si necesita registrar un movimiento en ese período, un administrador debe reabrirlo primero.`
      );
    }
    if (periodo.estado === 'Bloqueado') {
      const nombreMes = this._nombreMes(mes);
      throw new Error(
        `El período ${nombreMes} ${anio} está Bloqueado definitivamente y no puede reabrirse.`
      );
    }

    return periodo;
  }

  cerrar(id, usuarioCierreId, motivoCierre) {
    const periodo = this.repository.getById(id);
    if (!periodo) throw new Error('Período no encontrado.');
    if (periodo.estado !== 'Abierto') {
      throw new Error(`El período ya está en estado "${periodo.estado}" y no puede cerrarse.`);
    }
    if (!motivoCierre || !motivoCierre.trim()) {
      throw new Error('Debe indicar el motivo del cierre.');
    }
    this.repository.cerrar(id, usuarioCierreId, motivoCierre.trim());
    return this.repository.getById(id);
  }

  bloquear(id, usuarioCierreId, motivoCierre) {
    const periodo = this.repository.getById(id);
    if (!periodo) throw new Error('Período no encontrado.');
    if (periodo.estado === 'Bloqueado') {
      throw new Error('El período ya está Bloqueado.');
    }
    if (!motivoCierre || !motivoCierre.trim()) {
      throw new Error('Debe indicar el motivo del bloqueo.');
    }
    this.repository.bloquear(id, usuarioCierreId, motivoCierre.trim());
    return this.repository.getById(id);
  }

  reabrir(id) {
    const periodo = this.repository.getById(id);
    if (!periodo) throw new Error('Período no encontrado.');
    if (periodo.estado === 'Abierto') {
      throw new Error('El período ya está Abierto.');
    }
    if (periodo.estado === 'Bloqueado') {
      throw new Error('Los períodos Bloqueados son definitivos y no pueden reabrirse.');
    }
    this.repository.reabrir(id);
    return this.repository.getById(id);
  }

  actualizarNotas(id, notas) {
    const periodo = this.repository.getById(id);
    if (!periodo) throw new Error('Período no encontrado.');
    this.repository.actualizarNotas(id, notas);
    return this.repository.getById(id);
  }

  _nombreMes(mes) {
    const nombres = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return nombres[mes] || mes;
  }
}

module.exports = PeriodoContableService;
