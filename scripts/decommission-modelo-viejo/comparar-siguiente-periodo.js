// scripts/decommission-modelo-viejo/comparar-siguiente-periodo.js
//
// Compara, para las 318 cuentas reales, el "próximo período sugerido" que da hoy
// PagoService.getEstadoCuenta contra lo que el modelo viejo (pago_periodos, sin pasar por
// cartera) hubiera dado. Se escribió para verificar, antes de aceptarlo, el fix descrito en
// docs/superpowers/specs/2026-08-09-proximo-periodo-sugerido-design.md -- y precisamente
// porque atrapó un problema real (112 cuentas retrocedían en vez de sólo las 58 esperadas)
// queda acá como herramienta reutilizable para las fases 2 y 3 del decommission del modelo
// viejo (docs/superpowers/specs/2026-08-09-decommission-modelo-viejo-fase1-design.md), que van
// a mover más cálculos de pago_periodos a cartera_movimientos y van a necesitar el mismo tipo
// de comparación cuenta por cuenta antes de aceptar cada cambio.
//
// Uso: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe scripts/decommission-modelo-viejo/comparar-siguiente-periodo.js
const path = require('path');
const DatabaseService = require('../../src/database/DatabaseService');
const PagoService = require('../../src/services/PagoService');
const PagoRepository = require('../../src/repositories/PagoRepository');

function codificarPeriodo(anio, mes) { return anio * 12 + (mes - 1); }

function calcularSiguienteModeloViejo(pagoRepo, db, cuentaId) {
  const ultimoPagado = pagoRepo.getUltimoPeriodoPagado(cuentaId);
  if (ultimoPagado) {
    const cod = codificarPeriodo(ultimoPagado.anio, ultimoPagado.mes) + 1;
    return { anio: Math.floor(cod / 12), mes: (cod % 12) + 1 };
  }
  const cuenta = db.prepare('SELECT fecha_creacion FROM cuentas WHERE id = ?').get(cuentaId);
  const fechaInicio = pagoRepo.getFechaInicioFacturacion(cuentaId) || cuenta.fecha_creacion;
  const [anio, mes] = fechaInicio.split(' ')[0].split('-').map(Number);
  return { anio, mes };
}

function main() {
  const dbService = new DatabaseService(path.join(__dirname, '..', '..'));
  dbService.initialize();
  const db = dbService.getDb();
  const pagoService = new PagoService(dbService);
  const pagoRepoDirecto = new PagoRepository(dbService);

  const cuentas = db.prepare('SELECT id, codigo FROM cuentas ORDER BY codigo').all();
  let iguales = 0, avanzaron = 0, retrocedieron = 0, errores = 0;
  const cambios = [];

  for (const c of cuentas) {
    let estadoNuevo;
    try {
      estadoNuevo = pagoService.getEstadoCuenta(c.id);
    } catch (e) {
      errores++;
      console.log(`ERROR en ${c.codigo}: ${e.message}`);
      continue;
    }

    const siguienteViejo = calcularSiguienteModeloViejo(pagoRepoDirecto, db, c.id);
    const codViejo = codificarPeriodo(siguienteViejo.anio, siguienteViejo.mes);
    const codNuevo = codificarPeriodo(estadoNuevo.siguientePeriodo.anio, estadoNuevo.siguientePeriodo.mes);

    if (codViejo === codNuevo) {
      iguales++;
    } else {
      const cambio = {
        codigo: c.codigo,
        viejo: `${siguienteViejo.anio}-${siguienteViejo.mes}`,
        nuevo: `${estadoNuevo.siguientePeriodo.anio}-${estadoNuevo.siguientePeriodo.mes}`,
        mesesQueAvanzo: codNuevo - codViejo
      };
      if (codNuevo > codViejo) { avanzaron++; cambios.push(cambio); }
      else { retrocedieron++; cambios.push({ ...cambio, RETROCEDIO: true }); }
    }
  }

  console.log(`\nTotal cuentas: ${cuentas.length}`);
  console.log(`Sin cambio: ${iguales}`);
  console.log(`Avanzaron: ${avanzaron}`);
  console.log(`RETROCEDIERON: ${retrocedieron}`);
  console.log(`Errores: ${errores}`);
  console.log(`\n--- detalle de las que cambiaron ---`);
  for (const c of cambios) {
    console.log(` ${c.codigo}: ${c.viejo} -> ${c.nuevo} (${c.mesesQueAvanzo > 0 ? '+' : ''}${c.mesesQueAvanzo} meses)${c.RETROCEDIO ? '  <<< RETROCEDIO' : ''}`);
  }

  dbService.close();
}

main();
