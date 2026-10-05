import crypto from 'node:crypto';
import { planWorkflowNode, verifyWorkflowGraph } from './index.mjs';

const MAX_STEPS = 200;
const MAX_CONTEXT_KEYS = 200;
const MAX_ARRAY = 100;

function fail(message, code = 'workflow_preview_invalid') {
  throw Object.assign(new Error(message), { code });
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function safeJson(value, path = 'value', depth = 0, seen = new WeakSet(), state = { bytes: 0 }) {
  if (depth > 8) fail(path + ' nesting is too deep');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 8192 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(path + ' contains unsafe text');
    state.bytes += Buffer.byteLength(value, 'utf8');
    if (state.bytes > 64_000) fail('Preview context exceeds 64 KB');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path + ' must be finite');
    return value;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) fail(path + ' must be finite JSON data');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) fail(path + ' array is too large');
    result = value.map((item, index) => safeJson(item, path + '[' + index + ']', depth + 1, seen, state));
  } else {
    if (!plain(value)) fail(path + ' must be a plain object');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > MAX_CONTEXT_KEYS || keys.some(key => typeof key !== 'string' || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value') || ['__proto__', 'prototype', 'constructor'].includes(key))) fail(path + ' contains an unsafe property');
    result = {};
    for (const key of keys) result[key] = safeJson(descriptors[key].value, path + '.' + key, depth + 1, seen, state);
  }
  seen.delete(value);
  return result;
}

function getPath(value, path) {
  if (!path) return value;
  return path.split('.').filter(Boolean).reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, value);
}

