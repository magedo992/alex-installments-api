const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSaleRoutes } = require('../src/routes/sale.route');
const { createProtect } = require('../src/middlewares/auth.middleware');
const { createJwtTokens } = require('../src/auth/infrastructure/credentials');
const { createAuthUseCases } = require('../src/auth/application/use-cases');

function createAuthFixture({ role = 'employee', branchId = 2 } = {}) {
  const tokens = createJwtTokens('invoice-detail-test-secret-123456');
  const deviceId = 'invoice-details-device';
  const session = {
    id: '33333333-3333-4333-8333-333333333333',
    username: 'invoice-reader',
    role,
    branchId,
    deviceId,
  };
  // The stored session must take precedence over a stale branch in the token.
  session.token = tokens.issue({ id: session.id, role, branch_id: 99, deviceId });
  const auth = createAuthUseCases({
    users: { async findSession(id) { return id === session.id ? session : null; } },
    tokens,
    passwords: {},
  });
  return {
    auth,
    headers: { authorization: `Bearer ${session.token}`, 'x-device-id': deviceId },
  };
}

async function withServer(pool, authOptions, run) {
  const { auth, headers } = createAuthFixture(authOptions);
  const app = express();
  app.use('/api/sales', createSaleRoutes(pool, createProtect(auth)));
  app.use((error, req, res, next) => {
    res.status(500).json({ success: false, message: 'Unexpected middleware failure' });
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/sales`;
  try {
    await run({ baseUrl, headers });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function invoice(overrides = {}) {
  return {
    id: 42,
    invoice_number: 'A116',
    branch_id: 2,
    customer_id: 10,
    address_id: 5,
    item_details: 'ثلاجة',
    cash_price: '12000.00',
    down_payment: '2000.00',
    monthly_installment: '1000.00',
    installments_count: 12,
    discount_amount: '0.00',
    total_amount: '14000.00',
    delivery_date: '2026-11-25',
    first_installment_date: '2026-12-01',
    due_day: 1,
    collection_type: 'فرع',
    status: 'active',
    created_at: '2026-11-25T10:00:00.000Z',
    updated_at: '2026-11-25T10:00:00.000Z',
    branch: { id: 2, name: 'الإصلاح' },
    customer: {
      id: 10,
      customer_code: '3000010',
      name: 'أحمد محمود',
      phones: [{ id: 11, phone: '01012345678', is_primary: true, label: 'شخصي' }],
    },
    address: { id: 5, area: 'العجمي', housing_type: 'ملك', address_details: 'شارع السوق' },
    guarantors: [{
      id: 70,
      sale_id: 42,
      name: 'محمد علي',
      created_at: '2026-11-25T10:00:00.000Z',
      phones: [{ id: 80, phone: '01112345678', is_primary: true, label: 'موبايل' }],
    }],
    payments: [{ id: 21, sale_id: 42, amount: '1000.00', payment_month: '2026-12-01' }],
    notes: [{ id: 31, sale_id: 42, note_type: 'call', content: 'تم التواصل' }],
    total_paid: '1000.00',
    required_installments_total: '12000.00',
    remaining_amount: '11000.00',
    due_installments: 0,
    due_amount: '0.00',
    overdue_amount: '0.00',
    ...overrides,
  };
}

// Model identifier and branch predicates so an omitted branch condition exposes
// the foreign row and makes the HTTP isolation assertions fail.
function createScopedPool(records) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const byInvoice = /LOWER\s*\(\s*s\.invoice_number\s*\)/i.test(sql);
      assert.match(sql, /FROM\s+sales\s+s\b/i);
      if (!byInvoice) assert.match(sql, /s\.id\s*=\s*\$1\b/);
      const scope = /s\.branch_id\s*=\s*\$(\d+)/.exec(sql);
      const match = records.find((row) => {
        const identifierMatches = byInvoice
          ? row.invoice_number.toLowerCase() === String(params[0]).toLowerCase()
          : row.id === Number(params[0]);
        return identifierMatches && (!scope || row.branch_id === Number(params[Number(scope[1]) - 1]));
      });
      return { rows: match ? [match] : [] };
    },
  };
}

test('invoice details require authentication and the matching device before reading data', async () => {
  const pool = createScopedPool([invoice()]);
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    for (const path of ['/42', '/by-invoice/A116']) {
      assert.equal((await fetch(`${baseUrl}${path}`)).status, 401);
      assert.equal((await fetch(`${baseUrl}${path}`, {
        headers: { authorization: headers.authorization },
      })).status, 401);
      assert.equal((await fetch(`${baseUrl}${path}`, {
        headers: { ...headers, 'x-device-id': 'another-device' },
      })).status, 403);
    }
  });
  assert.equal(pool.calls.length, 0);
});

test('GET invoice details returns the invoice, guarantors, phones, payments and balances in one query', async () => {
  const row = invoice();
  const pool = createScopedPool([row]);
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    const response = await fetch(`${baseUrl}/42`, { headers });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.id, 42);
    assert.equal(body.data.item_details, 'ثلاجة');
    assert.equal(body.data.branch.name, 'الإصلاح');
    assert.equal(body.data.customer.customer_code, '3000010');
    assert.equal(body.data.customer.phones[0].phone, '01012345678');
    assert.equal(body.data.address.address_details, 'شارع السوق');
    assert.deepEqual(body.data.guarantors, row.guarantors);
    assert.deepEqual(body.data.guarantor, row.guarantors[0]);
    assert.deepEqual(body.data.payments, row.payments);
    assert.deepEqual(body.data.notes, row.notes);
    assert.equal(Number(body.data.remaining_amount), 11000);
    assert.equal(body.pagination, undefined);
  });
  assert.equal(pool.calls.length, 1);
  assert.deepEqual(pool.calls[0].params, [42, 2]);
});

test('invoice details represent absent optional relationships with null and empty arrays', async () => {
  const pool = createScopedPool([invoice({ guarantors: [], payments: [], notes: [], address: null })]);
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    const response = await fetch(`${baseUrl}/42`, { headers });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.guarantor, null);
    assert.deepEqual(data.guarantors, []);
    assert.deepEqual(data.payments, []);
    assert.deepEqual(data.notes, []);
    assert.equal(data.address, null);
  });
});

test('invoice details normalize Arabic digits for internal ids and invoice numbers', async () => {
  const pool = createScopedPool([invoice()]);
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    const idResponse = await fetch(`${baseUrl}/${encodeURIComponent('٤٢')}`, { headers });
    assert.equal(idResponse.status, 200);
    assert.equal((await idResponse.json()).data.id, 42);
    const invoiceResponse = await fetch(`${baseUrl}/by-invoice/${encodeURIComponent(' a١١٦ ')}`, { headers });
    assert.equal(invoiceResponse.status, 200);
    assert.equal((await invoiceResponse.json()).data.id, 42);
  });
  assert.deepEqual(pool.calls[0].params, [42, 2]);
  assert.deepEqual(pool.calls[1].params, ['a116', 2]);
});

test('numeric invoice numbers and internal ids select different invoices deterministically', async () => {
  const pool = createScopedPool([
    invoice({ id: 42, invoice_number: 'A116' }),
    invoice({ id: 55, invoice_number: '42' }),
  ]);
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    const byId = await fetch(`${baseUrl}/42`, { headers });
    assert.equal(byId.status, 200);
    assert.equal((await byId.json()).data.id, 42);
    const byInvoice = await fetch(`${baseUrl}/by-invoice/42`, { headers });
    assert.equal(byInvoice.status, 200);
    assert.equal((await byInvoice.json()).data.id, 55);
  });
  assert.doesNotMatch(pool.calls[0].sql, /LOWER\s*\(\s*s\.invoice_number\s*\)/i);
  assert.doesNotMatch(pool.calls[1].sql, /s\.id\s*=\s*\$1\b/);
  assert.deepEqual(pool.calls[0].params, [42, 2]);
  assert.deepEqual(pool.calls[1].params, ['42', 2]);
});

test('invoice lookup binds SQL-looking invoice numbers as a value', async () => {
  const maliciousNumber = "INV' OR 1=1 --";
  const pool = createScopedPool([invoice({ invoice_number: maliciousNumber })]);
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    const response = await fetch(`${baseUrl}/by-invoice/${encodeURIComponent(maliciousNumber)}`, { headers });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.invoice_number, maliciousNumber);
  });
  assert.equal(pool.calls.length, 1);
  assert.equal(pool.calls[0].sql.includes(maliciousNumber), false);
  assert.deepEqual(pool.calls[0].params, [maliciousNumber, 2]);
});

test('invoice details reject invalid ids and empty or oversized invoice numbers before querying', async () => {
  const pool = createScopedPool([]);
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    for (const value of ['0', '-1', '1.5', '1e2', 'A116', '9007199254740992', '  ']) {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(value)}`, { headers });
      assert.equal(response.status, 400, `invalid internal id ${value}`);
      const body = await response.json();
      assert.equal(body.success, false);
      assert.ok(body.errors.some((issue) => issue.field === 'id'));
    }
    for (const value of ['  ', 'A'.repeat(51)]) {
      const response = await fetch(`${baseUrl}/by-invoice/${encodeURIComponent(value)}`, { headers });
      assert.equal(response.status, 400, 'invalid invoice number');
      const body = await response.json();
      assert.ok(body.errors.some((issue) => issue.field === 'invoice_number'));
    }
  });
  assert.equal(pool.calls.length, 0);
});

