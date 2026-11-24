const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createSaleRoutes } = require('../src/routes/sale.route');
const { createProtect } = require('../src/middlewares/auth.middleware');
const { createJwtTokens } = require('../src/auth/infrastructure/credentials');
const { createAuthUseCases } = require('../src/auth/application/use-cases');
const { firstOfMonth } = require('../src/lib/date-helpers');

function createTestApp(poolMock, auth) {
  const app = express();
  app.use(express.json());
  const protect = createProtect(auth);
  app.use('/api/sales', createSaleRoutes(poolMock, protect));
  return app;
}

function createAuthFixture({ role = 'employee', branchId = null } = {}) {
  const tokens = createJwtTokens('test-secret-key-123456');
  const userId = '22222222-2222-4222-8222-222222222222';
  let session = {
    id: userId,
    username: 'sales-tester',
    email: 'sales@test.com',
    role,
    token: null,
    deviceId: 'device-sales-100',
    branchId,
  };

  const users = {
    async findSession(id) {
      return session.id === id ? session : null;
    },
    async replaceToken(id, prev, nextToken, devId) {
      session.token = nextToken;
      session.deviceId = devId;
      return true;
    },
  };

  const auth = createAuthUseCases({
    users,
    tokens,
    passwords: { hash: async (p) => p, matches: async (p, h) => p === h },
  });

  const validToken = tokens.issue({ id: userId, username: 'sales-tester', role, deviceId: 'device-sales-100' });
  session.token = validToken;

  return { auth, validToken, deviceId: 'device-sales-100' };
}

test('firstOfMonth helper correctly extracts the first day of the month', () => {
  assert.equal(firstOfMonth('2026-11-24'), '2026-11-01');
  assert.equal(firstOfMonth('2026-01-15'), '2026-01-01');
  assert.equal(firstOfMonth(new Date('2026-05-20T10:00:00Z')), '2026-05-01');
});

test('POST /api/sales rejects unauthenticated requests', async () => {
  const { auth } = createAuthFixture();
  const app = createTestApp({}, auth);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/sales`;

  try {
    const res = await fetch(baseUrl, { method: 'POST', body: JSON.stringify({}) });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('POST /api/sales creates sale with transaction and applies branch rules', async () => {
  const { auth, validToken, deviceId } = createAuthFixture({ role: 'employee', branchId: 2 });

  let capturedBranchId = null;
  let insertedGuarantor = false;
  let insertedGPhone = false;

  const fakeClient = {
    async query(sql, params) {
      if (sql.includes('SELECT id FROM customers')) {
        return { rows: [{ id: 10 }] };
      }
      if (sql.includes('SELECT id FROM customer_addresses')) {
        return { rows: [{ id: 5 }] };
      }
      if (sql.includes('INSERT INTO sales')) {
        capturedBranchId = params[1];
        return {
          rows: [
            {
              id: 50,
              invoice_number: params[0],
              branch_id: params[1],
              customer_id: params[2],
              address_id: params[3],
              item_details: params[4],
              cash_price: params[5],
              down_payment: params[6],
              monthly_installment: params[7],
              installments_count: params[8],
              discount_amount: params[9],
              total_amount: params[10],
              delivery_date: params[11],
              first_installment_date: params[12],
              due_day: params[13],
              collection_type: params[14],
              status: params[15],
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO guarantors')) {
        insertedGuarantor = true;
        return { rows: [{ id: 70, sale_id: 50, name: params[1] }] };
      }
      if (sql.includes('INSERT INTO phone_numbers')) {
        insertedGPhone = true;
        return { rows: [{ id: 80, phone: params[1], is_primary: params[2], label: params[3] }] };
      }
      return { rows: [] };
    },
    release() {},
  };

  const poolMock = {
    async connect() {
      return fakeClient;
    },
  };

  const app = createTestApp(poolMock, auth);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/sales`;

  try {
    const payload = {
      invoice_number: 'INV-TEST-001',
      branch_id: 1,
      customer_id: 10,
      item_details: 'ثلاجة شارب 16 قدم',
      cash_price: 15000,
      down_payment: 3000,
      monthly_installment: 1200,
      installments_count: 12,
      discount_amount: 0,
      first_installment_date: '2026-12-05',
      collection_type: 'فرع',
      guarantor: {
        name: 'محمود السيد عبد الله',
        phones: [{ phone: '٠١١١٢٣٤٥٦٧٨', is_primary: true, label: 'موبايل' }],
      },
    };

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(capturedBranchId, 2);
    assert.equal(body.data.branch_id, 2);
    assert.equal(body.data.total_amount, 17400);
    assert.equal(insertedGuarantor, true);
    assert.equal(insertedGPhone, true);
    assert.equal(body.data.guarantor.name, 'محمود السيد عبد الله');
    assert.equal(body.data.guarantor.phones[0].phone, '01112345678');
  } finally {
    server.close();
  }
});

