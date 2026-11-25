const path = require('node:path');
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
const { startKeepAlive } = require('./lib/keep-alive');

const { composeAuth } = require('./service/auth.service');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 32) {
  throw new Error('FATAL: JWT_SECRET environment variable is missing or shorter than 32 characters');
}

const auth = composeAuth(pool, process.env.JWT_SECRET);
const protect = createProtect(auth);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-device-id'],
}));

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

app.use(express.static(path.join(__dirname, '../public')));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Alex Project API' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.use('/api', apiLimiter);

app.use('/api/auth', createAuthRoutes(auth, authLimiter, protect, restrictTo));
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


  console.log('[Database] Verifying Neon Postgres connection...');
  const connResult = await verifyConnection();
  if (connResult.ok) {
    console.log(`[Database] ${connResult.message}`);
  } else {
    console.warn(`[Database] Warning: ${connResult.message}`);
  }

  // بدء خدمة الحفاظ على نشاط السيرفر (Render Keep-Alive)
  startKeepAlive();
});

module.exports = { app, server };
