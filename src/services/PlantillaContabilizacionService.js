const PlantillaContabilizacionRepository = require('../repositories/PlantillaContabilizacionRepository');
const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');
const MotorContabilizacionService = require('./MotorContabilizacionService');

class PlantillaContabilizacionService {
  constructor(dbService) {
    this.repository = new PlantillaContabilizacionRepository(dbService);
    this.planCuentaRepository = new PlanCuentaRepository(dbService);
    this.motor = new MotorContabilizacionService(dbService);
  }

  getAll() {
    return this.repository.findAll();
  }

  getVersiones(codigo) {
    return this.repository.findVersionesByCodigo(codigo);
  }

  getById(id) {
    const p = this.repository.findById(id);
    if (!p) throw new Error(`Plantilla ${id} no encontrada`);
    return p;
  }

  // Crea una nueva versión de una plantilla con las líneas editadas.
  // La versión anterior queda cerrada con fecha_hasta = ayer para que los asientos
  // históricos anteriores a hoy aún se puedan reconstruir con la versión original.
  //
  // Si la plantilla tiene es_sistema=1, el nombre/descripción/módulo/subtipo no pueden
  // cambiarse (solo las líneas), para no alterar la semántica del sistema.
  actualizarLineas(id, nuevasLineas) {
    const actual = this.repository.findById(id);
    if (!actual) throw new Error('Plantilla no encontrada');
    if (!Array.isArray(nuevasLineas) || nuevasLineas.length === 0) {
      throw new Error('La plantilla debe tener al menos una línea');
    }

    this._validarLineas(nuevasLineas);

    return this.repository.transaccion(() => {
      const ayer = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const hoy  = new Date().toISOString().split('T')[0];

      // Cerrar la versión actual
      this.repository.cerrarVigencia(id, ayer);

      // Crear nueva versión con los mismos metadatos del encabezado
      const nuevoId = this.repository.crearVersion({
        codigo:      actual.codigo,
        version:     actual.version + 1,
        nombre:      actual.nombre,
        descripcion: actual.descripcion,
        modulo:      actual.modulo,
        subtipo:     actual.subtipo,
        fechaDesde:  hoy,
        esSistema:   actual.es_sistema === 1
      });

      this.repository.reemplazarLineas(nuevoId, nuevasLineas);

      return this.repository.findById(nuevoId);
    });
  }

  // Simulación: genera el asiento sin persistirlo.
  // El contexto puede venir como objeto o como JSON string (desde la UI).
  simularContabilizacion(plantillaId, contextoJson) {
    return this.motor.simularContabilizacion(plantillaId, contextoJson);
  }

  // ---------- validación de líneas ----------

  _validarLineas(lineas) {
    for (const [i, l] of lineas.entries()) {
      const n = i + 1;

      // Exactamente un mecanismo de cuenta definido (excepto líneas de expansión que lo resuelven desde el ítem)
      const esExpansion = l.tipo_expansion === 'Expansion';
      if (!esExpansion) {
        const mecanismos = [l.cuenta_fija_id, l.cuenta_automatica_clave, l.cuenta_mapeo_modulo, l.cuenta_contexto_campo].filter(Boolean);
        if (mecanismos.length === 0) throw new Error(`Línea ${n}: debe definir exactamente un mecanismo de resolución de cuenta`);
        if (mecanismos.length > 1)   throw new Error(`Línea ${n}: tiene ${mecanismos.length} mecanismos de cuenta definidos simultáneamente; use solo uno`);

        if (l.cuenta_mapeo_modulo && !l.cuenta_mapeo_campo) {
          throw new Error(`Línea ${n}: cuenta_mapeo_modulo requiere también cuenta_mapeo_campo`);
        }

        // Si usa cuenta_fija_id, validar que exista y sea imputable
        if (l.cuenta_fija_id) {
          const cuenta = this.planCuentaRepository.findById(l.cuenta_fija_id);
          if (!cuenta) throw new Error(`Línea ${n}: la cuenta fija seleccionada no existe en el PUC`);
          if (this.planCuentaRepository.tieneHijos(l.cuenta_fija_id)) {
            throw new Error(`Línea ${n}: la cuenta "${cuenta.nombre}" es de agrupación y no admite movimientos directos`);
          }
        }
      } else {
        if (!l.expansion_fuente)       throw new Error(`Línea ${n} (Expansion): debe indicar expansion_fuente`);
        if (!l.expansion_cuenta_campo) throw new Error(`Línea ${n} (Expansion): debe indicar expansion_cuenta_campo`);
        if (!l.expansion_monto_campo)  throw new Error(`Línea ${n} (Expansion): debe indicar expansion_monto_campo`);
        if (!l.expansion_lado_formula) throw new Error(`Línea ${n} (Expansion): debe indicar expansion_lado_formula`);
      }

      if (!['Debito', 'Credito'].includes(l.lado)) throw new Error(`Línea ${n}: lado debe ser 'Debito' o 'Credito'`);
      if (!['Campo', 'CampoAbsoluto', 'Porcentaje', 'Fijo'].includes(l.tipo_monto || 'Campo') && !esExpansion) {
        throw new Error(`Línea ${n}: tipo_monto inválido`);
      }

      if (l.condicion_json) {
        try { JSON.parse(l.condicion_json); } catch {
          throw new Error(`Línea ${n}: condicion_json no es JSON válido`);
        }
      }
    }
  }
}

module.exports = PlantillaContabilizacionService;
