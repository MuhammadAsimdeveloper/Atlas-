import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtlasAuthority } from '../atlas-core/authority.mjs';
import { createAgentDeployment, publishAgentDeployment, rolloutBucket } from './index.mjs';
import {
  authorizeOutboundVoiceCall, authorizeVoiceCallAttempt, createVoiceCallSession,
  nextPermittedVoiceCallAt, normalizeVoiceCallWindow, transitionVoiceCallSession,
  verifyVoiceCallSession
} from './voice-operations.mjs';

const tenantId = 'tenant-voice-a';
const now = Date.parse('2026-10-05T14:00:00.000Z'); // Monday 07:00 in Los Angeles.
const authority = resolveAtlasAuthority({
  actor: { id: 'admin-voice', authenticated: true, email: 'owner@voice.example.test', emailVerified: true },
  tenantId, memberships: [{ id: 'membership-voice', actorId: 'admin-voice', tenantId, role: 'admin', status: 'active' }],
  ownerEmail: 'khan@example.test'
});

function voiceRelease({ tenant = tenantId, id = 'deployment-voice', agentId = 'support-voice-agent', releaseId = `release-${agentId}` } = {}) {
  const draft = createAgentDeployment({
    id, tenantId: tenant, agentId, version: 1,
    routes: [{ id: 'phone', channel: 'voice', coveragePercent: 100, workingHours: { mode: 'always', timezone: 'America/Los_Angeles', windows: [] } }]
  });
  return publishAgentDeployment({
    deployment: draft,
    publisherAuthority: authority,
    evaluation: { tenantId: tenant, agentId, score: 98, sampleCount: 24, errorRate: 0.01, criticalFailures: 0, evaluatedAt: new Date(now).toISOString() },
    now, releaseId
  });
}

const release = voiceRelease();
const connectionRef = 'voice-connection-1';
const selectedConversationRef = Array.from({ length: 10000 }, (_, index) => `voice-conversation-${index}`)
  .find(conversationRef => rolloutBucket(tenantId, release.id, conversationRef) < release.routes[0].coveragePercent);

function webhook(eventRef, providerCallRef, at = now, extra = {}) {
  return {
    type: 'provider_webhook', verified: true, provider: 'twilio', tenantId,
    providerConnectionRef: connectionRef, providerCallRef, eventRef,
    verificationRef: `verified-${eventRef}`, requestDigest: 'a'.repeat(64), verifiedAt: new Date(at).toISOString(), ...extra
  };
}

function inbound(overrides = {}) {
  const eventRef = 'provider-event-000001';
  const providerCallRef = 'CAabcdef0123456789abcdef01234567';
  return createVoiceCallSession({
    tenantId, contactRef: 'contact-ref-1', conversationRef: selectedConversationRef, direction: 'inbound',
    providerConnectionRef: connectionRef, providerCallRef, agentRelease: release,
    disclosureVersion: 'ai-disclosure-v1', recordingMode: 'consent_required', eventRef,
    sourceEvidence: webhook(eventRef, providerCallRef), now, ...overrides
  });
}

function actorEvidence(session, eventRef, type = 'agent_runtime', actorRef = session.currentAgentRelease.agentId, at = now) {
  return {
    type, authenticated: true, tenantId: session.tenantId, sessionId: session.id,
    providerConnectionRef: session.providerConnectionRef, eventRef,
    actorRef, checkedAt: new Date(at).toISOString(),
    ...(type === 'agent_runtime' ? {
      agentId: session.currentAgentRelease.agentId,
      agentReleaseId: session.currentAgentRelease.releaseId,
      agentReleaseChecksum: session.currentAgentRelease.checksum
    } : {})
  };
}

function disclosure(session) {
  const eventRef = 'agent-disclosure-0001';
  return transitionVoiceCallSession({ session, tenantId, eventType: 'ai_disclosure_played', eventRef, sourceEvidence: actorEvidence(session, eventRef), disclosureVersion: session.aiDisclosureVersion, occurredAt: now, now });
}

function connect(session) {
  const eventRef = 'agent-connect-00001';
  return transitionVoiceCallSession({ session, tenantId, eventType: 'agent_connected', eventRef, sourceEvidence: actorEvidence(session, eventRef), occurredAt: now + 1_000, now: now + 1_000 });
}

