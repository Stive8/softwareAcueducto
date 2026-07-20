// scripts/import-gastos/commit.js
const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./csv');
const GastoService = require('../../src/services/GastoService');
const TerceroService = require('../../src/services/TerceroService');
const AsientoContableService = require('../../src/services/AsientoContableService');
const PlanCuentaRepository = require('../../src/repositories/PlanCuentaRepository');
const AuditoriaService = require('../../src/services/AuditoriaService');

const USUARIO_IMPORT = 1; // admin (FK válida en auditoria.usuario_id)
const CODIGO_CAJA_GENERAL = '110505';

function marcador(hoja, filaExcel) {
  return `[import:${hoja}#${filaExcel}]`;
}

// Suma de valores a importar (todas en Efectivo) vs saldo actual de Caja General. Aborta ANTES
// de escribir si no alcanza (defensa; con los datos reales nunca se dispara).
function preflightSaldo(dbService, filas) {
  const planRepo = new PlanCuentaRepository(dbService);
  const asientoSvc = new AsientoContableService(dbService);
  const caja = planRepo.findByCodigo(CODIGO_CAJA_GENERAL);
  if (!caja) throw new Error(`No se encontró la cuenta ${CODIGO_CAJA_GENERAL}`);
  const saldo = asientoSvc.getLibroMayor(caja.id).saldoFinal;
  const suma = filas.reduce((s, f) => s + Number(f.valor), 0);
  if (suma > saldo) {
    throw new Error(`Preflight de saldo: la suma a importar ($${suma.toLocaleString('es-CO')}) supera el saldo de Caja General ($${saldo.toLocaleString('es-CO')}). Import abortado.`);
  }
  return { saldo, suma };
}

function ejecutarCommit({ csvPath, dbService }) {
  const filas = parseCsv(fs.readFileSync(csvPath, 'utf8')).filter((f) => f.accion === 'IMPORTAR');
  const db = dbService.getDb();
  const gastoService = new GastoService(dbService);
  const terceroService = new TerceroService(dbService);
  const auditoria = new AuditoriaService(dbService);
  const yaExiste = db.prepare(`SELECT 1 FROM gastos WHERE observaciones LIKE ?`);
  const cacheNuevos = new Map(); // numeroIdentificacion → terceroId (evita duplicar dentro de la corrida)

  // Preflight solo sobre las filas AÚN NO importadas: en una re-corrida, las ya comprometidas en
  // una corrida previa no deben volver a restarse del saldo actual de Caja General (que ya las
  // refleja), o se abortaría el import innecesariamente.
  const pendientes = filas.filter((f) => !yaExiste.get(`%${marcador(f.hoja, f.fila_excel)}%`));
  preflightSaldo(dbService, pendientes);

  const log = [];
  let insertadas = 0, yaImportadas = 0, errores = 0;

  for (const f of filas) {
    const marca = marcador(f.hoja, f.fila_excel);
    if (yaExiste.get(`%${marca}%`)) { yaImportadas++; log.push({ fila: f.fila_excel, estado: 'YA_IMPORTADA' }); continue; }

    try {
      // Resolver tercero
      let terceroId;
      if (f.tercero_modo === 'no_informado') terceroId = 1;
      else if (f.tercero_modo === 'existente' || f.tercero_modo === 'revisar_nombre') terceroId = Number(f.tercero_id);
      else if (f.tercero_modo === 'nuevo') {
        if (cacheNuevos.has(f.tercero_numero_id)) terceroId = cacheNuevos.get(f.tercero_numero_id);
        else {
          const yaTercero = db.prepare(`SELECT id FROM terceros WHERE numero_identificacion = ?`).get(f.tercero_numero_id);
          terceroId = yaTercero ? yaTercero.id : terceroService.create({
            tipoIdentificacion: f.tercero_tipo_id, numeroIdentificacion: f.tercero_numero_id,
            nombreRazonSocial: f.tercero_nombre, esProveedor: true,
          });
          cacheNuevos.set(f.tercero_numero_id, terceroId);
        }
      } else throw new Error(`tercero_modo inválido: ${f.tercero_modo}`);

      const obsBase = f.observaciones ? `${f.observaciones} ` : '';
      const gastoData = {
        fechaGasto: f.fecha, concepto: f.concepto, tipoGasto: f.tipo_gasto, valor: Number(f.valor),
        metodoPago: 'Efectivo', tipoOperacion: 'Compra directa', terceroId,
        observaciones: `${obsBase}${marca}`,
      };
      const gastoId = gastoService.create(gastoData, USUARIO_IMPORT);

      // El gasto y su asiento ya son permanentes en este punto (create() ya hizo commit de su
      // propia transacción). Un fallo al registrar la auditoría es un problema aparte y NO debe
      // reportarse como ERROR de la fila: el marcador ya protege contra un reintento duplicado,
      // pero marcar esta fila como ERROR le diría al operador (falsamente) que el gasto no se
      // guardó, y podría llevarlo a reingresarlo manualmente por la UI (sin protección de
      // marcador), generando una partida duplicada.
      insertadas++;
      const entradaLog = { fila: f.fila_excel, estado: 'INSERTADA', gastoId, terceroId };
      try {
        auditoria.registrar({ usuarioId: USUARIO_IMPORT, accion: 'create', tabla: 'gastos', registroId: gastoId, datosNuevos: JSON.stringify(gastoData) });
      } catch (auditError) {
        entradaLog.auditoriaWarning = auditError.message;
      }
      log.push(entradaLog);
    } catch (e) {
      errores++;
      log.push({ fila: f.fila_excel, estado: 'ERROR', mensaje: e.message });
    }
  }

  return { insertadas, yaImportadas, errores, log };
}

module.exports = { ejecutarCommit, marcador };

// --- CLI ---
if (require.main === module) {
  const DatabaseService = require('../../src/database/DatabaseService');
  const hoja = process.argv[2];
  if (!hoja) { console.error('Uso: commit.js <hoja: 2022..2026>'); process.exit(1); }
  const raizProyecto = path.join(__dirname, '..', '..');
  const dbService = new DatabaseService(raizProyecto);
  dbService.initialize();

  // Backup en caliente antes de escribir.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(raizProyecto, 'backups_automaticos');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `pre_import_gastos_${hoja}_${stamp}.db`);
  dbService.backup(backupPath).then(() => {
    console.log(`Backup: ${backupPath}`);
    const csvPath = path.join(__dirname, 'output', `${hoja}-preview.csv`);
    const r = ejecutarCommit({ csvPath, dbService });
    const logPath = path.join(__dirname, 'output', `${hoja}-commit-log.json`);
    fs.writeFileSync(logPath, JSON.stringify(r, null, 2), 'utf8');
    console.log(`Commit ${hoja}: insertadas ${r.insertadas} | ya importadas ${r.yaImportadas} | errores ${r.errores}`);
    console.log(`Log: ${logPath}`);
    dbService.close();
  }).catch((e) => { console.error(e); dbService.close(); process.exit(1); });
}
