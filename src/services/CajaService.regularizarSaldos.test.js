// src/services/CajaService.regularizarSaldos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const CajaService = require('./CajaService');
const AsientoContableService = require('./AsientoContableService');
const ConfiguracionService = require('./ConfiguracionService');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

function seedSaldoCaja(dbService, monto) {
  new ConfiguracionRepository(dbService).actualizar('saldo_caja_inicial', String(monto));
}

function seedSaldoBanco(dbService, monto) {
  new ConfiguracionRepository(dbService).actualizar('saldo_banco_inicial', String(monto));
}

test('regularizarSaldos() reduce el saldo de Caja cuando el saldo real es menor al calculado (egresos históricos no registrados)', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    const service = new CajaService(ctx.dbService);
    assert.equal(service.repository.getSaldoCaja(), 129000000);

    const resultado = service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Regularización de arranque: arqueo físico de caja'
    });

    assert.equal(resultado.saldoFinalCaja, 3000000);
    assert.ok(resultado.ajusteCaja, 'Debe haber creado un asiento de ajuste para Caja');
    assert.equal(resultado.ajusteBanco, null, 'No debe tocar Banco si no hay diferencia');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() aumenta el saldo de Banco cuando el saldo real es mayor al calculado', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoBanco(ctx.dbService, 10000000);
    const service = new CajaService(ctx.dbService);

    const resultado = service.regularizarSaldos({
      fecha: '2026-01-15',
      saldoRealCaja: service.repository.getSaldoCaja(),
      saldoRealBanco: 15000000,
      motivo: 'Se encontró un rendimiento financiero no registrado'
    });

    assert.equal(resultado.saldoFinalBanco, 15000000);
    assert.ok(resultado.ajusteBanco);
    assert.equal(resultado.ajusteCaja, null);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() ajusta Caja y Banco a la vez, en dos asientos separados, cuando ambos difieren', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    seedSaldoBanco(ctx.dbService, 0);
    const service = new CajaService(ctx.dbService);

    const resultado = service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: 50000000,
      motivo: 'Regularización de arranque al 31/12/2025 (arqueo + extracto)'
    });

    assert.equal(resultado.saldoFinalCaja, 3000000);
    assert.equal(resultado.saldoFinalBanco, 50000000);
    assert.ok(resultado.ajusteCaja);
    assert.ok(resultado.ajusteBanco);
    assert.notEqual(resultado.ajusteCaja, resultado.ajusteBanco, 'Deben ser dos asientos separados');
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() deja el libro simple y la doble partida conciliados después del ajuste', () => {
  const ctx = crearDbTemporal();
  try {
    // A diferencia de las demás pruebas de este archivo, acá no alcanza con sembrar el saldo
    // inicial vía ConfiguracionRepository (eso solo alimenta el libro simple). Este caso valida
    // conciliación con la doble partida, así que el saldo inicial debe sembrarse por el mismo
    // camino que usa producción (ConfiguracionService -> AsientoContableService.
    // sincronizarAperturaSaldoInicial, ver ConfiguracionService.aperturaSaldoInicial.test.js),
    // que sí deja ambos libros sincronizados desde el arranque.
    const asientoContableService = new AsientoContableService(ctx.dbService);
    const configuracionService = new ConfiguracionService(ctx.dbService, asientoContableService);
    configuracionService.actualizar({ saldo_caja_inicial: 129000000 }, 1);
    const service = new CajaService(ctx.dbService);

    service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Regularización de arranque'
    });

    const conciliacion = asientoContableService.verificarConciliacionCajaBanco();
    const caja = conciliacion.find(f => f.cuenta === 'Caja');
    assert.equal(caja.saldoLedgerSimple, 3000000);
    assert.equal(caja.saldoDoblePartida, 3000000);
    assert.equal(caja.conciliado, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() registra el asiento con la cuenta y el sentido débito/crédito correctos (auditable)', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    seedSaldoBanco(ctx.dbService, 10000000);
    const service = new CajaService(ctx.dbService);
    const asientoContableService = new AsientoContableService(ctx.dbService);

    const resultado = service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000, // diferencia negativa: -126.000.000
      saldoRealBanco: 15000000, // diferencia positiva: +5.000.000
      motivo: 'Prueba de auditabilidad del asiento',
      usuarioId: 1
    });

    const asientoCaja = asientoContableService.getById(resultado.ajusteCaja);
    assert.equal(asientoCaja.usuario_id, 1, 'El asiento debe quedar atribuido al usuario que hizo el ajuste');
    const lineaCaja = asientoCaja.lineas.find(l => l.cuenta_codigo === '110505');
    const lineaPatrimonioCaja = asientoCaja.lineas.find(l => l.cuenta_codigo === '3105');
    assert.ok(lineaCaja && lineaPatrimonioCaja, 'El asiento de Caja debe tener una línea contra 110505 (Caja) y otra contra 3105 (Patrimonio)');
    assert.equal(lineaCaja.credito, 126000000, 'Diferencia negativa: se acredita Caja');
    assert.equal(lineaCaja.debito, 0);
    assert.equal(lineaPatrimonioCaja.debito, 126000000, 'y se debita Patrimonio por el mismo monto');
    assert.equal(lineaPatrimonioCaja.credito, 0);

    const asientoBanco = asientoContableService.getById(resultado.ajusteBanco);
    assert.equal(asientoBanco.usuario_id, 1);
    const lineaBanco = asientoBanco.lineas.find(l => l.cuenta_codigo === '111005');
    const lineaPatrimonioBanco = asientoBanco.lineas.find(l => l.cuenta_codigo === '3105');
    assert.ok(lineaBanco && lineaPatrimonioBanco, 'El asiento de Banco debe tener una línea contra 111005 (Banco) y otra contra 3105 (Patrimonio)');
    assert.equal(lineaBanco.debito, 5000000, 'Diferencia positiva: se debita Banco');
    assert.equal(lineaBanco.credito, 0);
    assert.equal(lineaPatrimonioBanco.credito, 5000000, 'y se acredita Patrimonio por el mismo monto');
    assert.equal(lineaPatrimonioBanco.debito, 0);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() rechaza el ajuste si los saldos reales ya coinciden con los calculados', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.regularizarSaldos({ fecha: '2026-01-01', saldoRealCaja: 0, saldoRealBanco: 0, motivo: 'No debería crear nada' }),
      /No hay ninguna diferencia/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() exige un motivo no vacío', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.regularizarSaldos({ fecha: '2026-01-01', saldoRealCaja: 5000, saldoRealBanco: 0, motivo: '   ' }),
      /motivo/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() rechaza saldos negativos', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    assert.throws(
      () => service.regularizarSaldos({ fecha: '2026-01-01', saldoRealCaja: -100, saldoRealBanco: 0, motivo: 'x' }),
      /mayor o igual a cero/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() es reutilizable: un segundo ajuste posterior no se acumula con el anterior', () => {
  const ctx = crearDbTemporal();
  try {
    seedSaldoCaja(ctx.dbService, 129000000);
    const service = new CajaService(ctx.dbService);

    service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Ajuste de arranque'
    });

    const resultado = service.regularizarSaldos({
      fecha: '2026-03-31',
      saldoRealCaja: 2500000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Diferencia por comisión bancaria no registrada'
    });

    assert.equal(resultado.saldoFinalCaja, 2500000);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() también cierra una divergencia previa entre libro simple y doble partida (hallazgo Alto A1, auditoría 2026-09-11)', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new CajaService(ctx.dbService);
    const asientoContableService = new AsientoContableService(ctx.dbService);

    // Divergencia previa: una fila de libro simple ($300.000 de Ingreso en Caja) sin ningún
    // asiento contable detrás -- el mismo patrón que el commit 797c4e7 tuvo que reparar a mano
    // para 50 recibos reales. La doble partida queda en 0 mientras el libro simple ya tiene 300.000.
    service.repository.crearMovimiento({
      tipo: 'Ingreso', origen: 'Caja', monto: 300000,
      concepto: 'Ingreso sin asiento (divergencia simulada)', fechaMovimiento: '2025-06-01'
    });
    assert.equal(service.repository.getSaldoCaja(), 300000);
    assert.equal(
      asientoContableService.verificarConciliacionCajaBanco().find(f => f.cuenta === 'Caja').saldoDoblePartida,
      0
    );

    const resultado = service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 250000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Arqueo físico de caja'
    });

    assert.equal(resultado.saldoFinalCaja, 250000);
    const caja = asientoContableService.verificarConciliacionCajaBanco().find(f => f.cuenta === 'Caja');
    assert.equal(caja.saldoLedgerSimple, 250000);
    assert.equal(caja.saldoDoblePartida, 250000, 'La doble partida debe terminar en el valor real, no en -50.000');
    assert.equal(caja.conciliado, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() no crea un asiento adicional si el libro simple y la doble partida ya estaban sincronizados', () => {
  const ctx = crearDbTemporal();
  try {
    const asientoContableService = new AsientoContableService(ctx.dbService);
    const configuracionService = new ConfiguracionService(ctx.dbService, asientoContableService);
    // Sembrar por el camino que sí mantiene ambos libros sincronizados desde el arranque (ver
    // ConfiguracionService.aperturaSaldoInicial.test.js), a diferencia de seedSaldoCaja() de
    // arriba (que solo toca el libro simple, a propósito, para los tests que no necesitan la
    // doble partida).
    configuracionService.actualizar({ saldo_caja_inicial: 129000000 }, 1);
    const service = new CajaService(ctx.dbService);

    const antes = asientoContableService.getAll({ limit: 1000 }).data.length;
    service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 3000000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Arqueo físico de caja'
    });
    const despues = asientoContableService.getAll({ limit: 1000 }).data.length;

    // La apertura (ya contada en "antes") + exactamente 1 asiento de ajuste de Caja; ningún
    // segundo asiento de cierre de divergencia, porque no había ninguna divergencia que cerrar.
    assert.equal(despues - antes, 1);
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('regularizarSaldos() reconcilia la familia completa de Caja (General + Menor), no solo la hoja de la cuenta automática (revisión de A1)', () => {
  const ctx = crearDbTemporal();
  try {
    const db = ctx.dbService.getDb();
    const service = new CajaService(ctx.dbService);
    const asientoContableService = new AsientoContableService(ctx.dbService);

    // Divergencia previa, pero esta vez en la cuenta HERMANA de la automática: un asiento
    // contra Caja Menor (110510), que desde la migración 029 no es descendiente de Caja General
    // (110505, la cuenta automática configurada) sino hermana bajo el mismo ancestro '1105'.
    // sincronizarLedgerSimple: false simula que ese asiento nunca se reflejó en el libro simple
    // `movimientos` (el mismo patrón de desincronización que este hallazgo corrige, pero esta vez
    // escondido en la subcuenta hermana en vez de en la cuenta automática misma).
    const cajaMenor = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '110510'`).get();
    const patrimonio = db.prepare(`SELECT id FROM plan_cuentas WHERE codigo = '3105'`).get();
    assert.ok(cajaMenor && patrimonio, 'El plan de cuentas sembrado debe traer 110510 y 3105');

    asientoContableService.crearManual({
      fecha: '2025-06-01',
      concepto: 'Saldo en Caja Menor sin reflejo en libro simple (divergencia simulada)',
      lineas: [
        { cuentaContableId: cajaMenor.id, debito: 40000, credito: 0 },
        { cuentaContableId: patrimonio.id, debito: 0, credito: 40000 }
      ],
      sincronizarLedgerSimple: false
    });

    // El libro simple sigue en 0 (nunca se tocó `movimientos`); la doble partida de la familia
    // Caja (110505 + 110510) ya tiene 40.000, todos en Caja Menor.
    assert.equal(service.repository.getSaldoCaja(), 0);
    const antesDelAjuste = asientoContableService.verificarConciliacionCajaBanco().find(f => f.cuenta === 'Caja');
    assert.equal(antesDelAjuste.saldoDoblePartida, 40000, 'La doble partida de la familia Caja debe incluir el saldo de Caja Menor, no solo el de Caja General');

    const resultado = service.regularizarSaldos({
      fecha: '2025-12-31',
      saldoRealCaja: 40000,
      saldoRealBanco: service.repository.getSaldoBanco(),
      motivo: 'Arqueo físico de caja'
    });

    assert.equal(resultado.saldoFinalCaja, 40000);
    const caja = asientoContableService.verificarConciliacionCajaBanco().find(f => f.cuenta === 'Caja');
    assert.equal(caja.saldoLedgerSimple, 40000);
    assert.equal(caja.saldoDoblePartida, 40000, 'La familia completa (General + Menor) debe terminar en el valor real, no en 80.000 ni en otro valor que ignore a Caja Menor');
    assert.equal(caja.conciliado, true);
  } finally {
    cerrarDbTemporal(ctx);
  }
});