test('invoice details use the session branch despite query parameters or stale token claims', async () => {
  const pool = createScopedPool([invoice()]);
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    for (const path of ['/42', '/by-invoice/A116']) {
      const response = await fetch(`${baseUrl}${path}?branch_id=1`, { headers });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.branch_id, 2);
    }
  });
  assert.equal(pool.calls.length, 2);
  for (const call of pool.calls) {
    assert.match(call.sql, /s\.branch_id\s*=\s*\$2\b/);
    assert.equal(call.params[1], 2);
  }
});

test('foreign-branch invoices and missing invoices both return the same 404 response', async () => {
  const pool = createScopedPool([invoice({ branch_id: 1 })]);
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    let expected;
    for (const path of ['/42?branch_id=1', '/by-invoice/A116?branch_id=1', '/999', '/by-invoice/missing']) {
      const response = await fetch(`${baseUrl}${path}`, { headers });
      assert.equal(response.status, 404);
      const body = await response.json();
      assert.equal(body.success, false);
      assert.equal(body.data, undefined);
      if (!expected) expected = body;
      else assert.deepEqual(body, expected);
    }
  });
});

test('unassigned admins and accountants can read across branches', async () => {
  for (const role of ['admin', 'accountant']) {
    const pool = createScopedPool([invoice({ branch_id: 1 })]);
    await withServer(pool, { role, branchId: null }, async ({ baseUrl, headers }) => {
      for (const path of ['/42', '/by-invoice/A116']) {
        const response = await fetch(`${baseUrl}${path}`, { headers });
        assert.equal(response.status, 200, role);
        assert.equal((await response.json()).data.branch_id, 1);
      }
    });
    for (const call of pool.calls) {
      assert.equal(call.params.length, 1);
      assert.doesNotMatch(call.sql, /s\.branch_id\s*=/);
    }
  }
});

