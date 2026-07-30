// scripts/import-cartera/aplicar-base.js
const CategoriaRepository = require('../../src/repositories/CategoriaRepository');
const CuentaRepository = require('../../src/repositories/CuentaRepository');
const CuentaEstadoRepository = require('../../src/repositories/CuentaEstadoRepository');
const CarteraRepository = require('../../src/repositories/CarteraRepository');
const { anioMesDeFecha, codificarPeriodo, decodificarPeriodo, primerDiaDelMes } = require('../../src/services/cartera/periodos');

// Tarifas históricas limpias (spec §10.2). Se cargan siempre desde cero: cualquier fila previa
// de categoria_tarifas se borra primero (incluidas las inválidas con vigencia invertida que
// trae la base real).
const TARIFAS = {
  'Finca': [[5000, '2022-01-01', '2023-12-31'], [10000, '2024-01-01', null]],
  'Finca con piscina': [[8000, '2022-01-01', '2023-12-31'], [16000, '2024-01-01', null]],
  'Tienda': [[12000, '2022-01-01', '2023-12-31'], [20000, '2024-01-01', null]],
  'Finca para alquiler': [[20000, '2022-01-01', '2023-12-31'], [50000, '2024-01-01', null]]
};

const ANCLA_CATEGORIA = '2000-01-01';   // convención ya usada en el proyecto (ReporteRepository) para "desde siempre"

function limpiarYCargarTarifas(db, categoriaRepo) {
  for (const [nombre, tramos] of Object.entries(TARIFAS)) {
    const categoria = categoriaRepo.findByNombre(nombre);
    if (!categoria) throw new Error(`Categoría no encontrada en la base: ${nombre}`);
    db.prepare(`DELETE FROM categoria_tarifas WHERE categoria_id = ?`).run(categoria.id);
    for (const [tarifa, desde] of tramos) {
      categoriaRepo.crearTarifa(categoria.id, tarifa, desde, 'Carga inicial cartera 2026-07');
    }
  }
}

function asignarCategoria(db, categoriaRepo, cuenta) {
  const categoria = categoriaRepo.findByNombre(cuenta.categoriaNombre);
  if (!categoria) throw new Error(`Categoría no encontrada: ${cuenta.categoriaNombre}`);
  categoriaRepo.asignarACuenta(cuenta.cuentaId, categoria.id, ANCLA_CATEGORIA, 'Carga inicial cartera 2026-07');

  if (cuenta.categoriaNombre2024) {
    const categoria2024 = categoriaRepo.findByNombre(cuenta.categoriaNombre2024);
    categoriaRepo.asignarACuenta(cuenta.cuentaId, categoria2024.id, '2024-01-01', 'Carga inicial cartera 2026-07: cambio de tarifa 2024');
  }
}

// Mes siguiente al último recibo no anulado de la cuenta, como fecha de inicio de suspensión
// (spec §10.6): "no se genera deuda desde el último pago, pero si se vuelve a ver se reactiva".
function mesSiguienteAlUltimoRecibo(db, cuentaId) {
  const fila = db.prepare(`SELECT MAX(fecha_recibo) AS f FROM recibos WHERE cuenta_id = ? AND estado != 'Anulado'`).get(cuentaId);
  if (!fila || !fila.f) return null;
  const { anio, mes } = anioMesDeFecha(fila.f);
  const siguiente = decodificarPeriodo(codificarPeriodo(anio, mes) + 1);
  return primerDiaDelMes(siguiente.anio, siguiente.mes);
}

function sembrarEstado(estadoRepo, db, cuenta) {
  if (estadoRepo.getVigencias(cuenta.cuentaId).length > 0) return false;   // idempotente: ya tiene historial

  if (!cuenta.candidatoSuspension) {
    estadoRepo.sembrarVigenciaInicial({ cuentaId: cuenta.cuentaId, estado: 'Activo', fechaInicio: ANCLA_CATEGORIA, motivo: 'Carga inicial cartera 2026-07' });
    return false;
  }

  const fechaSuspension = mesSiguienteAlUltimoRecibo(db, cuenta.cuentaId) || ANCLA_CATEGORIA;
  estadoRepo.sembrarVigenciaInicial({ cuentaId: cuenta.cuentaId, estado: 'Activo', fechaInicio: ANCLA_CATEGORIA, motivo: 'Carga inicial cartera 2026-07' });
  estadoRepo.cambiarEstado({ cuentaId: cuenta.cuentaId, estado: 'Suspendido', fechaInicio: fechaSuspension, motivo: 'no encontrado (Datos.xlsx)' });
  return true;
}

