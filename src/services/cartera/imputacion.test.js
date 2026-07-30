// src/services/cartera/imputacion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { MODOS, distribuir, calcularCubiertoHasta } = require('./imputacion');

// Cargos de ejemplo: 3 meses de $10.000 sin cubrir, del más antiguo al más nuevo.
function cargosBase() {
  return [
    { id: 1, anio: 2026, mes: 1, pendiente: 10000 },
    { id: 2, anio: 2026, mes: 2, pendiente: 10000 },
    { id: 3, anio: 2026, mes: 3, pendiente: 10000 }
  ];
}

test('FIFO cubre del más antiguo al más nuevo y no deja sobrante si alcanza justo', () => {
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: cargosBase(), monto: 20000 });
  assert.deepEqual(r.imputaciones, [{ cargoId: 1, monto: 10000 }, { cargoId: 2, monto: 10000 }]);
  assert.equal(r.sobrante, 0);
});

test('FIFO deja un cargo parcialmente cubierto cuando el monto no alcanza', () => {
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: cargosBase(), monto: 15000 });
  assert.deepEqual(r.imputaciones, [{ cargoId: 1, monto: 10000 }, { cargoId: 2, monto: 5000 }]);
  assert.equal(r.sobrante, 0);
});

test('FIFO devuelve el excedente como sobrante cuando el abono supera la deuda', () => {
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: cargosBase(), monto: 45000 });
  assert.equal(r.imputaciones.length, 3);
  assert.equal(r.sobrante, 15000);
});

test('FIFO sin cargos pendientes deja todo como sobrante', () => {
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: [], monto: 30000 });
  assert.deepEqual(r.imputaciones, []);
  assert.equal(r.sobrante, 30000);
});

test('abono parcial de medio mes: el caso real de C019 ($5.000 sobre mensualidad $10.000)', () => {
  const r = distribuir({
    modo: MODOS.ABONO_DEUDA_FIFO,
    cargos: [{ id: 1, anio: 2026, mes: 1, pendiente: 10000 }],
    monto: 5000
  });
  assert.deepEqual(r.imputaciones, [{ cargoId: 1, monto: 5000 }]);
  assert.equal(r.sobrante, 0);
});

test('FIFO respeta lo ya cubierto de un cargo parcial', () => {
  const cargos = [
    { id: 1, anio: 2026, mes: 1, pendiente: 4000 },   // ya tenía $6.000 cubiertos
    { id: 2, anio: 2026, mes: 2, pendiente: 10000 }
  ];
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos, monto: 9000 });
  assert.deepEqual(r.imputaciones, [{ cargoId: 1, monto: 4000 }, { cargoId: 2, monto: 5000 }]);
});

test('MESES_ESPECIFICOS cubre solo los cargos elegidos y deja intactos los anteriores', () => {
  // El caso real del recibo "CUOTA DE SOSTENIMIENTO ENERO A DICIEMBRE 2023": cubre 2023
  // dejando 2022 descubierto. FIFO haría lo contrario.
  const cargos = [
    { id: 1, anio: 2022, mes: 1, pendiente: 5000 },
    { id: 2, anio: 2023, mes: 1, pendiente: 5000 },
    { id: 3, anio: 2023, mes: 2, pendiente: 5000 }
  ];
  const r = distribuir({
    modo: MODOS.MESES_ESPECIFICOS, cargos, monto: 10000, cargosElegidos: [2, 3]
  });
  assert.deepEqual(r.imputaciones, [{ cargoId: 2, monto: 5000 }, { cargoId: 3, monto: 5000 }]);
  assert.equal(r.sobrante, 0);
  assert.ok(!r.imputaciones.some(i => i.cargoId === 1), 'no debe tocar el cargo de 2022');
});

