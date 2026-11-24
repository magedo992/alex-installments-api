const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createCustomerRoutes } = require('../src/routes/customer.route');
const { createProtect } = require('../src/middlewares/auth.middleware');
const { createJwtTokens } = require('../src/auth/infrastructure/credentials');
const { createAuthUseCases } = require('../src/auth/application/use-cases');
const { normalizeArabic } = require('../src/lib/arabic');

function createTestApp(poolMock, auth) {
  const app = express();
  app.use(express.json());
  const protect = createProtect(auth);
  app.use('/api/customers', createCustomerRoutes(poolMock, protect));
  return app;
}

function createAuthFixture({ role = 'employee', branchId = null } = {}) {
  const tokens = createJwtTokens('test-secret-key-123456');
  const userId = '11111111-1111-4111-8111-111111111111';
  let session = {
    id: userId,
    username: 'tester',
    email: 'tester@test.com',
    role,
    token: null,
    deviceId: 'device-test-100',
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

  const validToken = tokens.issue({ id: userId, username: 'tester', role, deviceId: 'device-test-100' });
  session.token = validToken;

  return { auth, validToken, deviceId: 'device-test-100' };
}

test('Arabic text normalization correctly normalizes letters and digits', () => {
  assert.equal(normalizeArabic('أحمد إبراهيم ٠١٢٣'), 'احمد ابراهيم 0123');
  assert.equal(normalizeArabic('مروة   علي'), 'مروه علي');
  assert.equal(normalizeArabic('يُوسُف'), 'يوسف');
});

test('Customer endpoints strictly reject requests without token or device id', async () => {
  const { auth, validToken, deviceId } = createAuthFixture();
  const dummyPool = {};
  const app = createTestApp(dummyPool, auth);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/customers`;

  try {
    const res1 = await fetch(baseUrl, { method: 'GET' });
    assert.equal(res1.status, 401);

    const res2 = await fetch(baseUrl, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${validToken}`,
      },
    });
    assert.equal(res2.status, 401);

    const res3 = await fetch(baseUrl, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-device-id': 'wrong-device',
      },
    });
    assert.equal(res3.status, 403);
  } finally {
    server.close();
  }
});

