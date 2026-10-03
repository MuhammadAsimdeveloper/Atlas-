import crypto from 'node:crypto';
import { requireAtlasPlatformOwner, requireTenantRole } from '../atlas-core/authority.mjs';
import { verifyAgentDeploymentRelease } from './index.mjs';

export const AUTOMATION_TRIGGERS = Object.freeze([
  'contact.created', 'contact.updated', 'contact.tag_added', 'contact.tag_removed', 'contact.dnd_changed',
  'contact.note_added', 'contact.engagement_threshold', 'contact.birthday_due', 'contact.custom_date_due',
  'lead.score_changed', 'prospect.generated', 'form.submitted', 'survey.submitted', 'quiz.submitted',
  'trigger_link.clicked', 'funnel.page_viewed', 'tracking.external_event', 'lead_form.facebook_submitted',
  'lead_form.instagram_submitted', 'lead_form.tiktok_submitted', 'lead_form.linkedin_submitted', 'lead_form.google_submitted',
  'appointment.booked', 'appointment.confirmed', 'appointment.rescheduled', 'appointment.canceled', 'appointment.no_show',
  'appointment.completed', 'appointment.reminder_due', 'appointment.service_booked', 'rental.booked',
  'opportunity.created', 'opportunity.updated', 'opportunity.stage_changed', 'opportunity.status_changed', 'opportunity.stale',
  'affiliate.created', 'affiliate.sale', 'affiliate.campaign_enrolled', 'affiliate.lead_created',
  'course.signup', 'course.category_started', 'course.category_completed', 'course.lesson_started', 'course.lesson_completed',
  'course.product_started', 'course.product_completed', 'course.access_granted', 'course.access_removed', 'course.user_login',
  'community.group_access_granted', 'community.group_access_revoked', 'community.private_channel_granted',
  'community.private_channel_revoked', 'community.level_changed', 'certificate.issued',
  'invoice.created', 'invoice.sent', 'invoice.due', 'invoice.overdue', 'invoice.paid',
  'payment.received', 'payment.failed', 'payment.refunded', 'order.form_submitted', 'order.submitted',
  'document.sent', 'document.signed', 'document.declined', 'estimate.sent', 'estimate.accepted', 'estimate.declined',
  'subscription.created', 'subscription.updated', 'subscription.paused', 'subscription.resumed', 'subscription.canceled',
  'coupon.applied', 'coupon.redeemed', 'coupon.limit_reached', 'coupon.expired',
  'store.order_placed', 'store.order_fulfilled', 'store.checkout_abandoned', 'store.product_review_submitted',
  'ivr.started', 'social.facebook_comment', 'social.instagram_comment', 'social.tiktok_comment',
  'message.received', 'message.delivery_failed', 'message.sms_error', 'message.customer_replied',
  'call.started', 'call.answered', 'call.missed', 'call.ended', 'call.transcript_generated',
  'email.delivered', 'email.opened', 'email.clicked', 'email.bounced', 'email.spam_complaint', 'email.unsubscribed',
  'consent.granted', 'consent.revoked', 'task.created', 'task.completed', 'task.reminder_due',
  'conversation.handed_off', 'agent.resolved', 'agent.failed', 'workflow.completed', 'workflow.failed',
  'workflow.called', 'schedule.fired', 'webhook.received', 'custom.event'
]);
export const OUTBOUND_CHANNELS = Object.freeze(['email', 'sms', 'whatsapp', 'facebook', 'instagram', 'webchat', 'voice']);
export const OUTBOUND_PURPOSES = Object.freeze(['service', 'transactional', 'marketing', 'support', 'appointment', 'billing']);
export const MESSAGE_STATUSES = Object.freeze(['pending', 'scheduled', 'provider_accepted', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'suppressed', 'canceled', 'needs_review']);
export const AUTOMATION_STEP_TYPES = Object.freeze(['wait', 'wait_until', 'branch', 'send_message', 'create_task', 'update_contact_field', 'manage_contact_tag', 'await_reply', 'call_workflow', 'invoke_agent']);

const REF_MAX = 180;
const SAFE_CODE = /^[a-z][a-z0-9_]{1,63}$/;
const PRIVATE_INPUT_KEY = /password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|credential|authorization|cookie/i;
const PII_REF = /@|\+?\d[\d(). -]{6,}\d/;
const MAX_DELAY_MS = 365 * 86400000;

function requiredText(value, label, max = REF_MAX) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\r\n\u0000]/.test(value)) throw new Error(`${label} must be bounded text`);
  return value.trim();
}

function opaqueRef(value, label) {
  const result = requiredText(value, label);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result);
  const isGeneratedReference = /^(?:sub|child)_[a-f0-9]{32,40}$/i.test(result);
  if (!isUuid && !isGeneratedReference && PII_REF.test(result)) throw new Error(`${label} must be an opaque reference, not a contact address`);
  return result;
}

function providerRef(value, label) {
  const result = requiredText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,179}$/.test(result) || /@/.test(result)) throw new Error(`${label} must be a provider-generated opaque identifier`);
  return result;
}

function timestamp(value, label) {
  const result = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(result) || !Number.isFinite(new Date(result).getTime())) throw new Error(`${label} must be a valid timestamp`);
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

function sealRelease(release) {
  return freezeTree({ ...release, checksum: digest(release) });
}

export function verifyAutomationRelease(release) {
  if (!release || typeof release.releaseId !== 'string' || !/^[a-f0-9]{64}$/.test(String(release.checksum || ''))) return false;
  const { checksum, ...snapshot } = release;
  return digest(snapshot) === checksum;
}

const TEMPLATE_LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const TEMPLATE_VARIABLE = /{{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){0,3})\s*}}/g;
const TEMPLATE_PRIVATE_VARIABLE = /(?:password|secret|api[_-]?key|(?:access|refresh)?[_-]?token|credential|authorization|cookie|card|cvv|ssn)/i;
const TEMPLATE_ROOTS = new Set(['contact', 'appointment', 'company', 'agent', 'workflow', 'service', 'billing', 'links']);
const TEMPLATE_RESERVED_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor', 'tostring', 'valueof']);

function validateTemplateVariables(source) {
  if ((source.match(/{{/g) || []).length !== (source.match(/}}/g) || []).length) throw new Error('Template variable braces must be balanced');
  for (const match of source.matchAll(TEMPLATE_VARIABLE)) {
    const segments = match[1].split('.');
    if (!TEMPLATE_ROOTS.has(segments[0]) || segments.some(segment => TEMPLATE_RESERVED_SEGMENTS.has(segment.toLowerCase()))) throw new Error('Template variables must use approved business-data paths');
    if (TEMPLATE_PRIVATE_VARIABLE.test(match[1])) throw new Error('Templates cannot reference credential or sensitive-payment variables');
  }
  const stripped = source.replace(TEMPLATE_VARIABLE, '');
  if (stripped.includes('{{') || stripped.includes('}}')) throw new Error('Template variables must use approved dotted identifiers');
}

const EMAIL_HTML_TAG = /^<(\/)?(p|br|strong|em|b|i|ul|ol|li|h[1-6]|a)(?:\s+href=(?:"([^"]*)"|'([^']*)'))?\s*(\/?)>$/i;
const EMAIL_HTML_VOID = new Set(['br']);

function validateEmailHtmlTemplate(source) {
  for (const match of source.matchAll(TEMPLATE_VARIABLE)) {
    const prefix = source.slice(0, match.index);
    if (prefix.lastIndexOf('<') > prefix.lastIndexOf('>')) throw new Error('Email HTML variables must appear in text, not in tags or attributes');
  }
  const tags = source.match(/<[^>]*>/g) || [];
  let residue = source;
  const stack = [];
  for (const tag of tags) {
    residue = residue.replace(tag, '');
    const parsed = EMAIL_HTML_TAG.exec(tag);
    if (!parsed) throw new Error('Email HTML contains a tag or attribute outside the safe formatting allowlist');
    const [, closing, nameRaw, doubleHref, singleHref, selfClosing] = parsed;
    const name = nameRaw.toLowerCase();
    const href = doubleHref ?? singleHref;
    if (name === 'a' && href != null) {
      let target;
      try { if (href.length > 2048) throw new Error(); target = new URL(href); } catch { throw new Error('Email HTML links must use a fixed HTTPS URL'); }
      if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Email HTML links must use a fixed HTTPS URL');
    } else if (href != null) throw new Error('Only anchor tags may contain a fixed HTTPS link');
    if (closing) {
      if (selfClosing || EMAIL_HTML_VOID.has(name) || stack.pop() !== name) throw new Error('Email HTML tags must be correctly nested');
    } else if (!EMAIL_HTML_VOID.has(name) && !selfClosing) stack.push(name);
    else if (selfClosing && !EMAIL_HTML_VOID.has(name)) throw new Error('Email HTML tags must use explicit closing tags');
  }
  if (residue.includes('<') || residue.includes('>')) throw new Error('Email HTML text must escape angle brackets');
  if (stack.length) throw new Error('Email HTML tags must be correctly nested');
}

