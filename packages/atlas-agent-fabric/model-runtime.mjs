import crypto from 'node:crypto';
import { validateAgentOutput } from '../atlas-target/index.mjs';

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$/;
const STATUSES = new Set(['completed','tool_calls','failed','canceled']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function ref(value, label) {
  if (typeof value !== 'string' || !REF.test(value)) throw new TypeError(label + ' must be a bounded reference');
  return value;
}
function hash(value, label) {
  if (typeof value !== 'string' || !HASH.test(value)) throw new TypeError(label + ' must be SHA-256');
  return value;
}
function bounded(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n\u0000]/.test(value)) throw new TypeError(label + ' must be bounded text');
  return value.trim();
}
function rejectSecrets(value, path = 'input') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((v, i) => rejectSecrets(v, path + '[' + i + ']'));
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:secret|token|access_token|refresh_token|api_key|apikey|authorization|cookie|private_key|client_secret)$/i.test(key)) {
      throw new TypeError(path + ' cannot contain secret material');
    }
    rejectSecrets(child, path + '.' + key);
  }
}
function requestChecksum(body) { return sha(body); }
function verifyRequest(request) {
  if (!request || typeof request !== 'object' || typeof request.checksum !== 'string') return false;
  const { checksum, ...body } = request;
  return HASH.test(checksum) && requestChecksum(body) === checksum;
}
function normalizePolicy(policy = {}) {
  const maxOutputChars = policy.maxOutputChars ?? Math.min(Math.max((policy.maxOutputTokens ?? 1200) * 4, 256), 20000);
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars < 100 || maxOutputChars > 20000) throw new TypeError('maxOutputChars is outside policy bounds');
  return Object.freeze({ provider: bounded(policy.provider ?? 'model_adapter', 'model provider', 80), timeoutMs: policy.timeoutMs ?? 30000, maxOutputChars });
}

export function createModelAdapter({ provider, version = 1, infer, stream = null } = {}) {
  const name = bounded(provider, 'provider', 80);
  if (!Number.isSafeInteger(version) || version < 1 || version > 1000) throw new TypeError('adapter version invalid');
  if (typeof infer !== 'function' && typeof stream !== 'function') throw new TypeError('model adapter requires infer or stream');
  if (stream != null && typeof stream !== 'function') throw new TypeError('stream must be a function');
  return Object.freeze({ provider: name, version, infer, stream });
}

export function createModelRequest({
  tenantId, agentRelease, sessionId, turnId, promptHash, inputRef, responseMode = 'text',
  outputSchema = null, now = Date.now()
} = {}) {
  ref(tenantId, 'tenantId'); ref(sessionId, 'sessionId'); ref(turnId, 'turnId'); ref(inputRef, 'inputRef');
  if (!agentRelease || agentRelease.tenantId !== tenantId || typeof agentRelease.releaseId !== 'string') throw new Error('Agent release is not tenant-bound');
  hash(promptHash, 'promptHash');
  if (!['text','structured'].includes(responseMode)) throw new TypeError('responseMode invalid');
  if (responseMode === 'structured' && (!outputSchema || typeof outputSchema !== 'object' || Array.isArray(outputSchema))) throw new TypeError('outputSchema required for structured responses');
  const body = {
    tenantId, sessionId, turnId, releaseId: agentRelease.releaseId, releaseVersion: agentRelease.version,
    modelProvider: agentRelease.modelPolicy?.provider ?? 'model_adapter', promptHash, inputRef, responseMode,
    outputSchema: responseMode === 'structured' ? outputSchema : null,
    rawPromptStored: false,
    createdAt: new Date(Number(now)).toISOString()
  };
  return freeze({ ...body, idempotencyKey: sha(body), checksum: requestChecksum(body) });
}

export async function invokeModelTurn({ request, adapter, input, signal, onDelta = null, now = Date.now() } = {}) {
  if (!verifyRequest(request)) throw new Error('Model request checksum is invalid');
  if (!adapter || request.modelProvider !== adapter.provider) throw Object.assign(new Error('Model provider adapter mismatch'), { code: 'MODEL_PROVIDER_MISMATCH' });
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Transient model input is invalid');
  rejectSecrets(input);
  const policy = normalizePolicy(request.modelPolicy || { provider: adapter.provider });
  const maxChars = policy.maxOutputChars;
  const started = Number(now);
  const abortController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abortController.abort(); }, policy.timeoutMs);
  const forwardAbort = () => abortController.abort();
  if (signal) {
    if (signal.aborted) abortController.abort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }
  try {
    let output = null;
    let toolCalls = [];
    let finishReason = 'stop';
    let usage = {};
    if (request.responseMode === 'text' && onDelta && typeof adapter.stream === 'function') {
      let assembled = '';
      const stream = await adapter.stream({ request, input, signal: abortController.signal });
      for await (const event of stream) {
        if (event?.delta != null) {
          const delta = bounded(String(event.delta), 'model delta', 2000);
          if (assembled.length + delta.length > maxChars) throw Object.assign(new Error('Model response exceeds output budget'), { code: 'MODEL_OUTPUT_LIMIT' });
          assembled += delta;
          onDelta(delta);
        }
        if (event?.done) finishReason = event.finishReason || finishReason;
      }
      output = assembled;
    } else {
      if (typeof adapter.infer !== 'function') throw new Error('Model adapter cannot infer without streaming callback');
      const result = await adapter.infer({ request, input, signal: abortController.signal });
      toolCalls = Array.isArray(result?.toolCalls) ? result.toolCalls.slice(0, 20) : [];
      output = result?.output ?? result?.text ?? null;
      finishReason = result?.finishReason || finishReason;
      usage = result?.usage && typeof result.usage === 'object' ? { inputTokens: Number(result.usage.inputTokens) || 0, outputTokens: Number(result.usage.outputTokens) || 0 } : {};
    }
    if (output != null && Buffer.byteLength(JSON.stringify(output), 'utf8') > maxChars * 4) {
      throw Object.assign(new Error('Model output exceeds response budget'), { code: 'MODEL_OUTPUT_LIMIT' });
    }
    if (request.responseMode === 'structured' && output != null) validateAgentOutput(output, request.outputSchema, { maxBytes: maxChars * 4 });
    const latencyMs = Math.max(0, Number(now) >= started ? Number(now) - started : Date.now() - started);
    return freeze({
      status: toolCalls.length ? 'tool_calls' : 'completed',
      output,
      toolCalls,
      finishReason,
      redacted: {
        provider: adapter.provider,
        adapterVersion: adapter.version,
        inputHash: sha(input),
        outputHash: output == null ? null : sha(output),
        rawPromptStored: false,
        rawOutputStored: false,
        transcriptStored: false,
        latencyMs,
        usage
      }
    });
  } catch (error) {
    const aborted = abortController.signal.aborted;
    const code = timedOut ? 'MODEL_TIMEOUT' : aborted ? 'MODEL_CANCELED' : error?.code || 'MODEL_FAILED';
    const status = code === 'MODEL_CANCELED' ? 'canceled' : 'failed';
    return freeze({
      status,
      output: null,
      toolCalls: [],
      redacted: { provider: adapter.provider, adapterVersion: adapter.version, inputHash: sha(input), rawPromptStored: false, rawOutputStored: false, transcriptStored: false, code }
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', forwardAbort);
  }
}
