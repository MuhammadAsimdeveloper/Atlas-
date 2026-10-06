import crypto from 'node:crypto';
import { createWorkflowGraph, verifyWorkflowGraph } from '../atlas-target/index.mjs';
import { WORKFLOW_NODE_CATALOG } from '../atlas-target/workflow-catalog.mjs';

const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;
const HASH = /^[a-f0-9]{64}$/;
const ERROR = /^[a-z][a-z0-9_.-]{0,79}$/;
const SECRET_KEY = /(password|secret|token|api[_-]?key|authorization|cookie|private[_-]?key|client[_-]?secret)/i;
const DIRECT_TARGET_KEY = /^(url|uri|endpoint|host|destination|callbackUrl|redirectUrl)$/i;
const EXECUTABLE_MARKERS = Object.freeze(['require(', 'child_process', 'process.', 'eval(', 'Function(', 'import(', 'fetch(', 'axios(', 'XMLHttpRequest']);

export const N8N_PARITY_FEATURES = Object.freeze([
  'manual_trigger','webhook_trigger','schedule_trigger','form_trigger','chat_trigger',
  'if','switch','merge','loop_over_items','split_out','aggregate','filter','sort','remove_duplicates','edit_fields',
  'wait','error_trigger','stop_and_error','no_op','respond_to_webhook',
  'execute_subworkflow','execution_filters','retry_execution','execution_data','data_table',
  'workflow_templates','workflow_sharing','source_control_environments','credential_scoping',
  'ai_workflow_builder','human_in_the_loop','mcp','security_audit','bounded_http','safe_code_transform'
]);

export const HARDENED_NODE_ADDONS = Object.freeze([
  { type:'loop_over_items', guard:'max-items-and-iterations', risk:'read' },
  { type:'aggregate', guard:'bounded-inputs', risk:'read' },
  { type:'remove_duplicates', guard:'bounded-keyset', risk:'read' },
  { type:'sort', guard:'bounded-fields-and-items', risk:'read' },
  { type:'split_out', guard:'bounded-array-expansion', risk:'read' },
  { type:'edit_fields', guard:'allowlisted-data-mapping', risk:'read' },
  { type:'respond_to_webhook', guard:'bounded-reference-response', risk:'network' },
  { type:'error_trigger', guard:'reference-only-error-context', risk:'read' },
  { type:'stop_and_error', guard:'bounded-error-code', risk:'read' },
  { type:'no_op', guard:null, risk:'read' },
  { type:'data_table', guard:'tenant-table-scope', risk:'read' },
  { type:'execution_data', guard:'redacted-custom-data', risk:'read' },
  { type:'mcp_client', guard:'capability-and-approval-bound', risk:'network' },
  { type:'mcp_server_trigger', guard:'authenticated-tool-catalog', risk:'network' }
]);

function ref(value, label) {
  if (typeof value !== 'string' || !REF.test(value)) throw new TypeError(label + ' must be an opaque bounded reference');
  return value;
}

function int(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(label + ' must be between ' + min + ' and ' + max);
  return value;
}

function boundedText(value, label, max = 240) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n\u0000]/.test(value)) throw new TypeError(label + ' is invalid');
  return value.trim();
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(label + ' must be a plain object');
}

function scanUnsafe(value, path = 'config', findings = []) {
  if (value == null) return findings;
  if (typeof value === 'string') {
    if (SECRET_KEY.test(path)) findings.push({ code:'SECRET_LIKE_FIELD', path });
    if (DIRECT_TARGET_KEY.test(path)) findings.push({ code:'DIRECT_NETWORK_TARGET', path });
    if (EXECUTABLE_MARKERS.some(marker => value.includes(marker))) findings.push({ code:'EXECUTABLE_OR_NETWORK_PAYLOAD', path });
    return findings;
  }
  if (typeof value !== 'object') return findings;
  if (Array.isArray(value)) {
    if (value.length > 1000) findings.push({ code:'ARRAY_TOO_LARGE', path });
    value.forEach((item, index) => scanUnsafe(item, path + '[' + index + ']', findings));
  } else {
    if (Object.keys(value).length > 100) findings.push({ code:'OBJECT_TOO_LARGE', path });
    for (const [key, child] of Object.entries(value)) scanUnsafe(child, path + '.' + key, findings);
  }
  return findings;
}