export function createMessageTemplateVersion({
  tenantId, id, version, channel, purpose, locale = 'en-US', subjectTemplate = null,
  bodyTemplate, bodyFormat = 'plain_text', publisherAuthority, now = Date.now()
} = {}) {
  const tenant = opaqueRef(tenantId, 'tenantId');
  if (publisherAuthority?.globalRole === 'platform_owner') requireAtlasPlatformOwner(publisherAuthority);
  else requireTenantRole(publisherAuthority, tenant, ['owner', 'admin']);
  const templateId = opaqueRef(id, 'template id');
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Template version must be a positive integer');
  const channelName = requiredText(channel, 'template channel', 32).toLowerCase();
  const purposeName = requiredText(purpose, 'template purpose', 32).toLowerCase();
  if (!OUTBOUND_CHANNELS.includes(channelName) || !OUTBOUND_PURPOSES.includes(purposeName)) throw new Error('Template channel or purpose is unsupported');
  const language = requiredText(locale, 'template locale', 48);
  if (!TEMPLATE_LOCALE.test(language)) throw new Error('Template locale must be a bounded BCP 47 language tag');
  if (!['plain_text', 'html'].includes(bodyFormat) || channelName !== 'email' && bodyFormat !== 'plain_text') throw new Error('Only email templates may use the safe HTML body format');
  if (typeof bodyTemplate !== 'string' || !bodyTemplate.trim() || bodyTemplate.length > 100_000 || /\u0000/.test(bodyTemplate)) throw new Error('Template body must contain 1-100000 characters');
  if (channelName === 'email' && (typeof subjectTemplate !== 'string' || !subjectTemplate.trim())) throw new Error('Email templates require a subject');
  if (subjectTemplate != null && (typeof subjectTemplate !== 'string' || subjectTemplate.length > 600 || /[\r\n\u0000]/.test(subjectTemplate))) throw new Error('Template subject must be bounded single-line text');
  for (const source of [bodyTemplate, subjectTemplate || '']) {
    validateTemplateVariables(source);
  }
  if (bodyFormat === 'html') validateEmailHtmlTemplate(bodyTemplate);
  const createdAt = new Date(timestamp(now, 'now')).toISOString();
  const snapshot = {
    id: templateId, tenantId: tenant, version, channel: channelName, purpose: purposeName,
    locale: language, subjectTemplate: subjectTemplate?.trim() || null, bodyTemplate: bodyTemplate.trim(), bodyFormat,
    status: 'published', createdBy: publisherAuthority.actorId, createdAt
  };
  return freezeTree({ ...snapshot, checksum: digest(snapshot) });
}

export function verifyMessageTemplateVersion(template) {
  if (!template || template.status !== 'published' || typeof template.id !== 'string' ||
    typeof template.tenantId !== 'string' || !Number.isSafeInteger(template.version) ||
    !/^[a-f0-9]{64}$/.test(String(template.checksum || ''))) return false;
  const { checksum, ...snapshot } = template;
  return digest(snapshot) === checksum;
}

function ownDataPath(root, pathValue) {
  let value = root;
  for (const segment of pathValue.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { present: false };
    const descriptor = Object.getOwnPropertyDescriptor(value, segment);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return { present: false };
    value = descriptor.value;
  }
  if (value == null) return { present: false };
  if (typeof value === 'string') {
    if (value.length > 100_000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) throw new Error('Template data contains unsafe text');
    return { present: true, value };
  }
  if (typeof value === 'number' && Number.isFinite(value)) return { present: true, value: String(value) };
  if (typeof value === 'boolean') return { present: true, value: String(value) };
  throw new Error('Template variables must resolve to scalar data');
}

function escapeHtmlText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function renderMessageTemplateVersion({ template, tenantId, variables } = {}) {
  if (!verifyMessageTemplateVersion(template)) throw new Error('Message template checksum or publication status is invalid');
  if (!OUTBOUND_CHANNELS.includes(template.channel) || !OUTBOUND_PURPOSES.includes(template.purpose) || typeof template.bodyTemplate !== 'string' || !template.bodyTemplate || template.bodyTemplate.length > 100_000) throw new Error('Message template fields are invalid');
  if (template.channel === 'email' && (typeof template.subjectTemplate !== 'string' || !template.subjectTemplate || /[\r\n\u0000]/.test(template.subjectTemplate))) throw new Error('Email template subject is invalid');
  validateTemplateVariables(template.bodyTemplate);
  validateTemplateVariables(template.subjectTemplate || '');
  if (typeof tenantId !== 'string' || tenantId !== template.tenantId) throw new Error('Message template tenant does not match the trusted render scope');
  if (!variables || typeof variables !== 'object' || Array.isArray(variables) || ![Object.prototype, null].includes(Object.getPrototypeOf(variables))) throw new Error('Template variables must be a plain tenant-resolved record');
  const bodyFormat = template.bodyFormat || 'plain_text';
  if (!['plain_text', 'html'].includes(bodyFormat) || template.channel !== 'email' && bodyFormat !== 'plain_text') throw new Error('Message template format is invalid for its channel');
  if (bodyFormat === 'html') validateEmailHtmlTemplate(template.bodyTemplate);
  const sources = [template.subjectTemplate || '', template.bodyTemplate];
  const resolved = new Map();
  const missing = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(TEMPLATE_VARIABLE)) {
      if (resolved.has(match[1]) || missing.has(match[1])) continue;
      const result = ownDataPath(variables, match[1]);
      if (!result.present) missing.add(match[1]);
      else resolved.set(match[1], result.value);
    }
  }
  const templateRef = Object.freeze({ id: template.id, version: template.version, checksum: template.checksum });
  if (missing.size) return Object.freeze({ status: 'needs_data', tenantId, templateRef, missingVariables: Object.freeze([...missing].sort()) });
  const substitute = (source, htmlText = false, singleLine = false) => source.replace(TEMPLATE_VARIABLE, (_placeholder, key) => {
    const value = resolved.get(key);
    if (singleLine && /[\r\n\u0000-\u001F\u007F]/.test(value)) throw new Error('Rendered email subjects must not contain header control characters');
    return htmlText ? escapeHtmlText(value) : value;
  });
  const subject = template.channel === 'email' ? substitute(template.subjectTemplate, false, true) : null;
  const body = substitute(template.bodyTemplate, bodyFormat === 'html');
  if (subject?.length > 600 || body.length > 100_000) throw new Error('Rendered message exceeds the bounded template size');
  return Object.freeze({
    status: 'rendered', tenantId, templateRef, channel: template.channel, purpose: template.purpose,
    locale: template.locale, subject, body, bodyFormat,
    variablesUsed: Object.freeze([...resolved.keys()].sort()),
  });
}

function normalizeTemplateRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('templateRef is required');
  const version = value.version;
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('templateRef version must be a positive integer');
  return { id: opaqueRef(value.id, 'templateRef id'), version };
}