function outboundEvidence(at = now) {
  const checkedAt = new Date(at).toISOString();
  return {
    purpose: 'appointment',
    policyDecision: {
      tenantId, contactId: 'contact-ref-2', channel: 'voice', purpose: 'appointment', eligible: true,
      decisionId: 'voice-policy-v1', policyVersion: 'policy-v1', requiredTermsVersion: 'terms-v3',
      checkedAt, expiresAt: new Date(at + 2 * 3600000).toISOString(),
      callWindow: { timeZone: 'America/Los_Angeles', windows: [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '20:00' }] }
    },
    consentSnapshot: {
      tenantId, contactId: 'contact-ref-2', channel: 'voice', purpose: 'appointment', eligible: true,
      basis: 'explicit_consent', revision: 'consent-rev-9', checkedAt,
      expiresAt: new Date(at + 2 * 3600000).toISOString()
    },
    suppressionSnapshot: { tenantId, contactId: 'contact-ref-2', channel: 'voice', blocked: false, revision: 'dnc-rev-1', checkedAt },
    frequencySnapshot: { tenantId, contactId: 'contact-ref-2', channel: 'voice', allowed: true, windowId: 'contact-day-1', count: 0, limit: 3, checkedAt },
    providerTerms: { tenantId, providerConnectionRef: connectionRef, accepted: true, termsVersion: 'terms-v3', agreementRef: 'terms-agreement-1', acceptedAt: checkedAt },
    capacityReservation: { tenantId, providerConnectionRef: connectionRef, status: 'reserved', reservationRef: 'capacity-reservation-1', bucketRef: 'provider-minute-1', checkedAt, expiresAt: new Date(at + 2 * 3600000).toISOString() }
  };
}

function workflowEvidence(eventRef) {
  return { type: 'workflow_runtime', authenticated: true, tenantId, providerConnectionRef: connectionRef, eventRef, workflowReleaseId: 'workflow-release-1', enrollmentId: 'enrollment-1', stepId: 'voice-call-step', actorRef: 'workflow-worker-1', checkedAt: new Date(now).toISOString() };
}

test('inbound call intake pins an evaluated tenant voice release and stores opaque references only', () => {
  const result = inbound();
  assert.equal(result.accepted, true);
  assert.equal(result.session.status, 'queued');
  assert.equal(result.session.providerCallRef, 'CAabcdef0123456789abcdef01234567');
  assert.equal(result.session.aiDisclosureAt, null);
  assert.equal(result.session.recordingState, 'off');
  assert.equal(result.session.currentAgentRelease.releaseId, release.releaseId);
  assert.equal(verifyVoiceCallSession(result.session), true);
  assert.equal(Object.keys(result.session).some(key => /phone|transcript|audio/i.test(key)), false);
  assert.throws(() => inbound({ contactRef: '+1 (555) 867-5309' }), /opaque reference/);
});

test('call intake rejects forged, stale, cross-tenant and tampered provider or agent evidence', () => {
  const eventRef = 'provider-event-000001';
  const providerCallRef = 'CAabcdef0123456789abcdef01234567';
  assert.throws(() => inbound({ sourceEvidence: { ...webhook(eventRef, providerCallRef), verified: false } }), /provider-verified/);
  assert.throws(() => inbound({ sourceEvidence: webhook(eventRef, providerCallRef, now - 6 * 60_000) }), /provider-verified/);
  assert.throws(() => inbound({ sourceEvidence: webhook(eventRef, providerCallRef, now, { tenantId: 'tenant-foreign' }) }), /provider-verified/);
  assert.throws(() => inbound({ agentRelease: { ...release, tenantId: 'tenant-foreign' } }), /belong to this tenant/);
  assert.throws(() => inbound({ agentRelease: { ...release, checksum: '0'.repeat(64) } }), /checksum is invalid/);
  assert.throws(() => inbound({ agentRelease: { ...release, routes: release.routes.filter(route => route.channel !== 'voice') } }), /checksum is invalid/);
});

