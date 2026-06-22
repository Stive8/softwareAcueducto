const UsuarioRepository = require('../repositories/UsuarioRepository');
const { hashPassword, verifyPassword, isHashed } = require('../utils/passwordHasher');

class AuthService {
  constructor(dbService) {
    this.repository = new UsuarioRepository(dbService);
  }

  login(usuario, password) {
    if (!usuario || !usuario.trim() || !password) {
      throw new Error('Usuario y contraseña son obligatorios');
    }

    const user = this.repository.findByUsuario(usuario.trim());
    if (!user || !user.activo) {
      throw new Error('Usuario o contraseña incorrectos');
    }

    if (!verifyPassword(password, user.password)) {
      throw new Error('Usuario o contraseña incorrectos');
    }

    // Migración silenciosa: la contraseña inicial de la Fase 1 estaba en texto plano.
    // Al validarse correctamente una vez, se cifra de inmediato para no dejarla expuesta.
    if (!isHashed(user.password)) {
      this.repository.updatePassword(user.id, hashPassword(password));
    }

    this.repository.updateUltimoAcceso(user.id);

    return { id: user.id, usuario: user.usuario, nombreCompleto: user.nombre_completo, rol: user.rol };
  }

  cambiarPassword(usuarioId, passwordActual, passwordNueva) {
    if (!passwordNueva || passwordNueva.length < 4) {
      throw new Error('La nueva contraseña debe tener al menos 4 caracteres');
    }

    const user = this.repository.findById(usuarioId);
    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    if (!verifyPassword(passwordActual, user.password)) {
      throw new Error('La contraseña actual es incorrecta');
    }

    this.repository.updatePassword(usuarioId, hashPassword(passwordNueva));
  }
}

module.exports = AuthService;
