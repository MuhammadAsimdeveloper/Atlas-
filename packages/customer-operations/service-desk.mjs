import crypto from 'node:crypto';
import { requireTenantRole } from '../atlas-core/authority.mjs';
import { addBusinessMinutes, addBusinessMinutesExcludingPauses, businessMinutesBetween, validateSupportBusinessCalendar } from './business-calendar.mjs';

export * from './business-calendar.mjs';

export const SUPPORT_CASE_STATUSES = Object.freeze(['open', 'in_progress', 'waiting_customer', 'waiting_internal', 'resolved', 'closed']);
export const SUPPORT_CASE_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);
export const SUPPORT_CASE_CHANNELS = Object.freeze(['email', 'sms', 'whatsapp', 'facebook', 'instagram', 'webchat', 'voice', 'phone', 'portal', 'api']);
export const SUPPORT_CASE_REASON_CODES = Object.freeze(['agent_uncertain', 'customer_requested_human', 'sentiment_risk', 'policy_block', 'tool_failure', 'sla_risk', 'billing_help', 'appointment_help', 'duplicate_case', 'other']);
export const SUPPORT_CASE_INTAKE_SOURCES = Object.freeze(['manual', 'customer_agent', 'workflow', 'channel']);

const ASSIGNABLE_ROLES = ['owner', 'admin', 'member'];
const STATUS_TRANSITIONS = Object.freeze({
  open: ['in_progress', 'waiting_customer', 'waiting_internal', 'resolved', 'closed'],
  in_progress: ['waiting_customer', 'waiting_internal', 'resolved', 'closed'],
  waiting_customer: ['open', 'in_progress', 'waiting_internal', 'resolved', 'closed'],
  waiting_internal: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'],
  resolved: ['open', 'closed'],
  closed: []
});

function requiredText(value, label, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\r\n\u0000]/.test(value)) throw new Error(`${label} must be bounded single-line text`);
  return value.trim();
}

function optionalRef(value, label) {
  return value == null ? null : requiredText(value, label, 180);
}

function timestamp(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return date.toISOString();
}

function validTenantAuthority(authority, tenantId) {
  return requireTenantRole(authority, tenantId, ASSIGNABLE_ROLES);
}

function trustedCandidate(candidate, tenantId, requiredSkills) {
  if (!candidate || candidate.tenantId !== tenantId || candidate.active !== true || typeof candidate.actorRef !== 'string' || candidate.actorRef.trim() !== candidate.authority?.actorId || !Array.isArray(candidate.skills) || candidate.skills.length > 50) return false;
  try { requireTenantRole(candidate.authority, tenantId, ASSIGNABLE_ROLES); } catch { return false; }
  return requiredSkills.every(skill => candidate.skills.some(value => typeof value === 'string' && value.toLowerCase() === skill));
}

function receiptBody({ tenantId, conversationRef, receiptRef, deliveredAt, deliveryStatus }) {
  return { tenantId, conversationRef, receiptRef, deliveredAt, deliveryStatus };
}

function signReceipt(body, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}

