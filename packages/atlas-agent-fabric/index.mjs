import crypto from 'node:crypto';
import {
  verifyAgentSession,
  createAgentRuntimePolicy,
  authorizeAgentToolCall
} from '../atlas-target/index.mjs';

const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;
const HASH = /^[a-f0-9]{64}$/;
const SAFE_REASON = /^[a-z][a-z0-9_.-]{2,79}$/;
const RAW_KEYS = new Set(['prompt','message','body','content','transcript','recording','rawPrompt','rawMessage','customerData','customerPayload']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function ref(value, label) {
  if (typeof value !== 'string' || !REF.test(value)) throw new TypeError(label + ' must be a bounded reference');
  return value;
}
function hashRef(value, label) {
  if (typeof value !== 'string' || !HASH.test(value)) throw new TypeError(label + ' must be SHA-256');
  return value;
}
function boundedText(value, label, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n\u0000]/.test(value)) throw new TypeError(label + ' must be bounded text');
  return value.trim();
}
function timestamp(value, label) {
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(label + ' must be a valid timestamp');
  return parsed;
}
function rejectRawObject(value, path = 'input') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (RAW_KEYS.has(key)) throw new TypeError(path + ' cannot contain raw customer or prompt content');
    if (key.toLowerCase().includes('secret') || key.toLowerCase().includes('token')) throw new TypeError(path + ' cannot contain secret material');
    rejectRawObject(child, path + '.' + key);
  }
}
function verifyManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || !HASH.test(manifest.checksum || '')) return false;
  const { checksum, ...snapshot } = manifest;
  return sha(snapshot) === checksum;
}

export function createAgentReleaseManifest({
  tenantId, agentId, releaseId, version, status = 'draft', allowedTools = [], modelPolicy = {}, systemPromptHash
} = {}) {
  ref(tenantId, 'tenantId'); ref(agentId, 'agentId'); ref(releaseId, 'releaseId');
  if (!Number.isSafeInteger(version) || version < 1 || version > 100000) throw new TypeError('version must be 1-100000');
  if (!['draft','canary','active','paused','archived'].includes(status)) throw new TypeError('agent release status is invalid');
  if (!Array.isArray(allowedTools) || allowedTools.length > 100) throw new TypeError('allowedTools must contain 0-100 tools');
  const tools = [...new Set(allowedTools.map(tool => boundedText(tool, 'allowed tool', 160)))].sort();
  hashRef(systemPromptHash, 'systemPromptHash');
  rejectRawObject(modelPolicy, 'modelPolicy');
  if (!modelPolicy || typeof modelPolicy !== 'object' || Array.isArray(modelPolicy)) throw new TypeError('modelPolicy must be an object');
  const provider = modelPolicy.provider == null ? 'model_adapter' : boundedText(modelPolicy.provider, 'model provider', 80);
  for (const [key,min,max] of [['maxInputTokens',256,32000],['maxOutputTokens',64,12000],['timeoutMs',1000,120000]]) {
    if (!Number.isSafeInteger(modelPolicy[key] ?? (key === 'maxInputTokens' ? 4000 : key === 'maxOutputTokens' ? 1200 : 30000)) || (modelPolicy[key] ?? (key === 'maxInputTokens' ? 4000 : key === 'maxOutputTokens' ? 1200 : 30000)) < min || (modelPolicy[key] ?? (key === 'maxInputTokens' ? 4000 : key === 'maxOutputTokens' ? 1200 : 30000)) > max) throw new TypeError(key + ' is outside policy bounds');
  }
  const normalizedPolicy = {
    provider,
    maxInputTokens:modelPolicy.maxInputTokens ?? 4000,
    maxOutputTokens:modelPolicy.maxOutputTokens ?? 1200,
    timeoutMs:modelPolicy.timeoutMs ?? 30000
  };
  const snapshot = { tenantId, agentId, releaseId, version, status, allowedTools:tools, modelPolicy:normalizedPolicy, systemPromptHash };
  return freeze({ ...snapshot, checksum:sha(snapshot) });
}

export function buildAgentJourneyContext({
  tenantId, journeyId, contactRef = null, leadRef = null, opportunityRef = null,
  appointmentRef = null, conversationRef = null, voiceSessionRef = null, workflowExecutionRef = null
} = {}) {
  ref(tenantId, 'tenantId'); ref(journeyId, 'journeyId');
  for (const [key,value] of Object.entries({contactRef,leadRef,opportunityRef,appointmentRef,conversationRef,voiceSessionRef,workflowExecutionRef})) {
    if (value != null) ref(value, key);
  }
  return freeze({
    tenantId, journeyId,
    contactRef, leadRef, opportunityRef, appointmentRef, conversationRef, voiceSessionRef, workflowExecutionRef,
    redacted:true, payloadMode:'reference_only', contextHash:sha({tenantId,journeyId,contactRef,leadRef,opportunityRef,appointmentRef,conversationRef,voiceSessionRef,workflowExecutionRef})
  });
}

