const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSaleRoutes } = require('../src/routes/sale.route');
const { createProtect } = require('../src/middlewares/auth.middleware');
const { createJwtTokens } = require('../src/auth/infrastructure/credentials');
const { createAuthUseCases } = require('../src/auth/application/use-cases');

async function withServer(pool, options, run) {
  const tokens = createJwtTokens('sale-search-test-secret-123456');
  const deviceId = 'sale-search-device';
  const session = {
    id: '44444444-4444-4444-8444-444444444444',
    username: 'sale-searcher',
    role: options.role ?? 'employee',
    branchId: options.branchId === undefined ? 2 : options.branchId,
    deviceId,
  };
  session.token = tokens.issue({ id: session.id, role: session.role, deviceId });
  const auth = createAuthUseCases({
    users: { async findSession(id) { return id === session.id ? session : null; } },
    tokens,
    passwords: {},
  });
  const app = express();
  app.use('/api/sales', createSaleRoutes(pool, createProtect(auth)));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    await run({
      baseUrl: `http://127.0.0.1:${server.address().port}/api/sales`,
      headers: { authorization: `Bearer ${session.token}`, 'x-device-id': deviceId },
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function summary(overrides = {}) {
  return {
    sale_id: 50,
    invoice_number: 'A116',
    branch_id: 2,
    branch_name: 'الإصلاح',
    customer_id: 10,
    customer_code: '2000010',
    customer_name: 'أحمد علي',
    primary_phone: '01012345678',
    item_details: 'ثلاجة',
    monthly_installment: '1000.00',
    installments_count: 5,
    first_installment_date: '2026-11-01',
    due_day: 1,
    total_paid: '1000.00',
    required_installments_total: '5000.00',
    remaining_amount: '4000.00',
    due_installments: 1,
    due_amount: '1000.00',
    overdue_amount: '0.00',
    status: 'active',
    guarantors: [{ name: 'محمد السيد', phones: [{ phone: '01112345678' }] }],
    ...overrides,
  };
}

// This records the database boundary; SQL behavior itself needs PostgreSQL.
function createPool(rows, { total = rows.length, details = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('COUNT(*)')) return { rows: [{ total }] };
      if (/FROM sales s\b/.test(sql)) return { rows: details ? [details] : [] };
      return { rows };
    },
  };
}

function assertSummaryQuery(sql) {
  assert.match(sql, /AS guarantors/);
  assert.match(sql, /g\.sale_id\s*=\s*sb\.sale_id/);
  assert.match(sql, /gpn\.guarantor_id\s*=\s*g\.id/);
  assert.match(sql, /'name',\s*g\.name/);
  assert.match(sql, /'phone',\s*gpn\.phone/);
  assert.doesNotMatch(sql, /'(?:id|sale_id|created_at|is_primary|label)'\s*,/);
  assert.doesNotMatch(sql, /AS (?:payments|notes|address|customer_phones)\b/);
  assert.doesNotMatch(sql, /FROM (?:payments|sale_notes)\b/);
}

test('sale search binds invoice, normalized customer name, customer code and phone through q', async () => {
  const row = summary();
  const pool = createPool([row]);
  const cases = [
    [' A١١٦ ', '%A116%', 'A116', '%a116%'],
    ['أَحْمَد', '%أَحْمَد%', 'أَحْمَد', '%احمد%'],
    ['٢٠٠٠٠١٠', '%2000010%', '2000010', '%2000010%'],
    ['٠١٠١٢٣٤٥٦٧٨', '%01012345678%', '01012345678', '%01012345678%'],
  ];
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    for (const [q, ...expectedSearchParams] of cases) {
      const response = await fetch(`${baseUrl}?${new URLSearchParams({ q })}`, { headers });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data, [row]);
      const [count, data] = pool.calls.slice(-2);
      assert.deepEqual(count.params, [2, ...expectedSearchParams]);
      assert.deepEqual(data.params, [2, ...expectedSearchParams, 20, 0]);
      assert.match(count.sql, /sb\.invoice_number ILIKE \$2/);
      assert.match(count.sql, /c\.name ILIKE \$2/);
      assert.match(count.sql, /c\.normalized_name ILIKE \$4/);
      assert.match(count.sql, /c\.customer_code = \$3/);
      assert.match(count.sql, /pn\.customer_id = sb\.customer_id AND pn\.phone ILIKE \$2/);
      assertSummaryQuery(data.sql);
    }
  });
});

