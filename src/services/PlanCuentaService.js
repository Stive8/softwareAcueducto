const PlanCuentaRepository = require('../repositories/PlanCuentaRepository');
const MapeoContableRepository = require('../repositories/MapeoContableRepository');

const TIPOS_VALIDOS = ['Activo', 'Pasivo', 'Patrimonio', 'Ingreso', 'Gasto', 'Costo'];
const NATURALEZA_VALIDA = ['Debito', 'Credito'];

class PlanCuentaService {
  constructor(dbService) {
    this.repository = new PlanCuentaRepository(dbService);
    this.mapeoContableRepository = new MapeoContableRepository(dbService);
  }

  getAll(params = {}) {
    return this.repository.findAll(params);
  }

  getById(id) {
    return this.repository.findById(id);
  }

  // Cuentas imputables: las que sí pueden recibir movimientos (sin subcuentas/auxiliares debajo).
  // Es lo que debe ofrecerse en cualquier selector de "cuenta contable" del resto del sistema.
  getImputables(params = {}) {
    return this.repository.findImputables(params);
  }

  create(cuentaData) {
    const { codigo, nombre, tipo, naturaleza, padreId } = cuentaData;

    if (!codigo || !codigo.trim()) throw new Error('El código de la cuenta es obligatorio');
    if (!nombre || !nombre.trim()) throw new Error('El nombre de la cuenta es obligatorio');
    if (!TIPOS_VALIDOS.includes(tipo)) throw new Error('Tipo de cuenta inválido');
    if (!NATURALEZA_VALIDA.includes(naturaleza)) throw new Error('Naturaleza de cuenta inválida');

    if (this.repository.findByCodigo(codigo.trim())) {
      throw new Error('Ya existe una cuenta con ese código');
    }

    let nivel = 1;
    if (padreId) {
      const padre = this.repository.findById(padreId);
      if (!padre) throw new Error('La cuenta padre no existe');
      if (padre.nivel >= 5) throw new Error('No se pueden crear cuentas debajo de un auxiliar (nivel máximo alcanzado)');
      if (padre.tipo !== tipo) throw new Error('La cuenta debe tener el mismo tipo que su cuenta padre');
      // Convertir una cuenta que ya tiene movimientos en una cuenta de agrupación deja esos
      // movimientos "huérfanos": el sistema ya no admite postear contra una cuenta con hijas
      // (ver AsientoContableService.crear()), pero los movimientos ya contabilizados se quedan
      // apuntando a ella sin que nada los detecte ni los migre. Este fue exactamente el
      // mecanismo del hallazgo Crítico C-1 (la cuenta '1105' Caja, con nueve años de historia,
      // convertida en agrupación por la migración 029 sin reasignar sus movimientos). En vez de
      // repetir ese defecto, se bloquea la operación: quien necesite reorganizar una cuenta en
      // uso debe hacerlo con una migración de datos explícita (ver 031 como plantilla), que
      // reasigne los movimientos existentes en la misma operación.
      if (this.repository.tieneMovimientos(padreId)) {
        throw new Error(
          `No se puede crear una subcuenta bajo "${padre.nombre}" porque esa cuenta ya tiene movimientos registrados. ` +
          `Convertirla en cuenta de agrupación dejaría esos movimientos huérfanos. Si necesita reorganizar el plan de ` +
          `cuentas, contacte a soporte técnico para una migración de datos que reasigne el histórico primero.`
        );
      }
      nivel = padre.nivel + 1;
    }

    return this.repository.create({ codigo: codigo.trim(), nombre: nombre.trim(), tipo, naturaleza, nivel, padreId: padreId || null });
  }

  update(id, cuentaData) {
    const cuenta = this.repository.findById(id);
    if (!cuenta) throw new Error('Cuenta contable no encontrada');

    const { codigo, nombre, tipo, naturaleza } = cuentaData;
    if (!codigo || !codigo.trim()) throw new Error('El código de la cuenta es obligatorio');
    if (!nombre || !nombre.trim()) throw new Error('El nombre de la cuenta es obligatorio');
    if (!TIPOS_VALIDOS.includes(tipo)) throw new Error('Tipo de cuenta inválido');
    if (!NATURALEZA_VALIDA.includes(naturaleza)) throw new Error('Naturaleza de cuenta inválida');

    if (codigo.trim() !== cuenta.codigo) {
      const existente = this.repository.findByCodigo(codigo.trim());
      if (existente) throw new Error('Ya existe otra cuenta con ese código');
    }

    this.repository.update(id, { codigo: codigo.trim(), nombre: nombre.trim(), tipo, naturaleza });
  }

  toggleActivo(id) {
    const cuenta = this.repository.findById(id);
    if (!cuenta) throw new Error('Cuenta contable no encontrada');

    if (cuenta.activo && this.repository.tieneHijos(id)) {
      throw new Error('No se puede desactivar una cuenta que tiene subcuentas. Desactive primero las subcuentas.');
    }

    if (cuenta.activo) {
      const conceptos = this.mapeoContableRepository.findConceptosQueUsan(id);
      if (conceptos.length > 0) {
        throw new Error(
          `No se puede desactivar: esta cuenta está asignada en el Mapeo de Conceptos (${conceptos.map(c => c.concepto).join(', ')}). Reasigne esos conceptos a otra cuenta antes de desactivarla.`
        );
      }
    }

    if (cuenta.activo && this.repository.tieneMovimientos(id)) {
      throw new Error('No se puede desactivar: esta cuenta ya tiene gastos, recibos o movimientos contables registrados. El histórico debe poder seguir consultándose con la cuenta activa.');
    }

    this.repository.toggleActivo(id);
  }
}

module.exports = PlanCuentaService;
