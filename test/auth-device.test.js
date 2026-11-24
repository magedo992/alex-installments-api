const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAuthUseCases } = require('../src/auth/application/use-cases');
const { registrationInput } = require('../src/auth/domain/input');
const { createJwtTokens } = require('../src/auth/infrastructure/credentials');
const { createAuthRoutes } = require('../src/routes/auth.route');
const { createProtect } = require('../src/middlewares/auth.middleware');

const input = { username: 'Tester', email: 'tester@example.com', password: 'Secret1234' };
const id = 'a0000000-0000-4000-8000-000000000001';

function fixture(initialUsers = [], initialBranches = [1, 2]) {
  const usersMap = new Map();
  for (const u of initialUsers) {
    usersMap.set(u.id, { ...u });
  }
  const branchSet = new Set(initialBranches.map(Number));
  const tokens = createJwtTokens('local-test-secret-only-at-least-32-chars!');
  const users = {
    async create(data) {
      const newId = data.id || (usersMap.size === 0 ? id : `a0000000-0000-4000-8000-${String(usersMap.size + 1).padStart(12, '0')}`);
      const user = {
        ...data,
        id: newId,
        role: data.role || 'employee',
        branch_id: data.branchId ?? data.branch_id ?? null,
        token: null,
      };
      usersMap.set(newId, user);
      return user;
    },
    async findByEmail(email) {
      for (const u of usersMap.values()) {
        if (u.email === email) return { ...u };
      }
      return undefined;
    },
    async replaceToken(userId, previousToken, token, deviceId) {
      const u = usersMap.get(userId);
      if (!u || u.token !== previousToken || (u.deviceId && u.deviceId !== deviceId)) return false;
      u.token = token;
      u.deviceId ??= deviceId;
      return true;
    },
    async findSession(userId) {
      const u = usersMap.get(userId);
      return u ? { ...u } : undefined;
    },
  };
  const branches = {
    async exists(branchId) {
      return branchSet.has(Number(branchId));
    },
  };
  const auth = createAuthUseCases({
    users,
    tokens,
    passwords: { hash: async (p) => `hash:${p}`, matches: async (p, hash) => hash === `hash:${p}` },
    branches,
  });
  return {
    auth,
    tokens,
    record: () => usersMap.get(id) || [...usersMap.values()][0],
    usersMap,
    branches,
  };
}

test('registration rejects missing, malformed, or oversized device IDs', () => {
  for (const deviceId of [undefined, '', 'has space', 'a,b', 'a\nb', 'x'.repeat(257), 123]) {
    assert.throws(() => registrationInput({ ...input, deviceId }),
      (e) => e.code === 'INVALID_INPUT' && e.field === 'x-device-id');
  }
  assert.equal(registrationInput({ ...input, deviceId: 'x'.repeat(256) }).deviceId.length, 256);
});

test('registration binds device before any login and public response omits it', async () => {
  const f = fixture();
  const user = await f.auth.register({ ...input, deviceId: 'device-a' });
  assert.equal(f.record().deviceId, 'device-a');
  assert.equal(user.deviceId, undefined);
  assert.equal(user.passwordHash, undefined);
  await assert.rejects(f.auth.login({ ...input, deviceId: 'device-b' }), { code: 'DEVICE_MISMATCH' });
  assert.equal(f.record().token, null);
  const session = await f.auth.login({ ...input, deviceId: 'device-a' });
  assert.equal((await f.auth.authenticate({ token: session.token, deviceId: 'device-a' })).id, id);
  await assert.rejects(f.auth.authenticate({ token: session.token, deviceId: 'device-b' }), { code: 'DEVICE_MISMATCH' });
});

test('wrong password and missing login device are rejected', async () => {
  const { auth } = fixture();
  await auth.register({ ...input, deviceId: 'device-a' });
  await assert.rejects(auth.login({ ...input, password: 'wrong', deviceId: 'device-a' }), { code: 'INVALID_CREDENTIALS' });
  await assert.rejects(auth.login(input), { code: 'INVALID_INPUT' });
});

