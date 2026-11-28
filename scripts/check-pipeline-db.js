const { createCustomerService } = require('../src/service/customer.service');
const { createSaleService } = require('../src/service/sale.service');

// This is a deployment contract, not a migration. Never change data here.
const REQUIRED_COLUMNS = {
  users: 'id username email password role token device_id branch_id',
  branches: 'id name code_prefix last_number',
  customers: 'id customer_code name normalized_name risk_level general_note created_at updated_at',
  customer_addresses: 'id customer_id area housing_type address_details is_current created_at',
  guarantors: 'id sale_id name created_at',
  phone_numbers: 'id customer_id guarantor_id phone is_primary label created_at',
  sales: 'id invoice_number branch_id customer_id address_id item_details cash_price down_payment monthly_installment installments_count discount_amount total_amount delivery_date first_installment_date due_day collection_type status created_at updated_at',
  payments: 'id sale_id amount payment_month payment_date payment_method collection_branch_id notes created_at',
  sale_notes: 'id sale_id created_by_user_id note_type content follow_up_date created_at',
  sale_balances: 'sale_id invoice_number branch_id customer_id address_id item_details cash_price down_payment monthly_installment installments_count discount_amount total_amount delivery_date first_installment_date due_day collection_type status created_at updated_at total_paid required_installments_total due_installments remaining_amount due_amount overdue_amount',
};

function safeDatabaseError(error) {
  if (error.code === 'SCHEMA_DRIFT') {
    return { code: error.code, message: 'Required database columns are missing.', missing: error.missing };
  }
  if (error.code === 'BALANCE_RULE') {
    return { code: error.code, message: 'Balance view violates nonnegative or discount caps.', ...error.counts };
  }
  const code = /^[A-Z0-9]{2,12}$/.test(String(error.code || '')) ? error.code : 'DATABASE_ERROR';
  // PostgreSQL's missing-column/relation messages contain identifiers, not row data.
  const message = ['42703', '42P01'].includes(code)
    ? String(error.message).slice(0, 300)
    : 'Database check could not complete; inspect the server connection or database logs.';
  return { code, message };
}

async function runDatabaseChecks(pool) {
  const checks = [];
  let client;
  let transactionStarted = false;
  const addFailure = (id, name, error) => checks.push({ id, name, ok: false, details: safeDatabaseError(error) });
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionStarted = true;
    await client.query("SET LOCAL statement_timeout = '10000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    // Some services call pool.query in parallel. A single read-only client must
    // serialize those operations, including draining errors before a savepoint.
    let pendingQueries = Promise.resolve();
    const queryable = {
      query(sql, parameters) {
        const result = pendingQueries.then(() => client.query(sql, parameters));
        pendingQueries = result.catch(() => {});
        return result;
      },
    };

    async function check(id, name, operation) {
      await client.query('SAVEPOINT pipeline_check');
      try {
        const details = await operation();
        checks.push({ id, name, ok: true, ...(details ? { details } : {}) });
      } catch (error) {
        await pendingQueries;
        await client.query('ROLLBACK TO SAVEPOINT pipeline_check');
        addFailure(id, name, error);
      } finally {
        await client.query('RELEASE SAVEPOINT pipeline_check');
      }
    }

    await check('db.schema', 'Required business tables, view and columns', async () => {
      const { rows } = await client.query(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
        [Object.keys(REQUIRED_COLUMNS)]
      );
      const actual = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
      const missing = Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) =>
        columns.split(' ').map((column) => `${table}.${column}`).filter((column) => !actual.has(column))
      );
      if (missing.length) {
        throw Object.assign(new Error('Missing required columns'), { code: 'SCHEMA_DRIFT', missing });
      }
      return { objects: Object.keys(REQUIRED_COLUMNS).length };
    });

    const customers = createCustomerService(queryable);
    const sales = createSaleService(queryable);
    const user = { role: 'admin', branch_id: null };
    const query = { page: 1, limit: 1, q: '__pipeline_probe__' };
    const probes = [
      ['db.customer-search', 'Execute actual customer search SQL', () => customers.searchCustomers({ user, ...query })],
      ['db.sale-search', 'Execute actual sale search SQL', () => sales.searchSales({ user, query })],
      ['db.sale-details', 'Execute actual invoice-details SQL', () => sales.getSaleDetails({ user, saleId: 50 })],
      ['db.invoice-number', 'Execute actual invoice-number SQL', () => sales.getSaleDetails({ user, invoiceNumber: '__pipeline_probe__' })],
      ['db.overdue', 'Execute actual overdue SQL', () => sales.getOverdueSales({ user, query: { page: 1, limit: 1 } })],
      ['db.follow-up', 'Execute actual follow-up SQL', () => sales.getFollowUpSales({ user, query: { day: 31, page: 1, limit: 1 } })],
      ['db.daily-summary', 'Execute actual daily-collection SQL', () => sales.getDailySummary({ user, query: { date: '2000-01-01' } })],
    ];
    for (const [id, name, operation] of probes) {
      await check(id, name, async () => {
        await operation();
        // Never return customer, user, token, invoice or payment contents.
        return { sqlExecuted: true };
      });
    }

    await check('db.balance-invariants', 'Balance view obeys nonnegative and discount caps', async () => {
      const { rows } = await client.query(`
        SELECT COUNT(*)::integer AS violations,
          COUNT(*) FILTER (WHERE due_amount > required_installments_total)::integer AS due_cap_violations,
          COUNT(*) FILTER (WHERE overdue_amount > remaining_amount)::integer AS overdue_cap_violations
        FROM sale_balances
        WHERE required_installments_total < 0 OR remaining_amount < 0
           OR due_amount < 0 OR overdue_amount < 0
           OR due_amount > required_installments_total
           OR overdue_amount > remaining_amount
      `);
      const violations = Number(rows[0].violations);
      if (violations) {
        throw Object.assign(new Error('Balance invariants failed'), { code: 'BALANCE_RULE', counts: rows[0] });
      }
      return { violations };
    });
  } catch (error) {
    addFailure('db.connection', 'Read-only database connection and transaction', error);
  } finally {
    if (client) {
      try {
        if (transactionStarted) await client.query('ROLLBACK');
      } catch (error) {
        addFailure('db.cleanup', 'Close read-only transaction', error);
      } finally {
        client.release();
      }
    }
  }
  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks };
}

async function main() {
  const { pool } = require('../src/config/db');
  try {
    const result = await runDatabaseChecks(pool);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch(() => { console.error('Database readiness checker failed.'); process.exitCode = 1; });

module.exports = { runDatabaseChecks, REQUIRED_COLUMNS };
