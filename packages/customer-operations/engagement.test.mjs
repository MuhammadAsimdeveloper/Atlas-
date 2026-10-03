import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtlasAuthority } from '../atlas-core/authority.mjs';
import { createAgentDeployment, publishAgentDeployment } from './index.mjs';
import {
  AUTOMATION_TRIGGERS, BUSINESS_AUTOMATION_RECIPES, createAutomationWorkflowDraft,
  publishAutomationWorkflow, verifyAutomationRelease, createAutomationEnrollment,
  createMessageTemplateVersion, verifyMessageTemplateVersion,
  claimAutomationEnrollment, planAutomationStep, resumeAutomationReply,
  advanceAutomationReplyTimeout, resumeAutomationDelivery, resumeAutomationTask, resumeAutomationSubworkflow, resumeAutomationAgent,
  resumeAutomationContactAction,
  createOutboundMessageIntent, authorizeOutboundMessageAttempt,
  recordProviderAttempt, createProviderReceipt, applyProviderReceipt
} from './engagement.mjs';

const now = Date.parse('2026-10-01T12:00:00.000Z');
const tenantId = 'tenant-a';
const contactId = 'contact-123';
const authority = resolveAtlasAuthority({
  actor: { id: 'owner-1', authenticated: true, email: 'owner@example.test', emailVerified: true },
  tenantId, memberships: [{ id: 'membership-1', actorId: 'owner-1', tenantId, role: 'owner', status: 'active' }],
  ownerEmail: 'khan@example.test'
});
const tenantBAuthority = resolveAtlasAuthority({
  actor: { id: 'owner-b', authenticated: true, email: 'owner-b@example.test', emailVerified: true },
  tenantId: 'tenant-b', memberships: [{ id: 'membership-b', actorId: 'owner-b', tenantId: 'tenant-b', role: 'owner', status: 'active' }],
  ownerEmail: 'khan@example.test'
});
const platformOwnerAuthority = resolveAtlasAuthority({
  actor: { id: 'khan', authenticated: true, email: 'khan@example.test', emailVerified: true },
  ownerEmail: 'khan@example.test'
});

const emailWorkflow = () => createAutomationWorkflowDraft({
  id: 'appointments', tenantId, name: 'Appointment reminders', triggerType: 'appointment.booked',
  steps: [
    { id: 'day-before', type: 'wait_until', anchor: 'event', offsetMs: -86400000 },
    { id: 'email-reminder', type: 'send_message', channel: 'email', purpose: 'appointment', templateRef: { id: 'appointment-email', version: 2 }, connectionRef: 'mail-connection' },
    { id: 'wait-for-reply', type: 'await_reply', timeoutMs: 3600000, replyStepId: 'reply-task', timeoutStepId: 'no-reply-task' },
    { id: 'reply-task', type: 'create_task', taskTemplateRef: { id: 'confirm-attendance', version: 1 }, dueInMs: 0, assignedToRef: 'owner-1' },
    { id: 'no-reply-task', type: 'create_task', taskTemplateRef: { id: 'confirm-attendance', version: 1 }, dueInMs: 0, assignedToRef: 'owner-1' }
  ]
});

const emailTemplate = (overrides = {}) => createMessageTemplateVersion({
  tenantId, id: 'appointment-email', version: 2, channel: 'email', purpose: 'appointment',
  subjectTemplate: 'Your appointment is coming up',
  bodyTemplate: 'Hello {{contact.first_name}}, your appointment is scheduled for {{appointment.start_time}}.',
  publisherAuthority: authority, now, ...overrides
});

const workflowRelease = () => publishAutomationWorkflow({ draft: emailWorkflow(), publisherAuthority: authority, templateDependencies: [emailTemplate()], now, releaseId: 'appointments-v1' });

