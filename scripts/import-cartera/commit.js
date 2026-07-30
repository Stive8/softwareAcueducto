// scripts/import-cartera/commit.js
const fs = require('fs');
const path = require('path');
const { generarPlan } = require('./preview');
const { aplicarBase } = require('./aplicar-base');
const { causarYAbonar } = require('./aplicar-causacion-abonos');
const { conciliar } = require('./conciliar');

async function ejecutarCommit({ filePathCartera, filePathDatos, dbService, usuarioId, hastaAnio, hastaMes }) {
  const plan = await generarPlan({ filePathCartera, filePathDatos, dbService });

  const resultadoBase = aplicarBase({ plan, dbService, usuarioId });

  let cuentasProcesadas = 0, cargosCreados = 0, abonosCreados = 0;
  for (const cuenta of plan.cuentas) {
    const r = causarYAbonar({ cuentaId: cuenta.cuentaId, dbService, usuarioId, hastaAnio, hastaMes });
    cuentasProcesadas++;
    cargosCreados += r.cargosCreados;
    abonosCreados += r.abonosCreados;
  }

  const resultadoConciliacion = conciliar({ plan, dbService });

  return {
    plan,
    aplicarBase: resultadoBase,
    causacion: { cuentasProcesadas, cargosCreados, abonosCreados },
    conciliacion: resultadoConciliacion
  };
}

module.exports = { ejecutarCommit };

// --- CLI ---
if (require.main === module) {
  const DatabaseService = require('../../src/database/DatabaseService');

  const raizProyecto = path.join(__dirname, '..', '..');
  const filePathCartera = 'C:\\Users\\Brayhan\\Documents\\ACUEDUCTO\\CARTERA CON SALDO A 2025.xlsx';
  const filePathDatos = 'C:\\Users\\Brayhan\\Documents\\ACUEDUCTO\\Datos.xlsx';

  const dbService = new DatabaseService(raizProyecto);
  dbService.initialize();

  const hoy = new Date();
  const stamp = hoy.toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(raizProyecto, 'backups_automaticos');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `pre_import_cartera_${stamp}.db`);

  dbService.backup(backupPath).then(async () => {
    console.log(`Backup: ${backupPath}`);
    const r = await ejecutarCommit({
      filePathCartera, filePathDatos, dbService, usuarioId: 1,
      hastaAnio: hoy.getFullYear(), hastaMes: hoy.getMonth() + 1
    });

    const outDir = path.join(__dirname, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    const reportePath = path.join(outDir, `commit-log_${stamp}.json`);
    fs.writeFileSync(reportePath, JSON.stringify(r, null, 2), 'utf8');

    console.log(`Categorías asignadas: ${r.aplicarBase.categoriasAsignadas} | suspendidas: ${r.aplicarBase.cuentasSuspendidas} | apertura total: $${r.aplicarBase.totalApertura.toLocaleString('es-CO')}`);
    console.log(`Causación: ${r.causacion.cargosCreados} cargos | Abonos: ${r.causacion.abonosCreados}`);
    console.log(`Conciliación: ${r.conciliacion.coinciden}/${r.conciliacion.comparadas} coinciden. Diferencias: ${r.conciliacion.difieren.length}`);
    if (r.plan.huerfanosACrear.length) console.log(`Huérfanos creados: ${r.plan.huerfanosACrear.map((h) => h.codigo).join(', ')}`);
    if (r.plan.codigosPendientes.length) console.log(`Códigos pendientes de decisión: ${r.plan.codigosPendientes.join(', ')}`);
    if (r.plan.discrepanciasTipo.length) console.log(`Discrepancias TIPO vs categoría: ${r.plan.discrepanciasTipo.length} (ver reporte)`);
    console.log(`Reporte completo: ${reportePath}`);

    dbService.close();
  }).catch((e) => { console.error(e); dbService.close(); process.exit(1); });
}
