const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { pool, verifyConnection } = require('./config/db');
const { verifyStorage } = require('./config/storage');
const { swaggerUi, swaggerDocument } = require('./config/swagger');
const { createAuthRoutes } = require('./routes/auth.route');
const { createCustomerRoutes } = require('./routes/customer.route');
const { createSaleRoutes } = require('./routes/sale.route');
const { createProtect, restrictTo } = require('./middlewares/auth.middleware');

const { composeAuth } = require('./service/auth.service');

const auth = composeAuth(pool, process.env.JWT_SECRET);
const protect = createProtect(auth);
const app = express();
const PORT = process.env.PORT || 3000;

// Security: HTTP headers protection
app.use(helmet());

// Security: CORS policy
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-device-id'],
}));

// Security: Rate limiting
const skipInTest = () => process.env.NODE_ENV === 'test';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { success: false, message: 'تم تجاوز الحد المسموح من الطلبات، يرجى المحاولة لاحقاً' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { success: false, message: 'محاولات دخول كثيرة جداً، يرجى الانتظار 15 دقيقة والمحاولة لاحقاً' },
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Alex Project API' });
});

// Apply API Rate Limiter
app.use('/api', apiLimiter);

app.use('/api/auth', createAuthRoutes(auth, authLimiter));
app.use('/api/customers', createCustomerRoutes(pool, protect));
app.use('/api/sales', createSaleRoutes(pool, protect));

app.get('/api/profile', protect, (req, res) => {
  res.json({
    message: 'تم التحقق من التوكين وبصمة الجهاز بنجاح',
    user: req.user,
  });
});

app.get('/api/admin-only', protect, restrictTo('admin'), (req, res) => {
  res.json({ message: 'أهلاً بك في لوحة الأدمن' });
});

// Security: Global Error Handler preventing stack traces or DB leakage
app.use((err, req, res, next) => {
  console.error('[GlobalErrorHandler]', err);
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'صيغة JSON غير صالحة' });
  }
  const status = err.statusCode || err.status || 500;
  const message = status >= 500 ? 'حدث خطأ داخلي في الخادم' : err.message;
  res.status(status).json({
    success: false,
    message,
  });
});

const server = app.listen(PORT, async () => {
  console.log(`[Server] Server is running on port ${PORT}`);
  console.log(`[Swagger] Documentation available at http://localhost:${PORT}/api-docs`);

  if (!process.env.JWT_SECRET) {
    console.warn('[Auth] Warning: JWT_SECRET is missing in .env!');
  }

  console.log('[Database] Verifying Neon Postgres connection...');
  const connResult = await verifyConnection();
  if (connResult.ok) {
    console.log(`[Database] ${connResult.message}`);
  } else {
    console.warn(`[Database] Warning: ${connResult.message}`);
  }
});

module.exports = { app, server };
