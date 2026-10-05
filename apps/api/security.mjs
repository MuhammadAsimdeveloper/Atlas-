import { isIP } from 'node:net';
import { createAuthError, hashRateKey } from './auth-contracts.mjs';

const DEFAULT_SECRET = 'atlas-development-only-secret-not-for-production';
const IP = value => typeof value === 'string' && value.length <= 64 && isIP(value) !== 0;

export function clientIdentity(req, env = process.env) {
  if (env.ATLAS_TRUST_PROXY === 'true') {
    const candidate = typeof req.headers?.['x-real-ip'] === 'string' ? req.headers['x-real-ip'].trim() : '';
    if (IP(candidate)) return candidate;
    if (env.NODE_ENV === 'production') throw createAuthError(503, 'trusted_client_ip_unavailable', 'The trusted edge did not provide a valid client IP.');
  }
  const remote = String(req.socket?.remoteAddress || 'unknown').trim();
  return remote.length <= 64 ? remote : remote.slice(0, 64);
}

export async function enforceRateLimit({ req, store, secret = DEFAULT_SECRET, env = process.env, route, limit, windowSeconds = 60, clock = () => new Date() } = {}) {
  if (!store || typeof store.consumeRateLimit !== 'function') {
    if (env.NODE_ENV === 'production') throw createAuthError(503, 'rate_limiter_unavailable', 'Atlas could not enforce request limits.');
    return true;
  }
  if (typeof route !== 'string' || !/^[a-z][a-z0-9_.:-]{1,79}$/.test(route) || !Number.isInteger(limit) || limit < 1 || limit > 10_000 || !Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400) {
    throw new TypeError('Rate-limit configuration is invalid.');
  }
  const key = hashRateKey(secret, route, clientIdentity(req, env));
  const allowed = await store.consumeRateLimit({ key, now: clock(), windowSeconds, limit });
  if (!allowed) throw Object.assign(createAuthError(429, 'rate_limited', 'Try again later.'), { retryAfter: windowSeconds });
  return true;
}

export function securityHeaders(env = process.env, { html = false } = {}) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'origin-agent-cluster': '?1',
    'x-dns-prefetch-control': 'off',
    'x-permitted-cross-domain-policies': 'none',
    'cache-control': html ? 'no-store' : 'no-store',
    'content-security-policy': html
      ? "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      : "default-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  };
  if (env.NODE_ENV === 'production') headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return Object.freeze(headers);
}

export function validateHealthToken(env = process.env) {
  if (env.NODE_ENV !== 'production') return true;
  if (typeof env.ATLAS_HEALTH_TOKEN !== 'string' || Buffer.byteLength(env.ATLAS_HEALTH_TOKEN) < 32) throw new Error('ATLAS_HEALTH_TOKEN is required in production and must contain at least 32 bytes.');
  return true;
}