export function createAutomationPolicy({
  tenantId,
  environmentId,
  maxSteps = 500,
  maxConcurrency = 8,
  maxLoopItems = 1000,
  maxRetries = 4,
  timeoutMs = 120000,
  executionRetentionDays = 30,
  saveExecutionData = 'redacted'
} = {}) {
  ref(tenantId, 'tenantId');
  ref(environmentId, 'environmentId');
  int(maxSteps, 'maxSteps', 10, 500);
  int(maxConcurrency, 'maxConcurrency', 1, 100);
  int(maxLoopItems, 'maxLoopItems', 1, 10000);
  int(maxRetries, 'maxRetries', 0, 10);
  int(timeoutMs, 'timeoutMs', 1000, 600000);
  int(executionRetentionDays, 'executionRetentionDays', 1, 365);
  if (!['none','redacted','reference_only'].includes(saveExecutionData)) throw new TypeError('saveExecutionData must be none, redacted or reference_only');
  return freeze({ tenantId, environmentId, maxSteps, maxConcurrency, maxLoopItems, maxRetries, timeoutMs, executionRetentionDays, saveExecutionData, checksum:sha256({ tenantId, environmentId, maxSteps, maxConcurrency, maxLoopItems, maxRetries, timeoutMs, executionRetentionDays, saveExecutionData }) });
}

export function validateAutomationNode({ tenantId, node } = {}) {
  ref(tenantId, 'tenantId');
  assertPlainObject(node, 'node');
  ref(node.id, 'node.id');
  boundedText(node.type, 'node.type', 60);
  if (node.type === 'execute_command') throw new Error('execute_command is disabled in Atlas automation');
  if (!WORKFLOW_NODE_CATALOG[node.type]) throw new Error('Unsupported workflow node: ' + node.type);
  const findings = scanUnsafe(node.config || {});
  if (node.type === 'http_request' && findings.some(item => item.code === 'DIRECT_NETWORK_TARGET')) throw new Error('http_request requires a connector-scoped operation, not a direct URL');
  if (node.type === 'code_transform' && findings.some(item => item.code === 'EXECUTABLE_OR_NETWORK_PAYLOAD')) throw new Error('code_transform accepts declarative expressions only');
  if (findings.some(item => item.code === 'SECRET_LIKE_FIELD')) throw new Error('Workflow config contains secret-like fields');
  if (node.type === 'loop_over_items') {
    int(node.config?.batchSize ?? 1, 'loop batchSize', 1, 100);
    int(node.config?.maxItems ?? 1000, 'loop maxItems', 1, 10000);
  }
  if (node.type === 'wait') {
    int(node.config?.waitMs ?? 1000, 'waitMs', 1000, 30 * 24 * 60 * 60_000);
  }
  return freeze({ tenantId, nodeId:node.id, type:node.type, findings:[] });
}

export function createApprovalRequest({
  tenantId, workflowId, executionId, nodeId, requestedByActorId, actionKey, argumentsHash, expiresAt
} = {}) {
  ref(tenantId, 'tenantId'); ref(workflowId, 'workflowId'); ref(executionId, 'executionId'); ref(nodeId, 'nodeId'); ref(requestedByActorId, 'requestedByActorId');
  boundedText(actionKey, 'actionKey', 160);
  if (!HASH.test(argumentsHash || '')) throw new TypeError('argumentsHash must be SHA-256');
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) throw new TypeError('expiresAt must be a timestamp');
  const body = { id: 'approval_' + sha256({ tenantId, workflowId, executionId, nodeId, actionKey, argumentsHash }).slice(0, 24), tenantId, workflowId, executionId, nodeId, requestedByActorId, actionKey, argumentsHash, status:'pending', expiresAt:new Date(expires).toISOString() };
  return freeze({ ...body, checksum:sha256(body) });
}

