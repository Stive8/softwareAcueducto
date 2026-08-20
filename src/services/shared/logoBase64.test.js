const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { obtenerLogoBase64 } = require('./logoBase64');

test('obtenerLogoBase64: devuelve null si logoPath está vacío', () => {
  assert.equal(obtenerLogoBase64('/cualquier/dir', ''), null);
  assert.equal(obtenerLogoBase64('/cualquier/dir', null), null);
  assert.equal(obtenerLogoBase64('/cualquier/dir', undefined), null);
});

test('obtenerLogoBase64: devuelve null si el archivo no existe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-test-'));
  try {
    assert.equal(obtenerLogoBase64(dir, 'no-existe.png'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('obtenerLogoBase64: codifica un PNG como data URI image/png', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-test-'));
  try {
    const archivo = path.join(dir, 'logo.png');
    fs.writeFileSync(archivo, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const resultado = obtenerLogoBase64(dir, 'logo.png');
    assert.match(resultado, /^data:image\/png;base64,/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('obtenerLogoBase64: codifica un JPG como data URI image/jpeg', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-test-'));
  try {
    const archivo = path.join(dir, 'logo.jpg');
    fs.writeFileSync(archivo, Buffer.from([0xff, 0xd8, 0xff]));

    const resultado = obtenerLogoBase64(dir, 'logo.jpg');
    assert.match(resultado, /^data:image\/jpeg;base64,/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