test('binding survives clearing the session and is checked for protected requests', async () => {
  const f = fixture();
  await f.auth.register({ ...input, deviceId: 'device-a' });
  await f.auth.login({ ...input, deviceId: 'device-a' });
  f.record().token = null;
  await assert.rejects(f.auth.login({ ...input, deviceId: 'device-b' }), { code: 'DEVICE_MISMATCH' });
  const session = await f.auth.login({ ...input, deviceId: 'device-a' });
  f.record().deviceId = 'device-b';
  await assert.rejects(f.auth.authenticate({ token: session.token, deviceId: 'device-a' }), { code: 'DEVICE_MISMATCH' });
});

test('legacy token binding is preserved and persisted on successful login', async () => {
  const f = fixture();
  await f.auth.register({ ...input, deviceId: 'device-a' });
  f.record().deviceId = null;
  f.record().token = f.tokens.issue({ id, deviceId: 'device-a' });
  await assert.rejects(f.auth.login({ ...input, deviceId: 'device-b' }), { code: 'DEVICE_MISMATCH' });
  await f.auth.login({ ...input, deviceId: 'device-a' });
  assert.equal(f.record().deviceId, 'device-a');
});

test('concurrent first logins cannot bind a legacy account to two devices', async () => {
  const f = fixture();
  await f.auth.register({ ...input, deviceId: 'original' });
  f.record().deviceId = null;
  const results = await Promise.allSettled(['device-a', 'device-b'].map((deviceId) => f.auth.login({ ...input, deviceId })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'LOGIN_CONFLICT');
});

test('HTTP registration reads only the header; login and protected routes require it', async (t) => {
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const adminUser = {
    id: adminId,
    username: 'Admin',
    email: 'admin@example.com',
    role: 'admin',
    deviceId: 'admin-device',
  };
  const { auth, tokens, usersMap } = fixture([adminUser]);
  const adminToken = tokens.issue({ id: adminId, role: 'admin', deviceId: 'admin-device' });
  usersMap.get(adminId).token = adminToken;

  const app = express();
  app.use('/api/auth', createAuthRoutes(auth));
  app.get('/api/profile', createProtect(auth), (req, res) => res.json({ user: req.user }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = (path, body, deviceId, token) => fetch(`${base}/api/auth/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(deviceId ? { 'x-device-id': deviceId } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  assert.equal((await post('register', { ...input, branch_id: 1, deviceId: 'body-only' }, 'admin-device', adminToken)).status, 400);

  const registered = await post('register', { ...input, branch_id: 1 }, 'admin-device', adminToken);
  assert.equal(registered.status, 201);
  assert.equal((await registered.json()).user.deviceId, undefined);

  assert.equal((await post('login', input)).status, 400);

  const loggedIn = await post('login', input, 'employee-device-1');
  assert.equal(loggedIn.status, 200);
  const { token } = await loggedIn.json();

  assert.equal((await post('login', input, 'employee-device-2')).status, 403);

  assert.equal((await fetch(`${base}/api/profile`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await fetch(`${base}/api/profile`, { headers: { Authorization: `Bearer ${token}`, 'x-device-id': 'employee-device-1' } })).status, 200);
});

test('registration lockdown: anonymous register -> 401', async (t) => {
  const { auth } = fixture();
  const app = express();
  app.use('/api/auth', createAuthRoutes(auth));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-device-id': 'device-x' },
    body: JSON.stringify({ ...input, branch_id: 1 }),
  });
  assert.equal(res.status, 401);
});

test('registration lockdown: branch employee register -> 403', async (t) => {
  const { auth, tokens, usersMap } = fixture();
  const empId = 'a0000000-0000-4000-8000-000000000002';
  const empToken = tokens.issue({ id: empId, role: 'employee', deviceId: 'emp-dev' });
  usersMap.set(empId, { id: empId, email: 'emp@test.com', role: 'employee', deviceId: 'emp-dev', token: empToken });

  const app = express();
  app.use('/api/auth', createAuthRoutes(auth));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${empToken}`,
      'x-device-id': 'emp-dev',
    },
    body: JSON.stringify({ username: 'Target', email: 'target@example.com', password: 'Secret1234', role: 'employee', branch_id: 1 }),
  });
  assert.equal(res.status, 403);
});

test('registration lockdown: admin register -> 201', async (t) => {
  const { auth, tokens, usersMap } = fixture();
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const adminToken = tokens.issue({ id: adminId, role: 'admin', deviceId: 'admin-dev' });
  usersMap.set(adminId, { id: adminId, email: 'admin@test.com', role: 'admin', deviceId: 'admin-dev', token: adminToken });

  const app = express();
  app.use('/api/auth', createAuthRoutes(auth));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'x-device-id': 'admin-dev',
    },
    body: JSON.stringify({
      username: 'NewEmployee',
      email: 'newemp@example.com',
      password: 'Secret1234',
      role: 'employee',
      branch_id: 1,
    }),
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.user.email, 'newemp@example.com');
  assert.equal(data.user.role, 'employee');
  assert.equal(data.user.branch_id, 1);
});