export function planAgentTurn({
  tenantId, sessionId, agentRelease, turnId, promptHash, toolCalls = [], approvalRefs = [],
  workflowInvocationRef = null, journeyContext, now = Date.now()
} = {}) {
  ref(tenantId, 'tenantId'); ref(sessionId, 'sessionId'); ref(turnId, 'turnId');
  if (!verifyManifest(agentRelease) || agentRelease.tenantId !== tenantId) throw new Error('Agent release manifest is invalid or cross-tenant');
  hashRef(promptHash, 'promptHash');
  if (arguments && Object.hasOwn(arguments, 'prompt')) throw new TypeError('Raw prompts cannot enter agent turn planning');
  rejectRawObject(journeyContext);
  if (!journeyContext || journeyContext.tenantId !== tenantId || journeyContext.redacted !== true || journeyContext.payloadMode !== 'reference_only') throw new Error('Journey context is not a redacted tenant-bound context');
  ref(journeyContext.journeyId, 'journeyId');
  if (journeyContext.contextHash !== sha({tenantId:journeyContext.tenantId,journeyId:journeyContext.journeyId,contactRef:journeyContext.contactRef,leadRef:journeyContext.leadRef,opportunityRef:journeyContext.opportunityRef,appointmentRef:journeyContext.appointmentRef,conversationRef:journeyContext.conversationRef,voiceSessionRef:journeyContext.voiceSessionRef,workflowExecutionRef:journeyContext.workflowExecutionRef})) throw new Error('Journey context checksum is invalid');
  if (!Array.isArray(toolCalls) || toolCalls.length > 12) throw new Error('toolCalls must contain 0-12 planned tools');
  if (!Array.isArray(approvalRefs) || approvalRefs.length > 12) throw new Error('approvalRefs must contain 0-12 refs');
  const normalizedTools = toolCalls.map((tool,index) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new TypeError('toolCalls[' + index + '] invalid');
    const toolName = boundedText(tool.toolName, 'toolName', 160);
    const risk = boundedText(tool.risk || 'read', 'tool risk', 24);
    if (!['read','network','write','financial','destructive'].includes(risk)) throw new TypeError('tool risk invalid');
    hashRef(tool.argumentsHash, 'argumentsHash');
    return { toolName, risk, argumentsHash:tool.argumentsHash };
  });
  const approvals = approvalRefs.map((entry,index) => ref(entry, 'approvalRef ' + index));
  if (workflowInvocationRef != null) ref(workflowInvocationRef, 'workflowInvocationRef');
  const current = timestamp(now,'now');
  const snapshot = {
    tenantId, sessionId, turnId, releaseId:agentRelease.releaseId, releaseVersion:agentRelease.version,
    promptHash, toolCalls:normalizedTools, approvalRefs:approvals, workflowInvocationRef,
    journeyContext, rawPromptStored:false, plannedAt:new Date(current).toISOString()
  };
  return freeze({ ...snapshot, idempotencyKey:sha(snapshot) });
}

export function authorizeAgentWorkflowInvocation({
  tenantId, agentRelease, workflowId, workflowVersion, actorId, approvalRef = null, risk = 'read'
} = {}) {
  if (!verifyManifest(agentRelease) || agentRelease.tenantId !== tenantId) return freeze({allowed:false,code:'RELEASE_SCOPE_INVALID'});
  try { ref(workflowId,'workflowId'); ref(actorId,'actorId'); } catch { return freeze({allowed:false,code:'REFERENCE_INVALID'}); }
  if (!Number.isSafeInteger(workflowVersion) || workflowVersion < 1 || workflowVersion > 100000) return freeze({allowed:false,code:'WORKFLOW_VERSION_INVALID'});
  if (!['read','network','write','financial','destructive'].includes(risk)) return freeze({allowed:false,code:'RISK_INVALID'});
  if (risk === 'read') return freeze({allowed:true,code:'ALLOWED',releaseId:agentRelease.releaseId,workflowId,workflowVersion});
  if (typeof approvalRef !== 'string' || approvalRef.length < 8 || approvalRef.length > 180) return freeze({allowed:false,code:'APPROVAL_REQUIRED'});
  return freeze({
    allowed:true, code:'ALLOWED_WITH_APPROVAL', releaseId:agentRelease.releaseId, workflowId, workflowVersion,
    approvalRef:boundedText(approvalRef,'approvalRef')
  });
}

export function createHumanHandoff({tenantId,sessionId,reason,queueRef,appointmentRef=null,now=Date.now()}={}) {
  ref(tenantId,'tenantId'); ref(sessionId,'sessionId'); ref(queueRef,'queueRef');
  if (typeof reason !== 'string' || !SAFE_REASON.test(reason)) throw new TypeError('reason must be a bounded reason code');
  if (appointmentRef != null) ref(appointmentRef,'appointmentRef');
  const current=timestamp(now,'now');
  const body={tenantId,sessionId,reason,queueRef,appointmentRef,status:'pending',requestedAt:new Date(current).toISOString()};
  return freeze({handoffId:'handoff_'+sha(body).slice(0,24),...body,redacted:true});
}

export function summarizeAgentRun({tenantId,sessionId,agentRelease,turns=0,toolCalls=0,status,outcome=null,failureReason=null,handoffReason=null,journeyContext}={}) {
  ref(tenantId,'tenantId'); ref(sessionId,'sessionId');
  if (!verifyManifest(agentRelease) || agentRelease.tenantId !== tenantId) throw new Error('Agent release is invalid');
  if (!Number.isSafeInteger(turns) || turns < 0 || turns > 100) throw new TypeError('turns out of bounds');
  if (!Number.isSafeInteger(toolCalls) || toolCalls < 0 || toolCalls > 500) throw new TypeError('toolCalls out of bounds');
  if (!['active','completed','failed','handoff','needs_approval'].includes(status)) throw new TypeError('agent run status invalid');
  if (outcome != null) outcome=boundedText(outcome,'outcome',80);
  if (failureReason != null) failureReason=boundedText(failureReason,'failureReason',80);
  if (handoffReason != null) handoffReason=boundedText(handoffReason,'handoffReason',80);
  rejectRawObject(journeyContext);
  const summary={
    tenantId,sessionId,agentId:agentRelease.agentId,releaseId:agentRelease.releaseId,turns,toolCalls,status,
    outcome,failureReason,handoffReason,appointmentRef:journeyContext?.appointmentRef||null,voiceSessionRef:journeyContext?.voiceSessionRef||null,
    redacted:true
  };
  return freeze(summary);
}