test('POST /api/sales requires branch_id for admin user', async () => {
  const { auth, validToken, deviceId } = createAuthFixture({ role: 'admin', branchId: null });
  const app = createTestApp({}, auth);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/sales`;

  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        invoice_number: 'INV-ADMIN-1',
        customer_id: 10,
        monthly_installment: 500,
        installments_count: 6,
        first_installment_date: '2026-12-01',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.message, /إلزامي/);
  } finally {
    server.close();
  }
});

test('POST /api/sales/:id/payments records payment and updates sale status to completed', async () => {
  const { auth, validToken, deviceId } = createAuthFixture();

  let saleStatus = 'active';
  const targetTotal = 5000;
  let cumulativePaid = 4000;

  const fakeClient = {
    async query(sql, params) {
      if (sql.includes('FROM sales WHERE id = $1 FOR UPDATE')) {
        return {
          rows: [
            {
              id: 1,
              branch_id: 1,
              monthly_installment: 1000,
              installments_count: 5,
              discount_amount: 0,
              status: saleStatus,
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO payments')) {
        cumulativePaid += params[1];
        return {
          rows: [
            {
              id: 99,
              sale_id: params[0],
              amount: params[1],
              payment_month: params[2],
              payment_date: params[3],
              notes: params[4],
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (sql.includes('SELECT COALESCE(SUM(amount), 0) AS total_paid')) {
        return { rows: [{ total_paid: cumulativePaid }] };
      }
      if (sql.includes('UPDATE sales SET status = \'completed\'')) {
        saleStatus = 'completed';
        return { rows: [{ status: 'completed' }] };
      }
      return { rows: [] };
    },
    release() {},
  };

  const poolMock = {
    async connect() {
      return fakeClient;
    },
  };

  const app = createTestApp(poolMock, auth);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/sales/1/payments`;

  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        amount: 1000,
        payment_date: '2026-11-24',
        notes: 'القسط الأخير نقداً',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.payment.amount, 1000);
    assert.equal(body.data.payment.payment_month, '2026-11-01');
    assert.equal(body.data.summary.required_installments_total, 5000);
    assert.equal(body.data.summary.total_paid, 5000);
    assert.equal(body.data.summary.remaining_balance, 0);
    assert.equal(body.data.summary.sale_status, 'completed');
    assert.equal(body.data.summary.is_completed, true);
  } finally {
    server.close();
  }
});

test('GET /api/sales/overdue enforces branch security and returns overdue list', async () => {
  const { auth, validToken, deviceId } = createAuthFixture({ role: 'employee', branchId: 2 });

  let capturedParams = [];
  let capturedSql = '';

  const mockRows = [
    {
      sale_id: 1,
      invoice_number: 'INV-100',
      branch_id: 2,
      branch_name: 'الاصلاح',
      customer_id: 10,
      customer_code: '3000001',
      customer_name: 'أحمد محمود',
      primary_phone: '01012345678',
      item_details: 'غسالة',
      monthly_installment: 1000,
      installments_count: 12,
      first_installment_date: '2026-05-01',
      due_day: 5,
      total_paid: 2000,
      required_installments_total: 12000,
      remaining_amount: 10000,
      due_installments: 7,
      due_amount: 7000,
      overdue_amount: 5000,
      latest_note: {
        id: 1,
        note_type: 'call',
        content: 'وعد بالسداد',
        follow_up_date: '2026-11-28',
        created_at: new Date().toISOString(),
      },
    },
  ];

  const poolMock = {
    async query(sql, params) {
      capturedSql = sql;
      capturedParams = params;
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total: 1 }] };
      }
      return { rows: mockRows };
    },
  };

  const app = createTestApp(poolMock, auth);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/sales/overdue`;

  try {
    const res = await fetch(`${baseUrl}?branch_id=1&due_day=5&page=1&limit=10`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(capturedParams[0], 2);
    assert.equal(capturedParams[1], 5);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].overdue_amount, 5000);
    assert.equal(body.data[0].primary_phone, '01012345678');
    assert.equal(body.data[0].latest_note.note_type, 'call');
    assert.equal(body.pagination.total, 1);
  } finally {
    server.close();
  }
});

test('POST /api/sales/:id/notes records follow-up note with user id and follow_up_date', async () => {
  const { auth, validToken, deviceId } = createAuthFixture();

  let capturedNote = null;
  const poolMock = {
    async query(sql, params) {
      if (sql.includes('FROM sales WHERE id = $1')) {
        return { rows: [{ id: 10, branch_id: 1 }] };
      }
      if (sql.includes('INSERT INTO sale_notes')) {
        capturedNote = {
          sale_id: params[0],
          created_by_user_id: params[1],
          note_type: params[2],
          content: params[3],
          follow_up_date: params[4],
        };
        return {
          rows: [
            {
              id: 99,
              ...capturedNote,
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const app = createTestApp(poolMock, auth);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/sales/10/notes`;

  try {
    const badRes = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({ note_type: 'call' }),
    });
    assert.equal(badRes.status, 400);

    const goodRes = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        content: 'تم التحدث مع العميل وأبلغ أنه مسافر وسيحضر يوم 28',
        note_type: 'call',
        follow_up_date: '2026-11-28',
      }),
    });

    assert.equal(goodRes.status, 201);
    const body = await goodRes.json();
    assert.equal(body.success, true);
    assert.equal(body.data.sale_id, 10);
    assert.equal(body.data.note_type, 'call');
    assert.equal(body.data.follow_up_date, '2026-11-28');
    assert.equal(capturedNote.sale_id, 10);
    assert.equal(capturedNote.follow_up_date, '2026-11-28');
  } finally {
    server.close();
  }
});

