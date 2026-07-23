const express = require('express');
const https = require('https');
const http = require('http');
const { pool } = require('../database');
const { verificarToken } = require('../middleware/auth');

async function enviarWebhookCredito(creditoData) {
  try {
    const cfgUrl = (await pool.query("SELECT valor FROM config WHERE clave = 'webhook_credito'")).rows[0];
    const cfgNombre = (await pool.query("SELECT valor FROM config WHERE clave = 'nombre_negocio'")).rows[0];
    if (!cfgUrl || !cfgUrl.valor) return;

    const totalDeuda = (await pool.query(
      "SELECT COALESCE(SUM(saldo_pendiente), 0) as total FROM creditos WHERE nombre_cliente = $1 AND estado != 'PAGADO'",
      [creditoData.nombre_cliente]
    )).rows[0];

    const payload = JSON.stringify({
      evento: 'nuevo_credito',
      negocio: (cfgNombre && cfgNombre.valor) || 'Meriendas',
      nombre_cliente: creditoData.nombre_cliente,
      tipo_cliente: creditoData.tipo_cliente,
      monto_credito: creditoData.monto,
      deuda_total: totalDeuda.total,
      fecha: creditoData.fecha,
      notas: creditoData.notas || '',
      productos: (creditoData.detalles_venta || []).map(function(d) {
        return d.producto_nombre + ' x' + d.cantidad;
      }).join(', ')
    });

    const url = new URL(cfgUrl.valor);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    });
    req.on('error', function() {});
    req.write(payload);
    req.end();
  } catch (e) {}
}

const router = express.Router();

