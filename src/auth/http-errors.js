const { AuthError } = require('./domain/input');

const statusByCode = {
  INVALID_INPUT: 400,
  DUPLICATE_EMAIL: 400,
  DUPLICATE_USERNAME: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  DEVICE_MISMATCH: 403,
  SESSION_REPLACED: 403,
  LOGIN_CONFLICT: 409,
};

function respondToAuthError(res, error) {
  if (error instanceof AuthError && statusByCode[error.code]) {
    const body = { message: error.message };
    if (error.field) body.field = error.field;
    return res.status(statusByCode[error.code]).json(body);
  }
  return res.status(500).json({ message: 'Internal server error' });
}

module.exports = { respondToAuthError };
