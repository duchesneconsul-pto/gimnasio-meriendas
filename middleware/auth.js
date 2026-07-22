const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'gimnasio-meriendas-secret-2026';

function generarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, usuario: usuario.usuario, rol: usuario.rol, nombre: usuario.nombre },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function verificarToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function soloAdmin(req, res, next) {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso solo para administradores' });
  }
  next();
}

module.exports = { generarToken, verificarToken, soloAdmin, JWT_SECRET };
