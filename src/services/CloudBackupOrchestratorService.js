const fs = require('fs');
const path = require('path');
const os = require('os');
const CloudBackupService = require('./CloudBackupService');
const ConfiguracionRepository = require('../repositories/ConfiguracionRepository');

// Conecta el motor de Drive (CloudBackupService, que no sabe nada de esta app) con la
// configuración local (nombre del equipo, secuencia, retención) y el BackupService existente
// (que ya sabe generar un .db consistente desde la conexión activa).
class CloudBackupOrchestratorService {
  constructor(dbService, baseDir) {
    this.cloud = new CloudBackupService(baseDir);
    this.configRepo = new ConfiguracionRepository(dbService);
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

  getEstado() {
    const config = this.configRepo.getAll();
    return {
      conectado: this.cloud.estaConectado(),
      nombreEquipo: config.respaldo_nube_nombre_equipo || '',
      diasRetencion: parseInt(config.respaldo_nube_dias_retencion || '30', 10),
      ultimaFechaExitosa: config.respaldo_nube_ultima_fecha_exitosa || null,
      secuenciaLocal: parseInt(config.respaldo_nube_secuencia_local || '0', 10)
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

    const tempPath = path.join(os.tmpdir(), `acueducto_respaldo_${Date.now()}.db`);
    await backupService.crearBackup(tempPath);

    try {
      const nuevaSecuencia = estado.secuenciaLocal + 1;
      const subido = await this.cloud.subirRespaldo(tempPath, {
        nombreEquipo: estado.nombreEquipo || os.hostname(),
        secuencia: nuevaSecuencia
      });

      this.configRepo.actualizar('respaldo_nube_secuencia_local', nuevaSecuencia);
      this.configRepo.actualizar('respaldo_nube_ultima_fecha_exitosa', new Date().toISOString());

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
