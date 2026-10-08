import {
  sessionCookieName, createAuthError, hashOpaqueToken, isAllowedOrigin, parseCookies, verifyCsrf
} from './auth-contracts.mjs';
import { resolveAtlasAuthority } from '../../packages/atlas-core/authority.mjs';
import { paddlePlanCatalog, verifyPaddleFreeTrialPrice, createPaddleCheckout, createPaddlePortalSession, normalizePaddleBillingEvent, paddleBodySha256, verifyPaddleSignature } from './paddle-billing.mjs';
import { simulateWorkflow } from '../../packages/atlas-target/workflow-simulator.mjs';
import { enforceRateLimit, securityHeaders } from './security.mjs';
import { createPromotionManifest, routeEvent } from '../../packages/atlas-core/production-frontier.mjs';
import { auditWorkflowSecurity, createAiWorkflowProposal, createAiWorkflowAuthoringPlan } from '../../packages/atlas-automation-fabric/index.mjs';
import { planAgentTurn, buildAgentJourneyContext, authorizeAgentWorkflowInvocation, createHumanHandoff } from '../../packages/atlas-agent-fabric/index.mjs';

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

export function createGrowthApi({ store, authStore, executionStore = null, runtimeStore = null, env = process.env, fetchImpl = fetch } = {}) {
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
      if (path === '/api/v1/automation/events' && req.method === 'POST') {
        await requireMutation(req, who.session);
        if (env.ATLAS_WORKFLOW_EVENT_INGRESS_ENABLED !== 'true') return send(res, 503, { error: 'workflow_event_ingress_disabled', message: 'Automation event ingress is disabled until production execution is explicitly activated.' }, env);
        if (env.ATLAS_WORKFLOW_EXECUTION_ENABLED !== 'true' || env.ATLAS_WORKFLOW_EXECUTION_HANDLER_READY !== 'true') {
          return send(res, 503, { error: 'workflow_execution_not_enabled', message: 'Live automation events require a reviewed production workflow handler.' }, env);
        }
        if (!runtimeStore?.recordAutomationEvent || !runtimeStore?.finalizeAutomationEvent || !executionStore?.create || !store.listPublishedWorkflowsForEvent) {
          throw createAuthError(503, 'automation_event_runtime_unavailable');
        }
        const body = await readJson(req);
        exact(body, ['eventRef', 'eventType', 'resourceRef']);
        if (typeof body.eventRef !== 'string' || !/^[A-Za-z0-9_.:/@+-]{1,240}$/.test(body.eventRef)) throw createAuthError(400, 'invalid_event_ref');
        if (typeof body.eventType !== 'string' || !/^[a-z][a-z0-9_.:-]{0,119}$/.test(body.eventType)) throw createAuthError(400, 'invalid_event_type');
        if (!body.resourceRef || typeof body.resourceRef !== 'object' || Array.isArray(body.resourceRef)) throw createAuthError(400, 'invalid_resource_ref');
        const resourceRef = { kind: body.resourceRef.kind, id: body.resourceRef.id, ...(body.resourceRef.version === undefined ? {} : { version: body.resourceRef.version }) };
        const payloadHash = createHash('sha256').update(JSON.stringify({ eventType: body.eventType, resourceRef })).digest('hex');
        const ledger = await runtimeStore.recordAutomationEvent({ ...who, eventRef: body.eventRef, eventType: body.eventType, resourceRef, payloadHash });
        if (!ledger.inserted) return send(res, 202, { status: 'duplicate', eventId: ledger.eventId, matchedWorkflows: 0 }, env);
        const workflows = await store.listPublishedWorkflowsForEvent({ ...who, eventType: body.eventType, limit: 100 });
        const executions = [];
        let failed = 0;
        for (const workflow of workflows.items) {
          try {
            const execution = await executionStore.create({ ...who, workflow, triggerEventRef: body.eventRef, executionId: randomUUID() });
            executions.push({ workflowId: workflow.id, executionId: execution.executionId, status: execution.status });
          } catch (error) {
            failed++;
            process.stderr.write(`Atlas automation trigger ${body.eventRef} workflow ${workflow.id} failed: ${error?.code || 'execution_failed'}\n`);
          }
        }
        await runtimeStore.finalizeAutomationEvent({ ...who, eventId: ledger.eventId, matchedWorkflows: workflows.items.length, failedWorkflows: failed });
        return send(res, failed ? 207 : 202, { status: failed ? 'partial' : 'accepted', eventId: ledger.eventId, matchedWorkflows: workflows.items.length, failedWorkflows: failed, executions }, env);
      }

      if (path === '/api/v1/growth/activation') {
        if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' }, env, { allow: 'GET' });
        if (typeof store.getActivationChecklist !== 'function') throw createAuthError(503, 'activation_unavailable');
        return send(res, 200, await store.getActivationChecklist(who), env);
      }
      if (path === '/api/v1/growth/workflows/catalog') {
        if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' }, env, { allow: 'GET' });
        if (typeof store.getWorkflowCatalog !== 'function') throw createAuthError(503, 'workflow_catalog_unavailable');
        return send(res, 200, await store.getWorkflowCatalog(who), env);
      }
      if (path === '/api/v1/growth/automation/ai-proposal' && req.method === 'POST') {
        await requireMutation(req, who.session);
        const body = await readJson(req);
        exact(body, ['prompt', 'candidateNodes']);
        if (typeof body.prompt !== 'string' || body.prompt.length < 3 || body.prompt.length > 4000) throw createAuthError(400, 'invalid_prompt');
        if (!Array.isArray(body.candidateNodes) || body.candidateNodes.length < 1 || body.candidateNodes.length > 50) throw createAuthError(400, 'invalid_candidate_nodes');
        try {
          const proposal = createAiWorkflowProposal({ tenantId: who.tenantId, requestedByActorId: who.actorId, prompt: body.prompt, candidateNodes: body.candidateNodes });
          return send(res, 201, { proposal }, env);
        } catch (error) {
          throw createAuthError(400, 'invalid_ai_workflow_proposal', error?.message || 'The workflow proposal is invalid.');
        }
      }
      if (path === '/api/v1/growth/automation/ai-plan' && req.method === 'POST') {
        await requireMutation(req, who.session);
        const body=await readJson(req);
        exact(body,['businessGoal','knownFacts','candidateNodes']);
        try {
          const plan=createAiWorkflowAuthoringPlan({tenantId:who.tenantId,requestedByActorId:who.actorId,...body});
          return send(res,201,{plan},env);
        } catch(error) {
          throw createAuthError(400,'invalid_ai_workflow_plan',error?.message||'The workflow authoring plan is invalid.');
        }
      }

      if (path === '/api/v1/growth/automation/security-audit' && req.method === 'POST') {
        await requireMutation(req, who.session);
        const body = await readJson(req);
        exact(body, ['workflow']);
        if (!body.workflow || typeof body.workflow !== 'object' || Array.isArray(body.workflow)) throw createAuthError(400, 'invalid_workflow');
        const report = auditWorkflowSecurity({ tenantId: who.tenantId, workflow: body.workflow });
        return send(res, 200, { report }, env);
      }

      if (path === '/api/v1/growth/executions/inspect' && req.method === 'GET') {
        const executionId=url.searchParams.get('executionId');
        if(!executionId) throw createAuthError(400,'execution_id_required');
        if(typeof runtimeStore?.getExecutionInspector!=='function') throw createAuthError(503,'execution_inspector_unavailable');
        return send(res,200,await runtimeStore.getExecutionInspector({...who,executionId,limit:Number(url.searchParams.get('limit')||200)}),env);
      }
      if (path === '/api/v1/growth/executions/reconcile' && req.method === 'POST') {
        await requireMutation(req,who.session);
        if (typeof executionStore?.reconcile !== 'function') throw createAuthError(503,'workflow_reconciliation_unavailable');
        const body=await readJson(req);
        exact(body,['executionId','reconciliationId','resolution','expectedVersion']);
        if (!UUID.test(body.executionId||'') || typeof body.reconciliationId!=='string' || !/^reconcile_[A-Za-z0-9_-]{8,200}$/.test(body.reconciliationId)) throw createAuthError(400,'invalid_workflow_reconciliation');
        if (!['confirmed_success','confirmed_failure'].includes(body.resolution)) throw createAuthError(400,'invalid_workflow_reconciliation_resolution');
        if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) throw createAuthError(400,'invalid_workflow_execution_version');
        return send(res,200,{execution:await executionStore.reconcile({...who,...body})},env);
      }
      if (path === '/api/v1/growth/executions/replay' && req.method === 'POST') {
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['replayId','sourceExecutionId','sourceVersion','targetWorkflowVersion','reason']);
        return send(res,202,{replayId:await runtimeStore.requestExecutionReplay({...who,...body})},env);
      }
      if (path === '/api/v1/growth/schedules' && req.method === 'POST') {
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['scheduleId','workflowId','workflowVersion','scheduleKind','expression','timezone','dstPolicy','nextRunAt']);
        return send(res,201,{scheduleId:await runtimeStore.createWorkflowSchedule({...who,...body})},env);
      }
      if (path === '/api/v1/growth/event-routes' && req.method === 'GET') return send(res,200,{routes:await runtimeStore.listWorkflowEventRoutes({...who,eventType:url.searchParams.get('eventType')||null,limit:Number(url.searchParams.get('limit')||100)})},env);
      if (path === '/api/v1/growth/event-routes' && req.method === 'POST') {
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['routeId','workflowId','workflowVersion','eventType','priority','predicate','branchKey','dedupWindowSeconds']);
        return send(res,201,{routeId:await runtimeStore.createWorkflowEventRoute({...who,...body})},env);
      }
      if (path === '/api/v1/growth/connectors' && req.method === 'GET') return send(res,200,{installations:await runtimeStore.listConnectorInstallations({...who,status:url.searchParams.get('status')||null,limit:Number(url.searchParams.get('limit')||100)})},env);
      if (path === '/api/v1/growth/connectors' && req.method === 'POST') {
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['installationId','connectorKey','externalAccountRef','credentialRef','scopesHash','tokenExpiresAt','status']);
        return send(res,201,{installationId:await runtimeStore.upsertConnectorInstallation({...who,...body})},env);
      }
      const connectorHealth=path.match(/^\/api\/v1\/growth\/connectors\/([0-9a-f-]{36})\/health$/i);
      if(connectorHealth && req.method==='POST'){
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['status','code','detailsRef']);
        return send(res,201,{eventId:await runtimeStore.recordConnectorHealth({...who,installationId:connectorHealth[1],...body})},env);
      }
      if (path === '/api/v1/growth/actions/catalog' && req.method === 'GET') return send(res,200,{actions:await runtimeStore.listActionCatalog({...who,connectorKey:url.searchParams.get('connectorKey')||null,limit:Number(url.searchParams.get('limit')||200)})},env);
      if (path === '/api/v1/growth/actions/bind' && req.method === 'POST') {
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['actionKey','enabled','installationId']);
        return send(res,201,{actionKey:await runtimeStore.bindTenantAction({...who,...body})},env);
      }
      if (path === '/api/v1/growth/agents/sessions' && req.method === 'POST') {
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['sessionId','agentReleaseRef','channel','customerRef','memoryScope']);
        return send(res,201,{sessionId:await runtimeStore.createAgentSession({...who,...body})},env);
      }
      if (path === '/api/v1/growth/agents/turns/plan' && req.method === 'POST') {
        await requireMutation(req, who.session);
        if (!runtimeStore?.getAgentSession || !runtimeStore?.recordAgentTurnPlan) throw createAuthError(503, 'agent_turn_runtime_unavailable');
        const body = await readJson(req);
        exact(body, ['sessionId','agentRelease','turnId','promptHash','toolCalls','approvalRefs','workflowInvocationRef','journeyContext','now']);
        const session = await runtimeStore.getAgentSession({ ...who, sessionId: body.sessionId });
        if (session.agent_release_ref !== body.agentRelease.releaseId) throw createAuthError(409, 'agent_release_mismatch');
        const plan = planAgentTurn({ tenantId:who.tenantId, ...body });
        await runtimeStore.recordAgentTurnPlan({ ...who, plan: { ...plan, agentId: body.agentRelease.agentId } });
        return send(res, 201, { plan }, env);
      }
      if (path === '/api/v1/growth/agents/turns/execute' && req.method === 'POST') {
        await requireMutation(req, who.session);
        if (env.ATLAS_AGENT_TURN_EXECUTION_ENABLED !== 'true' || env.ATLAS_AGENT_TURN_EXECUTION_HANDLER_READY !== 'true') {
          return send(res, 503, { error:'agent_turn_execution_not_enabled', message:'Live agent execution requires an explicitly enabled reviewed model/input worker handler.' }, env);
        }
        if (typeof runtimeStore?.queueAgentTurnExecution !== 'function') throw createAuthError(503,'agent_turn_execution_unavailable');
        const body=await readJson(req); exact(body,['executionId','planId']);
        return send(res,202,{execution:await runtimeStore.queueAgentTurnExecution({...who,...body})},env);
      }
      if (path === '/api/v1/growth/agents/turns' && req.method === 'GET') {
        if (typeof runtimeStore?.listAgentTurnExecutions !== 'function') throw createAuthError(503,'agent_turn_execution_unavailable');
        return send(res,200,await runtimeStore.listAgentTurnExecutions({...who,sessionId:url.searchParams.get('sessionId')||null,status:url.searchParams.get('status')||null,limit:Number(url.searchParams.get('limit')||50)}),env);
      }
      const agentTurnMatch=path.match(/^\/api\/v1\/growth\/agents\/turns\/([0-9a-f-]{36})$/i);
      if(agentTurnMatch && req.method==='GET'){
        if (typeof runtimeStore?.getAgentTurnExecution !== 'function') throw createAuthError(503,'agent_turn_execution_unavailable');
        return send(res,200,{execution:await runtimeStore.getAgentTurnExecution({...who,executionId:agentTurnMatch[1]})},env);
      }
      if (path === '/api/v1/growth/agents/workflow-invocations/authorize' && req.method === 'POST') {
        await requireMutation(req, who.session);
        const body = await readJson(req);
        exact(body, ['agentRelease','workflowId','workflowVersion','risk','approvalRef']);
        return send(res, 200, { authorization:authorizeAgentWorkflowInvocation({ tenantId:who.tenantId, actorId:who.actorId, ...body }) }, env);
      }
      if (path === '/api/v1/growth/agents/handoffs' && req.method === 'POST') {
        await requireMutation(req, who.session);
        if (!runtimeStore?.getAgentSession || !runtimeStore?.recordAgentHandoff) throw createAuthError(503, 'agent_handoff_runtime_unavailable');
        const body = await readJson(req);
        exact(body, ['sessionId','reason','queueRef','appointmentRef','now']);
        await runtimeStore.getAgentSession({ ...who, sessionId: body.sessionId });
        const handoff = createHumanHandoff({ tenantId:who.tenantId, ...body });
        await runtimeStore.recordAgentHandoff({ ...who, handoff });
        return send(res, 201, { handoff }, env);
      }
      if (path === '/api/v1/growth/agents/approvals' && req.method === 'POST') {
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['approvalId','sessionId','actionKey']);
        return send(res,201,{approvalId:await runtimeStore.requestAgentToolApproval({...who,...body})},env);
      }
      const agentSessionMatch=path.match(/^\/api\/v1\/growth\/agents\/sessions\/([0-9a-f-]{36})$/i);
      if(agentSessionMatch && req.method==='POST'){
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['status']);
        return send(res,200,{session:await runtimeStore.transitionAgentSession({...who,sessionId:agentSessionMatch[1],status:body.status})},env);
      }
      const approvalMatch=path.match(/^\/api\/v1\/growth\/agents\/approvals\/([0-9a-f-]{36})$/i);
      if(approvalMatch && req.method==='POST'){
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['status']);
        return send(res,200,{approvalId:await runtimeStore.decideAgentToolApproval({...who,approvalId:approvalMatch[1],status:body.status})},env);
      }
      if (path === '/api/v1/growth/promotions/manifest' && req.method === 'POST') {
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['workflowId','workflowVersion','connectorBindings','actionBindings']);
        const workflow=await store.getWorkflowVersionForScheduler({tenantId:who.tenantId,workflowId:body.workflowId,workflowVersion:body.workflowVersion});
        const result=createPromotionManifest({workflowId:body.workflowId,version:body.workflowVersion,payload:workflow.payload,connectorBindings:Array.isArray(body.connectorBindings)?body.connectorBindings:[],actionBindings:Array.isArray(body.actionBindings)?body.actionBindings:[]});
        return send(res,200,{manifestSha256:result.sha256,manifest:result.manifest},env);
      }
      if (path === '/api/v1/growth/environments' && req.method === 'GET') return send(res,200,{environments:await runtimeStore.listWorkflowEnvironments(who)},env);
      if (path === '/api/v1/growth/promotions' && req.method === 'POST') {
        await requireMutation(req,who.session); const body=await readJson(req); exact(body,['promotionId','workflowId','sourceEnvironmentId','targetEnvironmentId','sourceVersion','targetVersion','manifestSha256']);
        return send(res,201,{promotionId:await runtimeStore.createWorkflowPromotion({...who,...body})},env);
      }
      const promotionMatch=path.match(/^\/api\/v1\/growth\/promotions\/([0-9a-f-]{36})\/(approve|rollback)$/i);
      if(promotionMatch && req.method==='POST'){
        await requireMutation(req,who.session); const body=await readJson(req);
        if(promotionMatch[2]==='approve'){ exact(body,['approve']); return send(res,200,{promotion:await runtimeStore.approveWorkflowPromotion({...who,promotionId:promotionMatch[1],approve:body.approve})},env); }
        exact(body,['fromVersion','toVersion','reason']); return send(res,201,{rollbackId:await runtimeStore.rollbackWorkflowPromotion({...who,promotionId:promotionMatch[1],...body})},env);
      }
            const executionMatch = path.match(/^\/api\/v1\/growth\/workflows\/([0-9a-f-]{36})\/executions(?:\/([0-9a-f-]{36})(?:\/(cancel|approve|replay))?)?$/i);
      if (executionMatch) {
        if (typeof executionStore?.get !== 'function') throw createAuthError(503, 'workflow_execution_unavailable');
        const workflowId = executionMatch[1];
        const executionId = executionMatch[2] || null;
        const executionAction = executionMatch[3] || null;
        if (req.method === 'GET' && !executionId) return send(res, 200, await executionStore.list({ ...who, workflowId, limit: Number(url.searchParams.get('limit') || 50), status: url.searchParams.get('status') || null, triggerEventType: url.searchParams.get('triggerEventType') || null, errorCode: url.searchParams.get('errorCode') || null }), env);
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
