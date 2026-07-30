// scripts/import-cartera/aplicar-causacion-abonos.js
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const CuentaEstadoRepository = require('../../src/repositories/CuentaEstadoRepository');
const PagoRepository = require('../../src/repositories/PagoRepository');
const CarteraService = require('../../src/services/CarteraService');
const { codificarPeriodo, decodificarPeriodo, primerDiaDelMes } = require('../../src/services/cartera/periodos');

// El texto que distingue un recibo de conexión (punto nuevo de agua) de uno de sostenimiento
// o abono a la deuda. Verificado contra los 2.429 recibos reales: 151 traen alguna de estas
// dos frases y ninguno de sostenimiento/abono las trae.
const PATRON_CONEXION = /PUNTO\s*(DE\s*)?AGUA|PUNTO\s*NUEVO/i;

// Causación histórica escribiendo DIRECTO por CarteraRepository, sin pasar por
// CarteraService.asegurarCausacion: es la excepción documentada en el spec (§6) para que la
// carga inicial pueda escribir en 2022-2025, que a partir de que existan períodos contables
// cerrados NO podría hacer la vía operativa normal.
function causarHistorico({ cuentaId, dbService, hastaAnio, hastaMes }) {
  const carteraRepo = new CarteraRepository(dbService);
  const estadoRepo = new CuentaEstadoRepository(dbService);
  const pagoRepo = new PagoRepository(dbService);
  const carteraService = new CarteraService(dbService);

  const ancla = carteraService.getFechaInicioFacturacion(cuentaId);
  if (!ancla) return 0;

  const [anioIni, mesIni] = ancla.split('-').map(Number);
  const desdeCod = codificarPeriodo(anioIni, mesIni);
  const hastaCod = codificarPeriodo(hastaAnio, hastaMes);
  const yaCausados = carteraRepo.getMesesCausados(cuentaId);

  let creados = 0;
  for (let cod = desdeCod; cod <= hastaCod; cod++) {
    if (yaCausados.has(cod)) continue;
    const { anio, mes } = decodificarPeriodo(cod);

    if (estadoRepo.estadoEnMes(cuentaId, anio, mes) !== 'Activo') continue;

    const tarifa = pagoRepo.getCategoriaTarifaParaMes(cuentaId, anio, mes);
    if (!tarifa) continue;

    carteraRepo.crearMovimiento({
      cuentaId, fecha: primerDiaDelMes(anio, mes), tipo: 'CargoMensual', exigible: 1,
      monto: tarifa.tarifa_sostenimiento, anio, mes,
      observaciones: 'Carga inicial cartera 2026-07'
    });
    creados++;
  }
  return creados;
}

// Cada recibo_detalle de sostenimiento o "abono a la deuda" (todo lo que no sea conexión) se
// registra como un Abono en cartera, en orden cronológico, con imputación FIFO -- el mismo
// orden en que el Excel de cartera los fue restando de la deuda acumulada.
function cargarAbonos({ cuentaId, dbService, usuarioId }) {
  const db = dbService.getDb();
  const carteraService = new CarteraService(dbService);

  // better-sqlite3 no trae REGEXP registrado por defecto: se filtra con dos LIKE, equivalentes
  // en la práctica al patrón PATRON_CONEXION (verificado contra los 2.429 recibos reales).
  const detalles = db.prepare(`
    SELECT rd.id AS recibo_detalle_id, rd.concepto, rd.valor, r.fecha_recibo
    FROM recibo_detalles rd
    INNER JOIN recibos r ON r.id = rd.recibo_id
    WHERE r.cuenta_id = ? AND r.estado != 'Anulado' AND rd.valor > 0
      AND rd.concepto NOT LIKE '%PUNTO%AGUA%' AND rd.concepto NOT LIKE '%PUNTO NUEVO%'
    ORDER BY r.fecha_recibo ASC, r.numero_recibo ASC, rd.id ASC
  `).all(cuentaId);

  let creados = 0, total = 0;
  for (const d of detalles) {
    const yaExiste = db.prepare(`SELECT 1 FROM cartera_movimientos WHERE recibo_detalle_id = ?`).get(d.recibo_detalle_id);
    if (yaExiste) continue;

    const fecha = String(d.fecha_recibo).split(' ')[0];
    carteraService.registrarAbono({
      cuentaId, fecha, monto: d.valor, modo: CarteraService.MODOS.ABONO_DEUDA_FIFO,
      reciboDetalleId: d.recibo_detalle_id, observaciones: 'Carga inicial cartera 2026-07', usuarioId
    });
    creados++;
    total += d.valor;
  }
  return { creados, total };
}

function causarYAbonar({ cuentaId, dbService, usuarioId, hastaAnio, hastaMes }) {
  const db = dbService.getDb();
  return db.transaction(() => {
    const cargosCreados = causarHistorico({ cuentaId, dbService, hastaAnio, hastaMes });
    const { creados: abonosCreados, total: totalAbonado } = cargarAbonos({ cuentaId, dbService, usuarioId });
    return { cargosCreados, abonosCreados, totalAbonado };
  })();
}

module.exports = { causarYAbonar, PATRON_CONEXION };
