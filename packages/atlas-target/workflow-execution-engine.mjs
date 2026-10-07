import crypto from 'node:crypto';
import { verifyWorkflowGraph } from './index.mjs';
import { normalizeWorkflowError } from './workflow-runtime-contracts.mjs';

const EXECUTION_STATUSES = Object.freeze(['queued','running','waiting','waiting_approval','retryable','completed','failed','reconciliation_required','canceled','dead_letter']);
const TERMINAL_STATUSES = new Set(['completed','failed','canceled','dead_letter']);
const STEP_STATUSES = Object.freeze(['running','completed','failed','needs_approval']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF_KEY = /^[A-Za-z][A-Za-z0-9_.:_-]{0,79}$/;
const ERROR_CODE = /^[a-z][a-z0-9_.-]{0,79}$/;

function canonical(value) {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
      : value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function boundedText(value, label, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n\u0000]/.test(value)) {
    throw new Error(label + ' is invalid');
  }
  return value.trim();
}

function timestamp(value, label, fallback = null) {
  const candidate = value == null ? fallback : value;
  const parsed = typeof candidate === 'number' ? candidate : Date.parse(candidate);
  if (!Number.isFinite(parsed)) throw new Error(label + ' must be a valid timestamp');
  return parsed;
}

function reference(value, label) {
  const result = boundedText(value, label, 180);
  if ((!UUID.test(result) && !REF_KEY.test(result)) || /^(password|secret|token|credential|authorization|cookie|raw[_-]?body|message[_-]?body|transcript)$/i.test(result)) {
    throw new Error(label + ' must be an opaque reference');
  }
  return result;
}

function resultReference(value, label = 'resultRef') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be a reference object');
  const keys = Object.keys(value);
  if (keys.some(key => !['kind','id','version'].includes(key))) throw new Error(label + ' contains unsupported fields');
  if (typeof value.kind !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/.test(value.kind)) throw new Error(label + '.kind is invalid');
  const id = reference(value.id, label + '.id');
  if ('version' in value && (!Number.isSafeInteger(value.version) || value.version < 1)) throw new Error(label + '.version is invalid');
  return deepFreeze({ kind: value.kind, id, ...(value.version === undefined ? {} : { version: value.version }) });
}

function freezeState(body) {
  return deepFreeze({ ...body, checksum: digest(body) });
}

function verifyExecution(execution) {
  if (!execution || typeof execution !== 'object' || typeof execution.checksum !== 'string') return false;
  const { checksum, ...body } = execution;
  return /^[a-f0-9]{64}$/.test(checksum) && digest(body) === checksum;
}

function transition(execution, patch) {
  const { checksum, ...body } = execution;
  return freezeState({ ...body, ...patch, version: execution.version + 1, updatedAt: patch.updatedAt || new Date().toISOString() });
}

function assertMutable(execution) {
  if (!verifyExecution(execution)) throw new Error('Workflow execution checksum is invalid');
  if (TERMINAL_STATUSES.has(execution.status)) throw new Error('Workflow execution is terminal');
}

function nodeFor(execution, nodeId) {
  const node = execution.workflowNodes?.find(item => item.id === nodeId);
  if (!node) throw new Error('Workflow execution node is unavailable');
  return node;
}

function nextNodeFor(execution, nodeId, port = 'next') {
  const outgoing = execution.workflowEdges.filter(edge => edge.from === nodeId);
  if (!outgoing.length) return null;
  return outgoing.find(edge => edge.port === port)
    || outgoing.find(edge => edge.port === 'next')
    || outgoing.find(edge => edge.port === 'default')
    || outgoing[0]
    ? (outgoing.find(edge => edge.port === port) || outgoing.find(edge => edge.port === 'next') || outgoing.find(edge => edge.port === 'default') || outgoing[0]).to
    : null;
}

