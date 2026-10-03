import crypto from 'node:crypto';
import { selectCustomerAgent } from './index.mjs';

export const VOICE_CALL_STATES = Object.freeze([
  'scheduled', 'queued', 'agent_active', 'human_handoff_pending', 'human_active',
  'completed', 'failed', 'abandoned', 'needs_review'
]);
export const VOICE_CALL_OUTCOMES = Object.freeze([
  'resolved', 'appointment_booked', 'qualified', 'follow_up_required', 'transferred', 'voicemail', 'spam', 'other'
]);
export const VOICE_CALL_REASONS = Object.freeze([
  'caller_requested_human', 'billing_help', 'appointment_help', 'sensitive_request',
  'low_confidence', 'tool_failure', 'language_mismatch', 'urgent_safety', 'other'
]);

const TERMINAL_STATES = new Set(['completed', 'failed', 'abandoned', 'needs_review']);
const INTERNAL_SOURCE_TYPES = new Set(['agent_runtime', 'authenticated_human', 'workflow_runtime', 'system_runtime']);
const PII_REF = /@|\+?\d[\d(). -]{6,}\d/;
const MAX_SESSION_EVENTS = 256;
const MAX_AGENT_TRANSFERS = 3;
const MAX_CALL_DELAY_MS = 30 * 86400000;

function boundedText(value, label, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\r\n\u0000]/.test(value)) throw new Error(`${label} must be bounded text`);
  return value.trim();
}

function opaqueRef(value, label) {
  const ref = boundedText(value, label);
  if (PII_REF.test(ref)) throw new Error(`${label} must be an opaque reference, not customer content`);
  return ref;
}

function generatedOpaqueId(prefix) {
  const entropy = crypto.randomUUID().replaceAll('-', '').match(/.{1,4}/g).join('x');
  return `${prefix}_${entropy}`;
}

function providerOpaqueRef(value, label) {
  const ref = boundedText(value, label);
  if (!/^[A-Za-z][A-Za-z0-9._:/-]{5,179}$/.test(ref) || /@/.test(ref)) throw new Error(`${label} must be a provider-generated opaque identifier`);
  return ref;
}

function timestamp(value, label) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time) || !Number.isFinite(new Date(time).getTime())) throw new Error(`${label} must be a valid timestamp`);
  return time;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sealSession(session) {
  const snapshot = { ...session };
  delete snapshot.checksum;
  return deepFreeze({ ...snapshot, checksum: digest(snapshot) });
}

export function verifyVoiceCallSession(session) {
  if (!session || typeof session !== 'object' || !/^[a-f0-9]{64}$/.test(String(session.checksum || ''))) return false;
  const { checksum, ...snapshot } = session;
  return digest(snapshot) === checksum;
}

function assertVoiceAgentRelease(release, tenantId) {
  if (!release || release.tenantId !== tenantId || !['canary', 'active'].includes(release.status) || !Array.isArray(release.routes) || !Number.isSafeInteger(release.version) || release.version < 1) throw new Error('Voice agent release must be published and belong to this tenant');
  const { checksum, ...snapshot } = release;
  if (!/^[a-f0-9]{64}$/.test(String(checksum || '')) || digest(snapshot) !== checksum) throw new Error('Voice agent release checksum is invalid');
  if (!release.routes.some(route => route?.channel === 'voice' && Number.isSafeInteger(route.coveragePercent) && route.coveragePercent > 0)) throw new Error('Voice agent release has no enabled voice route');
  return deepFreeze({ deploymentId: opaqueRef(release.id, 'voice deployment id'), agentId: opaqueRef(release.agentId, 'voice agent id'), releaseId: opaqueRef(release.releaseId, 'voice release id'), version: release.version, checksum });
}

function resolveVoiceRoute({ tenantId, conversationRef, agentRelease, contactTags = [], assignedAgentId = null, now }) {
  const contact = { tenantId, tags: contactTags, ...(assignedAgentId == null ? {} : { assignedAgentId }) };
  const result = selectCustomerAgent({ tenantId, conversationId: conversationRef, channel: 'voice', contact, deployments: [agentRelease], now });
  if (result.route !== 'agent' || result.releaseId !== agentRelease.releaseId || result.deploymentId !== agentRelease.id) return { accepted: false, reason: result.reason || 'voice_route_unavailable', decision: result };
  return {
    accepted: true,
    reason: null,
    decision: {
      tenantId, conversationRef, deploymentId: result.deploymentId, releaseId: result.releaseId,
      agentId: result.agentId, routeId: result.routeId, rolloutBucket: result.rolloutBucket,
      decisionId: digest({ tenantId, conversationRef, deploymentId: result.deploymentId, releaseId: result.releaseId, routeId: result.routeId, rolloutBucket: result.rolloutBucket }),
      decidedAt: new Date(now).toISOString()
    }
  };
}

