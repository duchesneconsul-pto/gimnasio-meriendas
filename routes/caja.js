const express = require('express');
const { getDb } = require('../database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

router.post('/abrir', verificarToken, (req, res) => {
  const { monto_apertura } = req.body;
  const db = getDb();

  const cajaAbierta = db.prepare(
    'SELECT * FROM cajas WHERE cajero_id = ? AND estado = ?'
  ).get(req.user.id, 'ABIERTA');

  if (cajaAbierta) {
    return res.status(400).json({ error: 'Ya tiene una caja abierta. Cierrela primero.' });
  }

  const result = db.prepare(
    'INSERT INTO cajas (monto_apertura, cajero_id) VALUES (?, ?)'
  ).run(monto_apertura || 0, req.user.id);
  db._save();

  const caja = db.prepare('SELECT * FROM cajas WHERE id = ?').get(result.lastInsertRowid);
  res.json(caja);
});

router.post('/cerrar', verificarToken, (req, res) => {
  const { monto_cierre_real, notas } = req.body;
  if (monto_cierre_real === undefined) {
    return res.status(400).json({ error: 'Debe ingresar el monto real en caja' });
  }

  const db = getDb();
  const caja = db.prepare(
    'SELECT * FROM cajas WHERE cajero_id = ? AND estado = ? ORDER BY id DESC LIMIT 1'
  ).get(req.user.id, 'ABIERTA');

  if (!caja) return res.status(400).json({ error: 'No hay caja abierta' });

  const esperado = caja.monto_apertura + caja.total_ventas_efectivo;
  const diferencia = monto_cierre_real - esperado;

  db.prepare(`
    UPDATE cajas SET
      monto_cierre_real = ?, monto_cierre_esperado = ?, diferencia = ?,
      estado = 'CERRADA', notas = ?, cerrada_en = datetime('now','localtime')
    WHERE id = ?
  `).run(monto_cierre_real, esperado, diferencia, notas || null, caja.id);
  db._save();

  const cajaCerrada = db.prepare('SELECT * FROM cajas WHERE id = ?').get(caja.id);

  const ventas = db.prepare(`
    SELECT COUNT(*) as total_ventas, COALESCE(SUM(total),0) as monto_total
    FROM ventas WHERE caja_id = ? AND anulada = 0
  `).get(caja.id);

  const topProductos = db.prepare(`
    SELECT p.nombre, SUM(vd.cantidad) as unidades, SUM(vd.subtotal) as total
    FROM venta_detalles vd
    JOIN ventas v ON vd.venta_id = v.id
    JOIN productos p ON vd.producto_id = p.id
    WHERE v.caja_id = ? AND v.anulada = 0
    GROUP BY vd.producto_id
    ORDER BY unidades DESC LIMIT 5
  `).all(caja.id);

  const stockBajo = db.prepare(
    'SELECT nombre, stock_actual, stock_minimo FROM productos WHERE activo = 1 AND stock_actual <= stock_minimo'
  ).all();

  const resumen = { caja: cajaCerrada, ventas, topProductos, stockBajo };

  triggerWebhook(db, resumen);

  res.json(resumen);
});

router.get('/actual', verificarToken, (req, res) => {
  const db = getDb();
  const caja = db.prepare(
    'SELECT * FROM cajas WHERE cajero_id = ? AND estado = ? ORDER BY id DESC LIMIT 1'
  ).get(req.user.id, 'ABIERTA');

  if (!caja) return res.json({ abierta: false });

  const ventas = db.prepare(`
    SELECT COUNT(*) as total_ventas, COALESCE(SUM(total),0) as monto_total
    FROM ventas WHERE caja_id = ? AND anulada = 0
  `).get(caja.id);

  res.json({ abierta: true, caja, ventas });
});

router.get('/historial', verificarToken, (req, res) => {
  const db = getDb();
  const { limit, fecha_desde, fecha_hasta } = req.query;
  let sql = `
    SELECT c.*, u.nombre as cajero_nombre,
      (SELECT COUNT(*) FROM ventas WHERE caja_id = c.id AND anulada = 0) as num_ventas
    FROM cajas c
    JOIN usuarios u ON c.cajero_id = u.id
    WHERE c.estado = 'CERRADA'
  `;
  const params = [];
  if (fecha_desde) { sql += ' AND c.fecha >= ?'; params.push(fecha_desde); }
  if (fecha_hasta) { sql += ' AND c.fecha <= ?'; params.push(fecha_hasta); }
  sql += ' ORDER BY c.cerrada_en DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }

  res.json(db.prepare(sql).all(...params));
});

function triggerWebhook(db, resumen) {
  const config = db.prepare("SELECT valor FROM config WHERE clave = 'webhook_url'").get();
  if (!config || !config.valor) return;

  const payload = {
    evento: 'cierre_caja',
    fecha: resumen.caja.fecha,
    total_vendido: resumen.ventas.monto_total || 0,
    num_ventas: resumen.ventas.total_ventas || 0,
    efectivo: resumen.caja.total_ventas_efectivo,
    transferencia: resumen.caja.total_ventas_transferencia,
    monto_apertura: resumen.caja.monto_apertura,
    monto_cierre_real: resumen.caja.monto_cierre_real,
    monto_esperado: resumen.caja.monto_cierre_esperado,
    diferencia: resumen.caja.diferencia,
    cuadra: Math.abs(resumen.caja.diferencia) < 1,
    top_productos: resumen.topProductos,
    stock_bajo: resumen.stockBajo,
    notas: resumen.caja.notas
  };

  fetch(config.valor, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

module.exports = router;