test('registration lockdown: admin register with unknown key in body -> 400 (strict validation)', async (t) => {
  const { auth, tokens, usersMap } = fixture();
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const adminToken = tokens.issue({ id: adminId, role: 'admin', deviceId: 'admin-dev' });
  usersMap.set(adminId, { id: adminId, email: 'admin@test.com', role: 'admin', deviceId: 'admin-dev', token: adminToken });

  const app = express();
  app.use('/api/auth', createAuthRoutes(auth));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'x-device-id': 'admin-dev',
    },
    body: JSON.stringify({
      username: 'Hacker',
      email: 'hacker@example.com',
      password: 'Secret1234',
      branch_id: 1,
      unknown_field: 'illegal_injection',
    }),
  });
  assert.equal(res.status, 400);
});

test('registration lockdown: register body containing role: "admin" from a non-admin -> 403 / ignored (must NEVER create an admin)', async (t) => {
  const { auth, tokens, usersMap } = fixture();
  const empId = 'a0000000-0000-4000-8000-000000000002';
  const empToken = tokens.issue({ id: empId, role: 'employee', deviceId: 'emp-dev' });
  usersMap.set(empId, { id: empId, email: 'emp@test.com', role: 'employee', deviceId: 'emp-dev', token: empToken });

  const app = express();
  app.use('/api/auth', createAuthRoutes(auth));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${empToken}`,
      'x-device-id': 'emp-dev',
    },
    body: JSON.stringify({
      username: 'Escalate',
      email: 'escalate@example.com',
      password: 'Secret1234',
      role: 'admin',
    }),
  });
  assert.equal(res.status, 403);

  let found = false;
  for (const u of usersMap.values()) {
    if (u.email === 'escalate@example.com') found = true;
  }
  assert.equal(found, false);
});

test('registration lockdown: employee without branch_id -> 400', async (t) => {
  const { auth, tokens, usersMap } = fixture();
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const adminToken = tokens.issue({ id: adminId, role: 'admin', deviceId: 'admin-dev' });
  usersMap.set(adminId, { id: adminId, email: 'admin@test.com', role: 'admin', deviceId: 'admin-dev', token: adminToken });

  const app = express();
  app.use('/api/auth', createAuthRoutes(auth));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'x-device-id': 'admin-dev',
    },
    body: JSON.stringify({
      username: 'EmployeeNoBranch',
      email: 'nobranch@example.com',
      password: 'Secret1234',
      role: 'employee',
    }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('registration lockdown: employee with nonexistent branch -> 400', async (t) => {
  const { auth, tokens, usersMap } = fixture();
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const adminToken = tokens.issue({ id: adminId, role: 'admin', deviceId: 'admin-dev' });
  usersMap.set(adminId, { id: adminId, email: 'admin@test.com', role: 'admin', deviceId: 'admin-dev', token: adminToken });

  const app = express();
  app.use('/api/auth', createAuthRoutes(auth));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'x-device-id': 'admin-dev',
    },
    body: JSON.stringify({
      username: 'EmployeeBadBranch',
      email: 'badbranch@example.com',
      password: 'Secret1234',
      role: 'employee',
      branch_id: 999999,
    }),
  });
  assert.equal(res.status, 400);
});

test('registration lockdown: accountant with null branch -> 201', async (t) => {
  const { auth, tokens, usersMap } = fixture();
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const adminToken = tokens.issue({ id: adminId, role: 'admin', deviceId: 'admin-dev' });
  usersMap.set(adminId, { id: adminId, email: 'admin@test.com', role: 'admin', deviceId: 'admin-dev', token: adminToken });

  const app = express();
  app.use('/api/auth', createAuthRoutes(auth));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'x-device-id': 'admin-dev',
    },
    body: JSON.stringify({
      username: 'AccountantUser',
      email: 'accountant@example.com',
      password: 'Secret1234',
      role: 'accountant',
      branch_id: null,
    }),
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.user.role, 'accountant');
  assert.equal(data.user.branch_id, null);
});

test('registration device-binding: newly registered employee can log in from DIFFERENT device than admin and binds on first login', async (t) => {
  const adminId = 'a0000000-0000-4000-8000-000000000099';
  const adminUser = {
    id: adminId,
    username: 'SuperAdmin',
    email: 'superadmin@example.com',
    role: 'admin',
    deviceId: 'admin-workstation-99',
  };
  const { auth, tokens, usersMap } = fixture([adminUser]);
  const adminToken = tokens.issue({ id: adminId, role: 'admin', deviceId: 'admin-workstation-99' });
  usersMap.get(adminId).token = adminToken;

  const app = express();
  app.use('/api/auth', createAuthRoutes(auth));
  app.get('/api/profile', createProtect(auth), (req, res) => res.json({ user: req.user }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const newEmployeeData = {
    username: 'BranchClerk',
    email: 'clerk@example.com',
    password: 'Password123!',
    role: 'employee',
    branch_id: 1,
  };

  const regRes = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'x-device-id': 'admin-workstation-99',
    },
    body: JSON.stringify(newEmployeeData),
  });
  assert.equal(regRes.status, 201);

  const firstLoginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-device-id': 'employee-pos-01',
    },
    body: JSON.stringify({ email: newEmployeeData.email, password: newEmployeeData.password }),
  });
  assert.equal(firstLoginRes.status, 200);
  const { token: empToken } = await firstLoginRes.json();

  const secondLoginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-device-id': 'employee-phone-02',
    },
    body: JSON.stringify({ email: newEmployeeData.email, password: newEmployeeData.password }),
  });
  assert.equal(secondLoginRes.status, 403);

  const profileRes = await fetch(`${base}/api/profile`, {
    headers: {
      Authorization: `Bearer ${empToken}`,
      'x-device-id': 'employee-pos-01',
    },
  });
  assert.equal(profileRes.status, 200);
});

test('protect middleware: re-reads user from DB on every request and rejects 401 if user deleted', async (t) => {
  const { auth, tokens, usersMap } = fixture();
  const empId = 'a0000000-0000-4000-8000-000000000003';
  const empToken = tokens.issue({ id: empId, role: 'employee', deviceId: 'emp-dev-1' });
  usersMap.set(empId, { id: empId, email: 'emp3@test.com', role: 'employee', deviceId: 'emp-dev-1', token: empToken });

  const app = express();
  app.get('/api/profile', createProtect(auth), (req, res) => res.json({ user: req.user }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res1 = await fetch(`${base}/api/profile`, {
    headers: { Authorization: `Bearer ${empToken}`, 'x-device-id': 'emp-dev-1' },
  });
  assert.equal(res1.status, 200);

  usersMap.delete(empId);

  const res2 = await fetch(`${base}/api/profile`, {
    headers: { Authorization: `Bearer ${empToken}`, 'x-device-id': 'emp-dev-1' },
  });
  assert.equal(res2.status, 401);
});
