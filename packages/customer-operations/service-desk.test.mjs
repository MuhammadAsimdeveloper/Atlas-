import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtlasAuthority } from '../atlas-core/authority.mjs';
import {
  createSupportCase, createSupportCaseFromAgentHandoff, suggestSupportCaseAssignee, assignSupportCase, transitionSupportCase,
  findPotentialDuplicateSupportCases, linkDuplicateSupportCase,
  createSupportCaseDeliveryEvidence, recordSupportCaseFirstResponse, assessSupportCaseSla
} from './service-desk.mjs';

const tenantId = 'tenant-help';
const admin = resolveAtlasAuthority({
  actor: { id: 'admin-help', authenticated: true }, tenantId,
  memberships: [{ id: 'membership-help', actorId: 'admin-help', tenantId, role: 'admin', status: 'active' }],
  ownerEmail: 'khan@example.test'
});
const other = resolveAtlasAuthority({
  actor: { id: 'admin-other', authenticated: true }, tenantId: 'tenant-other',
  memberships: [{ id: 'membership-other', actorId: 'admin-other', tenantId: 'tenant-other', role: 'admin', status: 'active' }],
  ownerEmail: 'khan@example.test'
});
const memberAuthority = (actorId, tenant = tenantId) => resolveAtlasAuthority({
  actor: { id: actorId, authenticated: true }, tenantId: tenant,
  memberships: [{ id: `membership-${actorId}`, actorId, tenantId: tenant, role: 'member', status: 'active' }],
  ownerEmail: 'khan@example.test'
});
const baseCase = () => createSupportCase({
  authority: admin, id: 'case-1', tenantId, contactRef: 'contact-1', conversationRef: 'thread-1',
  channel: 'webchat', subject: 'Appointment change', firstResponseDueAt: '2026-10-02T10:30:00.000Z',
  resolutionDueAt: '2026-10-02T12:00:00.000Z', createdAt: '2026-10-02T10:00:00.000Z', slaPolicyRef: 'standard'
});

test('support case intake is tenant-scoped, versioned and excludes customer message text', () => {
  const supportCase = baseCase();
  assert.equal(supportCase.status, 'open');
  assert.equal(supportCase.tenantId, tenantId);
  assert.equal(supportCase.version, 1);
  assert.equal(Object.hasOwn(supportCase, 'body'), false);
  assert.equal(supportCase.events[0].type, 'case.created');
  assert.throws(() => createSupportCase({ authority: admin, tenantId: 'tenant-other', channel: 'webchat', subject: 'wrong scope' }), /Tenant membership/);
  assert.throws(() => createSupportCase({ authority: other, tenantId, channel: 'webchat', subject: 'wrong scope' }), /Tenant membership/);
});

test('customer-agent human handoff opens a references-only case with stable intake identity', () => {
  const handoff = { status: 'handoff', route: 'human', channel: 'whatsapp', reason: 'customer_requested_human', tenantId, conversationId: 'thread-1' };
  const opened = createSupportCaseFromAgentHandoff({
    authority: admin, tenantId, handoff, id: 'case-handoff-message-1', contactRef: 'contact-1', conversationRef: 'thread-1',
    firstResponseDueAt: '2026-10-02T10:30:00.000Z', resolutionDueAt: '2026-10-02T12:00:00.000Z', createdAt: '2026-10-02T10:00:00.000Z'
  });
  assert.equal(opened.intakeSource, 'customer_agent');
  assert.equal(opened.intakeReason, 'customer_requested_human');
  assert.equal(opened.channel, 'whatsapp');
  assert.throws(() => createSupportCaseFromAgentHandoff({ authority: admin, tenantId, handoff: { ...handoff, route: 'agent' }, id: 'case-no-human' }), /human handoff/);
  assert.throws(() => createSupportCaseFromAgentHandoff({ authority: admin, tenantId, handoff, id: 'case-wrong-conversation', conversationRef: 'thread-other' }), /conversation scope/);
  assert.throws(() => createSupportCaseFromAgentHandoff({ authority: other, tenantId, handoff, id: 'case-other-tenant', conversationRef: 'thread-1' }), /Tenant membership/);
  assert.throws(() => createSupportCaseFromAgentHandoff({ authority: admin, tenantId, handoff }), /deterministic handoff case id/);
});

