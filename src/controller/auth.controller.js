const { respondToAuthError } = require('../auth/http-errors');

function createAuthController(auth) {
  async function register(req, res) {
    try {
      const { username, email, password } = req.body ?? {};
      const user = await auth.register({ username, email, password, deviceId: req.get('x-device-id') });
      res.status(201).json({ message: 'تم إنشاء الحساب بنجاح', user });
    } catch (error) {
      respondToAuthError(res, error);
    }
  }

  async function login(req, res) {
    try {
      const { email, password } = req.body ?? {};
      const result = await auth.login({ email, password, deviceId: req.get('x-device-id') });
      res.json(result);
    } catch (error) {
      respondToAuthError(res, error);
    }
  }

  return { register, login };
}

module.exports = { createAuthController };
