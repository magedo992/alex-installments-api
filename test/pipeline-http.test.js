const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runHttpChecks } = require('../scripts/check-pipeline-http');

async function server(t, { methods = 'GET,POST,PATCH', healthStatus = 200, allowOrigin = '*', allowedHeaders = 'Content-Type,Authorization,x-device-id' } = {}) {
  const requests = [];
  const app = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': allowOrigin, 'access-control-allow-methods': methods, 'access-control-allow-headers': allowedHeaders });
      return res.end();
    }
    if (req.url === '/health') {
      res.writeHead(healthStatus, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok' }));
    }
    if (req.url === '/admin' || req.url === '/api-docs/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><html><body>Fixture</body></html>');
    }
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Authentication required' }));
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => app.close((error) => error ? reject(error) : resolve())));
  return { baseUrl: `http://127.0.0.1:${app.address().port}`, requests };
}

test('HTTP gate rejects missing PATCH despite healthy endpoints and successful preflight status', async (t) => {
  const { baseUrl, requests } = await server(t, { methods: 'GET,POST,PUT,DELETE' });
  const result = await runHttpChecks({ baseUrl });
  assert.equal(result.ok, false);
  assert.deepEqual(result.checks.filter((check) => !check.ok).map((check) => check.id), ['http.cors-patch']);
  assert.equal(result.checks.at(-1).details.status, 204);
  assert.ok(requests.every((request) => ['GET', 'OPTIONS'].includes(request.method)));
});

test('HTTP gate accepts the complete contract and checks every protected endpoint', async (t) => {
  const { baseUrl, requests } = await server(t);
  const result = await runHttpChecks({ baseUrl });
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 10);
  assert.ok(requests.some((request) => request.url === '/api/sales/daily-summary'));
  assert.ok(requests.some((request) => request.url === '/api/sales/50'));
});

test('HTTP gate continues after failed health and rejects the wrong frontend origin and headers', async (t) => {
  const { baseUrl } = await server(t, { healthStatus: 503, allowOrigin: 'https://other.example.test', allowedHeaders: 'Content-Type' });
  const result = await runHttpChecks({ baseUrl, origin: 'http://localhost:5173' });
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].ok, false);
  assert.equal(result.checks.at(-1).details.originAllowed, false);
  assert.equal(result.checks.at(-1).details.requiredHeadersAllowed, false);
  assert.equal(result.checks.length, 10);
});

test('HTTP gate rejects credential-bearing or invalid server URLs without exposing them', async () => {
  for (const baseUrl of ['not-a-url', 'file:///private/path', 'http://user:private-password@example.test']) {
    const result = await runHttpChecks({ baseUrl });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /private-password|private\/path|example\.test/);
  }
});
