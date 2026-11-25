const { respondToAuthError } = require('../auth/http-errors');

function createAuthController(auth) {
  async function register(req, res) {
    try {
      const { username, email, password, role, branch_id, device_id } = req.body ?? {};
      const isAdmin = req.user && req.user.role === 'admin';
      const assignedRole = isAdmin ? (role || 'employee') : 'employee';
      const assignedBranchId = isAdmin ? (branch_id ?? null) : null;
      const assignedDeviceId = isAdmin ? (device_id ?? null) : null;
      const user = await auth.register({
        username,
        email,
        password,
        role: assignedRole,
        branchId: assignedBranchId,
        deviceId: assignedDeviceId,
      });
      res.status(201).json({ message: 'تم إنشاء الحساب بنجاح', user });
    } catch (error) {
      respondToAuthError(res, error);
    }
  }

  async function login(req, res) {
    try {
      const { username, email, identifier, password } = req.body ?? {};
      const result = await auth.login({ username, email, identifier, password, deviceId: req.get('x-device-id') });
      res.json(result);
    } catch (error) {
      respondToAuthError(res, error);
    }
  }

  async function listUsers(req, res) {
    try {
      const users = await auth.listUsers();
      res.json({ success: true, data: users });
    } catch (error) {
      respondToAuthError(res, error);
    }
  }

  async function listBranches(req, res) {
    try {
      const branches = await auth.listBranches();
      res.json({ success: true, data: branches });
    } catch (error) {
      respondToAuthError(res, error);
    }
  }

  return { register, login, listUsers, listBranches };
}

module.exports = { createAuthController };