test('POST /api/customers creates customer with transaction and correct fields', async () => {
  const { auth, validToken, deviceId } = createAuthFixture();

  let queryLog = [];
  const fakeClient = {
    async query(sql, params) {
      queryLog.push({ sql: sql.trim().replace(/\s+/g, ' '), params });
      if (sql.includes('UPDATE branches')) {
        return {
          rows: [{ id: 1, name: 'الحمد', code_prefix: '2', last_number: '2000001' }],
        };
      }
      if (sql.includes('INSERT INTO customers')) {
        return {
          rows: [
            {
              id: 99,
              customer_code: '2000001',
              name: params[1],
              normalized_name: params[2],
              risk_level: params[3],
              general_note: params[4],
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO phone_numbers')) {
        return {
          rows: [{ id: 10, phone: params[1], is_primary: params[2], label: params[3] }],
        };
      }
      if (sql.includes('INSERT INTO customer_addresses')) {
        return {
          rows: [
            {
              id: 20,
              area: params[1],
              housing_type: params[2],
              address_details: params[3],
              is_current: true,
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
  const baseUrl = `http://127.0.0.1:${port}/api/customers`;

  try {
    const payload = {
      branch_id: 1,
      name: 'أحمد محمود',
      phones: [{ phone: '٠١٠١٢٣٤٥٦٧٨', is_primary: true, label: 'شخصي' }],
      address: {
        area: 'العجمي',
        housing_type: 'ملك',
        address_details: 'بجوار محطة الأتوبيس',
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
    assert.equal(body.data.customer_code, '2000001');
    assert.equal(body.data.normalized_name, 'احمد محمود');
    assert.equal(body.data.phones[0].phone, '01012345678');
    assert.equal(body.data.address.area, 'العجمي');
  } finally {
    server.close();
  }
});

test('GET /api/customers searches with query and returns paginated list', async () => {
  const { auth, validToken, deviceId } = createAuthFixture();

  const mockCustomers = [
    {
      id: 1,
      customer_code: '2000001',
      name: 'أحمد محمود',
      normalized_name: 'احمد محمود',
      risk_level: 'low',
      general_note: null,
      created_at: new Date().toISOString(),
      phones: [{ id: 10, phone: '01012345678', is_primary: true, label: 'شخصي' }],
      current_address: { id: 20, area: 'العجمي', housing_type: 'ملك', address_details: null },
    },
  ];

  const poolMock = {
    async query(sql, params) {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total: 1 }] };
      }
      return { rows: mockCustomers };
    },
  };

  const app = createTestApp(poolMock, auth);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/customers`;

  try {
    const res = await fetch(`${baseUrl}?q=أحمد&page=1&limit=10`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].customer_code, '2000001');
    assert.equal(body.pagination.total, 1);
    assert.equal(body.pagination.page, 1);
    assert.equal(body.pagination.limit, 10);
    assert.equal(body.pagination.totalPages, 1);
  } finally {
    server.close();
  }
});

test('POST /api/customers enforces branch employee branch_id over request body', async () => {
  const { auth, validToken, deviceId } = createAuthFixture({ role: 'employee', branchId: 2 });

  let capturedBranchId = null;
  const fakeClient = {
    async query(sql, params) {
      if (sql.includes('UPDATE branches')) {
        capturedBranchId = params[0];
        return {
          rows: [{ id: 2, name: 'الاصلاح', code_prefix: '3', last_number: '3000001' }],
        };
      }
      if (sql.includes('INSERT INTO customers')) {
        return {
          rows: [
            {
              id: 101,
              customer_code: '3000001',
              name: params[1],
              normalized_name: params[2],
              risk_level: null,
              general_note: null,
              created_at: new Date().toISOString(),
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
  const baseUrl = `http://127.0.0.1:${port}/api/customers`;

  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        branch_id: 1,
        name: 'عميل مسجل بواسطة موظف الاصلاح',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(capturedBranchId, 2);
    assert.equal(body.data.branch.id, 2);
    assert.equal(body.data.customer_code, '3000001');
  } finally {
    server.close();
  }
});

test('POST /api/customers requires branch_id for admin and accepts valid branch', async () => {
  const { auth, validToken, deviceId } = createAuthFixture({ role: 'admin', branchId: null });

  let capturedBranchId = null;
  const fakeClient = {
    async query(sql, params) {
      if (sql.includes('UPDATE branches')) {
        capturedBranchId = params[0];
        return {
          rows: [{ id: 3, name: 'العالميه', code_prefix: '4', last_number: '4000001' }],
        };
      }
      if (sql.includes('INSERT INTO customers')) {
        return {
          rows: [
            {
              id: 102,
              customer_code: '4000001',
              name: params[1],
              normalized_name: params[2],
              risk_level: null,
              general_note: null,
              created_at: new Date().toISOString(),
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
  const baseUrl = `http://127.0.0.1:${port}/api/customers`;

  try {
    const resWithoutBranch = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        name: 'عميل أدمن بدون فرع',
      }),
    });
    assert.equal(resWithoutBranch.status, 400);
    const errBody = await resWithoutBranch.json();
    assert.equal(errBody.success, false);
    assert.match(errBody.message, /إلزامي/);

    const resWithBranch = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        branch_id: 3,
        name: 'عميل أدمن على فرع العالميه',
      }),
    });
    assert.equal(resWithBranch.status, 201);
    const okBody = await resWithBranch.json();
    assert.equal(okBody.success, true);
    assert.equal(capturedBranchId, 3);
    assert.equal(okBody.data.branch.id, 3);
  } finally {
    server.close();
  }
});

test('POST /api/customers rejects invalid phone numbers or short customer names via Zod validation', async () => {
  const { auth, validToken, deviceId } = createAuthFixture();
  const app = createTestApp({}, auth);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/customers`;

  try {
    const resShortName = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({ branch_id: 1, name: 'أ' }),
    });
    assert.equal(resShortName.status, 400);
    const bodyShort = await resShortName.json();
    assert.equal(bodyShort.errors.some((e) => e.field === 'name'), true);

    const resBadPhone = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validToken}`,
        'x-device-id': deviceId,
      },
      body: JSON.stringify({
        branch_id: 1,
        name: 'أحمد محمود',
        phones: [{ phone: '123456' }],
      }),
    });
    assert.equal(resBadPhone.status, 400);
    const bodyPhone = await resBadPhone.json();
    assert.equal(bodyPhone.errors.some((e) => e.field.includes('phone')), true);
  } finally {
    server.close();
  }
});
