import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAuthApi } from './auth-routes.mjs';
import { createGrowthApi } from './growth-routes.mjs';
import { createPostgresPoolConfig } from './database-config.mjs';
import { createMailer } from './mail.mjs';
import { PostgresAuthStore } from './postgres-auth-store.mjs';
import { PostgresGrowthStore } from './growth-store.mjs';
import { PostgresWorkflowExecutionStore } from './workflow-execution-store.mjs';
import { securityHeaders, validateHealthToken } from './security.mjs';
import { PostgresCapabilityStore } from './capability-store.mjs';
import { PostgresRuntimeStore } from './runtime-store.mjs';
import { createCapabilityApi } from './capability-routes.mjs';
import { loadInboxContentStore } from './inbox-content.mjs';
import { loadWebhookSecretResolver } from './webhook-secrets.mjs';
import { runWorkflowScheduler } from './workflow-scheduler.mjs';

const port = Number(process.env.PORT || 8080);
const env = process.env;
const runtime = env.NODE_ENV || 'development';
const release = env.ATLAS_RELEASE || 'V126';
const webAssets = new Map([
  ['/', ['../command-center/auth.html', 'text/html; charset=utf-8']],
  ['/login', ['../command-center/auth.html', 'text/html; charset=utf-8']],
  ['/signup', ['../command-center/auth.html', 'text/html; charset=utf-8']],
  ['/verify-email', ['../command-center/auth.html', 'text/html; charset=utf-8']],
  ['/reset-password', ['../command-center/auth.html', 'text/html; charset=utf-8']],
  ['/accept-invitation', ['../command-center/auth.html', 'text/html; charset=utf-8']],
  ['/auth.mjs', ['../command-center/auth.mjs', 'text/javascript; charset=utf-8']],
  ['/auth.css', ['../command-center/auth.css', 'text/css; charset=utf-8']],
  ['/auth-modal.css', ['../command-center/auth-modal.css', 'text/css; charset=utf-8']],
  ['/growth.mjs', ['../command-center/growth.mjs', 'text/javascript; charset=utf-8']],
  ['/workflow-studio.mjs', ['../command-center/workflow-studio.mjs', 'text/javascript; charset=utf-8']],
  ['/growth.css', ['../command-center/growth.css', 'text/css; charset=utf-8']],
  ['/workspace.css', ['../command-center/workspace.css', 'text/css; charset=utf-8']]
]);

