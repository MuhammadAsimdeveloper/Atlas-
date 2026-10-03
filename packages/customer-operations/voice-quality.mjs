import crypto from 'node:crypto';
import { verifyVoiceCallSession } from './voice-operations.mjs';

export const VOICE_QUALITY_RUBRIC = Object.freeze([
  Object.freeze({ id: 'policy_compliance', label: 'Policy and privacy', weight: 25, critical: true }),
  Object.freeze({ id: 'ai_disclosure', label: 'AI disclosure', weight: 15, critical: true }),
  Object.freeze({ id: 'task_completion', label: 'Booking or intake completion', weight: 20, critical: false }),
  Object.freeze({ id: 'answer_grounding', label: 'Grounded answer', weight: 15, critical: false }),
  Object.freeze({ id: 'handoff_quality', label: 'Human handoff', weight: 10, critical: false }),
  Object.freeze({ id: 'follow_up_quality', label: 'Approved follow-up', weight: 15, critical: false })
]);

export const VOICE_QUALITY_THRESHOLDS = Object.freeze({
  coachBelow: 85,
  criticalBelow: 80,
  minimumReleaseSample: 20,
  minimumReleaseScore: 85,
  minimumTaskCompletion: 80
});
export const VOICE_BUSINESS_INTENTS = Object.freeze(['appointment_booking', 'lead_qualification', 'billing', 'support', 'other']);

const RUBRIC_BY_ID = new Map(VOICE_QUALITY_RUBRIC.map(item => [item.id, item]));
const COACHING = Object.freeze({
  policy_compliance: Object.freeze({ code: 'review_policy_controls', priority: 'urgent' }),
  ai_disclosure: Object.freeze({ code: 'repair_disclosure_flow', priority: 'urgent' }),
  task_completion: Object.freeze({ code: 'improve_booking_or_intake_steps', priority: 'high' }),
  answer_grounding: Object.freeze({ code: 'refresh_approved_knowledge', priority: 'normal' }),
  handoff_quality: Object.freeze({ code: 'improve_human_handoff_context', priority: 'normal' }),
  follow_up_quality: Object.freeze({ code: 'review_approved_follow_up_recipe', priority: 'normal' })
});
const REF_PII = /@|\+?\d[\d(). -]{6,}\d/;
const REVIEW_KEYS = Object.freeze(['id', 'tenantId', 'reviewRef', 'sessionId', 'sessionChecksum', 'reviewedReleaseIds', 'outcome', 'businessIntent', 'businessIntentEvidenceRef', 'talkDurationSeconds', 'agentTransferCount', 'humanHandoff', 'appointmentBooked', 'evaluatorId', 'evaluatorVersion', 'reviewerType', 'reviewerRef', 'evaluatedAt', 'score', 'criticalFailures', 'reviewStatus', 'criteria', 'coaching', 'createdAt', 'checksum']);

function ref(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 180 || /[\r\n\u0000]/.test(value) || REF_PII.test(value)) throw new Error(`${name} must be a privacy-safe opaque reference`);
  return value.trim();
}