test('admins assigned to a branch remain restricted to that branch', async () => {
  const pool = createScopedPool([invoice({ branch_id: 1 })]);
  await withServer(pool, { role: 'admin', branchId: 2 }, async ({ baseUrl, headers }) => {
    const response = await fetch(`${baseUrl}/42?branch_id=1`, { headers });
    assert.equal(response.status, 404);
  });
  assert.deepEqual(pool.calls[0].params, [42, 2]);
});

test('employees without a branch cannot obtain unscoped invoice details', async () => {
  const pool = createScopedPool([invoice()]);
  await withServer(pool, { role: 'employee', branchId: null }, async ({ baseUrl, headers }) => {
    for (const path of ['/42?branch_id=2', '/by-invoice/A116?branch_id=2']) {
      const response = await fetch(`${baseUrl}${path}`, { headers });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).success, false);
    }
  });
  assert.equal(pool.calls.length, 0);
});

test('invoice details conceal database error messages from the response', async () => {
  const internalMessage = 'password=secret SELECT guarantors FROM private_database';
  const pool = { async query() { throw new Error(internalMessage); } };
  await withServer(pool, {}, async ({ baseUrl, headers }) => {
    const response = await fetch(`${baseUrl}/42`, { headers });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(JSON.stringify(body).includes(internalMessage), false);
    assert.equal(body.data, undefined);
    assert.equal(body.stack, undefined);
  });
});