function verifyReceipt(evidence, secret) {
  if (!evidence || typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || evidence.deliveryStatus !== 'delivered') return false;
  let body;
  try {
    body = receiptBody({
      tenantId: requiredText(evidence.tenantId, 'tenantId'), conversationRef: requiredText(evidence.conversationRef, 'conversationRef'),
      receiptRef: requiredText(evidence.receiptRef, 'receiptRef'), deliveredAt: timestamp(evidence.deliveredAt, 'deliveredAt'),
      deliveryStatus: evidence.deliveryStatus
    });
  } catch { return false; }
  const actual = Buffer.from(String(evidence.signature || ''), 'hex');
  const expected = Buffer.from(signReceipt(body, secret), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function eventRecord({ tenantId, caseId, commandId, actorId, type, reasonCode = null, at, metadata = {} }) {
  const key = requiredText(commandId, 'commandId');
  const id = `evt_${crypto.createHash('sha256').update(`${tenantId}\u0000${caseId}\u0000${key}`).digest('hex').slice(0, 32)}`;
  return Object.freeze({ id, tenantId, caseId, commandId: key, actorId, type, reasonCode, at, metadata: Object.freeze(metadata) });
}

function caseCopy(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('caseRecord is required');
  if (!SUPPORT_CASE_STATUSES.includes(record.status) || !SUPPORT_CASE_PRIORITIES.includes(record.priority)) throw new Error('caseRecord status or priority is invalid');
  if (!Array.isArray(record.events) || !Number.isSafeInteger(record.version) || record.version < 1) throw new Error('caseRecord version and events are invalid');
  if (record.duplicateOfRef != null && (typeof record.duplicateOfRef !== 'string' || record.duplicateOfRef === record.id)) throw new Error('caseRecord duplicate link is invalid');
  if ((record.slaCalendarRef == null) !== (record.slaCalendarVersion == null)) throw new Error('caseRecord SLA calendar reference and version must be paired');
  if (record.slaCalendarVersion != null && (!Number.isSafeInteger(record.slaCalendarVersion) || record.slaCalendarVersion < 1)) throw new Error('caseRecord SLA calendar version is invalid');
  return record;
}

function slaPauseIntervals(record, nowMs) {
  const intervals = [];
  let openPause = null;
  for (const event of record.events) {
    if (event?.type !== 'case.status_changed') continue;
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) throw new Error('Case status event timestamp is invalid');
    if (event.metadata?.to === 'waiting_customer') {
      if (openPause != null) throw new Error('Case event history contains nested SLA pauses');
      openPause = at;
    }
    if (event.metadata?.from === 'waiting_customer') {
      if (openPause == null || at < openPause) throw new Error('Case event history has an invalid SLA pause end');
      intervals.push({ startAt: openPause, endAt: at });
      openPause = null;
    }
  }
  if (record.status === 'waiting_customer') {
    const persistedStart = Date.parse(record.slaPauseStartedAt);
    if (openPause == null) {
      if (!Number.isFinite(persistedStart)) throw new Error('Case has no valid SLA pause start');
      openPause = persistedStart;
    }
    if (Number.isFinite(persistedStart) && persistedStart !== openPause) throw new Error('Case SLA pause does not match its event history');
    if (nowMs < openPause) throw new Error('Case SLA pause timestamp is in the future');
    intervals.push({ startAt: openPause, endAt: nowMs });
  } else if (openPause != null) throw new Error('Case event history leaves an SLA pause open');
  return intervals;
}

function hasMatchingCommand(record, commandId, type, expectedMetadata = {}) {
  const existing = record.events.find(event => event.commandId === commandId);
  if (!existing) return false;
  const sameMetadata = Object.entries(expectedMetadata).every(([key, value]) => existing.metadata?.[key] === value);
  if (existing.type !== type || !sameMetadata) throw Object.assign(new Error('Idempotency key was already used for a different support-case command'), { code: 'CASE_IDEMPOTENCY_CONFLICT' });
  return true;
}

function pauseAdjustment(record, nowMs) {
  const accumulated = Number.isSafeInteger(record.slaPausedMs) && record.slaPausedMs >= 0 ? record.slaPausedMs : 0;
  if (record.status !== 'waiting_customer' || !record.slaPauseStartedAt) return accumulated;
  const start = Date.parse(record.slaPauseStartedAt);
  if (!Number.isFinite(start) || nowMs < start) throw new Error('case SLA pause timestamp is invalid');
  return accumulated + nowMs - start;
}

/** Create a tenant-owned support case from trusted server intake. Customer message text is intentionally excluded. */
export function createSupportCase({
  authority, id = `case_${crypto.randomUUID().replaceAll('-', '')}`, tenantId, contactRef = null,
  conversationRef = null, channel, subject, priority = 'normal', firstResponseDueAt = null,
  resolutionDueAt = null, createdAt = new Date().toISOString(), slaPolicyRef = null,
  intakeSource = 'manual', intakeReason = null, slaCalendar = null,
  firstResponseSlaMinutes = null, resolutionSlaMinutes = null
} = {}) {
  validTenantAuthority(authority, tenantId);
  const caseId = requiredText(id, 'case id', 160);
  const caseTenant = requiredText(tenantId, 'tenantId');
  if (!SUPPORT_CASE_CHANNELS.includes(channel)) throw new Error('case channel is unsupported');
  if (!SUPPORT_CASE_PRIORITIES.includes(priority)) throw new Error('case priority is unsupported');
  if (!SUPPORT_CASE_INTAKE_SOURCES.includes(intakeSource)) throw new Error('case intake source is unsupported');
  const sourceReason = intakeReason == null ? null : requiredText(intakeReason, 'intakeReason', 64);
  if (sourceReason && !/^[a-z][a-z0-9_]{1,63}$/.test(sourceReason)) throw new Error('intakeReason must be a safe reason code');
  if (intakeSource === 'customer_agent' && !sourceReason) throw new Error('Agent handoff cases require a reason code');
  const created = timestamp(createdAt, 'createdAt');
  let firstDue = firstResponseDueAt == null ? null : timestamp(firstResponseDueAt, 'firstResponseDueAt');
  let resolveDue = resolutionDueAt == null ? null : timestamp(resolutionDueAt, 'resolutionDueAt');
  let calendarRef = null, calendarVersion = null;
  if (slaCalendar != null) {
    if (firstResponseDueAt != null || resolutionDueAt != null) throw new Error('Use either computed business SLA minutes or explicit SLA deadlines, not both');
    const calendar = validateSupportBusinessCalendar(slaCalendar, caseTenant);
    const responseMinutes = firstResponseSlaMinutes == null ? null : firstResponseSlaMinutes;
    const resolutionMinutes = resolutionSlaMinutes == null ? null : resolutionSlaMinutes;
    if (responseMinutes == null && resolutionMinutes == null) throw new Error('At least one business SLA duration is required with a calendar');
    if (responseMinutes != null) firstDue = addBusinessMinutes({ calendar, startAt: created, minutes: responseMinutes });
    if (resolutionMinutes != null) resolveDue = addBusinessMinutes({ calendar, startAt: created, minutes: resolutionMinutes });
    calendarRef = calendar.id;
    calendarVersion = calendar.version;
  } else if (firstResponseSlaMinutes != null || resolutionSlaMinutes != null) throw new Error('Business SLA durations require a tenant calendar');
  if (firstDue && Date.parse(firstDue) < Date.parse(created) || resolveDue && Date.parse(resolveDue) < Date.parse(created)) throw new Error('SLA deadline cannot precede case creation');
  const event = eventRecord({ tenantId: caseTenant, caseId, commandId: `create:${caseId}`, actorId: authority.actorId, type: 'case.created', at: created, metadata: { channel, priority, intakeSource, intakeReason: sourceReason, slaCalendarRef: calendarRef, slaCalendarVersion: calendarVersion, firstResponseSlaMinutes, resolutionSlaMinutes } });
  return Object.freeze({
    id: caseId, tenantId: caseTenant, contactRef: optionalRef(contactRef, 'contactRef'), conversationRef: optionalRef(conversationRef, 'conversationRef'),
    channel, subject: requiredText(subject, 'subject', 240), priority, status: 'open', assignedToRef: null,
    intakeSource, intakeReason: sourceReason, duplicateOfRef: null,
    firstResponseDueAt: firstDue, resolutionDueAt: resolveDue, firstResponseAt: null, resolvedAt: null,
    slaCalendarRef: calendarRef, slaCalendarVersion: calendarVersion,
    slaPolicyRef: optionalRef(slaPolicyRef, 'slaPolicyRef'), slaPausedMs: 0, slaPauseStartedAt: null,
    version: 1, createdBy: authority.actorId, createdAt: created, updatedAt: created, events: Object.freeze([event])
  });
}

function normalizedSubjectTerms(value) {
  const normalized = requiredText(value, 'subject', 240).toLocaleLowerCase('en-US')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, ' ')
    .replace(/\+?\d[\d(). -]{6,}\d/g, ' ')
    .normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'need', 'help', 'about', 'your', 'you'] );
  return new Set(normalized.split(/\s+/).filter(term => term.length > 2 && !stopWords.has(term)));
}

