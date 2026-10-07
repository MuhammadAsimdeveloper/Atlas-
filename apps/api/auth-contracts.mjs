import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const sessionCookieName = env => env.NODE_ENV === 'production' ? '__Host-atlas_session' : 'atlas_session';
export const csrfCookieName = env => env.NODE_ENV === 'production' ? '__Host-atlas_csrf' : 'atlas_csrf';
export const TENANT_ROLES = new Set(['owner', 'admin', 'member', 'viewer', 'billing_admin']);
export const AUTH_ROLE_KEYS = new Set(['admin', 'member', 'viewer', 'billing_admin']);
export const CUSTOM_PERMISSION_CATALOG = Object.freeze([
  'dashboard.read', 'contacts.read', 'contacts.write', 'workflows.read', 'workflows.write',
  'workflows.activate', 'inbox.read', 'inbox.respond', 'copilot.manage', 'billing.read', 'billing.manage',
  'reports.read', 'integrations.read', 'integrations.manage'
]);
const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createAuthError(status, code, message = code) {
  return Object.assign(new Error(message), { status, code });
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().normalize('NFKC').toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export function normalizeDisplayName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ');
  return name.length >= 1 && name.length <= 120 ? name : null;
}

export function normalizeOrganizationName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 120 ? name : null;
}

export function normalizeIndustryKey(value) {
  if (value === undefined || value === null || value === '') return 'home_services';
  return new Set(['home_services', 'appointment_services', 'professional_services', 'agency', 'other']).has(value) ? value : null;
}

export function normalizeTimeZone(value) {
  if (value === undefined || value === null || value === '') return 'America/Los_Angeles';
  if (typeof value !== 'string' || value.length > 80) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return value; }
  catch { return null; }
}

export function normalizePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

export function organizationSlug(name, id) {
  const stem = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42) || 'workspace';
  return `${stem}-${String(id).replaceAll('-', '').slice(0, 8)}`;
}

export function generateOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function hashOpaqueToken(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function hashRateKey(secret, route, clientIdentity, normalizedEmail = '') {
  return createHmac('sha256', String(secret)).update(`${route}\0${clientIdentity}\0${normalizedEmail}`).digest('hex');
}

export function hashIp(secret, ip) {
  if (!ip) return null;
  return createHmac('sha256', String(secret)).update(`ip\0${ip}`).digest('hex');
}

export async function hashPassword(password) {
  const accepted = normalizePassword(password);
  if (!accepted) throw createAuthError(400, 'invalid_password', 'Password must be 12 to 128 characters.');
  const salt = randomBytes(16);
  const digest = await scrypt(accepted, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${Buffer.from(digest).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128 || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '16384' || parts[2] !== '8' || parts[3] !== '1') return false;
  try {
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = Buffer.from(await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function parseCookies(header) {
  const result = new Map();
  if (typeof header !== 'string' || header.length > 8192) return result;
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!result.has(key) && /^[A-Za-z0-9_-]{1,64}$/.test(key) && value.length <= 512) result.set(key, value);
  }
  return result;
}

export function isAllowedOrigin(req, env = process.env) {
  const origin = req.headers.origin;
  if (!origin) return (env.NODE_ENV || 'development') !== 'production';
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password) return false;
    if (env.ATLAS_PUBLIC_ORIGIN) return parsed.origin === new URL(env.ATLAS_PUBLIC_ORIGIN).origin;
    const expectedProtocol = req.socket?.encrypted ? 'https:' : 'http:';
    const host = req.headers.host;
    return Boolean(host) && parsed.protocol === expectedProtocol && parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export function serializeCookie(name, value, { secure = process.env.NODE_ENV === 'production', httpOnly = true, maxAge, clear = false } = {}) {
  const parts = [`${name}=${clear ? '' : encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (clear) parts.push('Max-Age=0');
  else if (Number.isInteger(maxAge)) parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export function serializeAuthCookies(sessionToken, csrfToken, maxAge, env = process.env) {
  const secure = env.NODE_ENV === 'production';
  return [
    serializeCookie(sessionCookieName(env), sessionToken, { secure, httpOnly: true, maxAge }),
    serializeCookie(csrfCookieName(env), csrfToken, { secure, httpOnly: false, maxAge })
  ];
}

export function serializeClearedAuthCookies(env = process.env) {
  const secure = env.NODE_ENV === 'production';
  return [
    serializeCookie(sessionCookieName(env), '', { secure, httpOnly: true, clear: true }),
    serializeCookie(csrfCookieName(env), '', { secure, httpOnly: false, clear: true })
  ];
}

export async function verifyCsrf(req, session, env = process.env) {
  if (CSRF_SAFE_METHODS.has(req.method || 'GET')) return true;
  if (!isAllowedOrigin(req, env)) return false;
  const cookies = parseCookies(req.headers.cookie);
  const csrfName = csrfCookieName(env);
  const cookie = cookies.get(csrfName);
  const header = req.headers['x-atlas-csrf'];
  if (typeof header !== 'string' || typeof cookie !== 'string' || header.length > 128 || cookie !== header) return false;
  return hashOpaqueToken(header) === session.csrfHash;
}

export function validateCustomRole({ key, name, permissions }) {
  if (typeof key !== 'string' || !/^custom:[a-z0-9][a-z0-9-]{0,48}$/.test(key)) throw createAuthError(400, 'invalid_role_key');
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 64) throw createAuthError(400, 'invalid_role_name');
  if (!Array.isArray(permissions) || permissions.length > 64 || permissions.some(item => !CUSTOM_PERMISSION_CATALOG.includes(item))) throw createAuthError(400, 'invalid_role_permissions');
  return Object.freeze({ key, name: name.trim(), permissions: [...new Set(permissions)].sort() });
}