test('duplicate detection only returns scoped recent candidates and never merges automatically', () => {
  const supportCase = baseCase();
  const candidates = [
    { id: 'case-same-thread', tenantId, status: 'in_progress', contactRef: 'contact-1', conversationRef: 'thread-1', subject: 'Different text', createdAt: '2026-10-02T09:55:00.000Z' },
    { id: 'case-similar', tenantId, status: 'open', contactRef: 'contact-1', conversationRef: 'thread-old', subject: 'Appointment schedule change', createdAt: '2026-10-02T09:54:00.000Z' },
    { id: 'case-wrong-tenant', tenantId: 'tenant-other', status: 'open', contactRef: 'contact-1', conversationRef: 'thread-1', subject: 'Appointment change', createdAt: '2026-10-02T09:53:00.000Z' },
    { id: 'case-closed', tenantId, status: 'closed', contactRef: 'contact-1', conversationRef: 'thread-1', subject: 'Appointment change', createdAt: '2026-10-02T09:52:00.000Z' },
    { id: 'case-old', tenantId, status: 'open', contactRef: 'contact-1', conversationRef: 'thread-old', subject: 'Appointment change', createdAt: '2026-08-01T09:52:00.000Z' }
  ];
  const result = findPotentialDuplicateSupportCases({ authority: admin, caseRecord: supportCase, candidates, now: Date.parse('2026-10-02T10:00:00.000Z') });
  assert.deepEqual(result.candidates.map(row => row.caseRef), ['case-same-thread', 'case-similar']);
  assert.equal(result.status, 'review_required');
  assert.equal(supportCase.status, 'open');
  assert.ok(result.candidates.every(row => !Object.hasOwn(row, 'subject')));
  assert.throws(() => findPotentialDuplicateSupportCases({ authority: other, caseRecord: supportCase, candidates }), /Tenant membership/);
});

test('duplicate linking requires authorized human confirmation, same tenant, current versions and an audit event', () => {
  const duplicate = createSupportCase({ authority: admin, id: 'case-dup', tenantId, contactRef: 'contact-1', channel: 'webchat', subject: 'Appointment changed', createdAt: '2026-10-02T10:00:00.000Z' });
  const canonical = createSupportCase({ authority: admin, id: 'case-main', tenantId, contactRef: 'contact-1', channel: 'webchat', subject: 'Appointment change', createdAt: '2026-10-02T09:55:00.000Z' });
  const linked = linkDuplicateSupportCase({ caseRecord: duplicate, duplicateOfCase: canonical, authority: admin, tenantId, commandId: 'merge-review-1', expectedVersion: 1, expectedCanonicalVersion: 1, now: '2026-10-02T10:05:00.000Z' });
  assert.equal(linked.status, 'closed');
  assert.equal(linked.duplicateOfRef, canonical.id);
  assert.equal(linked.events.at(-1).type, 'case.duplicate_linked');
  assert.equal(linkDuplicateSupportCase({ caseRecord: linked, duplicateOfCase: canonical, authority: admin, tenantId, commandId: 'merge-review-1', expectedVersion: 1, expectedCanonicalVersion: 1 }).version, 2);
  assert.throws(() => linkDuplicateSupportCase({ caseRecord: duplicate, duplicateOfCase: canonical, authority: admin, tenantId, commandId: 'merge-review-2', expectedVersion: 2, expectedCanonicalVersion: 1 }), error => error.code === 'CASE_VERSION_CONFLICT');
  assert.throws(() => linkDuplicateSupportCase({ caseRecord: duplicate, duplicateOfCase: canonical, authority: other, tenantId, commandId: 'merge-review-3', expectedVersion: 1, expectedCanonicalVersion: 1 }), /Tenant membership/);
  assert.throws(() => linkDuplicateSupportCase({ caseRecord: duplicate, duplicateOfCase: duplicate, authority: admin, tenantId, commandId: 'merge-review-4', expectedVersion: 1, expectedCanonicalVersion: 1 }), /separate active/);
});

