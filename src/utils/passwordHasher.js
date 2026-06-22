const crypto = require('crypto');

// Hash con sal aleatoria usando scrypt (incluido en Node, sin dependencias externas).
// Formato almacenado: "salt:hash" en hexadecimal.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function isHashed(stored) {
  return typeof stored === 'string' && stored.includes(':') && stored.split(':')[0].length === 32;
}

// Compatible con el usuario administrador inicial (contraseña en texto plano de la Fase 1):
// si el valor almacenado no tiene el formato "salt:hash", se compara como texto plano.
function verifyPassword(password, stored) {
  if (!isHashed(stored)) {
    return stored === password;
  }

  const [salt, hash] = stored.split(':');
  const intento = crypto.scryptSync(password, salt, 64).toString('hex');

  const hashBuffer = Buffer.from(hash, 'hex');
  const intentoBuffer = Buffer.from(intento, 'hex');
  if (hashBuffer.length !== intentoBuffer.length) return false;

  return crypto.timingSafeEqual(hashBuffer, intentoBuffer);
}

module.exports = { hashPassword, verifyPassword, isHashed };
