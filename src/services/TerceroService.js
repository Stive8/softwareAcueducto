const TerceroRepository = require('../repositories/TerceroRepository');
const GastoRepository = require('../repositories/GastoRepository');

const TIPOS_IDENTIFICACION_VALIDOS = ['Cédula de Ciudadanía', 'NIT', 'Cédula de Extranjería', 'Pasaporte', 'Registro Civil', 'Otro', 'No informado'];

// Para estos tipos, la identificación es puramente numérica y tiene una longitud esperada
// (igual que exige el software del que viene la guía); para Pasaporte/Cédula de Extranjería/
// Otro no se exige este formato porque sí pueden traer letras.
const TIPOS_CON_VALIDACION_NUMERICA = ['Cédula de Ciudadanía', 'NIT', 'Registro Civil'];

class TerceroService {
  constructor(dbService) {
    this.repository = new TerceroRepository(dbService);
    this.gastoRepository = new GastoRepository(dbService);
  }

  getAll(params = {}) {
    return this.repository.findAll(params);
  }

  getById(id) {
    return this.repository.findById(id);
  }

  // 'No informado' representa que no fue posible obtener una identificación real, nunca un
  // valor inventado (0000, 999999, etc.) — se guarda como NULL real y se exime de validación.
  validar(terceroData) {
    if (!TIPOS_IDENTIFICACION_VALIDOS.includes(terceroData.tipoIdentificacion)) {
      throw new Error('Tipo de identificación inválido');
    }

    if (terceroData.tipoIdentificacion === 'No informado') {
      terceroData.numeroIdentificacion = null;
    } else {
      const numero = (terceroData.numeroIdentificacion || '').trim();
      if (!numero) throw new Error('El número de identificación es obligatorio');

      if (TIPOS_CON_VALIDACION_NUMERICA.includes(terceroData.tipoIdentificacion) && !/^\d{3,13}$/.test(numero)) {
        throw new Error('Para Cédula de Ciudadanía, NIT y Registro Civil, el número debe tener entre 3 y 13 dígitos');
      }
      terceroData.numeroIdentificacion = numero;
    }

    if (!terceroData.nombreRazonSocial || !terceroData.nombreRazonSocial.trim()) {
      throw new Error('El nombre o razón social es obligatorio');
    }

    if (!terceroData.esProveedor && !terceroData.esOtro && !terceroData.esContratista
      && !terceroData.esAliado && !terceroData.esCliente && !terceroData.esEmpleado && !terceroData.esEntidadPublica) {
      throw new Error('Debe marcar al menos un tipo de tercero');
    }
  }

  create(terceroData) {
    this.validar(terceroData);

    if (terceroData.numeroIdentificacion && this.repository.findByIdentificacion(terceroData.numeroIdentificacion)) {
      throw new Error('Ya existe un tercero con esa identificación');
    }

    return this.repository.create(terceroData);
  }

  update(id, terceroData) {
    const tercero = this.repository.findById(id);
    if (!tercero) throw new Error('Tercero no encontrado');
    if (tercero.es_sistema) throw new Error('Este tercero es un registro del sistema y no puede modificarse');

    this.validar(terceroData);

    if (terceroData.numeroIdentificacion && terceroData.numeroIdentificacion !== tercero.numero_identificacion) {
      const existente = this.repository.findByIdentificacion(terceroData.numeroIdentificacion);
      if (existente) throw new Error('Ya existe otro tercero con esa identificación');
    }

    this.repository.update(id, terceroData);
  }

  toggleActivo(id) {
    const tercero = this.repository.findById(id);
    if (!tercero) throw new Error('Tercero no encontrado');
    if (tercero.es_sistema) throw new Error('Este tercero es un registro del sistema y no puede desactivarse');

    this.repository.toggleActivo(id);
  }

  getHistorialMovimientos(terceroId) {
    const tercero = this.repository.findById(terceroId);
    if (!tercero) throw new Error('Tercero no encontrado');

    return this.gastoRepository.findByTerceroId(terceroId)
      .map(g => ({
        fecha_gasto: g.fecha_gasto,
        concepto: g.concepto,
        tipo_gasto: g.tipo_gasto,
        valor: g.valor,
        estado: g.estado
      }));
  }
}

module.exports = TerceroService;
