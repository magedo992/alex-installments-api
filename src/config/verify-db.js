const { verifyConnection } = require('./db');

async function main() {
  console.log('[Neon Postgres Verification] Testing Neon Postgres database connection...');
  const result = await verifyConnection();

  if (result.ok) {
    console.log(`[Neon Postgres Verification] OK: ${result.message}`);
    process.exit(0);
  } else {
    console.error(`[Neon Postgres Verification] ERROR: ${result.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Neon Postgres Verification] Unexpected error:', err.message);
  process.exit(1);
});