function normalizeStep(step, index) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`step ${index + 1} must be an object`);
  const id = opaqueRef(step.id || `step_${index + 1}`, 'step id');
  const type = requiredText(step.type, 'step type', 32);
  if (!AUTOMATION_STEP_TYPES.includes(type)) throw new Error(`Unsupported workflow step type: ${type}`);
  if (type === 'wait') {
    if (!Number.isSafeInteger(step.delayMs) || step.delayMs < 1000 || step.delayMs > MAX_DELAY_MS) throw new Error('wait delayMs must be between one second and 365 days');
    return { id, type, delayMs: step.delayMs };
  }
  if (type === 'wait_until') {
    if (step.anchor !== 'event' || !Number.isSafeInteger(step.offsetMs) || Math.abs(step.offsetMs) > MAX_DELAY_MS) throw new Error('wait_until requires an event anchor and a bounded offsetMs');
    return { id, type, anchor: 'event', offsetMs: step.offsetMs };
  }
  if (type === 'branch') {
    const source = requiredText(step.source, 'branch source', 96);
    if (!['contactRef', 'conversationRef', 'sourceEventId', 'triggerType', 'lastAgentOutcome'].includes(source) && !/^triggerInput\.[a-z][a-zA-Z0-9_]{0,63}$/.test(source)) throw new Error('branch source must use an approved enrollment field or trigger input');
    const operator = requiredText(step.operator, 'branch operator', 24);
    if (!['equals', 'not_equals', 'is_set'].includes(operator)) throw new Error('branch operator is unsupported');
    const value = operator === 'is_set' ? null : opaqueRef(step.value, 'branch comparison value');
    return { id, type, source, operator, value, thenStepId: opaqueRef(step.thenStepId, 'thenStepId'), elseStepId: opaqueRef(step.elseStepId, 'elseStepId') };
  }
  if (type === 'send_message') {
    const channel = requiredText(step.channel, 'message channel', 32).toLowerCase();
    const purpose = requiredText(step.purpose, 'message purpose', 32).toLowerCase();
    if (!OUTBOUND_CHANNELS.includes(channel) || !OUTBOUND_PURPOSES.includes(purpose)) throw new Error('Message channel or purpose is unsupported');
    return { id, type, channel, purpose, templateRef: normalizeTemplateRef(step.templateRef), connectionRef: opaqueRef(step.connectionRef, 'connectionRef') };
  }
  if (type === 'create_task') {
    const dueInMs = step.dueInMs == null ? 0 : step.dueInMs;
    if (!Number.isSafeInteger(dueInMs) || dueInMs < 0 || dueInMs > MAX_DELAY_MS) throw new Error('task dueInMs is out of range');
    return { id, type, taskTemplateRef: normalizeTemplateRef(step.taskTemplateRef), dueInMs, assignedToRef: step.assignedToRef == null ? null : opaqueRef(step.assignedToRef, 'assignedToRef') };
  }
  if (type === 'update_contact_field') {
    const fieldRef = opaqueRef(step.fieldRef, 'fieldRef');
    const value = step.value;
    if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'string' && (!value.trim() || value.length > 300 || /[\r\n\u0000]/.test(value) || PII_REF.test(value)))) throw new Error('Contact field updates require a bounded non-sensitive literal value');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Contact field update values must be finite');
    return { id, type, fieldRef, value };
  }
  if (type === 'manage_contact_tag') {
    const operation = requiredText(step.operation, 'tag operation', 16);
    if (!['add', 'remove'].includes(operation)) throw new Error('Contact tag operation must be add or remove');
    return { id, type, operation, tagRef: opaqueRef(step.tagRef, 'tagRef') };
  }
  if (type === 'call_workflow') {
    if (!step.workflowRef || !Number.isSafeInteger(step.workflowRef.version) || step.workflowRef.version < 1) throw new Error('workflowRef version must be a positive integer');
    const inputMap = step.inputMap == null ? {} : step.inputMap;
    if (!inputMap || typeof inputMap !== 'object' || Array.isArray(inputMap) || Object.keys(inputMap).length > 32) throw new Error('sub-workflow inputMap must be a bounded object');
    const safeInputMap = {};
    for (const [key, source] of Object.entries(inputMap)) {
      if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) || PRIVATE_INPUT_KEY.test(key)) throw new Error('sub-workflow input names must be safe non-secret identifiers');
      if (!['contactRef', 'conversationRef', 'sourceEventId', 'triggerType', 'eventOccurredAt', 'eventAnchorAt'].includes(source)) throw new Error('sub-workflows may receive only approved non-secret event references');
      safeInputMap[key] = source;
    }
    return { id, type, workflowRef: { id: opaqueRef(step.workflowRef.id, 'workflowRef id'), version: step.workflowRef.version }, inputMap: safeInputMap };
  }
  if (type === 'invoke_agent') {
    if (!step.agentRef || !Number.isSafeInteger(step.agentRef.version) || step.agentRef.version < 1) throw new Error('agentRef version must be a positive integer');
    const inputMap = step.inputMap == null ? {} : step.inputMap;
    if (!inputMap || typeof inputMap !== 'object' || Array.isArray(inputMap) || Object.keys(inputMap).length > 32) throw new Error('agent inputMap must be a bounded object');
    const safeInputMap = {};
    for (const [key, source] of Object.entries(inputMap)) {
      if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) || PRIVATE_INPUT_KEY.test(key)) throw new Error('agent input names must be safe non-secret identifiers');
      if (!['contactRef', 'conversationRef', 'sourceEventId', 'triggerType', 'eventOccurredAt', 'eventAnchorAt'].includes(source)) throw new Error('agents may receive only approved non-secret event references');
      safeInputMap[key] = source;
    }
    return { id, type, agentRef: { deploymentId: opaqueRef(step.agentRef.deploymentId, 'agent deployment id'), releaseId: opaqueRef(step.agentRef.releaseId, 'agent release id'), version: step.agentRef.version }, inputMap: safeInputMap };
  }
  const replyStepId = opaqueRef(step.replyStepId, 'replyStepId');
  const timeoutStepId = opaqueRef(step.timeoutStepId, 'timeoutStepId');
  if (!Number.isSafeInteger(step.timeoutMs) || step.timeoutMs < 60_000 || step.timeoutMs > 30 * 86400000) throw new Error('await_reply timeoutMs must be between one minute and 30 days');
  return { id, type, replyStepId, timeoutStepId, timeoutMs: step.timeoutMs };
}

export function createAutomationWorkflowDraft({ id, tenantId, name, triggerType, version = 1, steps } = {}) {
  const workflowId = opaqueRef(id, 'workflow id');
  const tenant = opaqueRef(tenantId, 'tenantId');
  const workflowName = requiredText(name, 'workflow name', 120);
  const trigger = requiredText(triggerType, 'triggerType', 64);
  if (!AUTOMATION_TRIGGERS.includes(trigger)) throw new Error(`Unsupported automation trigger: ${trigger}`);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Workflow version must be a positive integer');
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 100) throw new Error('Workflow must contain 1-100 steps');
  const normalized = steps.map(normalizeStep);
  if (new Set(normalized.map(step => step.id)).size !== normalized.length) throw new Error('Workflow step IDs must be unique');
  const ids = new Set(normalized.map(step => step.id));
  for (const step of normalized) {
    if (step.type === 'await_reply' && (!ids.has(step.replyStepId) || !ids.has(step.timeoutStepId))) throw new Error('Reply and timeout branches must point to steps in this workflow');
    if (step.type === 'branch') {
      const stepIndex = normalized.findIndex(item => item.id === step.id);
      const thenIndex = normalized.findIndex(item => item.id === step.thenStepId), elseIndex = normalized.findIndex(item => item.id === step.elseStepId);
      if (thenIndex < 0 || elseIndex < 0) throw new Error('Branch paths must point to steps in this workflow');
      if (thenIndex <= stepIndex || elseIndex <= stepIndex) throw new Error('Branch paths must move forward to prevent workflow loops');
    }
  }
  return { id: workflowId, tenantId: tenant, name: workflowName, triggerType: trigger, version, status: 'draft', steps: normalized };
}

function validateWorkflowDependencies(draft, dependencies) {
  if (!Array.isArray(dependencies) || dependencies.length > 32) throw new Error('Workflow dependencies must be a bounded list');
  const releases = new Map();
  for (const dependency of dependencies) {
    if (!verifyAutomationRelease(dependency) || dependency.status !== 'published' || dependency.tenantId !== draft.tenantId || dependency.triggerType !== 'workflow.called') throw new Error('Sub-workflow dependency must be a valid published workflow.called release in the same tenant');
    const key = `${dependency.id}\u0000${dependency.version}`;
    if (releases.has(key)) throw new Error('Workflow dependency versions must be unique');
    releases.set(key, dependency);
  }
  const references = new Map();
  const visit = (release, path = new Set(), depth = 0) => {
    if (depth > 8) throw new Error('Sub-workflow nesting exceeds the maximum depth of 8');
    const identity = `${release.id}\u0000${release.version}`;
    if (path.has(identity)) throw new Error('Sub-workflow dependency cycle detected');
    const nextPath = new Set(path).add(identity);
    for (const step of release.steps) {
      if (step.type !== 'call_workflow') continue;
      if (step.workflowRef.id === draft.id && step.workflowRef.version === draft.version) throw new Error('Sub-workflow dependency cycle detected');
      const key = `${step.workflowRef.id}\u0000${step.workflowRef.version}`;
      const child = releases.get(key);
      if (!child) throw new Error(`Pinned sub-workflow dependency ${step.workflowRef.id}@${step.workflowRef.version} is missing`);
      if (nextPath.has(`${child.id}\u0000${child.version}`)) throw new Error('Sub-workflow dependency cycle detected');
      references.set(key, child);
      visit(child, nextPath, depth + 1);
    }
  };
  for (const step of draft.steps) {
    if (step.type !== 'call_workflow') continue;
    const key = `${step.workflowRef.id}\u0000${step.workflowRef.version}`;
    const release = releases.get(key);
    if (!release) throw new Error(`Pinned sub-workflow dependency ${step.workflowRef.id}@${step.workflowRef.version} is missing`);
    references.set(key, release);
    visit(release);
  }
  return [...references.values()];
}

function validateAgentDependencies(draft, dependencies) {
  if (!Array.isArray(dependencies) || dependencies.length > 32) throw new Error('Agent dependencies must be a bounded list');
  const releases = new Map();
  for (const dependency of dependencies) {
    if (!verifyAgentDeploymentRelease(dependency) || dependency.tenantId !== draft.tenantId || !['canary', 'active'].includes(dependency.status)) throw new Error('Agent dependency must be a valid live agent deployment release in the same tenant');
    const key = `${dependency.id}\u0000${dependency.releaseId}\u0000${dependency.version}`;
    if (releases.has(key)) throw new Error('Agent dependency releases must be unique');
    releases.set(key, dependency);
  }
  for (const step of draft.steps) {
    if (step.type !== 'invoke_agent') continue;
    const key = `${step.agentRef.deploymentId}\u0000${step.agentRef.releaseId}\u0000${step.agentRef.version}`;
    if (!releases.has(key)) throw new Error(`Pinned agent dependency ${step.agentRef.deploymentId}@${step.agentRef.version} is missing`);
  }
  return [...releases.values()];
}