/** Returns candidates only; duplicate detection never merges or closes a case by itself. */
export function findPotentialDuplicateSupportCases({ authority, caseRecord, candidates = [], now = Date.now(), windowDays = 30, minSimilarity = 0.55 } = {}) {
  const record = caseCopy(caseRecord);
  requireTenantRole(authority, record.tenantId, ['owner', 'admin', 'member', 'viewer']);
  if (!Array.isArray(candidates) || candidates.length > 1000 || !Number.isFinite(now) || !Number.isSafeInteger(windowDays) || windowDays < 1 || windowDays > 365 || !Number.isFinite(minSimilarity) || minSimilarity < 0.4 || minSimilarity > 1) throw new Error('Duplicate search bounds are invalid');
  const currentTerms = normalizedSubjectTerms(record.subject);
  const currentAt = Date.parse(record.createdAt);
  if (!Number.isFinite(currentAt)) throw new Error('Case creation timestamp is invalid');
  const matches = [];
  for (const candidate of candidates) {
    if (!candidate || candidate.id === record.id || candidate.tenantId !== record.tenantId || candidate.status === 'closed') continue;
    const createdAt = Date.parse(candidate.createdAt);
    if (!Number.isFinite(createdAt) || createdAt > now + 60_000 || now - createdAt > windowDays * 86_400_000 || Math.abs(currentAt - createdAt) > windowDays * 86_400_000) continue;
    let similarity = 0;
    try {
      const terms = normalizedSubjectTerms(candidate.subject);
      const union = new Set([...currentTerms, ...terms]);
      similarity = union.size ? [...currentTerms].filter(term => terms.has(term)).length / union.size : 0;
    } catch { continue; }
    const sameConversation = Boolean(record.conversationRef && record.conversationRef === candidate.conversationRef);
    const sameContact = Boolean(record.contactRef && record.contactRef === candidate.contactRef);
    if (!sameConversation && !(sameContact && similarity >= minSimilarity)) continue;
    matches.push({ caseRef: requiredText(candidate.id, 'candidate case id'), confidence: sameConversation ? 'high' : similarity >= 0.82 ? 'high' : 'review', similarity: Math.round(similarity * 1000) / 1000, reasonCodes: sameConversation ? ['same_conversation'] : ['same_contact', 'similar_subject'] });
  }
  matches.sort((a, b) => Number(b.reasonCodes.includes('same_conversation')) - Number(a.reasonCodes.includes('same_conversation')) || b.similarity - a.similarity || a.caseRef.localeCompare(b.caseRef));
  return Object.freeze({ tenantId: record.tenantId, caseId: record.id, candidates: Object.freeze(matches.slice(0, 20).map(item => Object.freeze(item))), status: matches.length ? 'review_required' : 'no_match' });
}

