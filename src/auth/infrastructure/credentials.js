const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { AuthError } = require('../domain/input');

const passwords = {
  hash: (password) => bcrypt.hash(password, 10),
  matches: (password, hash) => bcrypt.compare(password, hash),
};

function createJwtTokens(secret) {
  return {
    issue: (claims) => jwt.sign(claims, secret, { expiresIn: '30d', algorithm: 'HS256' }),
    // The stored session binds the account to its device even after expiry.
    readDevice: (token) => jwt.decode(token)?.deviceId,
    verify(token) {
      if (!secret) throw new Error('JWT_SECRET is missing');
      let claims;
      try {
        claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
      } catch (error) {
        if (!(error instanceof jwt.JsonWebTokenError)) throw error;
        throw new AuthError('UNAUTHENTICATED', 'التوكين منتهي أو غير صالح');
      }
      if (typeof claims?.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(claims.id)) {
        throw new AuthError('UNAUTHENTICATED', 'التوكين منتهي أو غير صالح');
      }
      return claims;
    },
  };
}

module.exports = { passwords, createJwtTokens };
