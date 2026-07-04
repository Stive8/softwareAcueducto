const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

// logo_path NO está aquí a propósito: solo se escribe desde config:subirLogo/config:quitarLogo
// (main.js), nunca desde el formulario genérico de Configuración.
const CLAVES_EDITABLES = [
  'nombre_asociacion', 'nit', 'direccion', 'ciudad', 'telefono', 'email',
  'consecutivo_recibos', 'valor_nuevo_punto', 'saldo_caja_inicial', 'saldo_banco_inicial',
  'respaldo_nube_dias_retencion', 'caja_menor_activa', 'caja_menor_saldo_objetivo',
  'periodo_bloqueo_anterior_a'
];

class ConfiguracionService {
  constructor(dbService, asientoContableService = null) {
    this.repository = new ConfiguracionRepository(dbService);
    this.asientoContableService = asientoContableService;
  }

  getAll() {
    return this.repository.getAll();
  }

  // datos no siempre trae el formulario completo (p. ej. la sección de respaldo en la nube solo
  // envía sus propios 2 campos), así que cada validación solo aplica si esa clave en particular
  // viene incluida en esta actualización.
  actualizar(datos, usuarioId = null) {
    if (datos.nombre_asociacion !== undefined && !datos.nombre_asociacion.trim()) {
      throw new Error('El nombre de la asociación es obligatorio');
    }

    if (datos.caja_menor_saldo_objetivo !== undefined) {
      const valor = Number(datos.caja_menor_saldo_objetivo);
      if (!Number.isFinite(valor) || valor < 0) {
        throw new Error('El saldo objetivo de Caja Menor debe ser un número mayor o igual a cero');
      }
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

    if (datos.periodo_bloqueo_anterior_a !== undefined && datos.periodo_bloqueo_anterior_a !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.periodo_bloqueo_anterior_a)) {
        throw new Error('La fecha límite de bloqueo debe tener el formato AAAA-MM-DD, o quedar vacía para no restringir');
      }
    }

    const actualAntes = this.repository.getAll();
    const cambiosSaldoInicial = [];
    if (datos.saldo_caja_inicial !== undefined && Number(datos.saldo_caja_inicial) !== Number(actualAntes.saldo_caja_inicial || 0)) {
      cambiosSaldoInicial.push({ clave: 'CAJA', monto: Number(datos.saldo_caja_inicial) });
    }
    if (datos.saldo_banco_inicial !== undefined && Number(datos.saldo_banco_inicial) !== Number(actualAntes.saldo_banco_inicial || 0)) {
      cambiosSaldoInicial.push({ clave: 'BANCO', monto: Number(datos.saldo_banco_inicial) });
    }

    for (const clave of CLAVES_EDITABLES) {
      if (datos[clave] !== undefined) {
        this.repository.actualizar(clave, datos[clave]);
      }
    }

    if (this.asientoContableService) {
      for (const cambio of cambiosSaldoInicial) {
        this.asientoContableService.sincronizarAperturaSaldoInicial(cambio.clave, cambio.monto, usuarioId);
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
