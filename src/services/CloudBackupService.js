const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const { google } = require('googleapis');

// Permiso mínimo: la app solo puede ver/crear archivos que ella misma haya creado en Drive,
// nunca el Drive completo de quien se conecte. Así no necesita verificación pública de Google
// y limita el riesgo si las credenciales se filtraran.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const NOMBRE_CARPETA = 'Acueducto Admin - Respaldos';

class CloudBackupService {
  // baseDir: la misma carpeta donde vive data/acueducto.db (ver DatabaseService), para guardar
  // ahí también el token de la cuenta de Google conectada.
  constructor(baseDir, electronModule = require('electron')) {
    this.tokenPath = path.join(baseDir, 'data', 'cloud-token.enc');
    this.shell = electronModule.shell;
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

  _guardarTokens(tokens) {
    const json = JSON.stringify(tokens);
    const disponible = this.safeStorage && this.safeStorage.isEncryptionAvailable();
    const contenido = disponible ? this.safeStorage.encryptString(json) : Buffer.from(json, 'utf-8');
    fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true });
    fs.writeFileSync(this.tokenPath, contenido);
  }

  _leerTokens() {
    const buffer = fs.readFileSync(this.tokenPath);
    const disponible = this.safeStorage && this.safeStorage.isEncryptionAvailable();
    const json = disponible ? this.safeStorage.decryptString(buffer) : buffer.toString('utf-8');
    return JSON.parse(json);
  }

  // Flujo de autorización para apps de escritorio ("loopback"): se abre el navegador del sistema
  // en la pantalla de consentimiento de Google, y se levanta un servidor HTTP temporal en
  // localhost (puerto libre, elegido por el sistema operativo) solo para recibir la redirección
  // con el código de autorización cuando el usuario acepta. El servidor se cierra apenas llega.
  // Página breve que se muestra en el navegador al volver de Google (no es parte de la app en
  // sí, solo confirma visualmente que ya se puede cerrar esa pestaña).
  _paginaRespuesta(titulo, mensaje, exito) {
    const color = exito ? '#16a34a' : '#dc2626';
    const icono = exito ? '✓' : '✕';
    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>${titulo}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; background: #f1f5f9; display: flex;
         align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .tarjeta { background: #fff; border-radius: 12px; padding: 40px; text-align: center;
             box-shadow: 0 2px 12px rgba(0,0,0,0.1); max-width: 420px; }
  .icono { width: 56px; height: 56px; border-radius: 50%; background: ${color}; color: #fff;
           font-size: 28px; line-height: 56px; margin: 0 auto 16px; }
  h1 { font-size: 18px; color: #1e293b; margin: 0 0 8px; }
  p { font-size: 14px; color: #64748b; margin: 0; }
</style></head>
<body><div class="tarjeta">
  <div class="icono">${icono}</div>
  <h1>${titulo}</h1>
  <p>${mensaje}</p>
</div></body></html>`;
  }

  _responderHtml(res, titulo, mensaje, exito) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(this._paginaRespuesta(titulo, mensaje, exito));
  }

  conectar() {
    return new Promise((resolve, reject) => {
      // Se captura una sola vez, al empezar a escuchar; server.address() devuelve null después
      // de server.close(), así que no se puede volver a leer dentro del handler de la petición.
      let redirectUri;

      // Algunos navegadores (prefetch, extensiones, antivirus que "revisan" enlaces) pueden
      // mandar más de una petición a esta URL con el mismo código. Un código de autorización de
      // Google solo se puede usar una vez, así que cualquier petición repetida se ignora aquí en
      // vez de intentar canjearlo de nuevo (eso es lo que produce el error "invalid_grant").
      let yaProcesado = false;

      const server = http.createServer((req, res) => {
        (async () => {
          try {
            const url = new URL(req.url, redirectUri);
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');

            if (yaProcesado) {
              this._responderHtml(res, 'Ya procesado', 'Esta autorización ya se completó. Puedes cerrar esta ventana.', true);
              return;
            }

            if (error) {
              yaProcesado = true;
              this._responderHtml(res, 'Autorización cancelada', 'Puedes cerrar esta ventana y volver a la aplicación.', false);
              server.close();
              reject(new Error('Se canceló la autorización en Google'));
              return;
            }
            if (!code) {
              this._responderHtml(res, 'Solicitud inválida', 'Vuelve a intentarlo desde la aplicación.', false);
              return;
            }

            yaProcesado = true;
            this._responderHtml(res, 'Cuenta de Google conectada', 'Ya puedes cerrar esta ventana y volver a la aplicación.', true);
            server.close();

            const oAuth2Client = this._crearOAuthClient(redirectUri);
            const { tokens } = await oAuth2Client.getToken(code);
            this._guardarTokens(tokens);
            resolve();
          } catch (err) {
            server.close();
            reject(err);
          }
        })();
      });

      server.listen(0, () => {
        const { port } = server.address();
        redirectUri = `http://localhost:${port}`;
        const oAuth2Client = this._crearOAuthClient(redirectUri);
        const authUrl = oAuth2Client.generateAuthUrl({
          access_type: 'offline', // pide refresh_token, para no tener que reautorizar cada vez
          prompt: 'consent',
          scope: SCOPES
        });
        this.shell.openExternal(authUrl);
      });
    });
  }

  async _obtenerClienteDrive() {
    if (!this.estaConectado()) throw new Error('No hay una cuenta de Google conectada');

    const tokens = this._leerTokens();
    const oAuth2Client = this._crearOAuthClient('http://localhost');
    oAuth2Client.setCredentials(tokens);

    // Google solo envía refresh_token la primera vez que se autoriza; si se omite en una
    // renovación posterior, hay que conservar el que ya teníamos guardado.
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

  _comprimir(origen, destino) {
    return new Promise((resolve, reject) => {
      fs.createReadStream(origen)
        .pipe(zlib.createGzip())
        .pipe(fs.createWriteStream(destino))
        .on('finish', resolve)
        .on('error', reject);
    });
  }

  _descomprimir(origen, destino) {
    return new Promise((resolve, reject) => {
      fs.createReadStream(origen)
        .pipe(zlib.createGunzip())
        .pipe(fs.createWriteStream(destino))
        .on('finish', resolve)
        .on('error', reject);
    });
  }

  // Sube un respaldo (comprime antes de subir). metadata.nombreEquipo y metadata.secuencia se
  // guardan como propiedades del archivo en Drive, para poder detectar después conflictos de
  // "subir/restaurar algo más viejo encima de algo más nuevo" sin tener que descargar el archivo.
  async subirRespaldo(localFilePath, metadata = {}) {
    const drive = await this._obtenerClienteDrive();
    const carpetaId = await this._asegurarCarpeta(drive);

    const comprimido = `${localFilePath}.gz`;
    await this._comprimir(localFilePath, comprimido);

    try {
      const fecha = new Date().toISOString();
      const nombreArchivo = `respaldo_${fecha.replace(/[:.]/g, '-')}.db.gz`;

      const respuesta = await drive.files.create({
        requestBody: {
          name: nombreArchivo,
          parents: [carpetaId],
          properties: {
            nombreEquipo: metadata.nombreEquipo || 'Equipo sin nombre',
            fechaRespaldo: fecha,
            secuencia: String(metadata.secuencia || 0)
          }
        },
        media: { mimeType: 'application/gzip', body: fs.createReadStream(comprimido) },
        fields: 'id, name, createdTime, properties'
      });

      return respuesta.data;
    } finally {
      fs.unlinkSync(comprimido);
    }
  }

  async listarRespaldos() {
    const drive = await this._obtenerClienteDrive();
    const carpetaId = await this._asegurarCarpeta(drive);

    const respuesta = await drive.files.list({
      q: `'${carpetaId}' in parents and trashed=false`,
      fields: 'files(id, name, createdTime, size, properties)',
      orderBy: 'createdTime desc',
      spaces: 'drive'
    });

    return respuesta.data.files;
  }

  // Descarga un respaldo y lo descomprime en destPath (la ruta final del .db, sin .gz).
  async descargarRespaldo(fileId, destPath) {
    const drive = await this._obtenerClienteDrive();
    const comprimido = `${destPath}.gz`;

    const respuesta = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    await new Promise((resolve, reject) => {
      respuesta.data
        .pipe(fs.createWriteStream(comprimido))
        .on('finish', resolve)
        .on('error', reject);
    });

    await this._descomprimir(comprimido, destPath);
    fs.unlinkSync(comprimido);
    return destPath;
  }

  // Política de retención: conserva TODOS los respaldos de los últimos `diasConservarTodos` días,
  // y de lo más viejo que eso, conserva solo uno por mes calendario (el más reciente de cada mes).
  // Es una función pura (no toca Drive) para poder probarla con fechas fabricadas sin depender de
  // que existan de verdad respaldos viejos en la cuenta de prueba.
  static decidirPoda(respaldos, { diasConservarTodos = 30, ahora = Date.now() } = {}) {
    const limiteMs = diasConservarTodos * 24 * 60 * 60 * 1000;
    const recientes = [];
    const antiguos = [];

    for (const r of respaldos) {
      const edad = ahora - new Date(r.createdTime).getTime();
      (edad <= limiteMs ? recientes : antiguos).push(r);
    }

    // `antiguos` ya viene ordenado del más nuevo al más viejo (listarRespaldos ordena así), así
    // que el primero que se vea de cada mes calendario es, por construcción, el más reciente de
    // ese mes.
    const conservarPorMes = new Map();
    for (const r of antiguos) {
      const fecha = new Date(r.createdTime);
      const clave = `${fecha.getFullYear()}-${fecha.getMonth()}`;
      if (!conservarPorMes.has(clave)) conservarPorMes.set(clave, r);
    }

    const idsConservados = new Set(Array.from(conservarPorMes.values()).map(r => r.id));
    const aBorrar = antiguos.filter(r => !idsConservados.has(r.id));
    const aConservar = [...recientes, ...antiguos.filter(r => idsConservados.has(r.id))];

    return { aConservar, aBorrar };
  }

  async podarRespaldosAntiguos(opciones = {}) {
    const respaldos = await this.listarRespaldos(); // ya ordenado del más nuevo al más viejo
    const { aBorrar, aConservar } = CloudBackupService.decidirPoda(respaldos, opciones);

    const drive = await this._obtenerClienteDrive();
    for (const archivo of aBorrar) {
      await drive.files.delete({ fileId: archivo.id });
    }
    return { borrados: aBorrar.length, conservados: aConservar.length };
  }

  // Compara la secuencia local conocida contra la del respaldo más reciente en Drive, para
  // detectar si OTRO equipo subió algo después de la última vez que este equipo supo del estado
  // de la nube (ver el flujo de "respaldos cruzados" que motivó esto). No decide nada por sí
  // mismo: solo informa, para que quien llame decida si avisa al usuario antes de subir/restaurar.
  async detectarConflicto(secuenciaLocalConocida = 0) {
    const respaldos = await this.listarRespaldos();
    const ultimo = respaldos[0] || null;
    if (!ultimo) return { hayConflicto: false, ultimo: null };

    const secuenciaRemota = Number(ultimo.properties?.secuencia || 0);
    return {
      hayConflicto: secuenciaRemota > Number(secuenciaLocalConocida),
      ultimo
    };
  }
}

module.exports = CloudBackupService;
