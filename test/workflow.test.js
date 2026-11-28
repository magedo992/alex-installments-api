const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAuthRoutes } = require('../src/routes/auth.route');
const { createCustomerRoutes } = require('../src/routes/customer.route');
const { createSaleRoutes } = require('../src/routes/sale.route');
const { createProtect } = require('../src/middlewares/auth.middleware');
const { createAuthUseCases } = require('../src/auth/application/use-cases');
const { passwords, createJwtTokens } = require('../src/auth/infrastructure/credentials');

// These tests exercise real HTTP routes, validation, JWT/bcrypt and business
// services against a stateful, rollback-capable test double. They do NOT execute
// PostgreSQL or certify SQL/schema compatibility; the database gate covers that.
const PASSWORD = 'Workflow-test-password-2026';
const PAYMENT_DATE = '2026-11-20';

async function startWorkflow(t) {
  const pool = createStatefulPool();
  const accounts = new Map();
  const admin = {
    id: '00000000-0000-4000-8000-000000000001', username: 'workflow-admin',
    email: 'admin@example.test', role: 'admin', branchId: null,
    passwordHash: await passwords.hash(PASSWORD), deviceId: null, token: null,
  };
  accounts.set(admin.id, admin);
  const users = {
    async create(input) {
      assert(![...accounts.values()].some((u) => u.username === input.username));
      const user = { ...input, id: `00000000-0000-4000-8000-${String(accounts.size + 1).padStart(12, '0')}`, token: null };
      accounts.set(user.id, user);
      return { ...user };
    },
    async findByUsernameOrEmail(login) {
      const user = [...accounts.values()].find((u) => u.username === login || u.email === login);
      return user ? { ...user } : null;
    },
    async findSession(id) { return accounts.has(id) ? { ...accounts.get(id) } : null; },
    async replaceToken(id, previous, next, deviceId) {
      const user = accounts.get(id);
      if (!user || user.token !== previous) return false;
      Object.assign(user, { token: next, deviceId });
      return true;
    },
  };
  const auth = createAuthUseCases({
    users, passwords, tokens: createJwtTokens('workflow-only-secret-with-at-least-32-characters'),
    branches: { exists: async (id) => pool.snapshot().branches.some((b) => b.id === id) },
  });
  const app = express();
  const protect = createProtect(auth);
  app.use('/api/auth', createAuthRoutes(auth));
  app.use('/api/customers', createCustomerRoutes(pool, protect));
  app.use('/api/sales', createSaleRoutes(pool, protect));
  app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, { method = 'GET', body, headers = {} } = {}, expected = 200) {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  async function login(username, deviceId) {
    const result = await request('/auth/login', {
      method: 'POST', body: { username, password: PASSWORD },
      headers: deviceId ? { 'x-device-id': deviceId } : {},
    });
    assert.equal(typeof result.token, 'string');
    assert.equal(result.user.passwordHash, undefined);
    return { authorization: `Bearer ${result.token}`, ...(deviceId ? { 'x-device-id': deviceId } : {}) };
  }
  const adminHeaders = await login(admin.username);
  async function employee(username = 'workflow-employee', branchId = 1) {
    const result = await request('/auth/register', {
      method: 'POST', headers: adminHeaders,
      body: { username, email: `${username}@example.test`, password: PASSWORD, role: 'employee', branch_id: branchId },
    }, 201);
    assert.equal(result.user.branch_id, branchId);
    const stored = [...accounts.values()].find((u) => u.username === username);
    assert.notEqual(stored.passwordHash, PASSWORD);
    return login(username, `${username}-device`);
  }
  return { pool, request, employee, adminHeaders, login };
}

function customerInput() {
  return {
    name: 'عميل اختبار الفلو', branch_id: 2,
    phones: [{ phone: '01012345678', is_primary: true, label: 'شخصي' }],
    address: { area: 'منطقة اختبار', housing_type: 'ملك', address_details: 'عنوان اختباري' },
  };
}