test('outbound voice requires separate contact consent, current do-not-call/frequency, terms and atomic capacity reservation', () => {
  const evidence = outboundEvidence();
  const accepted = authorizeOutboundVoiceCall({ tenantId, contactRef: 'contact-ref-2', providerConnectionRef: connectionRef, ...evidence, now, requestedAt: now });
  assert.equal(accepted.allowed, true);
  assert.equal(accepted.reason, 'outside_call_window');
  assert.equal(accepted.nextAttemptAt, new Date(Date.parse('2026-10-05T15:00:00.000Z')).toISOString());
  assert.equal(authorizeOutboundVoiceCall({ tenantId, contactRef: 'contact-ref-2', providerConnectionRef: connectionRef, ...evidence, consentSnapshot: { ...evidence.consentSnapshot, basis: 'contract' }, now }).reason, 'explicit_voice_consent_required');
  assert.equal(authorizeOutboundVoiceCall({ tenantId, contactRef: 'contact-ref-2', providerConnectionRef: connectionRef, ...evidence, suppressionSnapshot: { ...evidence.suppressionSnapshot, blocked: true }, now }).reason, 'contact_on_do_not_call_list');
  assert.equal(authorizeOutboundVoiceCall({ tenantId, contactRef: 'contact-ref-2', providerConnectionRef: connectionRef, ...evidence, providerTerms: { ...evidence.providerTerms, accepted: false }, now }).reason, 'provider_outbound_terms_not_accepted');
  assert.equal(authorizeOutboundVoiceCall({ tenantId, contactRef: 'contact-ref-2', providerConnectionRef: connectionRef, ...evidence, capacityReservation: { ...evidence.capacityReservation, status: 'released' }, now }).reason, 'provider_capacity_not_reserved');
  assert.equal(authorizeOutboundVoiceCall({ tenantId: 'tenant-foreign', contactRef: 'contact-ref-2', providerConnectionRef: connectionRef, ...evidence, now }).reason, 'call_policy_scope_invalid');
});

test('voice windows use the contact timezone, include overnight schedules and resolve DST gaps by real instants', () => {
  const overnight = { timeZone: 'America/Los_Angeles', windows: [{ days: [0], start: '22:00', end: '02:00' }] };
  assert.equal(nextPermittedVoiceCallAt(Date.parse('2026-10-05T06:00:00.000Z'), overnight), Date.parse('2026-10-05T06:00:00.000Z'));
  const springForward = { timeZone: 'America/Los_Angeles', windows: [{ days: [0], start: '02:30', end: '04:00' }] };
  assert.equal(nextPermittedVoiceCallAt(Date.parse('2026-03-08T09:50:00.000Z'), springForward), Date.parse('2026-03-08T10:00:00.000Z'));
  assert.throws(() => normalizeVoiceCallWindow({ timeZone: 'Nope/Here', windows: [{ days: [1], start: '09:00', end: '17:00' }] }), /valid IANA timezone/);
  assert.throws(() => normalizeVoiceCallWindow({ timeZone: 'UTC', windows: [{ days: [7], start: '09:00', end: '17:00' }] }), /weekdays 0-6/);
});

test('outbound session creation is idempotently keyed, queued only with valid evidence and rechecks current authority before dispatch', () => {
  const eventRef = 'workflow-command-0001';
  const evidence = outboundEvidence();
  const planned = createVoiceCallSession({
    tenantId, contactRef: 'contact-ref-2', conversationRef: selectedConversationRef, direction: 'outbound',
    providerConnectionRef: connectionRef, agentRelease: release, disclosureVersion: 'disclosure-v1',
    sourceEvidence: workflowEvidence(eventRef), eventRef, outboundAuthorization: evidence, now, requestedAt: now
  });
  assert.equal(planned.accepted, true);
  assert.equal(planned.session.status, 'scheduled');
  assert.equal(planned.session.providerCallRef, null);
  assert.equal(planned.session.outboundAuthorizationRef, 'capacity-reservation-1');
  assert.equal(authorizeVoiceCallAttempt({ session: planned.session, tenantId, agentRelease: release, outboundAuthorization: evidence, now }).reason, 'voice_call_not_due');
  const dueAt = Date.parse(planned.session.scheduledAt);
  const refreshed = outboundEvidence(dueAt);
  const authorized = authorizeVoiceCallAttempt({ session: planned.session, tenantId, agentRelease: release, outboundAuthorization: refreshed, now: dueAt });
  assert.equal(authorized.allowed, true);
  assert.equal(authorized.idempotencyKey, planned.session.idempotencyKey);
  assert.equal(authorizeVoiceCallAttempt({ session: planned.session, tenantId: 'tenant-foreign', agentRelease: release, outboundAuthorization: refreshed, now: dueAt }).allowed, false);
  assert.equal(authorizeVoiceCallAttempt({ session: planned.session, tenantId, agentRelease: voiceRelease({ releaseId: 'other-release' }), outboundAuthorization: refreshed, now: dueAt }).reason, 'voice_agent_release_pin_mismatch');
  const noConsent = createVoiceCallSession({
    tenantId, contactRef: 'contact-ref-2', conversationRef: 'conversation-out-2', direction: 'outbound', providerConnectionRef: connectionRef,
    agentRelease: release, disclosureVersion: 'disclosure-v1', sourceEvidence: workflowEvidence('workflow-command-0002'), eventRef: 'workflow-command-0002',
    outboundAuthorization: { ...evidence, consentSnapshot: { ...evidence.consentSnapshot, eligible: false } }, now
  });
  assert.equal(noConsent.accepted, false);
  assert.equal(noConsent.session, null);
});

