const express = require('express');
const https = require('https');
const http = require('http');
const { getDb } = require('../database');
const { verificarToken } = require('../middleware/auth');

function enviarWebhookCredito(creditoData) {
  const db = getDb();
  const cfgUrl = db.prepare("SELECT valor FROM config WHERE clave = 'webhook_credito'").get();
  const cfgNombre = db.prepare("SELECT valor FROM config WHERE clave = 'nombre_negocio'").get();
  if (!cfgUrl || !cfgUrl.valor) return;

  const totalDeuda = db.prepare(
    "SELECT COALESCE(SUM(saldo_pendiente), 0) as total FROM creditos WHERE nombre_cliente = ? AND estado != 'PAGADO'"
  ).get(creditoData.nombre_cliente);

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

  try {
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

// GET / — list all credits
router.get('/', verificarToken, (req, res) => {
  const db = getDb();
  const { estado } = req.query;

  let sql = `
    SELECT c.*, u.nombre as cajero_nombre
    FROM creditos c
    JOIN usuarios u ON c.cajero_id = u.id
  `;
  const params = [];

  if (estado) {
    sql += ' WHERE c.estado = ?';
    params.push(estado);
  }

  sql += ' ORDER BY c.fecha DESC';

  res.json(db.prepare(sql).all(...params));
});

// GET /resumen — summary of credits
router.get('/resumen', verificarToken, (req, res) => {
  const db = getDb();

  const totales = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN estado != 'PAGADO' THEN saldo_pendiente ELSE 0 END), 0) as total_pendiente,
      COUNT(*) as total_creditos
    FROM creditos
  `).get();

  const top_deudores = db.prepare(`
    SELECT nombre_cliente, tipo_cliente,
      SUM(saldo_pendiente) as total_deuda,
      COUNT(*) as num_creditos
    FROM creditos
    WHERE estado != 'PAGADO'
    GROUP BY nombre_cliente
    ORDER BY total_deuda DESC
    LIMIT 10
  `).all();

  res.json({
    total_pendiente: totales.total_pendiente,
    total_creditos: totales.total_creditos,
    top_deudores
  });
});

// GET /:id — credit detail with payments
router.get('/:id', verificarToken, (req, res) => {
  const db = getDb();
  const credito = db.prepare(`
    SELECT c.*, u.nombre as cajero_nombre
    FROM creditos c
    JOIN usuarios u ON c.cajero_id = u.id
    WHERE c.id = ?
  `).get(Number(req.params.id));

  if (!credito) return res.status(404).json({ error: 'Credito no encontrado' });

  credito.pagos = db.prepare(`
    SELECT pc.*, u.nombre as cajero_nombre
    FROM pagos_credito pc
    JOIN usuarios u ON pc.cajero_id = u.id
    WHERE pc.credito_id = ?
    ORDER BY pc.fecha DESC
  `).all(Number(req.params.id));

  if (credito.venta_id) {
    credito.detalles_venta = db.prepare(`
      SELECT vd.*, p.nombre as producto_nombre
      FROM venta_detalles vd
      JOIN productos p ON vd.producto_id = p.id
      WHERE vd.venta_id = ?
    `).all(credito.venta_id);
  }

  res.json(credito);
});

// POST / — create a new credit
router.post('/', verificarToken, (req, res) => {
  const { nombre_cliente, tipo_cliente, monto, notas, items, caja_id } = req.body;

  if (!nombre_cliente || monto === undefined) {
    return res.status(400).json({ error: 'nombre_cliente y monto son requeridos' });
  }

  const db = getDb();

  try {
    db.exec('BEGIN TRANSACTION');

    let ventaId = null;
    let totalVenta = 0;

    // If items are provided, create a venta record
    if (items && items.length > 0) {
      // Determine caja: use provided caja_id or find open one
      let cajaId = caja_id;
      if (!cajaId) {
        const cajaAbierta = db.prepare(
          'SELECT * FROM cajas WHERE cajero_id = ? AND estado = ? ORDER BY id DESC LIMIT 1'
        ).get(req.user.id, 'ABIERTA');

        if (!cajaAbierta) {
          db.exec('ROLLBACK');
          return res.status(400).json({ error: 'No hay una caja abierta. Debe abrir caja primero.' });
        }
        cajaId = cajaAbierta.id;
      }

      // Validate stock and calculate total
      for (const item of items) {
        const producto = db.prepare('SELECT * FROM productos WHERE id = ? AND activo = 1').get(item.producto_id);
        if (!producto) {
          db.exec('ROLLBACK');
          return res.status(400).json({ error: `Producto ${item.producto_id} no encontrado` });
        }
        if (producto.stock_actual < item.cantidad) {
          db.exec('ROLLBACK');
          return res.status(400).json({ error: `Stock insuficiente de "${producto.nombre}". Disponible: ${producto.stock_actual}` });
        }
        totalVenta += producto.precio_venta * item.cantidad;
      }

      // Create venta with metodo_pago CREDITO
      const venta = db.prepare(
        'INSERT INTO ventas (total, metodo_pago, cajero_id, caja_id) VALUES (?, ?, ?, ?)'
      ).run(totalVenta, 'CREDITO', req.user.id, cajaId);

      ventaId = venta.lastInsertRowid;

      // Create venta_detalles and update stock
      for (const item of items) {
        const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);

        db.prepare(
          'INSERT INTO venta_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)'
        ).run(ventaId, item.producto_id, item.cantidad, producto.precio_venta, producto.precio_venta * item.cantidad);

        db.prepare('UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?').run(item.cantidad, item.producto_id);

        db.prepare(
          'INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)'
        ).run(item.producto_id, 'SALIDA', -item.cantidad, `Venta a credito #${ventaId} - ${nombre_cliente}`, req.user.id);
      }
    }

    const montoCredito = items && items.length > 0 ? totalVenta : monto;

    // Create the credit record
    const credito = db.prepare(`
      INSERT INTO creditos (nombre_cliente, tipo_cliente, monto, saldo_pendiente, venta_id, cajero_id, caja_id, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nombre_cliente,
      tipo_cliente || 'profesor',
      montoCredito,
      montoCredito,
      ventaId,
      req.user.id,
      caja_id || null,
      notas || null
    );

    const creditoId = credito.lastInsertRowid;

    db.exec('COMMIT');
    db._save();

    const resultado = db.prepare(`
      SELECT c.*, u.nombre as cajero_nombre
      FROM creditos c
      JOIN usuarios u ON c.cajero_id = u.id
      WHERE c.id = ?
    `).get(creditoId);

    if (ventaId) {
      resultado.detalles_venta = db.prepare(`
        SELECT vd.*, p.nombre as producto_nombre
        FROM venta_detalles vd
        JOIN productos p ON vd.producto_id = p.id
        WHERE vd.venta_id = ?
      `).all(ventaId);
    }

    enviarWebhookCredito(resultado);

    res.json(resultado);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (re) {}
    res.status(400).json({ error: e.message });
  }
});

// POST /:id/pago — register a payment on a credit
router.post('/:id/pago', verificarToken, (req, res) => {
  const { monto, metodo_pago } = req.body;

  if (!monto || !metodo_pago) {
    return res.status(400).json({ error: 'monto y metodo_pago son requeridos' });
  }

  if (!['EFECTIVO', 'TRANSFERENCIA'].includes(metodo_pago)) {
    return res.status(400).json({ error: 'metodo_pago debe ser EFECTIVO o TRANSFERENCIA' });
  }

  const db = getDb();
  const credito = db.prepare('SELECT * FROM creditos WHERE id = ?').get(Number(req.params.id));

  if (!credito) return res.status(404).json({ error: 'Credito no encontrado' });
  if (credito.estado === 'PAGADO') return res.status(400).json({ error: 'Este credito ya esta pagado' });

  if (monto > credito.saldo_pendiente) {
    return res.status(400).json({ error: `El monto excede el saldo pendiente de ${credito.saldo_pendiente}` });
  }

  try {
    db.exec('BEGIN TRANSACTION');

    // Insert payment record
    db.prepare(
      'INSERT INTO pagos_credito (credito_id, monto, metodo_pago, cajero_id) VALUES (?, ?, ?, ?)'
    ).run(Number(req.params.id), monto, metodo_pago, req.user.id);

    // Update credit balance
    const nuevoSaldo = credito.saldo_pendiente - monto;
    const nuevoEstado = nuevoSaldo === 0 ? 'PAGADO' : 'PARCIAL';

    db.prepare(
      'UPDATE creditos SET saldo_pendiente = ?, estado = ? WHERE id = ?'
    ).run(nuevoSaldo, nuevoEstado, Number(req.params.id));

    db.exec('COMMIT');
    db._save();

    const resultado = db.prepare(`
      SELECT c.*, u.nombre as cajero_nombre
      FROM creditos c
      JOIN usuarios u ON c.cajero_id = u.id
      WHERE c.id = ?
    `).get(Number(req.params.id));

    resultado.pagos = db.prepare(`
      SELECT pc.*, u.nombre as cajero_nombre
      FROM pagos_credito pc
      JOIN usuarios u ON pc.cajero_id = u.id
      WHERE pc.credito_id = ?
      ORDER BY pc.fecha DESC
    `).all(Number(req.params.id));

    res.json(resultado);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (re) {}
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