function validateTemplateDependencies(draft, dependencies) {
  if (!Array.isArray(dependencies) || dependencies.length > 32) throw new Error('Message template dependencies must be a bounded list');
  const templates = new Map();
  for (const template of dependencies) {
    if (!verifyMessageTemplateVersion(template) || template.tenantId !== draft.tenantId) throw new Error('Message template dependency must be a valid published version in the same tenant');
    const key = `${template.id}\u0000${template.version}`;
    if (templates.has(key)) throw new Error('Message template versions must be unique');
    templates.set(key, template);
  }
  const references = new Set();
  for (const step of draft.steps) {
    if (step.type !== 'send_message') continue;
    const key = `${step.templateRef.id}\u0000${step.templateRef.version}`;
    const template = templates.get(key);
    if (!template) throw new Error(`Pinned message template ${step.templateRef.id}@${step.templateRef.version} is missing`);
    if (template.channel !== step.channel || template.purpose !== step.purpose) throw new Error(`Message template ${step.templateRef.id}@${step.templateRef.version} does not match the channel and purpose of step ${step.id}`);
    references.add(key);
  }
  for (const key of templates.keys()) if (!references.has(key)) throw new Error('Unused message template dependencies are not allowed');
  return [...templates.values()];
}

export function publishAutomationWorkflow({ draft, publisherAuthority, workflowDependencies = [], agentDependencies = [], templateDependencies = [], now = Date.now(), releaseId = crypto.randomUUID() } = {}) {
  if (!draft || draft.status !== 'draft') throw new Error('Only a workflow draft can be published');
  if (publisherAuthority?.globalRole === 'platform_owner') requireAtlasPlatformOwner(publisherAuthority);
  else requireTenantRole(publisherAuthority, draft.tenantId, ['owner', 'admin']);
  const releasedAt = timestamp(now, 'now');
  const dependencies = validateWorkflowDependencies(draft, workflowDependencies);
  const agents = validateAgentDependencies(draft, agentDependencies);
  const templates = validateTemplateDependencies(draft, templateDependencies);
  const snapshot = {
    id: draft.id, tenantId: draft.tenantId, name: draft.name, triggerType: draft.triggerType,
    version: draft.version, status: 'published', steps: draft.steps.map(step => ({ ...step })),
    dependencies: dependencies.map(({ id, version, releaseId: dependencyReleaseId, checksum }) => ({ id, version, releaseId: dependencyReleaseId, checksum })),
    agentDependencies: agents.map(({ id, agentId, version, releaseId: dependencyReleaseId, checksum }) => ({ id, agentId, version, releaseId: dependencyReleaseId, checksum })),
    templateDependencies: templates.map(({ id, version, channel, purpose, checksum }) => ({ id, version, channel, purpose, checksum }))
  };
  return sealRelease({ ...snapshot, releaseId: opaqueRef(releaseId, 'releaseId'), publishedAt: new Date(releasedAt).toISOString(), publishedBy: publisherAuthority.actorId, dependencyReleases: dependencies, dependencyAgentReleases: agents, dependencyTemplateVersions: templates });
}

export function createAutomationEnrollment({ release, event, contact, now = Date.now(), id = crypto.randomUUID() } = {}) {
  if (!verifyAutomationRelease(release) || release.status !== 'published') throw new Error('A valid published workflow release is required');
  if (!event || event.tenantId !== release.tenantId || event.type !== release.triggerType) throw new Error('Trigger event must match the workflow tenant and trigger type');
  if (!contact || contact.tenantId !== release.tenantId) throw new Error('Contact must belong to the workflow tenant');
  const occurredAt = timestamp(event.occurredAt, 'event occurredAt');
  const current = timestamp(now, 'now');
  if (occurredAt > current + 60_000 || occurredAt < current - 30 * 86400000) throw new Error('Trigger event is outside the accepted replay window');
  const anchorAt = event.anchorAt == null ? occurredAt : timestamp(event.anchorAt, 'event anchorAt');
  if (anchorAt < current - 30 * 86400000 || anchorAt > current + 365 * 86400000) throw new Error('Event schedule anchor is outside the accepted 365-day window');
  const suppliedInputs = event.triggerInputs == null ? {} : event.triggerInputs;
  if (!suppliedInputs || typeof suppliedInputs !== 'object' || Array.isArray(suppliedInputs) || Object.keys(suppliedInputs).length > 32) throw new Error('Trigger inputs must be a bounded object');
  const triggerInputs = {};
  for (const [key, value] of Object.entries(suppliedInputs)) {
    if (!/^[a-z][a-zA-Z0-9_]{0,63}$/.test(key) || PRIVATE_INPUT_KEY.test(key)) throw new Error('Trigger input names must be safe non-secret identifiers');
    triggerInputs[key] = opaqueRef(value, `trigger input ${key}`);
  }
  if (release.triggerType === 'workflow.called' && !event.parentEnrollmentId) throw new Error('workflow.called events must come from a trusted parent workflow action');
  return {
    id: opaqueRef(id, 'enrollment id'), tenantId: release.tenantId,
    workflowId: release.id, workflowReleaseId: release.releaseId, workflowVersion: release.version,
    contactRef: opaqueRef(contact.id, 'contact id'), conversationRef: event.conversationRef == null ? null : opaqueRef(event.conversationRef, 'conversationRef'),
    sourceEventId: opaqueRef(event.id, 'event id'), triggerType: event.type,
    eventOccurredAt: new Date(occurredAt).toISOString(), eventAnchorAt: new Date(anchorAt).toISOString(),
    triggerInputs, parentEnrollmentId: event.parentEnrollmentId == null ? null : opaqueRef(event.parentEnrollmentId, 'parentEnrollmentId'),
    idempotencyKey: digest({ tenantId: release.tenantId, releaseId: release.releaseId, eventId: event.id, contactId: contact.id }),
    stepIndex: 0, status: 'queued', createdAt: new Date(current).toISOString(), nextRunAt: new Date(current).toISOString()
  };
}

export function claimAutomationEnrollment(store, enrollment) {
  if (!(store instanceof Map) || !enrollment?.tenantId || !enrollment?.idempotencyKey || !enrollment?.id) throw new Error('A Map and complete enrollment identity are required');
  const key = `${enrollment.tenantId}\u0000${enrollment.idempotencyKey}`;
  const existing = store.get(key);
  if (existing) return { accepted: false, existingEnrollmentId: existing };
  store.set(key, enrollment.id);
  return { accepted: true, existingEnrollmentId: enrollment.id };
}

function localWindowParts(epochMs, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epochMs));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday), minute: Number(values.hour) * 60 + Number(values.minute) };
}

function allowedByWindow(epochMs, window) {
  if (window.mode === 'anytime') return true;
  const local = localWindowParts(epochMs, window.timezone);
  return window.windows.some(item => item.days.includes(local.weekday) && local.minute >= item.startMinute && local.minute < item.endMinute);
}

function normalizeSendWindow(window) {
  if (!window || typeof window !== 'object' || Array.isArray(window)) throw new Error('policy sendWindow is required');
  if (window.mode === 'anytime') return { mode: 'anytime' };
  if (window.mode !== 'windows') throw new Error('policy sendWindow mode must be anytime or windows');
  const timezone = requiredText(window.timezone, 'sendWindow timezone', 100);
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0); } catch { throw new Error('sendWindow timezone must be a valid IANA timezone'); }
  if (!Array.isArray(window.windows) || !window.windows.length || window.windows.length > 70) throw new Error('sendWindow windows must contain 1-70 entries');
  const windows = window.windows.map(item => {
    if (!item || !Array.isArray(item.days) || !item.days.length || item.days.some(day => !Number.isSafeInteger(day) || day < 0 || day > 6)) throw new Error('sendWindow days must use 0-6');
    const parse = time => {
      if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('sendWindow times must use HH:MM');
      return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    };
    const startMinute = parse(item.start), endMinute = parse(item.end);
    if (startMinute >= endMinute) throw new Error('sendWindow periods must not cross midnight');
    return { days: [...new Set(item.days)].sort(), startMinute, endMinute };
  });
  return { mode: 'windows', timezone, windows };
}

function nextWindowTime(startAt, window) {
  if (allowedByWindow(startAt, window)) return startAt;
  const firstMinute = Math.ceil(startAt / 60_000) * 60_000;
  for (let offset = 0; offset <= 14 * 24 * 60; offset++) {
    const candidate = firstMinute + offset * 60_000;
    if (allowedByWindow(candidate, window)) return candidate;
  }
  return null;
}

const CONSENT_BASES = new Set(['explicit_consent', 'contract', 'legal_obligation', 'legitimate_interest', 'service_request']);