/** A tenant admin explicitly links a duplicate to its canonical case; no history is deleted. */
export function linkDuplicateSupportCase({ caseRecord, duplicateOfCase, authority, tenantId, commandId, expectedVersion, expectedCanonicalVersion, now = new Date().toISOString() } = {}) {
  const record = caseCopy(caseRecord);
  const canonical = caseCopy(duplicateOfCase);
  requireTenantRole(authority, tenantId, ['owner', 'admin']);
  if (record.tenantId !== tenantId || canonical.tenantId !== tenantId) throw new Error('Case tenant scope mismatch');
  const command = requiredText(commandId, 'commandId');
  if (hasMatchingCommand(record, command, 'case.duplicate_linked', { duplicateOfRef: canonical.id })) return record;
  if (record.id === canonical.id || canonical.status === 'closed' || canonical.duplicateOfRef || record.status === 'closed') throw new Error('Duplicate link target must be a separate active canonical case');
  if (expectedVersion !== record.version || expectedCanonicalVersion !== canonical.version) throw Object.assign(new Error('Case changed; refresh before linking a duplicate'), { code: 'CASE_VERSION_CONFLICT' });
  if (!STATUS_TRANSITIONS[record.status].includes('closed')) throw new Error('Duplicate case cannot be closed from its current state');
  const at = timestamp(now, 'now');
  if (Date.parse(at) < Date.parse(record.updatedAt) || Date.parse(at) < Date.parse(canonical.updatedAt)) throw new Error('Case updates must be time ordered');
  const event = eventRecord({ tenantId, caseId: record.id, commandId: command, actorId: authority.actorId, type: 'case.duplicate_linked', reasonCode: 'duplicate_case', at, metadata: { duplicateOfRef: canonical.id, canonicalVersion: canonical.version } });
  return Object.freeze({ ...record, duplicateOfRef: canonical.id, status: 'closed', version: record.version + 1, updatedAt: at, events: Object.freeze([...record.events, event]) });
}

