const crypto = require('crypto');
const UsuarioRepository = require('../repositories/UsuarioRepository');
const { hashPassword, verifyPassword, isHashed } = require('../utils/passwordHasher');

const ROLES_VALIDOS = ['Administrador', 'Usuario', 'Consulta'];

// Marcador de la contraseña de la cuenta 'recuperacion' antes de que
// generarCredencialRecuperacionSiHaceFalta() la reemplace por una generada al azar (ver
// migración 035_admin_recuperacion.sql, que siembra la fila con este mismo valor literal).
const PASSWORD_PENDIENTE_GENERAR = '__PENDIENTE_GENERAR__';

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

    // La cuenta de recuperación todavía no tiene una contraseña real generada (ver
    // generarCredencialRecuperacionSiHaceFalta) — se rechaza con el mismo mensaje genérico,
    // para no revelar que la cuenta existe ni que el marcador es tratable como valor especial.
    if (user.es_recuperacion && user.password === PASSWORD_PENDIENTE_GENERAR) {
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

  // Genera y guarda la contraseña real de la cuenta de recuperación la primera vez que se llama
  // tras la migración 035 (mientras siga con el marcador PASSWORD_PENDIENTE_GENERAR). Se llama
  // una única vez al arrancar la app (ver main.js) y devuelve la contraseña en texto plano SOLO
  // esa vez, para mostrarla al usuario; llamadas posteriores devuelven null porque ya no hay
  // nada pendiente.
  generarCredencialRecuperacionSiHaceFalta() {
    const cuenta = this.repository.findByUsuario('recuperacion');
    if (!cuenta || cuenta.password !== PASSWORD_PENDIENTE_GENERAR) {
      return null;
    }

    const passwordGenerada = crypto.randomBytes(12).toString('base64url');
    this.repository.updatePassword(cuenta.id, hashPassword(passwordGenerada));
    return passwordGenerada;
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
