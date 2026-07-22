const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { generarToken, verificarToken, soloAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(usuario);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const token = generarToken(user);
  res.json({
    token,
    usuario: { id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol }
  });
});

router.get('/me', verificarToken, (req, res) => {
  res.json(req.user);
});

router.get('/usuarios', verificarToken, soloAdmin, (req, res) => {
  const db = getDb();
  const usuarios = db.prepare('SELECT id, nombre, usuario, rol, activo, creado_en FROM usuarios').all();
  res.json(usuarios);
});

router.post('/usuarios', verificarToken, soloAdmin, (req, res) => {
  const { nombre, usuario, password, rol } = req.body;
  if (!nombre || !usuario || !password || !rol) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  const db = getDb();
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = db.prepare('INSERT INTO usuarios (nombre, usuario, password, rol) VALUES (?, ?, ?, ?)').run(nombre, usuario, hash, rol);
    db._save();
    res.json({ id: result.lastInsertRowid, nombre, usuario, rol });
  } catch (e) {
    res.status(400).json({ error: 'El usuario ya existe' });
  }
});

module.exports = router;