function policyFailure({ tenantId, contactId, channel, purpose, policyDecision, consentSnapshot, suppressionSnapshot, frequencySnapshot, now }) {
  if (!policyDecision || policyDecision.tenantId !== tenantId || policyDecision.contactId !== contactId || policyDecision.channel !== channel || policyDecision.purpose !== purpose) return 'policy_decision_scope_invalid';
  const checkedAt = Date.parse(policyDecision.checkedAt), expiresAt = Date.parse(policyDecision.expiresAt);
  if (policyDecision.eligible !== true) return 'policy_denied';
  if (!policyDecision.decisionId || !policyDecision.policyVersion || !Number.isFinite(checkedAt) || !Number.isFinite(expiresAt) || checkedAt > now + 60_000 || checkedAt < now - 15 * 60_000 || expiresAt <= now) return 'policy_decision_stale';
  if (!consentSnapshot || consentSnapshot.tenantId !== tenantId || consentSnapshot.contactId !== contactId || consentSnapshot.channel !== channel || consentSnapshot.purpose !== purpose || consentSnapshot.eligible !== true || !CONSENT_BASES.has(consentSnapshot.basis) || !consentSnapshot.revision) return 'consent_not_valid';
  if (purpose === 'marketing' && consentSnapshot.basis !== 'explicit_consent') return 'marketing_consent_required';
  const consentAt = Date.parse(consentSnapshot.checkedAt), consentExpires = Date.parse(consentSnapshot.expiresAt);
  if (!Number.isFinite(consentAt) || !Number.isFinite(consentExpires) || consentAt > now + 60_000 || consentAt < now - 15 * 60_000 || consentExpires <= now) return 'consent_snapshot_stale';
  if (!suppressionSnapshot || suppressionSnapshot.tenantId !== tenantId || suppressionSnapshot.contactId !== contactId || suppressionSnapshot.channel !== channel || typeof suppressionSnapshot.blocked !== 'boolean' || !suppressionSnapshot.revision) return 'suppression_check_unavailable';
  const suppressionAt = Date.parse(suppressionSnapshot.checkedAt);
  if (!Number.isFinite(suppressionAt) || suppressionAt > now + 60_000 || suppressionAt < now - 15 * 60_000) return 'suppression_check_stale';
  if (suppressionSnapshot.blocked) return 'contact_suppressed';
  if (!frequencySnapshot || frequencySnapshot.tenantId !== tenantId || frequencySnapshot.contactId !== contactId || frequencySnapshot.channel !== channel || frequencySnapshot.allowed !== true || !frequencySnapshot.windowId || !Number.isSafeInteger(frequencySnapshot.count) || !Number.isSafeInteger(frequencySnapshot.limit) || frequencySnapshot.count < 0 || frequencySnapshot.limit < 1 || frequencySnapshot.count >= frequencySnapshot.limit) return frequencySnapshot?.allowed === false ? 'frequency_limit_reached' : 'frequency_check_unavailable';
  const frequencyAt = Date.parse(frequencySnapshot.checkedAt);
  if (!Number.isFinite(frequencyAt) || frequencyAt > now + 60_000 || frequencyAt < now - 15 * 60_000) return 'frequency_check_stale';
  return null;
}

export function authorizeOutboundMessageAttempt({ intent, policyDecision, consentSnapshot, suppressionSnapshot, frequencySnapshot, now = Date.now() } = {}) {
  if (!intent || !['pending', 'scheduled'].includes(intent.status)) return { allowed: false, reason: 'message_not_pending', nextAttemptAt: null };
  const current = timestamp(now, 'now');
  if (Date.parse(intent.nextAttemptAt) > current) return { allowed: false, reason: 'message_not_due', nextAttemptAt: intent.nextAttemptAt };
  const reason = policyFailure({ tenantId: intent.tenantId, contactId: intent.contactId, channel: intent.channel, purpose: intent.purpose, policyDecision, consentSnapshot, suppressionSnapshot, frequencySnapshot, now: current });
  if (reason) return { allowed: false, reason, nextAttemptAt: null };
  if (consentSnapshot.revision !== intent.consentRevision) return { allowed: false, reason: 'consent_changed_after_enqueue', nextAttemptAt: null };
  if (policyDecision.approvalRequired === true && policyDecision.decisionId !== intent.policyDecisionId) return { allowed: false, reason: 'message_approval_stale', nextAttemptAt: null };
  let window;
  try { window = normalizeSendWindow(policyDecision.sendWindow); } catch { return { allowed: false, reason: 'send_window_invalid', nextAttemptAt: null }; }
  const allowedAt = nextWindowTime(current, window);
  if (allowedAt == null) return { allowed: false, reason: 'no_permitted_send_window', nextAttemptAt: null };
  if (allowedAt > current) return { allowed: false, reason: 'outside_send_window', nextAttemptAt: new Date(allowedAt).toISOString() };
  return { allowed: true, reason: null, nextAttemptAt: null };
}

export function createOutboundMessageIntent({
  tenantId, contactId, channel, purpose, templateRef, connectionRef,
  workflowReleaseId, enrollmentId, sourceEventId, stepId,
  policyDecision, consentSnapshot, suppressionSnapshot, frequencySnapshot, approvalEvidence = null,
  now = Date.now(), scheduledAt = now
} = {}) {
  const tenant = opaqueRef(tenantId, 'tenantId');
  const contact = opaqueRef(contactId, 'contactId');
  const channelName = requiredText(channel, 'channel', 32).toLowerCase();
  const purposeName = requiredText(purpose, 'purpose', 32).toLowerCase();
  if (!OUTBOUND_CHANNELS.includes(channelName) || !OUTBOUND_PURPOSES.includes(purposeName)) throw new Error('Outbound channel or purpose is unsupported');
  const template = normalizeTemplateRef(templateRef);
  const connection = opaqueRef(connectionRef, 'connectionRef');
  const release = opaqueRef(workflowReleaseId, 'workflowReleaseId');
  const enrollment = opaqueRef(enrollmentId, 'enrollmentId');
  const eventId = opaqueRef(sourceEventId, 'sourceEventId');
  const step = opaqueRef(stepId, 'stepId');
  const current = timestamp(now, 'now');
  const requestedAt = timestamp(scheduledAt, 'scheduledAt');
  if (requestedAt < current - 60_000) throw new Error('scheduledAt cannot be in the past');
  const denied = policyFailure({ tenantId: tenant, contactId: contact, channel: channelName, purpose: purposeName, policyDecision, consentSnapshot, suppressionSnapshot, frequencySnapshot, now: current });
  if (denied) return { allowed: false, reason: denied, intent: null };
  const sendWindow = normalizeSendWindow(policyDecision.sendWindow);
  const deliveryAt = nextWindowTime(requestedAt, sendWindow);
  if (deliveryAt == null) return { allowed: false, reason: 'no_permitted_send_window', intent: null };
  const identity = { tenantId: tenant, contactId: contact, channel: channelName, purpose: purposeName, templateRef: template, connectionRef: connection, workflowReleaseId: release, enrollmentId: enrollment, sourceEventId: eventId, stepId: step, requestedAt: new Date(requestedAt).toISOString(), deliveryAt: new Date(deliveryAt).toISOString(), policyDecisionId: opaqueRef(policyDecision.decisionId, 'policy decision id'), policyVersion: opaqueRef(policyDecision.policyVersion, 'policy version'), consentBasis: consentSnapshot.basis, consentRevision: opaqueRef(consentSnapshot.revision, 'consent revision'), suppressionRevision: opaqueRef(suppressionSnapshot.revision, 'suppression revision'), frequencyWindowId: opaqueRef(frequencySnapshot.windowId, 'frequency window id') };
  const intentHash = digest(identity);
  if (policyDecision.approvalRequired === true) {
    const issuedAt = Date.parse(approvalEvidence?.approvedAt), expiresAt = Date.parse(approvalEvidence?.expiresAt);
    if (!approvalEvidence || approvalEvidence.status !== 'approved' || approvalEvidence.tenantId !== tenant || approvalEvidence.intentHash !== intentHash || !approvalEvidence.approvalId || !Number.isFinite(issuedAt) || issuedAt > current + 60_000 || !Number.isFinite(expiresAt) || expiresAt <= current || expiresAt - issuedAt > 15 * 60_000) return { allowed: false, reason: 'message_approval_required', intent: null, intentHash };
  }
  const deliveryKey = digest({ tenantId: tenant, workflowReleaseId: release, enrollmentId: enrollment, sourceEventId: eventId, stepId: step, contactId: contact, channel: channelName });
  return {
    allowed: true, reason: null, intent: {
      id: `msg_${crypto.randomUUID().replaceAll('-', '')}`,
      ...identity, intentHash, deliveryKey,
      status: deliveryAt > current ? 'scheduled' : 'pending', attemptCount: 0,
      nextAttemptAt: new Date(deliveryAt).toISOString(), providerMessageRef: null,
      createdAt: new Date(current).toISOString(), updatedAt: new Date(current).toISOString()
    }
  };
}

export function recordProviderAttempt({ intent, result, now = Date.now(), maxAttempts = 6, random = Math.random } = {}) {
  if (!intent || !['pending', 'scheduled'].includes(intent.status)) throw new Error('Only pending or scheduled messages can be attempted');
  const current = timestamp(now, 'now');
  if (Date.parse(intent.nextAttemptAt) > current) throw new Error('Message is not due for delivery yet');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error('maxAttempts must be from 1 to 20');
  const attemptCount = intent.attemptCount + 1;
  const errorCode = result?.errorCode == null ? null : requiredText(result.errorCode, 'provider errorCode', 64).toLowerCase();
  if (errorCode && !SAFE_CODE.test(errorCode)) throw new Error('provider errorCode must be a safe reason code');
  const base = { ...intent, attemptCount, updatedAt: new Date(current).toISOString() };
  if (result?.status === 'accepted') {
    return { intent: { ...base, status: 'provider_accepted', providerMessageRef: providerRef(result.providerMessageRef, 'providerMessageRef'), acceptedAt: new Date(current).toISOString(), nextAttemptAt: null, lastErrorCode: null }, retry: false };
  }
  if (result?.status === 'permanent_failure') return { intent: { ...base, status: 'failed', nextAttemptAt: null, lastErrorCode: errorCode || 'provider_permanent_failure' }, retry: false };
  if (result?.status === 'transient_failure' && result.safeToRetry === true) {
    if (attemptCount >= maxAttempts) return { intent: { ...base, status: 'failed', nextAttemptAt: null, lastErrorCode: errorCode || 'retry_limit_reached' }, retry: false };
    const retryAfter = result.retryAfterMs == null ? 0 : result.retryAfterMs;
    if (!Number.isSafeInteger(retryAfter) || retryAfter < 0 || retryAfter > 3600000) throw new Error('retryAfterMs must be from 0 to one hour');
    const exponential = Math.min(3600000, 1000 * (2 ** Math.min(12, attemptCount - 1)));
    const jitter = typeof random === 'function' ? Number(random()) : NaN;
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) throw new Error('random source must return a number from 0 to 1');
    const delay = Math.max(retryAfter, Math.round(exponential * (0.8 + jitter * 0.4)));
    return { intent: { ...base, status: 'scheduled', nextAttemptAt: new Date(current + delay).toISOString(), lastErrorCode: errorCode || 'provider_transient_failure' }, retry: true };
  }
  if (result?.status === 'auth_error') return { intent: { ...base, status: 'needs_review', nextAttemptAt: null, lastErrorCode: errorCode || 'provider_auth_error' }, retry: false, connectorAction: 'pause_and_reauthorize' };
  return { intent: { ...base, status: 'needs_review', nextAttemptAt: null, lastErrorCode: errorCode || 'delivery_outcome_unknown' }, retry: false };
}