test('skill and capacity ranking is deterministic; a suggestion does not assign the case', () => {
  const supportCase = baseCase();
  const rep1 = memberAuthority('rep-1');
  const rep2 = memberAuthority('rep-2');
  const repWrongTenant = memberAuthority('wrong-tenant', 'tenant-other');
  const candidates = [
    { authority: rep1, tenantId, actorRef: 'rep-1', active: true, skills: ['appointments', 'billing'], openCaseCount: 7, capacity: 10 },
    { authority: rep2, tenantId, actorRef: 'rep-2', active: true, skills: ['appointments'], openCaseCount: 2, capacity: 5 },
    { authority: repWrongTenant, tenantId: 'tenant-other', actorRef: 'wrong-tenant', active: true, skills: ['appointments'], openCaseCount: 0, capacity: 5 },
    { authority: memberAuthority('full'), tenantId, actorRef: 'full', active: true, skills: ['appointments'], openCaseCount: 5, capacity: 5 }
  ];
  const suggestion = suggestSupportCaseAssignee({ authority: admin, caseRecord: supportCase, candidates, requiredSkills: ['appointments'], now: Date.parse('2026-10-02T10:05:00.000Z') });
  assert.equal(suggestion.status, 'suggested');
  assert.equal(suggestion.assigneeRef, 'rep-2');
  assert.equal(supportCase.assignedToRef, null);
  assert.deepEqual(suggestion.rankedCandidates.map(item => item.actorRef), ['rep-2', 'rep-1']);
});

test('assignment requires fresh version, eligible tenant candidate and idempotent command identity', () => {
  const supportCase = baseCase();
  const candidates = [{ authority: memberAuthority('rep-1'), tenantId, actorRef: 'rep-1', active: true, skills: ['appointments'], openCaseCount: 1, capacity: 5 }];
  const assigned = assignSupportCase({ caseRecord: supportCase, authority: admin, tenantId, candidateRef: 'rep-1', candidates, requiredSkills: ['appointments'], commandId: 'assign-cmd-1', expectedVersion: 1, now: '2026-10-02T10:02:00.000Z' });
  assert.equal(assigned.assignedToRef, 'rep-1');
  assert.equal(assigned.version, 2);
  assert.equal(assignSupportCase({ caseRecord: assigned, authority: admin, tenantId, candidateRef: 'rep-1', candidates, requiredSkills: ['appointments'], commandId: 'assign-cmd-1', expectedVersion: 1 }).version, 2);
  assert.throws(() => assignSupportCase({ caseRecord: supportCase, authority: admin, tenantId, candidateRef: 'rep-1', candidates, requiredSkills: ['billing'], commandId: 'assign-cmd-2', expectedVersion: 1 }), /eligible/);
  assert.throws(() => assignSupportCase({ caseRecord: supportCase, authority: other, tenantId, candidateRef: 'rep-1', candidates, commandId: 'assign-cmd-3', expectedVersion: 1 }), /Tenant membership/);
});

