const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Permiso mínimo: la app solo puede ver/crear archivos que ella misma haya creado en Drive,
// nunca el Drive completo de quien se conecte.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const NOMBRE_CARPETA = 'Acueducto Admin - Soportes';

// Bloque de autenticación duplicado deliberadamente desde CloudBackupService (mismo token
// data/cloud-token.enc, mismo scope drive.file — una sola cuenta de Google conectada para todo):
// este servicio tiene responsabilidades muy distintas (gzip, poda por retención, detección de
// conflictos por secuencia no aplican aquí), así que no vale la pena forzar una clase base
// compartida solo para no repetir ~60 líneas de OAuth.
class ComprobanteCloudService {
  constructor(baseDir, electronModule = require('electron')) {
    this.tokenPath = path.join(baseDir, 'data', 'cloud-token.enc');
    this.shell = electronModule.shell;
    this.app = electronModule.app;
    this.safeStorage = electronModule.safeStorage;

    const credPath = path.join(__dirname, '..', '..', 'config', 'google-credentials.json');
    if (!fs.existsSync(credPath)) {
      throw new Error('No se encontró config/google-credentials.json (credenciales de Google Cloud)');
    }
    const credenciales = JSON.parse(fs.readFileSync(credPath, 'utf-8')).installed;
    this.clientId = credenciales.client_id;
    this.clientSecret = credenciales.client_secret;

    this.carpetaId = null; // se resuelve la primera vez que se necesita, y se cachea en memoria
  }

  estaConectado() {
    return fs.existsSync(this.tokenPath);
  }

  desconectar() {
    if (fs.existsSync(this.tokenPath)) fs.unlinkSync(this.tokenPath);
    this.carpetaId = null;
  }

  _crearOAuthClient(redirectUri) {
    return new google.auth.OAuth2(this.clientId, this.clientSecret, redirectUri);
  }

  _leerTokens() {
    const buffer = fs.readFileSync(this.tokenPath);
    const disponible = this.safeStorage && this.safeStorage.isEncryptionAvailable();
    const json = disponible ? this.safeStorage.decryptString(buffer) : buffer.toString('utf-8');
    return JSON.parse(json);
  }

  _guardarTokens(tokens) {
    const json = JSON.stringify(tokens);
    const disponible = this.safeStorage && this.safeStorage.isEncryptionAvailable();
    const contenido = disponible ? this.safeStorage.encryptString(json) : Buffer.from(json, 'utf-8');
    fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
    fs.writeFileSync(this.tokenPath, contenido);
  }

  async _obtenerClienteDrive() {
    if (!this.estaConectado()) throw new Error('No hay una cuenta de Google conectada');

    const tokens = this._leerTokens();
    const oAuth2Client = this._crearOAuthClient('http://localhost');
    oAuth2Client.setCredentials(tokens);

    oAuth2Client.on('tokens', (nuevos) => {
      this._guardarTokens({ ...tokens, ...nuevos });
    });

    return google.drive({ version: 'v3', auth: oAuth2Client });
  }

  async _asegurarCarpeta(drive) {
    if (this.carpetaId) return this.carpetaId;

    const existente = await drive.files.list({
      q: `name='${NOMBRE_CARPETA}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    if (existente.data.files.length > 0) {
      this.carpetaId = existente.data.files[0].id;
      return this.carpetaId;
    }

    const creada = await drive.files.create({
      requestBody: { name: NOMBRE_CARPETA, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id'
    });
    this.carpetaId = creada.data.id;
    return this.carpetaId;
  }

  // Sin comprimir: a diferencia de los respaldos de .db, los soportes ya son PDF/imágenes (que no
  // se benefician de gzip) y deben poder abrirse directo tal como se descargan.
  async subirSoporte(localFilePath, nombreArchivo) {
    const drive = await this._obtenerClienteDrive();
    const carpetaId = await this._asegurarCarpeta(drive);

    const respuesta = await drive.files.create({
      requestBody: { name: nombreArchivo, parents: [carpetaId] },
      media: { body: fs.createReadStream(localFilePath) },
      fields: 'id, name'
    });

    return respuesta.data;
  }

  // Descarga a un archivo temporal y lo abre con el visor por defecto del sistema operativo — el
  // soporte nunca se mantiene como archivo local permanente, solo existe en Drive.
  async descargarYAbrir(fileId, nombreArchivoOriginal) {
    const drive = await this._obtenerClienteDrive();

    let respuesta;
    try {
      respuesta = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    } catch (err) {
      if (err.code === 404) throw new Error('El soporte ya no existe en Google Drive (puede haber sido borrado manualmente).');
      throw err;
    }

    const extension = path.extname(nombreArchivoOriginal || '') || '';
    const tempPath = path.join(this.app.getPath('temp'), `soporte_${Date.now()}${extension}`);

    await new Promise((resolve, reject) => {
      respuesta.data
        .pipe(fs.createWriteStream(tempPath))
        .on('finish', resolve)
        .on('error', reject);
    });

    await this.shell.openPath(tempPath);
    return tempPath;
  }
}

module.exports = ComprobanteCloudService;
