const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const BackupService = require('./BackupService');

// dbService falso: BackupService solo necesita getDbPath() y migrationsDir de él (más
// backup(), pero crearBackup() no se ejercita en estos tests -- usa un .db real de prueba).
function crearDbServiceFalso(dbPath, migrationsDir) {
  return { getDbPath: () => dbPath, migrationsDir };
}

function crearMigrationsDirTemporal(nombres) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-migrations-'));
  for (const nombre of nombres) {
    fs.writeFileSync(path.join(dir, nombre), '-- vacío, solo para listar el archivo', 'utf8');
  }
  return dir;
}

// Crea un .db candidato con la estructura mínima esperada, N cuentas, y las migraciones dadas
// ya registradas como ejecutadas -- para simular un respaldo real.
function crearDbCandidata(dir, { tablas = true, cantidadCuentas = 50, migraciones = [] } = {}) {
  const dbPath = path.join(dir, 'candidata.db');
  const db = new Database(dbPath);
  if (tablas) {
    db.exec(`
      CREATE TABLE cuentas (id INTEGER PRIMARY KEY, codigo TEXT);
      CREATE TABLE recibos (id INTEGER PRIMARY KEY);
      CREATE TABLE cartera_movimientos (id INTEGER PRIMARY KEY);
      CREATE TABLE migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
    `);
    const insertCuenta = db.prepare('INSERT INTO cuentas (codigo) VALUES (?)');
    for (let i = 0; i < cantidadCuentas; i++) insertCuenta.run(`C${i}`);
    const insertMigracion = db.prepare('INSERT INTO migrations (name) VALUES (?)');
    for (const nombre of migraciones) insertMigracion.run(nombre);
  } else {
    db.exec(`CREATE TABLE otra_cosa (id INTEGER PRIMARY KEY);`);
  }
  db.close();
  return dbPath;
}

test('validarArchivoRestauracion rechaza un archivo que no existe', () => {
  const service = new BackupService(crearDbServiceFalso('/no/existe/acueducto.db', '/no/existe/migrations'));
  assert.throws(() => service.validarArchivoRestauracion('/ruta/inventada.db'), /no existe/);
});

test('validarArchivoRestauracion rechaza un archivo que no es SQLite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-restore-'));
  const archivoFalso = path.join(dir, 'no-es-sqlite.db');
  fs.writeFileSync(archivoFalso, 'esto no es una base de datos SQLite, es texto plano');

  const service = new BackupService(crearDbServiceFalso(path.join(dir, 'actual.db'), dir));
  assert.throws(() => service.validarArchivoRestauracion(archivoFalso), /no es una base de datos SQLite válida/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('validarArchivoRestauracion rechaza un SQLite válido pero sin las tablas esperadas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-restore-'));
  const candidata = crearDbCandidata(dir, { tablas: false });

  const service = new BackupService(crearDbServiceFalso(path.join(dir, 'actual.db'), dir));
  assert.throws(() => service.validarArchivoRestauracion(candidata), /faltan tablas/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('validarArchivoRestauracion rechaza un archivo con muy pocas cuentas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-restore-'));
  const candidata = crearDbCandidata(dir, { cantidadCuentas: 2, migraciones: [] });

  const service = new BackupService(crearDbServiceFalso(path.join(dir, 'actual.db'), dir));
  assert.throws(() => service.validarArchivoRestauracion(candidata), /muy pocas/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('validarArchivoRestauracion rechaza un archivo de una versión MÁS NUEVA que la app instalada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-restore-'));
  const migrationsDirApp = crearMigrationsDirTemporal(['001_inicial.sql', '002_segunda.sql']);
  const candidata = crearDbCandidata(dir, {
    migraciones: ['001_inicial.sql', '002_segunda.sql', '003_del_futuro.sql']
  });

  const service = new BackupService(crearDbServiceFalso(path.join(dir, 'actual.db'), migrationsDirApp));
  assert.throws(
    () => service.validarArchivoRestauracion(candidata),
    /versión más nueva.*003_del_futuro\.sql/s
  );

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(migrationsDirApp, { recursive: true, force: true });
});

test('validarArchivoRestauracion acepta un archivo de una versión ANTERIOR y reporta qué migraciones quedarían pendientes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-restore-'));
  const migrationsDirApp = crearMigrationsDirTemporal(['001_inicial.sql', '002_segunda.sql', '003_nueva.sql']);
  const candidata = crearDbCandidata(dir, {
    cantidadCuentas: 300,
    migraciones: ['001_inicial.sql', '002_segunda.sql']
  });

  const service = new BackupService(crearDbServiceFalso(path.join(dir, 'actual.db'), migrationsDirApp));
  const resultado = service.validarArchivoRestauracion(candidata);

  assert.equal(resultado.totalCuentas, 300);
  assert.deepEqual(resultado.migracionesPendientes, ['003_nueva.sql']);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(migrationsDirApp, { recursive: true, force: true });
});

test('validarArchivoRestauracion acepta un archivo con exactamente las mismas migraciones (misma versión)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-restore-'));
  const migrationsDirApp = crearMigrationsDirTemporal(['001_inicial.sql', '002_segunda.sql']);
  const candidata = crearDbCandidata(dir, {
    cantidadCuentas: 300,
    migraciones: ['001_inicial.sql', '002_segunda.sql']
  });

  const service = new BackupService(crearDbServiceFalso(path.join(dir, 'actual.db'), migrationsDirApp));
  const resultado = service.validarArchivoRestauracion(candidata);

  assert.equal(resultado.totalCuentas, 300);
  assert.deepEqual(resultado.migracionesPendientes, []);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(migrationsDirApp, { recursive: true, force: true });
});

test('rutaBackupPreRestauracion crea la carpeta de backups automáticos y devuelve una ruta con prefijo prerestore_', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acueducto-restore-'));
  const dbPath = path.join(dir, 'data', 'acueducto.db');
  const service = new BackupService(crearDbServiceFalso(dbPath, dir));

  const ruta = service.rutaBackupPreRestauracion();

  assert.ok(ruta.includes('backups_automaticos'));
  assert.ok(path.basename(ruta).startsWith('prerestore_'));
  assert.ok(fs.existsSync(path.dirname(ruta)), 'la carpeta de backups automáticos debía crearse');
  // No debe ser contado por listarBackupsAutomaticos() (ese solo mira el prefijo "auto_"),
  // para no competir por el cupo de rotación del backup automático diario.
  assert.deepEqual(service.listarBackupsAutomaticos(), []);

  fs.rmSync(dir, { recursive: true, force: true });
});
