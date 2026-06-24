const TerceroRepository = require('../repositories/TerceroRepository');

const TIPOS_IDENTIFICACION_VALIDOS = ['Cédula de Ciudadanía', 'NIT', 'Cédula de Extranjería', 'Pasaporte', 'Registro Civil', 'Otro'];

// Para estos tipos, la identificación es puramente numérica y tiene una longitud esperada
// (igual que exige el software del que viene la guía); para Pasaporte/Cédula de Extranjería/
// Otro no se exige este formato porque sí pueden traer letras.
const TIPOS_CON_VALIDACION_NUMERICA = ['Cédula de Ciudadanía', 'NIT', 'Registro Civil'];

class TerceroService {
  constructor(dbService) {
    this.repository = new TerceroRepository(dbService);
  }

  getAll(params = {}) {
    return this.repository.findAll(params);
  }

  getById(id) {
    return this.repository.findById(id);
  }

  validar(terceroData) {
    if (!TIPOS_IDENTIFICACION_VALIDOS.includes(terceroData.tipoIdentificacion)) {
      throw new Error('Tipo de identificación inválido');
    }

    const numero = (terceroData.numeroIdentificacion || '').trim();
    if (!numero) throw new Error('El número de identificación es obligatorio');

    if (TIPOS_CON_VALIDACION_NUMERICA.includes(terceroData.tipoIdentificacion) && !/^\d{3,13}$/.test(numero)) {
      throw new Error('Para Cédula de Ciudadanía, NIT y Registro Civil, el número debe tener entre 3 y 13 dígitos');
    }

    if (!terceroData.nombreRazonSocial || !terceroData.nombreRazonSocial.trim()) {
      throw new Error('El nombre o razón social es obligatorio');
    }

    if (!terceroData.esProveedor && !terceroData.esOtro) {
      throw new Error('Debe marcar al menos un tipo de tercero (Proveedor u Otro)');
    }
  }

  create(terceroData) {
    this.validar(terceroData);

    if (this.repository.findByIdentificacion(terceroData.numeroIdentificacion.trim())) {
      throw new Error('Ya existe un tercero con esa identificación');
    }

    return this.repository.create(terceroData);
  }

  update(id, terceroData) {
    const tercero = this.repository.findById(id);
    if (!tercero) throw new Error('Tercero no encontrado');

    this.validar(terceroData);

    const nuevoNumero = terceroData.numeroIdentificacion.trim();
    if (nuevoNumero !== tercero.numero_identificacion) {
      const existente = this.repository.findByIdentificacion(nuevoNumero);
      if (existente) throw new Error('Ya existe otro tercero con esa identificación');
    }

    this.repository.update(id, terceroData);
  }

  toggleActivo(id) {
    const tercero = this.repository.findById(id);
    if (!tercero) throw new Error('Tercero no encontrado');

    this.repository.toggleActivo(id);
  }
}

module.exports = TerceroService;