export function createProviderReceipt({ tenantId, channel, providerConnectionRef, providerEventId, providerMessageRef, status, bounceType = null, occurredAt, payloadHash } = {}) {
  const safeStatus = requiredText(status, 'receipt status', 32).toLowerCase();
  if (!['delivered', 'opened', 'clicked', 'replied', 'bounced', 'complaint', 'unsubscribed'].includes(safeStatus)) throw new Error('Provider receipt status is unsupported');
  const channelName = requiredText(channel, 'channel', 32).toLowerCase();
  if (!OUTBOUND_CHANNELS.includes(channelName)) throw new Error('Provider receipt channel is unsupported');
  if (safeStatus === 'bounced' && !['hard', 'soft'].includes(bounceType)) throw new Error('Bounced receipts must classify the provider bounce as hard or soft');
  const hash = payloadHash == null ? null : requiredText(payloadHash, 'payloadHash', 128);
  if (hash && !/^[a-f0-9]{64}$/i.test(hash)) throw new Error('payloadHash must be SHA-256 hex');
  return {
    id: `rcpt_${crypto.randomUUID().replaceAll('-', '')}`,
    tenantId: opaqueRef(tenantId, 'tenantId'), channel: channelName,
    providerConnectionRef: opaqueRef(providerConnectionRef, 'providerConnectionRef'),
    providerEventId: providerRef(providerEventId, 'providerEventId'), providerMessageRef: providerRef(providerMessageRef, 'providerMessageRef'),
    status: safeStatus, bounceType, occurredAt: new Date(timestamp(occurredAt, 'occurredAt')).toISOString(), payloadHash,
    receivedAt: new Date().toISOString()
  };
}

export function applyProviderReceipt({ intent, receipt } = {}) {
  if (!intent || !receipt || intent.tenantId !== receipt.tenantId || intent.channel !== receipt.channel || intent.connectionRef !== receipt.providerConnectionRef || intent.providerMessageRef !== receipt.providerMessageRef) throw new Error('Provider receipt does not match the outbound message tenant and destination');
  const progress = { delivered: 1, opened: 2, clicked: 3, replied: 4 };
  let status = intent.status;
  let suppressionUpdate = null;
  if (receipt.status === 'complaint' || receipt.status === 'unsubscribed' || (receipt.status === 'bounced' && receipt.bounceType === 'hard')) {
    status = 'suppressed';
    const source = receipt.status === 'bounced' ? 'hard_bounce' : receipt.status;
    suppressionUpdate = { tenantId: intent.tenantId, contactId: intent.contactId, channel: intent.channel, source, providerReceiptId: receipt.id };
  } else if (['bounced', 'failed', 'suppressed', 'canceled', 'needs_review'].includes(status)) {
    // A late webhook cannot resurrect a terminal delivery or erase a prior suppression.
  } else if (receipt.status === 'bounced') status = 'bounced';
  else if (progress[receipt.status] && (!progress[status] || progress[receipt.status] > progress[status])) status = receipt.status;
  return { intent: { ...intent, status, updatedAt: receipt.receivedAt, lastReceiptAt: receipt.occurredAt }, suppressionUpdate };
}