/** Turn a customer-agent human handoff into an idempotent tenant case without copying chat text. */
export function createSupportCaseFromAgentHandoff({ authority, tenantId, handoff, channel = handoff?.channel, id, contactRef = null, conversationRef, subject = 'AI service handoff', priority = 'normal', firstResponseDueAt = null, resolutionDueAt = null, createdAt = new Date().toISOString(), slaPolicyRef = null, slaCalendar = null, firstResponseSlaMinutes = null, resolutionSlaMinutes = null } = {}) {
  if (handoff?.status !== 'handoff' || handoff?.route !== 'human' || typeof handoff.reason !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(handoff.reason)) throw new Error('A bounded customer-agent human handoff result is required');
  if (typeof id !== 'string' || !id.trim()) throw new Error('A deterministic handoff case id is required for replay safety');
  if (handoff.tenantId != null && handoff.tenantId !== tenantId) throw new Error('Handoff tenant scope mismatch');
  if (handoff.conversationId != null && handoff.conversationId !== conversationRef) throw new Error('Handoff conversation scope mismatch');
  return createSupportCase({ authority, tenantId, id, contactRef, conversationRef, channel, subject, priority, firstResponseDueAt, resolutionDueAt, createdAt, slaPolicyRef, slaCalendar, firstResponseSlaMinutes, resolutionSlaMinutes, intakeSource: 'customer_agent', intakeReason: handoff.reason });
}

/** Explicitly records an agent suggestion; it never assigns the case or sends a customer message. */
export function suggestSupportCaseAssignee({ authority, caseRecord, candidates = [], requiredSkills = [], now = Date.now() } = {}) {
  const record = caseCopy(caseRecord);
  requireTenantRole(authority, record.tenantId, ['owner', 'admin', 'member', 'viewer']);
  if (!Array.isArray(candidates) || candidates.length > 500 || !Array.isArray(requiredSkills) || requiredSkills.length > 50) throw new Error('Candidates and required skills must be bounded lists');
  if (!Number.isFinite(now)) throw new Error('now must be a timestamp in milliseconds');
  const needed = [...new Set(requiredSkills.map(skill => requiredText(skill, 'skill', 64).toLowerCase()))].sort();
  const eligible = candidates.filter(candidate => trustedCandidate(candidate, record.tenantId, needed) &&
    Number.isSafeInteger(candidate.openCaseCount) && candidate.openCaseCount >= 0 &&
    Number.isSafeInteger(candidate.capacity) && candidate.capacity > candidate.openCaseCount);
  const ranked = eligible.map(candidate => ({
    actorRef: candidate.actorRef.trim(), openCaseCount: candidate.openCaseCount,
    capacity: candidate.capacity, headroom: candidate.capacity - candidate.openCaseCount,
    reasonCodes: ['skill_match', 'capacity_available']
  })).sort((a, b) => a.openCaseCount - b.openCaseCount || b.headroom - a.headroom || a.actorRef.localeCompare(b.actorRef));
  return Object.freeze({
    tenantId: record.tenantId, caseId: record.id, caseVersion: record.version, suggestedAt: new Date(now).toISOString(),
    status: ranked.length ? 'suggested' : 'no_match', assigneeRef: ranked[0]?.actorRef || null,
    reasonCodes: ranked.length ? ranked[0].reasonCodes : ['no_eligible_candidate'],
    rankedCandidates: Object.freeze(ranked.slice(0, 20).map(item => Object.freeze(item)))
  });
}

/** A human with tenant membership confirms an assignment from the current eligible team snapshot. */
export function assignSupportCase({ caseRecord, authority, tenantId, candidateRef, candidates = [], requiredSkills = [], commandId, expectedVersion, now = new Date().toISOString() } = {}) {
  const record = caseCopy(caseRecord);
  validTenantAuthority(authority, tenantId);
  if (record.tenantId !== tenantId) throw new Error('Case tenant scope mismatch');
  const command = requiredText(commandId, 'commandId');
  const assignee = requiredText(candidateRef, 'candidateRef');
  if (hasMatchingCommand(record, command, 'case.assigned', { assigneeRef: assignee })) return record;
  if (expectedVersion !== record.version) throw Object.assign(new Error('Case was updated; refresh before assigning'), { code: 'CASE_VERSION_CONFLICT' });
  if (!Array.isArray(requiredSkills) || requiredSkills.length > 50) throw new Error('requiredSkills must be a bounded list');
  const needed = requiredSkills.map(skill => requiredText(skill, 'skill', 64).toLowerCase());
  const candidate = candidates.find(item => item?.actorRef === assignee && trustedCandidate(item, tenantId, needed) && Number.isSafeInteger(item.capacity) && Number.isSafeInteger(item.openCaseCount) && item.openCaseCount < item.capacity);
  if (!candidate) throw new Error('Assignee is not an active eligible team member');
  const at = timestamp(now, 'now');
  const event = eventRecord({ tenantId, caseId: record.id, commandId: command, actorId: authority.actorId, type: 'case.assigned', at, metadata: { assigneeRef: assignee } });
  return Object.freeze({ ...record, assignedToRef: assignee, version: record.version + 1, updatedAt: at, events: Object.freeze([...record.events, event]) });
}

