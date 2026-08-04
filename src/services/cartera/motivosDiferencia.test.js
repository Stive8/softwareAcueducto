const test = require('node:test');
const assert = require('node:assert/strict');
const { MOTIVOS_DIFERENCIA, getMotivoDiferencia } = require('./motivosDiferencia');

const LAS_12_CUENTAS = [
  'S0312', 'S048', 'S010', 'S034', 'R079', 'R068', 'S03351',
  'R080', 'R091', 'S0244', 'C021', 'S0162'
];

test('motivosDiferencia: S0393 ya no está documentada -- cierra tras reasignar el recibo 2137', () => {
  assert.equal(getMotivoDiferencia('S0393'), null);
});

test('motivosDiferencia: las 12 cuentas documentadas tienen texto', () => {
  for (const codigo of LAS_12_CUENTAS) {
    const motivo = getMotivoDiferencia(codigo);
    assert.ok(motivo && motivo.length > 0, `${codigo} debe tener un motivo`);
  }
  assert.equal(Object.keys(MOTIVOS_DIFERENCIA).length, LAS_12_CUENTAS.length);
});

test('motivosDiferencia: una cuenta sin diferencia documentada devuelve null', () => {
  assert.equal(getMotivoDiferencia('R068888'), null);
  assert.equal(getMotivoDiferencia('S9999'), null);
});
