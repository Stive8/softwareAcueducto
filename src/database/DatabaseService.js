const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseService {
  // baseDir: carpeta donde vivirá data/acueducto.db. En la app empaquetada debe ser
  // app.getPath('userData') (ej. %APPDATA%/acueducto-admin), nunca process.cwd():
  // una vez instalada en "Program Files", process.cwd() no es escribible por el usuario.
  constructor(baseDir) {
    this.dbPath = path.join(baseDir || process.cwd(), 'data', 'acueducto.db');
    const dbDir = path.dirname(this.dbPath);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  getDbPath() {
    return this.dbPath;
  }

  // Copia de seguridad en caliente (segura con WAL activo) hacia un archivo destino
  backup(destinoPath) {
    return this.db.backup(destinoPath);
  }

  initialize() {
    this.createMigrationsTable();
    this.runMigrations();
  }

  createMigrationsTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  runMigrations() {
    const migrationsDir = path.join(__dirname, 'migrations');
    
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const executed = this.db.prepare('SELECT name FROM migrations').all();
    const executedNames = executed.map(m => m.name);

    for (const file of files) {
      if (!executedNames.includes(file)) {
        console.log(`Ejecutando migración: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        
        this.db.exec(sql);
        this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
        
        console.log(`Migración ${file} ejecutada con éxito`);
      }
    }
  }

  getDb() {
    return this.db;
  }

  close() {
    this.db.close();
  }
}

module.exports = DatabaseService;
