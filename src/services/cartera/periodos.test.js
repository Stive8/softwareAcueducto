// src/services/cartera/periodos.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('./periodos');
const d = require('./dinero');

test('codificarPeriodo y decodificarPeriodo son inversos', () => {
  for (const [anio, mes] of [[2022, 1], [2026, 12], [2000, 6]]) {
    assert.deepEqual(p.decodificarPeriodo(p.codificarPeriodo(anio, mes)), { anio, mes });
  }
});

test('codificarPeriodo permite restar para contar meses', () => {
  const enero2022 = p.codificarPeriodo(2022, 1);
  const julio2026 = p.codificarPeriodo(2026, 7);
  assert.equal(julio2026 - enero2022, 54);
});

test('anioMesDeFecha no se corre por zona horaria en el día 1 del mes', () => {
  // new Date('2026-01-01') sería medianoche UTC = 31/12/2025 19:00 en Colombia (UTC-5),
  // lo que retrocedería el mes entero. Este helper parte el string, no usa Date.
  assert.deepEqual(p.anioMesDeFecha('2026-01-01'), { anio: 2026, mes: 1 });
  assert.deepEqual(p.anioMesDeFecha('2022-03-01'), { anio: 2022, mes: 3 });
  assert.deepEqual(p.anioMesDeFecha('2026-06-13 10:30:00'), { anio: 2026, mes: 6 });
});

test('primerDiaDelMes y ultimoDiaDelMes cubren meses de 28, 29, 30 y 31 días', () => {
  assert.equal(p.primerDiaDelMes(2026, 2), '2026-02-01');
  assert.equal(p.ultimoDiaDelMes(2026, 2), '2026-02-28');
  assert.equal(p.ultimoDiaDelMes(2024, 2), '2024-02-29');   // bisiesto
  assert.equal(p.ultimoDiaDelMes(2026, 4), '2026-04-30');
  assert.equal(p.ultimoDiaDelMes(2026, 12), '2026-12-31');
});

test('diaAnterior retrocede un día cruzando mes y año', () => {
  assert.equal(p.diaAnterior('2026-01-01'), '2025-12-31');
  assert.equal(p.diaAnterior('2026-03-01'), '2026-02-28');
  assert.equal(p.diaAnterior('2026-07-15'), '2026-07-14');
});

test('rangoDeMeses lista los meses inclusive, y vacío si el rango está invertido', () => {
  const r = p.rangoDeMeses(p.codificarPeriodo(2025, 11), p.codificarPeriodo(2026, 2));
  assert.deepEqual(r.map(x => `${x.anio}-${x.mes}`), ['2025-11', '2025-12', '2026-1', '2026-2']);
  assert.equal(p.rangoDeMeses(p.codificarPeriodo(2026, 5), p.codificarPeriodo(2026, 1)).length, 0);
  assert.equal(p.rangoDeMeses(p.codificarPeriodo(2026, 5), p.codificarPeriodo(2026, 5)).length, 1);
});

test('dinero: redondear a 2 decimales y comparar con tolerancia', () => {
  assert.equal(d.redondear(1439.252336448598), 1439.25);
  assert.equal(d.redondear(10000), 10000);
  assert.equal(d.redondear(0.005), 0.01);
  assert.ok(d.sonIguales(10000, 10000.004));
  assert.ok(!d.sonIguales(10000, 10000.5));
  assert.ok(d.esMayor(10001, 10000));
  assert.ok(!d.esMayor(10000.004, 10000));   // dentro de la tolerancia, no es mayor
});
