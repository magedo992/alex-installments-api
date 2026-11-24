const express = require('express');
const { createAuthController } = require('../controller/auth.controller');

function createAuthRoutes(auth, authLimiter) {
  const router = express.Router();
  const controller = createAuthController(auth);
  router.use(express.json());

  const limiter = authLimiter || ((req, res, next) => next());
  router.post('/register', limiter, controller.register);
  router.post('/login', limiter, controller.login);
  router.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ message: 'صيغة JSON غير صالحة' });
    }
    next(error);
  });
  return router;
}

module.exports = { createAuthRoutes };