const policy = (channel = 'email', purpose = 'appointment', overrides = {}) => {
  const { checkedAt: rawCheckedAt, ...policyOverrides } = overrides;
  const checkedAt = rawCheckedAt == null ? now : typeof rawCheckedAt === 'number' ? rawCheckedAt : Date.parse(rawCheckedAt);
  return ({
  decisionId: 'policy-decision-1', policyVersion: 'policy-v1', tenantId, contactId,
  channel, purpose, eligible: true, checkedAt: new Date(checkedAt).toISOString(),
  expiresAt: new Date(checkedAt + 10 * 60_000).toISOString(), sendWindow: { mode: 'anytime' },
  ...policyOverrides
  });
};
const suppression = (channel = 'email', overrides = {}) => {
  const { checkedAt: rawCheckedAt, ...suppressionOverrides } = overrides;
  const checkedAt = rawCheckedAt == null ? now : typeof rawCheckedAt === 'number' ? rawCheckedAt : Date.parse(rawCheckedAt);
  return { tenantId, contactId, channel, blocked: false, revision: 'suppression-v1', ...suppressionOverrides, checkedAt: new Date(checkedAt).toISOString() };
};
const frequency = (channel = 'email', overrides = {}) => {
  const { checkedAt: rawCheckedAt, ...frequencyOverrides } = overrides;
  const checkedAt = rawCheckedAt == null ? now : typeof rawCheckedAt === 'number' ? rawCheckedAt : Date.parse(rawCheckedAt);
  return ({
  tenantId, contactId, channel, allowed: true, windowId: 'frequency-hour-1', count: 0, limit: 5,
  ...frequencyOverrides, checkedAt: new Date(checkedAt).toISOString()
  });
};
const consent = (channel = 'email', purpose = 'appointment', overrides = {}) => {
  const { checkedAt: rawCheckedAt, ...consentOverrides } = overrides;
  const checkedAt = rawCheckedAt == null ? now : typeof rawCheckedAt === 'number' ? rawCheckedAt : Date.parse(rawCheckedAt);
  return {
    tenantId, contactId, channel, purpose, eligible: true,
    basis: purpose === 'marketing' ? 'explicit_consent' : 'service_request',
    revision: 'consent-v1', ...consentOverrides,
    checkedAt: new Date(checkedAt).toISOString(), expiresAt: new Date(checkedAt + 10 * 60_000).toISOString()
  };
};
const deliveryContext = (channel = 'email', purpose = 'appointment', overrides = {}) => {
  const checkedAt = overrides.checkedAt == null ? now : overrides.checkedAt;
  return {
    policyDecision: Object.hasOwn(overrides, 'policyDecision') ? overrides.policyDecision : policy(channel, purpose, { checkedAt }),
    consentSnapshot: Object.hasOwn(overrides, 'consentSnapshot') ? overrides.consentSnapshot : consent(channel, purpose, { checkedAt }),
    suppressionSnapshot: Object.hasOwn(overrides, 'suppressionSnapshot') ? overrides.suppressionSnapshot : suppression(channel, { checkedAt }),
    frequencySnapshot: Object.hasOwn(overrides, 'frequencySnapshot') ? overrides.frequencySnapshot : frequency(channel, { checkedAt })
  };
};

function appointmentEnrollment(release = workflowRelease(), anchorAt = now + 2 * 86400000) {
  return createAutomationEnrollment({
    release, now,
    event: { id: 'appointment-event-1', tenantId, type: 'appointment.booked', occurredAt: new Date(now).toISOString(), anchorAt: new Date(anchorAt).toISOString(), conversationRef: 'conversation-1' },
    contact: { id: contactId, tenantId }, id: 'enrollment-1'
  });
}

test('workflow trigger catalog covers common CRM, appointment, payment, inbox and AI outcomes', () => {
  for (const trigger of ['contact.created', 'form.submitted', 'appointment.booked', 'appointment.no_show', 'payment.failed', 'message.received', 'email.unsubscribed', 'conversation.handed_off', 'agent.resolved']) assert.ok(AUTOMATION_TRIGGERS.includes(trigger));
  assert.equal(BUSINESS_AUTOMATION_RECIPES.length, 11);
  assert.ok(BUSINESS_AUTOMATION_RECIPES.some(recipe => recipe.id === 'appointment-reminders'));
  for (const recipe of BUSINESS_AUTOMATION_RECIPES) {
    assert.ok(AUTOMATION_TRIGGERS.includes(recipe.triggerType), `${recipe.id} has an unknown trigger`);
    assert.ok(recipe.category);
    assert.ok(recipe.channels.length);
  }
  for (const trigger of ['opportunity.stage_changed', 'call.missed', 'course.lesson_completed', 'invoice.overdue', 'store.checkout_abandoned', 'social.instagram_comment', 'consent.revoked']) assert.ok(AUTOMATION_TRIGGERS.includes(trigger));
  assert.throws(() => createAutomationWorkflowDraft({ id: 'x', tenantId, name: 'Bad', triggerType: 'incoming_message', steps: [{ id: 'email', type: 'send_message', channel: 'email', purpose: 'support', templateRef: { id: 't', version: 1 }, connectionRef: 'mail' }] }), /Unsupported automation trigger/);
  assert.throws(() => createAutomationWorkflowDraft({ id: 'x', tenantId, name: 'Bad', triggerType: 'contact.created', steps: [{ id: 'loop', type: 'await_reply', timeoutMs: 60000, replyStepId: 'missing', timeoutStepId: 'missing' }] }), /Reply and timeout branches/);
});

