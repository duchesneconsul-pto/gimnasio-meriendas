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

// PUT /usuarios/:id — actualizar usuario (solo admin)
router.put('/usuarios/:id', verificarToken, soloAdmin, (req, res) => {
  const { id } = req.params;
  const { nombre, rol, password } = req.body;

  if (!nombre || !rol) {
    return res.status(400).json({ error: 'Nombre y rol son requeridos' });
  }

  const db = getDb();
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!usuario) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  // No permitir quitar el rol admin si es el último admin activo
  if (usuario.rol === 'admin' && rol !== 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as count FROM usuarios WHERE rol = 'admin' AND activo = 1").get().count;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'No se puede quitar el rol admin al último administrador' });
    }
  }

  if (password && password.trim() !== '') {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE usuarios SET nombre = ?, rol = ?, password = ? WHERE id = ?').run(nombre, rol, hash, id);
  } else {
    db.prepare('UPDATE usuarios SET nombre = ?, rol = ? WHERE id = ?').run(nombre, rol, id);
  }

  db._save();
  res.json({ id: Number(id), nombre, rol });
});

// DELETE /usuarios/:id — desactivar usuario (solo admin)
router.delete('/usuarios/:id', verificarToken, soloAdmin, (req, res) => {
  const { id } = req.params;
  const db = getDb();

  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!usuario) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  // No permitir eliminarse a sí mismo
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
  }

  // No permitir eliminar el último admin activo
  if (usuario.rol === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as count FROM usuarios WHERE rol = 'admin' AND activo = 1").get().count;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'No se puede desactivar al último administrador' });
    }
  }

  db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(id);
  db._save();
  res.json({ message: 'Usuario desactivado' });
});

module.exports = router;
