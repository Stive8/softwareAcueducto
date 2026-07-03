const PlantillaContabilizacionRepository = require('../repositories/PlantillaContabilizacionRepository');
const CuentaAutomaticaRepository = require('../repositories/CuentaAutomaticaRepository');
const MapeoContableRepository = require('../repositories/MapeoContableRepository');
const ImpuestoRepository = require('../repositories/ImpuestoRepository');

// Motor de plantillas de contabilización.
//
// Recibe un "contexto" (objeto plano con los datos del documento fuente: campos escalares +
// colecciones como 'detalles' para recibos) y una plantilla cargada desde la BD.
// Devuelve el array de líneas listo para pasar a AsientoContableService.crear().
//
// NO persiste nada: es un motor de transformación puro. La persistencia la gestiona
// AsientoContableService usando el resultado de este motor.

class MotorContabilizacionService {
  constructor(dbService) {
    this.plantillaRepository = new PlantillaContabilizacionRepository(dbService);
    this.cuentaAutomaticaRepository = new CuentaAutomaticaRepository(dbService);
    this.mapeoRepository = new MapeoContableRepository(dbService);
    this.impuestoRepository = new ImpuestoRepository(dbService);
  }

  // Determina el subtipo de la plantilla a partir del contexto del documento.
  resolverSubtipo(modulo, contexto) {
    if (modulo === 'Gasto' || modulo === 'Recibo') {
      return (contexto.metodo_pago || '').toLowerCase() === 'efectivo' ? 'Efectivo' : 'Banco';
    }
    if (modulo === 'Movimiento') {
      return contexto.tipo || null;
    }
    return null;
  }

  // Plantilla vigente para el módulo, subtipo y fecha dados.
  // Lanza si no existe: el sistema siempre debe tener la plantilla semilla.
  resolverPlantilla(modulo, subtipo, fecha) {
    const plantilla = this.plantillaRepository.findVigente(modulo, subtipo, fecha);
    if (!plantilla) {
      const desc = subtipo ? `${modulo}/${subtipo}` : modulo;
      throw new Error(`No hay una plantilla de contabilización activa para "${desc}" en la fecha ${fecha}. Verifique la configuración en Contabilidad > Plantillas.`);
    }
    return plantilla;
  }

  // Genera el array de líneas de asiento a partir de la plantilla y el contexto.
  // Las líneas generadas incluyen todos los campos que AsientoContableRepository.crear() espera.
  generarLineas(plantilla, contexto) {
    const lineas = [];

    for (const def of plantilla.lineas) {
      if (def.condicion_json) {
        let cond;
        try { cond = JSON.parse(def.condicion_json); } catch {
          throw new Error(`Plantilla "${plantilla.codigo}" línea ${def.orden}: condicion_json no es JSON válido`);
        }
        if (!this._evalCondicion(cond, contexto)) continue;
      }

      if (def.tipo_expansion === 'Expansion') {
        this._expandirLinea(def, contexto, lineas);
      } else {
        this._agregarLineaSimple(def, contexto, lineas);
      }
    }

    // Motor tributario: aplica impuestos configurados (si los hay)
    const impuestos = this.impuestoRepository.findByPlantillaId(plantilla.id);
    if (impuestos.length > 0) {
      this._aplicarImpuestos(lineas, impuestos, contexto);
    }

    return lineas;
  }

  // Simula una contabilización SIN persistir. Usado por la herramienta de pruebas en la UI.
  simularContabilizacion(plantillaId, contextoJson) {
    const contexto = typeof contextoJson === 'string' ? JSON.parse(contextoJson) : contextoJson;
    const plantilla = this.plantillaRepository.findById(plantillaId);
    if (!plantilla) throw new Error(`Plantilla con id=${plantillaId} no encontrada`);

    const lineas = this.generarLineas(plantilla, contexto);

    const totalDebito  = lineas.reduce((s, l) => s + (l.debito  || 0), 0);
    const totalCredito = lineas.reduce((s, l) => s + (l.credito || 0), 0);
    const balanceado   = Math.abs(totalDebito - totalCredito) < 0.01;

    return {
      plantilla: { id: plantilla.id, codigo: plantilla.codigo, version: plantilla.version, nombre: plantilla.nombre },
      lineas,
      totalDebito,
      totalCredito,
      balanceado
    };
  }

  // ---------- helpers privados ----------

  _agregarLineaSimple(def, contexto, lineas) {
    const cuentaContableId = this._resolverCuenta(def, contexto);
    if (!cuentaContableId) {
      throw new Error(`No se pudo resolver la cuenta para la línea ${def.orden} de la plantilla (cuenta_fija_id, cuenta_automatica_clave, mapeo o contexto no disponible)`);
    }

    const monto = this._resolverMonto(def, contexto);
    if (monto === 0) return; // línea de monto cero se omite

    const linea = { cuentaContableId };
    if (def.lado === 'Debito')  linea.debito  = monto;
    else                        linea.credito = monto;

    this._aplicarTercero(def, contexto, linea);
    if (def.descripcion_linea) linea.descripcionLinea = def.descripcion_linea;
    lineas.push(linea);
  }

  _expandirLinea(def, contexto, lineas) {
    const items = contexto[def.expansion_fuente] || [];
    for (const item of items) {
      const rawMonto = Number(item[def.expansion_monto_campo] || 0);
      if (rawMonto === 0) continue;

      let lado, monto;
      if (def.expansion_lado_formula === 'PorSigno') {
        if (rawMonto >= 0) { lado = 'Credito'; monto = rawMonto;         }
        else               { lado = 'Debito';  monto = Math.abs(rawMonto); }
      } else if (def.expansion_lado_formula === 'Credito') {
        lado = 'Credito'; monto = Math.abs(rawMonto);
      } else {
        lado = 'Debito';  monto = Math.abs(rawMonto);
      }

      const cuentaContableId = item[def.expansion_cuenta_campo];
      if (!cuentaContableId) continue;

      const linea = { cuentaContableId };
      if (lado === 'Debito') linea.debito = monto;
      else                   linea.credito = monto;

      this._aplicarTercero(def, contexto, linea);
      lineas.push(linea);
    }
  }