test('workflow releases are tenant-admin published, immutable, integrity checked and version pinned', () => {
  const release = workflowRelease();
  assert.equal(release.status, 'published');
  assert.equal(release.version, 1);
  assert.equal(verifyAutomationRelease(release), true);
  assert.equal(release.templateDependencies[0].checksum, emailTemplate().checksum);
  assert.equal(verifyAutomationRelease({ ...release, publishedBy: 'intruder' }), false);
  assert.throws(() => { release.steps[0].offsetMs = -60000; }, TypeError);
  const forged = { actorId: 'attacker', authenticated: true, globalRole: 'platform_owner' };
  assert.throws(() => publishAutomationWorkflow({ draft: emailWorkflow(), publisherAuthority: forged, now }), /platform-owner access required/i);
});

test('message templates are tenant-owned immutable versions pinned to workflow channel and purpose', () => {
  const template = emailTemplate();
  assert.equal(verifyMessageTemplateVersion(template), true);
  assert.equal(template.status, 'published');
  assert.throws(() => { template.bodyTemplate = 'tampered'; }, TypeError);
  assert.equal(verifyMessageTemplateVersion({ ...template, bodyTemplate: 'tampered' }), false);
  assert.throws(() => createMessageTemplateVersion({ tenantId: 'tenant-b', id: 'other', version: 1, channel: 'email', purpose: 'appointment', subjectTemplate: 'Hi', bodyTemplate: 'Hello', publisherAuthority: authority, now }), /Tenant membership/);
  const ownerTemplate = createMessageTemplateVersion({ tenantId: 'tenant-b', id: 'owner-managed', version: 1, channel: 'email', purpose: 'appointment', subjectTemplate: 'Hi', bodyTemplate: 'Hello', publisherAuthority: platformOwnerAuthority, now });
  assert.equal(verifyMessageTemplateVersion(ownerTemplate), true);
  assert.throws(() => createMessageTemplateVersion({ tenantId, id: 'bad', version: 1, channel: 'email', purpose: 'appointment', subjectTemplate: 'Hi', bodyTemplate: 'Use {{contact.api_key}}', publisherAuthority: authority, now }), /credential or sensitive-payment/);
  const draft = emailWorkflow();
  assert.throws(() => publishAutomationWorkflow({ draft, publisherAuthority: authority, now }), /template appointment-email@2 is missing/);
  assert.throws(() => publishAutomationWorkflow({ draft, publisherAuthority: authority, templateDependencies: [emailTemplate({ channel: 'sms' })], now }), /does not match the channel and purpose/);
  assert.throws(() => publishAutomationWorkflow({ draft, publisherAuthority: authority, templateDependencies: [emailTemplate({ tenantId: 'tenant-b', publisherAuthority: tenantBAuthority })], now }), /same tenant/);
});

test('sub-workflows use pinned tenant releases, bounded inputs, and deterministic child enrollment', () => {
  const childDraft = createAutomationWorkflowDraft({ id: 'child-follow-up', tenantId, name: 'Reusable follow-up', triggerType: 'workflow.called', steps: [{ id: 'owner-task', type: 'create_task', taskTemplateRef: { id: 'follow-up', version: 1 } }] });
  const childRelease = publishAutomationWorkflow({ draft: childDraft, publisherAuthority: authority, now, releaseId: 'child-follow-up-v1' });
  const parentDraft = createAutomationWorkflowDraft({ id: 'parent-onboarding', tenantId, name: 'Lead onboarding', triggerType: 'contact.created', steps: [{ id: 'call-reusable', type: 'call_workflow', workflowRef: { id: childRelease.id, version: childRelease.version }, inputMap: { originalContact: 'contactRef' } }] });
  const parentRelease = publishAutomationWorkflow({ draft: parentDraft, publisherAuthority: authority, workflowDependencies: [childRelease], now, releaseId: 'parent-onboarding-v1' });
  const enrollment = createAutomationEnrollment({ release: parentRelease, now, event: { id: 'new-lead', tenantId, type: 'contact.created', occurredAt: new Date(now).toISOString() }, contact: { id: contactId, tenantId } });
  const invocation = planAutomationStep({ release: parentRelease, enrollment, now });
  assert.equal(invocation.status, 'waiting_action');
  assert.equal(invocation.action.type, 'enqueue_subworkflow');
  assert.equal(invocation.action.childEnrollment.triggerInputs.originalContact, contactId);
  assert.equal(invocation.action.childEnrollment.parentEnrollmentId, enrollment.id);
  assert.equal(invocation.action.workflowReleaseId, childRelease.releaseId);
  assert.throws(() => resumeAutomationTask({ enrollment: invocation.enrollment, tenantId, idempotencyKey: invocation.action.idempotencyKey, succeeded: true, now }), /does not match/);
  const parentResumed = resumeAutomationSubworkflow({ enrollment: invocation.enrollment, childEnrollment: { ...invocation.action.childEnrollment, status: 'completed' }, tenantId, idempotencyKey: invocation.action.idempotencyKey, now });
  assert.equal(parentResumed.resumed, true);
  const tampered = { ...childRelease, tenantId: 'tenant-b' };
  assert.throws(() => publishAutomationWorkflow({ draft: parentDraft, publisherAuthority: authority, workflowDependencies: [tampered], now }), /valid published/);
  const missingInputDraft = createAutomationWorkflowDraft({ id: 'parent-needs-conversation', tenantId, name: 'Conversation required', triggerType: 'contact.created', steps: [{ id: 'call-reusable', type: 'call_workflow', workflowRef: { id: childRelease.id, version: childRelease.version }, inputMap: { thread: 'conversationRef' } }] });
  const missingInputRelease = publishAutomationWorkflow({ draft: missingInputDraft, publisherAuthority: authority, workflowDependencies: [childRelease], now });
  const noConversation = createAutomationEnrollment({ release: missingInputRelease, now, event: { id: 'new-lead-no-thread', tenantId, type: 'contact.created', occurredAt: new Date(now).toISOString() }, contact: { id: contactId, tenantId } });
  assert.equal(planAutomationStep({ release: missingInputRelease, enrollment: noConversation, now }).enrollment.lastReason, 'subworkflow_input_unavailable');
});