test('Validation middleware rejects invalid Egyptian phone, negative amounts, and bad dates', async () => {
  const { auth, validToken, deviceId } = createAuthFixture();
  const app = createTestApp({}, auth);
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const resNegative = await fetch(`http://127.0.0.1:${port}/api/sales`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        invoice_number: 'INV-VALID-01',
        customer_id: 1,
        monthly_installment: -500,
        installments_count: 5,
        first_installment_date: '2026-12-01',
      }),
    });
    assert.equal(resNegative.status, 400);
    const bodyNeg = await resNegative.json();
    assert.equal(bodyNeg.success, false);
    assert.equal(bodyNeg.errors.some((e) => e.field === 'monthly_installment'), true);

    const resBadDate = await fetch(`http://127.0.0.1:${port}/api/sales`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        invoice_number: 'INV-VALID-02',
        customer_id: 1,
        monthly_installment: 500,
        installments_count: 5,
        first_installment_date: '01-12-2026',
      }),
    });
    assert.equal(resBadDate.status, 400);
    const bodyDate = await resBadDate.json();
    assert.equal(bodyDate.errors.some((e) => e.field === 'first_installment_date'), true);

    const resZeroPay = await fetch(`http://127.0.0.1:${port}/api/sales/1/payments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({ amount: 0 }),
    });
    assert.equal(resZeroPay.status, 400);
  } finally {
    server.close();
  }
});

test('Branch scoping strictly blocks cross-branch payments and notes with 403 Forbidden', async () => {
  const { auth, validToken, deviceId } = createAuthFixture({ role: 'employee', branchId: 2 });

  const fakeClient = {
    async query(sql) {
      if (sql.includes('SELECT id, branch_id, monthly_installment')) {
        return {
          rows: [
            {
              id: 99,
              branch_id: 1,
              monthly_installment: 1000,
              installments_count: 10,
              discount_amount: 0,
              status: 'active',
            },
          ],
        };
      }
      if (sql.includes('SELECT id, branch_id FROM sales')) {
        return {
          rows: [
            {
              id: 99,
              branch_id: 1,
            },
          ],
        };
      }
      return { rows: [] };
    },
    release() {},
  };

  const poolMock = {
    async connect() {
      return fakeClient;
    },
    async query(sql) {
      return fakeClient.query(sql);
    },
  };

  const app = createTestApp(poolMock, auth);
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const resPay = await fetch(`http://127.0.0.1:${port}/api/sales/99/payments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({ amount: 500 }),
    });
    assert.equal(resPay.status, 403);
    const payBody = await resPay.json();
    assert.equal(payBody.success, false);
    assert.match(payBody.message, /غير مصرح لك بتسجيل دفعة على فاتورة تخص فرع آخر/);

    const resNote = await fetch(`http://127.0.0.1:${port}/api/sales/99/notes`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({ content: 'محاولة اختراق فرع' }),
    });
    assert.equal(resNote.status, 403);
    const noteBody = await resNote.json();
    assert.equal(noteBody.success, false);
    assert.match(noteBody.message, /غير مصرح لك بتسجيل ملاحظة على فاتورة تخص فرع آخر/);
  } finally {
    server.close();
  }
});