function time(value, name) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(result) || !Number.isFinite(new Date(result).getTime())) throw new Error(`${name} must be a valid timestamp`);
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function generatedReviewId() {
  const entropy = crypto.randomUUID().replaceAll('-', '').match(/.{1,4}/g).join('x');
  return `voice_qa_${entropy}`;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function seal(review) {
  return freezeDeep({ ...review, checksum: hash(review) });
}

export function verifyVoiceCallQualityReview(review) {
  if (!review || typeof review !== 'object' || !/^[a-f0-9]{64}$/.test(String(review.checksum || ''))) return false;
  if (Object.keys(review).sort().join('|') !== [...REVIEW_KEYS].sort().join('|')) return false;
  if (!Array.isArray(review.reviewedReleaseIds) || !Array.isArray(review.criticalFailures) || !Array.isArray(review.coaching)) return false;
  try {
    ref(review.tenantId, 'tenantId'); ref(review.id, 'review id'); ref(review.reviewRef, 'reviewRef'); ref(review.sessionId, 'sessionId');
    ref(review.evaluatorId, 'evaluatorId'); ref(review.evaluatorVersion, 'evaluatorVersion'); ref(review.reviewerRef, 'reviewerRef');
    ref(review.businessIntentEvidenceRef, 'businessIntentEvidenceRef');
    if (!/^[a-f0-9]{64}$/.test(review.sessionChecksum) || !Number.isSafeInteger(review.score) || review.score < 0 || review.score > 100) return false;
    if (!['resolved', 'appointment_booked', 'qualified', 'follow_up_required', 'transferred', 'voicemail', 'spam', 'other'].includes(review.outcome)) return false;
    if (!VOICE_BUSINESS_INTENTS.includes(review.businessIntent)) return false;
    if (!['voice_qa_runtime', 'authenticated_reviewer'].includes(review.reviewerType) || !['good', 'coaching_required', 'safety_escalation'].includes(review.reviewStatus)) return false;
    if (Date.parse(review.evaluatedAt) !== Date.parse(review.createdAt) || !Number.isFinite(Date.parse(review.evaluatedAt))) return false;
    if (!Array.isArray(review.criteria) || review.criteria.length !== VOICE_QUALITY_RUBRIC.length || review.criteria.some(item => {
      if (!item || Object.keys(item).sort().join('|') !== 'confidenceBps|evidenceRefs|id|score' || !RUBRIC_BY_ID.has(item.id) || !Number.isSafeInteger(item.score) || item.score < 0 || item.score > 100 || !Number.isSafeInteger(item.confidenceBps) || item.confidenceBps < 0 || item.confidenceBps > 10000 || !Array.isArray(item.evidenceRefs) || item.evidenceRefs.length < 1 || item.evidenceRefs.length > 5) return true;
      item.evidenceRefs.forEach((evidenceRef, index) => ref(evidenceRef, `evidenceRefs[${index}]`));
      return false;
    })) return false;
    if (new Set(review.criteria.map(item => item.id)).size !== VOICE_QUALITY_RUBRIC.length || review.reviewedReleaseIds.length < 1 || review.reviewedReleaseIds.length > 4) return false;
    review.reviewedReleaseIds.forEach((releaseRef, index) => ref(releaseRef, `reviewedReleaseIds[${index}]`));
    if (review.criticalFailures.some(id => !['policy_compliance', 'ai_disclosure'].includes(id))) return false;
    if (review.coaching.some(item => !item || Object.keys(item).sort().join('|') !== 'code|criterionId|priority' || !RUBRIC_BY_ID.has(item.criterionId) || !Object.values(COACHING).some(value => value.code === item.code) || !['urgent', 'high', 'normal'].includes(item.priority))) return false;
    if (!Number.isSafeInteger(review.agentTransferCount) || review.agentTransferCount < 0 || review.agentTransferCount > 3 || typeof review.humanHandoff !== 'boolean' || typeof review.appointmentBooked !== 'boolean') return false;
    if (review.talkDurationSeconds !== null && (!Number.isSafeInteger(review.talkDurationSeconds) || review.talkDurationSeconds < 0 || review.talkDurationSeconds > 86400)) return false;
    const { checksum, ...body } = review;
    return hash(body) === checksum;
  } catch { return false; }
}

function boundedScore(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) throw new Error(`${name} must be an integer from 0 to 100`);
  return value;
}

function normalizeCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length !== VOICE_QUALITY_RUBRIC.length) throw new Error('Every voice QA rubric criterion must be assessed exactly once');
  const ids = new Set();
  const normalized = criteria.map(item => {
    if (!item || typeof item !== 'object' || !RUBRIC_BY_ID.has(item.id) || ids.has(item.id)) throw new Error('Voice QA criteria must use unique rubric ids');
    ids.add(item.id);
    const score = boundedScore(item.score, `${item.id} score`);
    if (!Number.isSafeInteger(item.confidenceBps) || item.confidenceBps < 0 || item.confidenceBps > 10000) throw new Error(`${item.id} confidenceBps must be from 0 to 10000`);
    if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length < 1 || item.evidenceRefs.length > 5) throw new Error(`${item.id} requires 1-5 structured evidence references`);
    const evidenceRefs = [...new Set(item.evidenceRefs.map((value, index) => ref(value, `${item.id} evidenceRefs[${index}]`)))].sort();
    if (!evidenceRefs.length) throw new Error(`${item.id} requires structured evidence references`);
    return { id: item.id, score, confidenceBps: item.confidenceBps, evidenceRefs };
  });
  if (ids.size !== RUBRIC_BY_ID.size) throw new Error('Voice QA rubric is incomplete');
  return normalized.sort((a, b) => a.id.localeCompare(b.id));
}

function measuredDurationSeconds(session) {
  const firstConnection = session.events.find(event => event.type === 'voice.agent_connected' || event.type === 'voice.human_connected');
  const completed = session.events.findLast(event => event.type === 'voice.call_completed');
  if (!firstConnection || !completed) return null;
  const seconds = Math.ceil((Date.parse(completed.occurredAt) - Date.parse(firstConnection.occurredAt)) / 1000);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86400 ? seconds : null;
}

function verifyQualityEvidence(sourceEvidence, { tenantId, session, reviewRef, evaluatorId, evaluatorVersion, businessIntent, businessIntentEvidenceRef, now }) {
  if (!sourceEvidence || !['voice_qa_runtime', 'authenticated_reviewer'].includes(sourceEvidence.type) || sourceEvidence.authenticated !== true || sourceEvidence.tenantId !== tenantId || sourceEvidence.sessionId !== session.id || sourceEvidence.sessionChecksum !== session.checksum || sourceEvidence.reviewRef !== reviewRef) return false;
  if (sourceEvidence.businessIntent !== businessIntent || sourceEvidence.businessIntentEvidenceRef !== businessIntentEvidenceRef) return false;
  const checkedAt = Date.parse(sourceEvidence.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > now + 60_000 || checkedAt < now - 15 * 60_000) return false;
  try { ref(sourceEvidence.actorRef, 'quality actorRef'); } catch { return false; }
  if (sourceEvidence.type === 'voice_qa_runtime') return sourceEvidence.evaluatorId === evaluatorId && sourceEvidence.evaluatorVersion === evaluatorVersion;
  return sourceEvidence.reviewerRole === 'owner' || sourceEvidence.reviewerRole === 'admin' || sourceEvidence.reviewerRole === 'quality_reviewer';
}

function scoreCriteria(criteria) {
  const weightTotal = VOICE_QUALITY_RUBRIC.reduce((sum, item) => sum + item.weight, 0);
  const weighted = criteria.reduce((sum, item) => sum + item.score * RUBRIC_BY_ID.get(item.id).weight, 0);
  return Math.round(weighted / weightTotal);
}

function coachingFor(criteria) {
  return criteria.flatMap(item => {
    if (item.score >= VOICE_QUALITY_THRESHOLDS.coachBelow) return [];
    const rubric = RUBRIC_BY_ID.get(item.id);
    return [{ criterionId: item.id, code: COACHING[item.id].code, priority: rubric.critical ? 'urgent' : COACHING[item.id].priority }];
  }).sort((a, b) => ['urgent', 'high', 'normal'].indexOf(a.priority) - ['urgent', 'high', 'normal'].indexOf(b.priority) || a.criterionId.localeCompare(b.criterionId));
}

/**
 * Records an evidence-referenced voice review. This contract intentionally accepts no transcript,
 * recording, model prompt, customer message, free-text note, or credential fields.
 */