  _resolverCuenta(def, contexto) {
    if (def.cuenta_fija_id)          return def.cuenta_fija_id;
    if (def.cuenta_automatica_clave) return this.cuentaAutomaticaRepository.getCuentaIdByClave(def.cuenta_automatica_clave);
    if (def.cuenta_contexto_campo)   return contexto[def.cuenta_contexto_campo] || null;
    if (def.cuenta_mapeo_modulo && def.cuenta_mapeo_campo) {
      const concepto = contexto[def.cuenta_mapeo_campo];
      return this.mapeoRepository.resolverCuentaContableId(def.cuenta_mapeo_modulo, concepto);
    }
    return null;
  }

  _resolverMonto(def, contexto) {
    switch (def.tipo_monto) {
      case 'Campo':        return Math.max(0, Number(contexto[def.monto_campo] || 0));
      case 'CampoAbsoluto': return Math.abs(Number(contexto[def.monto_campo] || 0));
      case 'Fijo':         return def.monto_fijo || 0;
      case 'Porcentaje': {
        const base = Number(contexto[def.monto_base_campo] || 0);
        return Math.round(base * (def.monto_porcentaje / 100));
      }
      default: return 0;
    }
  }

  _aplicarTercero(def, contexto, linea) {
    if (def.incluir_tercero_id)     linea.terceroId      = contexto.tercero_id      || null;
    if (def.incluir_propietario_id) linea.propietarioId  = contexto.propietario_id  || null;
    if (def.incluir_snapshot_nombre) {
      linea.terceroNombre          = contexto.tercero_nombre          || null;
      linea.terceroIdentificacion  = contexto.tercero_identificacion  || null;
    }
  }

  // Evaluador de condición JSON flexible.
  // Soporta: op simple (=, !=, >, >=, <, <=) y composición AND/OR recursiva.
  _evalCondicion(cond, ctx) {
    if (cond.op === 'AND') return (cond.condiciones || []).every(c => this._evalCondicion(c, ctx));
    if (cond.op === 'OR')  return (cond.condiciones || []).some(c  => this._evalCondicion(c, ctx));

    const valCtx = ctx[cond.campo];
    const valEsp = cond.valor;
    const op     = cond.op || '=';

    let resultado;
    switch (op) {
      case '=':  resultado = String(valCtx) === String(valEsp);     break;
      case '!=': resultado = String(valCtx) !== String(valEsp);     break;
      case '>':  resultado = Number(valCtx)  >  Number(valEsp);     break;
      case '>=': resultado = Number(valCtx)  >= Number(valEsp);     break;
      case '<':  resultado = Number(valCtx)  <  Number(valEsp);     break;
      case '<=': resultado = Number(valCtx)  <= Number(valEsp);     break;
      default:   resultado = false;
    }

    return cond.negado ? !resultado : resultado;
  }

  // Motor tributario: cada impuesto DIVIDE un lado del asiento existente, sin añadir pares.
  //
  // lado_ajuste = 'Debito'  → IVA descontable
  //   Reduce la primera línea de débito (gasto) en montoImp y agrega una nueva DB al impuesto.
  //   Resultado: DB Gasto(neto) + DB IVA = CR Banco(bruto)   → balance conservado.
  //
  // lado_ajuste = 'Credito' → ReteFuente / ICA
  //   Reduce la primera línea de crédito (pago/banco) en montoImp y agrega una nueva CR al impuesto.
  //   Resultado: DB Gasto(bruto) = CR Banco(neto) + CR Rete   → balance conservado.
  //
  // Los impuestos con lado_ajuste='Debito' ya vienen primero (ordenados en ImpuestoRepository)
  // para que la base se ajuste antes de calcular las retenciones sobre el valor neto.
  _aplicarImpuestos(lineas, impuestos, contexto) {
    for (const imp of impuestos) {
      const base = Number(contexto[imp.base_campo] || 0);
      // Usa la tasa vigente en la FECHA DEL DOCUMENTO, no la tasa actual del impuesto: así, un
      // documento retroactivo o una re-contabilización de un documento antiguo no cambian de
      // resultado si la tarifa se actualizó después — hallazgo Alto A-2 de la auditoría de
      // Contabilidad (2026-07-03).
      const porcentajeVigente = this.impuestoRepository.getPorcentajeVigente(imp.id, contexto.fecha);
      const montoImp = Math.round(base * porcentajeVigente / 100);
      if (montoImp === 0) continue;

      if (imp.lado_ajuste === 'Debito') {
        const lineaBase = lineas.find(l => (l.debito  || 0) > 0 && l.cuentaContableId !== imp.cuenta_id);
        if (lineaBase) lineaBase.debito  -= montoImp;
        lineas.push({ cuentaContableId: imp.cuenta_id, debito:  montoImp });
      } else {
        const lineaBase = lineas.find(l => (l.credito || 0) > 0 && l.cuentaContableId !== imp.cuenta_id);
        if (lineaBase) lineaBase.credito -= montoImp;
        lineas.push({ cuentaContableId: imp.cuenta_id, credito: montoImp });
      }
    }
  }

}


module.exports = MotorContabilizacionService;
