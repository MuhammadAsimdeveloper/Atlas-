      result[text(key,'argument key',100)] = boundedJson(child, depth + 1, seen);
    }
  }
  seen.delete(value);
  return result;
}

export function authorizeAgentToolCall({ runtime, tool, tenantId, actorId, argumentsValue = {}, approvalEvidence = null, now = Date.now() } = {}) {
  if (!runtime || runtime.tenantId !== tenantId || !verifyAgentTool(tool) || !runtime.allowedTools.includes(tool.name)) return { allowed:false, code:'TOOL_NOT_ALLOWED' };
  boundedJson(argumentsValue);
  const argumentsHash = sha(argumentsValue);
  const idempotencyKey = sha({ tenantId, agentId:runtime.agentId, releaseId:runtime.releaseId, actorId, toolName:tool.name, argumentsHash });
  const approvedAt = Date.parse(approvalEvidence?.approvedAt), expiresAt = Date.parse(approvalEvidence?.expiresAt);
  const approved = approvalEvidence?.status === 'approved' && approvalEvidence.tenantId === tenantId && approvalEvidence.agentId === runtime.agentId && approvalEvidence.releaseId === runtime.releaseId && approvalEvidence.actorId === actorId && approvalEvidence.toolName === tool.name && approvalEvidence.argumentsHash === argumentsHash && approvalEvidence.idempotencyKey === idempotencyKey && Number.isFinite(approvedAt) && Number.isFinite(expiresAt) && approvedAt <= now + 60000 && expiresAt > now && expiresAt - approvedAt <= 900000;
  if (tool.requiresApproval && !approved) return { allowed:false, code:'APPROVAL_REQUIRED', argumentsHash, idempotencyKey };
  return { allowed:true, code:'ALLOWED', argumentsHash, idempotencyKey };
}

export function createAgentSession({ runtime, tenantId, conversationId, actorId, sessionId = null, now = Date.now(), leaseMs = 30000 } = {}) {
  if (!runtime || runtime.tenantId !== tenantId) throw new Error('Agent runtime tenant mismatch');
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) throw new Error('Agent lease out of bounds');
  const id = sessionId == null ? 'session_' + crypto.randomUUID().replaceAll('-','') : reference(sessionId,'sessionId');
  const body = { id, tenantId, agentId:runtime.agentId, releaseId:runtime.releaseId, conversationId:reference(conversationId,'conversationId'), actorId:reference(actorId,'actorId'), status:'active', turns:0, toolCalls:0, startedAt:new Date(now).toISOString(), leaseUntil:new Date(now + leaseMs).toISOString(), leaseMs, version:1 };
  return freeze({ ...body, checksum:sha(body) });
}

export function verifyAgentSession(session) {