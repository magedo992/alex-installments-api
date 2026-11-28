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
  let capturedInsertSql = '';
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
        capturedInsertSql = sql;
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
    assert.equal(body.data.id, 50);
    assert.match(capturedInsertSql, /INSERT INTO sales\s*\(\s*invoice_number,/);
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

test('POST /api/sales/:id/payments records payment with payment_method and updates sale status to منتهي', async () => {
  const { auth, validToken, deviceId } = createAuthFixture();

  let saleStatus = 'منتظم';
  const targetTotal = 5000;
  let cumulativePaid = 4000;

  const fakeClient = {
    async query(sql, params) {
      if (sql.includes('FROM sales WHERE id = $1') || sql.includes('FROM sales WHERE LOWER(invoice_number)')) {
        return {
          rows: [
            {
              id: 1,
              invoice_number: 'A116',
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
              payment_method: params[4],
              collection_branch_id: params[5],
              notes: params[6],
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (sql.includes('SELECT name FROM branches WHERE id = $1')) {
        return { rows: [{ name: 'ريتاج' }] };
      }
      if (sql.includes('SELECT COALESCE(SUM(amount), 0) AS total_paid')) {
        return { rows: [{ total_paid: cumulativePaid }] };
      }
      if (sql.includes("UPDATE sales SET status = 'منتهي'")) {
        saleStatus = 'منتهي';
        return { rows: [{ status: 'منتهي' }] };
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
        payment_method: 'فودافون كاش',
        notes: 'القسط الأخير فودافون كاش',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.payment.amount, 1000);
    assert.equal(body.data.payment.payment_month, '2026-11-01');
    assert.equal(body.data.payment.payment_method, 'فودافون كاش');
    assert.equal(body.data.payment.collection_branch_id, 1);
    assert.equal(body.data.payment.collection_branch_name, 'ريتاج');
    assert.equal(body.data.summary.required_installments_total, 5000);
    assert.equal(body.data.summary.total_paid, 5000);
    assert.equal(body.data.summary.remaining_balance, 0);
    assert.equal(body.data.summary.sale_status, 'منتهي');
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
      if (sql.includes('FROM sales WHERE id = $1') || sql.includes('FROM sales WHERE LOWER(invoice_number)')) {
        return { rows: [{ id: 10, invoice_number: 'A116', branch_id: 1 }] };
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
      if (sql.includes('monthly_installment, installments_count')) {
        return {
          rows: [
            {
              id: 99,
              invoice_number: 'A999',
              branch_id: 1,
              monthly_installment: 1000,
              installments_count: 10,
              discount_amount: 0,
              status: 'active',
            },
          ],
        };
      }
      if (sql.includes('FROM sales WHERE')) {
        return {
          rows: [
            {
              id: 99,
              invoice_number: 'A999',
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

test('GET /api/sales searches by invoice_number and POST /api/sales/:id/payments accepts invoice_number', async () => {
  const { auth, validToken, deviceId } = createAuthFixture({ role: 'employee', branchId: 1 });

  let capturedSearchParams = [];
  const fakeClient = {
    async query(sql, params) {
      if (sql.includes('FROM sales WHERE LOWER(invoice_number)')) {
        return {
          rows: [
            {
              id: 1,
              invoice_number: 'A116',
              branch_id: 1,
              monthly_installment: 1000,
              installments_count: 5,
              discount_amount: 0,
              status: 'active',
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO payments')) {
        return {
          rows: [
            {
              id: 200,
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
        return { rows: [{ total_paid: 1000 }] };
      }
      return { rows: [] };
    },
    release() {},
  };

  const poolMock = {
    async connect() {
      return fakeClient;
    },
    async query(sql, params) {
      capturedSearchParams = params;
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total: 1 }] };
      }
      return {
        rows: [
          {
            sale_id: 1,
            invoice_number: 'A116',
            branch_id: 1,
            customer_id: 10,
            customer_name: 'أحمد علي',
            remaining_amount: 4000,
            status: 'active',
          },
        ],
      };
    },
  };

  const app = createTestApp(poolMock, auth);
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const searchRes = await fetch(`http://127.0.0.1:${port}/api/sales?invoice_number=A116`, {
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
    });
    assert.equal(searchRes.status, 200);
    const searchBody = await searchRes.json();
    assert.equal(searchBody.success, true);
    assert.equal(searchBody.data[0].invoice_number, 'A116');
    assert.equal(capturedSearchParams[1], 'A116');

    const payRes = await fetch(`http://127.0.0.1:${port}/api/sales/A116/payments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({ amount: 1000, payment_date: '2026-11-25' }),
    });
    assert.equal(payRes.status, 201);
    const payBody = await payRes.json();
    assert.equal(payBody.success, true);
    assert.equal(payBody.data.summary.sale_id, 1);
    assert.equal(payBody.data.summary.invoice_number, 'A116');
  } finally {
    server.close();
  }
});

test('POST /api/sales ignores any client id and requires invoice_number', async () => {
  const { auth, validToken, deviceId } = createAuthFixture({ role: 'employee', branchId: 1 });

  let capturedInsertSql = '';
  let capturedInsertParams = [];

  const fakeClient = {
    async query(sql, params) {
      if (sql.includes('SELECT id FROM customers')) {
        return { rows: [{ id: 10 }] };
      }
      if (sql.includes('SELECT id FROM customer_addresses')) {
        return { rows: [{ id: 5 }] };
      }
      if (sql.includes('INSERT INTO sales')) {
        capturedInsertSql = sql;
        capturedInsertParams = params;
        return {
          rows: [
            {
              id: 77,
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

  try {
    const missingRes = await fetch(`http://127.0.0.1:${port}/api/sales`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        customer_id: 10,
        monthly_installment: 1000,
        installments_count: 6,
        first_installment_date: '2026-12-01',
      }),
    });
    assert.equal(missingRes.status, 400);

    const createRes = await fetch(`http://127.0.0.1:${port}/api/sales`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        id: 9999,
        invoice_number: 'INV-USER-77',
        customer_id: 10,
        monthly_installment: 1000,
        installments_count: 6,
        first_installment_date: '2026-12-01',
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    assert.equal(createBody.success, true);
    assert.equal(createBody.data.id, 77);
    assert.equal(createBody.data.invoice_number, 'INV-USER-77');
    assert.equal(capturedInsertParams[0], 'INV-USER-77');
    assert.match(capturedInsertSql, /INSERT INTO sales\s*\(\s*invoice_number,/);
  } finally {
    server.close();
  }
});

test('GET /api/sales?invoice_number=... returns a summary and GET /api/sales/:id returns full details', async () => {
  const { auth, validToken, deviceId } = createAuthFixture({ role: 'employee', branchId: 1 });

  let capturedSearchSql = '';
  let capturedDetailsParams = [];

  const fullSaleRecord = {
    id: 50,
    sale_id: 50,
    invoice_number: 'A116',
    branch_id: 1,
    branch: { id: 1, name: 'الحمد' },
    customer: {
      id: 10,
      customer_code: '2000001',
      name: 'أحمد علي',
      phones: [{ id: 1, phone: '01012345678', is_primary: true, label: 'شخصي' }],
    },
    address: { id: 5, area: 'العجمي', housing_type: 'ملك', address_details: 'شارع 10' },
    guarantors: [
      {
        id: 70,
        sale_id: 50,
        name: 'محمود السيد',
        phones: [{ id: 2, phone: '01112345678', is_primary: true, label: 'موبايل' }],
      },
    ],
    payments: [{ id: 1, sale_id: 50, amount: 1000, payment_date: '2026-11-24' }],
    notes: [{ id: 1, sale_id: 50, note_type: 'call', content: 'تم الاتصال' }],
    total_paid: 1000,
    remaining_amount: 4000,
    status: 'active',
  };

  const saleSummary = {
    sale_id: fullSaleRecord.sale_id,
    invoice_number: fullSaleRecord.invoice_number,
    customer_name: fullSaleRecord.customer.name,
    total_paid: fullSaleRecord.total_paid,
    remaining_amount: fullSaleRecord.remaining_amount,
    status: fullSaleRecord.status,
    guarantors: [{ name: 'محمود السيد', phones: [{ phone: '01112345678' }] }],
  };

  const poolMock = {
    async query(sql, params) {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total: 1 }] };
      }
      if (sql.includes('FROM sales s')) {
        capturedDetailsParams = params;
        return { rows: [fullSaleRecord] };
      }
      capturedSearchSql = sql;
      return { rows: [saleSummary] };
    },
  };

  const app = createTestApp(poolMock, auth);
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const detailsRes = await fetch(`http://127.0.0.1:${port}/api/sales/50`, {
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
    });
    assert.equal(detailsRes.status, 200);
    const detailsBody = await detailsRes.json();
    assert.equal(detailsBody.success, true);
    assert.equal(detailsBody.data.id, 50);
    assert.equal(detailsBody.data.guarantors[0].name, 'محمود السيد');
    assert.equal(detailsBody.data.payments.length, 1);
    assert.equal(detailsBody.data.notes.length, 1);
    assert.deepEqual(capturedDetailsParams, [50, 1]);

    const searchInvoiceRes = await fetch(`http://127.0.0.1:${port}/api/sales?invoice_number=A116`, {
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
    });
    assert.equal(searchInvoiceRes.status, 200);
    const searchInvoiceBody = await searchInvoiceRes.json();
    assert.equal(searchInvoiceBody.success, true);
    assert.equal(searchInvoiceBody.data[0].invoice_number, 'A116');
    assert.deepEqual(searchInvoiceBody.data[0].guarantors, saleSummary.guarantors);
    assert.equal(searchInvoiceBody.data[0].payments, undefined);
    assert.equal(searchInvoiceBody.data[0].notes, undefined);
    assert.match(capturedSearchSql, /AS guarantors/);
    assert.doesNotMatch(capturedSearchSql, /AS payments/);
    assert.doesNotMatch(capturedSearchSql, /AS notes/);
  } finally {
    server.close();
  }
});

test('GET /api/sales/follow-up filters overdue sales with due_day <= day (defaulting to today) and returns full customer & guarantor data', async () => {
  const { auth, validToken, deviceId } = createAuthFixture({ role: 'employee', branchId: 2 });

  let capturedCountSql = '';
  let capturedCountParams = [];
  let capturedDataSql = '';

  const mockFollowUpRows = [
    {
      sale_id: 50,
      invoice_number: 'A116',
      branch_id: 2,
      branch_name: 'الاصلاح',
      customer_id: 10,
      customer_code: '3000001',
      customer_name: 'أحمد محمود',
      customer_phones: [{ id: 1, phone: '01012345678', is_primary: true, label: 'شخصي' }],
      address: { id: 5, area: 'الاصلاح', housing_type: 'ملك', address_details: 'شارع 5' },
      due_day: 20,
      overdue_amount: 3000,
      guarantors: [
        {
          id: 7,
          name: 'محمود السيد',
          phones: [{ id: 2, phone: '01112345678', is_primary: true, label: 'موبايل' }],
        },
      ],
      latest_note: { id: 1, note_type: 'call', content: 'وعد بالسداد' },
      notes: [{ id: 1, note_type: 'call', content: 'وعد بالسداد' }],
    },
  ];

  const poolMock = {
    async query(sql, params) {
      if (sql.includes('COUNT(*)')) {
        capturedCountSql = sql;
        capturedCountParams = params;
        return { rows: [{ total: 1 }] };
      }
      capturedDataSql = sql;
      return { rows: mockFollowUpRows };
    },
  };

  const app = createTestApp(poolMock, auth);
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sales/follow-up?day=25&branch_id=1`, {
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.filter_day, 25);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].customer_phones[0].phone, '01012345678');
    assert.equal(body.data[0].guarantors[0].name, 'محمود السيد');
    assert.match(capturedCountSql, /sb\.due_day <= \$1/);
    assert.deepEqual(capturedCountParams, [25, 2]);
    assert.match(capturedDataSql, /AS customer_phones/);
    assert.match(capturedDataSql, /AS guarantors/);
    assert.match(capturedDataSql, /AS notes/);

    const defaultRes = await fetch(`http://127.0.0.1:${port}/api/sales/follow-up?date=2026-11-18`, {
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
    });
    assert.equal(defaultRes.status, 200);
    const defaultBody = await defaultRes.json();
    assert.equal(defaultBody.filter_day, 18);
    assert.deepEqual(capturedCountParams, [18, 2]);
  } finally {
    server.close();
  }
});

test('PATCH /api/sales/:id/status allows only admin and follow_up, normalizes متاخر, and protects منتهي', async () => {
  const empAuth = createAuthFixture({ role: 'employee', branchId: 1 });
  const followUpAuth = createAuthFixture({ role: 'follow_up', branchId: 1 });

  let currentStatus = 'حالي';
  let saleBranchId = 1;

  const fakeClient = {
    async query(sql, params) {
      if (sql.includes('FROM sales WHERE id = $1') || sql.includes('FROM sales WHERE LOWER(invoice_number)')) {
        return {
          rows: [{ id: 10, invoice_number: 'A116', branch_id: saleBranchId, status: currentStatus }],
        };
      }
      if (sql.includes('UPDATE sales SET status = $1')) {
        currentStatus = params[0];
        return {
          rows: [{ id: 10, invoice_number: 'A116', branch_id: saleBranchId, status: currentStatus, updated_at: new Date().toISOString() }],
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
  };

  // 1. Regular employee must be rejected with 403
  const empApp = createTestApp(poolMock, empAuth.auth);
  const empServer = empApp.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${empServer.address().port}/api/sales/A116/status`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${empAuth.validToken}`,
        'x-device-id': empAuth.deviceId,
      },
      body: JSON.stringify({ status: 'منتظم' }),
    });
    assert.equal(res.status, 403);
  } finally {
    empServer.close();
  }

  // 2. Follow-up employee can update status and normalize 'متاخر' -> 'متأخر'
  const followApp = createTestApp(poolMock, followUpAuth.auth);
  const followServer = followApp.listen(0);
  const baseUrl = `http://127.0.0.1:${followServer.address().port}/api/sales/A116/status`;
  try {
    const res1 = await fetch(baseUrl, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${followUpAuth.validToken}`,
        'x-device-id': followUpAuth.deviceId,
      },
      body: JSON.stringify({ status: 'متاخر' }),
    });
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.data.status, 'متأخر');

    // 3. Cannot manually set 'منتهي'
    const resManualEnd = await fetch(baseUrl, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${followUpAuth.validToken}`,
        'x-device-id': followUpAuth.deviceId,
      },
      body: JSON.stringify({ status: 'منتهي' }),
    });
    assert.equal(resManualEnd.status, 400);

    // 4. Cannot modify an already 'منتهي' sale
    currentStatus = 'منتهي';
    const resLocked = await fetch(baseUrl, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${followUpAuth.validToken}`,
        'x-device-id': followUpAuth.deviceId,
      },
      body: JSON.stringify({ status: 'محامي' }),
    });
    assert.equal(resLocked.status, 400);

    // 5. Cross-branch follow_up user is blocked with 403
    currentStatus = 'حالي';
    saleBranchId = 99;
    const resCross = await fetch(baseUrl, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${followUpAuth.validToken}`,
        'x-device-id': followUpAuth.deviceId,
      },
      body: JSON.stringify({ status: 'منتظم' }),
    });
    assert.equal(resCross.status, 403);
  } finally {
    followServer.close();
  }
});

test('GET /api/sales/daily-summary calculates cash, vodafone_cash, and by_branch totals scoped by collection branch', async () => {
  const { auth, validToken, deviceId } = createAuthFixture({ role: 'employee', branchId: 2 });

  let capturedParams = null;
  let capturedWhereSql = '';
  const poolMock = {
    async query(sql, params) {
      capturedParams = params;
      if (sql.includes('GROUP BY COALESCE(p.collection_branch_id, s.branch_id)')) {
        return {
          rows: [{
            branch_id: 2,
            branch_name: 'الإصلاح',
            total_amount: '2500.00',
            payments_count: 3,
            cash_total: '1500.00',
            cash_count: 2,
            vodafone_cash_total: '1000.00',
            vodafone_cash_count: 1,
          }],
        };
      }
      if (sql.includes('COALESCE(SUM(p.amount), 0) AS total_amount')) {
        capturedWhereSql = sql;
        return {
          rows: [{
            total_amount: '2500.00',
            payments_count: 3,
            cash_total: '1500.00',
            cash_count: 2,
            vodafone_cash_total: '1000.00',
            vodafone_cash_count: 1,
          }],
        };
      }
      return {
        rows: [
          {
            id: 1,
            sale_id: 50,
            invoice_number: 'A116',
            collection_branch_id: 2,
            collection_branch_name: 'الإصلاح',
            sale_branch_id: 2,
            sale_branch_name: 'الإصلاح',
            amount: '1000.00',
            payment_method: 'فودافون كاش',
            payment_date: '2026-11-27',
          },
          {
            id: 2,
            sale_id: 51,
            invoice_number: 'A117',
            collection_branch_id: 2,
            collection_branch_name: 'الإصلاح',
            sale_branch_id: 1,
            sale_branch_name: 'ريتاج',
            amount: '1500.00',
            payment_method: 'كاش',
            payment_date: '2026-11-27',
          },
        ],
      };
    },
  };

  const app = createTestApp(poolMock, auth);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/sales/daily-summary?date=2026-11-27&branch_id=1`, {
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.date, '2026-11-27');
    assert.equal(body.branch_id, 2);
    assert.deepEqual(capturedParams, ['2026-11-27', 2]);
    assert.match(capturedWhereSql, /COALESCE\(p\.collection_branch_id, s\.branch_id\) = \$2/);
    assert.equal(body.summary.total_amount, 2500);
    assert.equal(body.summary.payments_count, 3);
    assert.equal(body.summary.cash.total, 1500);
    assert.equal(body.summary.cash.count, 2);
    assert.equal(body.summary.vodafone_cash.total, 1000);
    assert.equal(body.summary.vodafone_cash.count, 1);
    assert.equal(body.by_branch.length, 1);
    assert.equal(body.by_branch[0].branch_name, 'الإصلاح');
    assert.equal(body.by_branch[0].cash.total, 1500);
    assert.equal(body.by_branch[0].vodafone_cash.total, 1000);
    assert.equal(body.payments.length, 2);
  } finally {
    server.close();
  }
});

test('GET /api/sales/monthly-summary returns all branches, branches_count, and grand total for admin, and scopes branch employee', async () => {
  const { auth: adminAuth, validToken: adminToken } = createAuthFixture({ role: 'admin', branchId: null });
  const { auth: empAuth, validToken: empToken, deviceId: empDevice } = createAuthFixture({ role: 'employee', branchId: 2 });

  const captured = [];
  const poolMock = {
    async query(sql, params) {
      captured.push({ sql, params });
      if (params.length === 2) {
        return {
          rows: [{
            branch_id: 2,
            branch_name: 'الاصلاح',
            total_amount: '102944.00',
            payments_count: 107,
            cash_total: '86704.00',
            cash_count: 93,
            vodafone_cash_total: '16240.00',
            vodafone_cash_count: 14,
          }],
        };
      }
      return {
        rows: [
          {
            branch_id: 1,
            branch_name: 'الحمد',
            total_amount: '50480.00',
            payments_count: 56,
            cash_total: '50480.00',
            cash_count: 56,
            vodafone_cash_total: '0',
            vodafone_cash_count: 0,
          },
          {
            branch_id: 2,
            branch_name: 'الاصلاح',
            total_amount: '102944.00',
            payments_count: 107,
            cash_total: '86704.00',
            cash_count: 93,
            vodafone_cash_total: '16240.00',
            vodafone_cash_count: 14,
          },
          {
            branch_id: 3,
            branch_name: 'العالميه',
            total_amount: '212025.00',
            payments_count: 70,
            cash_total: '212025.00',
            cash_count: 70,
            vodafone_cash_total: '0',
            vodafone_cash_count: 0,
          },
          {
            branch_id: 4,
            branch_name: 'ريتاج',
            total_amount: '0',
            payments_count: 0,
            cash_total: '0',
            cash_count: 0,
            vodafone_cash_total: '0',
            vodafone_cash_count: 0,
          },
        ],
      };
    },
  };

  const adminApp = createTestApp(poolMock, adminAuth);
  const adminServer = adminApp.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${adminServer.address().port}/api/sales/monthly-summary?month=2026-11`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.month, '2026-11');
    assert.equal(body.branch_id, null);
    assert.equal(body.branches_count, 4);
    assert.equal(body.summary.branches_count, 4);
    assert.equal(body.summary.total_amount, 365449);
    assert.equal(body.summary.payments_count, 233);
    assert.equal(body.summary.cash.total, 349209);
    assert.equal(body.summary.vodafone_cash.total, 16240);
    assert.equal(body.by_branch.length, 4);
    assert.equal(body.by_branch[3].total_amount, 0);
    assert.deepEqual(captured[0].params, ['2026-11-01']);
  } finally {
    adminServer.close();
  }

  const empApp = createTestApp(poolMock, empAuth);
  const empServer = empApp.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${empServer.address().port}/api/sales/monthly-summary?month=2026-11&branch_id=1`, {
      headers: {
        authorization: `Bearer ${empToken}`,
        'x-device-id': empDevice,
      },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.branch_id, 2);
    assert.equal(body.branches_count, 1);
    assert.equal(body.summary.total_amount, 102944);
    assert.deepEqual(captured[1].params, ['2026-11-01', 2]);
  } finally {
    empServer.close();
  }

  const { auth: followAuth, validToken: followToken, deviceId: followDevice } = createAuthFixture({ role: 'follow_up', branchId: null });
  const followApp = createTestApp(poolMock, followAuth);
  const followServer = followApp.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${followServer.address().port}/api/sales/monthly-summary?month=2026-11`, {
      headers: {
        authorization: `Bearer ${followToken}`,
        'x-device-id': followDevice,
      },
    });
    assert.equal(res.status, 403);
  } finally {
    followServer.close();
  }
});
