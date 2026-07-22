const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'meriendas.db');

let db = null;

class DbWrapper {
  constructor(sqlDb) { this.db = sqlDb; }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        self.db.run(sql, params);
        return { lastInsertRowid: self._lastId(), changes: self.db.getRowsModified() };
      },
      get(...params) {
        const stmt = self.db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = [];
        const stmt = self.db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        return results;
      }
    };
  }

  exec(sql) { this.db.exec(sql); }

  _lastId() {
    const stmt = this.db.prepare('SELECT last_insert_rowid() as id');
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return row.id;
  }

  transaction(fn) {
    return (...args) => {
      this.db.run('BEGIN TRANSACTION');
      try {
        const result = fn(...args);
        this.db.run('COMMIT');
        this._save();
        return result;
      } catch (e) {
        this.db.run('ROLLBACK');
        throw e;
      }
    };
  }

  _save() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

async function initDb() {
  const SQL = await initSqlJs();

  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buffer);
  } else {
    sqlDb = new SQL.Database();
  }

  db = new DbWrapper(sqlDb);

  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      usuario TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT NOT NULL CHECK(rol IN ('admin', 'cajero')),
      activo INTEGER DEFAULT 1,
      creado_en TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      codigo_barras TEXT UNIQUE,
      categoria TEXT NOT NULL DEFAULT 'general',
      precio_compra REAL NOT NULL DEFAULT 0,
      precio_venta REAL NOT NULL,
      stock_actual INTEGER NOT NULL DEFAULT 0,
      stock_minimo INTEGER NOT NULL DEFAULT 5,
      activo INTEGER DEFAULT 1,
      creado_en TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS movimientos_inventario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('ENTRADA', 'SALIDA', 'AJUSTE')),
      cantidad INTEGER NOT NULL,
      motivo TEXT,
      usuario_id INTEGER NOT NULL,
      fecha TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (producto_id) REFERENCES productos(id),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS cajas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT DEFAULT (date('now', 'localtime')),
      monto_apertura REAL NOT NULL DEFAULT 0,
      monto_cierre_real REAL,
      monto_cierre_esperado REAL,
      diferencia REAL,
      total_ventas_efectivo REAL DEFAULT 0,
      total_ventas_transferencia REAL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'ABIERTA' CHECK(estado IN ('ABIERTA', 'CERRADA')),
      cajero_id INTEGER NOT NULL,
      notas TEXT,
      abierta_en TEXT DEFAULT (datetime('now', 'localtime')),
      cerrada_en TEXT,
      FOREIGN KEY (cajero_id) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT DEFAULT (datetime('now', 'localtime')),
      total REAL NOT NULL,
      metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'CREDITO')),
      cajero_id INTEGER NOT NULL,
      caja_id INTEGER NOT NULL,
      anulada INTEGER DEFAULT 0,
      FOREIGN KEY (cajero_id) REFERENCES usuarios(id),
      FOREIGN KEY (caja_id) REFERENCES cajas(id)
    );

    CREATE TABLE IF NOT EXISTS venta_detalles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL,
      producto_id INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      precio_unitario REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (venta_id) REFERENCES ventas(id),
      FOREIGN KEY (producto_id) REFERENCES productos(id)
    );

    CREATE TABLE IF NOT EXISTS config (
      clave TEXT PRIMARY KEY,
      valor TEXT
    );

    CREATE TABLE IF NOT EXISTS creditos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre_cliente TEXT NOT NULL,
      tipo_cliente TEXT NOT NULL DEFAULT 'profesor' CHECK(tipo_cliente IN ('profesor', 'alumno', 'otro')),
      monto REAL NOT NULL,
      saldo_pendiente REAL NOT NULL,
      venta_id INTEGER,
      cajero_id INTEGER NOT NULL,
      caja_id INTEGER,
      estado TEXT DEFAULT 'PENDIENTE' CHECK(estado IN ('PENDIENTE', 'PAGADO', 'PARCIAL')),
      notas TEXT,
      fecha TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (venta_id) REFERENCES ventas(id),
      FOREIGN KEY (cajero_id) REFERENCES usuarios(id)
    );

    CREATE TABLE IF NOT EXISTS pagos_credito (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credito_id INTEGER NOT NULL,
      monto REAL NOT NULL,
      metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('EFECTIVO', 'TRANSFERENCIA')),
      cajero_id INTEGER NOT NULL,
      fecha TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (credito_id) REFERENCES creditos(id),
      FOREIGN KEY (cajero_id) REFERENCES usuarios(id)
    );
  `);

  try { db.exec('ALTER TABLE productos ADD COLUMN codigo_barras TEXT UNIQUE'); } catch(e) {}

  const adminExists = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO usuarios (nombre, usuario, password, rol) VALUES (?, ?, ?, ?)').run('Administrador', 'admin', hash, 'admin');

    const hashCajero = bcrypt.hashSync('cajero123', 10);
    db.prepare('INSERT INTO usuarios (nombre, usuario, password, rol) VALUES (?, ?, ?, ?)').run('Cajero Principal', 'cajero', hashCajero, 'cajero');

    const productos = [
      ['Empanada de carne', 'panaderia', 1200, 2500, 30, 10],
      ['Empanada de pollo', 'panaderia', 1200, 2500, 25, 10],
      ['Bunuelo', 'panaderia', 800, 1500, 20, 10],
      ['Pan de bono', 'panaderia', 700, 1500, 25, 10],
      ['Croissant jamon y queso', 'panaderia', 1500, 3000, 15, 5],
      ['Jugo de naranja', 'bebidas', 1000, 2500, 20, 8],
      ['Jugo de mango', 'bebidas', 1000, 2500, 18, 8],
      ['Agua botella 600ml', 'bebidas', 500, 1500, 40, 15],
      ['Gaseosa personal', 'bebidas', 800, 2000, 30, 10],
      ['Te frio', 'bebidas', 900, 2000, 15, 8],
      ['Galletas surtidas', 'snacks', 600, 1500, 35, 10],
      ['Papas fritas paquete', 'snacks', 700, 2000, 30, 10],
      ['Chocoramo', 'snacks', 800, 1800, 25, 10],
      ['Brownie', 'snacks', 1000, 2500, 15, 5],
      ['Fruta picada', 'saludable', 1500, 3500, 10, 5],
      ['Yogurt con cereal', 'saludable', 1800, 3500, 12, 5],
      ['Sandwich integral', 'saludable', 2000, 4000, 10, 5],
      ['Gelatina', 'postres', 500, 1500, 20, 8],
      ['Torta de chocolate porcion', 'postres', 1500, 3500, 8, 3],
      ['Helado paleta', 'postres', 800, 2000, 20, 8],
    ];

    const insertStmt = db.prepare(
      'INSERT INTO productos (nombre, categoria, precio_compra, precio_venta, stock_actual, stock_minimo) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const p of productos) insertStmt.run(...p);

    db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)").run('webhook_url', '');
    db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)").run('nombre_negocio', 'Meriendas Gimnasio Campestre');

    db._save();
  }

  // Auto-save every 5 seconds if there are changes
  setInterval(() => { try { db._save(); } catch(e) {} }, 5000);

  return db;
}

module.exports = { getDb, initDb };