test('workflow branches are forward-only and route safely on event and agent outcomes', () => {
  const draft = createAutomationWorkflowDraft({ id: 'lead-routing', tenantId, name: 'Lead routing', triggerType: 'contact.created', steps: [
    { id: 'segment-check', type: 'branch', source: 'triggerInput.segment', operator: 'equals', value: 'vip', thenStepId: 'vip-task', elseStepId: 'standard-task' },
    { id: 'vip-task', type: 'create_task', taskTemplateRef: { id: 'vip-follow-up', version: 1 } },
    { id: 'standard-task', type: 'create_task', taskTemplateRef: { id: 'standard-follow-up', version: 1 } }
  ] });
  const release = publishAutomationWorkflow({ draft, publisherAuthority: authority, now });
  const enrollment = createAutomationEnrollment({ release, now, event: { id: 'vip-lead', tenantId, type: 'contact.created', occurredAt: new Date(now).toISOString(), triggerInputs: { segment: 'vip' } }, contact: { id: contactId, tenantId } });
  const selected = planAutomationStep({ release, enrollment, now });
  assert.equal(selected.enrollment.stepIndex, 1);
  assert.equal(selected.enrollment.lastBranchMatched, true);
  assert.throws(() => createAutomationWorkflowDraft({ id: 'looping-branch', tenantId, name: 'Loop', triggerType: 'contact.created', steps: [
    { id: 'check', type: 'branch', source: 'contactRef', operator: 'is_set', thenStepId: 'again', elseStepId: 'done' },
    { id: 'again', type: 'branch', source: 'contactRef', operator: 'is_set', thenStepId: 'check', elseStepId: 'done' },
    { id: 'done', type: 'create_task', taskTemplateRef: { id: 'done', version: 1 } }
  ] }), /move forward/);
});

test('workflow CRM field and tag actions are tenant scoped, idempotent and resumable', () => {
  const draft = createAutomationWorkflowDraft({ id: 'lead-intake-operations', tenantId, name: 'Lead intake', triggerType: 'form.submitted', steps: [
    { id: 'mark-qualified', type: 'update_contact_field', fieldRef: 'lead-status', value: 'new_inbound' },
    { id: 'tag-web-lead', type: 'manage_contact_tag', operation: 'add', tagRef: 'source-web-form' }
  ] });
  const release = publishAutomationWorkflow({ draft, publisherAuthority: authority, now });
  const enrollment = createAutomationEnrollment({ release, now, event: { id: 'form-1', tenantId, type: 'form.submitted', occurredAt: new Date(now).toISOString() }, contact: { id: contactId, tenantId } });
  const fieldAction = planAutomationStep({ release, enrollment, now });
  assert.equal(fieldAction.action.type, 'update_contact_field');
  assert.equal(fieldAction.action.value, 'new_inbound');
  assert.equal(fieldAction.action.contactRef, contactId);
  assert.match(fieldAction.action.idempotencyKey, /^[a-f0-9]{64}$/);
  assert.throws(() => resumeAutomationContactAction({ enrollment: fieldAction.enrollment, tenantId: 'tenant-b', idempotencyKey: fieldAction.action.idempotencyKey, actionType: 'update_contact_field', succeeded: true, now }), /does not match/);
  assert.throws(() => resumeAutomationContactAction({ enrollment: fieldAction.enrollment, tenantId, idempotencyKey: fieldAction.action.idempotencyKey, actionType: 'add_contact_tag', succeeded: true, now }), /does not match/);
  const fieldResumed = resumeAutomationContactAction({ enrollment: fieldAction.enrollment, tenantId, idempotencyKey: fieldAction.action.idempotencyKey, actionType: 'update_contact_field', succeeded: true, now });
  const tagAction = planAutomationStep({ release, enrollment: fieldResumed.enrollment, now });
  assert.equal(tagAction.action.type, 'add_contact_tag');
  assert.equal(tagAction.action.tagRef, 'source-web-form');
  assert.throws(() => createAutomationWorkflowDraft({ id: 'bad-field-value', tenantId, name: 'Bad', triggerType: 'form.submitted', steps: [{ id: 'set-email', type: 'update_contact_field', fieldRef: 'email', value: 'person@example.test' }] }), /non-sensitive literal/);
});

