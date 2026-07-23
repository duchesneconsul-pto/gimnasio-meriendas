const express = require('express');
const { pool } = require('../database');
const { verificarToken, soloAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', verificarToken, async (req, res) => {
  try {
    const hoy = new Date().toISOString().split('T')[0];

    const ventasHoy = (await pool.query(`
      SELECT COUNT(*) as cantidad, COALESCE(SUM(total),0) as total
      FROM ventas WHERE fecha::date = $1 AND anulada = 0
    `, [hoy])).rows[0];

    const ventasSemana = (await pool.query(`
      SELECT COUNT(*) as cantidad, COALESCE(SUM(total),0) as total
      FROM ventas WHERE fecha::date >= CURRENT_DATE - INTERVAL '7 days' AND anulada = 0
    `)).rows[0];

    const ventasMes = (await pool.query(`
      SELECT COUNT(*) as cantidad, COALESCE(SUM(total),0) as total
      FROM ventas WHERE to_char(fecha, 'YYYY-MM') = to_char(NOW(), 'YYYY-MM') AND anulada = 0
    `)).rows[0];

    const topProductos = (await pool.query(`
      SELECT p.nombre, p.categoria, SUM(vd.cantidad) as unidades, SUM(vd.subtotal) as total
      FROM venta_detalles vd
      JOIN ventas v ON vd.venta_id = v.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE v.fecha::date = $1 AND v.anulada = 0
      GROUP BY vd.producto_id, p.nombre, p.categoria ORDER BY unidades DESC LIMIT 10
    `, [hoy])).rows;

    const stockBajo = (await pool.query(
      'SELECT * FROM productos WHERE activo = 1 AND stock_actual <= stock_minimo ORDER BY stock_actual ASC'
    )).rows;

    const ultimoArqueo = (await pool.query(`
      SELECT c.*, u.nombre as cajero_nombre FROM cajas c
      JOIN usuarios u ON c.cajero_id = u.id
      WHERE c.estado = 'CERRADA' ORDER BY c.cerrada_en DESC LIMIT 1
    `)).rows[0];

    const ventasPorDia = (await pool.query(`
      SELECT fecha::date as dia, COUNT(*) as cantidad, SUM(total) as total
      FROM ventas WHERE fecha::date >= CURRENT_DATE - INTERVAL '30 days' AND anulada = 0
      GROUP BY fecha::date ORDER BY dia
    `)).rows;

    const totalProductos = (await pool.query('SELECT COUNT(*) as total FROM productos WHERE activo = 1')).rows[0];
    const valorInventario = (await pool.query(
      'SELECT COALESCE(SUM(stock_actual * precio_compra),0) as costo, COALESCE(SUM(stock_actual * precio_venta),0) as venta FROM productos WHERE activo = 1'
    )).rows[0];

    res.json({
      ventasHoy, ventasSemana, ventasMes,
      topProductos, stockBajo, ultimoArqueo,
      ventasPorDia, totalProductos: Number(totalProductos.total),
      valorInventario
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/rentabilidad', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.nombre, p.categoria, p.precio_compra, p.precio_venta,
        (p.precio_venta - p.precio_compra) as ganancia_unitaria,
        COALESCE(SUM(vd.cantidad),0) as total_vendido,
        COALESCE(SUM(vd.subtotal),0) as ingresos,
        COALESCE(SUM(vd.cantidad * p.precio_compra),0) as costo_total,
        COALESCE(SUM(vd.subtotal) - SUM(vd.cantidad * p.precio_compra),0) as ganancia_total
      FROM productos p
      LEFT JOIN venta_detalles vd ON p.id = vd.producto_id
      LEFT JOIN ventas v ON vd.venta_id = v.id AND v.anulada = 0
      WHERE p.activo = 1
      GROUP BY p.id ORDER BY ganancia_total DESC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/config', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM config');
    const result = {};
    for (const c of rows) result[c.clave] = c.valor;
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/config', verificarToken, soloAdmin, async (req, res) => {
  try {
    for (const [clave, valor] of Object.entries(req.body)) {
      await pool.query(
        'INSERT INTO config (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO UPDATE SET valor = $2',
        [clave, valor]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