test('agent connection requires disclosure, pins specialist transfers and prevents transfer loops', () => {
  const specialist = voiceRelease({ id: 'deployment-booking', agentId: 'booking-agent', releaseId: 'release-booking-agent' });
  const transferConversationRef = Array.from({ length: 10000 }, (_, index) => `voice-transfer-conversation-${index}`)
    .find(conversationRef => rolloutBucket(tenantId, release.id, conversationRef) < release.routes[0].coveragePercent && rolloutBucket(tenantId, specialist.id, conversationRef) < specialist.routes[0].coveragePercent);
  const first = inbound({ conversationRef: transferConversationRef }).session;
  const premature = connect(first);
  assert.equal(premature.accepted, false);
  assert.equal(premature.reason, 'ai_disclosure_required_before_agent_connection');
  const disclosed = disclosure(first);
  assert.equal(disclosed.accepted, true);
  const connected = connect(disclosed.session);
  assert.equal(connected.accepted, true);
  const transferRef = 'agent-transfer-0001';
  const transferred = transitionVoiceCallSession({
    session: connected.session, tenantId, eventType: 'agent_transferred', eventRef: transferRef,
    sourceEvidence: actorEvidence(connected.session, transferRef), targetAgentRelease: specialist, now: now + 2_000, occurredAt: now + 2_000
  });
  assert.equal(transferred.accepted, true, transferred.reason);
  assert.equal(transferred.session.currentAgentRelease.agentId, 'booking-agent');
  assert.equal(transferred.session.agentTransferCount, 1);
  const loopRef = 'agent-transfer-loop-1';
  const loop = transitionVoiceCallSession({ session: transferred.session, tenantId, eventType: 'agent_transferred', eventRef: loopRef, sourceEvidence: actorEvidence(transferred.session, loopRef), targetAgentRelease: release, now: now + 3_000, occurredAt: now + 3_000 });
  assert.equal(loop.reason, 'agent_transfer_limit_or_loop');
  assert.equal(loop.session.currentAgentRelease.agentId, 'booking-agent');
});

test('human handoff records a reason and an authenticated person must join the same tenant queue', () => {
  const first = inbound().session;
  const active = connect(disclosure(first).session).session;
  const handoffRef = 'handoff-request-0001';
  const handoff = transitionVoiceCallSession({ session: active, tenantId, eventType: 'human_handoff_requested', eventRef: handoffRef, sourceEvidence: actorEvidence(active, handoffRef), humanQueueRef: 'support-queue-1', reason: 'caller_requested_human', now: now + 2_000, occurredAt: now + 2_000 });
  assert.equal(handoff.accepted, true);
  assert.equal(handoff.session.status, 'human_handoff_pending');
  assert.equal(handoff.session.handoffReason, 'caller_requested_human');
  const joinRef = 'human-connected-0001';
  const joined = transitionVoiceCallSession({ session: handoff.session, tenantId, eventType: 'human_connected', eventRef: joinRef, sourceEvidence: actorEvidence(handoff.session, joinRef, 'authenticated_human', 'staff-user-1', now + 3_000), now: now + 3_000, occurredAt: now + 3_000 });
  assert.equal(joined.accepted, true);
  assert.equal(joined.session.status, 'human_active');
  const forged = transitionVoiceCallSession({ session: handoff.session, tenantId, eventType: 'human_connected', eventRef: 'human-connected-0002', sourceEvidence: actorEvidence(handoff.session, 'human-connected-0002', 'agent_runtime', 'support-voice-agent', now + 3_000), now: now + 3_000 });
  assert.equal(forged.accepted, false);
});