function crearAperturaSiHaceFalta(db, carteraRepo, cuentaId, apertura, usuarioId) {
  if (!(apertura.monto > 0)) return false;
  const yaExiste = db.prepare(`SELECT 1 FROM cartera_movimientos WHERE cuenta_id = ? AND tipo = 'AperturaOpaca'`).get(cuentaId);
  if (yaExiste) return false;
  carteraRepo.crearMovimiento({
    cuentaId, fecha: '2021-12-31', tipo: 'AperturaOpaca', exigible: 0, monto: apertura.monto,
    observaciones: `Carga inicial cartera 2026-07 (fuente: ${apertura.fuente})`, usuarioId
  });
  return true;
}

function crearHuerfano(db, categoriaRepo, cuentaRepo, estadoRepo, huerfano) {
  const yaExiste = db.prepare(`SELECT id FROM cuentas WHERE codigo = ?`).get(huerfano.codigo);
  if (yaExiste) return { cuentaId: yaExiste.id, creado: false };

  const categoria = categoriaRepo.findByNombre(huerfano.categoriaNombre);
  db.prepare(`INSERT INTO propietarios (nombre_completo) VALUES (?)`).run(huerfano.nombre);
  const propietarioId = db.prepare(`SELECT last_insert_rowid() AS id`).get().id;

  // motivoSuspension null significa "se crea Activa" (caso S03321: tiene teléfono propio en
  // Datos.xlsx, nada indica que no exista) — solo se suspende cuando hay un motivo real (C021).
  const estadoInicial = huerfano.motivoSuspension ? 'Suspendido' : 'Activo';
  const cuentaId = cuentaRepo.create({
    codigo: huerfano.codigo, direccion: 'Sin dirección registrada', estado: estadoInicial,
    observaciones: 'Creada en la carga inicial de cartera: aparece en el Excel, no en la base.',
    categoria_id: categoria.id, categoria_fecha_inicio: ANCLA_CATEGORIA
  });

  db.prepare(`INSERT INTO cuenta_propietarios (cuenta_id, propietario_id, fecha_inicio) VALUES (?, ?, ?)`)
    .run(cuentaId, propietarioId, ANCLA_CATEGORIA);

  estadoRepo.sembrarVigenciaInicial({ cuentaId, estado: 'Activo', fechaInicio: ANCLA_CATEGORIA, motivo: 'Carga inicial cartera 2026-07' });
  if (huerfano.motivoSuspension) {
    estadoRepo.cambiarEstado({ cuentaId, estado: 'Suspendido', fechaInicio: ANCLA_CATEGORIA, motivo: huerfano.motivoSuspension });
  }

  return { cuentaId, creado: true };
}

function aplicarBase({ plan, dbService, usuarioId }) {
  const db = dbService.getDb();
  const categoriaRepo = new CategoriaRepository(dbService);
  const cuentaRepo = new CuentaRepository(dbService);
  const estadoRepo = new CuentaEstadoRepository(dbService);
  const carteraRepo = new CarteraRepository(dbService);

  return db.transaction(() => {
    limpiarYCargarTarifas(db, categoriaRepo);

    let categoriasAsignadas = 0, cuentasSuspendidas = 0, aperturasCreadas = 0, totalApertura = 0;

    for (const cuenta of plan.cuentas) {
      asignarCategoria(db, categoriaRepo, cuenta);
      categoriasAsignadas++;
      if (sembrarEstado(estadoRepo, db, cuenta)) cuentasSuspendidas++;
      if (crearAperturaSiHaceFalta(db, carteraRepo, cuenta.cuentaId, cuenta.aperturaOpaca, usuarioId)) {
        aperturasCreadas++;
        totalApertura += cuenta.aperturaOpaca.monto;
      }
    }

    let huerfanosCreados = 0;
    for (const huerfano of plan.huerfanosACrear) {
      const { creado, cuentaId } = crearHuerfano(db, categoriaRepo, cuentaRepo, estadoRepo, huerfano);
      if (creado) {
        huerfanosCreados++;
        if (huerfano.motivoSuspension) cuentasSuspendidas++;
        if (crearAperturaSiHaceFalta(db, carteraRepo, cuentaId, huerfano.aperturaOpaca, usuarioId)) {
          aperturasCreadas++;
          totalApertura += huerfano.aperturaOpaca.monto;
        }
      }
    }

    return { categoriasAsignadas, cuentasSuspendidas, huerfanosCreados, aperturasCreadas, totalApertura };
  })();
}

module.exports = { aplicarBase };
