async function runHttpChecks({ baseUrl, origin = 'http://localhost:5173', timeoutMs = 8000 } = {}) {
  const checks = [];
  let target;
  try {
    target = new URL(baseUrl);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) {
      throw new Error('Invalid base URL');
    }
    target = target.href.replace(/\/+$/, '');
  } catch {
    return { ok: false, checks: [{ id: 'http.config', name: 'HTTP server URL', ok: false, details: { message: 'Set PIPELINE_BASE_URL to an HTTP(S) server URL without credentials, query or fragment.' } }] };
  }

  async function check(id, name, path, verify, options = {}) {
    try {
      const response = await fetch(`${target}${path}`, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.text();
      const details = { status: response.status };
      const failure = verify(response, body, details);
      checks.push({ id, name, ok: !failure, details: { ...details, ...(failure ? { message: failure } : {}) } });
    } catch (error) {
      checks.push({ id, name, ok: false, details: { message: error.name === 'TimeoutError' ? 'HTTP check timed out.' : 'HTTP server could not be reached or response could not be read.' } });
    }
  }

  await check('http.health', 'Server health endpoint', '/health', (response, body) => {
    if (response.status !== 200) return 'Expected HTTP 200.';
    try { if (JSON.parse(body).status === 'ok') return null; } catch { /* Report a contract error below. */ }
    return 'Expected JSON with status ok.';
  });
  for (const [id, path] of [['admin', '/admin'], ['swagger', '/api-docs/']]) {
    await check(`http.${id}`, `${id} HTML endpoint`, path, (response, body) => {
      if (response.status !== 200) return 'Expected HTTP 200.';
      if (!/text\/html/i.test(response.headers.get('content-type') || '') || !/<html\b/i.test(body)) return 'Expected an HTML document.';
      return null;
    });
  }
  for (const [id, path] of [
    ['customers-auth', '/api/customers'], ['sales-auth', '/api/sales'],
    ['details-auth', '/api/sales/50'], ['overdue-auth', '/api/sales/overdue'],
    ['follow-up-auth', '/api/sales/follow-up'], ['daily-auth', '/api/sales/daily-summary'],
  ]) {
    await check(`http.${id}`, `Anonymous access denied: ${path}`, path, (response) => response.status === 401 ? null : 'Expected HTTP 401 without credentials.');
  }
  await check('http.cors-patch', 'Browser may PATCH sale status', '/api/sales/50/status', (response, body, details) => {
    const allowedOrigin = response.headers.get('access-control-allow-origin');
    const methods = (response.headers.get('access-control-allow-methods') || '').split(',').map((value) => value.trim().toUpperCase());
    const headers = (response.headers.get('access-control-allow-headers') || '').split(',').map((value) => value.trim().toLowerCase());
    details.patchAllowed = methods.includes('PATCH');
    details.originAllowed = allowedOrigin === '*' || allowedOrigin === origin;
    details.requiredHeadersAllowed = ['authorization', 'content-type', 'x-device-id'].every((header) => headers.includes(header));
    if (response.status < 200 || response.status >= 300) return 'Preflight must return a successful HTTP status.';
    if (!details.originAllowed) return 'CORS does not allow the requested frontend origin.';
    if (!details.patchAllowed) return 'CORS Access-Control-Allow-Methods does not include PATCH.';
    if (!details.requiredHeadersAllowed) return 'CORS does not allow all required authentication and JSON headers.';
    return null;
  }, {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,content-type,x-device-id' },
  });
  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks };
}

async function main() {
  require('dotenv').config({ path: ['.env.local', '.env'], quiet: true });
  const result = await runHttpChecks({
    baseUrl: process.env.PIPELINE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`,
    origin: process.env.PIPELINE_ORIGIN || 'http://localhost:5173',
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) main().catch(() => { console.error('HTTP readiness checker failed.'); process.exitCode = 1; });

module.exports = { runHttpChecks };