function waitResumeAt(node, finishedAt) {
  if (node.type === 'delay') {
    const delayMs = Number(node.config?.delayMs);
    if (!Number.isSafeInteger(delayMs) || delayMs < 1_000 || delayMs > 30 * 24 * 60 * 60_000) throw new Error('Workflow delay must be between 1 second and 30 days');
    return finishedAt + delayMs;
  }
  if (node.type === 'wait_until') {
    const resumeAt = timestamp(node.config?.resumeAt, 'resumeAt');
    if (resumeAt <= finishedAt) throw new Error('Workflow wait-until time must be in the future');
    if (resumeAt - finishedAt > 30 * 24 * 60 * 60_000) throw new Error('Workflow wait-until cannot exceed 30 days');
    return resumeAt;
  }
  return null;
}

function appendStep(execution, step) {
  if (execution.steps.length >= 500) throw new Error('Workflow execution step history exceeds 500 steps');
  return [...execution.steps, deepFreeze(step)];
}

export function createWorkflowExecution({
  tenantId,
  executionId = crypto.randomUUID(),
  workflow,
  triggerEventRef,
  createdByActorId,
  now = Date.now()
} = {}) {
  if (!verifyWorkflowGraph(workflow)) throw new Error('Workflow graph checksum is invalid');
  if (!UUID.test(executionId)) throw new Error('executionId must be a UUID');
  if (typeof tenantId !== 'string' || !tenantId.trim()) throw new Error('tenantId is required');
  if (workflow.tenantId !== tenantId) throw new Error('Workflow tenant mismatch');
  const eventRef = reference(triggerEventRef, 'triggerEventRef');
  const actor = reference(createdByActorId, 'createdByActorId');
  const started = timestamp(now, 'now');
  const trigger = workflow.nodes.find(node => node.type === 'trigger');
  const body = {
    executionId,
    tenantId,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    graphChecksum: workflow.checksum,
    workflowName: workflow.name,
    workflowNodes: workflow.nodes,
    workflowEdges: workflow.edges,
    triggerNodeId: trigger.id,
    triggerEventType: trigger.config.eventType,
    triggerEventRef: eventRef,
    createdByActorId: actor,
    status: 'queued',
    currentNodeId: trigger.id,
    steps: [],
    approval: null,
    retryAt: null,
    resumeAt: null,
    lastErrorCode: null,
    startedAt: new Date(started).toISOString(),
    endedAt: null,
    version: 1,
    createdAt: new Date(started).toISOString(),
    updatedAt: new Date(started).toISOString()
  };
  return freezeState(body);
}

export function verifyWorkflowExecution(execution) {
  return verifyExecution(execution);
}

export function completeWorkflowStep({
  execution,
  nodeId,
  attempt = 1,
  resultRef = null,
  selectedPort = 'next',
  now = Date.now()
} = {}) {
  assertMutable(execution);
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 10) throw new Error('Workflow step attempt is invalid');

  const prior = execution.steps.find(step => step.nodeId === nodeId && step.attempt === attempt && step.status === 'completed');
  if (prior) return execution;

  if (execution.currentNodeId !== nodeId) throw new Error('Workflow step is not the current step');

  const node = nodeFor(execution, nodeId);
  if (attempt > node.retry.maxAttempts) throw new Error('Attempt exceeds this node retry limit');
  const finishedAt = timestamp(now, 'now');
  const stepId = 'step_' + crypto.randomUUID().replaceAll('-', '');
  const safeResultRef = resultRef == null ? null : resultReference(resultRef);
  const step = {
    stepId,
    nodeId,
    nodeType: node.type,
    attempt,
    status: 'completed',
    selectedPort: boundedText(selectedPort || 'next', 'selectedPort', 40),
    resultRef: safeResultRef,
    startedAt: execution.steps.find(item => item.nodeId === nodeId && item.attempt === attempt)?.startedAt || new Date(finishedAt).toISOString(),
    endedAt: new Date(finishedAt).toISOString(),
    errorCode: null
  };
  const steps = appendStep(execution, step);
  const resumeAtMs = waitResumeAt(node, finishedAt);
  if (resumeAtMs !== null) {
    return transition(execution, {
      status: 'waiting',
      currentNodeId: nodeId,
      retryAt: null,
      resumeAt: new Date(resumeAtMs).toISOString(),
      lastErrorCode: null,
      steps,
      endedAt: null
    });
  }
  const nextNodeId = node.type === 'stop' ? null : nextNodeFor(execution, nodeId, step.selectedPort);
  const completed = !nextNodeId;
  return transition(execution, {
    status: completed ? 'completed' : 'queued',
    currentNodeId: nextNodeId,
    retryAt: null,
    resumeAt: null,
    lastErrorCode: null,
    steps,
    endedAt: completed ? new Date(finishedAt).toISOString() : null
  });
}