function json(res, status, body, headers = {}) {
  res.writeHead(status, { ...securityHeaders(env), ...headers, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function constantTimeToken(expected, actual) {
  if (!expected || typeof actual !== 'string') return false;
  const a = Buffer.from(expected); const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireHealthToken(req) {
  const expected = env.ATLAS_HEALTH_TOKEN;
  return expected ? constantTimeToken(expected, req.headers['x-atlas-health-token']) : true;
}

function assertProductionConfig() {
  if (runtime !== 'production') return;
  validateHealthToken(env);
  if (env.ATLAS_TRUST_PROXY !== 'true') throw new Error('ATLAS_TRUST_PROXY=true is required in production behind the trusted HTTPS edge.');
  for (const [key, value] of [['ATLAS_DATABASE_URL', env.ATLAS_DATABASE_URL], ['ATLAS_SESSION_SECRET', env.ATLAS_SESSION_SECRET], ['ATLAS_ACTION_APPROVAL_KEY', env.ATLAS_ACTION_APPROVAL_KEY], ['ATLAS_PLATFORM_OWNER_EMAIL', env.ATLAS_PLATFORM_OWNER_EMAIL], ['ATLAS_PUBLIC_ORIGIN', env.ATLAS_PUBLIC_ORIGIN], ['ATLAS_EMAIL_PROVIDER_TOKEN', env.ATLAS_EMAIL_PROVIDER_TOKEN], ['ATLAS_EMAIL_FROM', env.ATLAS_EMAIL_FROM]]) {
    if (!value) throw new Error(`${key} is required in production.`);
  }
  if (Buffer.byteLength(env.ATLAS_SESSION_SECRET) < 32) throw new Error('ATLAS_SESSION_SECRET must contain at least 32 bytes.');
  if (Buffer.byteLength(env.ATLAS_ACTION_APPROVAL_KEY) < 32) throw new Error('ATLAS_ACTION_APPROVAL_KEY must contain at least 32 bytes.');
  const owner = env.ATLAS_PLATFORM_OWNER_EMAIL.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) throw new Error('ATLAS_PLATFORM_OWNER_EMAIL must be a valid verified owner address.');
  if (env.ATLAS_EMAIL_PROVIDER !== 'postmark') throw new Error('ATLAS_EMAIL_PROVIDER must be postmark in production.');
  let origin;
  try { origin = new URL(env.ATLAS_PUBLIC_ORIGIN); } catch { throw new Error('ATLAS_PUBLIC_ORIGIN must be a valid HTTPS origin.'); }
  if (origin.protocol !== 'https:' || origin.origin !== env.ATLAS_PUBLIC_ORIGIN || /example\.com$/i.test(origin.hostname)) throw new Error('ATLAS_PUBLIC_ORIGIN must be the real HTTPS Atlas origin. Atlas is currently domain-independent in preview mode.');
}

assertProductionConfig();

let pool = null;
let authStore = null;
let authApi = null;
let growthStore = null;
let workflowExecutionStore = null;
let growthApi = null;
let capabilityStore = null;
let capabilityApi = null;
let runtimeStore = null;
let inboxContentStore = null;
let webhookSecretResolver = null;
let schedulerTimer = null;
if (env.ATLAS_DATABASE_URL) {
  const { Pool } = await import('pg');
  pool = new Pool(await createPostgresPoolConfig(env, { application_name: `atlas-api-${release.toLowerCase()}` }));
  pool.on('error', error => process.stderr.write(`Atlas database pool error: ${error.message}\n`));
  authStore = new PostgresAuthStore(pool);
  if (runtime === 'production') await authStore.assertSafeRuntimeRole();
  growthStore = new PostgresGrowthStore(pool);
  workflowExecutionStore = new PostgresWorkflowExecutionStore(pool);
  runtimeStore = new PostgresRuntimeStore(pool);
  authApi = createAuthApi({ store: authStore, mailer: createMailer(env), env, secret: env.ATLAS_SESSION_SECRET });
  growthApi = createGrowthApi({ store: growthStore, executionStore: workflowExecutionStore, runtimeStore, authStore, env });
  capabilityStore = new PostgresCapabilityStore(pool);
  inboxContentStore = await loadInboxContentStore(env);
  webhookSecretResolver = await loadWebhookSecretResolver(env);
  capabilityApi = createCapabilityApi({ store: capabilityStore, authStore, env, inboxContentStore, webhookSecretResolver });
  if (env.ATLAS_WORKFLOW_SCHEDULER_ENABLED === 'true') {
    const intervalMs=Math.max(1000,Math.min(60000,Number(env.ATLAS_WORKFLOW_SCHEDULER_INTERVAL_MS||5000)));
    const tick=()=>void runWorkflowScheduler({runtimeStore,growthStore,executionStore,limit:100}).catch(error=>process.stderr.write(`Atlas workflow scheduler failed: ${error?.message||'unknown'}\\n`));
    schedulerTimer=setInterval(tick,intervalMs); schedulerTimer.unref?.(); tick();
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  if (req.method === 'GET' && url.pathname === '/health/live') return json(res, 200, { status: 'ok', service: 'atlas-api', release });
  if (req.method === 'GET' && url.pathname === '/health/ready') {
    if (!requireHealthToken(req)) return json(res, 401, { error: 'unauthorized' });
    if (!authStore) return json(res, 503, { status: 'blocked', database: 'missing', message: 'Configure ATLAS_DATABASE_URL and apply the versioned database migrations.' });
    try {
      const schemaReady = await authStore.ping();
      return json(res, schemaReady ? 200 : 503, { status: schemaReady ? 'ready' : 'blocked', database: 'connected', schema: schemaReady ? 'ready' : 'migrations_required' });
    } catch {
      return json(res, 503, { status: 'blocked', database: 'unavailable', schema: 'unknown' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/status') return json(res, 200, { product: 'Atlas', release, environment: runtime, mode: 'authenticated-api', authenticatedApi: Boolean(authApi), growthApi: Boolean(growthApi), database: authStore ? 'configured' : 'missing', message: growthApi ? 'Authentication, tenant-scoped Growth Center and billing routes are enabled.' : 'Configure PostgreSQL and apply all versioned migrations to enable authenticated product routes.' });
  if (authApi) {
    const handled = await authApi.handle(req, res);
    if (handled) return;
  }
  if (growthApi) {
    const handled = await growthApi.handle(req, res);
    if (handled) return;
  }
  if (capabilityApi) {
    const handled = await capabilityApi.handle(req, res);
    if (handled) return;
  }
  if (url.pathname.startsWith('/api/')) return json(res, authApi ? 404 : 503, { error: authApi ? 'not_found' : 'database_required' });
  if ((req.method === 'GET' || req.method === 'HEAD') && webAssets.has(url.pathname)) {
    const [relativePath, contentType] = webAssets.get(url.pathname);
    try {
      const body = await readFile(new URL(relativePath, import.meta.url));
      const headers = { ...securityHeaders(env, { html: contentType.startsWith('text/html') }), 'content-type': contentType, 'content-length': body.length, 'cache-control': contentType.startsWith('text/html') ? 'no-store' : 'public, max-age=300' };
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    } catch (error) {
      process.stderr.write(`Atlas web asset unavailable: ${error.message}\n`);
      return json(res, 500, { error: 'web_asset_unavailable' });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' }, { allow: 'GET, HEAD' });
  return json(res, 404, { error: 'not_found' });
});

server.headersTimeout = 10_000;
server.requestTimeout = 20_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;
server.listen(port, '0.0.0.0', () => process.stdout.write(`Atlas API ${release} listening on :${port}\n`));

async function shutdown(signal) {
  process.stdout.write(`Atlas API received ${signal}; closing gracefully.\n`);
  server.close(async () => {
    if(schedulerTimer) clearInterval(schedulerTimer);
    try { await authStore?.close(); } finally { process.exit(0); }
  });
  const timeout = setTimeout(() => process.exit(1), 15_000);
  timeout.unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