test('published customer-agent releases can be invoked by workflows and resumed with scoped outcomes', () => {
  const agentDraft = createAgentDeployment({ id: 'support-deploy', tenantId, agentId: 'support-agent', routes: [{ id: 'webchat', channel: 'webchat', coveragePercent: 100 }] });
  const agentRelease = publishAgentDeployment({ deployment: agentDraft, publisherAuthority: authority, evaluation: { tenantId, agentId: 'support-agent', score: 98, sampleCount: 20, errorRate: 0, criticalFailures: 0, evaluatedAt: new Date(now).toISOString() }, now, releaseId: 'support-agent-v1' });
  const draft = createAutomationWorkflowDraft({ id: 'support-agent-flow', tenantId, name: 'AI support and escalation', triggerType: 'message.received', steps: [
    { id: 'support-agent', type: 'invoke_agent', agentRef: { deploymentId: agentRelease.id, releaseId: agentRelease.releaseId, version: agentRelease.version }, inputMap: { contact: 'contactRef', conversation: 'conversationRef' } },
    { id: 'answer-branch', type: 'branch', source: 'lastAgentOutcome', operator: 'equals', value: 'answered', thenStepId: 'complete-task', elseStepId: 'handoff-task' },
    { id: 'complete-task', type: 'create_task', taskTemplateRef: { id: 'resolved-review', version: 1 } },
    { id: 'handoff-task', type: 'create_task', taskTemplateRef: { id: 'human-review', version: 1 } }
  ] });
  const release = publishAutomationWorkflow({ draft, publisherAuthority: authority, agentDependencies: [agentRelease], now, releaseId: 'support-agent-flow-v1' });
  const enrollment = createAutomationEnrollment({ release, now, event: { id: 'support-message-1', tenantId, type: 'message.received', occurredAt: new Date(now).toISOString(), conversationRef: 'conversation-1' }, contact: { id: contactId, tenantId } });
  const queued = planAutomationStep({ release, enrollment, now });
  assert.equal(queued.action.type, 'invoke_customer_agent');
  assert.equal(queued.action.releaseId, agentRelease.releaseId);
  assert.equal(Object.hasOwn(queued.action, 'userMessage'), false);
  assert.throws(() => resumeAutomationAgent({ enrollment: queued.enrollment, tenantId: 'tenant-b', idempotencyKey: queued.action.idempotencyKey, result: { tenantId: 'tenant-b', outcome: 'answered' }, now }), /does not match/);
  const resumed = resumeAutomationAgent({ enrollment: queued.enrollment, tenantId, idempotencyKey: queued.action.idempotencyKey, result: { tenantId, outcome: 'answered' }, now });
  const routed = planAutomationStep({ release, enrollment: resumed.enrollment, now });
  assert.equal(routed.enrollment.lastBranchMatched, true);
  assert.equal(routed.enrollment.stepIndex, 2);
});

test('event enrollment is scoped, replay bounded and idempotent across retries', () => {
  const release = workflowRelease();
  const first = appointmentEnrollment(release);
  const retry = appointmentEnrollment(release);
  assert.equal(first.idempotencyKey, retry.idempotencyKey);
  assert.equal(first.contactRef, contactId);
  const store = new Map();
  assert.equal(claimAutomationEnrollment(store, first).accepted, true);
  assert.equal(claimAutomationEnrollment(store, retry).accepted, false);
  assert.throws(() => createAutomationEnrollment({ release, now, event: { id: 'foreign', tenantId: 'tenant-b', type: release.triggerType, occurredAt: new Date(now).toISOString() }, contact: { id: contactId, tenantId } }), /workflow tenant/);
  assert.throws(() => createAutomationEnrollment({ release, now, event: { id: 'stale', tenantId, type: release.triggerType, occurredAt: new Date(now - 31 * 86400000).toISOString() }, contact: { id: contactId, tenantId } }), /replay window/);
  assert.throws(() => createAutomationEnrollment({ release, now, event: { id: 'bad-anchor', tenantId, type: release.triggerType, occurredAt: new Date(now).toISOString(), anchorAt: new Date(now + 400 * 86400000).toISOString() }, contact: { id: contactId, tenantId } }), /365-day window/);
});

