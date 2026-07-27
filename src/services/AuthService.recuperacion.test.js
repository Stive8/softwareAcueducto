// src/services/AuthService.recuperacion.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearDbTemporal, cerrarDbTemporal } = require('../testUtils/dbTemporal');
const AuthService = require('./AuthService');

test('generarCredencialRecuperacionSiHaceFalta() genera y guarda una contraseña la primera vez', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AuthService(ctx.dbService);

    const password = service.generarCredencialRecuperacionSiHaceFalta();

    assert.ok(password, 'debe devolver la contraseña generada');
    assert.ok(password.length >= 12, 'la contraseña generada debe ser suficientemente larga');
    assert.doesNotThrow(() => service.login('recuperacion', password));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('generarCredencialRecuperacionSiHaceFalta() no genera una segunda vez', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AuthService(ctx.dbService);

    const primera = service.generarCredencialRecuperacionSiHaceFalta();
    const segunda = service.generarCredencialRecuperacionSiHaceFalta();

    assert.ok(primera);
    assert.equal(segunda, null);
    // La primera contraseña generada sigue siendo válida (no se regeneró por debajo).
    assert.doesNotThrow(() => service.login('recuperacion', primera));
  } finally {
    cerrarDbTemporal(ctx);
  }
});

test('login() rechaza el marcador __PENDIENTE_GENERAR__ como si fuera la contraseña', () => {
  const ctx = crearDbTemporal();
  try {
    const service = new AuthService(ctx.dbService);
    // Sin llamar a generarCredencialRecuperacionSiHaceFalta(): la cuenta sigue con el marcador
    // sembrado por la migración 035.
    assert.throws(
      () => service.login('recuperacion', '__PENDIENTE_GENERAR__'),
      /Usuario o contraseña incorrectos/
    );
  } finally {
    cerrarDbTemporal(ctx);
  }
});
