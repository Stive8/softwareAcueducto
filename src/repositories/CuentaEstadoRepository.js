const { primerDiaDelMes, ultimoDiaDelMes, diaAnterior } = require('../services/cartera/periodos');

const ESTADOS_VALIDOS = ['Activo', 'Inactivo', 'Suspendido'];

// Historial de estado de una cuenta. Existe porque cuentas.estado no tiene fecha: se podía
// marcar Suspendido pero no desde cuándo, y la causación necesita saber en qué estado estaba
// la cuenta en un mes concreto para no fabricar deuda de años en que nadie vio el punto.
// cuentas.estado se mantiene sincronizado con la vigencia abierta, porque listados, filtros y
// reportes ya lo leen.
class CuentaEstadoRepository {
  constructor(dbService) {
    this.db = dbService.getDb();
  }

  getVigencias(cuentaId) {
    return this.db.prepare(`
      SELECT * FROM cuenta_estados WHERE cuenta_id = ?
      ORDER BY fecha_inicio ASC, id ASC
    `).all(cuentaId);
  }

  getVigenciaAbierta(cuentaId) {
    return this.db.prepare(`
      SELECT * FROM cuenta_estados WHERE cuenta_id = ? AND fecha_fin IS NULL
      ORDER BY fecha_inicio DESC, id DESC LIMIT 1
    `).get(cuentaId);
  }

  // Estado que abarca el mes completo. Se compara contra el rango del mes (día 1 al último),
  // no solo contra el día 1, por el mismo criterio que usa getCategoriaTarifaParaMes: una
  // vigencia puede empezar a mitad de mes.
  // Sin vigencias registradas asume 'Activo': es el comportamiento previo a este historial.
  estadoEnMes(cuentaId, anio, mes) {
    const inicio = primerDiaDelMes(anio, mes);
    const fin = ultimoDiaDelMes(anio, mes);

    const fila = this.db.prepare(`
      SELECT estado FROM cuenta_estados
      WHERE cuenta_id = ?
        AND fecha_inicio <= ?
        AND (fecha_fin IS NULL OR fecha_fin >= ?)
      ORDER BY fecha_inicio DESC, id DESC
      LIMIT 1
    `).get(cuentaId, fin, inicio);

    return fila ? fila.estado : 'Activo';
  }

  sembrarVigenciaInicial({ cuentaId, estado, fechaInicio, motivo = null, usuarioId = null }) {
    if (!ESTADOS_VALIDOS.includes(estado)) throw new Error(`Estado inválido: ${estado}`);
    const r = this.db.prepare(`
      INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo, usuario_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(cuentaId, estado, fechaInicio, motivo, usuarioId);
    this.db.prepare(`UPDATE cuentas SET estado = ? WHERE id = ?`).run(estado, cuentaId);
    return r.lastInsertRowid;
  }

  // Cierra la vigencia abierta el día anterior a fechaInicio y abre la nueva. Nunca sobrescribe
  // una vigencia existente (misma convención que cuenta_categorias / cuenta_propietarios).
  cambiarEstado({ cuentaId, estado, fechaInicio, motivo = null, usuarioId = null }) {
    if (!ESTADOS_VALIDOS.includes(estado)) throw new Error(`Estado inválido: ${estado}`);
    if (!fechaInicio) throw new Error('La fecha de inicio de la vigencia es obligatoria');

    return this.db.transaction(() => {
      const abierta = this.getVigenciaAbierta(cuentaId);
      if (abierta) {
        if (fechaInicio <= abierta.fecha_inicio) {
          throw new Error(
            `La fecha ${fechaInicio} es anterior al inicio de la vigencia actual ` +
            `(${abierta.fecha_inicio}); corrija esa vigencia antes de crear una nueva`
          );
        }
        this.db.prepare(`UPDATE cuenta_estados SET fecha_fin = ? WHERE id = ?`)
          .run(diaAnterior(fechaInicio), abierta.id);
      }

      const r = this.db.prepare(`
        INSERT INTO cuenta_estados (cuenta_id, estado, fecha_inicio, motivo, usuario_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(cuentaId, estado, fechaInicio, motivo, usuarioId);

      this.db.prepare(`UPDATE cuentas SET estado = ? WHERE id = ?`).run(estado, cuentaId);
      return r.lastInsertRowid;
    })();
  }
}

module.exports = CuentaEstadoRepository;
