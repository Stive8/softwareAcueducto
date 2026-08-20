// CLI del paso 9b (correcciones puntuales: causación S03311 + tarifa derogada de 4 cuentas).
const fs = require('fs');
const path = require('path');
const { ejecutarPaso9b, VALOR_PUNTO_NUEVO_2026 } = require('./paso9b-correcciones');

function main() {
  const DatabaseService = require('../../src/database/DatabaseService');
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();

  const r = ejecutarPaso9b({ dbService });

  console.log(`S03311: ${r.s03311Creados.length} CargoMensual creados (2024 a 10.000)`);
  for (const t of r.tarifaCorregida) {
    console.log(`${t.codigo}: ${t.borrados} CargoMensual borrados (5.000), ${t.creados} creados (10.000)`);
  }
  console.log(`S0244 propietario: ${r.propietarioS0244.creado ? 'asignado' : 'ya estaba asignado'}`);
  console.log(`Recibo 2137: ${r.reasignacion2137.reasignado ? 'reasignado de S0312 a S0393' : 'ya estaba en S0393'}`);
  console.log(`Recibo 2384: ${r.correccion2384.corregido ? 'período corregido a 2025' : 'ya estaba corregido'} (texto); ${r.reimputacion2384.reimputado ? 're-imputado contra 2025' : 'ya estaba re-imputado'} (modelo nuevo)`);
  console.log(`S010 (recibos 1659/1825): ${r.recalculoS010.yaCorregido ? 'ya estaba corregido' : `1659 eliminado, ${r.recalculoS010.abonos.length} abonos recalculados`}`);
  console.log(`S044 apertura opaca: ${r.correccionAperturaS044.corregido ? 'corregida a 0' : 'ya estaba en 0'}`);
  console.log(`Recibo 2229: ${r.correccionPeriodo2229.corregido ? 'período corregido a enero-junio 2025' : 'ya estaba corregido'} (texto); ${r.reimputacion2229.reimputado ? 're-imputado contra enero-junio 2025' : 'ya estaba re-imputado'}`);
  for (const s of r.suspensionesSinCartera) {
    console.log(`${s.codigo}: ${s.corregido ? 'suspendida' : 'ya estaba suspendida'} (sin fila en CARTERA, sin barrido de campo)`);
  }
  console.log(`S063: ${r.inactivaS063.corregido ? 'pasada a Inactivo' : 'ya estaba Inactivo'} (fusionada con S0365)`);
  console.log(`R0081/S058: ${r.mergeR0081S058.yaAplicado ? 'ya estaba fusionada' : 'recibo movido a R0081, S058 eliminada'}`);
  console.log(`S0312: ${r.reimputacionS0312.resultados.map(x => `recibo ${x.numeroRecibo} ${x.reimputado ? 're-imputado' : 'ya estaba re-imputado'}`).join(', ')}`);
  console.log(`R049: ${r.redencionR049.yaCorregido ? 'ya estaba corregido' : `$${r.redencionR049.aplicado} redimidos contra enero-mayo 2025`}`);
  console.log(`Recibo 458: ${r.reasignacion458.yaAplicado ? 'ya estaba en S03311' : 'reasignado de S0331 a S03311'}`);
  for (const s of r.suspensionIncobrables) {
    console.log(`${s.codigo}: ${s.yaCorregido ? 'ya estaba corregida' : `suspensión movida, ${s.borrados} CargoMensual borrados`}`);
  }
  console.log(`Recibo 1284 (S0244): ${r.reciboFaltanteS0244.yaAplicado ? 'ya existía' : 'creado y reimputado'}`);
  for (const a of r.aperturaIncobrables) {
    console.log(`${a.codigo}: apertura opaca ${a.yaCorregido ? 'ya estaba en 0' : `puesta en 0 (era $${a.montoAnterior})`}`);
  }
  for (const c of r.cuentasNuevas2026) {
    console.log(`${c.codigo}: ${c.yaAplicado ? 'ya existía' : `cuenta creada, punto $${VALOR_PUNTO_NUEVO_2026} (abono $100.000, saldo $${c.saldoPendiente})`}`);
  }
  const corregidos = r.periodosTextoCorregidos.filter(p => p.corregido);
  console.log(`Períodos de texto (Historial de Aportes): ${corregidos.length} recibo_detalles corregidos de ${r.periodosTextoCorregidos.length} evaluados`);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `paso9b-resultado_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(r, null, 2), 'utf8');
  console.log(`Reporte completo: ${outPath}`);

  dbService.close();
}

main();
