import {
  sessionCookieName, createAuthError, hashOpaqueToken, isAllowedOrigin, parseCookies, verifyCsrf
} from './auth-contracts.mjs';
import { resolveAtlasAuthority } from '../../packages/atlas-core/authority.mjs';
import { paddlePlanCatalog, verifyPaddleFreeTrialPrice, createPaddleCheckout, createPaddlePortalSession, normalizePaddleBillingEvent, paddleBodySha256, verifyPaddleSignature } from './paddle-billing.mjs';
import { simulateWorkflow } from '../../packages/atlas-target/workflow-simulator.mjs';
import { enforceRateLimit, securityHeaders } from './security.mjs';

const MAX_BODY_BYTES = 110_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAN_DETAILS = Object.freeze({
  starter: { name: 'Starter', description: 'Core customer operations for a growing team', features: ['Contacts and lead pipelines', 'Tasks and approved AI drafts', 'Workspace roles and billing'] },
  growth: { name: 'Growth', description: 'More capacity for multi-channel customer workflows', features: ['Everything in Starter', 'Advanced automation drafts', 'Expanded campaign and reporting limits'] },
  scale: { name: 'Scale', description: 'Higher limits for established operations', features: ['Everything in Growth', 'Priority capacity configuration', 'Custom onboarding readiness'] }
});

