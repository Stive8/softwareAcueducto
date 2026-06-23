const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

const CLAVES_EDITABLES = [
  'nombre_asociacion', 'nit', 'direccion', 'telefono', 'email',
  'consecutivo_recibos', 'valor_nuevo_punto', 'saldo_caja_inicial', 'saldo_banco_inicial',
  'respaldo_nube_nombre_equipo', 'respaldo_nube_dias_retencion'
];

class ConfiguracionService {
  constructor(dbService) {
    this.repository = new ConfiguracionRepository(dbService);
  }

  getAll() {
    return this.repository.getAll();
  }

  actualizar(datos) {
    if (!datos.nombre_asociacion || !datos.nombre_asociacion.trim()) {
      throw new Error('El nombre de la asociación es obligatorio');
    }

    // El consecutivo de recibos nunca puede retroceder por debajo de un recibo ya emitido,
    // de lo contrario se generarían números de recibo duplicados.
    if (datos.consecutivo_recibos !== undefined) {
      const nuevoConsecutivo = parseInt(datos.consecutivo_recibos, 10);
      if (!Number.isInteger(nuevoConsecutivo) || nuevoConsecutivo < 1) {
        throw new Error('El consecutivo de recibos debe ser un número entero mayor a cero');
      }

      const maxExistente = this.repository.getMaxNumeroRecibo();
      if (nuevoConsecutivo <= maxExistente) {
        throw new Error(`El consecutivo debe ser mayor al último recibo ya emitido (No. ${maxExistente})`);
      }
    }

    for (const clave of CLAVES_EDITABLES) {
      if (datos[clave] !== undefined) {
        this.repository.actualizar(clave, datos[clave]);
      }
    }
  }
}

module.exports = ConfiguracionService;
