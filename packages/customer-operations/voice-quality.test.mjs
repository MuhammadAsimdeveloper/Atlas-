import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtlasAuthority } from '../atlas-core/authority.mjs';
import { createAgentDeployment, publishAgentDeployment, rolloutBucket } from './index.mjs';
import { createVoiceCallSession, transitionVoiceCallSession } from './voice-operations.mjs';
import { verifyVoiceCallSession } from './voice-operations.mjs';
import { createVoiceCallQualityReview, summarizeVoiceCallQuality, verifyVoiceCallQualityReview, VOICE_QUALITY_RUBRIC } from './voice-quality.mjs';

const tenantId = 'tenant-quality-a';
const now = Date.parse('2026-10-05T15:00:00.000Z');
const authority = resolveAtlasAuthority({
  actor: { id: 'tenant-owner', authenticated: true, email: 'owner@quality.example.test', emailVerified: true },
  tenantId, memberships: [{ id: 'membership-quality', actorId: 'tenant-owner', tenantId, role: 'admin', status: 'active' }],
  ownerEmail: 'khan@example.test'
});

const deployment = createAgentDeployment({
  id: 'deployment-quality', tenantId, agentId: 'voice-agent-quality', version: 1,
  routes: [{ id: 'voice-route', channel: 'voice', coveragePercent: 100, workingHours: { mode: 'always', timezone: 'UTC', windows: [] } }]
});
const release = publishAgentDeployment({
  deployment, publisherAuthority: authority,
  evaluation: { tenantId, agentId: 'voice-agent-quality', score: 96, sampleCount: 24, errorRate: 0.01, criticalFailures: 0, evaluatedAt: new Date(now).toISOString() },
  evaluationVerifier: () => true,
  now, releaseId: 'quality-agent-release-v1'
});

function completedCall(callNumber = '0001', { outcome = 'resolved' } = {}) {
  const connection = 'quality-provider-connection';
  const conversation = Array.from({ length: 10000 }, (_, index) => `quality-conversation-${callNumber}-${index}`)
    .find(value => rolloutBucket(tenantId, release.id, value) < release.routes[0].coveragePercent);
  const eventRef = `quality-webhook-${callNumber}`;
  const providerCallRef = `CAqualitycall${callNumber}abcdef`;
  const base = {
    type: 'provider_webhook', verified: true, provider: 'twilio', tenantId,
    providerConnectionRef: connection, providerCallRef, eventRef,
    verificationRef: `quality-verified-${callNumber}`, requestDigest: 'a'.repeat(64), verifiedAt: new Date(now).toISOString()
  };
  const created = createVoiceCallSession({
    tenantId, conversationRef: conversation, direction: 'inbound', providerConnectionRef: connection,
    providerCallRef, agentRelease: release, disclosureVersion: 'disclosure-v1', eventRef,
    sourceEvidence: base, now
  });
  assert.equal(created.accepted, true, created.reason || created.reason === null ? created.reason : JSON.stringify(created));
  let session = created.session;
  const agentEvidence = (ref, checkedAt) => ({
    type: 'agent_runtime', authenticated: true, tenantId, sessionId: session.id,
    providerConnectionRef: connection, eventRef: ref, actorRef: 'voice-agent-quality', checkedAt: new Date(checkedAt).toISOString(),
    agentId: session.currentAgentRelease.agentId, agentReleaseId: session.currentAgentRelease.releaseId,
    agentReleaseChecksum: session.currentAgentRelease.checksum
  });
  const disclosed = transitionVoiceCallSession({ session, tenantId, eventType: 'ai_disclosure_played', eventRef: `quality-disclosure-${callNumber}`, sourceEvidence: agentEvidence(`quality-disclosure-${callNumber}`, now + 1000), disclosureVersion: 'disclosure-v1', now: now + 1000, occurredAt: now + 1000 });
  assert.equal(disclosed.accepted, true);
  const connected = transitionVoiceCallSession({ session: disclosed.session, tenantId, eventType: 'agent_connected', eventRef: `quality-connected-${callNumber}`, sourceEvidence: { ...agentEvidence(`quality-connected-${callNumber}`, now + 2000), sessionId: disclosed.session.id, agentReleaseId: disclosed.session.currentAgentRelease.releaseId, agentReleaseChecksum: disclosed.session.currentAgentRelease.checksum }, now: now + 2000, occurredAt: now + 2000 });
  assert.equal(connected.accepted, true);
  session = connected.session;
  let latest = session;
  if (outcome === 'appointment_booked') {
    const bookedRef = `quality-booking-${callNumber}`;
    const booked = transitionVoiceCallSession({ session: latest, tenantId, eventType: 'appointment_booked', eventRef: bookedRef, sourceEvidence: { ...base, eventRef: bookedRef, verifiedAt: new Date(now + 4000).toISOString() }, appointmentRef: `quality-calendar-${callNumber}`, now: now + 4000, occurredAt: now + 4000 });
    assert.equal(booked.accepted, true);
    latest = booked.session;
  }
  const doneRef = `quality-complete-${callNumber}`;
  const doneEvidence = { ...base, eventRef: doneRef, verifiedAt: new Date(now + 5000).toISOString() };
  const done = transitionVoiceCallSession({ session: latest, tenantId, eventType: 'call_completed', eventRef: doneRef, sourceEvidence: doneEvidence, outcome, now: now + 5000, occurredAt: now + 5000 });
  assert.equal(done.accepted, true);
  return done.session;
}