test('invoice-number search returns the same summary as q and its sale_id opens full details', async () => {
  const row = summary();
  const details = {
    id: row.sale_id,
    invoice_number: row.invoice_number,
    branch_id: 2,
    customer_id: 10,
    cash_price: '5000.00',
    down_payment: '1000.00',
    branch: { id: 2, name: 'الإصلاح' },
    customer: { id: 10, name: row.customer_name, phones: [{ id: 1, phone: row.primary_phone }] },
    address: { id: 3, area: 'العجمي', address_details: 'شارع السوق' },
    guarantors: [{ id: 7, sale_id: 50, name: 'محمد السيد', phones: [{ id: 8, phone: '01112345678', is_primary: true }] }],
    payments: [{ id: 9, sale_id: 50, amount: '1000.00', payment_date: '2026-11-27' }],
    notes: [{ id: 11, sale_id: 50, note_type: 'call', content: 'تم التواصل' }],
    remaining_amount: '4000.00',
  };
  const pool = createPool([row], { details });
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    let expectedBody;
    for (const query of [{ q: 'A116' }, { invoice_number: ' a١١٦ ' }]) {
      const response = await fetch(`${baseUrl}?${new URLSearchParams(query)}`, { headers });
      assert.equal(response.status, 200);
      const body = await response.json();
      if (expectedBody) assert.deepEqual(body, expectedBody);
      expectedBody = body;
      assertSummaryQuery(pool.calls.at(-1).sql);
      assert.equal(body.data[0].payments, undefined);
      assert.equal(body.data[0].notes, undefined);
      assert.equal(body.data[0].address, undefined);
      assert.deepEqual(Object.keys(body.data[0].guarantors[0]).sort(), ['name', 'phones']);
      assert.deepEqual(Object.keys(body.data[0].guarantors[0].phones[0]), ['phone']);
    }
    assert.deepEqual(pool.calls.at(-2).params, [2, 'a116']);
    assert.match(pool.calls.at(-2).sql, /LOWER\(sb\.invoice_number\) = LOWER\(\$2\)/);
    const response = await fetch(`${baseUrl}/${expectedBody.data[0].sale_id}`, { headers });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data, { ...details, guarantor: details.guarantors[0] });
    assert.equal(body.pagination, undefined);
    assert.deepEqual(pool.calls.at(-1).params, [50, 2]);
    assert.match(pool.calls.at(-1).sql, /s\.\*/);
    for (const relation of ['customer', 'address', 'guarantors', 'payments', 'notes']) {
      assert.match(pool.calls.at(-1).sql, new RegExp(`AS ${relation}\\b`));
    }
  });
});

test('customer search results keep each invoice guarantors separate and preserve absent phone data', async () => {
  const rows = [
    summary({ sale_id: 53, invoice_number: 'A119', guarantors: [] }),
    summary({ sale_id: 52, invoice_number: 'A118', guarantors: [{ name: 'محمود علي', phones: [] }] }),
    summary({
      guarantors: [
        { name: 'محمد السيد', phones: [{ phone: '01112345678' }, { phone: '01212345678' }] },
        { name: 'علي إبراهيم', phones: [{ phone: '01512345678' }] },
      ],
    }),
  ];
  const pool = createPool(rows);
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    const response = await fetch(`${baseUrl}?${new URLSearchParams({ q: 'أحمد' })}`, { headers });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data, rows);
    assert.equal(body.guarantors, undefined);
    assert.deepEqual(body.pagination, { total: 3, page: 1, limit: 20, totalPages: 1 });
    assertSummaryQuery(pool.calls.at(-1).sql);
    assert.match(pool.calls.at(-1).sql, /'\[\]'::json\) AS guarantors/);
  });
});

test('sale search uses employee branch over requested branch and applies pagination to both filters', async () => {
  const pool = createPool([summary()], { total: 5 });
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    const response = await fetch(`${baseUrl}?q=A116&branch_id=99&page=2&limit=2`, { headers });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.pagination, { total: 5, page: 2, limit: 2, totalPages: 3 });
  });
  assert.deepEqual(pool.calls[0].params, [2, '%A116%', 'A116', '%a116%']);
  assert.deepEqual(pool.calls[1].params, [2, '%A116%', 'A116', '%a116%', 2, 2]);
  for (const call of pool.calls) assert.match(call.sql, /WHERE sb\.branch_id = \$1 AND \(/);
  assert.match(pool.calls[1].sql, /LIMIT \$5 OFFSET \$6/);

  const adminPool = createPool([], { total: 0 });
  await withServer(adminPool, { role: 'admin', branchId: null }, async ({ baseUrl, headers }) => {
    const response = await fetch(`${baseUrl}?invoice_number=A116&branch_id=99`, { headers });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data, []);
    assert.deepEqual(body.pagination, { total: 0, page: 1, limit: 20, totalPages: 1 });
  });
  assert.deepEqual(adminPool.calls[0].params, [99, 'A116']);
  for (const call of adminPool.calls) assert.match(call.sql, /WHERE sb\.branch_id = \$1 AND LOWER\(sb\.invoice_number\)/);
});

test('sale search validates query bounds before database access and binds SQL-looking search text', async () => {
  const pool = createPool([]);
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    for (const query of ['page=0', 'limit=101', 'branch_id=-1', `q=${'a'.repeat(101)}`, `invoice_number=${'a'.repeat(51)}`]) {
      const response = await fetch(`${baseUrl}?${query}`, { headers });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).success, false);
    }
    assert.equal(pool.calls.length, 0);
    const q = "A116' OR 1=1 --";
    const response = await fetch(`${baseUrl}?${new URLSearchParams({ q })}`, { headers });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, []);
    for (const call of pool.calls) {
      assert.equal(call.sql.includes(q), false);
      assert.ok(call.params.includes(q));
      assert.ok(call.params.includes(`%${q}%`));
    }
  });
});
