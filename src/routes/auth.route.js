const express = require('express');
const { createAuthController } = require('../controller/auth.controller');
const { createProtect, restrictTo: defaultRestrictTo } = require('../middlewares/auth.middleware');
const { validate, registerUserSchema } = require('../middlewares/validate.middleware');

function createAuthRoutes(auth, authLimiter, protectMiddleware, restrictToMiddleware) {
  const router = express.Router();
  const controller = createAuthController(auth);
  router.use(express.json());

  const protect = protectMiddleware || createProtect(auth);
  const restrictTo = restrictToMiddleware || defaultRestrictTo;
  const limiter = authLimiter || ((req, res, next) => next());

  router.post('/register', limiter, protect, restrictTo('admin'), validate(registerUserSchema), controller.register);
  router.post('/login', limiter, controller.login);
  router.get('/users', protect, restrictTo('admin'), controller.listUsers);
  router.get('/branches', protect, restrictTo('admin'), controller.listBranches);
  router.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ message: 'صيغة JSON غير صالحة' });
    }
    next(error);
  });
  return router;
}

module.exports = { createAuthRoutes };