router.get('/', verificarToken, async (req, res) => {
  try {
    const { estado } = req.query;
    let sql = `
      SELECT c.*, u.nombre as cajero_nombre
      FROM creditos c
      JOIN usuarios u ON c.cajero_id = u.id
    `;
    const params = [];

    if (estado) {
      sql += ' WHERE c.estado = $1';
      params.push(estado);
    }

    sql += ' ORDER BY c.fecha DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/resumen', verificarToken, async (req, res) => {
  try {
    const totales = (await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN estado != 'PAGADO' THEN saldo_pendiente ELSE 0 END), 0) as total_pendiente,
        COUNT(*) as total_creditos
      FROM creditos
    `)).rows[0];

    const top_deudores = (await pool.query(`
      SELECT nombre_cliente, tipo_cliente,
        SUM(saldo_pendiente) as total_deuda,
        COUNT(*) as num_creditos
      FROM creditos
      WHERE estado != 'PAGADO'
      GROUP BY nombre_cliente, tipo_cliente
      ORDER BY total_deuda DESC
      LIMIT 10
    `)).rows;

    res.json({
      total_pendiente: totales.total_pendiente,
      total_creditos: Number(totales.total_creditos),
      top_deudores
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', verificarToken, async (req, res) => {
  try {
    const credito = (await pool.query(`
      SELECT c.*, u.nombre as cajero_nombre
      FROM creditos c
      JOIN usuarios u ON c.cajero_id = u.id
      WHERE c.id = $1
    `, [req.params.id])).rows[0];

    if (!credito) return res.status(404).json({ error: 'Credito no encontrado' });

    credito.pagos = (await pool.query(`
      SELECT pc.*, u.nombre as cajero_nombre
      FROM pagos_credito pc
      JOIN usuarios u ON pc.cajero_id = u.id
      WHERE pc.credito_id = $1
      ORDER BY pc.fecha DESC
    `, [req.params.id])).rows;

    if (credito.venta_id) {
      credito.detalles_venta = (await pool.query(`
        SELECT vd.*, p.nombre as producto_nombre
        FROM venta_detalles vd
        JOIN productos p ON vd.producto_id = p.id
        WHERE vd.venta_id = $1
      `, [credito.venta_id])).rows;
    }

    res.json(credito);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', verificarToken, async (req, res) => {
  const { nombre_cliente, tipo_cliente, monto, notas, items, caja_id } = req.body;

  if (!nombre_cliente || monto === undefined) {
    return res.status(400).json({ error: 'nombre_cliente y monto son requeridos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let ventaId = null;
    let totalVenta = 0;

    if (items && items.length > 0) {
      let cajaId = caja_id;
      if (!cajaId) {
        const cajaAbierta = (await client.query(
          'SELECT * FROM cajas WHERE cajero_id = $1 AND estado = $2 ORDER BY id DESC LIMIT 1',
          [req.user.id, 'ABIERTA']
        )).rows[0];

        if (!cajaAbierta) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'No hay una caja abierta. Debe abrir caja primero.' });
        }
        cajaId = cajaAbierta.id;
      }

      for (const item of items) {
        const producto = (await client.query('SELECT * FROM productos WHERE id = $1 AND activo = 1', [item.producto_id])).rows[0];
        if (!producto) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Producto ${item.producto_id} no encontrado` });
        }
        if (producto.stock_actual < item.cantidad) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Stock insuficiente de "${producto.nombre}". Disponible: ${producto.stock_actual}` });
        }
        totalVenta += producto.precio_venta * item.cantidad;
      }

      const ventaResult = await client.query(
        'INSERT INTO ventas (total, metodo_pago, cajero_id, caja_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [totalVenta, 'CREDITO', req.user.id, cajaId]
      );
      ventaId = ventaResult.rows[0].id;

      for (const item of items) {
        const producto = (await client.query('SELECT * FROM productos WHERE id = $1', [item.producto_id])).rows[0];

        await client.query(
          'INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES ($1, $2, $3, $4, $5)',
          [ventaId, item.producto_id, item.cantidad, producto.precio_venta, producto.precio_venta * item.cantidad]
        );

        await client.query('UPDATE productos SET stock_actual = stock_actual - $1 WHERE id = $2', [item.cantidad, item.producto_id]);

        await client.query(
          'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id) VALUES ($1, $2, $3, $4, $5)',
          [item.producto_id, 'SALIDA', -item.cantidad, `Venta a credito #${ventaId} - ${nombre_cliente}`, req.user.id]
        );
      }
    }

    const montoCredito = items && items.length > 0 ? totalVenta : monto;

    const creditoResult = await client.query(`
      INSERT INTO creditos (nombre_cliente, tipo_cliente, monto, saldo_pendiente, venta_id, cajero_id, caja_id, notas)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [
      nombre_cliente,
      tipo_cliente || 'profesor',
      montoCredito,
      montoCredito,
      ventaId,
      req.user.id,
      caja_id || null,
      notas || null
    ]);

    const creditoId = creditoResult.rows[0].id;

    await client.query('COMMIT');

    const resultado = (await pool.query(`
      SELECT c.*, u.nombre as cajero_nombre
      FROM creditos c
      JOIN usuarios u ON c.cajero_id = u.id
      WHERE c.id = $1
    `, [creditoId])).rows[0];

    if (ventaId) {
      resultado.detalles_venta = (await pool.query(`
        SELECT vd.*, p.nombre as producto_nombre
        FROM venta_detalles vd
        JOIN productos p ON vd.producto_id = p.id
        WHERE vd.venta_id = $1
      `, [ventaId])).rows;
    }

    enviarWebhookCredito(resultado);
    res.json(resultado);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.post('/:id/pago', verificarToken, async (req, res) => {
  const { monto, metodo_pago } = req.body;

  if (!monto || !metodo_pago) {
    return res.status(400).json({ error: 'monto y metodo_pago son requeridos' });
  }

  if (!['EFECTIVO', 'TRANSFERENCIA'].includes(metodo_pago)) {
    return res.status(400).json({ error: 'metodo_pago debe ser EFECTIVO o TRANSFERENCIA' });
  }

  const client = await pool.connect();
  try {
    const credito = (await client.query('SELECT * FROM creditos WHERE id = $1', [req.params.id])).rows[0];
    if (!credito) return res.status(404).json({ error: 'Credito no encontrado' });
    if (credito.estado === 'PAGADO') return res.status(400).json({ error: 'Este credito ya esta pagado' });

    if (monto > credito.saldo_pendiente) {
      return res.status(400).json({ error: `El monto excede el saldo pendiente de ${credito.saldo_pendiente}` });
    }

    await client.query('BEGIN');

    await client.query(
      'INSERT INTO pagos_credito (credito_id, monto, metodo_pago, cajero_id) VALUES ($1, $2, $3, $4)',
      [req.params.id, monto, metodo_pago, req.user.id]
    );

    const nuevoSaldo = credito.saldo_pendiente - monto;
    const nuevoEstado = nuevoSaldo === 0 ? 'PAGADO' : 'PARCIAL';

    await client.query(
      'UPDATE creditos SET saldo_pendiente = $1, estado = $2 WHERE id = $3',
      [nuevoSaldo, nuevoEstado, req.params.id]
    );

    await client.query('COMMIT');

    const resultado = (await pool.query(`
      SELECT c.*, u.nombre as cajero_nombre
      FROM creditos c
      JOIN usuarios u ON c.cajero_id = u.id
      WHERE c.id = $1
    `, [req.params.id])).rows[0];

    resultado.pagos = (await pool.query(`
      SELECT pc.*, u.nombre as cajero_nombre
      FROM pagos_credito pc
      JOIN usuarios u ON pc.cajero_id = u.id
      WHERE pc.credito_id = $1
      ORDER BY pc.fecha DESC
    `, [req.params.id])).rows;

    res.json(resultado);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