export function createVoiceCallQualityReview({
  tenantId, session, reviewRef, evaluatorId, evaluatorVersion, businessIntent = 'other', businessIntentEvidenceRef,
  sourceEvidence, criteria, now = Date.now(), reviewId = null
} = {}) {
  const tenant = ref(tenantId, 'tenantId');
  if (!verifyVoiceCallSession(session) || session.tenantId !== tenant || session.status !== 'completed') throw new Error('Voice QA requires an intact, completed call from the same tenant');
  const idempotencyRef = ref(reviewRef, 'reviewRef');
  const evaluator = ref(evaluatorId, 'evaluatorId');
  const version = ref(evaluatorVersion, 'evaluatorVersion');
  if (!VOICE_BUSINESS_INTENTS.includes(businessIntent)) throw new Error('businessIntent must use a supported service-business intent');
  const intentEvidenceRef = ref(businessIntentEvidenceRef, 'businessIntentEvidenceRef');
  const current = time(now, 'now');
  if (!verifyQualityEvidence(sourceEvidence, { tenantId: tenant, session, reviewRef: idempotencyRef, evaluatorId: evaluator, evaluatorVersion: version, businessIntent, businessIntentEvidenceRef: intentEvidenceRef, now: current })) throw new Error('Voice QA requires fresh, authenticated, session-pinned evaluator or reviewer evidence');
  const normalized = normalizeCriteria(criteria);
  const score = scoreCriteria(normalized);
  const criticalFailures = normalized.filter(item => RUBRIC_BY_ID.get(item.id).critical && item.score < VOICE_QUALITY_THRESHOLDS.criticalBelow).map(item => item.id);
  const coaching = coachingFor(normalized);
  const review = {
    id: reviewId == null ? generatedReviewId() : ref(reviewId, 'reviewId'),
    tenantId: tenant,
    reviewRef: idempotencyRef,
    sessionId: session.id,
    sessionChecksum: session.checksum,
    reviewedReleaseIds: [...new Set(session.agentReleaseChain.map(item => ref(item.releaseId, 'agentReleaseId')))].sort(),
    outcome: session.callOutcome,
    businessIntent,
    businessIntentEvidenceRef: intentEvidenceRef,
    talkDurationSeconds: measuredDurationSeconds(session),
    agentTransferCount: session.agentTransferCount,
    humanHandoff: session.events.some(event => event.type === 'voice.human_handoff_requested'),
    appointmentBooked: session.callOutcome === 'appointment_booked' && session.appointmentRef !== null,
    evaluatorId: evaluator,
    evaluatorVersion: version,
    reviewerType: sourceEvidence.type,
    reviewerRef: ref(sourceEvidence.actorRef, 'reviewerRef'),
    evaluatedAt: new Date(current).toISOString(),
    score,
    criticalFailures,
    reviewStatus: criticalFailures.length ? 'safety_escalation' : coaching.length ? 'coaching_required' : 'good',
    criteria: normalized,
    coaching,
    createdAt: new Date(current).toISOString()
  };
  return seal(review);
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function quantile(values, quantileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantileValue * sorted.length) - 1)];
}

/**
 * Build a tenant-scoped, release-specific quality snapshot. Readiness is advisory only;
 * publication and tool authorization remain in the existing server-side agent governance path.
 */
