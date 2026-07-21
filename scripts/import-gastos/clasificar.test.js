// scripts/import-gastos/clasificar.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarIdentificacion, esNombreValido, clasificarTipoGasto, resolverTercero, normalizarNombre,
} = require('./clasificar');

test('normalizarIdentificacion quita el DV del NIT y canonicaliza', () => {
  assert.equal(normalizarIdentificacion('900531740-2'), '900351740'); // DV quitado + canonicalizado a INGECOM mayoritario
  assert.equal(normalizarIdentificacion('93328699'), '93328699');
  assert.equal(normalizarIdentificacion('93238699'), '93328699');     // typo Vicencio → canónico
  assert.equal(normalizarIdentificacion('  80765236 '), '80765236');
});

test('normalizarIdentificacion devuelve null si no hay número usable', () => {
  assert.equal(normalizarIdentificacion(null), null);
  assert.equal(normalizarIdentificacion('__'), null);
  assert.equal(normalizarIdentificacion(''), null);
});

test('esNombreValido distingue nombres de números de factura', () => {
  assert.equal(esNombreValido('VICENCIO HERRERA'), true);
  assert.equal(esNombreValido('FEP 10632'), false);
  assert.equal(esNombreValido('1901 100207215'), false);
  assert.equal(esNombreValido('4385'), false);
});

test('clasificarTipoGasto: fontanero y cobro de cartera → Honorarios (alta)', () => {
  assert.deepEqual(clasificarTipoGasto('PAGO SERVICIO FONTANERO MES DE ENERO 2025'), { tipoGasto: 'Honorarios', confianza: 'alta' });
  assert.deepEqual(clasificarTipoGasto('SERVICIOS COBRO DE CARTERA BRAYHAN ORTEGON'), { tipoGasto: 'Honorarios', confianza: 'alta' });
});

test('clasificarTipoGasto: materiales PVC → Accesorios y Materiales (media)', () => {
  const r = clasificarTipoGasto('SEMICODO Y UNION DE 4" PVC');
  assert.equal(r.tipoGasto, 'Accesorios y Materiales');
  assert.equal(r.confianza, 'media');
});

test('clasificarTipoGasto: bono → Bonificaciones; tasa uso → Impuestos', () => {
  assert.equal(clasificarTipoGasto('BONO NAVIDEÑO').tipoGasto, 'Bonificaciones');
  assert.equal(clasificarTipoGasto('PAGO TASA USO DE AGUA CORTOLIMA').tipoGasto, 'Impuestos');
});

test('clasificarTipoGasto: concepto sin patrón → null (Sin clasificar)', () => {
  assert.equal(clasificarTipoGasto('ALGO COMPLETAMENTE INESPERADO XYZ').tipoGasto, null);
});

test('clasificarTipoGasto: ABONO no se confunde con BONO (word boundary)', () => {
  // "ABONO TALONARIO..." NO debe ser Bonificaciones; cae en Papelería por TALONARIO.
  assert.equal(clasificarTipoGasto('ABONO TALONARIO RECIBOS PAGO CUOTA').tipoGasto, 'Papelería');
});

test('clasificarTipoGasto: BONO sí matchea como palabra completa', () => {
  assert.equal(clasificarTipoGasto('BONO FIN DE AÑO').tipoGasto, 'Bonificaciones');
});

test('resolverTercero: id existente por identificación', () => {
  const terceros = [{ id: 2, numero_identificacion: '93328699', nombre_norm: 'VICENCIO HERRERA' }];
  const p = resolverTercero({ nombre: 'VICENCIO HERRERA', identificacion: '93328699' }, { terceros });
  assert.deepEqual(p, { modo: 'existente', terceroId: 2 });
});

test('resolverTercero: sin identificación pero nombre coincide → revisar_nombre', () => {
  const terceros = [{ id: 2, numero_identificacion: '93328699', nombre_norm: 'VICENCIO HERRERA' }];
  const p = resolverTercero({ nombre: 'VICENCIO HERRERA', identificacion: null }, { terceros });
  assert.equal(p.modo, 'revisar_nombre');
  assert.equal(p.terceroIdSugerido, 2);
});

test('resolverTercero: número de factura como nombre y sin id → no_informado', () => {
  const p = resolverTercero({ nombre: 'FEP 10632', identificacion: null }, { terceros: [] });
  assert.equal(p.modo, 'no_informado');
});

test('resolverTercero: identificación nueva con nombre válido → nuevo', () => {
  const p = resolverTercero({ nombre: 'DGV SUMINISTROS', identificacion: '80765236' }, { terceros: [] });
  assert.equal(p.modo, 'nuevo');
  assert.equal(p.numeroIdentificacion, '80765236');
  assert.equal(p.nombreRazonSocial, 'DGV SUMINISTROS');
});
