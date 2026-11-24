const { respondToAuthError } = require('../auth/http-errors');

function createAuthController(auth) {
  async function register(req, res) {
    try {
      const { username, email, password, role, branch_id } = req.body ?? {};
      const isAdmin = req.user && req.user.role === 'admin';
      const assignedRole = isAdmin ? (role || 'employee') : 'employee';
      const assignedBranchId = isAdmin ? (branch_id ?? null) : null;
      const user = await auth.register({
        username,
        email,
        password,
        role: assignedRole,
        branchId: assignedBranchId,
        deviceId: null,
      });
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
