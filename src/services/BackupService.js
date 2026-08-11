const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const INTERVALO_HORAS = 24;
const MAXIMO_BACKUPS = 7;
const TABLAS_ESPERADAS = ['cuentas', 'recibos', 'cartera_movimientos', 'migrations'];
// Por debajo de esto, casi seguro es una base vacía o de pruebas, no un respaldo real de la
// asociación (que hoy tiene ~318 cuentas) -- pero suficientemente bajo para no rechazar un
// respaldo legítimo de una instalación más chica.
const MINIMO_CUENTAS_ESPERADO = 10;

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

  // Ruta donde se guardará la copia de seguridad del .db actual justo antes de restaurar.
  // Se calcula por separado de crearBackup() para poder mostrársela al usuario en el diálogo
  // de confirmación ANTES de tocar nada.
  rutaBackupPreRestauracion() {
    if (!fs.existsSync(this.carpetaAutomatica)) {
      fs.mkdirSync(this.carpetaAutomatica, { recursive: true });
    }
    const marcaTiempo = new Date().toISOString().replace(/[:.]/g, '-');
    // Prefijo distinto de "auto_" a propósito: listarBackupsAutomaticos() solo mira ese
    // prefijo, así que estas copias no compiten por los MAXIMO_BACKUPS cupos del automático
    // ni se borran con su rotación.
    return path.join(this.carpetaAutomatica, `prerestore_${marcaTiempo}.db`);
  }

  // Verifica que el archivo seleccionado para restaurar sea realmente una base de datos de
  // esta aplicación, no solo un SQLite cualquiera: cabecera válida, tablas mínimas esperadas,
  // una cantidad razonable de cuentas, y una versión de esquema que esta instalación reconozca.
  // Lanza con un mensaje claro ante cualquier problema; si el archivo es válido pero de una
  // versión ANTERIOR a la instalada, no lanza -- devuelve qué migraciones quedarían pendientes
  // para que quien llama pueda avisarlo antes de restaurar.
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

    let db;
    try {
      db = new Database(origenPath, { readonly: true });
    } catch (error) {
      throw new Error('El archivo seleccionado no se pudo abrir como base de datos SQLite');
    }

    try {
      const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
      const faltantes = TABLAS_ESPERADAS.filter(t => !tablas.includes(t));
      if (faltantes.length > 0) {
        throw new Error(`El archivo seleccionado no tiene la estructura de esta aplicación (faltan tablas: ${faltantes.join(', ')}). Verifique que sea el respaldo correcto.`);
      }

      const { total } = db.prepare('SELECT COUNT(*) as total FROM cuentas').get();
      if (total < MINIMO_CUENTAS_ESPERADO) {
        throw new Error(`El archivo seleccionado solo tiene ${total} cuenta(s) registradas -- muy pocas para ser un respaldo real de la asociación. Verifique que sea el archivo correcto.`);
      }

      const migracionesArchivo = db.prepare('SELECT name FROM migrations').all().map(m => m.name);
      const migracionesApp = fs.readdirSync(this.dbService.migrationsDir).filter(f => f.endsWith('.sql')).sort();

      const masNuevasQueLaApp = migracionesArchivo.filter(m => !migracionesApp.includes(m));
      if (masNuevasQueLaApp.length > 0) {
        throw new Error(`Este archivo fue creado con una versión más nueva de la aplicación: trae ${masNuevasQueLaApp.length} actualización(es) de base de datos que esta instalación no reconoce (${masNuevasQueLaApp.slice(0, 3).join(', ')}${masNuevasQueLaApp.length > 3 ? ', ...' : ''}). Actualice la aplicación antes de restaurar este archivo.`);
      }

      const migracionesPendientes = migracionesApp.filter(m => !migracionesArchivo.includes(m));
      return { totalCuentas: total, migracionesPendientes };
    } finally {
      db.close();
    }
  }
}

module.exports = BackupService;