test('appointment-relative wait resumes into an idempotent email outbox intent', () => {
  const release = workflowRelease();
  let enrollment = appointmentEnrollment(release, now + 2 * 86400000);
  const first = planAutomationStep({ release, enrollment, now });
  assert.equal(first.status, 'waiting');
  assert.equal(Date.parse(first.enrollment.nextRunAt), now + 86400000);
  assert.equal(planAutomationStep({ release, enrollment: first.enrollment, now: now + 1000 }).status, 'waiting');
  const freshContext = deliveryContext('email', 'appointment', { checkedAt: now + 86400000 });
  const second = planAutomationStep({ release, enrollment: first.enrollment, deliveryContext: freshContext, now: now + 86400000 });
  assert.equal(second.status, 'waiting_delivery');
  assert.equal(second.action.type, 'enqueue_message');
  assert.equal(second.action.intent.status, 'pending');
  assert.equal(Object.hasOwn(second.action.intent, 'to'), false);
  assert.equal(Object.hasOwn(second.action.intent, 'body'), false);
  const replay = createOutboundMessageIntent({
    tenantId, contactId, channel: 'email', purpose: 'appointment', templateRef: { id: 'appointment-email', version: 2 }, connectionRef: 'mail-connection',
    workflowReleaseId: release.releaseId, enrollmentId: enrollment.id, sourceEventId: enrollment.sourceEventId, stepId: 'email-reminder',
    ...freshContext, now: now + 86400000
  });
  assert.equal(replay.intent.deliveryKey, second.action.intent.deliveryKey);
  const authorized = authorizeOutboundMessageAttempt({ intent: second.action.intent, ...freshContext, now: now + 86400000 });
  assert.equal(authorized.allowed, true);
  const denied = authorizeOutboundMessageAttempt({ intent: second.action.intent, ...deliveryContext('email', 'appointment', { checkedAt: now + 86400000, suppressionSnapshot: suppression('email', { checkedAt: now + 86400000, blocked: true }) }), now: now + 86400000 });
  assert.equal(denied.reason, 'contact_suppressed');
  const revoked = authorizeOutboundMessageAttempt({ intent: second.action.intent, ...deliveryContext('email', 'appointment', { checkedAt: now + 86400000, policyDecision: policy('email', 'appointment', { checkedAt: now + 86400000, eligible: false }) }), now: now + 86400000 });
  assert.equal(revoked.reason, 'policy_denied');
  const consentRevoked = authorizeOutboundMessageAttempt({ intent: second.action.intent, ...deliveryContext('email', 'appointment', { checkedAt: now + 86400000, consentSnapshot: consent('email', 'appointment', { checkedAt: now + 86400000, eligible: false, revision: 'consent-v2' }) }), now: now + 86400000 });
  assert.equal(consentRevoked.reason, 'consent_not_valid');
});

test('messaging fails closed without fresh channel permission, suppression and frequency snapshots', () => {
  const common = {
    tenantId, contactId, channel: 'sms', purpose: 'marketing', templateRef: { id: 'promo', version: 1 }, connectionRef: 'sms-connection',
    workflowReleaseId: 'workflow-1', enrollmentId: 'enroll-1', sourceEventId: 'event-1', stepId: 'step-1', now
  };
  assert.equal(createOutboundMessageIntent({ ...common, ...deliveryContext('sms', 'marketing', { policyDecision: policy('sms', 'marketing', { eligible: false }) }) }).reason, 'policy_denied');
  assert.equal(createOutboundMessageIntent({ ...common, ...deliveryContext('sms', 'marketing', { consentSnapshot: null }) }).reason, 'consent_not_valid');
  assert.equal(createOutboundMessageIntent({ ...common, ...deliveryContext('sms', 'marketing', { consentSnapshot: consent('sms', 'marketing', { basis: 'service_request' }) }) }).reason, 'marketing_consent_required');
  assert.equal(createOutboundMessageIntent({ ...common, ...deliveryContext('sms', 'marketing', { suppressionSnapshot: null }) }).reason, 'suppression_check_unavailable');
  assert.equal(createOutboundMessageIntent({ ...common, ...deliveryContext('sms', 'marketing', { frequencySnapshot: frequency('sms', { allowed: false, count: 5, limit: 5 }) }) }).reason, 'frequency_limit_reached');
  assert.equal(createOutboundMessageIntent({ ...common, ...deliveryContext('sms', 'marketing', { suppressionSnapshot: suppression('sms', { checkedAt: new Date(now - 16 * 60_000).toISOString() }) }) }).reason, 'suppression_check_stale');
  assert.throws(() => createOutboundMessageIntent({ ...common, contactId: '555-555-5555', ...deliveryContext('sms', 'marketing') }), /opaque reference/);
});

