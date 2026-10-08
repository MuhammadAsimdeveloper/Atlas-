import crypto from 'node:crypto';
import {
  authorizeAgentToolCall,
  consumeAgentBudget,
  verifyAgentSession,
  validateAgentOutput
} from '../atlas-target/index.mjs';
import {
  buildAgentJourneyContext,
  createHumanHandoff
} from './index.mjs';
import { createModelRequest, invokeModelTurn } from './model-runtime.mjs';
import { appendAgentTimelineEvent } from './execution-timeline.mjs';
import { detectPromptInjection, redactKnowledgeText, enforceKnowledgeCitations } from '../atlas-knowledge-fabric/index.mjs';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function ref(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$/.test(value)) throw new TypeError(label + ' must be a bounded reference');
  return value;
}
function hash(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError(label + ' must be SHA-256');
  return value;
}
function rejectSecrets(value, path = 'runtimeInput') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((v, i) => rejectSecrets(v, path + '[' + i + ']'));
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:secret|token|access_token|refresh_token|api_key|apikey|authorization|cookie|private_key|client_secret)$/i.test(key)) throw new TypeError(path + '.' + key + ' contains secret material');
    rejectSecrets(child, path + '.' + key);
  }
}
function releaseValid(release, tenantId) {
  if (!release || release.tenantId !== tenantId || typeof release.checksum !== 'string') return false;
  const { checksum, ...body } = release;
  const actual = crypto.createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
  return actual === checksum;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function sha(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

export async function runAgentTurn({
  tenantId, actorId, release, session, runtime = null, turnId, promptHash, runtimeInput,
  outputSchema = null, adapter, tools = {}, executeTool, approvalEvidenceByTool = {},
  workflowInvocation = null, handoff = null, knowledgeContext = null, onDelta = null, timeline = null, now = Date.now(), signal
} = {}) {
  ref(tenantId, 'tenantId'); ref(actorId, 'actorId'); ref(turnId, 'turnId'); hash(promptHash, 'promptHash');
  if (!releaseValid(release, tenantId)) throw new Error('Agent release is invalid or cross-tenant');
  if (!verifyAgentSession(session) || session.tenantId !== tenantId || session.agentId !== release.agentId || session.releaseId !== release.releaseId) {
    throw new Error('Agent session/release/tenant mismatch');
  }
  rejectSecrets(runtimeInput);
  if (!runtimeInput || typeof runtimeInput !== 'object' || Array.isArray(runtimeInput)) throw new TypeError('runtimeInput is required');
  if (typeof executeTool !== 'function') throw new TypeError('executeTool is required');
  const effectiveRuntime = runtime || {
    tenantId,
    agentId: release.agentId,
    releaseId: release.releaseId,
    allowedTools: release.allowedTools || [],
    maxTurns: 8,
    maxToolCalls: 20,
    maxExecutionMs: release.modelPolicy?.timeoutMs ? Math.max(1000, Math.min(120000, release.modelPolicy.timeoutMs * 8)) : 120000,
    maxResponseChars: 8000
  };
  if (effectiveRuntime.tenantId !== tenantId || effectiveRuntime.agentId !== release.agentId || effectiveRuntime.releaseId !== release.releaseId) throw new Error('Agent runtime/release mismatch');

  let safeKnowledge = [];
  let knowledgeAllowedRefs = [];
  let knowledgeRequiresCitations = false;
  if (knowledgeContext !== null) {
    if (!knowledgeContext || typeof knowledgeContext !== 'object' || Array.isArray(knowledgeContext)) throw new TypeError('knowledgeContext must be an object');
    if (knowledgeContext.tenantId !== undefined && knowledgeContext.tenantId !== tenantId) throw new Error('Agent knowledge context tenant mismatch');
    if (!Array.isArray(knowledgeContext.hits) || knowledgeContext.hits.length > 20) throw new TypeError('knowledgeContext hits must contain 0-20 items');
    knowledgeAllowedRefs = [...new Set((Array.isArray(knowledgeContext.allowedRefs) ? knowledgeContext.allowedRefs : knowledgeContext.hits.map(hit => hit?.ref)).filter(value => typeof value === 'string'))];
    knowledgeRequiresCitations = knowledgeContext.requireCitations === true;
    for (const hit of knowledgeContext.hits) {
      if (!hit || typeof hit !== 'object' || Array.isArray(hit)) throw new TypeError('knowledge context hit is invalid');
      ref(hit.ref, 'knowledge ref');
      if (hit.tenantId !== tenantId) throw new Error('Agent knowledge tenant mismatch');
      if (typeof hit.excerpt !== 'string' || hit.excerpt.length > 4000) throw new Error('Agent knowledge excerpt invalid');
      const injection = detectPromptInjection(hit.excerpt);
      if (injection.blocked) continue;
      safeKnowledge.push(Object.freeze({
        ref: hit.ref,
        score: Number(hit.score) || 0,
        excerpt: redactKnowledgeText(hit.excerpt),
        trust: 'untrusted_knowledge'
      }));
    }
  }

  const journey = runtimeInput.journeyContext || buildAgentJourneyContext({
    tenantId,
    journeyId: runtimeInput.journeyId || 'agent-journey-' + turnId,
    contactRef: runtimeInput.contactRef || null,
    leadRef: runtimeInput.leadRef || null,
    opportunityRef: runtimeInput.opportunityRef || null,
    appointmentRef: runtimeInput.appointmentRef || null,
    conversationRef: runtimeInput.conversationRef || null,
    voiceSessionRef: runtimeInput.voiceSessionRef || null,
    workflowExecutionRef: runtimeInput.workflowExecutionRef || null
  });

  let workingSession = session;
  let history = Array.isArray(runtimeInput.history) ? runtimeInput.history.slice(-20) : [];
  let toolCallsUsed = 0;
  const approvalRefs = [];
  const executionEvents = [];

  for (let turn = 0; turn < effectiveRuntime.maxTurns; turn += 1) {
    const budget = consumeAgentBudget({ session: workingSession, runtime: effectiveRuntime, kind: 'turn', now });
    if (!budget.ok) {
      return freeze({
        status: 'failed',
        output: null,
        redacted: { tenantId, sessionId: session.id, releaseId: release.releaseId, turnId, rawPromptStored:false, transcriptStored:false, toolCalls:toolCallsUsed, reason:budget.reason, journeyContextHash:journey.contextHash }
      });
    }
    workingSession = budget.session;

    if (timeline) timeline = appendAgentTimelineEvent(timeline, { type:'model.started', turnId:turn === 0 ? turnId : turnId + ':' + turn, now });
    const request = createModelRequest({
      tenantId,
      agentRelease: release,
      sessionId: session.id,
      turnId: turn === 0 ? turnId : turnId + ':' + turn,
      promptHash,
      inputRef: journey.conversationRef || journey.journeyId,
      responseMode: outputSchema ? 'structured' : 'text',
      outputSchema,
      now
    });

    const modelResult = await invokeModelTurn({
      request,
      adapter,
      input: {
        prompt: runtimeInput.prompt,
        history,
        toolResults: history.filter(item => item?.kind === 'tool_result').slice(-10),
        knowledge: safeKnowledge
      },
      signal,
      onDelta,
      now
    });

    if (timeline) timeline = appendAgentTimelineEvent(timeline, { type:modelResult.status === 'canceled' ? 'turn.failed' : 'model.completed', turnId:turn === 0 ? turnId : turnId + ':' + turn, status:modelResult.status === 'canceled' ? 'canceled' : 'failed', reason:modelResult.redacted?.code || null, inputTokens:modelResult.redacted?.usage?.inputTokens || 0, outputTokens:modelResult.redacted?.usage?.outputTokens || 0, now });
    if (modelResult.status === 'failed' || modelResult.status === 'canceled') {
      return freeze({ status:modelResult.status, output:null, redacted:{...modelResult.redacted, tenantId, sessionId:session.id, releaseId:release.releaseId, turnId, rawPromptStored:false, transcriptStored:false, toolCalls:toolCallsUsed, journeyContextHash:journey.contextHash} });
    }

    if (modelResult.status === 'completed') {
      if (timeline) timeline = appendAgentTimelineEvent(timeline, { type:'model.completed', turnId:turn === 0 ? turnId : turnId + ':' + turn, status:'ok', inputTokens:modelResult.redacted?.usage?.inputTokens || 0, outputTokens:modelResult.redacted?.usage?.outputTokens || 0, now });
      if (outputSchema) validateAgentOutput(modelResult.output, outputSchema);
      if (knowledgeRequiresCitations && safeKnowledge.length > 0) {
        const citations = Array.isArray(modelResult.output?.groundingRefs) ? modelResult.output.groundingRefs : [];
        try {
          enforceKnowledgeCitations({answerUsesKnowledge:true,citations,allowedRefs:knowledgeAllowedRefs.length ? knowledgeAllowedRefs : safeKnowledge.map(hit => hit.ref),requireCitations:true});
        } catch (error) {
          return freeze({status:'failed',output:null,redacted:{tenantId,sessionId:session.id,releaseId:release.releaseId,turnId,rawPromptStored:false,transcriptStored:false,rawOutputStored:false,toolCalls:toolCallsUsed,reason:error?.code==='knowledge_citation_required'?'KNOWLEDGE_CITATION_REQUIRED':'KNOWLEDGE_CITATION_INVALID',journeyContextHash:journey.contextHash}});
        }
      }
      if (timeline) timeline = appendAgentTimelineEvent(timeline, { type:'turn.completed', turnId, status:'ok', now });
      return freeze({
        status:'completed',
        output:modelResult.output,
        session:workingSession,
        timeline,
        redacted:{
          tenantId, sessionId:session.id, agentId:release.agentId, releaseId:release.releaseId, turnId,
          rawPromptStored:false, transcriptStored:false, rawOutputStored:false,
          toolCalls:toolCallsUsed, turns:turn + 1, finishReason:modelResult.finishReason || 'stop',
          model:modelResult.redacted, journeyContextHash:journey.contextHash
        }
      });
    }

    const proposedCalls = Array.isArray(modelResult.toolCalls) ? modelResult.toolCalls : [];
    if (!proposedCalls.length) return freeze({ status:'failed', output:null, redacted:{tenantId,sessionId:session.id,releaseId:release.releaseId,turnId,rawPromptStored:false,transcriptStored:false,toolCalls:toolCallsUsed,reason:'MODEL_RETURNED_NO_OUTPUT'} });

    for (let index = 0; index < Math.min(proposedCalls.length, 12); index += 1) {
      const proposal = proposedCalls[index];
      if (!proposal || typeof proposal !== 'object' || typeof proposal.name !== 'string') {
        return freeze({ status:'failed', output:null, redacted:{tenantId,sessionId:session.id,releaseId:release.releaseId,turnId,rawPromptStored:false,transcriptStored:false,toolCalls:toolCallsUsed,reason:'TOOL_CALL_INVALID'} });
      }
      const tool = tools[proposal.name];
      if (!tool) return freeze({ status:'failed', output:null, redacted:{tenantId,sessionId:session.id,releaseId:release.releaseId,turnId,rawPromptStored:false,transcriptStored:false,toolCalls:toolCallsUsed,reason:'TOOL_NOT_REGISTERED',toolName:proposal.name} });
      const budgetTool = consumeAgentBudget({ session:workingSession, runtime:effectiveRuntime, kind:'tool', now });
      if (!budgetTool.ok) return freeze({ status:'failed', output:null, redacted:{tenantId,sessionId:session.id,releaseId:release.releaseId,turnId,rawPromptStored:false,transcriptStored:false,toolCalls:toolCallsUsed,reason:budgetTool.reason} });
      workingSession = budgetTool.session;
      const args = proposal.arguments && typeof proposal.arguments === 'object' ? proposal.arguments : {};
      const approvalEvidence = approvalEvidenceByTool[proposal.name] || null;
      if (timeline) timeline = appendAgentTimelineEvent(timeline, { type:'tool.proposed', turnId:turn === 0 ? turnId : turnId + ':' + turn, nodeRef:tool.name, status:'ok', now });
      const authorization = authorizeAgentToolCall({
        runtime:effectiveRuntime,
        tool,
        tenantId,
        actorId,
        argumentsValue:args,
        approvalEvidence,
        now
      });
      toolCallsUsed += 1;
      if (!authorization.allowed) {
        executionEvents.push({status:'needs_approval',toolName:tool.name,code:authorization.code});
        if (authorization.code === 'APPROVAL_REQUIRED') {
          if (timeline) timeline = appendAgentTimelineEvent(timeline, { type:'approval.required', turnId:turn === 0 ? turnId : turnId + ':' + turn, nodeRef:tool.name, status:'waiting', refHash:authorization.argumentsHash, now });
          approvalRefs.push(authorization.idempotencyKey);
          return freeze({
            status:'needs_approval',
            output:null,
            redacted:{
              tenantId,sessionId:session.id,releaseId:release.releaseId,turnId,
              rawPromptStored:false,transcriptStored:false,toolCalls:toolCallsUsed,
              reason:'TOOL_APPROVAL_REQUIRED', approvalRefs,
              pendingTool:{name:tool.name,argumentsHash:authorization.argumentsHash,idempotencyKey:authorization.idempotencyKey},
              journeyContextHash:journey.contextHash
            }
          });
        }
        return freeze({ status:'failed', output:null, redacted:{tenantId,sessionId:session.id,releaseId:release.releaseId,turnId,rawPromptStored:false,transcriptStored:false,toolCalls:toolCallsUsed,reason:authorization.code} });
      }
      const result = await executeTool(tool, args, { tenantId, actorId, session:workingSession, signal, idempotencyKey:authorization.idempotencyKey });
      if (timeline) timeline = appendAgentTimelineEvent(timeline, { type:'tool.completed', turnId:turn === 0 ? turnId : turnId + ':' + turn, nodeRef:tool.name, status:'ok', refHash:authorization.argumentsHash, now });
      history.push({kind:'tool_result',toolName:tool.name,result});
      if (history.length > 40) history = history.slice(-40);
      executionEvents.push({status:'completed',toolName:tool.name});
    }

    if (handoff) {
      const handoffRecord = createHumanHandoff({ tenantId, sessionId:session.id, ...handoff, now });
      if (timeline) timeline = appendAgentTimelineEvent(timeline, { type:'handoff.requested', turnId, status:'waiting', now });
      return freeze({ status:'handoff', output:null, handoff:handoffRecord, timeline, redacted:{tenantId,sessionId:session.id,releaseId:release.releaseId,turnId,rawPromptStored:false,transcriptStored:false,toolCalls:toolCallsUsed,reason:'HUMAN_HANDOFF',journeyContextHash:journey.contextHash} });
    }

    if (workflowInvocation?.authorize) {
      const allowed = workflowInvocation.authorize({ actorId, tenantId });
      if (allowed?.allowed === false) return freeze({status:'failed',output:null,redacted:{tenantId,sessionId:session.id,releaseId:release.releaseId,turnId,rawPromptStored:false,transcriptStored:false,toolCalls:toolCallsUsed,reason:allowed.code||'WORKFLOW_INVOCATION_DENIED',journeyContextHash:journey.contextHash}});
      if (typeof workflowInvocation.execute === 'function') await workflowInvocation.execute(allowed);
    }
  }

  return freeze({ status:'failed', output:null, redacted:{tenantId,sessionId:session.id,releaseId:release.releaseId,turnId,rawPromptStored:false,transcriptStored:false,toolCalls:toolCallsUsed,reason:'TURN_BUDGET_EXHAUSTED',journeyContextHash:journey.contextHash} });
}