export function decideApproval({ request, tenantId, approvedByActorId, decision, now = Date.now() } = {}) {
  if (!request || !request.checksum || sha256(Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'checksum'))) !== request.checksum) return { status:'denied', code:'INVALID_REQUEST' };
  if (request.tenantId !== tenantId) return { status:'denied', code:'TENANT_MISMATCH' };
  if (approvedByActorId === request.requestedByActorId) return { status:'denied', code:'SELF_APPROVAL' };
  if (!['approved','rejected'].includes(decision)) return { status:'denied', code:'INVALID_DECISION' };
  if (Date.parse(request.expiresAt) <= now) return { status:'denied', code:'EXPIRED' };
  if (decision === 'rejected') return freeze({ status:'rejected', requestId:request.id, approvedByActorId });
  return freeze({ status:'approved', requestId:request.id, approvedByActorId, approvedAt:new Date(now).toISOString(), expiresAt:request.expiresAt });
}

export function filterExecutions({ tenantId, executions = [], workflowId = null, statuses = [], startedAfter = null, startedBefore = null, customData = {} } = {}) {
  ref(tenantId, 'tenantId');
  if (!Array.isArray(executions) || executions.length > 10000) throw new TypeError('executions must be a bounded list');
  const normalizedStatuses = statuses.length ? new Set(statuses) : null;
  return executions
    .filter(item => item?.tenantId === tenantId)
    .filter(item => !workflowId || item.workflowId === workflowId)
    .filter(item => !normalizedStatuses || normalizedStatuses.has(item.status))
    .filter(item => !startedAfter || Date.parse(item.startedAt) >= Date.parse(startedAfter))
    .filter(item => !startedBefore || Date.parse(item.startedAt) <= Date.parse(startedBefore))
    .filter(item => Object.entries(customData || {}).every(([key, value]) => item.customData?.[key] === value))
    .map(item => ({
      id:item.id, workflowId:item.workflowId, status:item.status, startedAt:item.startedAt, finishedAt:item.finishedAt || null,
      customData:item.customData ? Object.fromEntries(Object.entries(item.customData).slice(0,50)) : {}
    }));
}

export function planExecutionRetry({
  tenantId, workflowId, workflowVersion, executionId, nodeId, attempt, maxAttempts, retrySafe, backoffMs = 500, now = Date.now()
} = {}) {
  ref(tenantId, 'tenantId'); ref(workflowId, 'workflowId'); ref(executionId, 'executionId'); ref(nodeId, 'nodeId');
  int(workflowVersion, 'workflowVersion', 1, 100000);
  int(attempt, 'attempt', 1, 10);
  int(maxAttempts, 'maxAttempts', 1, 10);
  int(backoffMs, 'backoffMs', 100, 60000);
  if (attempt > maxAttempts) throw new Error('retry attempt exceeds maxAttempts');
  if (attempt > 1 && retrySafe !== true) throw new Error('unsafe workflow node cannot be retried automatically');
  const idempotencyKey = sha256({ tenantId, workflowId, workflowVersion, executionId, nodeId });
  return freeze({ status:attempt === maxAttempts ? 'last_retryable' : 'retryable', tenantId, workflowId, workflowVersion, executionId, nodeId, attempt, maxAttempts, backoffMs, runAt:new Date(now + backoffMs).toISOString(), idempotencyKey });
}

export function createWorkflowEnvironment({ tenantId, id, name, stage, protected:protectedEnv = false, branchRef = null } = {}) {
  ref(tenantId, 'tenantId'); ref(id, 'environmentId'); boundedText(name, 'name', 100);
  if (!['development','staging','production'].includes(stage)) throw new TypeError('environment stage is invalid');
  if (stage === 'production' && protectedEnv !== true) throw new Error('production environment must be protected');
  if (branchRef != null) boundedText(branchRef, 'branchRef', 120);
  const body = { tenantId, id, name, stage, protected:Boolean(protectedEnv), branchRef:branchRef || null };
  return freeze({ ...body, checksum:sha256(body) });
}