test('send windows defer using the tenant timezone and are rechecked before every provider call', () => {
  const common = {
    tenantId, contactId, channel: 'sms', purpose: 'support', templateRef: { id: 'support-template', version: 1 }, connectionRef: 'sms-connection',
    workflowReleaseId: 'workflow-1', enrollmentId: 'enroll-1', sourceEventId: 'event-2', stepId: 'step-1', now,
    ...deliveryContext('sms', 'support', { policyDecision: policy('sms', 'support', { sendWindow: { mode: 'windows', timezone: 'America/Los_Angeles', windows: [{ days: [4], start: '09:00', end: '17:00' }] } }) })
  };
  const planned = createOutboundMessageIntent(common);
  assert.equal(planned.allowed, true);
  assert.equal(planned.intent.status, 'scheduled');
  assert.equal(planned.intent.nextAttemptAt, new Date(Date.parse('2026-10-01T16:00:00.000Z')).toISOString());
  const beforeWindow = authorizeOutboundMessageAttempt({ intent: planned.intent, ...deliveryContext('sms', 'support', { checkedAt: now + 1000, policyDecision: policy('sms', 'support', { checkedAt: now + 1000, sendWindow: common.policyDecision.sendWindow }) }), now: now + 1000 });
  assert.equal(beforeWindow.reason, 'message_not_due');
  const dueAt = Date.parse(planned.intent.nextAttemptAt);
  const due = authorizeOutboundMessageAttempt({ intent: planned.intent, ...deliveryContext('sms', 'support', { checkedAt: dueAt, policyDecision: policy('sms', 'support', { checkedAt: dueAt, sendWindow: common.policyDecision.sendWindow }) }), now: dueAt });
  assert.equal(due.allowed, true);
});

test('provider retries are bounded and ambiguous delivery outcomes are never retried automatically', () => {
  const planned = createOutboundMessageIntent({
    tenantId, contactId, channel: 'email', purpose: 'appointment', templateRef: { id: 'appointment-email', version: 1 }, connectionRef: 'mail-connection',
    workflowReleaseId: 'workflow-1', enrollmentId: 'enroll-2', sourceEventId: 'event-3', stepId: 'send-1',
    ...deliveryContext(), now
  }).intent;
  const transient = recordProviderAttempt({ intent: planned, result: { status: 'transient_failure', safeToRetry: true, errorCode: 'provider_busy', retryAfterMs: 1000 }, now, random: () => 0.5 });
  assert.equal(transient.retry, true);
  assert.equal(transient.intent.status, 'scheduled');
  assert.equal(Date.parse(transient.intent.nextAttemptAt), now + 1000);
  const ambiguous = recordProviderAttempt({ intent: planned, result: { status: 'unknown', errorCode: 'provider_timeout' }, now });
  assert.equal(ambiguous.intent.status, 'needs_review');
  assert.equal(ambiguous.retry, false);
  const auth = recordProviderAttempt({ intent: planned, result: { status: 'auth_error' }, now });
  assert.equal(auth.connectorAction, 'pause_and_reauthorize');
});

