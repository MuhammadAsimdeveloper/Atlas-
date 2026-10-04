import { createHash, randomUUID } from 'node:crypto';
import { createIntegrationCipher } from '../../packages/atlas-integrations/secrets.mjs';
import { PostgresIntegrationStore } from '../api/integration-store.mjs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createPostgresPoolConfig } from '../api/database-config.mjs';
import { PostgresRuntimeStore } from '../api/runtime-store.mjs';
import { AtlasQueueWorker } from './runtime.mjs';

const env = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));
const handlersDirectory = path.resolve(here, 'handlers');
const moduleName = env.ATLAS_WORKER_HANDLERS_MODULE || 'provider-integrations.mjs';
if (!moduleName || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.mjs$/.test(moduleName)) {
  throw new Error('Set ATLAS_WORKER_HANDLERS_MODULE to a reviewed .mjs file under apps/worker/handlers.');
}
const handlersPath = path.resolve(handlersDirectory, moduleName);
if (!handlersPath.startsWith(`${handlersDirectory}${path.sep}`)) throw new Error('Worker handler module must stay inside apps/worker/handlers.');
const loadedHandlers = await import(pathToFileURL(handlersPath).href);

const databaseUrl = env.ATLAS_WORKER_DATABASE_URL || (env.NODE_ENV === 'production' ? '' : env.ATLAS_DATABASE_URL);
if (!databaseUrl) throw new Error('Set ATLAS_WORKER_DATABASE_URL to a distinct atlas_worker connection in production.');
const workerEnv = { ...env, ATLAS_DATABASE_URL: databaseUrl };
const { Pool } = await import('pg');
const pool = new Pool(await createPostgresPoolConfig(workerEnv, {
  application_name: `atlas-worker-${createHash('sha256').update(moduleName).digest('hex').slice(0, 10)}`
}));
pool.on('error', () => process.stderr.write('Atlas worker database pool error.\n'));

const store = new PostgresRuntimeStore(pool);
await store.assertSafeWorkerRole();
const integrationStore = env.ATLAS_INTEGRATION_ENCRYPTION_KEY
  ? new PostgresIntegrationStore(pool, { cipher: createIntegrationCipher(env.ATLAS_INTEGRATION_ENCRYPTION_KEY), env })
  : null;
const builtHandlers = typeof loadedHandlers.createHandlers === 'function'
  ? await loadedHandlers.createHandlers({ runtimeStore: store, integrationStore, env })
  : loadedHandlers;
const jobHandlers = builtHandlers.jobHandlers || {};
const eventHandlers = builtHandlers.eventHandlers || {};
if (!Object.keys(jobHandlers).length && !Object.keys(eventHandlers).length) throw new Error('Worker handler module must export jobHandlers/eventHandlers or createHandlers().');
const worker = new AtlasQueueWorker({
  store,
  workerId: env.ATLAS_WORKER_ID || `worker-${randomUUID()}`,
  jobHandlers,
  eventHandlers,
  concurrency: Number(env.ATLAS_WORKER_CONCURRENCY || 4),
  leaseSeconds: Number(env.ATLAS_WORKER_LEASE_SECONDS || 60),
  pollMs: Number(env.ATLAS_WORKER_POLL_MS || 1000)
});

let stopping = false;
const shutdown = signal => {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`Atlas worker draining after ${signal}.\n`);
  void worker.stop();
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
try {
  process.stdout.write(`Atlas queue worker ${worker.workerId} started with ${Object.keys(jobHandlers).length} job and ${Object.keys(eventHandlers).length} outbox handlers.\n`);
  await worker.run();
} finally {
  await pool.end();
}