export function planEnvironmentPromotion({ tenantId, source, target, workflowId, workflowVersion, manifestSha256, approvedByActorId, sourceChangedAfterApproval = true } = {}) {
  ref(tenantId, 'tenantId'); ref(workflowId, 'workflowId');
  if (!source || !target || source.tenantId !== tenantId || target.tenantId !== tenantId) return { status:'blocked', code:'TENANT_MISMATCH' };
  if (source.stage === 'production') return { status:'blocked', code:'INVALID_SOURCE_STAGE' };
  if (target.stage !== 'production' || target.protected !== true) return { status:'blocked', code:'PRODUCTION_TARGET_MUST_BE_PROTECTED' };
  if (!HASH.test(manifestSha256 || '')) return { status:'blocked', code:'MANIFEST_REQUIRED' };
  if (!approvedByActorId || approvedByActorId === tenantId || approvedByActorId === source.ownerActorId) return { status:'blocked', code:'APPROVAL_REQUIRED' };
  if (sourceChangedAfterApproval) return { status:'blocked', code:'SOURCE_CHANGED_AFTER_APPROVAL' };
  const body = { tenantId, workflowId, workflowVersion, sourceEnvironmentId:source.id, targetEnvironmentId:target.id, manifestSha256, approvedByActorId };
  return freeze({ status:'ready', promotionId:'promotion_' + sha256(body).slice(0,24), ...body, checksum:sha256(body) });
}

export function createWorkflowTemplate({ tenantId, id, name, version, graph } = {}) {
  ref(tenantId, 'tenantId'); ref(id, 'templateId'); boundedText(name, 'name', 120); int(version, 'version', 1, 100000);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new TypeError('template graph is required');
  const normalized = createWorkflowGraph({ tenantId, id, version, name, nodes:graph.nodes, edges:graph.edges });
  if (!verifyWorkflowGraph(normalized)) throw new Error('template graph checksum invalid');
  const stripped = JSON.parse(JSON.stringify(normalized));
  return freeze({ tenantId, id, name, version, graph:stripped, manifestSha256:sha256({ tenantId, id, version, graph:normalized.checksum }) });
}

export function instantiateWorkflowTemplate({ template, tenantId, workflowId, substitutions = {} } = {}) {
  if (!template || template.tenantId !== tenantId) throw new Error('Template tenant mismatch');
  ref(workflowId, 'workflowId');
  const clone = JSON.parse(JSON.stringify(template.graph));
  let substitutionCount = 0;
  const replace = value => {
    if (typeof value === 'string' && Object.hasOwn(substitutions, value)) { substitutionCount++; return ref(substitutions[value], 'substitution'); }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
    return value;
  };
  const substituted = replace(clone);
  const graph = createWorkflowGraph({ tenantId, id:workflowId, version:template.version, name:template.name, nodes:substituted.nodes, edges:substituted.edges });
  return freeze({ status:'instantiated', tenantId, workflowId, templateId:template.id, templateVersion:template.version, substitutionCount, manifestSha256:sha256({ template:template.manifestSha256, workflow:graph.checksum }) });
}

export function createMcpServerManifest({ tenantId, serverId, tools = [] } = {}) {
  ref(tenantId, 'tenantId'); ref(serverId, 'serverId');
  if (!Array.isArray(tools) || tools.length < 1 || tools.length > 100) throw new TypeError('MCP tools must contain 1-100 entries');
  const seen = new Set();
  const normalized = tools.map((tool, index) => {
    assertPlainObject(tool, 'MCP tool ' + index);
    const name = boundedText(tool.name, 'MCP tool name', 120);
    const capability = boundedText(tool.capability, 'MCP capability', 160);
    if (seen.has(name)) throw new Error('MCP tool names must be unique');
    seen.add(name);
    if (/^secrets?\.|password|private_key/i.test(capability)) throw new Error('MCP secret capabilities are forbidden');
    if (!['read','network','write','financial','destructive'].includes(tool.risk)) throw new Error('MCP risk is invalid');
    return { name, risk:tool.risk, capability };
  });
  const body = { tenantId, serverId, tools:normalized.sort((a,b)=>a.name.localeCompare(b.name)) };
  return freeze({ ...body, checksum:sha256(body) });
}

