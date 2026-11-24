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

function fixture() {
  let record;
  const tokens = createJwtTokens('local-test-secret-only');
  const users = {
    async create(data) {
      record = { ...data, id, role: 'employee', token: null };
      return record;
    },
    async findByEmail(email) { return record?.email === email ? { ...record } : undefined; },
    async replaceToken(userId, previousToken, token, deviceId) {
      if (record.id !== userId || record.token !== previousToken ||
          (record.deviceId && record.deviceId !== deviceId)) return false;
      record.token = token;
      record.deviceId ??= deviceId;
      return true;
    },
    async findSession() { return record && { ...record }; },
  };
  const auth = createAuthUseCases({
    users, tokens,
    passwords: { hash: async (p) => `hash:${p}`, matches: async (p, hash) => hash === `hash:${p}` },
  });
  return { auth, tokens, record: () => record };
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
  const { auth } = fixture();
  const app = express();
  app.use('/api/auth', createAuthRoutes(auth));
  app.get('/api/profile', createProtect(auth), (req, res) => res.json({ user: req.user }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, deviceId) => fetch(`${base}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(deviceId ? { 'x-device-id': deviceId } : {}) },
    body: JSON.stringify(body),
  });
  assert.equal((await post('register', { ...input, deviceId: 'body-only' })).status, 400);
  const registered = await post('register', { ...input, deviceId: 'ignored' }, 'device-a');
  assert.equal(registered.status, 201);
  assert.equal((await registered.json()).user.deviceId, undefined);
  assert.equal((await post('login', input, 'device-b')).status, 403);
  assert.equal((await post('login', input)).status, 400);
  const loggedIn = await post('login', input, 'device-a');
  assert.equal(loggedIn.status, 200);
  const { token } = await loggedIn.json();
  assert.equal((await fetch(`${base}/api/profile`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await fetch(`${base}/api/profile`, { headers: { Authorization: `Bearer ${token}`, 'x-device-id': 'device-a' } })).status, 200);
});
