const fs = require('fs');
const path = require('path');

const INTERVALO_HORAS = 24;
const MAXIMO_BACKUPS = 7;

class BackupService {
  constructor(dbService) {
    this.dbService = dbService;
    // Carpeta separada de data/acueducto.db: si el usuario nunca usa el botón manual, esta es
    // la única red de seguridad real que tiene, así que no debe vivir junto al archivo que protege.
    this.carpetaAutomatica = path.join(path.dirname(path.dirname(dbService.getDbPath())), 'backups_automaticos');
  }

  async crearBackup(destinoPath) {
    await this.dbService.backup(destinoPath);
  }

  listarBackupsAutomaticos() {
    if (!fs.existsSync(this.carpetaAutomatica)) return [];
    return fs.readdirSync(this.carpetaAutomatica)
      .filter(f => f.startsWith('auto_') && f.endsWith('.db'))
      .map(f => ({ archivo: f, ruta: path.join(this.carpetaAutomatica, f), mtime: fs.statSync(path.join(this.carpetaAutomatica, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
  }

  getEstadoAutomatico() {
    const backups = this.listarBackupsAutomaticos();
    return {
      ultimoBackup: backups[0] ? backups[0].mtime.toISOString().slice(0, 19).replace('T', ' ') : null,
      cantidad: backups.length,
      maximo: MAXIMO_BACKUPS
    };
  }

  // Se llama una vez al iniciar la app (ver main.js): si ha pasado más de INTERVALO_HORAS desde
  // el último respaldo automático, crea uno nuevo y elimina los más viejos por encima del límite.
  // Nunca interrumpe el arranque de la app si falla (solo se registra en consola).
  async ejecutarSiCorresponde() {
    try {
      const backups = this.listarBackupsAutomaticos();
      const ultimo = backups[0];
      const horasDesdeUltimo = ultimo ? (Date.now() - ultimo.mtime.getTime()) / 36e5 : Infinity;

      if (horasDesdeUltimo < INTERVALO_HORAS) return;

      if (!fs.existsSync(this.carpetaAutomatica)) {
        fs.mkdirSync(this.carpetaAutomatica, { recursive: true });
      }

      const marcaTiempo = new Date().toISOString().replace(/[:.]/g, '-');
      const destino = path.join(this.carpetaAutomatica, `auto_${marcaTiempo}.db`);
      await this.crearBackup(destino);

      const actualizados = this.listarBackupsAutomaticos();
      actualizados.slice(MAXIMO_BACKUPS).forEach(b => fs.unlinkSync(b.ruta));
    } catch (error) {
      console.error('No se pudo crear el respaldo automático:', error.message);
    }
  }

  // Verifica que el archivo seleccionado para restaurar sea realmente una base de datos
  // SQLite (revisa la cabecera estándar) antes de reemplazar los datos actuales.
  validarArchivoRestauracion(origenPath) {
    if (!origenPath || !fs.existsSync(origenPath)) {
      throw new Error('El archivo seleccionado no existe');
    }

    const fd = fs.openSync(origenPath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    if (buffer.toString('utf8', 0, 16) !== 'SQLite format 3\0') {
      throw new Error('El archivo seleccionado no es una base de datos SQLite válida');
    }
  }
}

module.exports = BackupService;
