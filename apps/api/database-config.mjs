import { readFile } from 'node:fs/promises';

const MAX_POOL_SIZE = 30;

export async function createPostgresPoolConfig(env = process.env, overrides = {}) {
  if (typeof env.ATLAS_DATABASE_URL !== 'string' || !env.ATLAS_DATABASE_URL.trim()) {
    throw new Error('ATLAS_DATABASE_URL is required.');
  }
  let databaseUrl;
  try { databaseUrl = new URL(env.ATLAS_DATABASE_URL); }
  catch { throw new Error('ATLAS_DATABASE_URL must be a valid PostgreSQL connection URL.'); }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseUrl.hostname || databaseUrl.pathname.length < 2) {
    throw new Error('ATLAS_DATABASE_URL must include a PostgreSQL host and database name.');
  }

  const production = env.NODE_ENV === 'production';
  let ssl;
  if (production) {
    // Never let a URL parameter such as sslmode=disable weaken certificate checks.
    const tlsParameters = new Set(['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']);
    for (const key of [...databaseUrl.searchParams.keys()]) if (tlsParameters.has(key.toLowerCase())) databaseUrl.searchParams.delete(key);
    ssl = { rejectUnauthorized: true };
    if (env.ATLAS_DATABASE_SSL_CA_FILE) {
      const ca = await readFile(env.ATLAS_DATABASE_SSL_CA_FILE, 'utf8');
      if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error('ATLAS_DATABASE_SSL_CA_FILE must contain a PEM certificate.');
      ssl.ca = ca;
    }
  }

  const configuredMax = overrides.max ?? (env.ATLAS_DB_POOL_MAX ? Number(env.ATLAS_DB_POOL_MAX) : 10);
  if (!Number.isInteger(configuredMax) || configuredMax < 1 || configuredMax > 10_000) {
    throw new Error('Database pool size must be a whole number between 1 and 10000.');
  }

  return {
    connectionString: databaseUrl.href,
    ...(ssl ? { ssl } : {}),
    max: Math.max(2, Math.min(MAX_POOL_SIZE, configuredMax)),
    idleTimeoutMillis: overrides.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: overrides.connectionTimeoutMillis ?? 5_000,
    statement_timeout: overrides.statement_timeout ?? 8_000,
    idle_in_transaction_session_timeout: overrides.idle_in_transaction_session_timeout ?? 12_000,
    application_name: overrides.application_name ?? 'atlas-api'
  };
}