function send(res, status, body, env, extraHeaders = {}) {
  res.writeHead(status, { ...securityHeaders(env), ...extraHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
}

async function readJson(req) {
  if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw createAuthError(415, 'json_required');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw createAuthError(413, 'request_too_large');
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error('invalid object');
    return result;
  } catch { throw createAuthError(400, 'invalid_json'); }
}

async function readRaw(req, limit = 1_000_000) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw createAuthError(413, 'request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function exact(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) throw createAuthError(400, 'unsupported_request_fields');
}

export function createGrowthApi({ store, authStore, executionStore = null, env = process.env, fetchImpl = fetch } = {}) {
  if (!store || !authStore) throw new TypeError('Growth API requires the growth and authentication stores.');

  async function identity(req) {
    const cookies = parseCookies(req.headers.cookie);
    const raw = cookies.get(sessionCookieName(env));
    if (!raw) throw createAuthError(401, 'authentication_required');
    const session = await authStore.getSession({ sessionHash: hashOpaqueToken(raw) });
    if (!session) throw createAuthError(401, 'authentication_required');
    if (!session.tenantId) throw createAuthError(409, 'workspace_required', 'Select an active workspace first.');
    const memberships = (session.memberships || []).map(row => ({ actorId: session.user.id, tenantId: row.tenant_id, role: row.role_key, status: row.status }));
    const publisherAuthority = resolveAtlasAuthority({
      actor: { ...session.user, authenticated: true, emailVerified: session.user.emailVerified, status: session.user.status },
      tenantId: session.tenantId, memberships, ownerEmail: env.ATLAS_PLATFORM_OWNER_EMAIL
    });
    return { session, actorId: session.user.id, tenantId: session.tenantId, publisherAuthority };
  }

  async function requireMutation(req, session) {
    if (!isAllowedOrigin(req, env)) throw createAuthError(403, 'origin_not_allowed');
    if (!(await verifyCsrf(req, session, env))) throw createAuthError(403, 'csrf_check_failed');
  }

  async function handleWebhook(req, res) {
    const secret = env.ATLAS_PADDLE_WEBHOOK_SECRET;
    if (typeof secret !== 'string' || Buffer.byteLength(secret) < 24) return send(res, 503, { error: 'billing_webhook_not_configured' }, env);
    if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw createAuthError(415, 'json_required');
    const rawBody = await readRaw(req);
    if (!verifyPaddleSignature({ rawBody, signatureHeader: req.headers['paddle-signature'], secret })) throw createAuthError(401, 'invalid_webhook_signature');
    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw createAuthError(400, 'invalid_json'); }
    let normalized;
    try { normalized = normalizePaddleBillingEvent(event, { env }); } catch { throw createAuthError(400, 'invalid_billing_event'); }
    const result = await store.applyPaddleEvent(normalized, paddleBodySha256(rawBody));
    return send(res, 200, { received: true, status: result.status }, env);
  }

  async function route(req, res) {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    const path = url.pathname;
    if (path !== '/api/v1/webhooks/paddle' && !path.startsWith('/api/v1/growth/') && !path.startsWith('/api/v1/billing/')) return false;
    try {
      if (path === '/api/v1/webhooks/paddle' && req.method === 'POST') {
        await enforceRateLimit({ req, store: authStore, secret: env.ATLAS_SESSION_SECRET, env, route: 'billing.webhook', limit: 120, windowSeconds: 60 });
        return await handleWebhook(req, res);
      }
      if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
        await enforceRateLimit({ req, store: authStore, secret: env.ATLAS_SESSION_SECRET, env, route: 'growth.mutation', limit: 120, windowSeconds: 60 });
      }
      const who = await identity(req);
      if (path === '/api/v1/growth/overview' && req.method === 'GET') return send(res, 200, await store.overview(who), env);
      if (path === '/api/v1/billing/plans' && req.method === 'GET') {
        const configured = new Map(paddlePlanCatalog(env).map(plan => [plan.key, plan]));
        const environmentConfigured = ['sandbox', 'live'].includes(env.ATLAS_PADDLE_ENVIRONMENT);
        const plans = await Promise.all(Object.entries(PLAN_DETAILS).map(async ([key, plan]) => {
          const selected = configured.get(key);
          let trial = null;
          if (environmentConfigured && selected && env.ATLAS_PADDLE_API_KEY) {
            try { trial = await verifyPaddleFreeTrialPrice({ priceId: selected.priceId, env, fetchImpl }); }
            catch { /* A plan is not offered until Paddle confirms its exact trial and recurring price. */ }
          }
          return { key, ...plan, checkoutAvailable: Boolean(trial), trialAvailable: Boolean(trial), trialDays: trial?.trialDays || null, billingCycle: trial?.billingCycle || null, renewal: trial?.renewal || null };
        }));
        return send(res, 200, { plans }, env);
      }
      if (path === '/api/v1/billing/subscription' && req.method === 'GET') return send(res, 200, { subscription: await store.getSubscription(who) }, env);
      if (path === '/api/v1/billing/checkout' && req.method === 'POST') {
        await requireMutation(req, who.session);
        await store.requireBillingManager(who);
        const current = await store.getSubscription(who);
        if (current && current.status !== 'canceled') throw createAuthError(409, 'billing_subscription_already_exists', 'Manage the current subscription before starting another checkout.');
        if (current?.trialStartedAt) throw createAuthError(409, 'billing_trial_already_used', 'This workspace has already used its free trial.');
        const body = await readJson(req); exact(body, ['planKey']);
        const checkout = await createPaddleCheckout({ tenantId: who.tenantId, email: who.session.user.email, planKey: body.planKey, env, fetchImpl });
        return send(res, 201, { checkout }, env);
      }
      if (path === '/api/v1/billing/portal' && req.method === 'POST') {
        await requireMutation(req, who.session);
        await store.requireBillingManager(who);
        const current = await store.getSubscription(who);
        if (!current?.customerId || !current?.subscriptionId) throw createAuthError(409, 'billing_subscription_required', 'A Paddle subscription is not available for this workspace yet.');
        const portal = await createPaddlePortalSession({ customerId: current.customerId, subscriptionId: current.subscriptionId, env, fetchImpl });
        return send(res, 201, { portal }, env);
      }
      if (path === '/api/v1/growth/workflows/catalog') {
        if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' }, env, { allow: 'GET' });
        if (typeof store.getWorkflowCatalog !== 'function') throw createAuthError(503, 'workflow_catalog_unavailable');
        return send(res, 200, await store.getWorkflowCatalog(who), env);
      }
      const executionMatch = path.match(/^\/api\/v1\/growth\/workflows\/([0-9a-f-]{36})\/executions(?:\/([0-9a-f-]{36})(?:\/(cancel|approve|replay))?)?$/i);
      if (executionMatch) {
        if (typeof executionStore?.get !== 'function') throw createAuthError(503, 'workflow_execution_unavailable');
        const workflowId = executionMatch[1];
        const executionId = executionMatch[2] || null;
        const executionAction = executionMatch[3] || null;
        if (req.method === 'GET' && !executionId) return send(res, 200, await executionStore.list({ ...who, workflowId, limit: Number(url.searchParams.get('limit') || 50) }), env);
        if (req.method === 'GET' && executionId && !executionAction) return send(res, 200, { execution: await executionStore.get({ ...who, workflowId, executionId }) }, env);
        if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, env, { allow: 'GET, POST' });
        await requireMutation(req, who.session);
        const body = await readJson(req);
        if (!executionId) {
          if (env.ATLAS_WORKFLOW_EXECUTION_ENABLED !== 'true' || env.ATLAS_WORKFLOW_EXECUTION_HANDLER_READY !== 'true') {
            return send(res, 503, { error: 'workflow_execution_not_enabled', message: 'Production workflow execution is not enabled until a reviewed worker handler is installed.' }, env);
          }
          exact(body, ['triggerEventType', 'triggerEventRef', 'executionId']);
          const workflow = await store.get({ ...who, module: 'workflows', id: workflowId });
          if (workflow?.state !== 'published') throw createAuthError(409, 'workflow_not_published', 'Publish the workflow before starting a live execution.');
          if (workflow.payload?.graph?.nodes?.find(node => node.type === 'trigger')?.config?.eventType !== body.triggerEventType) throw createAuthError(400, 'workflow_trigger_mismatch', 'The execution trigger does not match the published workflow.');
          const execution = await executionStore.create({ ...who, workflow, triggerEventRef: body.triggerEventRef, executionId: body.executionId || null });
          return send(res, 202, { execution }, env);
        }
        if (!executionAction) return send(res, 405, { error: 'method_not_allowed' }, env, { allow: 'POST' });
        if (executionAction === 'cancel') {
          exact(body, ['expectedVersion']);
          if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw createAuthError(400, 'invalid_expected_version');
          return send(res, 200, { execution: await executionStore.cancel({ ...who, workflowId, executionId, expectedVersion: body.expectedVersion }) }, env);
        }
        if (executionAction === 'approve') {
          exact(body, ['expectedVersion', 'approvalId', 'evidenceRef']);
          if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw createAuthError(400, 'invalid_expected_version');
          if (typeof body.approvalId !== 'string' || body.approvalId.length < 8 || body.approvalId.length > 180) throw createAuthError(400, 'invalid_approval_id');
          return send(res, 200, { execution: await executionStore.approve({ ...who, workflowId, executionId, expectedVersion: body.expectedVersion, approvalId: body.approvalId, evidenceRef: body.evidenceRef }) }, env);
        }
        if (executionAction === 'replay') {
          exact(body, ['expectedVersion', 'executionId']);
          if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw createAuthError(400, 'invalid_expected_version');
          if (!UUID.test(body.executionId)) throw createAuthError(400, 'invalid_replay_execution_id');
          return send(res, 202, { execution: await executionStore.replay({ ...who, workflowId, executionId, replayExecutionId: body.executionId, expectedVersion: body.expectedVersion }) }, env);
        }
      }
      const match = path.match(/^\/api\/v1\/growth\/([a-z-]+)(?:\/([0-9a-f-]+)(?:\/([a-z-]+))?)?$/i);
      if (!match) return send(res, 404, { error: 'not_found' }, env);
      const [, module, id, action] = match;
      if (id && !UUID.test(id)) return send(res, 404, { error: 'growth_record_not_found' }, env);
      if (req.method === 'POST' && module === 'workflows' && id && action === 'simulate') {
        await requireMutation(req, who.session);
        const body = await readJson(req);
        exact(body, ['event', 'executionId', 'approvedNodeIds', 'now', 'maxSteps']);
        const workflow = await store.get({ ...who, module, id });
        if (!workflow?.payload?.graph) throw createAuthError(409, 'workflow_graph_unavailable', 'The workflow has no valid graph to preview.');
        const result = simulateWorkflow({
          graph: workflow.payload.graph,
          tenantId: who.tenantId,
          executionId: body.executionId,
          event: body.event,
          approvedNodeIds: body.approvedNodeIds,
          now: body.now === undefined ? Date.now() : body.now,
          maxSteps: body.maxSteps === undefined ? 100 : body.maxSteps
        });
        return send(res, 200, result, env);
      }
      if (req.method === 'GET' && module === 'ai-qualification' && url.searchParams.get('publishedOnly') === 'true') {
        const limit = Number(url.searchParams.get('limit') || 100);
        return send(res, 200, await store.listPublishedQualificationProfiles({ ...who, limit }), env);
      }
      if (req.method === 'GET' && id && !action) return send(res, 200, { item: await store.get({ ...who, module, id }) }, env);
      if (req.method === 'GET' && !id && !action) {
        const limit = Number(url.searchParams.get('limit') || 50);
        const offset = Number(url.searchParams.get('offset') || 0);
        return send(res, 200, await store.list({ ...who, module, query: url.searchParams.get('q') || '', limit, offset }), env);
      }
      if (req.method === 'POST' && !id && !action) {
        await requireMutation(req, who.session);
        const body = await readJson(req); exact(body, ['payload']);
        const key = req.headers['idempotency-key'];
        if (key != null && (typeof key !== 'string' || key.length < 8 || key.length > 200)) throw createAuthError(400, 'invalid_idempotency_key');
        const item = await store.create({ ...who, module, payload: body.payload, idempotencyKey: key ? hashOpaqueToken(key) : null });
        return send(res, 201, { item }, env);
      }
      if (req.method === 'PATCH' && id && !action) {
        await requireMutation(req, who.session);
        const body = await readJson(req); exact(body, ['expectedVersion', 'payload']);
        if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw createAuthError(400, 'invalid_expected_version');
        return send(res, 200, { item: await store.update({ ...who, module, id, expectedVersion: body.expectedVersion, payload: body.payload }) }, env);
      }
      if (req.method === 'POST' && module === 'leads' && action === 'move-stage') {
        await requireMutation(req, who.session);
        const body = await readJson(req); exact(body, ['expectedVersion', 'stageId']);
        if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw createAuthError(400, 'invalid_expected_version');
        if (typeof body.stageId !== 'string' || body.stageId.length > 80) throw createAuthError(400, 'invalid_pipeline_stage');
        return send(res, 200, await store.moveLeadStage({ ...who, leadId: id, expectedVersion: body.expectedVersion, stageId: body.stageId }), env);
      }
      if (req.method === 'POST' && module === 'ai-qualification' && action === 'evaluate') {
        await requireMutation(req, who.session);
        const body = await readJson(req); exact(body, ['expectedVersion', 'leadId', 'ratings', 'evidenceRefs']);
        if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw createAuthError(400, 'invalid_expected_version');
        if (typeof body.leadId !== 'string' || !UUID.test(body.leadId)) throw createAuthError(400, 'invalid_lead_id');
        return send(res, 200, await store.evaluateLead({ ...who, profileId: id, leadId: body.leadId, expectedVersion: body.expectedVersion, ratings: body.ratings, evidenceRefs: body.evidenceRefs }), env);
      }
      if (req.method === 'POST' && id && action) {
        await requireMutation(req, who.session);
        const body = await readJson(req); exact(body, ['expectedVersion']);
        if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw createAuthError(400, 'invalid_expected_version');
        const item = await store.transition({ ...who, module, id, action, expectedVersion: body.expectedVersion, publisherAuthority: who.publisherAuthority });
        return send(res, 200, { item }, env);
      }
      return send(res, 405, { error: 'method_not_allowed' }, env, { allow: 'GET, POST, PATCH' });
    } catch (error) {
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      const code = status === 500 ? 'growth_service_unavailable' : (typeof error.code === 'string' ? error.code : 'request_failed');
      return send(res, status, { error: code, message: status === 500 ? 'Atlas could not complete this request. Try again later.' : error.message }, env, status === 429 ? { 'retry-after': String(error.retryAfter || 60) } : {});
    }
  }

  return { handle: route };
}