test('recording waits for scoped caller consent, stops before a normal completion and retains append-only event evidence', () => {
  const first = inbound().session;
  const active = connect(disclosure(first).session).session;
  const consentRef = 'recording-consent-event-1';
  const consented = transitionVoiceCallSession({
    session: active, tenantId, eventType: 'recording_consent_granted', eventRef: consentRef,
    sourceEvidence: webhook(consentRef, active.providerCallRef, now + 2_000),
    consentEvidence: { tenantId, sessionId: active.id, providerCallRef: active.providerCallRef, status: 'granted', basis: 'explicit_caller_action', evidenceRef: 'consent-capture-1', capturedAt: new Date(now + 2_000).toISOString() },
    now: now + 2_000, occurredAt: now + 2_000
  });
  assert.equal(consented.accepted, true);
  const recordingRef = 'recording-ref-0001';
  const started = transitionVoiceCallSession({ session: consented.session, tenantId, eventType: 'recording_started', eventRef: 'recording-start-0001', sourceEvidence: webhook('recording-start-0001', active.providerCallRef, now + 3_000), recordingRef, now: now + 3_000, occurredAt: now + 3_000 });
  assert.equal(started.accepted, true);
  const prematureFinish = transitionVoiceCallSession({ session: started.session, tenantId, eventType: 'call_completed', eventRef: 'call-complete-0001', sourceEvidence: webhook('call-complete-0001', active.providerCallRef, now + 4_000), outcome: 'resolved', now: now + 4_000, occurredAt: now + 4_000 });
  assert.equal(prematureFinish.reason, 'call_completion_requirements_not_met');
  const stopped = transitionVoiceCallSession({ session: started.session, tenantId, eventType: 'recording_stopped', eventRef: 'recording-stop-0001', sourceEvidence: webhook('recording-stop-0001', active.providerCallRef, now + 4_000), now: now + 4_000, occurredAt: now + 4_000 });
  const booked = transitionVoiceCallSession({ session: stopped.session, tenantId, eventType: 'appointment_booked', eventRef: 'appointment-booked-0001', sourceEvidence: webhook('appointment-booked-0001', active.providerCallRef, now + 4_500), appointmentRef: 'calendar-booking-0001', now: now + 4_500, occurredAt: now + 4_500 });
  const finished = transitionVoiceCallSession({ session: booked.session, tenantId, eventType: 'call_completed', eventRef: 'call-complete-0002', sourceEvidence: webhook('call-complete-0002', active.providerCallRef, now + 5_000), outcome: 'appointment_booked', now: now + 5_000, occurredAt: now + 5_000 });
  assert.equal(finished.accepted, true);
  assert.equal(finished.session.status, 'completed');
  assert.equal(finished.session.recordingRef, recordingRef);
  assert.equal(finished.session.events.length, 8);
  assert.equal(finished.session.events.some(event => JSON.stringify(event).includes('transcript')), false);
  assert.equal(Object.isFrozen(finished.session.events), true);
  const replay = transitionVoiceCallSession({ session: finished.session, tenantId, eventType: 'call_completed', eventRef: 'call-complete-0002', sourceEvidence: webhook('call-complete-0002', active.providerCallRef, now + 6_000), outcome: 'resolved', now: now + 6_000 });
  assert.equal(replay.reason, 'duplicate_call_event');
  assert.equal(verifyVoiceCallSession(finished.session), true);
  assert.equal(verifyVoiceCallSession({ ...finished.session, status: 'agent_active' }), false);
});