test('MESES_ESPECIFICOS ignora ids que no están entre los cargos pendientes', () => {
  const r = distribuir({
    modo: MODOS.MESES_ESPECIFICOS, cargos: cargosBase(), monto: 10000, cargosElegidos: [2, 999]
  });
  assert.deepEqual(r.imputaciones, [{ cargoId: 2, monto: 10000 }]);
  assert.equal(r.sobrante, 0);
});

test('MESES_ESPECIFICOS sin elegidos no imputa nada', () => {
  const r = distribuir({
    modo: MODOS.MESES_ESPECIFICOS, cargos: cargosBase(), monto: 10000, cargosElegidos: []
  });
  assert.deepEqual(r.imputaciones, []);
  assert.equal(r.sobrante, 10000);
});

test('ABONO_SALDO_OPACO usa la misma mecánica FIFO sobre los cargos que reciba', () => {
  const opacos = [{ id: 50, anio: null, mes: null, pendiente: 180000 }];
  const r = distribuir({ modo: MODOS.ABONO_SALDO_OPACO, cargos: opacos, monto: 50000 });
  assert.deepEqual(r.imputaciones, [{ cargoId: 50, monto: 50000 }]);
  assert.equal(r.sobrante, 0);
});

test('ANTICIPO no imputa nada: todo queda como saldo a favor', () => {
  const r = distribuir({ modo: MODOS.ANTICIPO, cargos: cargosBase(), monto: 30000 });
  assert.deepEqual(r.imputaciones, []);
  assert.equal(r.sobrante, 30000);
});

test('distribuir rechaza montos no positivos y modos desconocidos', () => {
  assert.throws(() => distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: [], monto: 0 }),
    /mayor a cero/);
  assert.throws(() => distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos: [], monto: -100 }),
    /mayor a cero/);
  assert.throws(() => distribuir({ modo: 'Inventado', cargos: [], monto: 100 }),
    /Modo de imputación inválido/);
});

test('distribuir redondea a 2 decimales y no deja restos por punto flotante', () => {
  const cargos = [{ id: 1, anio: 2020, mes: 1, pendiente: 1439.252336448598 }];
  const r = distribuir({ modo: MODOS.ABONO_DEUDA_FIFO, cargos, monto: 2000 });
  assert.equal(r.imputaciones[0].monto, 1439.25);
  assert.equal(r.sobrante, 560.75);
});

test('calcularCubiertoHasta devuelve el último mes totalmente cubierto sin descubiertos antes', () => {
  const cargos = [
    { anio: 2026, mes: 1, monto: 10000, cubierto: 10000 },
    { anio: 2026, mes: 2, monto: 10000, cubierto: 10000 },
    { anio: 2026, mes: 3, monto: 10000, cubierto: 4000 }
  ];
  assert.deepEqual(calcularCubiertoHasta(cargos), { anio: 2026, mes: 2 });
});

test('calcularCubiertoHasta se detiene en el primer mes descubierto, aunque después haya pagados', () => {
  // Este es el bug que el sistema viejo tenía: usaba MAX(mes pagado) y decía "al día".
  const cargos = [
    { anio: 2022, mes: 1, monto: 5000, cubierto: 0 },
    { anio: 2023, mes: 1, monto: 5000, cubierto: 5000 },
    { anio: 2023, mes: 2, monto: 5000, cubierto: 5000 }
  ];
  assert.equal(calcularCubiertoHasta(cargos), null);
});

test('calcularCubiertoHasta devuelve null si no hay cargos o ninguno está cubierto', () => {
  assert.equal(calcularCubiertoHasta([]), null);
  assert.equal(calcularCubiertoHasta([{ anio: 2026, mes: 1, monto: 10000, cubierto: 0 }]), null);
});

test('calcularCubiertoHasta ordena por período, no confía en el orden recibido', () => {
  const cargos = [
    { anio: 2026, mes: 2, monto: 10000, cubierto: 10000 },
    { anio: 2026, mes: 1, monto: 10000, cubierto: 10000 }
  ];
  assert.deepEqual(calcularCubiertoHasta(cargos), { anio: 2026, mes: 2 });
});
