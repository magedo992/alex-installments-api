const { AuthError } = require('../domain/input');

function createPostgresUsers(pool) {
  async function create({ username, email, passwordHash, deviceId }) {
    try {
      const { rows: [user] } = await pool.query(
        'INSERT INTO public.users (username, email, password, device_id) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role',
        [username, email, passwordHash, deviceId]
      );
      return user;
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'users_email_key') {
        throw new AuthError('DUPLICATE_EMAIL', 'Email already registered', 'email');
      }
      throw error;
    }
  }

  async function findByEmail(email) {
    const { rows: [user] } = await pool.query(
      'SELECT id, username, email, role, token, device_id AS "deviceId", branch_id AS "branchId", password AS "passwordHash" FROM public.users WHERE email = $1',
      [email]
    );
    return user;
  }

  async function replaceToken(id, previousToken, token, deviceId) {
    const { rowCount } = await pool.query(
      'UPDATE public.users SET token = $1, device_id = COALESCE(device_id, $4) WHERE id = $2 AND token IS NOT DISTINCT FROM $3 AND (device_id IS NULL OR device_id = $4)',
      [token, id, previousToken, deviceId]
    );
    return rowCount === 1;
  }

  async function findSession(id) {
    const { rows: [session] } = await pool.query(
      'SELECT role, token, device_id AS "deviceId", branch_id AS "branchId" FROM public.users WHERE id = $1', [id]
    );
    return session;
  }

  return { create, findByEmail, replaceToken, findSession };
}

module.exports = { createPostgresUsers };