export function resumeWorkflowExecution({ execution, now = Date.now() } = {}) {
  assertMutable(execution);
  if (execution.status !== 'waiting') throw new Error('Workflow execution is not waiting');
  if (!execution.resumeAt) throw new Error('Workflow execution has no resume time');
  const current = timestamp(now, 'now');
  const resumeAt = timestamp(execution.resumeAt, 'resumeAt');
  if (current < resumeAt) return execution;
  const node = nodeFor(execution, execution.currentNodeId);
  const nextNodeId = node.type === 'stop' ? null : nextNodeFor(execution, node.id, 'next');
  const completed = !nextNodeId;
  const resumedAt = new Date(current).toISOString();
  return transition(execution, {
    status: completed ? 'completed' : 'queued',
    currentNodeId: nextNodeId,
    resumeAt: null,
    endedAt: completed ? resumedAt : null,
    updatedAt: resumedAt
  });
}

export function requestWorkflowApproval({
  execution,
  nodeId,
  requestedByActorId,
  now = Date.now(),
  expiresAt
} = {}) {
  assertMutable(execution);
  if (execution.currentNodeId !== nodeId) throw new Error('Approval can only be requested for the current workflow step');
  const node = nodeFor(execution, nodeId);
  if (!node.requiresApproval) throw new Error('This workflow node does not require approval');
  if (execution.approval?.status === 'pending') return execution;

  const requestedAtMs = timestamp(now, 'now');
  const expiresAtMs = timestamp(expiresAt, 'expiresAt');
  if (expiresAtMs <= requestedAtMs || expiresAtMs - requestedAtMs > 15 * 60_000) throw new Error('Approval expiry must be within 15 minutes');
  const requestedBy = reference(requestedByActorId, 'requestedByActorId');
  const approval = {
    approvalId: 'approval_' + crypto.randomUUID().replaceAll('-', ''),
    executionId: execution.executionId,
    tenantId: execution.tenantId,
    workflowId: execution.workflowId,
    graphChecksum: execution.graphChecksum,
    nodeId,
    idempotencyKey: digest({ tenantId: execution.tenantId, executionId: execution.executionId, nodeId }),
    requestedByActorId: requestedBy,
    approvedByActorId: null,
    requestedAt: new Date(requestedAtMs).toISOString(),
    approvedAt: null,
    expiresAt: new Date(expiresAtMs).toISOString(),
    status: 'pending',
    evidenceRef: null
  };
  return transition(execution, { status: 'waiting_approval', approval: deepFreeze(approval) });
}

export function approveWorkflowExecution({
  execution,
  approvalId,
  approvedByActorId,
  evidenceRef = null,
  now = Date.now()
} = {}) {
  assertMutable(execution);
  const approval = execution.approval;
  const current = timestamp(now, 'now');
  if (!approval || approval.status !== 'pending') throw new Error('No pending workflow approval exists');
  if (approval.approvalId !== approvalId) throw new Error('Workflow approval ID mismatch');
  if (Date.parse(approval.expiresAt) <= current) throw new Error('Workflow approval has expired');
  const actor = reference(approvedByActorId, 'approvedByActorId');
  if (actor === approval.requestedByActorId) throw new Error('Workflow approval cannot be self-approved');
  const approvedAt = new Date(current).toISOString();
  const nextApproval = {
    ...approval,
    approvedByActorId: actor,
    approvedAt,
    status: 'approved',
    evidenceRef: evidenceRef == null ? null : resultReference(evidenceRef, 'evidenceRef')
  };
  return transition(execution, {
    status: 'queued',
    approval: deepFreeze(nextApproval),
    updatedAt: approvedAt
  });
}

