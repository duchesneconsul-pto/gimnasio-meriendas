const express = require('express');
const { getDb } = require('../database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

router.post('/', verificarToken, (req, res) => {
  const { items, metodo_pago } = req.body;
  if (!items || !items.length || !metodo_pago) {
    return res.status(400).json({ error: 'Items y metodo de pago requeridos' });
  }

  const db = getDb();

  const cajaAbierta = db.prepare(
    'SELECT * FROM cajas WHERE cajero_id = ? AND estado = ? ORDER BY id DESC LIMIT 1'
  ).get(req.user.id, 'ABIERTA');

  if (!cajaAbierta) {
    return res.status(400).json({ error: 'No hay una caja abierta. Debe abrir caja primero.' });
  }

  try {
    db.exec('BEGIN TRANSACTION');

    let total = 0;
    for (const item of items) {
      const producto = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1').get(item.producto_id);
      if (!producto) { db.exec('ROLLBACK'); return res.status(400).json({ error: `Producto ${item.producto_id} no encontrado` }); }
      if (producto.stock_actual < item.cantidad) {
        db.exec('ROLLBACK');
        return res.status(400).json({ error: `Stock insuficiente de "${producto.nombre}". Disponible: ${producto.stock_actual}` });
      }
      total += producto.precio_venta * item.cantidad;
    }

    const venta = db.prepare(
      'INSERT INTO ventas (total, metodo_pago, cajero_id, caja_id) VALUES (?, ?, ?, ?)'
    ).run(total, metodo_pago, req.user.id, cajaAbierta.id);

    const ventaId = venta.lastInsertRowid;

    for (const item of items) {
      const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);

      db.prepare(
        'INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)'
      ).run(ventaId, item.producto_id, item.cantidad, producto.precio_venta, producto.precio_venta * item.cantidad);

      db.prepare('UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?').run(item.cantidad, item.producto_id);

      db.prepare(
        'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)'
      ).run(item.producto_id, 'SALIDA', -item.cantidad, `Venta #${ventaId}`, req.user.id);
    }

    const campo = metodo_pago === 'EFECTIVO' ? 'total_ventas_efectivo' : 'total_ventas_transferencia';
    db.exec(`UPDATE cajas SET ${campo} = ${campo} + ${total} WHERE id = ${cajaAbierta.id}`);

    db.exec('COMMIT');
    db._save();

    const resultado = db.prepare('SELECT * FROM ventas WHERE id = ?').get(ventaId);
    resultado.detalles = db.prepare(`
      SELECT vd.*, p.nombre as producto_nombre
      FROM venta_detalles vd JOIN productos p ON vd.producto_id = p.id
      WHERE vd.venta_id = ?
    `).all(ventaId);

    res.json(resultado);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch(re) {}
    res.status(400).json({ error: e.message });
  }
});

router.get('/', verificarToken, (req, res) => {
  const db = getDb();
  const { fecha, caja_id, limit } = req.query;
  let sql = `
    SELECT v.*, u.nombre as cajero_nombre
    FROM ventas v
    JOIN usuarios u ON v.cajero_id = u.id
    WHERE v.anulada = 0
  `;
  const params = [];

  if (fecha) { sql += " AND date(v.fecha) = ?"; params.push(fecha); }
  if (caja_id) { sql += ' AND v.caja_id = ?'; params.push(caja_id); }
  sql += ' ORDER BY v.fecha DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }

  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', verificarToken, (req, res) => {
  const db = getDb();
  const venta = db.prepare(`
    SELECT v.*, u.nombre as cajero_nombre
    FROM ventas v JOIN usuarios u ON v.cajero_id = u.id
    WHERE v.id = ?
  `).get(Number(req.params.id));

  if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

  venta.detalles = db.prepare(`
    SELECT vd.*, p.nombre as producto_nombre
    FROM venta_detalles vd JOIN productos p ON vd.producto_id = p.id
    WHERE vd.venta_id = ?
  `).all(Number(req.params.id));

  res.json(venta);
});

router.post('/:id/anular', verificarToken, (req, res) => {
  const db = getDb();
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ? AND anulada = 0').get(Number(req.params.id));
  if (!venta) return res.status(404).json({ error: 'Venta no encontrada o ya anulada' });

  try {
    db.exec('BEGIN TRANSACTION');
    db.prepare('UPDATE ventas SET anulada = 1 WHERE id = ?').run(venta.id);

    const detalles = db.prepare('SELECT * FROM venta_detalles WHERE venta_id = ?').all(venta.id);
    for (const d of detalles) {
      db.prepare('UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?').run(d.cantidad, d.producto_id);
      db.prepare(
        'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)'
      ).run(d.producto_id, 'ENTRADA', d.cantidad, `Anulacion venta #${venta.id}`, req.user.id);
    }

    const campo = venta.metodo_pago === 'EFECTIVO' ? 'total_ventas_efectivo' : 'total_ventas_transferencia';
    db.exec(`UPDATE cajas SET ${campo} = ${campo} - ${venta.total} WHERE id = ${venta.caja_id}`);

    db.exec('COMMIT');
    db._save();
    res.json({ mensaje: 'Venta anulada', venta_id: venta.id });
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch(re) {}
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
