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
  const { nombre, codigo_barras, categoria, precio_compra, precio_venta, stock_actual, stock_minimo, imagen } = req.body;
  if (!nombre || precio_venta === undefined) {
    return res.status(400).json({ error: 'Nombre y precio de venta son requeridos' });
  }
  const db = getDb();
  try {
    const result = db.prepare(
      'INSERT INTO productos (nombre, codigo_barras, categoria, precio_compra, precio_venta, stock_actual, stock_minimo, imagen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(nombre, codigo_barras || null, categoria || 'general', precio_compra || 0, precio_venta, stock_actual || 0, stock_minimo || 5, imagen || null);
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

  const { codigo_barras, imagen } = req.body;
  try {
  db.prepare(
    'UPDATE productos SET nombre=?, codigo_barras=?, categoria=?, precio_compra=?, precio_venta=?, stock_minimo=?, activo=?, imagen=? WHERE id=?'
  ).run(
    nombre ?? existing.nombre,
    codigo_barras !== undefined ? (codigo_barras || null) : existing.codigo_barras,
    categoria ?? existing.categoria,
    precio_compra ?? existing.precio_compra,
    precio_venta ?? existing.precio_venta,
    stock_minimo ?? existing.stock_minimo,
    activo ?? existing.activo,
    imagen !== undefined ? (imagen || null) : existing.imagen,
    Number(req.params.id)
  );
  db._save();
  res.json(db.prepare('SELECT * FROM productos WHERE id = ?').get(Number(req.params.id)));
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Ese codigo de barras ya esta asignado a otro producto' });
    res.status(400).json({ error: e.message });
  }
});

// ── Categories management ──
router.put('/categorias/renombrar', verificarToken, soloAdmin, (req, res) => {
  const { vieja, nueva } = req.body;
  if (!vieja || !nueva) return res.status(400).json({ error: 'Categoria vieja y nueva requeridas' });
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as c FROM productos WHERE categoria = ?').get(vieja).c;
  if (count === 0) return res.status(404).json({ error: 'No hay productos con esa categoria' });
  db.prepare('UPDATE productos SET categoria = ? WHERE categoria = ?').run(nueva.trim(), vieja);
  db._save();
  res.json({ ok: true, actualizados: count });
});

router.delete('/categorias/:nombre', verificarToken, soloAdmin, (req, res) => {
  const nombre = decodeURIComponent(req.params.nombre);
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as c FROM productos WHERE categoria = ?').get(nombre).c;
  if (count === 0) return res.status(404).json({ error: 'No hay productos con esa categoria' });
  db.prepare("UPDATE productos SET categoria = 'general' WHERE categoria = ?").run(nombre);
  db._save();
  res.json({ ok: true, movidos: count });
});

// ── Trash ──
router.get('/papelera', verificarToken, soloAdmin, (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM productos WHERE activo = 0 ORDER BY nombre').all());
});

router.post('/:id/restaurar', verificarToken, soloAdmin, (req, res) => {
  const db = getDb();
  const prod = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 0').get(Number(req.params.id));
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado en papelera' });
  db.prepare('UPDATE productos SET activo = 1 WHERE id = ?').run(Number(req.params.id));
  db._save();
  res.json({ ok: true });
});

router.delete('/:id/permanente', verificarToken, soloAdmin, (req, res) => {
  const db = getDb();
  const prod = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 0').get(Number(req.params.id));
  if (!prod) return res.status(404).json({ error: 'Solo se pueden eliminar permanentemente productos que esten en la papelera' });
  const enVentas = db.prepare('SELECT COUNT(*) as c FROM venta_detalles WHERE producto_id = ?').get(Number(req.params.id)).c;
  if (enVentas > 0) {
    return res.status(400).json({ error: 'No se puede eliminar permanentemente, tiene ' + enVentas + ' ventas asociadas. Se mantendra en papelera.' });
  }
  db.prepare('DELETE FROM movimientos_inventario WHERE producto_id = ?').run(Number(req.params.id));
  db.prepare('DELETE FROM productos WHERE id = ?').run(Number(req.params.id));
  db._save();
  res.json({ ok: true });
});

module.exports = router;
