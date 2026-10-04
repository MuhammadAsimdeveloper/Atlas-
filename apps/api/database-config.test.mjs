import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPostgresPoolConfig } from './database-config.mjs';

test('production PostgreSQL always verifies TLS even if the URL requests disabled verification', async () => {
  const config = await createPostgresPoolConfig({
    NODE_ENV: 'production',
    ATLAS_DATABASE_URL: 'postgresql://atlas:secret@db.example.net/atlas?sslmode=disable&SSLROOTCERT=%2Ftmp%2Fignored.pem'
  });
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.doesNotMatch(config.connectionString, /sslmode|sslrootcert/i);
  assert.equal(config.max, 10);
});

test('production can pin a provider CA while retaining certificate verification', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'atlas-db-ca-'));
  const caPath = path.join(directory, 'root-ca.pem');
  const ca = '-----BEGIN CERTIFICATE-----\ntest-fixture\n-----END CERTIFICATE-----\n';
  try {
    await writeFile(caPath, ca, 'utf8');
    const config = await createPostgresPoolConfig({
      NODE_ENV: 'production',
      ATLAS_DATABASE_URL: 'postgres://atlas:secret@db.example.net/atlas',
      ATLAS_DATABASE_SSL_CA_FILE: caPath
    });
    assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca });
    assert.equal(await readFile(caPath, 'utf8'), ca);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid database URLs and pool sizes fail clearly, and configured pools remain capped', async () => {
  await assert.rejects(createPostgresPoolConfig({ ATLAS_DATABASE_URL: 'https://db.example.net/atlas' }), /PostgreSQL host and database name/);
  await assert.rejects(createPostgresPoolConfig({ ATLAS_DATABASE_URL: 'postgres://db.example.net/atlas', ATLAS_DB_POOL_MAX: 'NaN' }), /pool size/);
  const capped = await createPostgresPoolConfig({ ATLAS_DATABASE_URL: 'postgres://db.example.net/atlas', ATLAS_DB_POOL_MAX: '100' });
  assert.equal(capped.max, 30);
});
