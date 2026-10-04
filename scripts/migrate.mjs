import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPostgresPoolConfig } from '../apps/api/database-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = path.join(root, 'infra', 'postgres');
const databaseUrl = process.env.ATLAS_MIGRATION_DATABASE_URL || process.env.ATLAS_DATABASE_URL;
if (!databaseUrl) throw new Error('Set ATLAS_MIGRATION_DATABASE_URL (recommended) or ATLAS_DATABASE_URL.');
if (process.env.NODE_ENV === 'production' && databaseUrl === process.env.ATLAS_DATABASE_URL && process.env.ATLAS_ALLOW_SHARED_MIGRATION_ROLE !== 'true') {
  throw new Error('Use a separate ATLAS_MIGRATION_DATABASE_URL for schema changes; the API should connect with a restricted runtime role.');
}

const { Pool } = await import('pg');
const pool = new Pool(await createPostgresPoolConfig({ ...process.env, ATLAS_DATABASE_URL: databaseUrl }, {
  max: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 1_000, application_name: 'atlas-migrations'
}));
const client = await pool.connect();
const sha256 = text => createHash('sha256').update(text).digest('hex');
try {
  await client.query('SELECT pg_advisory_lock(734322112)');
  await client.query(`CREATE TABLE IF NOT EXISTS atlas_schema_migrations (
    migration_name TEXT PRIMARY KEY,
    sha256 CHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(migrationDirectory)).filter(name => /^FINAL-MIGRATION-V[0-9]+(?:-V[0-9]+)?\.sql$/.test(name)).sort((a, b) => {
    const version = name => Number(name.match(/FINAL-MIGRATION-V([0-9]+)/)?.[1] || 0);
    return version(a) - version(b) || a.localeCompare(b);
  });
  if (!files.length) throw new Error('No Atlas PostgreSQL migrations were found.');
  for (const name of files) {
    const sql = await readFile(path.join(migrationDirectory, name), 'utf8');
    const digest = sha256(sql);
    const existing = await client.query('SELECT sha256 FROM atlas_schema_migrations WHERE migration_name=$1', [name]);
    if (existing.rows[0]) {
      if (existing.rows[0].sha256 !== digest) throw new Error(`${name} changed after it was applied; create a forward migration instead.`);
      process.stdout.write(`SKIP ${name} (already applied)\n`);
      continue;
    }
    try {
      await client.query(sql);
      await client.query('INSERT INTO atlas_schema_migrations(migration_name,sha256) VALUES ($1,$2)', [name,digest]);
      process.stdout.write(`APPLIED ${name} sha256:${digest}\n`);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Keep the migration error. */ }
      throw new Error(`${name} failed: ${error.message}`, { cause: error });
    }
  }
  process.stdout.write(`Atlas migration check: ${files.length} files examined.\n`);
} finally {
  try { await client.query('SELECT pg_advisory_unlock(734322112)'); } catch { /* Connection close releases the lock. */ }
  client.release();
  await pool.end();
}