function setPath(value, path, nextValue) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length || parts.length > 8 || parts.some(part => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))) fail('Transform target path is invalid');
  let cursor = value;
  for (const part of parts.slice(0, -1)) {
    if (!plain(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = nextValue;
}

function compare(left, operator, right) {
  switch (operator) {
    case 'equals': return left === right;
    case 'not_equals': return left !== right;
    case 'contains': return typeof left === 'string' && left.includes(String(right));
    case 'not_contains': return typeof left === 'string' && !left.includes(String(right));
    case 'exists': return left !== undefined && left !== null && left !== '';
    case 'not_exists': return left === undefined || left === null || left === '';
    case 'gt': return typeof left === 'number' && left > right;
    case 'gte': return typeof left === 'number' && left >= right;
    case 'lt': return typeof left === 'number' && left < right;
    case 'lte': return typeof left === 'number' && left <= right;
    case 'in': return Array.isArray(right) && right.includes(left);
    default: fail('Unsupported preview condition operator: ' + operator);
  }
}

function choosePort(node, context) {
  if (!['condition', 'switch'].includes(node.type)) return 'next';
  const cases = Array.isArray(node.config?.cases) ? node.config.cases : [];
  for (const item of cases) {
    if (!item || typeof item !== 'object') continue;
    const field = typeof item.field === 'string' ? item.field : typeof item.path === 'string' ? item.path : null;
    if (!field) continue;
    const actual = getPath(context, field.startsWith('$') ? field.slice(1) : field);
    if (compare(actual, item.operator || 'equals', item.value)) return String(item.id || item.port || 'next');
  }
  return String(node.config?.defaultPort || 'default');
}

function edgeFor(graph, node, port) {
  const outgoing = graph.edges.filter(edge => edge.from === node.id);
  if (!outgoing.length) return null;
  return outgoing.find(edge => edge.port === port) || outgoing.find(edge => edge.port === 'next') || outgoing.find(edge => edge.port === 'default') || outgoing[0];
}

function nowIso(ms) {
  return new Date(ms).toISOString();
}

function executionDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function nodeOutput(node, context) {
  const event = context.event;
  if (node.type === 'transform') {
    const mapping = plain(node.config?.mapping) ? node.config.mapping : {};
    const output = {};
    for (const [key, source] of Object.entries(mapping)) {
      if (typeof source === 'string') output[key] = getPath(context, source.replace(/^\$/, ''));
      else output[key] = safeJson(source, 'transform.' + key);
    }
    return output;
  }

  if (node.type === 'math') {
    const operation = node.config?.operation || 'add';
    const args = Array.isArray(node.config?.values) ? node.config.values : Array.isArray(node.config?.args) ? node.config.args : [];
    const numbers = args.map(item => Number(typeof item === 'string' ? getPath(context, item.replace(/^\$/, '')) : item));
    if (!numbers.length || numbers.some(number => !Number.isFinite(number))) fail('Preview math requires finite numeric values');
    const result = operation === 'subtract' ? numbers.slice(1).reduce((a, b) => a - b, numbers[0])
      : operation === 'multiply' ? numbers.reduce((a, b) => a * b, 1)
      : operation === 'divide' ? numbers.slice(1).reduce((a, b) => a / b, numbers[0])
      : operation === 'round' ? Math.round(numbers[0])
      : numbers.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(result)) fail('Preview math produced a non-finite result');
    return { result };
  }

  if (node.type === 'text_format') {
    const template = typeof node.config?.template === 'string' ? node.config.template : '{{event.firstName}}';
    return {
      text: template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path) => {
        const value = getPath(context, path.replace(/^event\./, 'event.'));
        return value == null ? '' : String(value);
      }).slice(0, 8000)
    };
  }

  if (node.type === 'filter_array') {
    const source = getPath(context, String(node.config?.sourcePath || 'event.items'));
    if (!Array.isArray(source)) return { items: [] };
    const filtered = source.filter(item => {
      if (!plain(node.config?.where)) return true;
      const actual = getPath(item, node.config.where.field || '');
      return compare(actual, node.config.where.operator || 'exists', node.config.where.value);
    });
    return { items: safeJson(filtered, 'filter_array.items') };
  }

  if (node.type === 'map_array') {
    const source = getPath(context, String(node.config?.sourcePath || 'event.items'));
    if (!Array.isArray(source)) return { items: [] };
    const path = String(node.config?.valuePath || '');
    return { items: safeJson(source.map(item => getPath(item, path)), 'map_array.items') };
  }

  if (node.type === 'split_batches') {
    const source = getPath(context, String(node.config?.sourcePath || 'event.items'));
    const batchSize = Number(node.config?.batchSize || 1);
    if (!Array.isArray(source)) return { batches: [] };
    const batches = [];
    for (let index = 0; index < source.length; index += batchSize) batches.push(source.slice(index, index + batchSize));
    return { batches: safeJson(batches, 'split_batches.batches') };
  }

  if (node.type === 'merge') {
    const sources = Array.isArray(node.config?.sources) ? node.config.sources : [];
    const merged = {};
    for (const source of sources) {
      if (typeof source !== 'string') continue;
      const value = getPath(context, source);
      if (plain(value)) Object.assign(merged, value);
    }
    return merged;
  }

  if (node.type === 'goal') return { goal: node.config?.goal || node.name, reached: true };

  if (node.type === 'trigger') return safeJson(event, 'event');

  if (['condition', 'switch', 'approval', 'stop'].includes(node.type)) return {};

  if (['create_contact', 'create_task', 'set_field', 'tag', 'create_opportunity', 'book_appointment', 'send_message', 'notify_internal', 'invoke_agent', 'ai_generate', 'ai_classify', 'ai_summarize', 'knowledge_search'].includes(node.type)) {
    return {
      simulated: true,
      reference: 'preview_' + executionDigest({ nodeId: node.id, event: event && event.id ? event.id : event }),
      message: 'No external side effect was performed in preview mode.'
    };
  }

  if (node.execution !== 'native') {
    return {
      simulated: true,
      dependency: node.execution,
      message: 'This dependency was simulated; preview mode does not call external services.'
    };
  }

  return {};
}

function applyOutput(context, output) {
  if (!plain(output)) return;
  const next = { ...context };
  Object.assign(next.output, output);
  for (const [key, value] of Object.entries(output)) next[key] = value;
  return next;
}

function validateTime(now) {
  const current = Number(now);
  if (!Number.isFinite(current) || !Number.isFinite(new Date(current).getTime())) fail('now must be a valid timestamp');
  return current;
}

