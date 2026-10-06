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
  const model = modelPolicy.model == null ? null : boundedText(modelPolicy.model, 'model name', 160);
  const credentialRef = modelPolicy.credentialRef == null ? null : boundedText(modelPolicy.credentialRef, 'model credentialRef', 180);
  for (const [key,min,max] of [['maxInputTokens',256,32000],['maxOutputTokens',64,12000],['timeoutMs',1000,120000]]) {
    if (!Number.isSafeInteger(modelPolicy[key] ?? (key === 'maxInputTokens' ? 4000 : key === 'maxOutputTokens' ? 1200 : 30000)) || (modelPolicy[key] ?? (key === 'maxInputTokens' ? 4000 : key === 'maxOutputTokens' ? 1200 : 30000)) < min || (modelPolicy[key] ?? (key === 'maxInputTokens' ? 4000 : key === 'maxOutputTokens' ? 1200 : 30000)) > max) throw new TypeError(key + ' is outside policy bounds');
  }
  const normalizedPolicy = {
    provider,
    model,
    credentialRef,
    maxInputTokens:modelPolicy.maxInputTokens ?? 4000,
    maxOutputTokens:modelPolicy.maxOutputTokens ?? 1200,
    timeoutMs:modelPolicy.timeoutMs ?? 30000
  };
  const snapshot = { tenantId, agentId, releaseId, version, status, allowedTools:tools, modelPolicy:normalizedPolicy, systemPromptHash };
  return freeze({ ...snapshot, checksum:sha(snapshot) });
}

export function buildAgentJourneyContext({
  tenantId, journeyId, contactRef = null, leadRef = null, opportunityRef = null,
  appointmentRef = null, conversationRef = null, voiceSessionRef = null, workflowExecutionRef = null,
  ...extra
} = {}) {
  ref(tenantId, 'tenantId'); ref(journeyId, 'journeyId');
  rejectRawObject(extra, 'journeyContext');
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