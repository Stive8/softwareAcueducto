const test = require('node:test');
const assert = require('node:assert/strict');
const { PLANTILLAS } = require('./plantillas');

function datosFixture(overrides = {}) {
  return {
    numero_recibo: 1773,
    fecha_recibo: '2026-08-20',
    metodo_pago: 'Efectivo',
    cuenta_codigo: 'A001',
    cuenta_direccion: 'Vereda El Progreso',
    propietario_nombre: 'Juan Pérez',
    propietario_identificacion: '123456789',
    estado: 'Activo',
    motivo_anulacion: null,
    observaciones: '',
    total: 30000,
    detalles: [
      { concepto: 'CUOTA DE SOSTENIMIENTO DE ENERO A DICIEMBRE 2024', periodo_desde: '2024-01', periodo_hasta: '2024-12', valor: 30000 }
    ],
    config: {
      nombre_asociacion: 'Acueducto Veredal El Progreso',
      nit: '900123456-1',
      direccion: 'Vereda El Progreso, Km 3',
      telefono: '3001234567',
      email: 'acueducto@example.com',
      logoBase64: null
    },
    ...overrides
  };
}

test('carta: sin logoBase64, no inserta ningún contenedor de logo', () => {
  const html = PLANTILLAS.carta(datosFixture());
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Recibo No\. 1773/);
  assert.match(html, /Acueducto Veredal El Progreso/);
});

test('carta: con logoBase64, inserta la imagen del logo', () => {
  const html = PLANTILLAS.carta(datosFixture({ config: { ...datosFixture().config, logoBase64: 'data:image/png;base64,ABC' } }));
  assert.match(html, /<img[^>]+src="data:image\/png;base64,ABC"/);
});

test('carta: escapa HTML en campos de texto libre (observaciones, concepto)', () => {
  const html = PLANTILLAS.carta(datosFixture({
    observaciones: '<script>alert(1)</script>',
    detalles: [{ concepto: '<b>malicioso</b>', periodo_desde: null, periodo_hasta: null, valor: 5000 }]
  }));
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>malicioso<\/b>/);
});

test('termico_80mm: sin logoBase64, no inserta ningún <img>', () => {
  const html = PLANTILLAS.termico_80mm(datosFixture());
  assert.doesNotMatch(html, /<img/);
});

test('termico_80mm: con logoBase64, inserta la imagen del logo', () => {
  const html = PLANTILLAS.termico_80mm(datosFixture({ config: { ...datosFixture().config, logoBase64: 'data:image/png;base64,ABC' } }));
  assert.match(html, /<img[^>]+src="data:image\/png;base64,ABC"/);
});

test('termico_80mm: incluye número de recibo, total y concepto largo completo', () => {
  const html = PLANTILLAS.termico_80mm(datosFixture());
  assert.match(html, /1773/);
  assert.match(html, /30\.000|30000/);
  assert.match(html, /CUOTA DE SOSTENIMIENTO DE ENERO A DICIEMBRE 2024/);
});

test('termico_80mm: usa @page de 80mm de ancho', () => {
  const html = PLANTILLAS.termico_80mm(datosFixture());
  assert.match(html, /@page\s*\{[^}]*80mm/);
});

test('termico_80mm: escapa HTML en campos de texto libre', () => {
  const html = PLANTILLAS.termico_80mm(datosFixture({ observaciones: '<script>alert(1)</script>' }));
  assert.doesNotMatch(html, /<script>/);
});

test('carta: escapa HTML en numero_recibo (posible valor corregido vía recibo_correcciones)', () => {
  const html = PLANTILLAS.carta(datosFixture({ numero_recibo: '<script>alert(1)</script>' }));
  assert.doesNotMatch(html, /<script>/);
});

test('termico_80mm: escapa HTML en numero_recibo (posible valor corregido vía recibo_correcciones)', () => {
  const html = PLANTILLAS.termico_80mm(datosFixture({ numero_recibo: '<script>alert(1)</script>' }));
  assert.doesNotMatch(html, /<script>/);
});
