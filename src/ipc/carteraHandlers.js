const { getSesionActual } = require('./sesion');

function registrarCarteraHandlers({ envolverHandle, carteraService }) {
  // Cartera (nuevo modelo) -- solo lectura. Ver PUNTOS-CONFLICTIVOS.md: el sistema activo de
  // cobro sigue siendo pagos:*; estos canales solo muestran el modelo nuevo en paralelo para
  // poder validarlo con datos reales antes de conectarle escritura.
  envolverHandle('cartera:getEstadoCartera', async (event, cuentaId) => {
    try {
      return { success: true, data: carteraService.getEstadoCartera(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cartera:getDetalleCartera', async (event, cuentaId) => {
    try {
      return { success: true, data: carteraService.getDetalleCartera(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cartera:getMotivoDiferencia', async (event, cuentaId) => {
    try {
      return { success: true, data: carteraService.getMotivoDiferencia(cuentaId) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cartera:getIndicadoresBulk', async () => {
    try {
      return { success: true, data: carteraService.getIndicadoresBulk() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Primera escritura conectada del modelo nuevo de cartera: redime saldo a favor ya
  // existente (cuenta_creditos) contra deuda exigible por FIFO. No genera recibo -- no es
  // plata nueva, es reasignar la que la cuenta ya tiene guardada. El resto de las escrituras
  // (recategorizar, suspender, reactivar, ajustarDeuda, reclasificarAbono) sigue sin conectar.
  envolverHandle('cartera:redimirCredito', async (event, payload) => {
    try {
      return { success: true, data: carteraService.redimirCredito({ ...payload, usuarioId: getSesionActual().id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Suspende/reactiva UNA cuenta anulando (suspender) o dejando anulados (reactivar, no
  // recausa retroactivo) los cargos que correspondan. Reemplaza los botones "Suspender"/
  // "Activar" de Cuentas (auditoría 2026-08-29): antes cambiaban cuentas.estado directo
  // (cuentas:changeStatus, retirado) sin dejar rastro en cuenta_estados ni anular
  // cartera_movimientos -- una cuenta marcada Suspendido en pantalla seguía causando y
  // contando en mora en el motor nuevo, porque calcularAPagar/asegurarCausacion leen
  // cuenta_estados, no cuentas.estado.
  envolverHandle('cartera:suspender', async (event, payload) => {
    try {
      return { success: true, data: carteraService.suspender({ ...payload, usuarioId: getSesionActual().id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  envolverHandle('cartera:reactivar', async (event, payload) => {
    try {
      return { success: true, data: carteraService.reactivar({ ...payload, usuarioId: getSesionActual().id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Cambia la categoría de UNA cuenta (ej. "esta casa en realidad tiene piscina desde tal
  // fecha"), sin cambiar la tarifa de la categoría en sí. Para reajustar la tarifa de una
  // categoría completa (todas sus cuentas a la vez, con efecto retroactivo), ver
  // cartera:reajustarTarifaCategoria más abajo.
  envolverHandle('cartera:recategorizar', async (event, payload) => {
    try {
      return { success: true, data: carteraService.recategorizar({ ...payload, usuarioId: getSesionActual().id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Vista previa de recategorizar sobre varias cuentas CON la tarifa que ya está en la base
  // (a diferencia de simularReajustarTarifaCategoria, que además prueba una tarifa nueva que
  // todavía no existe) -- para el aviso que se dispara después de categorias:crearTarifa (ver
  // Categorias.showTarifaModal): si la tarifa que se acaba de guardar dejó cargos ya causados
  // desalineados, esto lo detecta sin insertar nada más.
  envolverHandle('cartera:simularRecategorizarLote', async (event, payload) => {
    try {
      return { success: true, data: carteraService.simularRecategorizarLote(payload) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Aplica recategorizar sobre varias cuentas SIN tocar categoria_tarifas -- para cuando la
  // tarifa ya se creó por separado (ver cartera:simularRecategorizarLote) y solo falta corregir
  // los cargos ya causados.
  envolverHandle('cartera:recategorizarLote', async (event, payload) => {
    try {
      return { success: true, data: carteraService.recategorizarLote({ ...payload, usuarioId: getSesionActual().id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Vista previa del reajuste de tarifa de una categoría completa: NO escribe nada -- corre la
  // misma transacción real (crear la tarifa nueva + AjusteCategoria a cada cuenta) y la
  // revierte a propósito, así nunca se puede desincronizar de lo que aplicar() haría de
  // verdad. cuentaIds normalmente sale de categorias:getCuentasConCategoria(categoriaId).
  envolverHandle('cartera:simularReajustarTarifaCategoria', async (event, payload) => {
    try {
      return { success: true, data: carteraService.simularReajustarTarifaCategoria(payload) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Aplica el reajuste de tarifa: crea la tarifa nueva (categoria_tarifas) y corrige con
  // AjusteCategoria a cada cuenta de cuentaIds -- en una sola transacción. Solo Administrador:
  // puede mover mucha plata de golpe y con efecto retroactivo, mismo nivel que
  // asientos:crearManual/caja:regularizarSaldos (ver CANALES_SOLO_ADMIN).
  envolverHandle('cartera:reajustarTarifaCategoria', async (event, payload) => {
    try {
      return { success: true, data: carteraService.reajustarTarifaCategoria({ ...payload, usuarioId: getSesionActual().id }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registrarCarteraHandlers };
