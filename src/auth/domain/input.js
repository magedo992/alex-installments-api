class AuthError extends Error {
  constructor(code, message, field) {
    super(message);
    this.code = code;
    this.field = field;
  }
}

const limits = Object.freeze({ username: 100, email: 254, passwordMin: 8, passwordBytes: 72, deviceId: 256 });

function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  if (email.length > limits.email || !/^[^\s@\p{Cc}]+@[^\s@\p{Cc}.]+(?:\.[^\s@\p{Cc}.]+)+$/u.test(email)) {
    throw new AuthError('INVALID_INPUT', 'أدخل بريداً إلكترونياً صالحاً', 'email');
  }
  return email;
}

function isDeviceId(value) {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= limits.deviceId && !/[\s,\p{Cc}]/u.test(value);
}

function registrationInput({ username, email, password, deviceId }) {
  const name = typeof username === 'string' ? username.trim() : '';
  if (!name || name.length > limits.username || /\p{Cc}/u.test(name)) {
    throw new AuthError('INVALID_INPUT', 'اسم المستخدم مطلوب ويجب ألا يتجاوز 100 حرف', 'username');
  }
  const address = emailAddress(email);
  if (typeof password !== 'string' || !password.trim() ||
    Buffer.byteLength(password, 'utf8') > limits.passwordBytes || [...password].length < limits.passwordMin) {
    throw new AuthError('INVALID_INPUT', 'كلمة المرور يجب ألا تقل عن 8 أحرف ولا تتجاوز 72 بايت', 'password');
  }
  if (!isDeviceId(deviceId)) {
    throw new AuthError('INVALID_INPUT', 'معرف الجهاز (x-device-id) مفقود أو غير صالح', 'x-device-id');
  }
  return { username: name, email: address, password, deviceId };
}

function loginInput({ email, password, deviceId }) {
  const address = emailAddress(email);
  if (typeof password !== 'string' || !password.length) {
    throw new AuthError('INVALID_INPUT', 'كلمة المرور مطلوبة', 'password');
  }
  if (!isDeviceId(deviceId)) {
    throw new AuthError('INVALID_INPUT', 'معرف الجهاز (x-device-id) مفقود أو غير صالح', 'x-device-id');
  }
  return { email: address, password, deviceId };
}

module.exports = { AuthError, limits, registrationInput, loginInput, isDeviceId };
