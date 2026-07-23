const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      usuario TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT NOT NULL CHECK(rol IN ('admin', 'cajero')),
      activo INTEGER DEFAULT 1,
      creado_en TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS productos (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      codigo_barras TEXT UNIQUE,
      categoria TEXT NOT NULL DEFAULT 'general',
      precio_compra REAL NOT NULL DEFAULT 0,
      precio_venta REAL NOT NULL,
      stock_actual INTEGER NOT NULL DEFAULT 0,
      stock_minimo INTEGER NOT NULL DEFAULT 5,
      activo INTEGER DEFAULT 1,
      imagen TEXT,
      creado_en TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS movimientos_inventario (
      id SERIAL PRIMARY KEY,
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      tipo TEXT NOT NULL CHECK(tipo IN ('ENTRADA', 'SALIDA', 'AJUSTE')),
      cantidad INTEGER NOT NULL,
      motivo TEXT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      fecha TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cajas (
      id SERIAL PRIMARY KEY,
      fecha DATE DEFAULT CURRENT_DATE,
      monto_apertura REAL NOT NULL DEFAULT 0,
      monto_cierre_real REAL,
      monto_cierre_esperado REAL,
      diferencia REAL,
      total_ventas_efectivo REAL DEFAULT 0,
      total_ventas_transferencia REAL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'ABIERTA' CHECK(estado IN ('ABIERTA', 'CERRADA')),
      cajero_id INTEGER NOT NULL REFERENCES usuarios(id),
      notas TEXT,
      abierta_en TIMESTAMP DEFAULT NOW(),
      cerrada_en TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ventas (
      id SERIAL PRIMARY KEY,
      fecha TIMESTAMP DEFAULT NOW(),
      total REAL NOT NULL,
      metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'CREDITO')),
      cajero_id INTEGER NOT NULL REFERENCES usuarios(id),
      caja_id INTEGER NOT NULL REFERENCES cajas(id),
      anulada INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS venta_detalles (
      id SERIAL PRIMARY KEY,
      venta_id INTEGER NOT NULL REFERENCES ventas(id),
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      cantidad INTEGER NOT NULL,
      precio_unitario REAL NOT NULL,
      subtotal REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      clave TEXT PRIMARY KEY,
      valor TEXT
    );

    CREATE TABLE IF NOT EXISTS creditos (
      id SERIAL PRIMARY KEY,
      nombre_cliente TEXT NOT NULL,
      tipo_cliente TEXT NOT NULL DEFAULT 'profesor' CHECK(tipo_cliente IN ('profesor', 'alumno', 'otro')),
      monto REAL NOT NULL,
      saldo_pendiente REAL NOT NULL,
      venta_id INTEGER REFERENCES ventas(id),
      cajero_id INTEGER NOT NULL REFERENCES usuarios(id),
      caja_id INTEGER REFERENCES cajas(id),
      estado TEXT DEFAULT 'PENDIENTE' CHECK(estado IN ('PENDIENTE', 'PAGADO', 'PARCIAL')),
      notas TEXT,
      fecha TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pagos_credito (
      id SERIAL PRIMARY KEY,
      credito_id INTEGER NOT NULL REFERENCES creditos(id),
      monto REAL NOT NULL,
      metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('EFECTIVO', 'TRANSFERENCIA')),
      cajero_id INTEGER NOT NULL REFERENCES usuarios(id),
      fecha TIMESTAMP DEFAULT NOW()
    );
  `);

  const { rows } = await pool.query("SELECT id FROM usuarios WHERE usuario = 'admin'");
  if (rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query('INSERT INTO usuarios (nombre, usuario, password, rol) VALUES ($1, $2, $3, $4)', ['Administrador', 'admin', hash, 'admin']);

    const hashCajero = bcrypt.hashSync('cajero123', 10);
    await pool.query('INSERT INTO usuarios (nombre, usuario, password, rol) VALUES ($1, $2, $3, $4)', ['Cajero Principal', 'cajero', hashCajero, 'cajero']);

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

    for (const p of productos) {
      await pool.query(
        'INSERT INTO productos (nombre, categoria, precio_compra, precio_venta, stock_actual, stock_minimo) VALUES ($1, $2, $3, $4, $5, $6)',
        p
      );
    }

    await pool.query("INSERT INTO config (clave, valor) VALUES ('webhook_url', '') ON CONFLICT (clave) DO NOTHING");
    await pool.query("INSERT INTO config (clave, valor) VALUES ('nombre_negocio', 'Meriendas Gimnasio Campestre') ON CONFLICT (clave) DO NOTHING");
  }

  return pool;
}

module.exports = { pool, initDb };
