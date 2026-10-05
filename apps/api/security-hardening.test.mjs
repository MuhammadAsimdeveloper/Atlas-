import assert from 'node:assert/strict';
import test from 'node:test';
import { securityHeaders, clientIdentity, enforceRateLimit, validateHealthToken } from './security.mjs';

test('security headers include browser isolation and production HSTS', () => {
  const html = securityHeaders({ NODE_ENV: 'production' }, { html: true });
  assert.equal(html['x-content-type-options'], 'nosniff');
  assert.equal(html['x-frame-options'], 'DENY');
  assert.equal(html['cross-origin-opener-policy'], 'same-origin');
  assert.equal(html['cross-origin-resource-policy'], 'same-origin');
  assert.equal(html['origin-agent-cluster'], '?1');
  assert.equal(html['x-dns-prefetch-control'], 'off');
  assert.equal(html['x-permitted-cross-domain-policies'], 'none');
  assert.match(html['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(html['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  const api = securityHeaders({ NODE_ENV: 'development' });
  assert.doesNotHaveOwnProperty(api, 'strict-transport-security');
  assert.match(api['cache-control'], /no-store/);
});

test('trusted client identity fails closed behind the production proxy', () => {
  const env = { NODE_ENV: 'production', ATLAS_TRUST_PROXY: 'true' };
  assert.equal(clientIdentity({ headers: { 'x-real-ip': '203.0.113.10' }, socket: {} }, env), '203.0.113.10');
  assert.throws(() => clientIdentity({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, env), /trusted.*IP/i);
  assert.throws(() => clientIdentity({ headers: { 'x-real-ip': 'not-an-ip' }, socket: { remoteAddress: '127.0.0.1' } }, env), /trusted.*IP/i);
});

test('growth API rate limiter hashes the client identity and returns retry metadata', async () => {
  let captured;
  const store = {
    async consumeRateLimit(input) {
      captured = input;
      return false;
    }
  };
  await assert.rejects(
    enforceRateLimit({
      req: { headers: { 'x-real-ip': '203.0.113.20' }, socket: {} },
      store,
      secret: '0123456789abcdef0123456789abcdef',
      env: { NODE_ENV: 'production', ATLAS_TRUST_PROXY: 'true' },
      route: 'growth-api',
      limit: 60,
      windowSeconds: 60,
      clock: () => new Date('2026-10-05T10:00:00Z')
    }),
    error => error?.status === 429 && error?.code === 'rate_limited' && error?.retryAfter === 60
  );
  assert.match(captured.key, /^[a-f0-9]{64}$/);
  assert.equal(captured.windowSeconds, 60);
  assert.equal(captured.limit, 60);
});

test('production health token must be configured and sufficiently random', () => {
  assert.throws(() => validateHealthToken({ NODE_ENV: 'production', ATLAS_HEALTH_TOKEN: '' }), /required/i);
  assert.throws(() => validateHealthToken({ NODE_ENV: 'production', ATLAS_HEALTH_TOKEN: 'short' }), /32/i);
  assert.equal(validateHealthToken({ NODE_ENV: 'development', ATLAS_HEALTH_TOKEN: '' }), true);
  assert.equal(validateHealthToken({ NODE_ENV: 'production', ATLAS_HEALTH_TOKEN: 'a'.repeat(32) }), true);
});
