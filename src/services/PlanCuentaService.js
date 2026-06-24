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