function rubric(score = 92) {
  return VOICE_QUALITY_RUBRIC.map(item => ({ id: item.id, score, confidenceBps: 9500, evidenceRefs: [`evidence-${item.id}-001`] }));
}

function reviewFor(session, { values = rubric(), reviewRef = 'qa-review-0001', at = now + 10_000, checkedAt = at, businessIntent = 'support' } = {}) {
  const evaluatorId = 'voice-qa-evaluator';
  const evaluatorVersion = 'rubric-2026-10-v1';
  const businessIntentEvidenceRef = `intent-evidence-${reviewRef}`;
  return createVoiceCallQualityReview({
    tenantId, session, reviewRef, evaluatorId, evaluatorVersion, businessIntent, businessIntentEvidenceRef,
    sourceEvidence: {
      type: 'voice_qa_runtime', authenticated: true, tenantId, sessionId: session.id, sessionChecksum: session.checksum,
      reviewRef, evaluatorId, evaluatorVersion, businessIntent, businessIntentEvidenceRef, actorRef: 'qa-worker-01', checkedAt: new Date(checkedAt).toISOString()
    },
    criteria: values, now: at
  });
}

test('voice quality review is tenant-pinned, privacy-minimal, checksummed and actionable', () => {
  const session = completedCall();
  const review = reviewFor(session, { at: now + 10_000 });
  assert.equal(review.tenantId, tenantId);
  assert.equal(review.sessionChecksum, session.checksum);
  assert.equal(review.score, 92);
  assert.equal(review.reviewStatus, 'good');
  assert.deepEqual(review.coaching, []);
  assert.equal(review.talkDurationSeconds, 3);
  assert.equal(verifyVoiceCallQualityReview(review), true);
  assert.equal(JSON.stringify(review).includes('transcript'), false);
  assert.equal(JSON.stringify(review).includes('recordingRef'), false);
  assert.equal(Object.isFrozen(review.criteria[0].evidenceRefs), true);
  assert.equal(verifyVoiceCallQualityReview({ ...review, customerTranscript: 'private data' }), false);
});

test('quality evaluation requires an intact completed same-tenant call and fresh authenticated evidence', () => {
  const session = completedCall('0002');
  assert.throws(() => reviewFor({ ...session, status: 'agent_active' }), /intact, completed call/);
  assert.throws(() => createVoiceCallQualityReview({ tenantId: 'tenant-foreign', session, reviewRef: 'qa-review-foreign', evaluatorId: 'qa-eval', evaluatorVersion: 'v1', sourceEvidence: {}, criteria: rubric(), now: now + 10_000 }), /same tenant/);
  assert.throws(() => reviewFor(session, { at: now + 30 * 60_000, checkedAt: now }), /fresh, authenticated/);
  const badEvidence = {
    type: 'voice_qa_runtime', authenticated: true, tenantId, sessionId: session.id, sessionChecksum: '0'.repeat(64),
    reviewRef: 'qa-review-wrong-session', evaluatorId: 'voice-qa-evaluator', evaluatorVersion: 'rubric-2026-10-v1', businessIntent: 'support', businessIntentEvidenceRef: 'intent-evidence-qa-review-wrong-session', actorRef: 'qa-worker-01', checkedAt: new Date(now + 10_000).toISOString()
  };
  assert.throws(() => createVoiceCallQualityReview({ tenantId, session, reviewRef: badEvidence.reviewRef, evaluatorId: badEvidence.evaluatorId, evaluatorVersion: badEvidence.evaluatorVersion, businessIntent: badEvidence.businessIntent, businessIntentEvidenceRef: badEvidence.businessIntentEvidenceRef, sourceEvidence: badEvidence, criteria: rubric(), now: now + 10_000 }), /fresh, authenticated/);
});

