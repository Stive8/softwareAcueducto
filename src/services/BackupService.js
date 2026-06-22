const fs = require('fs');

class BackupService {
  constructor(dbService) {
    this.dbService = dbService;
  }

  async crearBackup(destinoPath) {
    await this.dbService.backup(destinoPath);
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