export function simulateWorkflow({
  graph,
  tenantId,
  executionId = 'preview-' + crypto.randomUUID(),
  event = {},
  approvedNodeIds = [],
  now = Date.now(),
  maxSteps = 100
} = {}) {
  if (!verifyWorkflowGraph(graph) || graph.tenantId !== tenantId) fail('Workflow graph tenant or checksum invalid', 'tenant_mismatch');
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS) fail('maxSteps must be 1-200');
  if (typeof executionId !== 'string' || executionId.trim().length < 3 || executionId.length > 180 || /[\r\n\u0000]/.test(executionId)) fail('executionId is invalid');
  const current = validateTime(now);
  if (!Array.isArray(approvedNodeIds) || approvedNodeIds.length > 100 || approvedNodeIds.some(id => typeof id !== 'string' || id.length > 180)) fail('approvedNodeIds is invalid');

  const start = graph.nodes.find(node => node.type === 'trigger');
  if (!start) fail('Workflow trigger is missing');

  const context = safeJson({ event, output: {}, execution: { id: executionId, mode: 'preview', tenantId } }, 'context');
  const approvalSet = new Set(approvedNodeIds);
  const steps = [];
  let cursor = start.id;
  let status = 'completed';
  let sideEffects = 0;
  let simulatedDependencies = new Set();

  for (let index = 0; index < maxSteps && cursor; index += 1) {
    const node = graph.nodes.find(item => item.id === cursor);
    if (!node) fail('Workflow points to a missing node');
    const startedAt = current + index;
    let planned = planWorkflowNode({ graph, nodeId: node.id, tenantId, executionId, attempt: 1, now: startedAt });

    if (node.requiresApproval && approvalSet.has(node.id)) {
      const approvalEvidence = {
        status: 'approved',
        approvalId: 'preview-approval-' + node.id,
        tenantId,
        graphChecksum: graph.checksum,
        executionId,
        nodeId: node.id,
        idempotencyKey: planned.idempotencyKey,
        requestedByActorId: 'preview-request',
        approvedByActorId: 'preview-operator',
        approvedAt: nowIso(startedAt),
        expiresAt: nowIso(startedAt + 5 * 60_000)
      };
      planned = planWorkflowNode({
        graph,
        nodeId: node.id,
        tenantId,
        executionId,
        attempt: 1,
        approvalEvidence,
        approvalVerifier: () => true,
        requestedByActorId: 'preview-request',
        now: startedAt
      });
    }

    if (planned.status === 'needs_approval') {
      steps.push({ nodeId: node.id, nodeType: node.type, status: 'needs_approval', startedAt: nowIso(startedAt), finishedAt: nowIso(startedAt), durationMs: 0, reason: 'Node requires approval before it can continue in preview mode.', dependency: node.execution });
      status = 'needs_approval';
      break;
    }

    const output = nodeOutput(node, context);
    const stepStatus = node.execution === 'native' ? 'completed' : 'simulated';
    if (stepStatus === 'simulated') {
      simulatedDependencies.add(node.execution);
      if (node.risk === 'network' || node.risk === 'write' || node.risk === 'financial' || node.risk === 'destructive') sideEffects += 0;
    }

    const finishedAt = startedAt + 1;
    const step = {
      nodeId: node.id,
      nodeType: node.type,
      status: stepStatus,
      startedAt: nowIso(startedAt),
      finishedAt: nowIso(finishedAt),
      durationMs: 1,
      dependency: node.execution,
      risk: node.risk,
      retrySafe: node.retrySafe,
      requiresApproval: node.requiresApproval,
      output
    };

    if (['delay', 'wait_until', 'await_event'].includes(node.type)) {
      step.reason = 'Preview mode advances without sleeping or registering a durable wait.';
    } else if (stepStatus === 'simulated') {
      step.reason = 'Preview mode: external provider/model side effect was not executed.';
    }

    steps.push(step);
    if (node.type === 'stop') break;

    let nextEdge;
    if (['condition', 'switch'].includes(node.type)) {
      const port = choosePort(node, context);
      nextEdge = edgeFor(graph, node, port);
      step.branch = port;
    } else {
      nextEdge = edgeFor(graph, node, 'next');
    }

    const nextContext = applyOutput(context, output);
    Object.assign(context, nextContext);

    cursor = nextEdge?.to || null;
    if (!cursor) break;
  }

  if (steps.length >= maxSteps && cursor) status = 'failed';

  return {
    preview: true,
    executionId,
    tenantId,
    status,
    externalSideEffects: sideEffects,
    simulatedDependencies: [...simulatedDependencies].sort(),
    steps,
    summary: {
      total: steps.length,
      completed: steps.filter(step => step.status === 'completed').length,
      simulated: steps.filter(step => step.status === 'simulated').length,
      approvals: steps.filter(step => step.status === 'needs_approval').length,
      failed: steps.filter(step => step.status === 'failed').length
    }
  };
}