function saleInput(customerId, overrides = {}) {
  return {
    invoice_number: 'FLOW-001', customer_id: customerId, branch_id: 2,
    item_details: 'منتج اختبار', cash_price: 2500, down_payment: 500,
    monthly_installment: 1000, installments_count: 3, discount_amount: 200,
    // All three installments are due; no wall-clock-dependent partial month math.
    first_installment_date: '2020-01-01', due_day: 1,
    guarantor: { name: 'ضامن اختبار', phones: [{ phone: '01112345678', is_primary: true }] },
    ...overrides,
  };
}

test('workflow: admin registers employee -> customer -> invoice -> partial collection -> follow-up -> settlement', async (t) => {
  const { request, employee, pool, adminHeaders } = await startWorkflow(t);
  const headers = await employee();
  const customer = (await request('/customers', { method: 'POST', headers, body: customerInput() }, 201)).data;
  assert.equal(customer.branch.id, 1, 'employee branch overrides the submitted foreign branch');
  assert.equal(customer.customer_code, '1001');
  assert.equal(customer.phones[0].phone, '01012345678');
  assert.equal(customer.address.is_current, true);

  const sale = (await request('/sales', { method: 'POST', headers, body: saleInput(customer.id) }, 201)).data;
  assert.equal(sale.branch_id, 1);
  assert.equal(sale.customer_id, customer.id);
  assert.equal(sale.address_id, customer.address.id);
  assert.equal(sale.total_amount, 3300, '500 down payment + 3000 installments - 200 discount');
  assert.equal(sale.guarantor.phones[0].phone, '01112345678');
  assert.equal(pool.snapshot().payments.length, 0, 'down payment is not counted twice as an installment payment');

  const detail = (await request(`/sales/${sale.id}`, { headers })).data;
  assert.equal(detail.customer.id, customer.id);
  assert.equal(detail.guarantor.id, sale.guarantor.id);
  assert.equal(detail.required_installments_total, 2800);
  assert.equal(detail.remaining_amount, 2800);
  const searched = await request('/sales?invoice_number=FLOW-001', { headers });
  assert.equal(searched.pagination.total, 1);
  assert.equal(searched.data[0].sale_id, sale.id);
  assert.equal((await request('/sales/by-invoice/FLOW-001', { headers })).data.id, sale.id);

  const first = (await request('/sales/FLOW-001/payments', {
    method: 'POST', headers,
    body: { amount: 1000, payment_date: PAYMENT_DATE, payment_method: 'كاش', collection_branch_id: 2 },
  }, 201)).data;
  assert.equal(first.payment.sale_id, sale.id);
  assert.equal(first.payment.payment_month, '2026-11-01');
  assert.equal(first.payment.collection_branch_id, 1, 'employee cannot redirect collection to another branch');
  assert.equal(first.summary.total_paid, 1000);
  assert.equal(first.summary.remaining_balance, 1800);
  assert.equal(first.summary.is_completed, false);

  await request(`/sales/${sale.id}/status`, { method: 'PATCH', headers: adminHeaders, body: { status: 'متأخر' } });
  const note = (await request(`/sales/${sale.id}/notes`, {
    method: 'POST', headers,
    body: { content: 'تم الاتفاق على سداد المتبقي', note_type: 'call', follow_up_date: '2026-11-21' },
  }, 201)).data;
  const overdue = await request('/sales/overdue?due_day=1', { headers });
  assert.equal(overdue.data[0].sale_id, sale.id);
  assert.equal(overdue.data[0].overdue_amount, 1800);
  const followUp = await request('/sales/follow-up?day=20', { headers });
  assert.equal(followUp.data[0].latest_note.id, note.id);
  assert.equal(followUp.data[0].latest_note.follow_up_date, '2026-11-21');

  const final = (await request(`/sales/${sale.id}/payments`, {
    method: 'POST', headers,
    body: { amount: 1800, payment_date: PAYMENT_DATE, payment_method: 'فودافون_كاش' },
  }, 201)).data;
  assert.equal(final.payment.payment_method, 'فودافون كاش');
  assert.equal(final.summary.total_paid, 2800);
  assert.equal(final.summary.remaining_balance, 0);
  assert.equal(final.summary.is_completed, true);
  assert.equal(final.summary.sale_status, 'منتهي');
  const settled = (await request(`/sales/${sale.id}`, { headers })).data;
  assert.equal(settled.payments.length, 2);
  assert.equal(settled.notes[0].id, note.id);
  assert.equal(settled.remaining_amount, 0);
  assert.equal((await request('/sales/overdue', { headers })).pagination.total, 0);
  assert.equal((await request('/sales/follow-up?day=20', { headers })).data.length, 0);
  await request(`/sales/${sale.id}/status`, { method: 'PATCH', headers: adminHeaders, body: { status: 'حالي' } }, 400);

  const daily = await request(`/sales/daily-summary?date=${PAYMENT_DATE}`, { headers });
  assert.deepEqual(daily.summary, {
    total_amount: 2800, payments_count: 2,
    cash: { total: 1000, count: 1 }, vodafone_cash: { total: 1800, count: 1 },
  });
  assert.equal(daily.by_branch[0].branch_id, 1);
  assert.equal(daily.payments.length, 2);
  assert.equal(pool.inTransaction(), false);
});

