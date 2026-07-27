const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseService {
  // baseDir: carpeta donde vivirá data/acueducto.db. En la app empaquetada debe ser
  // app.getPath('userData') (ej. %APPDATA%/acueducto-admin), nunca process.cwd():
  // una vez instalada en "Program Files", process.cwd() no es escribible por el usuario.
  //
  // migrationsDir: solo para pruebas automatizadas (permite apuntar a un directorio de
  // migraciones falso). En producción siempre es undefined y se usa la carpeta real.
  constructor(baseDir, migrationsDir) {
    this.dbPath = path.join(baseDir || process.cwd(), 'data', 'acueducto.db');
    const dbDir = path.dirname(this.dbPath);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.migrationsDir = migrationsDir || path.join(__dirname, 'migrations');
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
    if (!fs.existsSync(this.migrationsDir)) {
      fs.mkdirSync(this.migrationsDir, { recursive: true });
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const executed = this.db.prepare('SELECT name FROM migrations').all();
    const executedNames = executed.map(m => m.name);

    // Cada migración se aplica en una única transacción junto con su propio registro en
    // `migrations`: si cualquier sentencia del archivo falla, TODO el archivo se revierte y no
    // queda marcado como ejecutado, así que el siguiente arranque puede reintentarlo desde cero
    // sin toparse con "ya existe" a mitad de camino. (Antes de este cambio, db.exec() confirmaba
    // cada sentencia por separado en autocommit: un fallo a mitad de archivo podía dejar la base
    // a medias sin que el archivo quedara ni pendiente de forma segura ni aplicado del todo.)
    const aplicarMigracion = this.db.transaction((file, sql) => {
      this.db.exec(sql);
      this.db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    });

    // SQLite exige que `PRAGMA foreign_keys` se cambie SIN una transacción/SAVEPOINT activo — lo
    // ignora en silencio si se ejecuta dentro de una (por eso NO basta con que la propia migración
    // incluya el PRAGMA en su SQL: para cuando aplicarMigracion() abre su transacción, ya es tarde).
    // `PRAGMA defer_foreign_keys` tampoco sirve aquí: solo aplaza la validación de filas, no el
    // chequeo que SQLite hace al hacer DROP TABLE de una tabla referenciada por FK desde otra (ver
    // 017_terceros_no_informado_y_roles.test.js, que reproduce exactamente ese caso). Por eso, si el
    // archivo empieza con `PRAGMA foreign_keys = OFF;` (el procedimiento oficial de SQLite para
    // recrear una tabla — sqlite.org/lang_altertable.html, "Making Other Kinds Of Table Schema
    // Changes"), lo aplicamos aquí fuera de la transacción, y lo restauramos siempre al terminar
    // (haya ido bien o mal) para no dejar la conexión con las FK desactivadas por un error a mitad
    // de camino. El PRAGMA que la propia migración repite dentro de su SQL queda como no-op inerte.
    const requiereFkOffFueraDeTransaccion = sql => /^\s*PRAGMA\s+foreign_keys\s*=\s*OFF\s*;/im.test(sql);

    for (const file of files) {
      if (!executedNames.includes(file)) {
        console.log(`Ejecutando migración: ${file}`);
        const sql = fs.readFileSync(path.join(this.migrationsDir, file), 'utf8');
        const necesitaFkOff = requiereFkOffFueraDeTransaccion(sql);

        if (necesitaFkOff) this.db.pragma('foreign_keys = OFF');
        try {
          aplicarMigracion(file, sql);
        } finally {
          if (necesitaFkOff) this.db.pragma('foreign_keys = ON');
        }

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
