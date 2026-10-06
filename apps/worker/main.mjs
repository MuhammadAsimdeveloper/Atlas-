import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createPostgresPoolConfig } from '../api/database-config.mjs';
import { PostgresRuntimeStore } from '../api/runtime-store.mjs';
import { AtlasQueueWorker } from './runtime.mjs';
import { createRedisWakeupTransport } from '../../packages/atlas-runtime/redis-client.mjs';

const env = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));
const handlersDirectory = path.resolve(here, 'handlers');
const moduleName = env.ATLAS_WORKER_HANDLERS_MODULE;
if (!moduleName || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.mjs$/.test(moduleName)) {
  throw new Error('Set ATLAS_WORKER_HANDLERS_MODULE to a reviewed .mjs file under apps/worker/handlers.');
}
const handlersPath = path.resolve(handlersDirectory, moduleName);
if (!handlersPath.startsWith(`${handlersDirectory}${path.sep}`)) throw new Error('Worker handler module must stay inside apps/worker/handlers.');
const loadedHandlers = await import(pathToFileURL(handlersPath).href);
const jobHandlers = loadedHandlers.jobHandlers || {};
const eventHandlers = loadedHandlers.eventHandlers || {};
if (!Object.keys(jobHandlers).length && !Object.keys(eventHandlers).length) throw new Error('Worker handler module must export jobHandlers and/or eventHandlers.');

const databaseUrl = env.ATLAS_WORKER_DATABASE_URL || (env.NODE_ENV === 'production' ? '' : env.ATLAS_DATABASE_URL);
if (!databaseUrl) throw new Error('Set ATLAS_WORKER_DATABASE_URL to a distinct atlas_worker connection in production.');
const workerEnv = { ...env, ATLAS_DATABASE_URL: databaseUrl };
const { Pool } = await import('pg');
const pool = new Pool(await createPostgresPoolConfig(workerEnv, {
  application_name: `atlas-worker-${createHash('sha256').update(moduleName).digest('hex').slice(0, 10)}`
}));
pool.on('error', () => process.stderr.write('Atlas worker database pool error.\n'));

const store = new PostgresRuntimeStore(pool);
const redisWakeup = env.ATLAS_REDIS_URL ? createRedisWakeupTransport(env.ATLAS_REDIS_URL, env.ATLAS_REDIS_NAMESPACE || 'atlas') : null;
await store.assertSafeWorkerRole();
const worker = new AtlasQueueWorker({
  store,
  workerId: env.ATLAS_WORKER_ID || `worker-${randomUUID()}`,
  jobHandlers,
  eventHandlers,
  concurrency: Number(env.ATLAS_WORKER_CONCURRENCY || 4),
  leaseSeconds: Number(env.ATLAS_WORKER_LEASE_SECONDS || 60),
  pollMs: Number(env.ATLAS_WORKER_POLL_MS || 1000),
  runtimePoolId: env.ATLAS_RUNTIME_POOL_ID || null,
  sloEvaluationIntervalMs: Number(env.ATLAS_SLO_EVALUATION_INTERVAL_MS || 30000)
});

let stopping = false;
let wakeLoop = null;
if (redisWakeup) {
  const queues = [...new Set(Object.keys(jobHandlers))];
  wakeLoop = (async () => {
    while (!stopping && queues.length) {
      try { await redisWakeup.receive(queues.map(q => `${env.ATLAS_REDIS_NAMESPACE || 'atlas'}:wake:${q}`), 5); worker.wakeNow(); }
      catch (error) { process.stderr.write(`Atlas Redis wakeup degraded: ${error?.message || 'unknown'}\n`); await new Promise(r => setTimeout(r, 2000)); }
    }
  })();
}
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
  await Promise.resolve(wakeLoop).catch(()=>{});
  await redisWakeup?.close?.();
  await pool.end();
}
