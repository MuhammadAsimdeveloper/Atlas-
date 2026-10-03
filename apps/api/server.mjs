import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT || 8080);
const env = process.env.NODE_ENV || 'development';

function json(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', ...headers });
  res.end(data);
}
function configured(value, name) { if (!value) throw new Error(name + ' is required'); return value; }
function constantTimeToken(expected, actual) {
  if (!expected || !actual) return false;
  const a = Buffer.from(expected); const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}
function requireInternalHealthToken(req) {
  const configuredToken = process.env.ATLAS_HEALTH_TOKEN;
  if (!configuredToken) return true;
  return constantTimeToken(configuredToken, req.headers['x-atlas-health-token']);
}
function assertProductionConfig() {
  if (env !== 'production') return;
  for (const [key, value] of [['ATLAS_DATABASE_URL',process.env.ATLAS_DATABASE_URL],['ATLAS_SESSION_SECRET',process.env.ATLAS_SESSION_SECRET],['ATLAS_ACTION_APPROVAL_KEY',process.env.ATLAS_ACTION_APPROVAL_KEY],['ATLAS_PLATFORM_OWNER_EMAIL',process.env.ATLAS_PLATFORM_OWNER_EMAIL],['ATLAS_PUBLIC_ORIGIN',process.env.ATLAS_PUBLIC_ORIGIN]]) configured(value, key);
  if (!/^https:\/\//.test(process.env.ATLAS_PUBLIC_ORIGIN)) throw new Error('ATLAS_PUBLIC_ORIGIN must use HTTPS in production');
}
assertProductionConfig();
const server = createServer((req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' }, { allow: 'GET' });
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname === '/health/live') return json(res, 200, { status: 'ok', service: 'atlas-api', version: process.env.ATLAS_RELEASE || 'unknown' });
  if (url.pathname === '/health/ready') {
    if (!requireInternalHealthToken(req)) return json(res, 401, { error: 'unauthorized' });
    const databaseConfigured = Boolean(process.env.ATLAS_DATABASE_URL);
    return json(res, databaseConfigured ? 200 : 503, { status: databaseConfigured ? 'ready-for-adapters' : 'blocked', database: databaseConfigured ? 'configured' : 'missing', message: databaseConfigured ? 'Database adapter must verify connectivity before reporting ready.' : 'Configure ATLAS_DATABASE_URL.' });
  }
  if (url.pathname === '/api/v1/status') return json(res, 200, { product: 'Atlas', release: process.env.ATLAS_RELEASE || 'V110', environment: env, mode: 'production-contract', authenticatedApi: false, message: 'Wire a trusted session adapter and PostgreSQL transaction adapter before enabling tenant routes.' });
  return json(res, 404, { error: 'not_found' });
});
server.listen(port, '0.0.0.0', () => process.stdout.write('Atlas API listening on :' + port + '\n'));