test('status changes enforce allowed transitions, reason codes, optimistic version and pause customer-wait SLA time', () => {
  const opened = baseCase();
  const waiting = transitionSupportCase({ caseRecord: opened, authority: admin, tenantId, status: 'waiting_customer', reasonCode: 'appointment_help', commandId: 'status-cmd-1', expectedVersion: 1, now: '2026-10-02T10:05:00.000Z' });
  assert.equal(waiting.slaPauseStartedAt, '2026-10-02T10:05:00.000Z');
  const whileWaiting = assessSupportCaseSla({ caseRecord: waiting, now: Date.parse('2026-10-02T10:10:00.000Z'), warningMinutes: 5 });
  assert.equal(whileWaiting.firstResponse.dueAt, '2026-10-02T10:35:00.000Z');
  const resumed = transitionSupportCase({ caseRecord: waiting, authority: admin, tenantId, status: 'in_progress', reasonCode: 'other', commandId: 'status-cmd-2', expectedVersion: 2, now: '2026-10-02T10:20:00.000Z' });
  assert.equal(resumed.slaPausedMs, 15 * 60_000);
  const afterWait = assessSupportCaseSla({ caseRecord: resumed, now: Date.parse('2026-10-02T10:25:00.000Z'), warningMinutes: 5 });
  assert.equal(afterWait.firstResponse.dueAt, '2026-10-02T10:45:00.000Z');
  assert.throws(() => transitionSupportCase({ caseRecord: resumed, authority: admin, tenantId, status: 'closed', commandId: 'status-cmd-3', expectedVersion: 2 }), error => error.code === 'CASE_VERSION_CONFLICT');
  assert.throws(() => transitionSupportCase({ caseRecord: resumed, authority: admin, tenantId, status: 'resolved', reasonCode: 'invented', commandId: 'status-cmd-4', expectedVersion: 3 }), /reason code/);
  assert.throws(() => transitionSupportCase({ caseRecord: resumed, authority: other, tenantId, status: 'resolved', commandId: 'status-cmd-5', expectedVersion: 3 }), /Tenant membership/);
});

test('verified delivery receipt records first response once and SLA reporting distinguishes on-track, at-risk and breached', () => {
  const supportCase = baseCase();
  const early = assessSupportCaseSla({ caseRecord: supportCase, now: Date.parse('2026-10-02T10:10:00.000Z'), warningMinutes: 15 });
  assert.equal(early.firstResponse.state, 'on_track');
  const receiptSecret = 'atlas-case-receipt-test-secret-32bytes-minimum';
  const evidence = createSupportCaseDeliveryEvidence({ tenantId, conversationRef: 'thread-1', receiptRef: 'receipt-1', deliveryStatus: 'delivered', deliveredAt: '2026-10-02T10:12:00.000Z' }, receiptSecret);
  const responded = recordSupportCaseFirstResponse({ caseRecord: supportCase, tenantId, deliveryEvidence: evidence, secret: receiptSecret });
  assert.equal(responded.firstResponseAt, evidence.deliveredAt);
  assert.equal(recordSupportCaseFirstResponse({ caseRecord: responded, tenantId, deliveryEvidence: evidence, secret: receiptSecret }).version, responded.version);
  assert.throws(() => createSupportCaseDeliveryEvidence({ tenantId, conversationRef: 'thread-1', receiptRef: 'receipt-2', deliveryStatus: 'provider_accepted', deliveredAt: '2026-10-02T10:12:00.000Z' }, receiptSecret), /confirmed delivered/);
  assert.throws(() => recordSupportCaseFirstResponse({ caseRecord: supportCase, tenantId, deliveryEvidence: { ...evidence, tenantId: 'tenant-other' }, secret: receiptSecret }), /Verified same-tenant/);
  assert.throws(() => recordSupportCaseFirstResponse({ caseRecord: supportCase, tenantId, deliveryEvidence: { ...evidence, signature: '0'.repeat(64) }, secret: receiptSecret }), /Verified same-tenant/);
  const risky = assessSupportCaseSla({ caseRecord: supportCase, now: Date.parse('2026-10-02T10:20:00.000Z'), warningMinutes: 15 });
  assert.equal(risky.firstResponse.state, 'at_risk');
  const breached = assessSupportCaseSla({ caseRecord: supportCase, now: Date.parse('2026-10-02T10:31:00.000Z') });
  assert.equal(breached.firstResponse.state, 'breached');
  assert.equal(breached.resolution.state, 'on_track');
});

test('a replayed command cannot be reused to request a different case mutation', () => {
  const opened = baseCase();
  const waiting = transitionSupportCase({ caseRecord: opened, authority: admin, tenantId, status: 'waiting_customer', reasonCode: 'appointment_help', commandId: 'same-key', expectedVersion: 1 });
  assert.throws(() => transitionSupportCase({ caseRecord: waiting, authority: admin, tenantId, status: 'resolved', reasonCode: 'appointment_help', commandId: 'same-key', expectedVersion: 2 }), error => error.code === 'CASE_IDEMPOTENCY_CONFLICT');
});