test('delivery receipts cannot cross tenants, regress a terminal status, or erase unsubscribe suppression', () => {
  const planned = createOutboundMessageIntent({
    tenantId, contactId, channel: 'email', purpose: 'appointment', templateRef: { id: 'appointment-email', version: 1 }, connectionRef: 'mail-connection',
    workflowReleaseId: 'workflow-1', enrollmentId: 'enroll-3', sourceEventId: 'event-4', stepId: 'send-1',
    ...deliveryContext(), now
  }).intent;
  const accepted = recordProviderAttempt({ intent: planned, result: { status: 'accepted', providerMessageRef: '12345678901234567890' }, now }).intent;
  const delivered = createProviderReceipt({ tenantId, channel: 'email', providerConnectionRef: 'mail-connection', providerEventId: '12345678901234567890', providerMessageRef: '12345678901234567890', status: 'delivered', occurredAt: new Date(now + 1).toISOString() });
  assert.equal(applyProviderReceipt({ intent: accepted, receipt: delivered }).intent.status, 'delivered');
  const unsubscribed = createProviderReceipt({ tenantId, channel: 'email', providerConnectionRef: 'mail-connection', providerEventId: 'event-unsub', providerMessageRef: '12345678901234567890', status: 'unsubscribed', occurredAt: new Date(now + 2).toISOString() });
  const suppressed = applyProviderReceipt({ intent: accepted, receipt: unsubscribed });
  assert.equal(suppressed.intent.status, 'suppressed');
  assert.equal(suppressed.suppressionUpdate.contactId, contactId);
  assert.equal(applyProviderReceipt({ intent: suppressed.intent, receipt: delivered }).intent.status, 'suppressed');
  assert.throws(() => applyProviderReceipt({ intent: accepted, receipt: { ...delivered, tenantId: 'tenant-b' } }), /does not match/);
  assert.throws(() => createProviderReceipt({ tenantId, channel: 'email', providerConnectionRef: 'mail-connection', providerEventId: 'bounce-unclassified', providerMessageRef: '12345678901234567890', status: 'bounced', occurredAt: new Date(now + 3).toISOString() }), /classify/);
  const hardBounce = createProviderReceipt({ tenantId, channel: 'email', providerConnectionRef: 'mail-connection', providerEventId: 'bounce-hard', providerMessageRef: '12345678901234567890', status: 'bounced', bounceType: 'hard', occurredAt: new Date(now + 3).toISOString() });
  assert.equal(applyProviderReceipt({ intent: accepted, receipt: hardBounce }).suppressionUpdate.source, 'hard_bounce');
  const softBounce = createProviderReceipt({ tenantId, channel: 'email', providerConnectionRef: 'mail-connection', providerEventId: 'bounce-soft', providerMessageRef: '12345678901234567890', status: 'bounced', bounceType: 'soft', occurredAt: new Date(now + 4).toISOString() });
  assert.equal(applyProviderReceipt({ intent: accepted, receipt: softBounce }).suppressionUpdate, null);
});

test('reply waits route late replies to timeout and due timers to the configured branch', () => {
  const release = workflowRelease();
  const enrollment = appointmentEnrollment(release);
  const waiting = planAutomationStep({ release, enrollment: { ...enrollment, stepIndex: 2 }, now }).enrollment;
  const onTime = resumeAutomationReply({ release, enrollment: waiting, event: { type: 'message.received', tenantId, contactRef: contactId, conversationRef: 'conversation-1', occurredAt: new Date(now + 1000).toISOString() }, now: now + 1000 });
  assert.equal(onTime.accepted, true);
  assert.equal(onTime.enrollment.stepIndex, 3);
  const late = resumeAutomationReply({ release, enrollment: waiting, event: { type: 'message.received', tenantId, contactRef: contactId, conversationRef: 'conversation-1', occurredAt: new Date(now + 3600001).toISOString() }, now: now + 3600001 });
  assert.equal(late.reason, 'reply_timeout');
  assert.equal(late.enrollment.stepIndex, 4);
  assert.equal(advanceAutomationReplyTimeout({ release, enrollment: waiting, now: now + 3600000 }).enrollment.stepIndex, 4);
  assert.equal(advanceAutomationReplyTimeout({ release, enrollment: waiting, now: now + 1000 }).advanced, false);
});

test('task and message outcomes resume only the matching durable workflow command', () => {
  const release = publishAutomationWorkflow({
    draft: createAutomationWorkflowDraft({ id: 'lead-follow-up', tenantId, name: 'Lead follow-up', triggerType: 'contact.created', steps: [{ id: 'owner-task', type: 'create_task', taskTemplateRef: { id: 'new-lead-task', version: 1 } }] }),
    publisherAuthority: authority, now, releaseId: 'lead-follow-up-v1'
  });
  const enrollment = createAutomationEnrollment({ release, now, event: { id: 'new-contact-event', tenantId, type: 'contact.created', occurredAt: new Date(now).toISOString() }, contact: { id: contactId, tenantId }, id: 'lead-enrollment' });
  const task = planAutomationStep({ release, enrollment, now });
  assert.equal(task.status, 'waiting_action');
  assert.throws(() => resumeAutomationTask({ enrollment: task.enrollment, tenantId, idempotencyKey: 'wrong-key', succeeded: true, now }), /does not match/);
  const resumedTask = resumeAutomationTask({ enrollment: task.enrollment, tenantId, idempotencyKey: task.action.idempotencyKey, succeeded: true, now });
  assert.equal(resumedTask.enrollment.status, 'queued');
  const deliveryEnrollment = { tenantId, status: 'waiting_delivery', waitingDeliveryKey: 'delivery-key' };
  assert.equal(resumeAutomationDelivery({ enrollment: deliveryEnrollment, intent: { tenantId, deliveryKey: 'delivery-key', status: 'scheduled' }, now }).reason, 'delivery_retry_scheduled');
});