export function summarizeVoiceCallQuality({ tenantId, releaseId, sessions, reviews, minimumSampleCount = VOICE_QUALITY_THRESHOLDS.minimumReleaseSample, now = Date.now() } = {}) {
  const tenant = ref(tenantId, 'tenantId');
  const targetRelease = ref(releaseId, 'releaseId');
  if (!Array.isArray(sessions) || !Array.isArray(reviews)) throw new Error('Voice QA summary requires session and review arrays');
  if (!Number.isSafeInteger(minimumSampleCount) || minimumSampleCount < 5 || minimumSampleCount > 500) throw new Error('minimumSampleCount must be from 5 to 500');
  const validSessions = new Map(sessions.filter(session => verifyVoiceCallSession(session) && session.tenantId === tenant && session.status === 'completed' && session.agentReleaseChain.some(item => item.releaseId === targetRelease)).map(session => [session.id, session]));
  const bySession = new Map();
  let rejectedReviewCount = 0;
  for (const review of reviews) {
    const session = validSessions.get(review?.sessionId);
    if (!session || !verifyVoiceCallQualityReview(review) || review.tenantId !== tenant || review.sessionChecksum !== session.checksum || !review.reviewedReleaseIds.includes(targetRelease)) { rejectedReviewCount++; continue; }
    const prior = bySession.get(session.id);
    if (!prior || Date.parse(review.evaluatedAt) > Date.parse(prior.evaluatedAt)) bySession.set(session.id, review);
  }
  const selected = [...bySession.values()];
  const scores = selected.map(review => review.score);
  const criticalFailures = selected.filter(review => review.criticalFailures.length > 0).length;
  const criticalIssueCount = selected.reduce((sum, review) => sum + review.criticalFailures.length, 0);
  const policyCriticalFailures = selected.filter(review => review.criticalFailures.includes('policy_compliance')).length;
  const disclosureCriticalFailures = selected.filter(review => review.criticalFailures.includes('ai_disclosure')).length;
  const criterionScores = Object.fromEntries(VOICE_QUALITY_RUBRIC.map(rubric => [rubric.id, average(selected.map(review => review.criteria.find(item => item.id === rubric.id)?.score).filter(Number.isSafeInteger))]));
  const sessionsById = new Map([...validSessions].map(([id, session]) => [id, session]));
  const taskCompleted = selected.filter(review => review.criteria.find(item => item.id === 'task_completion')?.score >= VOICE_QUALITY_THRESHOLDS.minimumTaskCompletion).length;
  const bookingAttempts = selected.filter(review => review.businessIntent === 'appointment_booking').length;
  const bookedCount = selected.filter(review => review.businessIntent === 'appointment_booking' && review.appointmentBooked).length;
  const talkDuration = selected.map(review => review.talkDurationSeconds).filter(Number.isSafeInteger);
  const humanHandoffCount = selected.filter(review => review.humanHandoff).length;
  const coachingCount = selected.filter(review => review.coaching.length).length;
  const averageScore = average(scores);
  const sampleCount = selected.length;
  const readinessReasons = [];
  if (sampleCount < minimumSampleCount) readinessReasons.push('minimum_sample_not_met');
  if (averageScore === null || averageScore < VOICE_QUALITY_THRESHOLDS.minimumReleaseScore) readinessReasons.push('quality_score_below_threshold');
  if (policyCriticalFailures) readinessReasons.push('policy_compliance_critical_failures');
  if (disclosureCriticalFailures) readinessReasons.push('disclosure_critical_failures');
  if ((criterionScores.task_completion ?? 0) < VOICE_QUALITY_THRESHOLDS.minimumTaskCompletion) readinessReasons.push('task_completion_below_threshold');
  return freezeDeep({
    tenantId: tenant,
    releaseId: targetRelease,
    sampleCount,
    rejectedReviewCount,
    averageScore,
    passRateBps: sampleCount ? Math.round(selected.filter(review => review.reviewStatus === 'good').length / sampleCount * 10000) : null,
    taskCompletionRateBps: sampleCount ? Math.round(taskCompleted / sampleCount * 10000) : null,
    appointmentConversionBps: bookingAttempts ? Math.round(bookedCount / bookingAttempts * 10000) : null,
    humanHandoffRateBps: sampleCount ? Math.round(humanHandoffCount / sampleCount * 10000) : null,
    p50TalkDurationSeconds: quantile(talkDuration, 0.5),
    p90TalkDurationSeconds: quantile(talkDuration, 0.9),
    coachingRequiredCount: coachingCount,
    criticalFailureCount: criticalFailures,
    criticalIssueCount,
    criticalFailureRateBps: sampleCount ? Math.round(criticalFailures / sampleCount * 10000) : null,
    criterionScores,
    promotionAssessment: { readyForGovernanceReview: readinessReasons.length === 0, reasons: readinessReasons, minimumSampleCount, publicationAuthority: 'existing_agent_governance_required' },
    sessionCount: sessionsById.size,
    generatedAt: new Date(time(now, 'now')).toISOString()
  });
}
