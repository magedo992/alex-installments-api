const { respondToAuthError } = require('../auth/http-errors');

function createProtect(auth) {
  return async (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const token = /^Bearer ([^\s,]+)$/i.exec(header)?.[1];

    try {
      req.user = await auth.authenticate({ token, deviceId: req.get('x-device-id') });
    } catch (error) {
      return respondToAuthError(res, error);
    }
    next();
  };
}

function restrictTo(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'ليس لديك صلاحية تنفيذ هذا الإجراء' });
    }
    next();
  };
}

module.exports = { createProtect, restrictTo };
