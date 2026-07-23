const express = require('express');
const { pool } = require('../database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

router.post('/', verificarToken, async (req, res) => {
  const { items, metodo_pago } = req.body;
  if (!items || !items.length || !metodo_pago) {
    return res.status(400).json({ error: 'Items y metodo de pago requeridos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cajaResult = await client.query(
      'SELECT * FROM cajas WHERE cajero_id = $1 AND estado = $2 ORDER BY id DESC LIMIT 1',
      [req.user.id, 'ABIERTA']
    );
    const cajaAbierta = cajaResult.rows[0];
    if (!cajaAbierta) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay una caja abierta. Debe abrir caja primero.' });
    }

    let total = 0;
    for (const item of items) {
      const prodResult = await client.query('SELECT * FROM productos WHERE id = $1 AND activo = 1', [item.producto_id]);
      const producto = prodResult.rows[0];
      if (!producto) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Producto ${item.producto_id} no encontrado` }); }
      if (producto.stock_actual < item.cantidad) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Stock insuficiente de "${producto.nombre}". Disponible: ${producto.stock_actual}` });
      }
      total += producto.precio_venta * item.cantidad;
    }

    const ventaResult = await client.query(
      'INSERT INTO ventas (total, metodo_pago, cajero_id, caja_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [total, metodo_pago, req.user.id, cajaAbierta.id]
    );
    const ventaId = ventaResult.rows[0].id;

    for (const item of items) {
      const prodResult = await client.query('SELECT * FROM productos WHERE id = $1', [item.producto_id]);
      const producto = prodResult.rows[0];

      await client.query(
        'INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES ($1, $2, $3, $4, $5)',
        [ventaId, item.producto_id, item.cantidad, producto.precio_venta, producto.precio_venta * item.cantidad]
      );

      await client.query('UPDATE productos SET stock_actual = stock_actual - $1 WHERE id = $2', [item.cantidad, item.producto_id]);

      await client.query(
        'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id) VALUES ($1, $2, $3, $4, $5)',
        [item.producto_id, 'SALIDA', -item.cantidad, `Venta #${ventaId}`, req.user.id]
      );
    }

    const campo = metodo_pago === 'EFECTIVO' ? 'total_ventas_efectivo' : 'total_ventas_transferencia';
    await client.query(
      `UPDATE cajas SET ${campo} = ${campo} + $1 WHERE id = $2`,
      [total, cajaAbierta.id]
    );

    await client.query('COMMIT');

    const resultado = (await pool.query('SELECT * FROM ventas WHERE id = $1', [ventaId])).rows[0];
    resultado.detalles = (await pool.query(`
      SELECT vd.*, p.nombre as producto_nombre
      FROM venta_detalles vd JOIN productos p ON vd.producto_id = p.id
      WHERE vd.venta_id = $1
    `, [ventaId])).rows;

    res.json(resultado);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.get('/', verificarToken, async (req, res) => {
  try {
    const { fecha, caja_id, limit } = req.query;
    let sql = `
      SELECT v.*, u.nombre as cajero_nombre
      FROM ventas v
      JOIN usuarios u ON v.cajero_id = u.id
      WHERE v.anulada = 0
    `;
    const params = [];
    let idx = 1;

    if (fecha) { sql += ` AND v.fecha::date = $${idx++}`; params.push(fecha); }
    if (caja_id) { sql += ` AND v.caja_id = $${idx++}`; params.push(caja_id); }
    sql += ' ORDER BY v.fecha DESC';
    if (limit) { sql += ` LIMIT $${idx++}`; params.push(Number(limit)); }

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', verificarToken, async (req, res) => {
  try {
    const venta = (await pool.query(`
      SELECT v.*, u.nombre as cajero_nombre
      FROM ventas v JOIN usuarios u ON v.cajero_id = u.id
      WHERE v.id = $1
    `, [req.params.id])).rows[0];

    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

    venta.detalles = (await pool.query(`
      SELECT vd.*, p.nombre as producto_nombre
      FROM venta_detalles vd JOIN productos p ON vd.producto_id = p.id
      WHERE vd.venta_id = $1
    `, [req.params.id])).rows;

    res.json(venta);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/anular', verificarToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const venta = (await client.query('SELECT * FROM ventas WHERE id = $1 AND anulada = 0', [req.params.id])).rows[0];
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada o ya anulada' });

    await client.query('BEGIN');
    await client.query('UPDATE ventas SET anulada = 1 WHERE id = $1', [venta.id]);

    const detalles = (await client.query('SELECT * FROM venta_detalles WHERE venta_id = $1', [venta.id])).rows;
    for (const d of detalles) {
      await client.query('UPDATE productos SET stock_actual = stock_actual + $1 WHERE id = $2', [d.cantidad, d.producto_id]);
      await client.query(
        'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id) VALUES ($1, $2, $3, $4, $5)',
        [d.producto_id, 'ENTRADA', d.cantidad, `Anulacion venta #${venta.id}`, req.user.id]
      );
    }

    const campo = venta.metodo_pago === 'EFECTIVO' ? 'total_ventas_efectivo' : 'total_ventas_transferencia';
    await client.query(`UPDATE cajas SET ${campo} = ${campo} - $1 WHERE id = $2`, [venta.total, venta.caja_id]);

    await client.query('COMMIT');
    res.json({ mensaje: 'Venta anulada', venta_id: venta.id });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
