const { AuthError } = require('../domain/input');

function createPostgresUsers(pool) {
  async function create({ username, email, passwordHash, deviceId, role = 'employee', branchId = null }) {
    try {
      const { rows: [user] } = await pool.query(
        'INSERT INTO public.users (username, email, password, device_id, role, branch_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, email, role, branch_id AS "branchId"',
        [username, email, passwordHash, deviceId, role, branchId]
      );
      return user;
    } catch (error) {
      if (error.code === '23505') {
        if (error.constraint === 'users_email_key') {
          throw new AuthError('DUPLICATE_EMAIL', 'البريد الإلكتروني مسجل مسبقاً', 'email');
        }
        if (error.constraint === 'users_username_key') {
          throw new AuthError('DUPLICATE_USERNAME', 'اسم المستخدم مسجل مسبقاً', 'username');
        }
      }
      throw error;
    }
  }

  async function findByUsername(username) {
    const { rows: [user] } = await pool.query(
      'SELECT id, username, email, role, token, device_id AS "deviceId", branch_id AS "branchId", password AS "passwordHash" FROM public.users WHERE username = $1',
      [username]
    );
    return user;
  }

  async function findByEmail(email) {
    const { rows: [user] } = await pool.query(
      'SELECT id, username, email, role, token, device_id AS "deviceId", branch_id AS "branchId", password AS "passwordHash" FROM public.users WHERE email = $1',
      [email]
    );
    return user;
  }

  async function findByUsernameOrEmail(loginId) {
    const { rows: [user] } = await pool.query(
      'SELECT id, username, email, role, token, device_id AS "deviceId", branch_id AS "branchId", password AS "passwordHash" FROM public.users WHERE username = $1 OR LOWER(email) = LOWER($1) LIMIT 1',
      [loginId]
    );
    return user;
  }

  async function listUsers() {
    const { rows } = await pool.query(
      'SELECT id, username, email, role, branch_id, device_id FROM public.users ORDER BY username ASC'
    );
    return rows;
  }

  async function listBranches() {
    const { rows } = await pool.query(
      'SELECT id, name FROM public.branches ORDER BY id ASC'
    );
    return rows;
  }

  async function replaceToken(id, previousToken, token, deviceId, { isAdmin = false } = {}) {
    if (isAdmin) {
      const { rowCount } = await pool.query(
        'UPDATE public.users SET token = $1 WHERE id = $2 AND token IS NOT DISTINCT FROM $3',
        [token, id, previousToken]
      );
      return rowCount === 1;
    }
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

  async function branchExists(branchId) {
    if (!branchId) return false;
    const { rows } = await pool.query('SELECT 1 FROM public.branches WHERE id = $1', [branchId]);
    return rows.length > 0;
  }

  return { create, findByUsername, findByEmail, findByUsernameOrEmail, listUsers, listBranches, replaceToken, findSession, branchExists };
}

module.exports = { createPostgresUsers };
