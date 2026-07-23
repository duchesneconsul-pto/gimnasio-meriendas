const express = require('express');
const fs = require('fs');
const { getDb, DB_PATH } = require('../database');
const { verificarToken, soloAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/descargar', verificarToken, soloAdmin, (req, res) => {
  const db = getDb();
  db._save();
  if (!fs.existsSync(DB_PATH)) {
    return res.status(404).json({ error: 'No se encontro la base de datos' });
  }
  res.setHeader('Content-Disposition', 'attachment; filename=meriendas_backup_' + new Date().toISOString().slice(0,10) + '.db');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(fs.readFileSync(DB_PATH));
});

router.post('/restaurar', verificarToken, soloAdmin, (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'No se recibieron datos del backup' });

  try {
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length < 100) return res.status(400).json({ error: 'Archivo de backup invalido' });

    const header = buffer.slice(0, 16).toString('ascii');
    if (!header.startsWith('SQLite format')) {
      return res.status(400).json({ error: 'El archivo no es una base de datos SQLite valida' });
    }

    fs.writeFileSync(DB_PATH, buffer);
    res.json({ ok: true, message: 'Backup restaurado. Reinicie el servidor para aplicar los cambios.' });
  } catch (e) {
    res.status(400).json({ error: 'Error al restaurar: ' + e.message });
  }
});

router.get('/info', verificarToken, soloAdmin, (req, res) => {
  const db = getDb();
  const productos = db.prepare('SELECT COUNT(*) as c FROM productos').get().c;
  const usuarios = db.prepare('SELECT COUNT(*) as c FROM usuarios').get().c;
  const ventas = db.prepare('SELECT COUNT(*) as c FROM ventas').get().c;
  const creditos = db.prepare('SELECT COUNT(*) as c FROM creditos').get().c;
  const size = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;

  res.json({
    productos, usuarios, ventas, creditos,
    tamano: (size / 1024).toFixed(1) + ' KB',
    ruta: DB_PATH,
    persistente: !!process.env.DB_DIR
  });
});

module.exports = router;
