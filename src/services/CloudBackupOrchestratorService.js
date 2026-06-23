const fs = require('fs');
const path = require('path');
const os = require('os');
const CloudBackupService = require('./CloudBackupService');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

// Conecta el motor de Drive (CloudBackupService, que no sabe nada de esta app) con el
// BackupService existente (que genera el .db a subir) y con dos fuentes de configuración
// DELIBERADAMENTE separadas:
//   - La política de retención vive en la base de datos compartida (configuracion): es una
//     decisión de la asociación, igual para cualquier equipo.
//   - El nombre de este equipo, la secuencia local y la fecha del último respaldo exitoso viven
//     en un archivo JSON local (junto al token de Google, fuera del .db): son datos PROPIOS de
//     esta instalación. Si vivieran dentro del .db, un "Actualizar desde la nube" los
//     resetearía sin sentido (porque ese .db viene de OTRO momento/equipo), que es justo el bug
//     que esto corrige.
class CloudBackupOrchestratorService {
  constructor(dbService, baseDir) {
    this.cloud = new CloudBackupService(baseDir);
    this.configRepo = new ConfiguracionRepository(dbService);
    this.estadoLocalPath = path.join(baseDir, 'data', 'cloud-backup-estado.json');
  }

  _leerEstadoLocal() {
    if (!fs.existsSync(this.estadoLocalPath)) return { nombreEquipo: '', secuenciaLocal: 0, ultimaFechaExitosa: null };
    try {
      return JSON.parse(fs.readFileSync(this.estadoLocalPath, 'utf-8'));
    } catch {
      return { nombreEquipo: '', secuenciaLocal: 0, ultimaFechaExitosa: null };
    }
  }

  _guardarEstadoLocal(parcial) {
    const actual = this._leerEstadoLocal();
    const nuevo = { ...actual, ...parcial };
    fs.mkdirSync(path.dirname(this.estadoLocalPath), { recursive: true });
    fs.writeFileSync(this.estadoLocalPath, JSON.stringify(nuevo, null, 2));
    return nuevo;
  }

  estaConectado() {
    return this.cloud.estaConectado();
  }

  conectar() {
    return this.cloud.conectar();
  }

  desconectar() {
    this.cloud.desconectar();
  }

  configurarNombreEquipo(nombreEquipo) {
    this._guardarEstadoLocal({ nombreEquipo: (nombreEquipo || '').trim() });
  }

  getEstado() {
    const config = this.configRepo.getAll();
    const local = this._leerEstadoLocal();
    return {
      conectado: this.cloud.estaConectado(),
      nombreEquipo: local.nombreEquipo || '',
      diasRetencion: parseInt(config.respaldo_nube_dias_retencion || '30', 10),
      ultimaFechaExitosa: local.ultimaFechaExitosa || null,
      secuenciaLocal: parseInt(local.secuenciaLocal || 0, 10)
    };
  }

  getRespaldosDisponibles() {
    return this.cloud.listarRespaldos();
  }

  // Sube un respaldo nuevo: por defecto avisa (sin subir) si detecta que otro equipo subió algo
  // más reciente desde la última vez que éste supo del estado de la nube ("respaldo cruzado");
  // con forzar=true sube de todas formas (lo usa quien llama, después de que el usuario decide
  // continuar a pesar de la advertencia).
  async respaldarAhora(backupService, { forzar = false } = {}) {
    const estado = this.getEstado();

    if (!forzar) {
      const { hayConflicto, ultimo } = await this.cloud.detectarConflicto(estado.secuenciaLocal);
      if (hayConflicto) {
        return {
          conflicto: true,
          mensaje: `Hay un respaldo en la nube subido desde "${ultimo.properties?.nombreEquipo || 'otro equipo'}" que este equipo no conoce. Si continúas, tu respaldo se subirá igual, pero conviene revisar primero ese otro respaldo.`
        };
      }
    }

    // La nueva secuencia se guarda ANTES de generar el archivo a subir, para que lo que viaja a
    // Drive como metadato (properties.secuencia) y lo que queda registrado localmente coincidan
    // siempre — si se hiciera al revés, un "Actualizar desde la nube" posterior de este mismo
    // respaldo dejaría una secuencia local más vieja que la del propio archivo que se subió.
    const nuevaSecuencia = estado.secuenciaLocal + 1;
    const nombreEquipo = estado.nombreEquipo || os.hostname();
    this._guardarEstadoLocal({ secuenciaLocal: nuevaSecuencia });

    const tempPath = path.join(os.tmpdir(), `acueducto_respaldo_${Date.now()}.db`);
    await backupService.crearBackup(tempPath);

    try {
      const subido = await this.cloud.subirRespaldo(tempPath, { nombreEquipo, secuencia: nuevaSecuencia });

      this._guardarEstadoLocal({ ultimaFechaExitosa: new Date().toISOString() });
      await this.cloud.podarRespaldosAntiguos({ diasConservarTodos: estado.diasRetencion });

      return { conflicto: false, subido };
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }

  // Descarga el respaldo más reciente a un archivo temporal. Quien llama (main.js) decide cómo
  // confirmar y aplicar el reemplazo (mismo patrón que ya usa backup:restaurar).
  async descargarUltimoRespaldo() {
    const respaldos = await this.cloud.listarRespaldos();
    if (respaldos.length === 0) throw new Error('No hay respaldos disponibles en la nube');

    const ultimo = respaldos[0];
    const tempPath = path.join(os.tmpdir(), `acueducto_descarga_${Date.now()}.db`);
    await this.cloud.descargarRespaldo(ultimo.id, tempPath);

    return { archivo: ultimo, rutaLocal: tempPath };
  }
}

module.exports = CloudBackupOrchestratorService;
