// Genera el ícono de la aplicación (assets/icon.png e assets/icon.ico) sin dependencias
// externas: construye PNGs válidos a mano (usando zlib, ya incluido en Node) y los empaqueta
// en un .ico multi-resolución. Diseño: cuadrado azul institucional con una gota blanca
// (símbolo de agua/acueducto), legible incluso en tamaños pequeños de la barra de tareas.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const AZUL = [30, 64, 175]; // #1e40af
const BLANCO = [255, 255, 255];

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// dibuja un cuadrado azul con bordes redondeados y una gota blanca centrada
function dibujarPixeles(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radioEsquina = size * 0.18;

  // gota: punta arriba, bulbo circular abajo
  const bulboY = size * 0.62;
  const bulboRadio = size * 0.26;
  const puntaY = size * 0.20;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // recorte de esquinas redondeadas del fondo
      const dentroEsquina = (() => {
        const ex = x < radioEsquina ? radioEsquina : (x > size - radioEsquina ? size - radioEsquina : null);
        const ey = y < radioEsquina ? radioEsquina : (y > size - radioEsquina ? size - radioEsquina : null);
        if (ex === null || ey === null) return true;
        const dx = x - ex;
        const dy = y - ey;
        return dx * dx + dy * dy <= radioEsquina * radioEsquina;
      })();

      let color = dentroEsquina ? AZUL : null;

      if (dentroEsquina) {
        let esGota = false;
        if (y >= bulboY) {
          const dx = x - cx;
          const dy = y - bulboY;
          if (dx * dx + dy * dy <= bulboRadio * bulboRadio) esGota = true;
        } else if (y >= puntaY) {
          const mitadAncho = bulboRadio * (y - puntaY) / (bulboY - puntaY);
          if (Math.abs(x - cx) <= mitadAncho) esGota = true;
        }
        if (esGota) color = BLANCO;
      }

      if (color) {
        pixels[idx] = color[0];
        pixels[idx + 1] = color[1];
        pixels[idx + 2] = color[2];
        pixels[idx + 3] = 255;
      } else {
        pixels[idx + 3] = 0; // transparente fuera del cuadrado redondeado
      }
    }
  }
  return pixels;
}

function generarPNG(size) {
  const pixels = dibujarPixeles(size);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // profundidad de bits
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compresión
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // sin interlace

  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(Buffer.from([0])); // filtro "none" por fila
    rows.push(pixels.subarray(y * size * 4, (y + 1) * size * 4));
  }
  const raw = Buffer.concat(rows);
  const idat = zlib.deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function generarICO(pngsPorTamano) {
  const tamanos = Object.keys(pngsPorTamano).map(Number).sort((a, b) => a - b);
  const count = tamanos.length;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = [];
  const datas = [];
  let offset = 6 + count * 16;

  for (const size of tamanos) {
    const png = pngsPorTamano[size];
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    datas.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...datas]);
}

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

const tamanosIco = [16, 32, 48, 64, 128, 256];
const pngsPorTamano = {};
for (const size of tamanosIco) {
  pngsPorTamano[size] = generarPNG(size);
}

fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngsPorTamano[256]);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), generarICO(pngsPorTamano));

console.log('Generado: assets/icon.png (256x256) y assets/icon.ico (16,32,48,64,128,256)');