test('needs-review voice calls are terminal and cannot be mutated by later callbacks', () => {
  const first = inbound().session;
  const review = transitionVoiceCallSession({ session: first, tenantId, eventType: 'review_required', eventRef: 'review-required-001', sourceEvidence: webhook('review-required-001', first.providerCallRef, now + 1_000), reason: 'recording_policy_review', now: now + 1_000, occurredAt: now + 1_000 });
  assert.equal(review.accepted, true);
  const later = transitionVoiceCallSession({ session: review.session, tenantId, eventType: 'caller_disconnected', eventRef: 'disconnect-after-review-1', sourceEvidence: webhook('disconnect-after-review-1', first.providerCallRef, now + 2_000), now: now + 2_000, occurredAt: now + 2_000 });
  assert.equal(later.reason, 'voice_call_terminal');
});

test('outbound policy decision requiring approval rejects missing evidence and validates reference privacy', () => {
  const evidence = outboundEvidence();
  evidence.policyDecision.approvalRequired = true;
  assert.equal(authorizeOutboundVoiceCall({ tenantId, contactRef: 'contact-ref-2', providerConnectionRef: connectionRef, ...evidence, now, requestedAt: now }).reason, 'outbound_voice_approval_required');
  const approvalEvidence = { status: 'approved', tenantId, contactId: 'contact-ref-2', channel: 'voice', policyDecisionId: 'voice-policy-v1', evidenceRef: 'approval-evidence-1', approvedAt: new Date(now).toISOString(), expiresAt: new Date(now + 2 * 3600000).toISOString() };
  assert.equal(authorizeOutboundVoiceCall({ tenantId, contactRef: 'contact-ref-2', providerConnectionRef: connectionRef, ...evidence, approvalEvidence, now, requestedAt: now }).allowed, true);
  assert.equal(authorizeOutboundVoiceCall({ tenantId, contactRef: 'contact-ref-2', providerConnectionRef: connectionRef, ...evidence, approvalEvidence: { ...approvalEvidence, evidenceRef: '555-123-4567' }, now }).reason, 'outbound_voice_approval_required');
  assert.equal(authorizeOutboundVoiceCall({ tenantId, contactRef: 'contact-ref-2', providerConnectionRef: connectionRef, ...outboundEvidence(), frequencySnapshot: { ...outboundEvidence().frequencySnapshot, windowId: 'contact-555-123-4567' }, now }).reason, 'outbound_evidence_reference_invalid');
});

test('failed signatures, stale events and terminal-session mutations fail closed', () => {
  const first = inbound().session;
  const badEvent = transitionVoiceCallSession({ session: first, tenantId, eventType: 'caller_disconnected', eventRef: 'caller-disconnect-1', sourceEvidence: { ...webhook('caller-disconnect-1', first.providerCallRef), requestDigest: 'bad' }, now: now + 1_000, occurredAt: now + 1_000 });
  assert.equal(badEvent.reason, 'call_event_evidence_invalid');
  const disclosureRef = 'late-disclosure-0001';
  const disclosedLater = transitionVoiceCallSession({ session: first, tenantId, eventType: 'ai_disclosure_played', eventRef: disclosureRef, sourceEvidence: actorEvidence(first, disclosureRef, 'agent_runtime', first.currentAgentRelease.agentId, now + 1_000), disclosureVersion: first.aiDisclosureVersion, now: now + 1_000, occurredAt: now + 1_000 });
  const outOfOrder = transitionVoiceCallSession({ session: disclosedLater.session, tenantId, eventType: 'caller_disconnected', eventRef: 'caller-disconnect-2', sourceEvidence: webhook('caller-disconnect-2', first.providerCallRef, now + 1_500), now: now + 1_500, occurredAt: now + 500 });
  assert.equal(outOfOrder.reason, 'call_event_out_of_order');
  const ended = transitionVoiceCallSession({ session: first, tenantId, eventType: 'caller_disconnected', eventRef: 'caller-disconnect-3', sourceEvidence: webhook('caller-disconnect-3', first.providerCallRef, now + 2_000), now: now + 2_000, occurredAt: now + 2_000 });
  assert.equal(ended.session.status, 'abandoned');
  const afterEnd = transitionVoiceCallSession({ session: ended.session, tenantId, eventType: 'call_failed', eventRef: 'late-call-failure-1', sourceEvidence: webhook('late-call-failure-1', first.providerCallRef, now + 3_000), reason: 'provider_error', now: now + 3_000, occurredAt: now + 3_000 });
  assert.equal(afterEnd.reason, 'voice_call_terminal');
});
