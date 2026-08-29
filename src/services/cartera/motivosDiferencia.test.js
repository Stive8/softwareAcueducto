const test = require('node:test');
const assert = require('node:assert/strict');
const { MOTIVOS_DIFERENCIA, getMotivoDiferencia } = require('./motivosDiferencia');

const LAS_12_CUENTAS_ORIGINALES = [
  'S0312', 'S048', 'S010', 'S034', 'R079', 'R068', 'S03351',
  'R080', 'R091', 'S0244', 'C021', 'S0162'
];

// Auditoría 2026-08-29: npm run conciliacion (recién destrabada, ver corrección de R031 en
// paso11-conciliacion.js) reveló 23 cuentas más con diferencia real y documentada en
// paso9b-correcciones.js (correcciones 8, 19-22, 25, 27, 29, 32, 34) que nunca se agregaron acá
// -- quien abría el detalle de esas cuentas no veía ninguna explicación en pantalla.
const CUENTAS_NUEVAS_2026_08_29 = [
  'R002', 'R0501', 'S009', 'R0971', 'S044', 'S0141', 'S0441',
  'R047', 'C004', 'S039', 'S0334', 'S0338', 'R0942', 'C0041', 'S042',
  'R0301', 'R013', 'R049', 'R0131', 'C016', 'S022', 'S0271', 'S0383', 'S023'
];

const TODAS_LAS_CUENTAS = [...LAS_12_CUENTAS_ORIGINALES, ...CUENTAS_NUEVAS_2026_08_29];

test('motivosDiferencia: S0393 ya no está documentada -- cierra tras reasignar el recibo 2137', () => {
  assert.equal(getMotivoDiferencia('S0393'), null);
});

test('motivosDiferencia: todas las cuentas documentadas tienen texto, sin sobrantes', () => {
  for (const codigo of TODAS_LAS_CUENTAS) {
    const motivo = getMotivoDiferencia(codigo);
    assert.ok(motivo && motivo.length > 0, `${codigo} debe tener un motivo`);
  }
  assert.equal(Object.keys(MOTIVOS_DIFERENCIA).length, TODAS_LAS_CUENTAS.length);
});

test('motivosDiferencia: una cuenta sin diferencia documentada devuelve null', () => {
  assert.equal(getMotivoDiferencia('R068888'), null);
  assert.equal(getMotivoDiferencia('S9999'), null);
});

test('motivosDiferencia: cada texto deja explícito que el monto es la diferencia frente al Excel, no lo que se cobra', () => {
  for (const codigo of TODAS_LAS_CUENTAS) {
    const motivo = getMotivoDiferencia(codigo);
    assert.match(motivo, /diferencia frente al Excel/, `${codigo}: debe aclarar que el monto es la diferencia contra CARTERA`);
    assert.doesNotMatch(motivo, /debe \$/i, `${codigo}: no debe afirmar "debe $X", eso lo calcula aPagar en vivo`);
  }
});