test('workflow: authentication, device binding, validation and branch boundaries prevent side effects', async (t) => {
  const { request, employee, pool } = await startWorkflow(t);
  const owner = await employee('owner', 1);
  const outsider = await employee('outsider', 2);
  const customer = (await request('/customers', { method: 'POST', headers: owner, body: customerInput() }, 201)).data;
  const sale = (await request('/sales', { method: 'POST', headers: owner, body: saleInput(customer.id) }, 201)).data;
  const before = pool.snapshot();
  const callsBefore = pool.calls.length;
  await request('/sales', {}, 401);
  await request(`/sales/${sale.id}`, { headers: { authorization: owner.authorization } }, 401);
  await request(`/sales/${sale.id}`, { headers: { ...owner, 'x-device-id': 'wrong-device' } }, 403);
  await request(`/sales/${sale.id}/payments`, { method: 'POST', headers: owner, body: { amount: -1 } }, 400);
  await request(`/sales/${sale.id}/status`, { method: 'PATCH', headers: owner, body: { status: 'متأخر' } }, 403);
  await request('/auth/register', { method: 'POST', headers: owner, body: {} }, 403);
  assert.equal(pool.calls.length, callsBefore, 'auth/validation failures never reach the business database');
  await request(`/sales/${sale.id}`, { headers: outsider }, 404);
  assert.equal((await request('/sales', { headers: outsider })).pagination.total, 0);
  for (const [suffix, body] of [
    ['payments', { amount: 500, payment_date: PAYMENT_DATE }],
    ['notes', { content: 'محاولة فرع آخر' }],
  ]) {
    await request(`/sales/${sale.id}/${suffix}`, { method: 'POST', headers: outsider, body }, 403);
  }
  assert.deepEqual(pool.snapshot(), before);
  assert.equal(pool.inTransaction(), false);
});

test('workflow: failed nested insert rolls back customer counter, sale and guarantor instead of leaving partial records', async (t) => {
  const { request, employee, pool } = await startWorkflow(t);
  const headers = await employee();
  let before = pool.snapshot();
  pool.failNext('INSERT INTO phone_numbers');
  await request('/customers', { method: 'POST', headers, body: customerInput() }, 500);
  assert.deepEqual(pool.snapshot(), before, 'customer and branch counter roll back with the failed phone');
  const customer = (await request('/customers', { method: 'POST', headers, body: customerInput() }, 201)).data;
  before = pool.snapshot();
  pool.failNext('INSERT INTO phone_numbers');
  await request('/sales', { method: 'POST', headers, body: saleInput(customer.id) }, 500);
  assert.deepEqual(pool.snapshot(), before, 'sale and guarantor roll back with the failed guarantor phone');
  assert.equal(pool.inTransaction(), false);
  const sale = (await request('/sales', { method: 'POST', headers, body: saleInput(customer.id) }, 201)).data;
  before = pool.snapshot();
  pool.failNext('INSERT INTO payments');
  await request(`/sales/${sale.id}/payments`, { method: 'POST', headers, body: { amount: 500 } }, 500);
  assert.deepEqual(pool.snapshot(), before, 'failed collection cannot change balance or invoice status');
  assert.equal(pool.inTransaction(), false);
});

