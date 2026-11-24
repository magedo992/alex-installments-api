const { createAuthUseCases } = require('../auth/application/use-cases');
const { createPostgresUsers } = require('../auth/infrastructure/postgres-users');
const { passwords, createJwtTokens } = require('../auth/infrastructure/credentials');

function composeAuth(pool, jwtSecret) {
  return createAuthUseCases({
    users: createPostgresUsers(pool),
    passwords,
    tokens: createJwtTokens(jwtSecret),
  });
}

module.exports = { composeAuth };
