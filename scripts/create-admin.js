#!/usr/bin/env node
require('dotenv').config({ path: ['.env.local', '.env'], quiet: true });
const readline = require('node:readline');
const bcrypt = require('bcrypt');
const { pool } = require('../src/config/db');

function parseArgs(args) {
  const parsed = {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    username: process.env.ADMIN_USERNAME,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--force' || arg === '-f') {
      parsed.force = true;
    } else if (arg === '--email' && args[i + 1]) {
      parsed.email = args[++i];
    } else if (arg === '--password') {
      console.error(
        '[Bootstrap Error] The --password flag is not permitted for security reasons. ' +
        'Set the ADMIN_PASSWORD environment variable or enter the password via the hidden interactive prompt.'
      );
      process.exit(1);
    } else if (arg === '--username' && args[i + 1]) {
      parsed.username = args[++i];
    }
  }

  return parsed;
}

function prompt(query, isPassword = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (isPassword && process.stdin.isTTY) {
      process.stdout.write(query);
      let input = '';
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const onData = (char) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (char === '\u0003') {
          process.exit(1);
        } else if (char === '\b' || char === '\x7f') {
          input = input.slice(0, -1);
        } else {
          input += char;
        }
      };

      process.stdin.on('data', onData);
    } else {
      rl.question(query, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    const { rows: existingAdmins } = await pool.query(
      "SELECT id, email FROM public.users WHERE role = 'admin' LIMIT 1"
    );

    if (existingAdmins.length > 0 && !options.force) {
      console.error(
        `[Bootstrap Error] An admin user already exists (${existingAdmins[0].email}). ` +
        'Operation refused to prevent accidental admin takeover. Pass --force to override.'
      );
      process.exit(1);
    }

    let email = options.email;
    let password = options.password;
    let username = options.username;

    if (!email && process.stdin.isTTY) {
      email = await prompt('Enter Admin Email: ');
    }
    if (!username && process.stdin.isTTY) {
      username = await prompt('Enter Admin Username (optional): ');
    }
    if (!password && process.stdin.isTTY) {
      password = await prompt('Enter Admin Password: ', true);
    }

    if (!email || !password) {
      console.error(
        '[Bootstrap Error] Email and password are required. ' +
        'Provide email via --email flag / ADMIN_EMAIL, and password via ADMIN_PASSWORD environment variable or hidden interactive prompt.'
      );
      process.exit(1);
    }

    email = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.error('[Bootstrap Error] Invalid email address format.');
      process.exit(1);
    }

    if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      console.error('[Bootstrap Error] Password must be between 8 and 72 characters.');
      process.exit(1);
    }

    username = (username || email.split('@')[0] || 'admin').trim();

    const passwordHash = await bcrypt.hash(password, 10);

    const { rows: [createdAdmin] } = await pool.query(
      `INSERT INTO public.users (username, email, password, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email)
       DO UPDATE SET role = 'admin', password = EXCLUDED.password, username = EXCLUDED.username
       RETURNING id, username, email, role`,
      [username, email, passwordHash]
    );

    console.log(
      `[Bootstrap Success] Admin account successfully provisioned: ID=${createdAdmin.id}, Email=${createdAdmin.email}, Role=${createdAdmin.role}`
    );
    process.exit(0);
  } catch (err) {
    console.error('[Bootstrap Error]', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs };
