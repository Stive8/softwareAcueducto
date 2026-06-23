const ReciboRepository = require('../repositories/ReciboRepository');
const AsientoContableService = require('./AsientoContableService');

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNumber(num) {
  return Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatFecha(fechaString) {
  const fecha = new Date(fechaString);
  return fecha.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
}

class ReciboService {
  constructor(dbService) {
    this.repository = new ReciboRepository(dbService);
    this.asientoContableService = new AsientoContableService(dbService);
  }

  getAll(params) {
    return this.repository.findAll(params);
  }

  getById(id) {
    const recibo = this.repository.findById(id);
    if (!recibo) return null;

    recibo.detalles = this.repository.getDetalles(id);
    return recibo;
  }

  getConsecutivoRecibo() {
    return this.repository.getConsecutivoRecibo();
  }

  registrarAnuladoFisico({ numeroRecibo, fecha, motivo }) {
    if (!numeroRecibo || Number(numeroRecibo) <= 0) throw new Error('Debe indicar el número de recibo');
    if (!motivo || !motivo.trim()) throw new Error('Debe indicar el motivo de la anulación');
    if (this.repository.numeroRecibioExiste(Number(numeroRecibo))) {
      throw new Error(`El número de recibo ${numeroRecibo} ya está registrado (como recibo o como anulado)`);
    }
    return this.repository.crearAnuladoFisico({ numeroRecibo: Number(numeroRecibo), fecha, motivo });
  }

  getAnuladosFisicos() {
    return this.repository.getAnuladosFisicos();
  }

  anular(id, motivoAnulacion, usuarioId = null) {
    const recibo = this.repository.findById(id);
    if (!recibo) throw new Error('Recibo no encontrado');
    if (recibo.estado === 'Anulado') throw new Error('El recibo ya está anulado');
    if (!motivoAnulacion || !motivoAnulacion.trim()) throw new Error('Debe indicar el motivo de la anulación');

    return this.repository.transaccion(() => {
      this.repository.anular(id, motivoAnulacion);

      // Si el recibo se cubrió totalmente con saldo a favor (total = 0), no entró ni salió
      // efectivo real de caja/banco, así que no hay nada que revertir en ese ledger.
      if (recibo.total > 0) {
        this.repository.crearMovimiento({
          tipo: 'Egreso',
          origen: recibo.metodo_pago === 'Efectivo' ? 'Caja' : 'Banco',
          monto: recibo.total,
          concepto: `Reversión por anulación de recibo No. ${recibo.numero_recibo}`,
          referenciaId: id,
          referenciaTipo: 'Recibo',
          fechaMovimiento: new Date().toISOString().split('T')[0],
          observaciones: motivoAnulacion
        });
      }

      this.asientoContableService.revertirPorReferencia('Recibo', id, motivoAnulacion, usuarioId);
    });
  }

  // Genera el documento HTML imprimible de un recibo (usado tanto para imprimir como para exportar a PDF)
  generarHTML(id) {
    const recibo = this.getById(id);
    if (!recibo) {
      throw new Error('Recibo no encontrado');
    }

    const config = this.repository.getConfiguracionAsociacion();

    const filasDetalle = recibo.detalles.map(d => `
      <tr>
        <td>${escapeHtml(d.concepto)}</td>
        <td>${d.periodo_desde ? escapeHtml(d.periodo_desde) + (d.periodo_hasta && d.periodo_hasta !== d.periodo_desde ? ' - ' + escapeHtml(d.periodo_hasta) : '') : '-'}</td>
        <td class="text-right">$${formatNumber(d.valor)}</td>
      </tr>
    `).join('');

    return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Recibo No. ${recibo.numero_recibo}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; padding: 32px; color: #1f2937; }
  .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #1e40af; padding-bottom: 16px; }
  .header h1 { color: #1e40af; font-size: 22px; margin: 0 0 6px 0; }
  .header p { font-size: 12px; color: #475569; margin: 2px 0; }
  .recibo-numero { text-align: right; font-size: 18px; font-weight: bold; color: #1e40af; margin-bottom: 20px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 24px; font-size: 13px; }
  .info-grid div span { font-weight: bold; color: #334155; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { border: 1px solid #cbd5e1; padding: 10px 12px; font-size: 13px; text-align: left; }
  th { background: #f1f5f9; color: #334155; }
  .total-row td { font-weight: bold; font-size: 14px; background: #eff6ff; }
  .text-right { text-align: right; }
  .footer { margin-top: 32px; font-size: 11px; color: #64748b; text-align: center; }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(config.nombre_asociacion || 'Acueducto Veredal')}</h1>
    ${config.nit ? `<p>NIT: ${escapeHtml(config.nit)}</p>` : ''}
    ${config.direccion ? `<p>${escapeHtml(config.direccion)}</p>` : ''}
    ${config.telefono ? `<p>Tel: ${escapeHtml(config.telefono)}</p>` : ''}
  </div>

  <div class="recibo-numero">Recibo No. ${recibo.numero_recibo}${recibo.estado === 'Anulado' ? ' <span style="color:#dc2626;">— ANULADO</span>' : ''}</div>
  ${recibo.estado === 'Anulado' ? `<p style="color:#dc2626; font-size: 12px; text-align: center; margin: -12px 0 16px 0;">Este recibo fue anulado${recibo.motivo_anulacion ? ': ' + escapeHtml(recibo.motivo_anulacion) : ''}</p>` : ''}

  <div class="info-grid">
    <div>Fecha: <span>${formatFecha(recibo.fecha_recibo)}</span></div>
    <div>Método de pago: <span>${escapeHtml(recibo.metodo_pago)}</span></div>
    <div>Cuenta: <span>${escapeHtml(recibo.cuenta_codigo)}</span></div>
    <div>Dirección: <span>${escapeHtml(recibo.cuenta_direccion)}</span></div>
    <div>Propietario: <span>${escapeHtml(recibo.propietario_nombre)}</span></div>
    <div>Identificación: <span>${escapeHtml(recibo.propietario_identificacion || '-')}</span></div>
  </div>

  <table>
    <thead>
      <tr><th>Concepto</th><th>Período</th><th class="text-right">Valor</th></tr>
    </thead>
    <tbody>
      ${filasDetalle}
      <tr class="total-row"><td colspan="2">TOTAL</td><td class="text-right">$${formatNumber(recibo.total)}</td></tr>
    </tbody>
  </table>

  ${recibo.observaciones ? `<p style="font-size:13px;"><strong>Observaciones:</strong> ${escapeHtml(recibo.observaciones)}</p>` : ''}

  <div class="footer">Documento generado por el sistema administrativo del acueducto. Gracias por su pago.</div>
</body>
</html>
    `;
  }
}

module.exports = ReciboService;
