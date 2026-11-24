const { createAuthUseCases } = require('../auth/application/use-cases');
const { createPostgresUsers } = require('../auth/infrastructure/postgres-users');
const { passwords, createJwtTokens } = require('../auth/infrastructure/credentials');

function composeAuth(pool, jwtSecret) {
  const users = createPostgresUsers(pool);
  return createAuthUseCases({
    users,
    passwords,
    tokens: createJwtTokens(jwtSecret),
    branches: {
      exists: (id) => users.branchExists(id),
    },
  });
}

module.exports = { composeAuth };
