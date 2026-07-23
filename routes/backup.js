const express = require('express');
const { pool } = require('../database');
const { verificarToken, soloAdmin } = require('../middleware/auth');

const router = express.Router();

const TABLES = ['usuarios', 'productos', 'movimientos_inventario', 'cajas', 'ventas', 'venta_detalles', 'config', 'creditos', 'pagos_credito'];

router.get('/descargar', verificarToken, soloAdmin, async (req, res) => {
  try {
    const backup = {};
    for (const table of TABLES) {
      const { rows } = await pool.query(`SELECT * FROM ${table}`);
      backup[table] = rows;
    }
    const json = JSON.stringify(backup, null, 2);
    res.setHeader('Content-Disposition', 'attachment; filename=meriendas_backup_' + new Date().toISOString().slice(0,10) + '.json');
    res.setHeader('Content-Type', 'application/json');
    res.send(json);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/restaurar', verificarToken, soloAdmin, async (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'No se recibieron datos del backup' });

  const client = await pool.connect();
  try {
    let backup;
    if (typeof data === 'string') {
      const decoded = Buffer.from(data, 'base64').toString('utf8');
      backup = JSON.parse(decoded);
    } else {
      backup = data;
    }

    if (!backup.usuarios || !backup.productos) {
      return res.status(400).json({ error: 'Archivo de backup invalido' });
    }

    await client.query('BEGIN');

    const reverseOrder = [...TABLES].reverse();
    for (const table of reverseOrder) {
      await client.query(`DELETE FROM ${table}`);
    }

    for (const table of TABLES) {
      const rows = backup[table];
      if (!rows || rows.length === 0) continue;

      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = cols.map((_, i) => '$' + (i + 1));
        await client.query(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${vals.join(',')})`,
          cols.map(c => row[c])
        );
      }

      if (backup[table].length > 0 && backup[table][0].id !== undefined) {
        const maxId = Math.max(...backup[table].map(r => r.id));
        await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), $1, true)`, [maxId]);
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true, message: 'Backup restaurado exitosamente.' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: 'Error al restaurar: ' + e.message });
  } finally {
    client.release();
  }
});

router.get('/info', verificarToken, soloAdmin, async (req, res) => {
  try {
    const productos = (await pool.query('SELECT COUNT(*) as c FROM productos')).rows[0].c;
    const usuarios = (await pool.query('SELECT COUNT(*) as c FROM usuarios')).rows[0].c;
    const ventas = (await pool.query('SELECT COUNT(*) as c FROM ventas')).rows[0].c;
    const creditos = (await pool.query('SELECT COUNT(*) as c FROM creditos')).rows[0].c;

    const sizeResult = (await pool.query("SELECT pg_database_size(current_database()) as size")).rows[0];
    const sizeKB = (Number(sizeResult.size) / 1024).toFixed(1);

    res.json({
      productos: Number(productos),
      usuarios: Number(usuarios),
      ventas: Number(ventas),
      creditos: Number(creditos),
      tamano: sizeKB + ' KB',
      persistente: true
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
