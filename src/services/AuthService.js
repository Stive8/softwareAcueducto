const UsuarioRepository = require('../repositories/UsuarioRepository');
const { hashPassword, verifyPassword, isHashed } = require('../utils/passwordHasher');

const ROLES_VALIDOS = ['Administrador', 'Usuario', 'Consulta'];

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

  // --- Gestión de usuarios (solo Administrador, validado en la capa de permisos de main.js) ---

  getAll() {
    return this.repository.findAll();
  }

  crearUsuario({ usuario, password, nombreCompleto, rol }) {
    if (!usuario || !usuario.trim()) throw new Error('El nombre de usuario es obligatorio');
    if (!password || password.length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres');
    if (!nombreCompleto || !nombreCompleto.trim()) throw new Error('El nombre completo es obligatorio');
    if (!ROLES_VALIDOS.includes(rol)) throw new Error('Rol inválido');
    if (this.repository.findByUsuario(usuario.trim())) throw new Error(`Ya existe un usuario con el nombre "${usuario}"`);

    return this.repository.create({
      usuario: usuario.trim(),
      passwordHasheado: hashPassword(password),
      nombreCompleto: nombreCompleto.trim(),
      rol
    });
  }

  toggleActivoUsuario(id, activo, usuarioQueEjecutaId) {
    if (id === usuarioQueEjecutaId) throw new Error('No puede desactivar su propio usuario');
    const user = this.repository.findById(id);
    if (!user) throw new Error('Usuario no encontrado');
    this.repository.toggleActivo(id, activo);
  }

  // Restablece la contraseña de OTRO usuario sin necesitar la contraseña actual (a diferencia
  // de cambiarPassword, que es el flujo de "cambiar mi propia contraseña").
  resetearPassword(id, passwordNueva) {
    if (!passwordNueva || passwordNueva.length < 4) throw new Error('La nueva contraseña debe tener al menos 4 caracteres');
    const user = this.repository.findById(id);
    if (!user) throw new Error('Usuario no encontrado');
    this.repository.updatePassword(id, hashPassword(passwordNueva));
  }
}

module.exports = AuthService;
