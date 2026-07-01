const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

// logo_path NO está aquí a propósito: solo se escribe desde config:subirLogo/config:quitarLogo
// (main.js), nunca desde el formulario genérico de Configuración.
const CLAVES_EDITABLES = [
  'nombre_asociacion', 'nit', 'direccion', 'ciudad', 'telefono', 'email',
  'consecutivo_recibos', 'valor_nuevo_punto', 'saldo_caja_inicial', 'saldo_banco_inicial',
  'respaldo_nube_dias_retencion'
];

class ConfiguracionService {
  constructor(dbService) {
    this.repository = new ConfiguracionRepository(dbService);
  }

  getAll() {
    return this.repository.getAll();
  }

  // datos no siempre trae el formulario completo (p. ej. la sección de respaldo en la nube solo
  // envía sus propios 2 campos), así que cada validación solo aplica si esa clave en particular
  // viene incluida en esta actualización.
  actualizar(datos) {
    if (datos.nombre_asociacion !== undefined && !datos.nombre_asociacion.trim()) {
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

  // Aparte de actualizar(): logo_path no está en CLAVES_EDITABLES a propósito (ver comentario
  // arriba), así que necesita su propio punto de entrada, usado solo por config:subirLogo/
  // config:quitarLogo en main.js.
  actualizarLogoPath(nombreArchivo) {
    this.repository.actualizar('logo_path', nombreArchivo || '');
  }
}

module.exports = ConfiguracionService;
