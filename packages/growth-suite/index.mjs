import crypto from 'node:crypto';
import { createWorkflowGraph, verifyWorkflowGraph } from '../atlas-target/index.mjs';
import { createMessageTemplateVersion, verifyMessageTemplateVersion } from '../customer-operations/engagement.mjs';

export const GROWTH_MODULES = Object.freeze([
  'contacts', 'leads', 'pipelines', 'tasks', 'ai-qualification', 'ai-follow-up', 'workflows',
  'email-templates', 'funnels', 'websites', 'social-planner', 'affiliate-system', 'reputation-management'
]);

const CRM_MODULES = new Set(['contacts', 'leads', 'pipelines', 'tasks']);
const BUILDER_MODULES = new Set(['ai-qualification', 'ai-follow-up', 'workflows', 'email-templates', 'funnels', 'websites', 'social-planner', 'affiliate-system', 'reputation-management']);
const MODULE_READ = new Set(GROWTH_MODULES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHANNELS = new Set(['facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'google_business', 'threads', 'pinterest', 'bluesky']);
const HTML_ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

function fail(message, code = 'invalid_growth_input') { throw Object.assign(new Error(message), { code, status: 400 }); }
function text(value, field, max = 240, { empty = false } = {}) {
  if (typeof value !== 'string') fail(`${field} must be text`);
  const normalized = value.normalize('NFKC').trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  if ((!empty && !normalized) || normalized.length > max) fail(`${field} must be ${empty ? 'at most ' : '1 to '}${max} characters`);
  return normalized;
}
function ref(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) fail(`${field} must be a record reference`);
  return value.toLowerCase();
}
function date(value, field) {
  const time = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(time)) fail(`${field} must be a valid date`);
  return new Date(time).toISOString();
}
function plain(value) { return value != null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }

function copyJson(value, path = 'payload', depth = 0, state = { bytes: 0 }, seen = new WeakSet()) {
  if (depth > 8) fail(`${path} nesting is too deep`);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 20_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail(`${path} contains unsafe text`);
    state.bytes += Buffer.byteLength(value, 'utf8');
    if (state.bytes > 96_000) fail('Growth content exceeds 96 KB');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${path} must be finite`);
    return value;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) fail(`${path} must be acyclic JSON data`);
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (value.length > 150) fail(`${path} list exceeds 150 entries`);
    result = value.map((item, index) => copyJson(item, `${path}[${index}]`, depth + 1, state, seen));
  } else {
    if (!plain(value)) fail(`${path} must contain plain data`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 100 || keys.some(key => typeof key !== 'string' || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value') || ['__proto__', 'prototype', 'constructor'].includes(key))) fail(`${path} contains an unsafe property`);
    result = {};
    for (const key of keys) {
      state.bytes += Buffer.byteLength(key, 'utf8');
      if (state.bytes > 96_000) fail('Growth content exceeds 96 KB');
      result[key] = copyJson(descriptors[key].value, `${path}.${key}`, depth + 1, state, seen);
    }
  }
  seen.delete(value);
  return result;
}

function exactKeys(object, allowed, label) {
  if (!plain(object)) fail(`${label} must be an object`);
  const extra = Object.keys(object).filter(key => !allowed.includes(key));
  if (extra.length) fail(`${label} has unsupported fields: ${extra.join(', ')}`);
}
function pickList(value, field, max = 50) {
  if (!Array.isArray(value) || value.length > max) fail(`${field} must have at most ${max} entries`);
  const list = value.map(item => text(item, field, 120));
  if (new Set(list).size !== list.length) fail(`${field} cannot contain duplicates`);
  return list;
}
function titleFrom(module, payload) { return payload.fullName || payload.name || payload.title || payload.subject || payload.code || payload.company || module.replaceAll('-', ' '); }
function stable(value) { return JSON.stringify(sortKeys(value)); }
function sortKeys(value) { return Array.isArray(value) ? value.map(sortKeys) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])])) : value; }
function checksum(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function digestCopy(value) { return JSON.parse(JSON.stringify(value)); }

export function validateGrowthPayload({ module, tenantId, itemId, version = 1, payload, now = Date.now() } = {}) {
  if (!GROWTH_MODULES.includes(module)) fail('Unknown Growth Center module');
  ref(tenantId, 'workspace');
  const data = copyJson(payload);

  if (module === 'contacts') {
    exactKeys(data, ['firstName', 'lastName', 'email', 'phone', 'company', 'source', 'tags', 'timeZone', 'consent'], 'Contact');
    data.firstName = text(data.firstName, 'First name', 80);
    data.lastName = text(data.lastName || '', 'Last name', 80, { empty: true });
    if (data.email != null) {
      data.email = text(data.email, 'Email', 254).toLowerCase();
      if (!EMAIL.test(data.email)) fail('Email address is invalid');
    }
    if (data.phone != null) {
      data.phone = text(data.phone, 'Phone', 18);
      if (!/^\+[1-9]\d{7,14}$/.test(data.phone)) fail('Phone must use E.164 format');
    }
    if (!data.email && !data.phone) fail('A contact needs an email address or E.164 phone number');
    if (data.company != null) data.company = text(data.company, 'Company', 120);
    if (data.source != null) data.source = text(data.source, 'Source', 120);
    data.tags = data.tags == null ? [] : pickList(data.tags, 'Tags');
    if (data.timeZone != null) {
      data.timeZone = text(data.timeZone, 'Time zone', 80);
      try { new Intl.DateTimeFormat('en-US', { timeZone: data.timeZone }).format(now); } catch { fail('Time zone must be an IANA time zone'); }
    }
    data.consent = data.consent || { email: false, sms: false, whatsapp: false };
    exactKeys(data.consent, ['email', 'sms', 'whatsapp'], 'Contact consent');
    for (const channel of ['email', 'sms', 'whatsapp']) if (typeof data.consent[channel] !== 'boolean') fail(`Consent for ${channel} must be explicitly true or false`);
    return data;
  }

  if (module === 'leads') {
    exactKeys(data, ['contactId', 'pipelineId', 'stageId', 'status', 'source', 'score', 'valueMinor', 'currency', 'assignedTo', 'qualification'], 'Lead');
    data.contactId = ref(data.contactId, 'Contact');
    data.pipelineId = ref(data.pipelineId, 'Pipeline');
    data.stageId = text(data.stageId, 'Pipeline stage', 80);
    data.status = data.status || 'new';
    if (!['new', 'working', 'qualified', 'unqualified', 'won', 'lost'].includes(data.status)) fail('Lead status is unsupported');
    if (data.source != null) data.source = text(data.source, 'Lead source', 120);
    if (data.score != null && (!Number.isSafeInteger(data.score) || data.score < 0 || data.score > 100)) fail('Lead score must be 0-100');
    if (data.valueMinor != null && (!Number.isSafeInteger(data.valueMinor) || data.valueMinor < 0 || data.valueMinor > 2_000_000_000)) fail('Lead value must be non-negative minor currency units');
    data.currency = (data.currency || 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(data.currency)) fail('Lead currency must be an ISO 4217 code');
    if (data.assignedTo != null) data.assignedTo = ref(data.assignedTo, 'Assignee');
    if (data.qualification != null) {
      exactKeys(data.qualification, ['status', 'score', 'reasonCodes', 'evidenceRefs', 'evaluatedAt', 'releaseRef'], 'Qualification');
      if (!['not_run', 'pending', 'ready', 'needs_review', 'rejected'].includes(data.qualification.status)) fail('Qualification status is unsupported');
      if (data.qualification.score != null && (!Number.isSafeInteger(data.qualification.score) || data.qualification.score < 0 || data.qualification.score > 100)) fail('Qualification score must be 0-100');
      data.qualification.reasonCodes = pickList(data.qualification.reasonCodes || [], 'Reason codes', 24);
      data.qualification.evidenceRefs = (data.qualification.evidenceRefs || []).map((entry, index) => text(entry, `Evidence ${index + 1}`, 180));
      if (data.qualification.evaluatedAt) data.qualification.evaluatedAt = date(data.qualification.evaluatedAt, 'Evaluation time');
      if (data.qualification.releaseRef) data.qualification.releaseRef = ref(data.qualification.releaseRef, 'Agent release');
    }
    return data;
  }

  if (module === 'pipelines') {
    exactKeys(data, ['name', 'stages', 'rules'], 'Pipeline');
    data.name = text(data.name, 'Pipeline name', 120);
    if (!Array.isArray(data.stages) || data.stages.length < 2 || data.stages.length > 32) fail('Pipeline requires 2-32 stages');
    const seen = new Set();
    data.stages = data.stages.map((stage, index) => {
      exactKeys(stage, ['id', 'name', 'probability', 'isClosedWon', 'isClosedLost'], `Stage ${index + 1}`);
      const id = text(stage.id || `stage_${index + 1}`, 'Stage ID', 80);
      if (seen.has(id)) fail('Pipeline stages need unique IDs');
      seen.add(id);
      const probability = stage.probability == null ? 0 : stage.probability;
      if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) fail('Stage probability must be between 0 and 1');
      if (stage.isClosedWon === true && stage.isClosedLost === true) fail('A stage cannot be both won and lost');
      return { id, name: text(stage.name, 'Stage name', 80), position: index, probability, isClosedWon: stage.isClosedWon === true, isClosedLost: stage.isClosedLost === true };
    });
    data.rules = data.rules || { allowBackward: true, allowSkip: false, requireApprovalOnBackward: true };
    exactKeys(data.rules, ['allowBackward', 'allowSkip', 'requireApprovalOnBackward'], 'Pipeline rules');
    for (const key of ['allowBackward', 'allowSkip', 'requireApprovalOnBackward']) if (typeof data.rules[key] !== 'boolean') fail(`Pipeline rule ${key} must be boolean`);
    return data;
  }

  if (module === 'tasks') {
    exactKeys(data, ['title', 'description', 'status', 'priority', 'dueAt', 'assignedTo', 'contactId', 'leadId'], 'Task');
    data.title = text(data.title, 'Task title', 180);
    data.description = data.description == null ? '' : text(data.description, 'Task description', 4000, { empty: true });
    data.status = data.status || 'open';
    if (!['open', 'in_progress', 'blocked', 'completed', 'canceled'].includes(data.status)) fail('Task status is unsupported');
    data.priority = data.priority || 'normal';
    if (!['low', 'normal', 'high', 'urgent'].includes(data.priority)) fail('Task priority is unsupported');
    if (data.dueAt) data.dueAt = date(data.dueAt, 'Due date');
    if (data.assignedTo) data.assignedTo = ref(data.assignedTo, 'Assignee');
    if (data.contactId) data.contactId = ref(data.contactId, 'Contact');
    if (data.leadId) data.leadId = ref(data.leadId, 'Lead');
    if (!data.contactId && !data.leadId) fail('Task must be linked to a contact or lead');
    return data;
  }

  if (module === 'ai-qualification') {
    exactKeys(data, ['name', 'instructions', 'criteria', 'scoreBands', 'allowedReadTools', 'requireHumanReview'], 'AI lead qualification');
    data.name = text(data.name, 'Qualification name', 120);
    data.instructions = text(data.instructions, 'Instructions', 4000);
    if (!Array.isArray(data.criteria) || data.criteria.length < 1 || data.criteria.length > 20) fail('Qualification requires 1-20 criteria');
    data.criteria = data.criteria.map((criterion, index) => {
      exactKeys(criterion, ['id', 'label', 'weight', 'evidenceRequired'], `Criterion ${index + 1}`);
      const weight = criterion.weight;
      if (!Number.isSafeInteger(weight) || weight < 1 || weight > 100) fail('Criterion weight must be 1-100');
      return { id: text(criterion.id, 'Criterion ID', 48), label: text(criterion.label, 'Criterion label', 180), weight, evidenceRequired: criterion.evidenceRequired === true };
    });
    if (new Set(data.criteria.map(item => item.id)).size !== data.criteria.length || data.criteria.reduce((sum, item) => sum + item.weight, 0) !== 100) fail('Qualification criterion IDs must be unique and weights must total 100');
    data.scoreBands = data.scoreBands || [{ min: 0, max: 39, outcome: 'review' }, { min: 40, max: 69, outcome: 'nurture' }, { min: 70, max: 100, outcome: 'sales_ready' }];
    if (!Array.isArray(data.scoreBands) || data.scoreBands.length !== 3 || data.scoreBands.some(band => !Number.isSafeInteger(band.min) || !Number.isSafeInteger(band.max) || band.min < 0 || band.max > 100 || band.min > band.max || !['review', 'nurture', 'sales_ready'].includes(band.outcome))) fail('Qualification score bands are invalid');
    const bands = [...data.scoreBands].sort((left, right) => left.min - right.min);
    if (bands[0].min !== 0 || bands[2].max !== 100 || bands.some((band, index) => index > 0 && bands[index - 1].max + 1 !== band.min) || new Set(bands.map(band => band.outcome)).size !== 3) fail('Qualification score bands must cover 0-100 exactly once');
    data.allowedReadTools = data.allowedReadTools || [];
    if (!Array.isArray(data.allowedReadTools) || data.allowedReadTools.some(tool => !['read_contact', 'read_pipeline', 'search_knowledge'].includes(tool))) fail('Qualification can use only approved read tools');
    data.requireHumanReview = data.requireHumanReview !== false;
    return data;
  }

  if (module === 'ai-follow-up') {
    exactKeys(data, ['name', 'purpose', 'trigger', 'steps', 'stopOnReply', 'approvalRequired'], 'AI follow-up');
    data.name = text(data.name, 'Follow-up name', 120);
    if (!['transactional', 'service', 'marketing'].includes(data.purpose)) fail('Follow-up purpose is unsupported');
    if (!['lead.created', 'lead.qualified', 'appointment.missed', 'service.completed', 'payment.failed'].includes(data.trigger)) fail('Follow-up trigger is unsupported');
    if (!Array.isArray(data.steps) || data.steps.length < 1 || data.steps.length > 12) fail('Follow-up requires 1-12 steps');
    let previousDelay = -1;
    data.steps = data.steps.map((step, index) => {
      exactKeys(step, ['id', 'delayMinutes', 'channel', 'templateId', 'connectionId', 'approvalRequired'], `Follow-up step ${index + 1}`);
      if (!Number.isSafeInteger(step.delayMinutes) || step.delayMinutes < 0 || step.delayMinutes > 525_600 || step.delayMinutes < previousDelay) fail('Follow-up delays must be ordered and no longer than one year');
      previousDelay = step.delayMinutes;
      if (!['email', 'sms', 'whatsapp', 'webchat'].includes(step.channel)) fail('Follow-up channel is unsupported');
      if (step.channel === 'webchat' && step.delayMinutes > 0) fail('Scheduled follow-up requires a deliverable channel');
      return { id: text(step.id, 'Step ID', 48), delayMinutes: step.delayMinutes, channel: step.channel, templateId: ref(step.templateId, 'Message template'), connectionId: ref(step.connectionId, 'Provider connection'), approvalRequired: step.approvalRequired !== false };
    });
    if (new Set(data.steps.map(item => item.id)).size !== data.steps.length) fail('Follow-up step IDs must be unique');
    data.stopOnReply = data.stopOnReply !== false;
    data.approvalRequired = data.approvalRequired !== false;
    return data;
  }

  if (module === 'workflows') {
    exactKeys(data, ['name', 'graph'], 'Workflow');
    const graphInput = data.graph;
    exactKeys(graphInput, ['nodes', 'edges'], 'Workflow graph');
    let graph;
    try { graph = createWorkflowGraph({ tenantId, id: itemId, version, name: data.name, nodes: graphInput.nodes, edges: graphInput.edges }); }
    catch { fail('Workflow graph is invalid. Check its node settings, trigger, connections and terminal paths.', 'invalid_workflow_graph'); }
    return { name: graph.name, graph };
  }

  if (module === 'email-templates') {
    exactKeys(data, ['name', 'channel', 'purpose', 'locale', 'subject', 'body', 'format'], 'Email template');
    data.name = text(data.name, 'Template name', 120);
    data.channel = data.channel || 'email';
    if (data.channel !== 'email') fail('Email Builder creates email templates; other channels use approved message templates');
    if (!['marketing', 'service', 'transactional'].includes(data.purpose)) fail('Email purpose is unsupported');
    data.locale = data.locale || 'en-US';
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(data.locale)) fail('Locale must be a bounded language tag');
    data.subject = text(data.subject, 'Subject', 200);
    if (/[\r\n]/.test(data.subject)) fail('Email subject must be one line');
    data.body = text(data.body, 'Email body', 30_000);
    data.format = data.format || 'plain_text';
    if (!['plain_text', 'html'].includes(data.format)) fail('Email format is unsupported');
    if (data.format === 'html' && /<(?:script|style|iframe|object|form|img|svg|video|audio|table|div|span|input|button)\b|\son[a-z]+\s*=|javascript:/i.test(data.body)) fail('Email HTML contains unsupported active content');
    return data;
  }

  if (module === 'funnels' || module === 'websites') {
    exactKeys(data, ['name', 'slug', 'title', 'description', 'blocks', 'seo'], module === 'funnels' ? 'Funnel' : 'Website');
    data.name = text(data.name, 'Page name', 120);
    data.slug = text(data.slug, 'Page slug', 80).toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)) fail('Page slug must use lowercase letters, numbers and hyphens');
    data.title = text(data.title || data.name, 'Page title', 100);
    data.description = text(data.description || '', 'Page description', 300, { empty: true });
    if (!Array.isArray(data.blocks) || data.blocks.length < 1 || data.blocks.length > 50) fail('Page requires 1-50 content blocks');
    const allowedBlocks = new Set(['hero', 'text', 'benefits', 'lead_form', 'faq', 'testimonial', 'pricing', 'call_to_action']);
    data.blocks = data.blocks.map((block, index) => {
      exactKeys(block, ['id', 'type', 'heading', 'body', 'items', 'buttonLabel', 'buttonUrl'], `Page section ${index + 1}`);
      if (!allowedBlocks.has(block.type)) fail('Page section type is unsupported');
      const out = { id: text(block.id || `section_${index + 1}`, 'Section ID', 48), type: block.type, heading: text(block.heading || '', 'Section heading', 160, { empty: true }), body: text(block.body || '', 'Section body', 4000, { empty: true }) };
      if (block.items != null) out.items = pickList(block.items, 'Section items', 20);
      if (block.buttonLabel != null) out.buttonLabel = text(block.buttonLabel, 'Button label', 80);
      if (block.buttonUrl != null) {
        let link;
        try { link = new URL(text(block.buttonUrl, 'Button URL', 2048)); } catch { fail('Button links must use HTTPS'); }
        if (link.protocol !== 'https:' || link.username || link.password) fail('Button links must use HTTPS');
        out.buttonUrl = link.toString();
      }
      if (block.type === 'lead_form' && (block.buttonLabel || block.buttonUrl)) fail('Lead forms use Atlas form handling; external button links are not accepted');
      return out;
    });
    if (new Set(data.blocks.map(item => item.id)).size !== data.blocks.length) fail('Section IDs must be unique');
    data.seo = data.seo || { indexable: false, title: data.title, description: data.description };
    exactKeys(data.seo, ['indexable', 'title', 'description'], 'Page SEO');
    if (typeof data.seo.indexable !== 'boolean') fail('Indexing must be explicitly selected');
    data.seo.title = text(data.seo.title || data.title, 'SEO title', 100);
    data.seo.description = text(data.seo.description || data.description, 'SEO description', 300, { empty: true });
    return data;
  }

  if (module === 'social-planner') {
    exactKeys(data, ['name', 'channels', 'caption', 'mediaRefs', 'scheduledAt', 'approvalRequired'], 'Social post');
    data.name = text(data.name, 'Post name', 120);
    if (!Array.isArray(data.channels) || data.channels.length < 1 || data.channels.length > CHANNELS.size || data.channels.some(channel => !CHANNELS.has(channel))) fail('Choose supported social channels');
    data.channels = [...new Set(data.channels)];
    data.caption = text(data.caption, 'Post caption', 5000);
    data.mediaRefs = data.mediaRefs == null ? [] : data.mediaRefs.map((media, index) => ref(media, `Media item ${index + 1}`));
    if (data.scheduledAt) data.scheduledAt = date(data.scheduledAt, 'Schedule time');
    data.approvalRequired = data.approvalRequired !== false;
    return data;
  }

  if (module === 'affiliate-system') {
    exactKeys(data, ['name', 'code', 'commissionBps', 'attributionDays', 'currency', 'landingUrl', 'terms'], 'Affiliate campaign');
    data.name = text(data.name, 'Campaign name', 120);
    data.code = text(data.code, 'Campaign code', 32).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(data.code)) fail('Campaign code must be 3-32 letters, numbers, hyphens or underscores');
    if (!Number.isSafeInteger(data.commissionBps) || data.commissionBps < 0 || data.commissionBps > 10_000) fail('Commission must be 0-10000 basis points');
    if (!Number.isSafeInteger(data.attributionDays) || data.attributionDays < 1 || data.attributionDays > 365) fail('Attribution window must be 1-365 days');
    data.currency = (data.currency || 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(data.currency)) fail('Affiliate currency must be an ISO 4217 code');
    if (data.landingUrl) {
      let url;
      try { url = new URL(text(data.landingUrl, 'Landing URL', 2048)); } catch { fail('Landing URL must use HTTPS'); }
      if (url.protocol !== 'https:' || url.username || url.password) fail('Landing URL must use HTTPS');
      data.landingUrl = url.toString();
    }
    data.terms = text(data.terms || '', 'Terms', 3000, { empty: true });
    return data;
  }

  if (module === 'reputation-management') {
    exactKeys(data, ['name', 'requestTemplateId', 'channels', 'eligibilityRule', 'incentiveOffered', 'responseTemplate'], 'Reputation management');
    data.name = text(data.name, 'Review campaign name', 120);
    data.requestTemplateId = ref(data.requestTemplateId, 'Review request template');
    if (!Array.isArray(data.channels) || data.channels.length < 1 || data.channels.some(channel => !['email', 'sms'].includes(channel))) fail('Review requests may use email or SMS');
    data.channels = [...new Set(data.channels)];
    data.eligibilityRule = data.eligibilityRule || 'all_completed_customers';
    if (data.eligibilityRule !== 'all_completed_customers') fail('Review requests must be offered consistently to all eligible completed customers');
    if (data.incentiveOffered === true) fail('Review incentives are not allowed in reputation campaigns');
    data.incentiveOffered = false;
    data.responseTemplate = text(data.responseTemplate || '', 'Response template', 4000, { empty: true });
    return data;
  }

  fail(`Growth module ${module} has no payload validator`);
}

/**
 * Apply a transparent, deterministic rubric to evidence supplied by an authorized
 * operator. This is a rules evaluation, not an LLM call or a substitute for human review.
 */
export function scoreLeadQualification({ profile, ratings, evidenceRefs = {}, now = Date.now() } = {}) {
  if (!plain(profile) || !Array.isArray(profile.criteria) || !Array.isArray(profile.scoreBands)) fail('A valid qualification profile is required');
  const safeRatings = copyJson(ratings, 'ratings');
  const safeEvidence = copyJson(evidenceRefs, 'evidence references');
  if (!plain(safeRatings) || !plain(safeEvidence)) fail('Ratings and evidence references must be objects');
  const criterionIds = new Set(profile.criteria.map(item => item.id));
  if (Object.keys(safeRatings).some(id => !criterionIds.has(id)) || Object.keys(safeEvidence).some(id => !criterionIds.has(id))) fail('Evaluation contains an unknown qualification criterion');
  for (const [id, rating] of Object.entries(safeRatings)) if (!Number.isSafeInteger(rating) || rating < 0 || rating > 100) fail(`Rating for ${id} must be an integer from 0 to 100`);
  for (const [id, evidence] of Object.entries(safeEvidence)) safeEvidence[id] = text(evidence, `Evidence reference for ${id}`, 180);

  let weighted = 0;
  const missing = [];
  const low = [];
  const scoreBreakdown = [];
  for (const criterion of profile.criteria) {
    const rating = safeRatings[criterion.id];
    const evidence = safeEvidence[criterion.id];
    if (rating == null || (criterion.evidenceRequired && !evidence)) missing.push(criterion.id);
    if (rating != null) weighted += rating * criterion.weight;
    if (rating != null && rating < 50) low.push(criterion.id);
    scoreBreakdown.push({ criterionId: criterion.id, rating: rating ?? null, weight: criterion.weight, evidenceRef: evidence || null });
  }
  const score = Math.round(weighted / 100);
  const band = profile.scoreBands.find(item => score >= item.min && score <= item.max);
  if (!band) fail('Qualification profile has no score band for this result');
  const status = missing.length || profile.requireHumanReview || band.outcome === 'review' ? 'needs_review' : band.outcome === 'sales_ready' ? 'ready' : 'pending';
  const reasonCodes = [
    ...missing.map(id => `missing_evidence:${id}`),
    ...low.map(id => `below_threshold:${id}`),
    `band:${band.outcome}`
  ].slice(0, 24);
  return Object.freeze({
    status, outcome: band.outcome, score, reasonCodes, evidenceRefs: Object.values(safeEvidence),
    evaluatedAt: new Date(now).toISOString(), breakdown: scoreBreakdown
  });
}

export function planLeadStageMove({ lead, pipeline, stageId } = {}) {
  if (!verifyGrowthRecord(lead) || lead.module !== 'leads' || !verifyGrowthRecord(pipeline) || pipeline.module !== 'pipelines' || lead.tenantId !== pipeline.tenantId || lead.payload.pipelineId !== pipeline.id) fail('Lead and pipeline scope or integrity is invalid', 'growth_scope_invalid');
  const nextIndex = pipeline.payload.stages.findIndex(stage => stage.id === stageId);
  const currentIndex = pipeline.payload.stages.findIndex(stage => stage.id === lead.payload.stageId);
  if (nextIndex < 0 || currentIndex < 0) fail('Choose a stage from the lead pipeline');
  if (nextIndex === currentIndex) return Object.freeze({ changed: false, lead });
  const difference = nextIndex - currentIndex;
  if (difference < 0 && !pipeline.payload.rules.allowBackward) fail('This pipeline does not allow backward stage movement', 'stage_move_blocked');
  if (difference < 0 && pipeline.payload.rules.requireApprovalOnBackward) fail('Backward movement requires a separate approval workflow', 'stage_move_approval_required');
  if (Math.abs(difference) > 1 && !pipeline.payload.rules.allowSkip) fail('This pipeline requires leads to move one stage at a time', 'stage_skip_blocked');
  const stage = pipeline.payload.stages[nextIndex];
  const status = stage.isClosedWon ? 'won' : stage.isClosedLost ? 'lost' : ['won', 'lost'].includes(lead.payload.status) ? 'working' : lead.payload.status;
  return Object.freeze({ changed: true, stageId: stage.id, status, stageName: stage.name, direction: difference > 0 ? 'forward' : 'backward' });
}

export function createGrowthRecord({ tenantId, module, id = crypto.randomUUID(), version = 1, payload, actorId, now = Date.now() } = {}) {
  ref(id, 'Growth record');
  ref(actorId, 'Actor');
  if (!Number.isSafeInteger(version) || version < 1) fail('Growth version must be positive');
  const content = validateGrowthPayload({ tenantId, module, itemId: id, version, payload, now });
  const createdAt = new Date(now).toISOString();
  const state = CRM_MODULES.has(module) ? module === 'tasks' ? content.status : 'active' : 'draft';
  const body = { id, tenantId, module, title: text(titleFrom(module, content), 'Title', 180), state, version, payload: content, actorId, createdAt, updatedAt: createdAt };
  return Object.freeze({ ...body, checksum: checksum(body) });
}

export function verifyGrowthRecord(record) {
  if (!record || typeof record !== 'object' || !GROWTH_MODULES.includes(record.module) || !/^[a-f0-9]{64}$/.test(String(record.checksum || ''))) return false;
  const { checksum: digestValue, ...body } = record;
  return checksum(body) === digestValue;
}

export function updateGrowthRecord({ record, tenantId, actorId, expectedVersion, payload, now = Date.now() } = {}) {
  if (!verifyGrowthRecord(record) || record.tenantId !== tenantId) fail('Growth record scope or checksum is invalid', 'growth_scope_invalid');
  if (record.version !== expectedVersion) throw Object.assign(new Error('Growth record changed. Reload and try again.'), { code: 'version_conflict', status: 409 });
  if (BUILDER_MODULES.has(record.module) && !['draft', 'paused'].includes(record.state)) fail('Published content must be paused before editing', 'published_record_locked');
  if (record.module === 'tasks' && ['completed', 'canceled'].includes(record.state)) fail('Completed or canceled tasks cannot be edited', 'terminal_task_locked');
  const content = validateGrowthPayload({ module: record.module, tenantId, itemId: record.id, version: record.version + 1, payload, now });
  const next = { ...record, title: text(titleFrom(record.module, content), 'Title', 180), state: record.module === 'tasks' ? content.status : record.state, version: record.version + 1, payload: content, actorId, updatedAt: new Date(now).toISOString() };
  const { checksum: oldDigest, ...body } = next;
  return Object.freeze({ ...body, checksum: checksum(body) });
}

export function transitionGrowthRecord({ record, tenantId, actorId, action, expectedVersion, publisherAuthority = null, verifiedDomain = false, now = Date.now() } = {}) {
  if (!verifyGrowthRecord(record) || record.tenantId !== tenantId) fail('Growth record scope or checksum is invalid', 'growth_scope_invalid');
  if (record.version !== expectedVersion) throw Object.assign(new Error('Growth record changed. Reload and try again.'), { code: 'version_conflict', status: 409 });
  let state = record.state;
  let payload = digestCopy(record.payload);
  const current = Number(now);
  if (action === 'publish') {
    if (record.state !== 'draft' && record.state !== 'paused') fail('Only a draft or paused asset can be published');
    if (record.module === 'workflows') {
      if (!verifyWorkflowGraph(payload.graph) || payload.graph.tenantId !== tenantId) fail('Workflow graph integrity check failed');
    } else if (record.module === 'email-templates') {
      const template = createMessageTemplateVersion({ tenantId, id: record.id, version: record.version + 1, channel: 'email', purpose: payload.purpose, locale: payload.locale, subjectTemplate: payload.subject, bodyTemplate: payload.body, bodyFormat: payload.format, publisherAuthority, now: current });
      if (!verifyMessageTemplateVersion(template)) fail('Email template integrity check failed');
      payload = { ...payload, publishedVersion: template.version, publishedChecksum: template.checksum };
    } else if (['funnels', 'websites'].includes(record.module)) {
      if (payload.seo.indexable && !verifiedDomain) fail('Indexing and publication require a verified workspace domain', 'verified_domain_required');
      if (!verifiedDomain) fail('Publication requires a verified workspace domain', 'verified_domain_required');
      payload = { ...payload, publishedAt: new Date(current).toISOString() };
    } else if (record.module === 'social-planner') {
      if (!payload.scheduledAt || Date.parse(payload.scheduledAt) <= current) fail('Schedule the post for a future time before publishing');
      payload = { ...payload, approvalStatus: payload.approvalRequired ? 'pending' : 'approved' };
      state = 'scheduled';
    } else if (record.module === 'reputation-management') {
      if (payload.eligibilityRule !== 'all_completed_customers' || payload.incentiveOffered) fail('Reputation policy failed');
    } else if (!BUILDER_MODULES.has(record.module)) fail('This record type cannot be published');
    if (state !== 'scheduled') state = 'published';
  } else if (action === 'pause') {
    if (!['published', 'scheduled'].includes(record.state)) fail('Only published or scheduled assets can be paused');
    state = 'paused';
  } else if (action === 'archive') {
    if (record.state === 'archived') return record;
    state = 'archived';
  } else if (action === 'complete' && record.module === 'tasks') {
    if (record.state === 'completed' || record.state === 'canceled') fail('This task is already terminal');
    state = 'completed'; payload.status = 'completed';
  } else if (action === 'approve' && record.module === 'social-planner') {
    if (record.state !== 'scheduled' || payload.approvalStatus !== 'pending') fail('This social post is not awaiting approval');
    payload = { ...payload, approvalStatus: 'approved', approvedAt: new Date(current).toISOString(), approvedBy: ref(actorId, 'Approver') };
  } else if (action === 'cancel' && record.module === 'tasks') {
    if (['completed', 'canceled'].includes(record.state)) fail('This task is already terminal');
    state = 'canceled'; payload.status = 'canceled';
  } else fail('Unsupported Growth Center action');
  const next = { ...record, title: text(titleFrom(record.module, payload), 'Title', 180), state, version: record.version + 1, payload, actorId, updatedAt: new Date(current).toISOString() };
  const { checksum: oldDigest, ...body } = next;
  return Object.freeze({ ...body, checksum: checksum(body) });
}

export function calculateAffiliateCommission({ amountMinor, commissionBps, currency, paid = true } = {}) {
  if (!paid) return { status: 'ineligible', commissionMinor: 0, currency };
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !Number.isSafeInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000 || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) fail('Affiliate conversion amount is invalid');
  return { status: 'pending_review', commissionMinor: Math.floor(amountMinor * commissionBps / 10_000), currency };
}

export function renderGrowthPagePreview({ record, tenantId } = {}) {
  if (!verifyGrowthRecord(record) || record.tenantId !== tenantId || !['funnels', 'websites'].includes(record.module)) fail('Page preview scope or integrity is invalid');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
  const sections = record.payload.blocks.map(block => {
    const heading = block.heading ? `<h2>${escape(block.heading)}</h2>` : '';
    const body = block.body ? `<p>${escape(block.body)}</p>` : '';
    const list = block.items?.length ? `<ul>${block.items.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : '';
    const button = block.buttonLabel ? `<a href="${escape(block.buttonUrl || '#lead-form')}">${escape(block.buttonLabel)}</a>` : '';
    const form = block.type === 'lead_form' ? '<form id="lead-form"><label>Name<input autocomplete="name" required></label><label>Email<input type="email" autocomplete="email" required></label><button type="submit">Request a reply</button></form>' : '';
    return `<section data-block="${escape(block.type)}">${heading}${body}${list}${button}${form}</section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(record.payload.title)}</title><meta name="description" content="${escape(record.payload.description)}"><style>body{font:16px/1.6 system-ui,sans-serif;max-width:900px;margin:0 auto;padding:2rem;color:#172033}section{padding:2rem 0;border-bottom:1px solid #ddd}h1{font-size:2.5rem}a,button{display:inline-block;padding:.7rem 1rem;background:#5346c8;color:white;border-radius:.5rem;text-decoration:none}form{display:grid;gap:.8rem;max-width:400px}input{padding:.7rem;border:1px solid #aaa;border-radius:.4rem}</style></head><body><h1>${escape(record.payload.title)}</h1>${sections}</body></html>`;
}

export function growthModuleExists(module) { return MODULE_READ.has(module); }
