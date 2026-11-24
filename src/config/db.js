require('dotenv').config({ path: ['.env.local', '.env'], quiet: true });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

pool.on('error', () => console.error('[Database] Idle connection failed'));

async function verifyConnection() {
  if (!process.env.DATABASE_URL) return { ok: false, message: 'DATABASE_URL is missing' };
  try {
    await pool.query('SELECT id, username, email, password, role, token, device_id, branch_id FROM public.users LIMIT 0');
    return { ok: true, message: 'Neon Postgres users table is accessible' };
  } catch {
    return { ok: false, message: 'Neon Postgres users table is unavailable' };
  }
}

module.exports = { pool, verifyConnection };
