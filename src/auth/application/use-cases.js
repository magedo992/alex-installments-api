const { AuthError, registrationInput, loginInput, isDeviceId } = require('../domain/input');

function publicUser({ id, username, email, role, branchId, branch_id }) {
  return { id, username, email, role, branch_id: branchId ?? branch_id ?? null };
}

function createAuthUseCases({ users, passwords, tokens, branches }) {
  async function register(input) {
    const { username, email, password, deviceId, role, branchId } = registrationInput(input);
    if (branchId != null) {
      const checkBranch = branches?.exists || users?.branchExists;
      if (checkBranch) {
        const exists = await checkBranch(branchId);
        if (!exists) {
          throw new AuthError('INVALID_INPUT', 'الفرع المحدد غير موجود', 'branch_id');
        }
      }
    }
    const passwordHash = await passwords.hash(password);
    return publicUser(await users.create({ username, email, passwordHash, deviceId, role, branchId }));
  }

  async function login(input) {
    const { loginId, password, deviceId } = loginInput(input);
    const user = users.findByUsernameOrEmail
      ? await users.findByUsernameOrEmail(loginId)
      : await users.findByUsername(loginId);
    if (!user || !(await passwords.matches(password, user.passwordHash))) {
      throw new AuthError('INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة');
    }
    const isAdmin = user.role === 'admin';
    if (!isAdmin) {
      if (!isDeviceId(deviceId)) {
        throw new AuthError('INVALID_INPUT', 'معرف الجهاز (x-device-id) مفقود أو غير صالح', 'x-device-id');
      }
      const previousDevice = user.deviceId || (user.token && tokens.readDevice(user.token));
      if (previousDevice && previousDevice !== deviceId) {
        throw new AuthError('DEVICE_MISMATCH', 'هذا الحساب مربوط بجهاز آخر');
      }
    }
    const profile = publicUser(user);
    const effectiveDeviceId = isAdmin ? null : deviceId;
    const token = tokens.issue({ ...profile, deviceId: effectiveDeviceId });
    if (!(await users.replaceToken(user.id, user.token, token, effectiveDeviceId, { isAdmin }))) {
      throw new AuthError('LOGIN_CONFLICT', 'Login changed concurrently. Try again.');
    }
    return { token, user: profile };
  }

  async function authenticate({ token, deviceId }) {
    if (!token) {
      throw new AuthError('UNAUTHENTICATED', 'غير مصرح بالدخول');
    }
    const claims = tokens.verify(token);
    const session = await users.findSession(claims.id);
    if (!session) {
      throw new AuthError('UNAUTHENTICATED', 'المستخدم غير موجود أو تم حذفه');
    }
    if (session.isActive === false || session.is_active === false) {
      throw new AuthError('UNAUTHENTICATED', 'تم تعطيل هذا الحساب');
    }
    if (session.token !== token) {
      throw new AuthError('SESSION_REPLACED', 'التوكين غير صالح أو تم الدخول من جهاز آخر');
    }
    if (session.role !== 'admin') {
      if (!isDeviceId(deviceId)) {
        throw new AuthError('UNAUTHENTICATED', 'غير مصرح بالدخول');
      }
      if (claims.deviceId !== deviceId) {
        throw new AuthError('DEVICE_MISMATCH', 'الجهاز غير مطابق للتوكين');
      }
      if (session.deviceId && session.deviceId !== deviceId) {
        throw new AuthError('DEVICE_MISMATCH', 'هذا الحساب مربوط بجهاز آخر');
      }
    }
    return {
      ...claims,
      role: session.role,
      branch_id: session.branchId ?? session.branch_id ?? null,
      branchId: session.branchId ?? session.branch_id ?? null,
    };
  }

  async function listUsers() {
    if (!users.listUsers) return [];
    return users.listUsers();
  }

  async function listBranches() {
    if (!users.listBranches) return [];
    return users.listBranches();
  }

  return { register, login, authenticate, listUsers, listBranches };
}

module.exports = { createAuthUseCases };