export function transitionSupportCase({ caseRecord, authority, tenantId, status, reasonCode = null, commandId, expectedVersion, now = new Date().toISOString() } = {}) {
  const record = caseCopy(caseRecord);
  validTenantAuthority(authority, tenantId);
  if (record.tenantId !== tenantId) throw new Error('Case tenant scope mismatch');
  const command = requiredText(commandId, 'commandId');
  if (hasMatchingCommand(record, command, 'case.status_changed', { to: status, reasonCode })) return record;
  if (expectedVersion !== record.version) throw Object.assign(new Error('Case was updated; refresh before changing status'), { code: 'CASE_VERSION_CONFLICT' });
  if (!SUPPORT_CASE_STATUSES.includes(status) || !STATUS_TRANSITIONS[record.status].includes(status)) throw new Error(`Invalid support case transition ${record.status} -> ${status}`);
  if (reasonCode != null && !SUPPORT_CASE_REASON_CODES.includes(reasonCode)) throw new Error('Support case reason code is invalid');
  const at = timestamp(now, 'now');
  if (Date.parse(at) < Date.parse(record.updatedAt)) throw new Error('Case updates must be time ordered');
  let pausedMs = record.slaPausedMs;
  let pauseStartedAt = record.slaPauseStartedAt;
  if (record.status !== 'waiting_customer' && status === 'waiting_customer') pauseStartedAt = at;
  if (record.status === 'waiting_customer' && status !== 'waiting_customer') {
    const start = Date.parse(record.slaPauseStartedAt);
    if (!Number.isFinite(start) || Date.parse(at) < start) throw new Error('Case SLA pause timestamp is invalid');
    pausedMs += Date.parse(at) - start;
    pauseStartedAt = null;
  }
  const resolvedAt = status === 'resolved' ? at : status === 'open' ? null : record.resolvedAt;
  const event = eventRecord({ tenantId, caseId: record.id, commandId: command, actorId: authority.actorId, type: 'case.status_changed', reasonCode, at, metadata: { from: record.status, to: status } });
  return Object.freeze({ ...record, status, resolvedAt, slaPausedMs: pausedMs, slaPauseStartedAt: pauseStartedAt, version: record.version + 1, updatedAt: at, events: Object.freeze([...record.events, event]) });
}

/** Call only inside a verified provider-receipt adapter; the shared HMAC key remains server-side. */
export function createSupportCaseDeliveryEvidence({ tenantId, conversationRef, receiptRef, deliveredAt, deliveryStatus = 'delivered' } = {}, secret = process.env.ATLAS_CASE_RECEIPT_KEY) {
  if (deliveryStatus !== 'delivered') throw new Error('Only a confirmed delivered receipt can satisfy first-response SLA');
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) throw new Error('A 32-byte ATLAS_CASE_RECEIPT_KEY is required');
  const body = receiptBody({ tenantId: requiredText(tenantId, 'tenantId'), conversationRef: requiredText(conversationRef, 'conversationRef'), receiptRef: requiredText(receiptRef, 'receiptRef'), deliveredAt: timestamp(deliveredAt, 'deliveredAt'), deliveryStatus });
  return Object.freeze({ ...body, signature: signReceipt(body, secret) });
}

