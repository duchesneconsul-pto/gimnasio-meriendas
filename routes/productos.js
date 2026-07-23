const express = require('express');
const { pool } = require('../database');
const { verificarToken, soloAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', verificarToken, async (req, res) => {
  try {
    const { activo, categoria } = req.query;
    let sql = 'SELECT * FROM productos WHERE 1=1';
    const params = [];
    let idx = 1;

    if (activo !== undefined) {
      sql += ' AND activo = $' + idx++;
      params.push(Number(activo));
    }
    if (categoria) {
      sql += ' AND categoria = $' + idx++;
      params.push(categoria);
    }
    sql += ' ORDER BY categoria, nombre';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/categorias', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT DISTINCT categoria FROM productos ORDER BY categoria');
    res.json(rows.map(c => c.categoria));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/stock-bajo', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM productos WHERE activo = 1 AND stock_actual <= stock_minimo ORDER BY stock_actual ASC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/buscar-barcode/:codigo', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM productos WHERE codigo_barras = $1 AND activo = 1', [req.params.codigo]);
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado con ese codigo de barras' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { nombre, codigo_barras, categoria, precio_compra, precio_venta, stock_actual, stock_minimo, imagen } = req.body;
  if (!nombre || precio_venta === undefined) {
    return res.status(400).json({ error: 'Nombre y precio de venta son requeridos' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO productos (nombre, codigo_barras, categoria, precio_compra, precio_venta, stock_actual, stock_minimo, imagen) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [nombre, codigo_barras || null, categoria || 'general', precio_compra || 0, precio_venta, stock_actual || 0, stock_minimo || 5, imagen || null]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.message && e.message.includes('unique')) return res.status(400).json({ error: 'Ese codigo de barras ya esta asignado a otro producto' });
    res.status(400).json({ error: e.message });
  }
});

router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  try {
    const existing = (await pool.query('SELECT * FROM productos WHERE id = $1', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

    const { nombre, codigo_barras, categoria, precio_compra, precio_venta, stock_minimo, activo, imagen } = req.body;
    const { rows } = await pool.query(
      'UPDATE productos SET nombre=$1, codigo_barras=$2, categoria=$3, precio_compra=$4, precio_venta=$5, stock_minimo=$6, activo=$7, imagen=$8 WHERE id=$9 RETURNING *',
      [
        nombre ?? existing.nombre,
        codigo_barras !== undefined ? (codigo_barras || null) : existing.codigo_barras,
        categoria ?? existing.categoria,
        precio_compra ?? existing.precio_compra,
        precio_venta ?? existing.precio_venta,
        stock_minimo ?? existing.stock_minimo,
        activo ?? existing.activo,
        imagen !== undefined ? (imagen || null) : existing.imagen,
        req.params.id
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.message && e.message.includes('unique')) return res.status(400).json({ error: 'Ese codigo de barras ya esta asignado a otro producto' });
    res.status(400).json({ error: e.message });
  }
});

// ── Categories management ──
router.put('/categorias/renombrar', verificarToken, soloAdmin, async (req, res) => {
  const { vieja, nueva } = req.body;
  if (!vieja || !nueva) return res.status(400).json({ error: 'Categoria vieja y nueva requeridas' });
  try {
    const countResult = await pool.query('SELECT COUNT(*) as c FROM productos WHERE categoria = $1', [vieja]);
    const count = Number(countResult.rows[0].c);
    if (count === 0) return res.status(404).json({ error: 'No hay productos con esa categoria' });
    await pool.query('UPDATE productos SET categoria = $1 WHERE categoria = $2', [nueva.trim(), vieja]);
    res.json({ ok: true, actualizados: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/categorias/:nombre', verificarToken, soloAdmin, async (req, res) => {
  const nombre = decodeURIComponent(req.params.nombre);
  try {
    const countResult = await pool.query('SELECT COUNT(*) as c FROM productos WHERE categoria = $1', [nombre]);
    const count = Number(countResult.rows[0].c);
    if (count === 0) return res.status(404).json({ error: 'No hay productos con esa categoria' });
    await pool.query("UPDATE productos SET categoria = 'general' WHERE categoria = $1", [nombre]);
    res.json({ ok: true, movidos: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Trash ──
router.get('/papelera', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM productos WHERE activo = 0 ORDER BY nombre');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/restaurar', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM productos WHERE id = $1 AND activo = 0', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado en papelera' });
    await pool.query('UPDATE productos SET activo = 1 WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id/permanente', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM productos WHERE id = $1 AND activo = 0', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Solo se pueden eliminar permanentemente productos que esten en la papelera' });
    const ventasResult = await pool.query('SELECT COUNT(*) as c FROM venta_detalles WHERE producto_id = $1', [req.params.id]);
    const enVentas = Number(ventasResult.rows[0].c);
    if (enVentas > 0) {
      return res.status(400).json({ error: 'No se puede eliminar permanentemente, tiene ' + enVentas + ' ventas asociadas. Se mantendra en papelera.' });
    }
    await pool.query('DELETE FROM movimientos_inventario WHERE producto_id = $1', [req.params.id]);
    await pool.query('DELETE FROM productos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
