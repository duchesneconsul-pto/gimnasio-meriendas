const express = require('express');
const { pool } = require('../database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

router.post('/abrir', verificarToken, async (req, res) => {
  const { monto_apertura } = req.body;
  try {
    const cajaAbierta = (await pool.query(
      'SELECT * FROM cajas WHERE cajero_id = $1 AND estado = $2', [req.user.id, 'ABIERTA']
    )).rows[0];

    if (cajaAbierta) {
      return res.status(400).json({ error: 'Ya tiene una caja abierta. Cierrela primero.' });
    }

    const { rows } = await pool.query(
      'INSERT INTO cajas (monto_apertura, cajero_id) VALUES ($1, $2) RETURNING *',
      [monto_apertura || 0, req.user.id]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/cerrar', verificarToken, async (req, res) => {
  const { monto_cierre_real, notas } = req.body;
  if (monto_cierre_real === undefined) {
    return res.status(400).json({ error: 'Debe ingresar el monto real en caja' });
  }

  try {
    const caja = (await pool.query(
      'SELECT * FROM cajas WHERE cajero_id = $1 AND estado = $2 ORDER BY id DESC LIMIT 1',
      [req.user.id, 'ABIERTA']
    )).rows[0];

    if (!caja) return res.status(400).json({ error: 'No hay caja abierta' });

    const esperado = caja.monto_apertura + caja.total_ventas_efectivo;
    const diferencia = monto_cierre_real - esperado;

    await pool.query(`
      UPDATE cajas SET
        monto_cierre_real = $1, monto_cierre_esperado = $2, diferencia = $3,
        estado = 'CERRADA', notas = $4, cerrada_en = NOW()
      WHERE id = $5
    `, [monto_cierre_real, esperado, diferencia, notas || null, caja.id]);

    const cajaCerrada = (await pool.query('SELECT * FROM cajas WHERE id = $1', [caja.id])).rows[0];

    const ventas = (await pool.query(`
      SELECT COUNT(*) as total_ventas, COALESCE(SUM(total),0) as monto_total
      FROM ventas WHERE caja_id = $1 AND anulada = 0
    `, [caja.id])).rows[0];

    const topProductos = (await pool.query(`
      SELECT p.nombre, SUM(vd.cantidad) as unidades, SUM(vd.subtotal) as total
      FROM venta_detalles vd
      JOIN ventas v ON vd.venta_id = v.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE v.caja_id = $1 AND v.anulada = 0
      GROUP BY vd.producto_id, p.nombre
      ORDER BY unidades DESC LIMIT 5
    `, [caja.id])).rows;

    const stockBajo = (await pool.query(
      'SELECT nombre, stock_actual, stock_minimo FROM productos WHERE activo = 1 AND stock_actual <= stock_minimo'
    )).rows;

    const resumen = { caja: cajaCerrada, ventas, topProductos, stockBajo };
    triggerWebhook(resumen);
    res.json(resumen);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/actual', verificarToken, async (req, res) => {
  try {
    const caja = (await pool.query(
      'SELECT * FROM cajas WHERE cajero_id = $1 AND estado = $2 ORDER BY id DESC LIMIT 1',
      [req.user.id, 'ABIERTA']
    )).rows[0];

    if (!caja) return res.json({ abierta: false });

    const ventas = (await pool.query(`
      SELECT COUNT(*) as total_ventas, COALESCE(SUM(total),0) as monto_total
      FROM ventas WHERE caja_id = $1 AND anulada = 0
    `, [caja.id])).rows[0];

    res.json({ abierta: true, caja, ventas });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/historial', verificarToken, async (req, res) => {
  try {
    const { limit, fecha_desde, fecha_hasta } = req.query;
    let sql = `
      SELECT c.*, u.nombre as cajero_nombre,
        (SELECT COUNT(*) FROM ventas WHERE caja_id = c.id AND anulada = 0) as num_ventas
      FROM cajas c
      JOIN usuarios u ON c.cajero_id = u.id
      WHERE c.estado = 'CERRADA'
    `;
    const params = [];
    let idx = 1;
    if (fecha_desde) { sql += ` AND c.fecha >= $${idx++}`; params.push(fecha_desde); }
    if (fecha_hasta) { sql += ` AND c.fecha <= $${idx++}`; params.push(fecha_hasta); }
    sql += ' ORDER BY c.cerrada_en DESC';
    if (limit) { sql += ` LIMIT $${idx++}`; params.push(Number(limit)); }

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function triggerWebhook(resumen) {
  try {
    const config = (await pool.query("SELECT valor FROM config WHERE clave = 'webhook_url'")).rows[0];
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
  } catch (e) {}
}

module.exports = router;