/** Records first response only from an HMAC-signed same-tenant provider delivery receipt. */
export function recordSupportCaseFirstResponse({ caseRecord, tenantId, deliveryEvidence, secret = process.env.ATLAS_CASE_RECEIPT_KEY } = {}) {
  const record = caseCopy(caseRecord);
  if (record.tenantId !== tenantId || deliveryEvidence?.tenantId !== tenantId || deliveryEvidence?.conversationRef !== record.conversationRef || !verifyReceipt(deliveryEvidence, secret)) throw new Error('Verified same-tenant delivery evidence is required');
  if (record.firstResponseAt) return record;
  const deliveredAt = timestamp(deliveryEvidence.deliveredAt, 'deliveredAt');
  if (Date.parse(deliveredAt) < Date.parse(record.createdAt)) throw new Error('Response cannot precede case creation');
  const receiptRef = requiredText(deliveryEvidence.receiptRef, 'receiptRef');
  if (record.events.some(event => event.commandId === `delivery_${crypto.createHash('sha256').update(receiptRef).digest('hex').slice(0, 48)}`)) return record;
  const event = eventRecord({ tenantId, caseId: record.id, commandId: `delivery_${crypto.createHash('sha256').update(receiptRef).digest('hex').slice(0, 48)}`, actorId: 'system:delivery', type: 'case.first_response_recorded', at: deliveredAt, metadata: { receiptRef } });
  return Object.freeze({ ...record, firstResponseAt: deliveredAt, version: record.version + 1, updatedAt: deliveredAt, events: Object.freeze([...record.events, event]) });
}

export function assessSupportCaseSla({ caseRecord, now = Date.now(), warningMinutes = 15, calendar = null } = {}) {
  const record = caseCopy(caseRecord);
  if (!Number.isFinite(now) || !Number.isSafeInteger(warningMinutes) || warningMinutes < 0 || warningMinutes > 1440) throw new Error('SLA assessment bounds are invalid');
  let pausedMs = pauseAdjustment(record, now);
  let pauses = null;
  let businessCalendar = null;
  if (record.slaCalendarRef != null) {
    businessCalendar = validateSupportBusinessCalendar(calendar, record.tenantId);
    if (businessCalendar.id !== record.slaCalendarRef || businessCalendar.version !== record.slaCalendarVersion) throw new Error('SLA case must use its pinned tenant calendar revision');
    pauses = slaPauseIntervals(record, now);
    pausedMs = Math.round(pauses.reduce((sum, pause) => sum + (Date.parse(pause.endAt) - Date.parse(pause.startAt)), 0));
  } else if (calendar != null) throw new Error('Case has no pinned business calendar');
  const assess = (dueAt, satisfiedAt, pauseable) => {
    if (!dueAt) return { state: 'not_configured', dueAt: null, remainingMs: null };
    if (satisfiedAt) return { state: 'met', dueAt, remainingMs: null };
    let effectiveDueMs = Date.parse(dueAt) + (pauseable ? pausedMs : 0);
    if (businessCalendar && pauseable) {
      const baseMinutes = businessMinutesBetween({ calendar: businessCalendar, startAt: record.createdAt, endAt: dueAt });
      if (!Number.isSafeInteger(Math.round(baseMinutes)) || Math.abs(baseMinutes - Math.round(baseMinutes)) > 0.000001 || baseMinutes < 1) throw new Error('Pinned SLA deadline does not match its business-calendar duration');
      effectiveDueMs = Date.parse(addBusinessMinutesExcludingPauses({ calendar: businessCalendar, startAt: record.createdAt, minutes: Math.round(baseMinutes), pauses }));
    }
    if (!Number.isFinite(effectiveDueMs)) throw new Error('SLA deadline is invalid');
    const remainingMs = effectiveDueMs - now;
    return { state: remainingMs < 0 ? 'breached' : remainingMs <= warningMinutes * 60_000 ? 'at_risk' : 'on_track', dueAt: new Date(effectiveDueMs).toISOString(), remainingMs };
  };
  return Object.freeze({ tenantId: record.tenantId, caseId: record.id, assessedAt: new Date(now).toISOString(), firstResponse: assess(record.firstResponseDueAt, record.firstResponseAt, true), resolution: assess(record.resolutionDueAt, record.resolvedAt || (record.status === 'closed' ? record.updatedAt : null), true), slaPausedMs: pausedMs, slaPausedBusinessMinutes: businessCalendar ? pauses.reduce((sum, pause) => sum + businessMinutesBetween({ calendar: businessCalendar, startAt: pause.startAt, endAt: pause.endAt }), 0) : null, slaCalendarRef: record.slaCalendarRef ?? null, slaCalendarVersion: record.slaCalendarVersion ?? null });
}