export function failWorkflowStep({
  execution,
  nodeId,
  attempt = 1,
  errorCode,
  now = Date.now()
} = {}) {
  assertMutable(execution);
  if (execution.currentNodeId !== nodeId) throw new Error('Workflow step is not the current step');
  const normalizedError = normalizeWorkflowError({ code:errorCode, source:'workflow_step' });
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 10) throw new Error('Workflow step attempt is invalid');
  const node = nodeFor(execution, nodeId);
  const failedAt = timestamp(now, 'now');
  const retryAllowed = normalizedError.retryable
    && normalizedError.externalOutcome !== 'unknown'
    && attempt < node.retry.maxAttempts
    && node.retrySafe;
  const retryAt = retryAllowed
    ? failedAt + Math.min(60 * 60_000, node.retry.backoffMs * (2 ** (attempt - 1)))
    : null;
  const step = {
    stepId: 'step_' + crypto.randomUUID().replaceAll('-', ''),
    nodeId,
    nodeType: node.type,
    attempt,
    status: 'failed',
    selectedPort: null,
    resultRef: null,
    startedAt: execution.steps.find(item => item.nodeId === nodeId && item.attempt === attempt)?.startedAt || new Date(failedAt).toISOString(),
    endedAt: new Date(failedAt).toISOString(),
    errorCode:normalizedError.code,
    errorCategory:normalizedError.category,
    externalOutcome:normalizedError.externalOutcome,
    retryable:normalizedError.retryable
  };
  const reconciliation = normalizedError.externalOutcome === 'unknown' ? deepFreeze({
    reconciliationId:'reconcile_' + crypto.randomUUID().replaceAll('-', ''),
    executionId:execution.executionId,
    tenantId:execution.tenantId,
    workflowId:execution.workflowId,
    graphChecksum:execution.graphChecksum,
    nodeId,
    errorCode:normalizedError.code,
    category:normalizedError.category,
    status:'required',
    resolution:null,
    resolvedByActorId:null,
    requestedAt:new Date(failedAt).toISOString(),
    resolvedAt:null
  }) : null;
  return transition(execution, {
    status: normalizedError.externalOutcome === 'unknown' ? 'reconciliation_required' : (retryAllowed ? 'retryable' : 'dead_letter'),
    currentNodeId: normalizedError.externalOutcome === 'unknown' ? nodeId : (retryAllowed ? nodeId : null),
    retryAt: normalizedError.externalOutcome === 'unknown' ? null : (retryAllowed ? new Date(retryAt).toISOString() : null),
    lastErrorCode: normalizedError.code,
    reconciliation,
    steps: appendStep(execution, step),
    endedAt: normalizedError.externalOutcome === 'unknown' || retryAllowed ? null : new Date(failedAt).toISOString(),
    updatedAt: new Date(failedAt).toISOString()
  });
}

