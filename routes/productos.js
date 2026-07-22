const express = require('express');
const { getDb } = require('../database');
const { verificarToken, soloAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', verificarToken, (req, res) => {
  const db = getDb();
  const { activo, categoria } = req.query;
  let sql = 'SELECT * FROM productos WHERE 1=1';
  const params = [];

  if (activo !== undefined) {
    sql += ' AND activo = ?';
    params.push(Number(activo));
  }
  if (categoria) {
    sql += ' AND categoria = ?';
    params.push(categoria);
  }
  sql += ' ORDER BY categoria, nombre';
  res.json(db.prepare(sql).all(...params));
});

router.get('/categorias', verificarToken, (req, res) => {
  const db = getDb();
  const cats = db.prepare('SELECT DISTINCT categoria FROM productos ORDER BY categoria').all();
  res.json(cats.map(c => c.categoria));
});

router.get('/stock-bajo', verificarToken, (req, res) => {
  const db = getDb();
  const productos = db.prepare(
    'SELECT * FROM productos WHERE activo = 1 AND stock_actual <= stock_minimo ORDER BY stock_actual ASC'
  ).all();
  res.json(productos);
});

router.get('/buscar-barcode/:codigo', verificarToken, (req, res) => {
  const db = getDb();
  const producto = db.prepare('SELECT * FROM productos WHERE codigo_barras = ? AND activo = 1').get(req.params.codigo);
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado con ese codigo de barras' });
  res.json(producto);
});

router.post('/', verificarToken, soloAdmin, (req, res) => {
  const { nombre, codigo_barras, categoria, precio_compra, precio_venta, stock_actual, stock_minimo } = req.body;
  if (!nombre || precio_venta === undefined) {
    return res.status(400).json({ error: 'Nombre y precio de venta son requeridos' });
  }
  const db = getDb();
  try {
    const result = db.prepare(
      'INSERT INTO productos (nombre, codigo_barras, categoria, precio_compra, precio_venta, stock_actual, stock_minimo) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(nombre, codigo_barras || null, categoria || 'general', precio_compra || 0, precio_venta, stock_actual || 0, stock_minimo || 5);
    db._save();
    const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(result.lastInsertRowid);
    res.json(producto);
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Ese codigo de barras ya esta asignado a otro producto' });
    res.status(400).json({ error: e.message });
  }
});

router.put('/:id', verificarToken, soloAdmin, (req, res) => {
  const { nombre, categoria, precio_compra, precio_venta, stock_minimo, activo } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM productos WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

  const { codigo_barras } = req.body;
  try {
  db.prepare(
    'UPDATE productos SET nombre=?, codigo_barras=?, categoria=?, precio_compra=?, precio_venta=?, stock_minimo=?, activo=? WHERE id=?'
  ).run(
    nombre ?? existing.nombre,
    codigo_barras !== undefined ? (codigo_barras || null) : existing.codigo_barras,
    categoria ?? existing.categoria,
    precio_compra ?? existing.precio_compra,
    precio_venta ?? existing.precio_venta,
    stock_minimo ?? existing.stock_minimo,
    activo ?? existing.activo,
    Number(req.params.id)
  );
  db._save();
  res.json(db.prepare('SELECT * FROM productos WHERE id = ?').get(Number(req.params.id)));
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Ese codigo de barras ya esta asignado a otro producto' });
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