export function authorizeMcpToolCall({ manifest, tenantId, toolName, actorCapabilities = [], argumentsValue = {} } = {}) {
  if (!manifest || manifest.tenantId !== tenantId || !HASH.test(manifest.checksum)) return { allowed:false, code:'MANIFEST_INVALID' };
  const tool = manifest.tools.find(item => item.name === toolName);
  if (!tool) return { allowed:false, code:'TOOL_NOT_FOUND' };
  if (!actorCapabilities.includes(tool.capability)) return { allowed:false, code:'CAPABILITY_DENIED' };
  const findings = scanUnsafe(argumentsValue);
  if (findings.length) return { allowed:false, code:'UNSAFE_ARGUMENTS' };
  if (['write','financial','destructive'].includes(tool.risk)) return { allowed:false, code:'HUMAN_APPROVAL_REQUIRED' };
  return { allowed:true, code:'ALLOWED', idempotencyKey:sha256({ tenantId, serverId:manifest.serverId, toolName, argumentsHash:sha256(argumentsValue) }) };
}

export function createAiWorkflowProposal({ tenantId, requestedByActorId, prompt, candidateNodes = [] } = {}) {
  ref(tenantId, 'tenantId'); ref(requestedByActorId, 'requestedByActorId');
  const promptText = boundedText(prompt, 'prompt', 4000);
  if (!Array.isArray(candidateNodes) || candidateNodes.length < 1 || candidateNodes.length > 50) throw new TypeError('candidateNodes must be 1-50');
  const selectedNodes = candidateNodes.map(type => boundedText(type, 'candidate node', 60));
  for (const type of selectedNodes) if (!WORKFLOW_NODE_CATALOG[type]) throw new Error('AI workflow proposal requested unsupported node: ' + type);
  const requiresHumanReview = selectedNodes.some(type => {
    const node = WORKFLOW_NODE_CATALOG[type];
    return ['write','network','financial','destructive'].includes(node.risk) || node.requiresApproval;
  });
  return freeze({
    status:'proposal_only',
    tenantId,
    requestedByActorId,
    promptHash:sha256(promptText),
    selectedNodes:[...new Set(selectedNodes)],
    requiresHumanReview:true,
    writeMode:'draft_only',
    explanationRef:'proposal_' + sha256({ tenantId, promptHash:sha256(promptText) }).slice(0,24),
    safeNodeCount:selectedNodes.filter(type => ['read'].includes(WORKFLOW_NODE_CATALOG[type].risk)).length,
    requiresHumanReview: true,
    riskReview:requiresHumanReview ? 'required' : 'advisory'
  });
}

export function auditWorkflowSecurity({ tenantId, workflow } = {}) {
  ref(tenantId, 'tenantId');
  const findings = [];
  if (!workflow || workflow.tenantId && workflow.tenantId !== tenantId) findings.push({ code:'TENANT_MISMATCH', severity:'critical' });
  if (!workflow || !Array.isArray(workflow.nodes)) findings.push({ code:'WORKFLOW_NODES_MISSING', severity:'critical' });
  for (const node of workflow?.nodes || []) {
    if (node.type === 'http_request' && node.config?.url) findings.push({ code:'DIRECT_NETWORK_URL', severity:'critical', nodeId:node.id });
    if (node.risk === 'financial' || node.risk === 'destructive' || node.requiresApproval) {
      if (node.config?.approvalRequired !== true && node.requiresApproval !== true) findings.push({ code:'HIGH_RISK_APPROVAL_MISSING', severity:'high', nodeId:node.id });
    }
    if (node.type === 'trigger' && node.config?.eventType === 'webhook.received' && node.config?.verificationMode !== 'signed') {
      findings.push({ code:'UNPROTECTED_WEBHOOK', severity:'high', nodeId:node.id });
    }
    const unsafe = scanUnsafe(node.config || {});
    for (const item of unsafe) if (!findings.some(finding => finding.code === item.code && finding.nodeId === node.id)) findings.push({ code:item.code, severity:'high', nodeId:node.id, path:item.path });
  }
  const status = findings.some(item => item.severity === 'critical') ? 'blocked' : findings.length ? 'review_required' : 'ready';
  return freeze({ status, tenantId, workflowId:workflow?.id || null, findings });
}