export function resolveWorkflowReconciliation({
  execution,
  reconciliationId,
  resolution,
  resolvedByActorId,
  now = Date.now()
} = {}) {
  assertMutable(execution);
  if (execution.status !== 'reconciliation_required') throw new Error('Workflow execution is not awaiting reconciliation');
  const pending = execution.reconciliation;
  if (!pending || pending.status !== 'required') throw new Error('No pending reconciliation exists');
  if (pending.reconciliationId !== reconciliationId) throw new Error('Workflow reconciliation ID mismatch');
  if (!['confirmed_success','confirmed_failure'].includes(resolution)) throw new Error('Workflow reconciliation resolution is invalid');
  const actor = reference(resolvedByActorId, 'resolvedByActorId');
  const resolvedAt = new Date(timestamp(now, 'now')).toISOString();
  const next = deepFreeze({
    ...pending,
    status:'resolved',
    resolution,
    resolvedByActorId:actor,
    resolvedAt
  });
  return transition(execution, {
    reconciliation:next,
    status:resolution === 'confirmed_success' ? 'queued' : 'dead_letter',
    currentNodeId:resolution === 'confirmed_success' ? pending.nodeId : null,
    retryAt:null,
    endedAt:resolution === 'confirmed_success' ? null : resolvedAt,
    lastErrorCode:resolution === 'confirmed_success' ? null : pending.errorCode,
    updatedAt:resolvedAt
  });
}

export function cancelWorkflowExecution({
  execution,
  requestedByActorId,
  now = Date.now()
} = {}) {
  assertMutable(execution);
  const actor = reference(requestedByActorId, 'requestedByActorId');
  const canceledAt = new Date(timestamp(now, 'now')).toISOString();
  return transition(execution, {
    status: 'canceled',
    currentNodeId: null,
    retryAt: null,
    lastErrorCode: 'canceled_by_user',
    endedAt: canceledAt,
    canceledByActorId: actor,
    updatedAt: canceledAt
  });
}

export function replayWorkflowExecution({
  execution,
  replayExecutionId = crypto.randomUUID(),
  requestedByActorId,
  now = Date.now()
} = {}) {
  if (!verifyExecution(execution)) throw new Error('Workflow execution checksum is invalid');
  if (!UUID.test(replayExecutionId)) throw new Error('replayExecutionId must be a UUID');
  reference(requestedByActorId, 'requestedByActorId');
  const replayed = {
    executionId: replayExecutionId,
    tenantId: execution.tenantId,
    workflowId: execution.workflowId,
    workflowVersion: execution.workflowVersion,
    graphChecksum: execution.graphChecksum,
    workflowName: execution.workflowName,
    workflowNodes: execution.workflowNodes,
    workflowEdges: execution.workflowEdges,
    triggerNodeId: execution.triggerNodeId,
    triggerEventType: execution.triggerEventType,
    triggerEventRef: execution.triggerEventRef,
    createdByActorId: requestedByActorId,
    status: 'queued',
    currentNodeId: execution.triggerNodeId,
    steps: [],
    approval: null,
    retryAt: null,
    lastErrorCode: null,
    startedAt: new Date(timestamp(now, 'now')).toISOString(),
    endedAt: null,
    replayOfExecutionId: execution.executionId,
    version: 1,
    createdAt: new Date(timestamp(now, 'now')).toISOString(),
    updatedAt: new Date(timestamp(now, 'now')).toISOString()
  };
  return freezeState(replayed);
}

export function startWorkflowStep(execution, { nodeId = execution.currentNodeId, attempt = 1, now = Date.now() } = {}) {
  assertMutable(execution);
  if (execution.status === 'retryable' && execution.retryAt && Date.parse(execution.retryAt) > timestamp(now, 'now')) return execution;
  if (execution.currentNodeId !== nodeId) throw new Error('Workflow step is not the current step');
  const node = nodeFor(execution, nodeId);
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > node.retry.maxAttempts) throw new Error('Workflow step attempt is invalid');
  const existing = execution.steps.find(step => step.nodeId === nodeId && step.attempt === attempt && ['running','completed'].includes(step.status));
  if (existing?.status === 'running') return execution;
  const stepId = 'step_' + crypto.randomUUID().replaceAll('-', '');
  const step = {
    stepId,
    nodeId,
    nodeType: node.type,
    attempt,
    status: 'running',
    selectedPort: null,
    resultRef: null,
    startedAt: new Date(timestamp(now, 'now')).toISOString(),
    endedAt: null,
    errorCode: null
  };
  return transition(execution, { status: 'running', retryAt: null, steps: appendStep(execution, step) });
}
