const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { pool } = require('../src/config/db');

async function migrate() {
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing');
    const sql = ['001_users.sql', '002_user_device.sql', '003_user_branch.sql', '004_sale_balances_and_notes.sql']
      .map((file) => readFileSync(join(__dirname, '../migrations', file), 'utf8'))
      .join('\n');
    await pool.query(`BEGIN;\n${sql}\nCOMMIT;`);
    console.log('Users and device binding migrations applied');
  } catch (err) {
    console.error('Users migration failed:', err.code || err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
