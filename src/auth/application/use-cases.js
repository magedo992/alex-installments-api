const { AuthError, registrationInput, loginInput, isDeviceId } = require('../domain/input');

function publicUser({ id, username, email, role, branchId, branch_id }) {
  return { id, username, email, role, branch_id: branchId ?? branch_id ?? null };
}

function createAuthUseCases({ users, passwords, tokens }) {
  async function register(input) {
    const { username, email, password, deviceId } = registrationInput(input);
    const passwordHash = await passwords.hash(password);
    return publicUser(await users.create({ username, email, passwordHash, deviceId }));
  }

  async function login(input) {
    const { email, password, deviceId } = loginInput(input);
    const user = await users.findByEmail(email);
    if (!user || !(await passwords.matches(password, user.passwordHash))) {
      throw new AuthError('INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة');
    }
    // Legacy accounts retain their stored token's device until the first login binds the column.
    const previousDevice = user.deviceId || (user.token && tokens.readDevice(user.token));
    if (previousDevice && previousDevice !== deviceId) {
      throw new AuthError('DEVICE_MISMATCH', 'هذا الحساب مربوط بجهاز آخر');
    }
    const profile = publicUser(user);
    const token = tokens.issue({ ...profile, deviceId });
    if (!(await users.replaceToken(user.id, user.token, token, deviceId))) {
      throw new AuthError('LOGIN_CONFLICT', 'Login changed concurrently. Try again.');
    }
    return { token, user: profile };
  }

  async function authenticate({ token, deviceId }) {
    if (!token || !isDeviceId(deviceId)) {
      throw new AuthError('UNAUTHENTICATED', 'غير مصرح بالدخول');
    }
    const claims = tokens.verify(token);
    if (claims.deviceId !== deviceId) {
      throw new AuthError('DEVICE_MISMATCH', 'الجهاز غير مطابق للتوكين');
    }
    const session = await users.findSession(claims.id);
    if (!session || session.token !== token) {
      throw new AuthError('SESSION_REPLACED', 'التوكين غير صالح أو تم الدخول من جهاز آخر');
    }
    if (session.deviceId && session.deviceId !== deviceId) {
      throw new AuthError('DEVICE_MISMATCH', 'هذا الحساب مربوط بجهاز آخر');
    }
    return {
      ...claims,
      role: session.role,
      branch_id: session.branchId ?? session.branch_id ?? null,
      branchId: session.branchId ?? session.branch_id ?? null,
    };
  }

  return { register, login, authenticate };
}

module.exports = { createAuthUseCases };