test('rubric input rejects missing criteria, invalid scores, duplicate items and personal data references', () => {
  const session = completedCall('0003');
  const cases = [
    rubric().slice(1),
    [{ ...rubric()[0], score: 101 }, ...rubric().slice(1)],
    [rubric()[0], rubric()[0], ...rubric().slice(2)],
    [{ ...rubric()[0], evidenceRefs: ['555-123-4567'] }, ...rubric().slice(1)]
  ];
  for (const criteria of cases) assert.throws(() => reviewFor(session, { values: criteria, reviewRef: 'qa-review-invalid', at: now + 10_000 }));
});

test('critical policy failures trigger urgent coaching and a release readiness block', () => {
  const session = completedCall('0004');
  const values = rubric();
  values[0] = { ...values[0], score: 60 };
  values[1] = { ...values[1], score: 75 };
  const review = reviewFor(session, { values, reviewRef: 'qa-critical-review', at: now + 10_000 });
  assert.equal(review.reviewStatus, 'safety_escalation');
  assert.deepEqual(review.criticalFailures, ['ai_disclosure', 'policy_compliance']);
  assert.equal(review.coaching.every(item => item.priority === 'urgent'), true);
  const summary = summarizeVoiceCallQuality({ tenantId, releaseId: release.releaseId, sessions: [session], reviews: [review], minimumSampleCount: 5, now: now + 20_000 });
  assert.equal(summary.criticalFailureCount, 1);
  assert.equal(summary.criticalIssueCount, 2);
  assert.equal(summary.promotionAssessment.readyForGovernanceReview, false);
  assert.ok(summary.promotionAssessment.reasons.includes('policy_compliance_critical_failures'));
});

test('tenant/release quality summaries ignore tampered and foreign reviews and expose service-business metrics', () => {
  const session = completedCall('0005');
  const review = reviewFor(session, { at: now + 10_000 });
  assert.equal(verifyVoiceCallSession(session), true);
  assert.equal(verifyVoiceCallQualityReview(review), true);
  const tampered = { ...review, score: 100 };
  const foreign = { ...review, tenantId: 'tenant-foreign' };
  const summary = summarizeVoiceCallQuality({
    tenantId, releaseId: release.releaseId, sessions: [session], reviews: [review, tampered, foreign, review], minimumSampleCount: 5, now: now + 20_000
  });
  assert.equal(summary.sampleCount, 1, JSON.stringify(summary));
  assert.equal(summary.sessionCount, 1);
  assert.equal(summary.rejectedReviewCount, 2);
  assert.equal(summary.averageScore, 92);
  assert.equal(summary.taskCompletionRateBps, 10000);
  assert.equal(summary.humanHandoffRateBps, 0);
  assert.equal(summary.appointmentConversionBps, null);
  assert.equal(summary.p50TalkDurationSeconds, 3);
  assert.equal(summary.promotionAssessment.readyForGovernanceReview, false);
  assert.deepEqual(summary.promotionAssessment.reasons, ['minimum_sample_not_met']);
});

test('appointment conversion uses only calls classified as appointment booking', () => {
  const appointment = completedCall('0006', { outcome: 'appointment_booked' });
  const bookingReview = reviewFor(appointment, { reviewRef: 'qa-booking-review', at: now + 10_000, businessIntent: 'appointment_booking' });
  const support = completedCall('0007');
  const supportReview = reviewFor(support, { reviewRef: 'qa-support-review', at: now + 10_000, businessIntent: 'support' });
  const summary = summarizeVoiceCallQuality({ tenantId, releaseId: release.releaseId, sessions: [appointment, support], reviews: [bookingReview, supportReview], minimumSampleCount: 5, now: now + 20_000 });
  assert.equal(summary.appointmentConversionBps, 10000);
});