export function planAutomationStep({ release, enrollment, deliveryContext = null, now = Date.now() } = {}) {
  if (!verifyAutomationRelease(release) || release.status !== 'published' || enrollment?.tenantId !== release.tenantId || enrollment?.workflowReleaseId !== release.releaseId) throw new Error('Enrollment and published workflow release must share a valid tenant and release');
  const current = timestamp(now, 'now');
  if (enrollment.status === 'waiting' && Date.parse(enrollment.nextRunAt) > current) return { status: 'waiting', enrollment, action: null };
  if (enrollment.status !== 'queued' && enrollment.status !== 'waiting') throw new Error('Only queued or due waiting enrollments can advance');
  if (!Number.isSafeInteger(enrollment.stepIndex) || enrollment.stepIndex < 0 || enrollment.stepIndex > release.steps.length) throw new Error('Enrollment step cursor is invalid');
  if (enrollment.stepIndex === release.steps.length) return { status: 'completed', enrollment: { ...enrollment, status: 'completed', completedAt: new Date(current).toISOString() }, action: null };
  const step = release.steps[enrollment.stepIndex];
  const advance = { ...enrollment, stepIndex: enrollment.stepIndex + 1, updatedAt: new Date(current).toISOString() };
  if (step.type === 'wait') {
    const nextRunAt = new Date(current + step.delayMs).toISOString();
    return { status: 'waiting', enrollment: { ...advance, status: 'waiting', nextRunAt, waitingStepId: step.id }, action: null };
  }
  if (step.type === 'wait_until') {
    const nextRunAt = new Date(Math.max(current, Date.parse(enrollment.eventAnchorAt) + step.offsetMs)).toISOString();
    return { status: nextRunAt === new Date(current).toISOString() ? 'queued' : 'waiting', enrollment: { ...advance, status: nextRunAt === new Date(current).toISOString() ? 'queued' : 'waiting', nextRunAt, waitingStepId: step.id }, action: null };
  }
  if (step.type === 'branch') {
    const sources = { contactRef: enrollment.contactRef, conversationRef: enrollment.conversationRef, sourceEventId: enrollment.sourceEventId, triggerType: enrollment.triggerType, lastAgentOutcome: enrollment.lastAgentOutcome || null };
    if (step.source.startsWith('triggerInput.')) sources[step.source] = enrollment.triggerInputs?.[step.source.slice('triggerInput.'.length)] ?? null;
    const actual = sources[step.source] ?? null;
    const matched = step.operator === 'is_set' ? actual != null : step.operator === 'equals' ? actual === step.value : actual !== step.value;
    const nextId = matched ? step.thenStepId : step.elseStepId;
    const nextIndex = release.steps.findIndex(item => item.id === nextId);
    if (nextIndex < 0 || nextIndex <= enrollment.stepIndex) return { status: 'needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'branch_target_invalid', updatedAt: new Date(current).toISOString() }, action: null };
    return { status: 'queued', enrollment: { ...advance, stepIndex: nextIndex, status: 'queued', nextRunAt: new Date(current).toISOString(), lastBranchStepId: step.id, lastBranchMatched: matched }, action: null };
  }
  if (step.type === 'send_message') {
    const template = release.dependencyTemplateVersions?.find(item => item.id === step.templateRef.id && item.version === step.templateRef.version);
    if (!verifyMessageTemplateVersion(template) || template.tenantId !== enrollment.tenantId || template.channel !== step.channel || template.purpose !== step.purpose) return { status: 'needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'message_template_release_unavailable', updatedAt: new Date(current).toISOString() }, action: null };
    if (!deliveryContext) return { status: 'needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'message_policy_context_unavailable', updatedAt: new Date(current).toISOString() }, action: null };
    const planned = createOutboundMessageIntent({
      tenantId: enrollment.tenantId, contactId: enrollment.contactRef,
      channel: step.channel, purpose: step.purpose, templateRef: step.templateRef, connectionRef: step.connectionRef,
      workflowReleaseId: release.releaseId, enrollmentId: enrollment.id, sourceEventId: enrollment.sourceEventId, stepId: step.id,
      ...deliveryContext, now: current
    });
    if (!planned.allowed) return { status: 'needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: planned.reason, updatedAt: new Date(current).toISOString() }, action: null };
    return { status: 'waiting_delivery', enrollment: { ...advance, status: 'waiting_delivery', waitingDeliveryKey: planned.intent.deliveryKey, updatedAt: new Date(current).toISOString() }, action: { type: 'enqueue_message', intent: planned.intent } };
  }
  if (step.type === 'create_task') {
    const dueAt = new Date(current + step.dueInMs).toISOString();
    const taskIntent = { type: 'create_task', tenantId: enrollment.tenantId, contactRef: enrollment.contactRef, workflowReleaseId: release.releaseId, enrollmentId: enrollment.id, stepId: step.id, taskTemplateRef: step.taskTemplateRef, assignedToRef: step.assignedToRef, dueAt, idempotencyKey: digest({ tenantId: enrollment.tenantId, enrollmentId: enrollment.id, stepId: step.id }) };
    return { status: 'waiting_action', enrollment: { ...advance, status: 'waiting_action', waitingActionType: 'create_task', waitingActionKey: taskIntent.idempotencyKey, updatedAt: new Date(current).toISOString() }, action: taskIntent };
  }
  if (step.type === 'update_contact_field' || step.type === 'manage_contact_tag') {
    const actionType = step.type === 'update_contact_field' ? step.type : `${step.operation}_contact_tag`;
    const configHash = digest(step);
    const idempotencyKey = digest({ tenantId: enrollment.tenantId, workflowReleaseId: release.releaseId, enrollmentId: enrollment.id, stepId: step.id, actionType, configHash });
    const action = step.type === 'update_contact_field'
      ? { type: actionType, tenantId: enrollment.tenantId, contactRef: enrollment.contactRef, fieldRef: step.fieldRef, value: step.value, workflowReleaseId: release.releaseId, enrollmentId: enrollment.id, stepId: step.id, configHash, idempotencyKey }
      : { type: actionType, tenantId: enrollment.tenantId, contactRef: enrollment.contactRef, tagRef: step.tagRef, workflowReleaseId: release.releaseId, enrollmentId: enrollment.id, stepId: step.id, configHash, idempotencyKey };
    return { status: 'waiting_action', enrollment: { ...advance, status: 'waiting_action', waitingActionType: actionType, waitingActionKey: idempotencyKey, updatedAt: new Date(current).toISOString() }, action };
  }
  if (step.type === 'call_workflow') {
    const childRelease = release.dependencyReleases?.find(item => item.id === step.workflowRef.id && item.version === step.workflowRef.version);
    if (!childRelease || !verifyAutomationRelease(childRelease) || childRelease.tenantId !== enrollment.tenantId || childRelease.triggerType !== 'workflow.called') return { status: 'needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'subworkflow_release_unavailable', updatedAt: new Date(current).toISOString() }, action: null };
    const sources = {
      contactRef: enrollment.contactRef, conversationRef: enrollment.conversationRef,
      sourceEventId: enrollment.sourceEventId, triggerType: enrollment.triggerType,
      eventOccurredAt: enrollment.eventOccurredAt, eventAnchorAt: enrollment.eventAnchorAt
    };
    const triggerInputs = Object.fromEntries(Object.entries(step.inputMap).map(([key, source]) => [key, sources[source]]));
    if (Object.values(triggerInputs).some(value => value == null)) return { status: 'needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'subworkflow_input_unavailable', updatedAt: new Date(current).toISOString() }, action: null };
    const subEventId = `sub_${digest({ tenantId: enrollment.tenantId, enrollmentId: enrollment.id, stepId: step.id }).slice(0, 40)}`;
    const childEnrollment = createAutomationEnrollment({
      release: childRelease, now, id: `child_${digest({ tenantId: enrollment.tenantId, enrollmentId: enrollment.id, stepId: step.id }).slice(0, 32)}`,
      event: { id: subEventId, tenantId: enrollment.tenantId, type: 'workflow.called', occurredAt: new Date(current).toISOString(), anchorAt: new Date(current).toISOString(), conversationRef: enrollment.conversationRef, triggerInputs, parentEnrollmentId: enrollment.id },
      contact: { id: enrollment.contactRef, tenantId: enrollment.tenantId }
    });
    const action = { type: 'enqueue_subworkflow', tenantId: enrollment.tenantId, parentEnrollmentId: enrollment.id, workflowId: childRelease.id, workflowVersion: childRelease.version, workflowReleaseId: childRelease.releaseId, childEnrollment, idempotencyKey: childEnrollment.idempotencyKey };
    return { status: 'waiting_action', enrollment: { ...advance, status: 'waiting_action', waitingActionType: 'enqueue_subworkflow', waitingActionKey: action.idempotencyKey, childEnrollmentId: childEnrollment.id, updatedAt: new Date(current).toISOString() }, action };
  }
  if (step.type === 'invoke_agent') {
    const agentRelease = release.dependencyAgentReleases?.find(item => item.id === step.agentRef.deploymentId && item.releaseId === step.agentRef.releaseId && item.version === step.agentRef.version);
    if (!agentRelease || !verifyAgentDeploymentRelease(agentRelease) || agentRelease.tenantId !== enrollment.tenantId || !['canary', 'active'].includes(agentRelease.status)) return { status: 'needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'agent_release_unavailable', updatedAt: new Date(current).toISOString() }, action: null };
    const sources = { contactRef: enrollment.contactRef, conversationRef: enrollment.conversationRef, sourceEventId: enrollment.sourceEventId, triggerType: enrollment.triggerType, eventOccurredAt: enrollment.eventOccurredAt, eventAnchorAt: enrollment.eventAnchorAt };
    if (!enrollment.conversationRef) return { status: 'needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'agent_conversation_unavailable', updatedAt: new Date(current).toISOString() }, action: null };
    const inputRefs = Object.fromEntries(Object.entries(step.inputMap).map(([key, source]) => [key, sources[source]]));
    if (Object.values(inputRefs).some(value => value == null)) return { status: 'needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'agent_input_unavailable', updatedAt: new Date(current).toISOString() }, action: null };
    const idempotencyKey = digest({ tenantId: enrollment.tenantId, enrollmentId: enrollment.id, stepId: step.id, agentReleaseId: agentRelease.releaseId });
    const action = { type: 'invoke_customer_agent', tenantId: enrollment.tenantId, deploymentId: agentRelease.id, agentId: agentRelease.agentId, releaseId: agentRelease.releaseId, releaseVersion: agentRelease.version, conversationRef: enrollment.conversationRef, contactRef: enrollment.contactRef, sourceEventId: enrollment.sourceEventId, workflowReleaseId: release.releaseId, enrollmentId: enrollment.id, stepId: step.id, inputRefs, idempotencyKey };
    return { status: 'waiting_action', enrollment: { ...advance, status: 'waiting_action', waitingActionKey: idempotencyKey, waitingActionType: 'invoke_customer_agent', updatedAt: new Date(current).toISOString() }, action };
  }
  if (!enrollment.conversationRef) return { status: 'needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'reply_conversation_unavailable', updatedAt: new Date(current).toISOString() }, action: null };
  const startedAt = new Date(current).toISOString();
  const deadlineAt = new Date(current + step.timeoutMs).toISOString();
  return { status: 'waiting_reply', enrollment: { ...enrollment, status: 'waiting_reply', waitingStepId: step.id, replyStepId: step.replyStepId, timeoutStepId: step.timeoutStepId, replyStartedAt: startedAt, replyDeadlineAt: deadlineAt, updatedAt: startedAt }, action: null };
}

function routeReplyBranch(release, enrollment, stepId, now) {
  const targetIndex = release.steps.findIndex(step => step.id === stepId);
  if (targetIndex < 0) throw new Error('Reply branch references a missing workflow step');
  return { ...enrollment, status: 'queued', stepIndex: targetIndex, resumeAtStepId: stepId, nextRunAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
}

export function resumeAutomationReply({ release, enrollment, event, now = Date.now() } = {}) {
  if (!enrollment || enrollment.status !== 'waiting_reply') throw new Error('Enrollment is not waiting for a reply');
  if (!verifyAutomationRelease(release) || release.releaseId !== enrollment.workflowReleaseId || release.tenantId !== enrollment.tenantId) throw new Error('Reply must resume the same published workflow release');
  const current = timestamp(now, 'now');
  if (!event || event.type !== 'message.received' || event.tenantId !== enrollment.tenantId || event.contactRef !== enrollment.contactRef || event.conversationRef !== enrollment.conversationRef) return { accepted: false, reason: 'reply_scope_mismatch', enrollment };
  const repliedAt = timestamp(event.occurredAt, 'reply occurredAt');
  if (repliedAt > current + 60_000) return { accepted: false, reason: 'reply_timestamp_in_future', enrollment };
  if (repliedAt < Date.parse(enrollment.replyStartedAt)) return { accepted: false, reason: 'reply_before_wait', enrollment };
  const timedOut = repliedAt > Date.parse(enrollment.replyDeadlineAt);
  const nextId = timedOut ? enrollment.timeoutStepId : enrollment.replyStepId;
  return { accepted: !timedOut, reason: timedOut ? 'reply_timeout' : null, enrollment: routeReplyBranch(release, enrollment, nextId, current) };
}

export function advanceAutomationReplyTimeout({ release, enrollment, now = Date.now() } = {}) {
  if (!enrollment || enrollment.status !== 'waiting_reply') throw new Error('Enrollment is not waiting for a reply');
  if (!verifyAutomationRelease(release) || release.releaseId !== enrollment.workflowReleaseId || release.tenantId !== enrollment.tenantId) throw new Error('Timeout must resume the same published workflow release');
  const current = timestamp(now, 'now');
  if (current < Date.parse(enrollment.replyDeadlineAt)) return { advanced: false, reason: 'reply_timeout_not_due', enrollment };
  return { advanced: true, reason: null, enrollment: routeReplyBranch(release, enrollment, enrollment.timeoutStepId, current) };
}

export function resumeAutomationDelivery({ enrollment, intent, now = Date.now() } = {}) {
  if (!enrollment || enrollment.status !== 'waiting_delivery' || !intent || intent.tenantId !== enrollment.tenantId || intent.deliveryKey !== enrollment.waitingDeliveryKey) throw new Error('Delivery result does not match this tenant enrollment');
  const current = timestamp(now, 'now');
  if (['provider_accepted', 'delivered', 'opened', 'clicked', 'replied'].includes(intent.status)) return { resumed: true, reason: null, enrollment: { ...enrollment, status: 'queued', nextRunAt: new Date(current).toISOString(), updatedAt: new Date(current).toISOString() } };
  if (intent.status === 'scheduled') return { resumed: false, reason: 'delivery_retry_scheduled', enrollment };
  return { resumed: false, reason: 'delivery_needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: intent.lastErrorCode || intent.status, updatedAt: new Date(current).toISOString() } };
}

export function resumeAutomationTask({ enrollment, tenantId, idempotencyKey, succeeded, now = Date.now() } = {}) {
  if (!enrollment || enrollment.status !== 'waiting_action' || enrollment.waitingActionType !== 'create_task' || tenantId !== enrollment.tenantId || idempotencyKey !== enrollment.waitingActionKey || typeof succeeded !== 'boolean') throw new Error('Task result does not match this tenant enrollment');
  const current = timestamp(now, 'now');
  if (!succeeded) return { resumed: false, reason: 'task_action_failed', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'task_action_failed', updatedAt: new Date(current).toISOString() } };
  return { resumed: true, reason: null, enrollment: { ...enrollment, status: 'queued', nextRunAt: new Date(current).toISOString(), updatedAt: new Date(current).toISOString() } };
}

export function resumeAutomationContactAction({ enrollment, tenantId, idempotencyKey, actionType, succeeded, now = Date.now() } = {}) {
  if (!enrollment || enrollment.status !== 'waiting_action' || !['update_contact_field', 'add_contact_tag', 'remove_contact_tag'].includes(actionType) || enrollment.waitingActionType !== actionType || tenantId !== enrollment.tenantId || idempotencyKey !== enrollment.waitingActionKey || typeof succeeded !== 'boolean') throw new Error('Contact update result does not match this tenant enrollment');
  const current = timestamp(now, 'now');
  if (!succeeded) return { resumed: false, reason: 'contact_update_failed', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'contact_update_failed', updatedAt: new Date(current).toISOString() } };
  return { resumed: true, reason: null, enrollment: { ...enrollment, status: 'queued', nextRunAt: new Date(current).toISOString(), updatedAt: new Date(current).toISOString() } };
}

export function resumeAutomationSubworkflow({ enrollment, childEnrollment, tenantId, idempotencyKey, now = Date.now() } = {}) {
  if (!enrollment || enrollment.status !== 'waiting_action' || enrollment.waitingActionType !== 'enqueue_subworkflow' || tenantId !== enrollment.tenantId || idempotencyKey !== enrollment.waitingActionKey || !childEnrollment || childEnrollment.id !== enrollment.childEnrollmentId || childEnrollment.parentEnrollmentId !== enrollment.id || childEnrollment.tenantId !== tenantId) throw new Error('Sub-workflow result does not match this tenant enrollment');
  const current = timestamp(now, 'now');
  if (childEnrollment.status === 'completed') return { resumed: true, reason: null, enrollment: { ...enrollment, status: 'queued', nextRunAt: new Date(current).toISOString(), updatedAt: new Date(current).toISOString() } };
  if (['needs_review', 'canceled'].includes(childEnrollment.status)) return { resumed: false, reason: 'subworkflow_needs_review', enrollment: { ...enrollment, status: 'needs_review', lastReason: 'subworkflow_needs_review', updatedAt: new Date(current).toISOString() } };
  return { resumed: false, reason: 'subworkflow_not_complete', enrollment };
}

export function resumeAutomationAgent({ enrollment, tenantId, idempotencyKey, result, now = Date.now() } = {}) {
  if (!enrollment || enrollment.status !== 'waiting_action' || enrollment.waitingActionType !== 'invoke_customer_agent' || tenantId !== enrollment.tenantId || idempotencyKey !== enrollment.waitingActionKey || !result || result.tenantId !== tenantId || !['answered', 'human_handoff', 'needs_approval', 'failed'].includes(result.outcome)) throw new Error('Agent result does not match this tenant workflow action');
  const current = timestamp(now, 'now');
  if (result.outcome === 'failed') return { resumed: false, reason: 'agent_action_failed', enrollment: { ...enrollment, status: 'needs_review', lastReason: SAFE_CODE.test(result.reason || '') ? result.reason : 'agent_action_failed', updatedAt: new Date(current).toISOString() } };
  return { resumed: true, reason: null, enrollment: { ...enrollment, status: 'queued', nextRunAt: new Date(current).toISOString(), lastAgentOutcome: result.outcome, updatedAt: new Date(current).toISOString() } };
}

export const BUSINESS_AUTOMATION_RECIPES = Object.freeze([
  Object.freeze({ id: 'lead-tag-and-status', title: 'Tag a new lead and set its pipeline status', triggerType: 'form.submitted', category: 'lead-management', channels: Object.freeze(['crm-field', 'crm-tag', 'crm-task']), steps: Object.freeze([{ id: 'set-lead-status', type: 'update_contact_field' }, { id: 'tag-inbound-lead', type: 'manage_contact_tag' }, { id: 'owner-follow-up', type: 'create_task' }]) }),
  Object.freeze({ id: 'lead-speed-to-contact', title: 'Fast lead follow-up', triggerType: 'contact.created', category: 'lead-management', channels: Object.freeze(['email', 'sms', 'crm-task']), steps: Object.freeze([{ id: 'create-owner-task', type: 'create_task' }, { id: 'wait-briefly', type: 'wait' }, { id: 'send-welcome', type: 'send_message' }]) }),
  Object.freeze({ id: 'ai-lead-qualification', title: 'AI lead qualification and assignment', triggerType: 'form.submitted', category: 'lead-management', channels: Object.freeze(['webchat', 'crm-task']), steps: Object.freeze([{ id: 'qualify-lead', type: 'invoke_agent' }, { id: 'route-by-outcome', type: 'branch' }, { id: 'assign-sales-task', type: 'create_task' }]) }),
  Object.freeze({ id: 'appointment-reminders', title: 'Appointment reminders and confirmation', triggerType: 'appointment.booked', category: 'appointments', channels: Object.freeze(['email', 'sms']), steps: Object.freeze([{ id: 'remind-day-before', type: 'wait_until' }, { id: 'send-day-before', type: 'send_message' }, { id: 'remind-hour-before', type: 'wait_until' }, { id: 'send-hour-before', type: 'send_message' }]) }),
  Object.freeze({ id: 'missed-appointment-recovery', title: 'Missed appointment recovery', triggerType: 'appointment.no_show', category: 'appointments', channels: Object.freeze(['email', 'sms', 'crm-task']), steps: Object.freeze([{ id: 'recovery-task', type: 'create_task' }, { id: 'recovery-delay', type: 'wait' }, { id: 'recovery-message', type: 'send_message' }]) }),
  Object.freeze({ id: 'missed-call-textback', title: 'Missed-call text-back and callback task', triggerType: 'call.missed', category: 'customer-service', channels: Object.freeze(['sms', 'crm-task']), steps: Object.freeze([{ id: 'notify-caller', type: 'send_message' }, { id: 'callback-task', type: 'create_task' }]) }),
  Object.freeze({ id: 'voice-agent-follow-up', title: 'Voice-agent handoff and after-call follow-up', triggerType: 'call.transcript_generated', category: 'customer-service', channels: Object.freeze(['voice', 'email', 'crm-task']), steps: Object.freeze([{ id: 'summarize-call', type: 'invoke_agent' }, { id: 'route-call-outcome', type: 'branch' }, { id: 'human-follow-up', type: 'create_task' }]) }),
  Object.freeze({ id: 'review-request', title: 'Post-service review request', triggerType: 'appointment.completed', category: 'retention', channels: Object.freeze(['email', 'sms']), steps: Object.freeze([{ id: 'wait-for-service-completion', type: 'wait' }, { id: 'request-review', type: 'send_message' }]) }),
  Object.freeze({ id: 'failed-payment-follow-up', title: 'Failed-payment recovery', triggerType: 'payment.failed', category: 'billing', channels: Object.freeze(['email', 'crm-task']), steps: Object.freeze([{ id: 'billing-task', type: 'create_task' }, { id: 'billing-message', type: 'send_message' }]) }),
  Object.freeze({ id: 'abandoned-checkout', title: 'Abandoned-checkout recovery', triggerType: 'store.checkout_abandoned', category: 'ecommerce', channels: Object.freeze(['email', 'sms']), steps: Object.freeze([{ id: 'checkout-delay', type: 'wait' }, { id: 'checkout-reminder', type: 'send_message' }]) }),
  Object.freeze({ id: 'course-onboarding', title: 'Course enrollment onboarding', triggerType: 'course.signup', category: 'education', channels: Object.freeze(['email', 'crm-task']), steps: Object.freeze([{ id: 'welcome-learner', type: 'send_message' }, { id: 'learner-success-task', type: 'create_task' }]) })
]);
