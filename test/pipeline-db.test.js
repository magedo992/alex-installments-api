const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runDatabaseChecks, REQUIRED_COLUMNS } = require('../scripts/check-pipeline-db');

function database({ missing = [], detailError = null, violations = 0 } = {}) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      if (/information_schema\.columns/.test(sql)) {
        return { rows: Object.entries(REQUIRED_COLUMNS).flatMap(([table_name, columns]) =>
          columns.split(' ').filter((column) => !missing.includes(`${table_name}.${column}`))
            .map((column_name) => ({ table_name, column_name }))
        ) };
      }
      if (detailError && /'payment_method', p\.payment_method/.test(sql)) throw detailError;
      if (/COUNT\(\*\)::integer AS violations/.test(sql)) return { rows: [{ violations }] };
      if (/SELECT COUNT\(\*\) AS total/.test(sql)) return { rows: [{ total: '0' }] };
      return { rows: [] };
    },
    release() { released = true; },
  };
  return { calls, client, async connect() { return client; }, get released() { return released; } };
}

test('database gate fails for both missing payment columns while still exercising actual service SQL', async () => {
  const missing = ['payments.payment_method', 'payments.collection_branch_id'];
  const pool = database({ missing });
  const result = await runDatabaseChecks(pool);
  assert.equal(result.ok, false);
  assert.deepEqual(result.checks.find((check) => check.id === 'db.schema').details.missing, missing);
  assert.ok(pool.calls.some(({ sql }) => /'payment_method', p\.payment_method/.test(sql)));
  assert.ok(result.checks.some((check) => check.id === 'db.daily-summary'));
});

test('database gate recovers a failed SQL probe with savepoints, reports it and releases the connection', async () => {
  const pool = database({ detailError: Object.assign(new Error('column p.payment_method does not exist'), { code: '42703' }) });
  const result = await runDatabaseChecks(pool);
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((check) => check.id === 'db.sale-details').details.code, '42703');
  assert.equal(result.checks.find((check) => check.id === 'db.follow-up').ok, true);
  assert.equal(pool.calls.filter(({ sql }) => sql === 'ROLLBACK TO SAVEPOINT pipeline_check').length, 2);
  assert.equal(pool.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(pool.released, true);
});

test('database gate uses a read-only transaction, never mutates rows and treats no matching invoice as valid SQL', async () => {
  const pool = database();
  const result = await runDatabaseChecks(pool);
  assert.equal(result.ok, true);
  assert.match(pool.calls[0].sql, /READ ONLY$/);
  for (const { sql } of pool.calls) {
    assert.match(sql.trim(), /^(SELECT|BEGIN|SET LOCAL|SAVEPOINT|ROLLBACK|RELEASE)\b/);
    assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE sales|ALTER TABLE|DELETE FROM)\b/i);
  }
  assert.equal(result.checks.find((check) => check.id === 'db.sale-details').ok, true);
  assert.equal(JSON.stringify(result).includes('customer_name'), false);
});

test('database gate fails connection errors without printing credentials and closes failed setup', async () => {
  const pool = database();
  pool.client.query = async () => { throw Object.assign(new Error('postgres://user:private-password@example.invalid/db'), { code: 'EACCES' }); };
  const result = await runDatabaseChecks(pool);
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].details.code, 'EACCES');
  assert.doesNotMatch(JSON.stringify(result), /private-password|example\.invalid/);
  assert.equal(pool.released, true);
});

test('database gate rejects a balance view with values above discount-adjusted caps', async () => {
  const result = await runDatabaseChecks(database({ violations: 3 }));
  assert.equal(result.ok, false);
  const check = result.checks.find((entry) => entry.id === 'db.balance-invariants');
  assert.equal(check.ok, false);
  assert.equal(check.details.violations, 3);
});

test('database gate never overlaps queries on its single transaction client', async () => {
  const pool = database();
  const query = pool.client.query.bind(pool.client);
  let busy = false;
  pool.client.query = async (...args) => {
    assert.equal(busy, false, 'a previous database operation must finish first');
    busy = true;
    try {
      await new Promise((resolve) => setImmediate(resolve));
      return await query(...args);
    } finally { busy = false; }
  };
  assert.equal((await runDatabaseChecks(pool)).ok, true);
});

test('database gate drains parallel daily-summary failures before rollback and still checks balances', async () => {
  const pool = database();
  const query = pool.client.query.bind(pool.client);
  let busy = false;
  pool.client.query = async (sql, parameters) => {
    assert.equal(busy, false, 'queries and savepoint rollback cannot overlap');
    busy = true;
    try {
      await new Promise((resolve) => setImmediate(resolve));
      if (/AS cash_total/.test(sql)) throw Object.assign(new Error('column p.payment_method does not exist'), { code: '42703' });
      return await query(sql, parameters);
    } finally { busy = false; }
  };
  const result = await runDatabaseChecks(pool);
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((check) => check.id === 'db.daily-summary').details.code, '42703');
  assert.equal(result.checks.find((check) => check.id === 'db.balance-invariants').ok, true);
  assert.equal(pool.released, true);
});
