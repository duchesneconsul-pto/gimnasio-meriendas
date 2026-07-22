const express = require('express');
const { getDb } = require('../database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

router.get('/', verificarToken, (req, res) => {
  const db = getDb();
  const { producto_id, tipo, limit } = req.query;
  let sql = `
    SELECT m.*, p.nombre as producto_nombre, u.nombre as usuario_nombre
    FROM movimientos_inventario m
    JOIN productos p ON m.producto_id = p.id
    JOIN usuarios u ON m.usuario_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (producto_id) { sql += ' AND m.producto_id = ?'; params.push(Number(producto_id)); }
  if (tipo) { sql += ' AND m.tipo = ?'; params.push(tipo); }
  sql += ' ORDER BY m.fecha DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }

  res.json(db.prepare(sql).all(...params));
});

router.post('/entrada', verificarToken, (req, res) => {
  const { producto_id, cantidad, motivo } = req.body;
  if (!producto_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Producto y cantidad valida requeridos' });
  }

  const db = getDb();
  const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(Number(producto_id));
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

  db.prepare(
    'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)'
  ).run(Number(producto_id), 'ENTRADA', Number(cantidad), motivo || 'Reposicion', req.user.id);

  db.prepare('UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?').run(Number(cantidad), Number(producto_id));
  db._save();

  const updated = db.prepare('SELECT * FROM productos WHERE id = ?').get(Number(producto_id));
  res.json({ producto: updated, mensaje: `Se agregaron ${cantidad} unidades` });
});

router.post('/ajuste', verificarToken, (req, res) => {
  const { producto_id, stock_real, motivo } = req.body;
  if (!producto_id || stock_real === undefined) {
    return res.status(400).json({ error: 'Producto y stock real requeridos' });
  }

  const db = getDb();
  const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(Number(producto_id));
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

  const diferencia = stock_real - producto.stock_actual;

  db.prepare(
    'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)'
  ).run(Number(producto_id), 'AJUSTE', diferencia, motivo || `Ajuste de inventario (${producto.stock_actual} -> ${stock_real})`, req.user.id);

  db.prepare('UPDATE productos SET stock_actual = ? WHERE id = ?').run(Number(stock_real), Number(producto_id));
  db._save();

  const updated = db.prepare('SELECT * FROM productos WHERE id = ?').get(Number(producto_id));
  res.json({ producto: updated, diferencia });
});

module.exports = router;
