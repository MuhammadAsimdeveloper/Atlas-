import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const AAD = Buffer.from('atlas-integration-secret-v1', 'utf8');

function keyFromEnv(value) {
  if (Buffer.isBuffer(value) && value.length === 32) return Buffer.from(value);
  if (typeof value !== 'string' || !value.trim()) throw new Error('ATLAS_INTEGRATION_ENCRYPTION_KEY is required.');
  const raw = value.trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const key = Buffer.from(raw, 'base64');
    if (key.length === 32) return key;
  } catch { /* Fall through. */ }
  throw new Error('ATLAS_INTEGRATION_ENCRYPTION_KEY must encode exactly 32 bytes as 64 hex characters or base64.');
}

export function createIntegrationCipher(keyValue = process.env.ATLAS_INTEGRATION_ENCRYPTION_KEY) {
  const key = keyFromEnv(keyValue);
  return Object.freeze({
    encrypt(value) {
      if (value === null || value === undefined || typeof value !== 'object') throw new TypeError('Integration secret payload must be an object.');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(AAD);
      const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
    },
    decrypt(encoded) {
      if (typeof encoded !== 'string') throw new TypeError('Encrypted integration secret is required.');
      const parts = encoded.split('.');
      if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Unsupported integration secret encoding.');
      const iv = Buffer.from(parts[1], 'base64url');
      const tag = Buffer.from(parts[2], 'base64url');
      const ciphertext = Buffer.from(parts[3], 'base64url');
      if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1 || ciphertext.length > 64_000) throw new Error('Encrypted integration secret is malformed.');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(AAD);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const parsed = JSON.parse(plaintext.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Integration secret payload is invalid.');
      return parsed;
    }
  });
}

export function hashSecret(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function redactSecret(secret) {
  if (typeof secret !== 'string' || !secret) return null;
  return secret.length <= 8 ? '••••••••' : secret.slice(0, 4) + '••••••••' + secret.slice(-4);
}