function freshSnapshot(snapshot, now, maxAgeMs = 15 * 60_000) {
  const checkedAt = Date.parse(snapshot?.checkedAt);
  return Number.isFinite(checkedAt) && checkedAt <= now + 60_000 && checkedAt >= now - maxAgeMs;
}

function timeMinutes(value, label) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${label} must use HH:MM`);
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

export function normalizeVoiceCallWindow(window) {
  if (!window || typeof window !== 'object' || Array.isArray(window)) throw new Error('A tenant-configured voice call window is required');
  const timeZone = boundedText(window.timeZone, 'call window timeZone', 100);
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(0); } catch { throw new Error('call window timeZone must be a valid IANA timezone'); }
  if (!Array.isArray(window.windows) || !window.windows.length || window.windows.length > 70) throw new Error('call window windows must contain 1-70 entries');
  const windows = window.windows.map(item => {
    if (!item || !Array.isArray(item.days) || !item.days.length || item.days.some(day => !Number.isSafeInteger(day) || day < 0 || day > 6)) throw new Error('call window days must use local weekdays 0-6');
    const startMinute = timeMinutes(item.start, 'call window start');
    const endMinute = timeMinutes(item.end, 'call window end');
    if (startMinute === endMinute) throw new Error('call window start and end cannot be equal');
    return { days: [...new Set(item.days)].sort(), startMinute, endMinute };
  });
  return deepFreeze({ timeZone, windows });
}

function localPartsFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function localMinuteParts(epochMs, formatter) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epochMs)).map(part => [part.type, part.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

function isWithinVoiceWindow(epochMs, normalized, formatter) {
  const { day, minute } = localMinuteParts(epochMs, formatter);
  return normalized.windows.some(window => {
    if (window.startMinute < window.endMinute) return window.days.includes(day) && minute >= window.startMinute && minute < window.endMinute;
    const previousDay = (day + 6) % 7;
    return (window.days.includes(day) && minute >= window.startMinute) || (window.days.includes(previousDay) && minute < window.endMinute);
  });
}

export function nextPermittedVoiceCallAt(at, window, { maxDays = 14 } = {}) {
  const startAt = timestamp(at, 'call time');
  if (!Number.isSafeInteger(maxDays) || maxDays < 1 || maxDays > 31) throw new Error('maxDays must be from 1 to 31');
  const normalized = normalizeVoiceCallWindow(window);
  const formatter = localPartsFormatter(normalized.timeZone);
  if (isWithinVoiceWindow(startAt, normalized, formatter)) return startAt;
  const firstMinute = Math.ceil(startAt / 60_000) * 60_000;
  for (let offset = 0; offset <= maxDays * 24 * 60; offset++) {
    const candidate = firstMinute + offset * 60_000;
    if (isWithinVoiceWindow(candidate, normalized, formatter)) return candidate;
  }
  return null;
}

function policyDenial(reason) {
  return { allowed: false, reason, nextAttemptAt: null };
}

export function authorizeOutboundVoiceCall({
  tenantId, contactRef, providerConnectionRef, purpose, policyDecision, consentSnapshot,
  suppressionSnapshot, frequencySnapshot, providerTerms, capacityReservation, approvalEvidence = null, now = Date.now(), requestedAt = now
} = {}) {
  const tenant = opaqueRef(tenantId, 'tenantId');
  const contact = opaqueRef(contactRef, 'contactRef');
  const connection = opaqueRef(providerConnectionRef, 'providerConnectionRef');
  const use = boundedText(purpose, 'call purpose', 32).toLowerCase();
  if (!['service', 'transactional', 'marketing', 'support', 'appointment', 'billing'].includes(use)) return policyDenial('call_purpose_unsupported');
  const current = timestamp(now, 'now');
  const requested = timestamp(requestedAt, 'requestedAt');
  if (requested < current - 60_000 || requested - current > MAX_CALL_DELAY_MS) return policyDenial('requested_call_time_out_of_range');
  if (!policyDecision || policyDecision.tenantId !== tenant || policyDecision.contactId !== contact || policyDecision.channel !== 'voice' || policyDecision.purpose !== use) return policyDenial('call_policy_scope_invalid');
  const policyExpiry = Date.parse(policyDecision.expiresAt);
  if (policyDecision.eligible !== true || !policyDecision.decisionId || !policyDecision.policyVersion || !freshSnapshot(policyDecision, current) || !Number.isFinite(policyExpiry) || policyExpiry <= current) return policyDenial('call_policy_denied_or_stale');
  try { opaqueRef(policyDecision.decisionId, 'policy decisionId'); opaqueRef(policyDecision.policyVersion, 'policy policyVersion'); } catch { return policyDenial('call_policy_denied_or_stale'); }
  const consentExpires = Date.parse(consentSnapshot?.expiresAt);
  if (!consentSnapshot || consentSnapshot.tenantId !== tenant || consentSnapshot.contactId !== contact || consentSnapshot.channel !== 'voice' || consentSnapshot.purpose !== use || consentSnapshot.eligible !== true || consentSnapshot.basis !== 'explicit_consent' || !consentSnapshot.revision || !freshSnapshot(consentSnapshot, current) || !Number.isFinite(consentExpires) || consentExpires <= current) return policyDenial('explicit_voice_consent_required');
  if (!suppressionSnapshot || suppressionSnapshot.tenantId !== tenant || suppressionSnapshot.contactId !== contact || suppressionSnapshot.channel !== 'voice' || typeof suppressionSnapshot.blocked !== 'boolean' || !suppressionSnapshot.revision || !freshSnapshot(suppressionSnapshot, current)) return policyDenial('do_not_call_check_unavailable_or_stale');
  if (suppressionSnapshot.blocked) return policyDenial('contact_on_do_not_call_list');
  if (!frequencySnapshot || frequencySnapshot.tenantId !== tenant || frequencySnapshot.contactId !== contact || frequencySnapshot.channel !== 'voice' || frequencySnapshot.allowed !== true || !frequencySnapshot.windowId || !Number.isSafeInteger(frequencySnapshot.count) || !Number.isSafeInteger(frequencySnapshot.limit) || frequencySnapshot.count < 0 || frequencySnapshot.limit < 1 || frequencySnapshot.count >= frequencySnapshot.limit || !freshSnapshot(frequencySnapshot, current)) return policyDenial(frequencySnapshot?.allowed === false ? 'contact_call_frequency_limit' : 'contact_call_frequency_check_unavailable');
  if (!providerTerms || providerTerms.tenantId !== tenant || providerTerms.providerConnectionRef !== connection || providerTerms.accepted !== true || !providerTerms.termsVersion || providerTerms.termsVersion !== policyDecision.requiredTermsVersion || !providerTerms.agreementRef || !Number.isFinite(Date.parse(providerTerms.acceptedAt)) || Date.parse(providerTerms.acceptedAt) > current + 60_000) return policyDenial('provider_outbound_terms_not_accepted');
  const capacityExpires = Date.parse(capacityReservation?.expiresAt);
  if (!capacityReservation || capacityReservation.tenantId !== tenant || capacityReservation.providerConnectionRef !== connection || capacityReservation.status !== 'reserved' || !capacityReservation.reservationRef || !capacityReservation.bucketRef || !freshSnapshot(capacityReservation, current, 30_000) || !Number.isFinite(capacityExpires) || capacityExpires <= current) return policyDenial('provider_capacity_not_reserved');
  try {
    opaqueRef(consentSnapshot.revision, 'consent revision');
    opaqueRef(suppressionSnapshot.revision, 'suppression revision');
    opaqueRef(frequencySnapshot.windowId, 'frequency windowId');
    opaqueRef(providerTerms.termsVersion, 'provider termsVersion');
    opaqueRef(providerTerms.agreementRef, 'provider agreementRef');
    opaqueRef(capacityReservation.reservationRef, 'capacity reservationRef');
    opaqueRef(capacityReservation.bucketRef, 'capacity bucketRef');
  } catch { return policyDenial('outbound_evidence_reference_invalid'); }

  let next;
  try { next = nextPermittedVoiceCallAt(requested, policyDecision.callWindow); } catch { return policyDenial('call_window_invalid'); }
  if (next == null) return policyDenial('no_permitted_call_window');
  if (policyExpiry <= next || consentExpires <= next || capacityExpires <= next) return policyDenial('authorization_expires_before_call_window');
  let approvalRef = null;
  if (policyDecision.approvalRequired === true) {
    const approvedAt = Date.parse(approvalEvidence?.approvedAt), approvalExpires = Date.parse(approvalEvidence?.expiresAt);
    if (!approvalEvidence || approvalEvidence.status !== 'approved' || approvalEvidence.tenantId !== tenant || approvalEvidence.contactId !== contact || approvalEvidence.channel !== 'voice' || approvalEvidence.policyDecisionId !== policyDecision.decisionId || !Number.isFinite(approvedAt) || approvedAt > current + 60_000 || !Number.isFinite(approvalExpires) || approvalExpires <= next || !approvalEvidence.evidenceRef) return policyDenial('outbound_voice_approval_required');
    try { approvalRef = opaqueRef(approvalEvidence.evidenceRef, 'approval evidenceRef'); } catch { return policyDenial('outbound_voice_approval_required'); }
  }
  return { allowed: true, reason: next > current ? 'outside_call_window' : null, nextAttemptAt: new Date(next).toISOString(), policyDecisionId: policyDecision.decisionId, consentRevision: consentSnapshot.revision, capacityReservationRef: capacityReservation.reservationRef, approvalRef };
}

function webhookEvidenceValid(evidence, { tenantId, connectionRef, callRef = null, eventRef, now, maxAge = 5 * 60_000 } = {}) {
  if (!evidence || evidence.type !== 'provider_webhook' || evidence.verified !== true || evidence.tenantId !== tenantId || evidence.providerConnectionRef !== connectionRef || evidence.eventRef !== eventRef || !evidence.provider || !evidence.verificationRef || !/^[a-f0-9]{64}$/i.test(String(evidence.requestDigest || '')) || !freshSnapshot({ checkedAt: evidence.verifiedAt }, now, maxAge)) return false;
  if (!/^[A-Za-z][A-Za-z0-9_.-]{1,63}$/.test(evidence.provider)) return false;
  try { opaqueRef(evidence.verificationRef, 'verificationRef'); } catch { return false; }
  if (callRef && evidence.providerCallRef !== callRef) return false;
  if (evidence.providerCallRef != null) {
    try { providerOpaqueRef(evidence.providerCallRef, 'providerCallRef'); } catch { return false; }
  }
  return true;
}

function internalEvidenceValid(evidence, { tenantId, session, eventRef, now } = {}) {
  if (!evidence || !INTERNAL_SOURCE_TYPES.has(evidence.type) || evidence.authenticated !== true || evidence.tenantId !== tenantId || evidence.sessionId !== session.id || evidence.providerConnectionRef !== session.providerConnectionRef || evidence.eventRef !== eventRef || !freshSnapshot({ checkedAt: evidence.checkedAt }, now, 5 * 60_000)) return false;
  try { opaqueRef(evidence.actorRef, 'actorRef'); } catch { return false; }
  if (evidence.type === 'agent_runtime') return evidence.agentReleaseId === session.currentAgentRelease.releaseId && evidence.agentId === session.currentAgentRelease.agentId && evidence.agentReleaseChecksum === session.currentAgentRelease.checksum;
  if (evidence.type === 'authenticated_human' && session.status !== 'human_handoff_pending' && session.status !== 'human_active') return false;
  return true;
}

function eventRecord({ tenantId, sessionId, eventRef, type, sourceType, actorRef, occurredAt, metadata = {} }) {
  const event = { tenantId, sessionId, eventRef, type, sourceType, actorRef: actorRef || null, occurredAt: new Date(occurredAt).toISOString(), metadata };
  return deepFreeze({ ...event, checksum: digest(event) });
}

function outboundSnapshotFields(input) {
  return {
    purpose: input.purpose,
    policyDecision: input.policyDecision,
    consentSnapshot: input.consentSnapshot,
    suppressionSnapshot: input.suppressionSnapshot,
    frequencySnapshot: input.frequencySnapshot,
    providerTerms: input.providerTerms,
    capacityReservation: input.capacityReservation
  };
}

export function createVoiceCallSession({
  tenantId, contactRef = null, conversationRef, direction, providerConnectionRef,
  providerCallRef = null, agentRelease, disclosureVersion, recordingMode = 'disabled',
  sourceEvidence, eventRef, outboundAuthorization = null, contactTags = [], assignedAgentId = null,
  now = Date.now(), requestedAt = now, id = null
} = {}) {
  const tenant = opaqueRef(tenantId, 'tenantId');
  const connection = opaqueRef(providerConnectionRef, 'providerConnectionRef');
  const conversation = opaqueRef(conversationRef, 'conversationRef');
  const reference = opaqueRef(eventRef, 'eventRef');
  const current = timestamp(now, 'now');
  if (!['inbound', 'outbound'].includes(direction)) throw new Error('direction must be inbound or outbound');
  if (contactRef != null) contactRef = opaqueRef(contactRef, 'contactRef');
  if (!['disabled', 'consent_required'].includes(recordingMode)) throw new Error('recordingMode must be disabled or consent_required');
  const releaseRef = assertVoiceAgentRelease(agentRelease, tenant);
  const disclosure = opaqueRef(disclosureVersion, 'disclosureVersion');
  let routingDecision = null;
  if (direction === 'inbound') {
    providerCallRef = providerOpaqueRef(providerCallRef, 'providerCallRef');
    if (!webhookEvidenceValid(sourceEvidence, { tenantId: tenant, connectionRef: connection, callRef: providerCallRef, eventRef: reference, now: current })) throw new Error('Inbound call requires a fresh provider-verified webhook attestation');
    const route = resolveVoiceRoute({ tenantId: tenant, conversationRef: conversation, agentRelease, contactTags, assignedAgentId, now: current });
    if (!route.accepted) return { accepted: false, route: 'human', reason: route.reason, routeDecision: route.decision, session: null };
    routingDecision = route.decision;
  } else {
    if (!contactRef) throw new Error('Outbound calls require a tenant contact reference');
    if (providerCallRef != null) throw new Error('Outbound provider call references are assigned only from verified callbacks');
    if (!sourceEvidence || sourceEvidence.type !== 'workflow_runtime' || sourceEvidence.authenticated !== true || sourceEvidence.tenantId !== tenant || sourceEvidence.providerConnectionRef !== connection || sourceEvidence.eventRef !== reference || !sourceEvidence.workflowReleaseId || !sourceEvidence.enrollmentId || !sourceEvidence.stepId || !freshSnapshot({ checkedAt: sourceEvidence.checkedAt }, current, 5 * 60_000)) throw new Error('Outbound calls require a fresh tenant-bound workflow command attestation');
    for (const [key, value] of Object.entries({ workflowReleaseId: sourceEvidence.workflowReleaseId, enrollmentId: sourceEvidence.enrollmentId, stepId: sourceEvidence.stepId, actorRef: sourceEvidence.actorRef })) opaqueRef(value, key);
  }

  let nextCallAt = current;
  let eligibility = null;
  if (direction === 'outbound') {
    if (!outboundAuthorization) throw new Error('Outbound calls require fresh consent, suppression, provider-terms and capacity evidence');
    eligibility = authorizeOutboundVoiceCall({ ...outboundAuthorization, tenantId: tenant, contactRef, providerConnectionRef: connection, now: current, requestedAt });
    if (!eligibility.allowed) return { accepted: false, reason: eligibility.reason, session: null };
    nextCallAt = Date.parse(eligibility.nextAttemptAt);
  }
  const requested = timestamp(requestedAt, 'requestedAt');
  if (requested < current - 60_000 || requested - current > MAX_CALL_DELAY_MS) throw new Error('requestedAt must be between now and 30 days ahead');
  const sessionId = id == null ? generatedOpaqueId('voice') : opaqueRef(id, 'voice session id');
  const initialStatus = nextCallAt > current ? 'scheduled' : 'queued';
  const idempotencyKey = digest({ tenantId: tenant, direction, providerConnectionRef: connection, sourceEventRef: reference, conversationRef: conversation, contactRef, workflowReleaseId: sourceEvidence.workflowReleaseId || null, enrollmentId: sourceEvidence.enrollmentId || null, stepId: sourceEvidence.stepId || null });
  const initialActorRef = sourceEvidence.type === 'provider_webhook' ? boundedText(sourceEvidence.provider, 'provider', 64) : opaqueRef(sourceEvidence.actorRef, 'actorRef');
  const firstEvent = eventRecord({
    tenantId: tenant, sessionId, eventRef: reference, type: direction === 'inbound' ? 'voice.call_received' : 'voice.call_scheduled',
    sourceType: sourceEvidence.type, actorRef: initialActorRef, occurredAt: current,
    metadata: { direction, providerConnectionRef: connection, providerCallRef, agentReleaseId: releaseRef.releaseId, routeId: routingDecision?.routeId || null, status: initialStatus }
  });
  const session = {
    id: sessionId, tenantId: tenant, contactRef, conversationRef: conversation, direction,
    providerConnectionRef: connection, providerCallRef, status: initialStatus,
    currentAgentRelease: releaseRef, agentReleaseChain: [releaseRef], agentTransferCount: 0, routingDecision: routingDecision || null,
    aiDisclosureVersion: disclosure, aiDisclosureAt: null,
    humanQueueRef: null, handoffReason: null,
    recordingMode, recordingConsentStatus: recordingMode === 'disabled' ? 'not_required' : 'unknown',
    recordingState: 'off', recordingRef: null, callOutcome: null, appointmentRef: null,
    outboundAuthorizationRef: direction === 'outbound' ? eligibility.capacityReservationRef : null,
    scheduledAt: new Date(nextCallAt).toISOString(), nextAttemptAt: initialStatus === 'scheduled' ? new Date(nextCallAt).toISOString() : null,
    attemptCount: 0, idempotencyKey, eventRefs: [reference], events: [firstEvent],
    version: 1, createdAt: new Date(current).toISOString(), updatedAt: new Date(current).toISOString()
  };
  return { accepted: true, reason: null, session: sealSession(session), eligibility };
}

function transitionRejected(session, reason) {
  return { accepted: false, reason, session };
}

export function authorizeVoiceCallAttempt({ session, tenantId, agentRelease, outboundAuthorization = null, routingContext = null, now = Date.now() } = {}) {
  if (!verifyVoiceCallSession(session) || session.tenantId !== tenantId) return { allowed: false, reason: 'voice_session_scope_or_integrity_invalid', nextAttemptAt: null };
  if (!['queued', 'scheduled'].includes(session.status)) return { allowed: false, reason: 'voice_call_not_queued', nextAttemptAt: null };
  const current = timestamp(now, 'now');
  if (Date.parse(session.nextAttemptAt || session.scheduledAt) > current) return { allowed: false, reason: 'voice_call_not_due', nextAttemptAt: session.nextAttemptAt || session.scheduledAt };
  let pinned;
  try { pinned = assertVoiceAgentRelease(agentRelease, tenantId); } catch { return { allowed: false, reason: 'voice_agent_release_invalid', nextAttemptAt: null }; }
  if (pinned.releaseId !== session.currentAgentRelease.releaseId || pinned.checksum !== session.currentAgentRelease.checksum) return { allowed: false, reason: 'voice_agent_release_pin_mismatch', nextAttemptAt: null };
  if (routingContext && routingContext.tenantId !== tenantId) return { allowed: false, reason: 'voice_routing_context_scope_invalid', nextAttemptAt: null };
  const routing = resolveVoiceRoute({ tenantId, conversationRef: session.conversationRef, agentRelease, contactTags: routingContext?.tags || [], assignedAgentId: routingContext?.assignedAgentId || null, now: current });
  if (!routing.accepted) return { allowed: false, reason: 'voice_agent_route_unavailable', nextAttemptAt: null, routeReason: routing.reason };
  if (session.direction === 'outbound') {
    if (!outboundAuthorization) return { allowed: false, reason: 'outbound_call_policy_missing', nextAttemptAt: null };
    const recheck = authorizeOutboundVoiceCall({ ...outboundAuthorization, tenantId, contactRef: session.contactRef, providerConnectionRef: session.providerConnectionRef, now: current, requestedAt: current });
    if (!recheck.allowed) return recheck;
    if (Date.parse(recheck.nextAttemptAt) > current) return { allowed: false, reason: 'outside_call_window', nextAttemptAt: recheck.nextAttemptAt };
  }
  return { allowed: true, reason: null, nextAttemptAt: null, idempotencyKey: session.idempotencyKey, releaseId: pinned.releaseId };
}

export function transitionVoiceCallSession({
  session, tenantId, eventType, eventRef, sourceEvidence, occurredAt = Date.now(), now = Date.now(),
  targetAgentRelease = null, humanQueueRef = null, reason = null, disclosureVersion = null,
  consentEvidence = null, recordingRef = null, appointmentRef = null, outcome = null
} = {}) {
  if (!verifyVoiceCallSession(session)) throw new Error('Voice call session checksum is invalid');
  const tenant = opaqueRef(tenantId, 'tenantId');
  if (session.tenantId !== tenant) return transitionRejected(session, 'voice_call_tenant_mismatch');
  const ref = opaqueRef(eventRef, 'eventRef');
  if (session.eventRefs.includes(ref)) return transitionRejected(session, 'duplicate_call_event');
  if (session.eventRefs.length >= MAX_SESSION_EVENTS) return transitionRejected(session, 'voice_event_limit_reached');
  const current = timestamp(now, 'now'), at = timestamp(occurredAt, 'occurredAt');
  if (at > current + 60_000 || at < Date.parse(session.createdAt)) return transitionRejected(session, 'call_event_time_invalid');
  if (TERMINAL_STATES.has(session.status)) return transitionRejected(session, 'voice_call_terminal');
  const providerStart = eventType === 'provider_call_started' && session.direction === 'outbound' && session.providerCallRef == null;
  const verifiedWebhook = webhookEvidenceValid(sourceEvidence, { tenantId: tenant, connectionRef: session.providerConnectionRef, callRef: providerStart ? null : session.providerCallRef, eventRef: ref, now: current });
  const verifiedInternal = internalEvidenceValid(sourceEvidence, { tenantId: tenant, session, eventRef: ref, now: current });
  if (!(verifiedWebhook || verifiedInternal)) return transitionRejected(session, 'call_event_evidence_invalid');
  if (sourceEvidence.type === 'provider_webhook' && !session.providerCallRef && !providerStart) return transitionRejected(session, 'provider_call_reference_missing');
  if (at < Date.parse(session.events.at(-1).occurredAt)) return transitionRejected(session, 'call_event_out_of_order');

  let next = { ...session, eventRefs: [...session.eventRefs], events: [...session.events], updatedAt: new Date(current).toISOString(), version: session.version + 1 };
  let metadata = {};
  const sourceType = sourceEvidence.type;
  let actorRef = null;
  try { actorRef = sourceType === 'provider_webhook' ? boundedText(sourceEvidence.provider, 'provider', 64) : sourceEvidence.actorRef ? opaqueRef(sourceEvidence.actorRef, 'actorRef') : null; }
  catch { return transitionRejected(session, 'call_event_actor_reference_invalid'); }
  const active = ['agent_active', 'human_active'].includes(session.status);

  if (eventType === 'provider_call_started') {
    if (!providerStart || !['queued', 'scheduled'].includes(session.status) || (session.status === 'scheduled' && Date.parse(session.nextAttemptAt || session.scheduledAt) > current) || !verifiedWebhook || !sourceEvidence.providerCallRef) return transitionRejected(session, 'provider_call_start_not_expected');
    next.providerCallRef = providerOpaqueRef(sourceEvidence.providerCallRef, 'providerCallRef');
    next.status = 'queued';
    next.nextAttemptAt = null;
    metadata = { providerCallRef: next.providerCallRef };
  } else if (eventType === 'ai_disclosure_played') {
    if (session.status !== 'queued' || session.aiDisclosureAt || sourceType !== 'agent_runtime' || disclosureVersion !== session.aiDisclosureVersion) return transitionRejected(session, 'ai_disclosure_not_valid');
    next.aiDisclosureAt = new Date(at).toISOString();
    metadata = { disclosureVersion: session.aiDisclosureVersion };
  } else if (eventType === 'agent_connected') {
    if (session.status !== 'queued' || !session.aiDisclosureAt || (session.direction === 'outbound' && !session.providerCallRef) || !['agent_runtime', 'provider_webhook', 'system_runtime'].includes(sourceType)) return transitionRejected(session, 'ai_disclosure_required_before_agent_connection');
    next.status = 'agent_active';
    next.nextAttemptAt = null;
    metadata = { agentReleaseId: session.currentAgentRelease.releaseId };
  } else if (eventType === 'agent_transferred') {
    if (session.status !== 'agent_active' || sourceType !== 'agent_runtime' || !targetAgentRelease) return transitionRejected(session, 'agent_transfer_not_allowed');
    let target;
    try { target = assertVoiceAgentRelease(targetAgentRelease, tenant); } catch { return transitionRejected(session, 'target_agent_release_invalid'); }
    if (session.agentTransferCount >= MAX_AGENT_TRANSFERS || session.agentReleaseChain.some(item => item.releaseId === target.releaseId)) return transitionRejected(session, 'agent_transfer_limit_or_loop');
    const targetRouting = resolveVoiceRoute({ tenantId: tenant, conversationRef: session.conversationRef, agentRelease: targetAgentRelease, now: current });
    if (!targetRouting.accepted) return transitionRejected(session, 'target_agent_route_not_eligible');
    next.currentAgentRelease = target;
    next.agentReleaseChain = [...session.agentReleaseChain, target];
    next.agentTransferCount = session.agentTransferCount + 1;
    metadata = { fromReleaseId: session.currentAgentRelease.releaseId, toReleaseId: target.releaseId, transferCount: next.agentTransferCount };
  } else if (eventType === 'human_handoff_requested') {
    if (session.status !== 'agent_active' || sourceType !== 'agent_runtime') return transitionRejected(session, 'human_handoff_not_allowed');
    const why = boundedText(reason, 'handoff reason', 64);
    if (!VOICE_CALL_REASONS.includes(why)) return transitionRejected(session, 'handoff_reason_invalid');
    next.status = 'human_handoff_pending';
    next.humanQueueRef = opaqueRef(humanQueueRef, 'humanQueueRef');
    next.handoffReason = why;
    metadata = { queueRef: next.humanQueueRef, reason: why };
  } else if (eventType === 'human_connected') {
    if (session.status !== 'human_handoff_pending' || sourceType !== 'authenticated_human') return transitionRejected(session, 'human_handoff_not_pending');
    next.status = 'human_active';
    metadata = { queueRef: session.humanQueueRef };
  } else if (eventType === 'recording_consent_granted' || eventType === 'recording_consent_denied') {
    const capturedAt = Date.parse(consentEvidence?.capturedAt);
    if (!active || session.recordingMode !== 'consent_required' || !consentEvidence || sourceType !== 'provider_webhook' || consentEvidence.tenantId !== tenant || consentEvidence.sessionId !== session.id || consentEvidence.providerCallRef !== session.providerCallRef || consentEvidence.basis !== 'explicit_caller_action' || !consentEvidence.evidenceRef || !Number.isFinite(capturedAt) || capturedAt < Date.parse(session.createdAt) || capturedAt > current + 60_000 || Math.abs(capturedAt - at) > 60_000) return transitionRejected(session, 'recording_consent_evidence_invalid');
    const granted = eventType === 'recording_consent_granted';
    if ((granted && consentEvidence.status !== 'granted') || (!granted && consentEvidence.status !== 'denied')) return transitionRejected(session, 'recording_consent_status_mismatch');
    next.recordingConsentStatus = granted ? 'granted' : 'denied';
    metadata = { status: next.recordingConsentStatus, evidenceRef: opaqueRef(consentEvidence.evidenceRef, 'recording consent evidenceRef') };
  } else if (eventType === 'recording_started') {
    if (!active || session.recordingMode !== 'consent_required' || session.recordingConsentStatus !== 'granted' || session.recordingState !== 'off' || sourceType !== 'provider_webhook') return transitionRejected(session, 'recording_consent_required');
    next.recordingState = 'recording';
    next.recordingRef = providerOpaqueRef(recordingRef, 'recordingRef');
    metadata = { recordingRef: next.recordingRef };
  } else if (eventType === 'recording_stopped') {
    if (!active || session.recordingState !== 'recording' || sourceType !== 'provider_webhook') return transitionRejected(session, 'recording_not_active');
    next.recordingState = 'stopped';
    metadata = { recordingRef: session.recordingRef };
  } else if (eventType === 'appointment_booked') {
    if (session.status !== 'agent_active' || session.appointmentRef || !['provider_webhook', 'agent_runtime', 'system_runtime'].includes(sourceType)) return transitionRejected(session, 'appointment_booking_not_allowed');
    next.appointmentRef = providerOpaqueRef(appointmentRef, 'appointmentRef');
    metadata = { appointmentRef: next.appointmentRef };
  } else if (eventType === 'call_completed') {
    if (!active || session.recordingState === 'recording' || !VOICE_CALL_OUTCOMES.includes(outcome)) return transitionRejected(session, 'call_completion_requirements_not_met');
    if (outcome === 'appointment_booked' && !session.appointmentRef) return transitionRejected(session, 'appointment_booking_evidence_required');
    next.status = 'completed';
    next.callOutcome = outcome;
    metadata = { outcome };
  } else if (eventType === 'caller_disconnected') {
    if (!['queued', 'agent_active', 'human_handoff_pending', 'human_active'].includes(session.status) || sourceType !== 'provider_webhook') return transitionRejected(session, 'caller_disconnect_not_valid');
    next.status = 'abandoned';
    if (session.recordingState === 'recording') next.recordingState = 'stopped';
    metadata = { priorStatus: session.status };
  } else if (eventType === 'call_failed') {
    if (!['queued', 'agent_active', 'human_handoff_pending', 'human_active'].includes(session.status)) return transitionRejected(session, 'call_failure_not_valid');
    const why = boundedText(reason, 'call failure reason', 64);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(why)) return transitionRejected(session, 'call_failure_reason_invalid');
    next.status = 'failed';
    next.callOutcome = 'other';
    if (session.recordingState === 'recording') next.recordingState = 'stopped';
    metadata = { reason: why };
  } else if (eventType === 'review_required') {
    if (!['queued', 'agent_active', 'human_handoff_pending', 'human_active'].includes(session.status)) return transitionRejected(session, 'call_review_not_valid');
    const why = boundedText(reason, 'review reason', 64);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(why)) return transitionRejected(session, 'call_review_reason_invalid');
    next.status = 'needs_review';
    if (session.recordingState === 'recording') next.recordingState = 'stopped';
    metadata = { reason: why };
  } else {
    return transitionRejected(session, 'unknown_voice_event');
  }

  const event = eventRecord({ tenantId: tenant, sessionId: session.id, eventRef: ref, type: `voice.${eventType}`, sourceType, actorRef, occurredAt: at, metadata });
  next.eventRefs.push(ref);
  next.events.push(event);
  return { accepted: true, reason: null, event, session: sealSession(next) };
}
