const express = require('express');
const { pool } = require('../database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

router.get('/', verificarToken, async (req, res) => {
  try {
    const { producto_id, tipo, limit } = req.query;
    let sql = `
      SELECT m.*, p.nombre as producto_nombre, u.nombre as usuario_nombre
      FROM movimientos_inventario m
      JOIN productos p ON m.producto_id = p.id
      JOIN usuarios u ON m.usuario_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (producto_id) { sql += ` AND m.producto_id = $${idx++}`; params.push(Number(producto_id)); }
    if (tipo) { sql += ` AND m.tipo = $${idx++}`; params.push(tipo); }
    sql += ' ORDER BY m.fecha DESC';
    if (limit) { sql += ` LIMIT $${idx++}`; params.push(Number(limit)); }

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/entrada', verificarToken, async (req, res) => {
  const { producto_id, cantidad, motivo } = req.body;
  if (!producto_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'Producto y cantidad valida requeridos' });
  }

  try {
    const producto = (await pool.query('SELECT * FROM productos WHERE id = $1', [producto_id])).rows[0];
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

    await pool.query(
      'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id) VALUES ($1, $2, $3, $4, $5)',
      [producto_id, 'ENTRADA', Number(cantidad), motivo || 'Reposicion', req.user.id]
    );

    const updated = (await pool.query(
      'UPDATE productos SET stock_actual = stock_actual + $1 WHERE id = $2 RETURNING *',
      [Number(cantidad), producto_id]
    )).rows[0];

    res.json({ producto: updated, mensaje: `Se agregaron ${cantidad} unidades` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/ajuste', verificarToken, async (req, res) => {
  const { producto_id, stock_real, motivo } = req.body;
  if (!producto_id || stock_real === undefined) {
    return res.status(400).json({ error: 'Producto y stock real requeridos' });
  }

  try {
    const producto = (await pool.query('SELECT * FROM productos WHERE id = $1', [producto_id])).rows[0];
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const diferencia = stock_real - producto.stock_actual;

    await pool.query(
      'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id) VALUES ($1, $2, $3, $4, $5)',
      [producto_id, 'AJUSTE', diferencia, motivo || `Ajuste de inventario (${producto.stock_actual} -> ${stock_real})`, req.user.id]
    );

    const updated = (await pool.query(
      'UPDATE productos SET stock_actual = $1 WHERE id = $2 RETURNING *',
      [Number(stock_real), producto_id]
    )).rows[0];

    res.json({ producto: updated, diferencia });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