function createStatefulPool() {
  let state = {
    branches: [{ id: 1, name: 'فرع اختبار أول', code_prefix: '1', last_number: 1000 }, { id: 2, name: 'فرع اختبار ثان', code_prefix: '2', last_number: 2000 }],
    customers: [], customer_addresses: [], phone_numbers: [], sales: [], guarantors: [], payments: [], sale_notes: [],
  };
  let transaction = null;
  let failure = null;
  const calls = [];
  const copy = (value) => structuredClone(value);
  const rows = (items) => ({ rows: copy(items) });
  const param = (sql, expression, values) => {
    const match = expression.exec(sql);
    return match ? values[Number(match[1]) - 1] : undefined;
  };
  function project(sale) {
    const payments = state.payments.filter((p) => p.sale_id === sale.id);
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const required = Math.max(0, sale.monthly_installment * sale.installments_count - sale.discount_amount);
    const customer = state.customers.find((c) => c.id === sale.customer_id);
    const notes = state.sale_notes.filter((n) => n.sale_id === sale.id).sort((a, b) => b.id - a.id);
    const guarantors = state.guarantors.filter((g) => g.sale_id === sale.id).map((g) => ({ ...g, phones: state.phone_numbers.filter((p) => p.guarantor_id === g.id) }));
    return {
      ...sale, sale_id: sale.id,
      branch: state.branches.find((b) => b.id === sale.branch_id),
      customer: { ...customer, phones: state.phone_numbers.filter((p) => p.customer_id === customer.id) },
      address: state.customer_addresses.find((a) => a.id === sale.address_id) ?? null,
      guarantors, payments, notes, latest_note: notes[0] ?? null,
      total_paid: totalPaid, required_installments_total: required,
      remaining_amount: Math.max(0, required - totalPaid),
      // Fixtures are deliberately fully matured. Date arithmetic belongs to the SQL gate.
      due_installments: sale.installments_count, due_amount: required, overdue_amount: Math.max(0, required - totalPaid),
    };
  }
  function summary(payments) {
    const total = (method) => payments.filter((p) => !method || p.payment_method === method).reduce((s, p) => s + p.amount, 0);
    return {
      total_amount: total(), payments_count: payments.length,
      cash_total: total('كاش'), cash_count: payments.filter((p) => p.payment_method === 'كاش').length,
      vodafone_cash_total: total('فودافون كاش'), vodafone_cash_count: payments.filter((p) => p.payment_method === 'فودافون كاش').length,
    };
  }
  async function query(rawSql, values = []) {
    const sql = rawSql.trim().replace(/\s+/g, ' ');
    calls.push({ sql, values: copy(values) });
    if (failure && sql.startsWith(failure)) { failure = null; throw new Error('Injected workflow persistence failure'); }
    if (sql === 'BEGIN') { assert.equal(transaction, null, 'fixture supports sequential transactions only'); transaction = copy(state); return rows([]); }
    if (sql === 'COMMIT') { assert.notEqual(transaction, null); transaction = null; return rows([]); }
    if (sql === 'ROLLBACK') { assert.notEqual(transaction, null); state = transaction; transaction = null; return rows([]); }
    if (sql.startsWith('UPDATE branches ')) {
      const branch = state.branches.find((b) => b.id === values[0]);
      if (branch) branch.last_number++;
      return rows(branch ? [branch] : []);
    }
    const insert = /^INSERT INTO (\w+) \(([^)]+)\)/.exec(sql);
    if (insert) {
      const [, table, columns] = insert;
      assert(Array.isArray(state[table]), `Unhandled fixture table: ${table}`);
      if (table === 'sales' && state.sales.some((s) => s.invoice_number === values[0])) {
        throw Object.assign(new Error('duplicate invoice'), { code: '23505', constraint: 'sales_invoice_number_key' });
      }
      const record = { id: state[table].length + 1 };
      let index = 0;
      for (const field of columns.split(',').map((s) => s.trim())) {
        record[field] = field === 'created_at' || field === 'updated_at' ? '2026-11-20T10:00:00.000Z'
          : field === 'is_current' ? true : values[index++];
      }
      state[table].push(record);
      return rows([record]);
    }
    if (sql.startsWith('SELECT id FROM customers WHERE')) return rows(state.customers.filter((c) => c.id === values[0]));
    if (sql.startsWith('SELECT id FROM customer_addresses WHERE')) return rows(state.customer_addresses.filter((a) => a.customer_id === values[0] && a.is_current).slice(0, 1));
    if (sql.startsWith('SELECT name FROM branches WHERE')) return rows(state.branches.filter((b) => b.id === values[0]));
    if (sql.startsWith('SELECT COALESCE(SUM(amount), 0) AS total_paid')) return rows([{ total_paid: state.payments.filter((p) => p.sale_id === values[0]).reduce((s, p) => s + p.amount, 0) }]);
    if (sql.startsWith('UPDATE sales SET status')) {
      const automatic = sql.includes("status = 'منتهي'");
      const sale = state.sales.find((s) => s.id === values[automatic ? 0 : 1]);
      if (sale) sale.status = automatic ? 'منتهي' : values[0];
      return rows(sale ? [sale] : []);
    }
    if (/^SELECT id, invoice_number, branch_id.* FROM sales WHERE /.test(sql)) {
      const sale = state.sales.find((s) => sql.includes('WHERE id = $1')
        ? s.id === values[0] || s.invoice_number.toLowerCase() === String(values[1]).toLowerCase()
        : s.invoice_number.toLowerCase() === String(values[0]).toLowerCase());
      return rows(sale ? [sale] : []);
    }
    if (sql.startsWith('SELECT s.*,') && sql.includes('FROM sales s LEFT JOIN sale_balances')) {
      const branch = param(sql, /s\.branch_id = \$(\d+)/, values);
      const sale = state.sales.find((s) => (sql.includes('WHERE LOWER(s.invoice_number)')
        ? s.invoice_number.toLowerCase() === String(values[0]).toLowerCase() : s.id === values[0]) && (branch === undefined || s.branch_id === branch));
      return rows(sale ? [project(sale)] : []);
    }
    if (sql.includes('FROM sale_balances sb')) {
      let found = state.sales.map(project);
      const branch = param(sql, /sb\.branch_id = \$(\d+)/, values);
      const day = param(sql, /sb\.due_day (?:=|<=) \$(\d+)/, values);
      const status = param(sql, /sb\.status = \$(\d+)/, values);
      const invoice = param(sql, /LOWER\(sb\.invoice_number\) = LOWER\(\$(\d+)\)/, values);
      if (branch !== undefined) found = found.filter((s) => s.branch_id === branch);
      if (status !== undefined) found = found.filter((s) => s.status === status);
      if (invoice !== undefined) found = found.filter((s) => s.invoice_number.toLowerCase() === String(invoice).toLowerCase());
      if (sql.includes('sb.overdue_amount > 0')) found = found.filter((s) => s.overdue_amount > 0 && !['منتهي', 'منتهى'].includes(s.status));
      if (day !== undefined) found = found.filter((s) => sql.includes('sb.due_day <=') ? s.due_day <= day : s.due_day === day);
      if (sql.startsWith('SELECT COUNT(*)')) return rows([{ total: String(found.length) }]);
      const limit = param(sql, /LIMIT \$(\d+)/, values);
      const offset = param(sql, /OFFSET \$(\d+)/, values) || 0;
      return rows(found.slice(offset, offset + limit));
    }
    if (sql.includes('FROM payments p JOIN sales s')) {
      const branch = param(sql, /COALESCE\(p\.collection_branch_id, s\.branch_id\) = \$(\d+)/, values);
      const payments = state.payments.filter((p) => p.payment_date === values[0] && (branch === undefined || p.collection_branch_id === branch));
      if (sql.includes('GROUP BY')) {
        return rows([...new Set(payments.map((p) => p.collection_branch_id))].map((branchId) => ({
          branch_id: branchId, branch_name: state.branches.find((b) => b.id === branchId).name,
          ...summary(payments.filter((p) => p.collection_branch_id === branchId)),
        })));
      }
      if (sql.includes('SUM(p.amount)')) return rows([summary(payments)]);
      return rows(payments);
    }
    throw new Error(`Unhandled workflow fixture SQL: ${sql.slice(0, 180)}`);
  }
  return {
    query, calls, snapshot: () => copy(state), inTransaction: () => transaction !== null,
    failNext(prefix) { failure = prefix; },
    async connect() { return { query, release() { assert.equal(transaction, null, 'transaction must finish before release'); } }; },
  };
}
