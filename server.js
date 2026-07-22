const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://assets.cdn.filesafe.space"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiados intentos de login. Intente en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Demasiadas solicitudes. Intente en un momento.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/pos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pos.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

async function start() {
  await initDb();

  app.use('/api/auth/login', loginLimiter);
  app.use('/api', apiLimiter);

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/productos', require('./routes/productos'));
  app.use('/api/inventario', require('./routes/inventario'));
  app.use('/api/ventas', require('./routes/ventas'));
  app.use('/api/caja', require('./routes/caja'));
  app.use('/api/reportes', require('./routes/reportes'));
  app.use('/api/creditos', require('./routes/creditos'));

  app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Sistema de Meriendas - Gimnasio Campestre`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  Servidor:  http://localhost:${PORT}`);
    console.log(`  POS:       http://localhost:${PORT}/pos`);
    console.log(`  Admin:     http://localhost:${PORT}/admin\n`);
  });
}

start().catch(e => { console.error('Error al iniciar:', e); process.exit(1); });
