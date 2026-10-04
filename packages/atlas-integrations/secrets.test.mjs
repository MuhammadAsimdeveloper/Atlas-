import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationCipher, hashSecret } from './secrets.mjs';

test('integration cipher round trips structured secrets and rejects tampering', () => {
  const cipher = createIntegrationCipher(Buffer.alloc(32, 7));
  const encoded = cipher.encrypt({ accessToken: 'access', refreshToken: 'refresh', expiresAt: 123 });
  assert.deepEqual(cipher.decrypt(encoded), { accessToken: 'access', refreshToken: 'refresh', expiresAt: 123 });
  const parts = encoded.split('.');
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'B' : 'A');
  assert.throws(() => cipher.decrypt(parts.join('.')));
});

test('secret hash is deterministic and fixed length', () => {
  assert.match(hashSecret('hello'), /^[a-f0-9]{64}$/);
  assert.equal(hashSecret('hello'), hashSecret('hello'));
  assert.notEqual(hashSecret('hello'), hashSecret('world'));
});

test('cipher enforces a 32 byte key', () => {
  assert.throws(() => createIntegrationCipher(Buffer.alloc(31)), /32 bytes/);
});
