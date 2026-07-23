const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../database');
const { generarToken, verificarToken, soloAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE usuario = $1 AND activo = 1', [usuario]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const token = generarToken(user);
    res.json({
      token,
      usuario: { id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', verificarToken, (req, res) => {
  res.json(req.user);
});

router.get('/usuarios', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, nombre, usuario, rol, activo, creado_en FROM usuarios');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/usuarios', verificarToken, soloAdmin, async (req, res) => {
  const { nombre, usuario, password, rol } = req.body;
  if (!nombre || !usuario || !password || !rol) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO usuarios (nombre, usuario, password, rol) VALUES ($1, $2, $3, $4) RETURNING id',
      [nombre, usuario, hash, rol]
    );
    res.json({ id: rows[0].id, nombre, usuario, rol });
  } catch (e) {
    res.status(400).json({ error: 'El usuario ya existe' });
  }
});

router.put('/usuarios/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;
  const { nombre, rol, password } = req.body;

  if (!nombre || !rol) {
    return res.status(400).json({ error: 'Nombre y rol son requeridos' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    const usuario = rows[0];
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (usuario.rol === 'admin' && rol !== 'admin') {
      const countResult = await pool.query("SELECT COUNT(*) as count FROM usuarios WHERE rol = 'admin' AND activo = 1");
      if (Number(countResult.rows[0].count) <= 1) {
        return res.status(400).json({ error: 'No se puede quitar el rol admin al último administrador' });
      }
    }

    if (password && password.trim() !== '') {
      const hash = bcrypt.hashSync(password, 10);
      await pool.query('UPDATE usuarios SET nombre = $1, rol = $2, password = $3 WHERE id = $4', [nombre, rol, hash, id]);
    } else {
      await pool.query('UPDATE usuarios SET nombre = $1, rol = $2 WHERE id = $3', [nombre, rol, id]);
    }

    res.json({ id: Number(id), nombre, rol });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/usuarios/:id', verificarToken, soloAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
    const usuario = rows[0];
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (Number(id) === req.user.id) {
      return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
    }

    if (usuario.rol === 'admin') {
      const countResult = await pool.query("SELECT COUNT(*) as count FROM usuarios WHERE rol = 'admin' AND activo = 1");
      if (Number(countResult.rows[0].count) <= 1) {
        return res.status(400).json({ error: 'No se puede desactivar al último administrador' });
      }
    }

    await pool.query('UPDATE usuarios SET activo = 0 WHERE id = $1', [id]);
    res.json({ message: 'Usuario desactivado' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
