const express = require('express');
const { getDb } = require('../database');
const { verificarToken, soloAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', verificarToken, (req, res) => {
  const db = getDb();
  const hoy = new Date().toISOString().split('T')[0];

  const ventasHoy = db.prepare(`
    SELECT COUNT(*) as cantidad, COALESCE(SUM(total),0) as total
    FROM ventas WHERE date(fecha) = ? AND anulada = 0
  `).get(hoy);

  const ventasSemana = db.prepare(`
    SELECT COUNT(*) as cantidad, COALESCE(SUM(total),0) as total
    FROM ventas WHERE date(fecha) >= date('now','localtime','-7 days') AND anulada = 0
  `).get();

  const ventasMes = db.prepare(`
    SELECT COUNT(*) as cantidad, COALESCE(SUM(total),0) as total
    FROM ventas WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now', 'localtime') AND anulada = 0
  `).get();

  const topProductos = db.prepare(`
    SELECT p.nombre, p.categoria, SUM(vd.cantidad) as unidades, SUM(vd.subtotal) as total
    FROM venta_detalles vd
    JOIN ventas v ON vd.venta_id = v.id
    JOIN productos p ON vd.producto_id = p.id
    WHERE date(v.fecha) = ? AND v.anulada = 0
    GROUP BY vd.producto_id ORDER BY unidades DESC LIMIT 10
  `).all(hoy);

  const stockBajo = db.prepare(
    'SELECT * FROM productos WHERE activo = 1 AND stock_actual <= stock_minimo ORDER BY stock_actual ASC'
  ).all();

  const ultimoArqueo = db.prepare(`
    SELECT c.*, u.nombre as cajero_nombre FROM cajas c
    JOIN usuarios u ON c.cajero_id = u.id
    WHERE c.estado = 'CERRADA' ORDER BY c.cerrada_en DESC LIMIT 1
  `).get();

  const ventasPorDia = db.prepare(`
    SELECT date(fecha) as dia, COUNT(*) as cantidad, SUM(total) as total
    FROM ventas WHERE date(fecha) >= date('now','localtime','-30 days') AND anulada = 0
    GROUP BY date(fecha) ORDER BY dia
  `).all();

  const totalProductos = db.prepare('SELECT COUNT(*) as total FROM productos WHERE activo = 1').get();
  const valorInventario = db.prepare(
    'SELECT COALESCE(SUM(stock_actual * precio_compra),0) as costo, COALESCE(SUM(stock_actual * precio_venta),0) as venta FROM productos WHERE activo = 1'
  ).get();

  res.json({
    ventasHoy, ventasSemana, ventasMes,
    topProductos, stockBajo, ultimoArqueo,
    ventasPorDia, totalProductos: totalProductos.total,
    valorInventario
  });
});

router.get('/rentabilidad', verificarToken, soloAdmin, (req, res) => {
  const db = getDb();
  const productos = db.prepare(`
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
  `).all();
  res.json(productos);
});

router.get('/config', verificarToken, soloAdmin, (req, res) => {
  const db = getDb();
  const configs = db.prepare('SELECT * FROM config').all();
  const result = {};
  for (const c of configs) result[c.clave] = c.valor;
  res.json(result);
});

router.put('/config', verificarToken, soloAdmin, (req, res) => {
  const db = getDb();
  for (const [clave, valor] of Object.entries(req.body)) {
    db.prepare('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)').run(clave, valor);
  }
  db._save();
  res.json({ ok: true });
});

module.exports = router;
