import crypto from 'node:crypto';
import { WORKFLOW_NODE_CATALOG, WORKFLOW_NODE_TYPES, WORKFLOW_TRIGGER_CATALOG } from './workflow-catalog.mjs';

const sha = value => crypto.createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
const canon = value => Array.isArray(value) ? value.map(canon) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canon(value[key])])) : value;
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const text = (value, label, max = 180) => { if (typeof value !== 'string' || !value.trim() || value.length > max || /[\r\n\u0000]/.test(value)) throw new Error(label + ' must be bounded text'); return value.trim(); };
const reference = (value, label) => text(value, label, 180);
const timestamp = (value, label) => { const parsed = typeof value === 'number' ? value : Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(label + ' must be a valid timestamp'); return parsed; };

export const CRM_OBJECT_TYPES = Object.freeze(['contact','company','lead','deal','ticket','task','note','appointment','custom']);
export const CRM_PROPERTY_TYPES = Object.freeze(['text','number','boolean','date','datetime','select','multi_select']);

function crmValue(schema, value, key) {
  if (schema.type === 'text' && typeof value !== 'string') throw new Error(key + ' must be text');
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(key + ' must be a finite number');
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(key + ' must be boolean');
  if ((schema.type === 'date' || schema.type === 'datetime') && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) throw new Error(key + ' must be a valid timestamp');
  if (schema.type === 'select' && !schema.options.includes(value)) throw new Error(key + ' must use an allowed option');
  if (schema.type === 'multi_select' && (!Array.isArray(value) || value.length > 50 || value.some(item => !schema.options.includes(item)))) throw new Error(key + ' must use allowed options');
  if (typeof value === 'string' && value.length > 5000) throw new Error(key + ' is too large');
  return Array.isArray(value) ? [...new Set(value)] : value;
}

function crmProperties(properties, schemas = new Map()) {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties) || Object.keys(properties).length > 100) throw new Error('CRM properties are invalid');
  const out = {};
  for (const [key, value] of Object.entries(properties)) {
    text(key, 'property key', 80);
    out[key] = schemas.has(key) ? crmValue(schemas.get(key), value, key) : value;
  }
  for (const [key, schema] of schemas) if (schema.required && !(key in out)) throw new Error('Required CRM property missing: ' + key);
  return out;
}

export function defineCrmProperty({ key, type, label, required = false, options = [] } = {}) {
  const propertyKey = text(key, 'property key', 80).toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(propertyKey) || !CRM_PROPERTY_TYPES.includes(type)) throw new Error('Invalid CRM property schema');
  const normalizedOptions = [...new Set((Array.isArray(options) ? options : []).map(option => text(option, 'property option', 120)))];
  if (['select','multi_select'].includes(type) && (!normalizedOptions.length || normalizedOptions.length > 100)) throw new Error('Select properties require 1-100 options');
  if (!['select','multi_select'].includes(type) && normalizedOptions.length) throw new Error('Options only apply to select properties');
  return freeze({ key: propertyKey, type, label: text(label || key, 'property label', 120), required: Boolean(required), options: normalizedOptions });
}

export function createCrmRecord({ tenantId, type, id = crypto.randomUUID(), version = 1, properties = {}, schemas = new Map(), dedupeKey = null } = {}) {
  if (!CRM_OBJECT_TYPES.includes(type)) throw new Error('Unsupported CRM object type');
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Record version must be positive');
  const tenant = reference(tenantId, 'tenantId');
  const recordId = reference(id, 'record id');
  if (dedupeKey != null && !/^[a-f0-9]{16,128}$/i.test(text(dedupeKey, 'dedupeKey', 200))) throw new Error('dedupeKey must be a non-reversible hash reference');
  const now = new Date().toISOString();
  const body = { id: recordId, tenantId: tenant, type, version, properties: crmProperties(properties, schemas), dedupeKey, archived: false, createdAt: now, updatedAt: now };
  return freeze({ ...body, checksum: sha(body) });
}

export function verifyCrmRecord(record) {
  if (!record || typeof record !== 'object' || !CRM_OBJECT_TYPES.includes(record.type) || typeof record.checksum !== 'string') return false;
  const { checksum, ...body } = record;
  return /^[a-f0-9]{64}$/i.test(checksum) && sha(body) === checksum;
}

export function updateCrmRecord({ record, tenantId, expectedVersion, patch, schemas = new Map() } = {}) {
  if (!verifyCrmRecord(record)) throw new Error('CRM record checksum invalid');
  if (record.tenantId !== tenantId) throw new Error('Record tenant mismatch');
  if (expectedVersion !== record.version) throw Object.assign(new Error('CRM record version conflict'), { code: 'VERSION_CONFLICT' });
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length > 100) throw new Error('CRM patch is invalid');
  const properties = { ...record.properties };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      if (schemas.get(key)?.required) throw new Error('Required CRM property cannot be removed: ' + key);
      delete properties[key];
    } else properties[key] = schemas.has(key) ? crmValue(schemas.get(key), value, key) : value;
  }
  for (const [key, schema] of schemas) if (schema.required && !(key in properties)) throw new Error('Required CRM property missing: ' + key);
  const next = { ...record, properties, version: record.version + 1, updatedAt: new Date().toISOString() };
  const { checksum, ...body } = next;
  return freeze({ ...body, checksum: sha(body) });
}

export function createCrmAssociation({ tenantId, fromType, fromId, toType, toId, label = 'associated', metadata = {} } = {}) {
  if (!CRM_OBJECT_TYPES.includes(fromType) || !CRM_OBJECT_TYPES.includes(toType)) throw new Error('Association object type invalid');
  if (fromType === toType && fromId === toId) throw new Error('Self association is not allowed');
  const body = { id: crypto.randomUUID(), tenantId: reference(tenantId, 'tenantId'), fromType, fromId: reference(fromId, 'fromId'), toType, toId: reference(toId, 'toId'), label: text(label, 'association label', 80), metadata };
  return freeze({ ...body, checksum: sha(body) });
}

export function createCrmPipeline({ tenantId, id, name, stages, rules = {} } = {}) {
  if (!Array.isArray(stages) || stages.length < 2 || stages.length > 100) throw new Error('Pipeline requires 2-100 stages');
  const seen = new Set();
  const normalized = stages.map((stage, index) => {
    const stageId = reference(stage?.id || ('stage_' + (index + 1)), 'stage id');
    if (seen.has(stageId)) throw new Error('Duplicate pipeline stage');
    seen.add(stageId);
    return { id: stageId, name: text(stage?.name || stageId, 'stage name', 120), position: index, probability: Number.isFinite(stage?.probability) ? Math.max(0, Math.min(1, stage.probability)) : 0, isClosedWon: Boolean(stage?.isClosedWon), isClosedLost: Boolean(stage?.isClosedLost) };
  });
  const policy = { allowBackward: true, allowSkip: true, requireApprovalOnBackward: false, ...rules };
  for (const key of ['allowBackward','allowSkip','requireApprovalOnBackward']) if (typeof policy[key] !== 'boolean') throw new Error('Pipeline rule must be boolean');
  const body = { tenantId: reference(tenantId, 'tenantId'), id: reference(id, 'pipeline id'), name: text(name, 'pipeline name', 120), stages: normalized, rules: policy };
  return freeze({ ...body, checksum: sha(body) });
}

export function transitionCrmDeal({ deal, pipeline, toStageId, expectedVersion, approval = null } = {}) {
  if (!verifyCrmRecord(deal) || deal.type !== 'deal') throw new Error('Pipeline transitions require a valid deal');
  if (!pipeline || deal.tenantId !== pipeline.tenantId) throw new Error('Pipeline and deal tenant mismatch');
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== deal.version) throw Object.assign(new Error('CRM record version conflict'), { code: 'VERSION_CONFLICT' });
  const current = pipeline.stages.find(stage => stage.id === deal.properties?.stage_id);
  const target = pipeline.stages.find(stage => stage.id === toStageId);
  if (!target) throw new Error('Target pipeline stage does not exist');
  if (current) {
    if (!pipeline.rules.allowBackward && target.position < current.position) throw new Error('Backward stage movement is disabled');
    if (!pipeline.rules.allowSkip && Math.abs(target.position - current.position) > 1) throw new Error('Skipping pipeline stages is disabled');
    if (pipeline.rules.requireApprovalOnBackward && target.position < current.position && approval?.status !== 'approved') return { status: 'needs_approval', fromStageId: current.id, toStageId: target.id };
  }
  return { status: 'updated', deal: updateCrmRecord({ record: deal, tenantId: pipeline.tenantId, expectedVersion, patch: { stage_id: target.id } }), transition: { fromStageId: current?.id || null, toStageId: target.id } };
}

export function searchCrm({ records, tenantId, type, query = '', filters = {}, limit = 50, cursor = null } = {}) {
  if (!Array.isArray(records) || records.length > 10000) throw new Error('CRM search record set is too large');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('CRM search limit must be 1-200');
  if (type != null && !CRM_OBJECT_TYPES.includes(type)) throw new Error('CRM search type invalid');
  const safeTenant = reference(tenantId, 'tenantId');
  const q = String(query || '').trim().toLowerCase().slice(0, 200);
  const rows = records.filter(record => record && verifyCrmRecord(record) && record.tenantId === safeTenant && (!type || record.type === type))
    .filter(record => Object.entries(filters || {}).every(([key, value]) => record.properties?.[key] === value))
    .filter(record => !q || (record.id + ' ' + record.type + ' ' + JSON.stringify(record.properties)).toLowerCase().includes(q))
    .sort((a,b) => a.id.localeCompare(b.id));
  const start = cursor ? Math.max(0, rows.findIndex(record => record.id === cursor) + 1) : 0;
  const page = rows.slice(start, start + limit);
  return { items: page, nextCursor: page.length === limit ? page[page.length - 1].id : null };
}

export { WORKFLOW_NODE_CATALOG, WORKFLOW_NODE_TYPES, WORKFLOW_TRIGGER_CATALOG, WORKFLOW_TRIGGER_TYPES } from './workflow-catalog.mjs';

const PRIVATE_CONFIG_FIELD = /password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|credential|authorization|cookie|private[_-]?key|raw[_-]?body|message[_-]?body|transcript|recording/i;
const DIRECT_DESTINATION_FIELD = /^(?:email|phone|phone_number|recipient|recipient_email|recipient_phone|to|to_email|to_phone)$/i;
const NETWORK_LOCATION_FIELD = /^(?:url|uri|host|hostname|endpoint_url|callback_url)$/i;
const CONFIG_REFERENCE_PHONE = /[+()\s]/;

function opaqueWorkflowReference(value, label) {
  const result = reference(value, label);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result);
  const numericAddress = /^[+\d(). -]+$/.test(result) && (result.match(/\d/g) || []).length >= 7;
  const phoneLike = CONFIG_REFERENCE_PHONE.test(result) && (result.match(/\d/g) || []).length >= 7;
  if (/@/.test(result) || /^https?:\/\//i.test(result) || !uuid && (numericAddress || phoneLike)) throw new Error(label + ' must be an opaque reference, not a direct address or URL');
  return result;
}

function copyWorkflowConfig(value, path = 'config', depth = 0, state = { bytes:0 }, seen = new WeakSet()) {
  if (depth > 8) throw new Error('Workflow config nesting exceeds limit');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 8192 || /\u0000/.test(value)) throw new Error(path + ' string is invalid or too large');
    state.bytes += Buffer.byteLength(value, 'utf8');
    if (state.bytes > 32768) throw new Error('Workflow node config exceeds 32 KB');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(path + ' must be finite');
    return value;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) throw new Error(path + ' must be acyclic JSON data');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error(path + ' list exceeds 100 items');
    result = value.map((item, index) => copyWorkflowConfig(item, path + '[' + index + ']', depth + 1, state, seen));
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error(path + ' must be a plain object');
    const symbols = Object.getOwnPropertySymbols(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).filter(key => descriptors[key].enumerable);
    if (symbols.length || keys.length > 100) throw new Error(path + ' object is invalid or too large');
    result = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value')) throw new Error(path + ' cannot contain accessors');
      if (['__proto__','prototype','constructor'].includes(key)) throw new Error('Unsafe workflow config key');
      if (PRIVATE_CONFIG_FIELD.test(key)) throw new Error('Workflow config cannot contain credential or private-content fields');
      if (DIRECT_DESTINATION_FIELD.test(key)) throw new Error('Workflow config must use contact references, not direct recipient data');
      if (NETWORK_LOCATION_FIELD.test(key)) throw new Error('Workflow config must use an approved connection reference, not a network location');
      if (key.length > 100) throw new Error(path + ' key is too large');
      state.bytes += Buffer.byteLength(key, 'utf8');
      if (state.bytes > 32768) throw new Error('Workflow node config exceeds 32 KB');
      result[key] = copyWorkflowConfig(descriptor.value, path + '.' + key, depth + 1, state, seen);
    }
  }
  seen.delete(value);
  return result;
}

const NODE_REFERENCE_FIELDS = Object.freeze({
  find_contact:['queryRef'], create_contact:['sourceRef'], copy_contact:['contactRef','targetWorkspaceRef'], delete_contact:['contactRef'], assign_contact:['contactRef','assigneeRef'], remove_contact_assignment:['contactRef'], manage_contact_followers:['contactRef'], update_engagement_score:['contactRef','scoreRef'],
  set_contact_dnd:['contactRef'], add_note:['contactRef','noteTemplateRef'], edit_conversation:['conversationRef'],
  create_opportunity:['contactRef','pipelineRef'], update_opportunity:['opportunityRef'], remove_opportunity:['opportunityRef','pipelineRef'],
  create_task:['taskTemplateRef'], set_custom_value:['valueRef'], generate_booking_link:['calendarRef','contactRef'],
  update_appointment_status:['appointmentRef'], call_contact:['contactRef','connectionRef'], manual_action:['taskTemplateRef'],
  reply_social_comment:['commentRef','contentRef','connectionRef'], send_document_contract:['documentTemplateRef','contactRef','connectionRef'],
  ai_generate:['promptRef'], send_analytics_event:['conversionRef','connectionRef'],
  send_message:['templateRef','connectionRef'], reply_in_conversation:['conversationRef','templateRef','connectionRef'], notify_internal:['recipientRef'],
  webhook:['connectionRef','operationRef'], http_request:['connectionRef','operationRef'], spreadsheet_upsert:['connectionRef','resourceRef'],
  send_review_request:['contactRef','templateRef','connectionRef'], create_payment_link:['customerRef','priceRef','connectionRef'],
  send_invoice:['invoiceRef','connectionRef'], issue_refund:['paymentRef','connectionRef'], publish_social_post:['contentRef','connectionRef'],
  charge_payment:['customerRef','amountPolicyRef','connectionRef'], add_to_audience:['audienceRef','contactRef','connectionRef'], remove_from_audience:['audienceRef','contactRef','connectionRef'],
  add_google_ads_audience:['audienceRef','contactRef','connectionRef'], remove_google_ads_audience:['audienceRef','contactRef','connectionRef'], facebook_conversion_event:['conversionRef','connectionRef'],
  record_conversion:['conversionRef','connectionRef'], affiliate_action:['affiliateRef','connectionRef'], update_affiliate:['affiliateRef','connectionRef'], manage_affiliate_campaign:['affiliateRef','campaignRef','connectionRef'], grant_course_access:['memberRef','offerRef'],
  revoke_course_access:['memberRef','offerRef'], set_community_access:['memberRef','groupRef'], ivr_transfer_call:['callSessionRef','routeRef'],
  ivr_gather_input:['callSessionRef'], ivr_play_message:['callSessionRef','contentRef'], ivr_transfer_call:['callSessionRef','routeRef'], ivr_connect_call:['callSessionRef','routeRef'], ivr_end_call:['callSessionRef'], record_voicemail:['callSessionRef'],
  sub_workflow:['workflowReleaseRef'], execute_subworkflow:['workflowReleaseRef'], data_table:['tableRef'], mcp_client:['serverRef','operationRef'], mcp_server_trigger:['serverRef'], chat_trigger:['channelRef'], schedule_trigger:['scheduleRef'], form_trigger:['formRef'], evaluation_trigger:['evaluationRef'], guardrails:['policyRef'], respond_to_webhook:['responseRef']
});

function validateWorkflowNodeConfig(type, config) {
  if (type === 'trigger') {
    if (typeof config.eventType !== 'string' || !Object.hasOwn(WORKFLOW_TRIGGER_CATALOG, config.eventType)) throw new Error('trigger requires a supported eventType');
  }
  if (type === 'send_message') {
    if (!['email','sms','whatsapp','facebook','instagram','google_business','webchat','voice'].includes(config.channel)) throw new Error('send_message channel unsupported');
    if (typeof config.templateRef !== 'string' || typeof config.connectionRef !== 'string') throw new Error('send_message requires templateRef and connectionRef');
    opaqueWorkflowReference(config.templateRef, 'send_message templateRef');
    opaqueWorkflowReference(config.connectionRef, 'send_message connectionRef');
  }
  if (type === 'notify_internal') {
    if (!['email','slack','in_app','web_push'].includes(config.channel)) throw new Error('notify_internal channel unsupported');
    if (typeof config.recipientRef !== 'string' || !config.recipientRef.trim()) throw new Error('notify_internal requires recipientRef');
    if (['email','slack'].includes(config.channel)) opaqueWorkflowReference(config.connectionRef, 'notify_internal connectionRef');
  }
  if (['find_availability','book_appointment','reschedule_appointment','cancel_appointment'].includes(type) && typeof config.calendarRef !== 'string') throw new Error(type + ' requires calendarRef');
  if (type === 'invoke_agent' && typeof config.agentReleaseRef !== 'string') throw new Error('invoke_agent requires agentReleaseRef');
  for (const field of NODE_REFERENCE_FIELDS[type] || []) {
    opaqueWorkflowReference(config[field], type + ' ' + field);
  }
  if (['delay','wait_until'].includes(type) && (!Number.isSafeInteger(config.delayMs ?? config.offsetMs) || Math.abs(config.delayMs ?? config.offsetMs) > 365 * 86400000)) throw new Error(type + ' duration is invalid');
  if (type === 'split_batches' && (!Number.isSafeInteger(config.batchSize) || config.batchSize < 1 || config.batchSize > 1000)) throw new Error('split_batches batchSize must be 1-1000');
  if (type === 'rate_limit_batch' && (!Number.isSafeInteger(config.batchSize) || config.batchSize < 1 || config.batchSize > 1000 || !Number.isSafeInteger(config.intervalMs) || config.intervalMs < 100 || config.intervalMs > 86400000)) throw new Error('rate_limit_batch bounds are invalid');
  if (['condition','switch','random_split'].includes(type) && (!Array.isArray(config.cases) || config.cases.length < 1 || config.cases.length > 32)) throw new Error(type + ' requires 1-32 cases');
  if (type === 'loop_over_items') {
    if (!Number.isSafeInteger(config.batchSize) || config.batchSize < 1 || config.batchSize > 100) throw new Error('loop_over_items batchSize must be 1-100');
    if (!Number.isSafeInteger(config.maxItems) || config.maxItems < 1 || config.maxItems > 10000) throw new Error('loop_over_items maxItems must be 1-10000');
    if (config.maxIterations !== undefined && (!Number.isSafeInteger(config.maxIterations) || config.maxIterations < 1 || config.maxIterations > 10000)) throw new Error('loop_over_items maxIterations must be 1-10000');
  }
  if (['aggregate','remove_duplicates','sort','split_out'].includes(type) && config.maxItems !== undefined && (!Number.isSafeInteger(config.maxItems) || config.maxItems < 1 || config.maxItems > 10000)) throw new Error(type + ' maxItems must be 1-10000');
  if (type === 'respond_to_webhook') {
    if (!Number.isSafeInteger(config.statusCode) || config.statusCode < 100 || config.statusCode > 599) throw new Error('respond_to_webhook statusCode must be 100-599');
    opaqueWorkflowReference(config.responseRef, 'respond_to_webhook responseRef');
  }
  if (type === 'stop_and_error') {
    if (typeof config.errorCode !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/.test(config.errorCode)) throw new Error('stop_and_error errorCode is invalid');
    if (typeof config.message !== 'string' || !config.message.trim() || config.message.length > 500 || /[\\r\\n\\u0000]/.test(config.message)) throw new Error('stop_and_error message is invalid');
  }
  if (type === 'execution_data') {
    if (typeof config.key !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/.test(config.key)) throw new Error('execution_data key is invalid');
    if (JSON.stringify(config.value ?? null).length > 1000) throw new Error('execution_data value is too large');
  }
  if (type === 'code_transform') {
    if (typeof config.expression !== 'string' || !config.expression.trim() || config.expression.length > 4000) throw new Error('code_transform requires a bounded expression');
    if (/(require\\s*\\(|child_process|process\\.|eval\\s*\\(|Function\\s*\\(|fetch\\s*\\(|axios\\s*\\()/i.test(config.expression)) throw new Error('code_transform does not allow executable or network code');
  }
  if (type === 'error_trigger' && config.errorCode !== undefined && (typeof config.errorCode !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/.test(config.errorCode))) throw new Error('error_trigger errorCode is invalid');
}

function normalizeNode(node, index) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Node ' + (index + 1) + ' is invalid');
  const id = reference(node.id || ('node_' + (index + 1)), 'node id');
  const type = text(node.type, 'node type', 48);
  const definition = WORKFLOW_NODE_CATALOG[type];
  if (!definition) throw new Error('Unsupported node type: ' + type);
  if (node.config != null && (!node.config || typeof node.config !== 'object' || Array.isArray(node.config))) throw new Error('Node config must be a plain object');
  const config = copyWorkflowConfig(node.config || {});
  validateWorkflowNodeConfig(type, config);
  const retry = node.retry == null ? {} : copyWorkflowConfig(node.retry, 'retry');
  if (!retry || typeof retry !== 'object' || Array.isArray(retry)) throw new Error('Node retry policy must be an object');
  const maxAttempts = retry.maxAttempts === undefined ? 3 : retry.maxAttempts;
  const backoffMs = retry.backoffMs === undefined ? 500 : retry.backoffMs;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 || !Number.isSafeInteger(backoffMs) || backoffMs < 100 || backoffMs > 60000) throw new Error('Node retry policy is outside safe limits');
  const timeoutMs = node.timeoutMs === undefined ? 30000 : node.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600000) throw new Error('Node timeout must be 1000-600000 ms');
  return { id, type, name: text(node.name || id, 'node name', 120), config, category:definition.category, risk: definition.risk, guard: definition.guard || null, execution:definition.execution, retrySafe:definition.retrySafe, requiresAdapter:definition.requiresAdapter, requiresApproval: Boolean(definition.requiresApproval), retry: { maxAttempts, backoffMs }, timeoutMs };
}

function cycle(nodes, edges) {
  const graph = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) graph.get(edge.from).push(edge.to);
  const visiting = new Set(), visited = new Set();
  const visit = id => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); for (const next of graph.get(id) || []) if (visit(next)) return true; visiting.delete(id); visited.add(id); return false; };
  return nodes.some(node => visit(node.id));
}

export function createWorkflowGraph({ tenantId, id = crypto.randomUUID(), version = 1, name, nodes, edges } = {}) {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Workflow version must be positive');
  if (!Array.isArray(nodes) || nodes.length < 2 || nodes.length > 150) throw new Error('Workflow nodes out of bounds');
  if (!Array.isArray(edges) || edges.length < 1 || edges.length > 300) throw new Error('Workflow edges out of bounds');
  const normalized = nodes.map(normalizeNode);
  const ids = new Set(normalized.map(node => node.id));
  if (ids.size !== normalized.length) throw new Error('Workflow node IDs must be unique');
  const safeEdges = edges.map((edge, index) => {
    if (!edge || typeof edge !== 'object' || edge.from === edge.to || !ids.has(edge.from) || !ids.has(edge.to)) throw new Error('Workflow edge ' + (index + 1) + ' is invalid');
    return { id: reference(edge.id || ('edge_' + (index + 1)), 'edge id'), from: reference(edge.from, 'edge from'), to: reference(edge.to, 'edge to'), port: text(edge.port || 'next', 'edge port', 40) };
  });
  if (new Set(safeEdges.map(edge => edge.id)).size !== safeEdges.length) throw new Error('Workflow edge IDs must be unique');
  const triggers = normalized.filter(node => node.type === 'trigger');
  if (triggers.length !== 1) throw new Error('Workflow requires exactly one trigger');
  if (cycle(normalized, safeEdges)) throw new Error('Workflow graph cannot contain cycles');
  const outgoing = new Map(normalized.map(node => [node.id, []]));
  for (const edge of safeEdges) outgoing.get(edge.from).push(edge.to);
  const reachable = new Set([triggers[0].id]), queue = [triggers[0].id];
  while (queue.length) for (const target of outgoing.get(queue.shift()) || []) if (!reachable.has(target)) { reachable.add(target); queue.push(target); }
  if (reachable.size !== normalized.length) throw new Error('Workflow graph contains unreachable nodes');
  if (!normalized.some(node => node.type === 'stop' || outgoing.get(node.id).length === 0)) throw new Error('Workflow requires a terminal node');
  const body = { tenantId: reference(tenantId, 'tenantId'), id: reference(id, 'workflow id'), version, name: text(name || id, 'workflow name', 120), nodes: normalized.sort((a,b) => a.id.localeCompare(b.id)), edges: safeEdges.sort((a,b) => a.id.localeCompare(b.id)) };
  return freeze({ ...body, checksum: sha(body) });
}

export function verifyWorkflowGraph(graph) {
  if (!graph || typeof graph.checksum !== 'string') return false;
  const { checksum, ...body } = graph;
  return /^[a-f0-9]{64}$/.test(checksum) && sha(body) === checksum;
}

function copyWorkflowApprovalEvidence(evidence) {
  const allowed = new Set(['status','approvalId','tenantId','graphChecksum','executionId','nodeId','idempotencyKey','requestedByActorId','approvedByActorId','approvedAt','expiresAt','signature','signatureRef']);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || Object.getPrototypeOf(evidence) !== Object.prototype || Object.getOwnPropertySymbols(evidence).length) return null;
  const descriptors = Object.getOwnPropertyDescriptors(evidence);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > allowed.size || keys.some(key => typeof key !== 'string' || !allowed.has(key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}

export function planWorkflowNode({ graph, nodeId, tenantId, executionId, attempt = 1, approvalEvidence = null, approvalVerifier = null, requestedByActorId = null, now = Date.now() } = {}) {
  if (!verifyWorkflowGraph(graph) || graph.tenantId !== tenantId) throw new Error('Workflow graph tenant or checksum invalid');
  const node = graph.nodes.find(item => item.id === nodeId);
  if (!node) throw new Error('Workflow node not found');
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 10) throw new Error('Attempt must be 1-10');
  const stableExecutionId = reference(executionId, 'executionId');
  const currentTime = Number(now);
  if (!Number.isFinite(currentTime) || !Number.isFinite(new Date(currentTime).getTime())) throw new Error('now must be a valid timestamp');
  if (attempt > node.retry.maxAttempts) throw new Error('Attempt exceeds this node retry limit');
  // The key identifies the logical side effect. Including attempt here would
  // turn every retry into a second provider command and can double-send.
  const idempotencyKey = sha({ tenantId, graphChecksum: graph.checksum, executionId:stableExecutionId, nodeId });
  if (attempt > 1 && !node.retrySafe) return { status:'retry_blocked', reason:'node_not_idempotent', nodeId, idempotencyKey, attempt, risk:node.risk, guard:node.guard, retrySafe:false };
  const safeApproval = copyWorkflowApprovalEvidence(approvalEvidence);
  const approvedAt = Date.parse(safeApproval?.approvedAt);
  const expiresAt = Date.parse(safeApproval?.expiresAt);
  const evidenceScopeMatches = safeApproval?.status === 'approved' &&
    typeof safeApproval.approvalId === 'string' && safeApproval.approvalId.trim().length > 0 &&
    safeApproval.tenantId === tenantId && safeApproval.graphChecksum === graph.checksum &&
    safeApproval.executionId === stableExecutionId && safeApproval.nodeId === nodeId &&
    safeApproval.idempotencyKey === idempotencyKey &&
    typeof safeApproval.approvedByActorId === 'string' && safeApproval.approvedByActorId.trim().length > 0 &&
    Number.isFinite(approvedAt) && Number.isFinite(expiresAt) && approvedAt <= currentTime + 60_000 &&
    expiresAt > currentTime && expiresAt - approvedAt <= 15 * 60_000 &&
    (!requestedByActorId || safeApproval.requestedByActorId === requestedByActorId) &&
    (!requestedByActorId || safeApproval.approvedByActorId !== requestedByActorId);
  let trustedApproval = false;
  if (evidenceScopeMatches && typeof approvalVerifier === 'function') {
    try { trustedApproval = approvalVerifier(safeApproval, { tenantId, graphChecksum:graph.checksum, executionId:stableExecutionId, nodeId, idempotencyKey, requestedByActorId }) === true; }
    catch { trustedApproval = false; }
  }
  const metadata = { nodeId, idempotencyKey, attempt, category:node.category, risk:node.risk, guard:node.guard, execution:node.execution, requiresAdapter:node.requiresAdapter, retrySafe:node.retrySafe, timeoutMs:node.timeoutMs, retry:node.retry };
  if (node.requiresApproval && !trustedApproval) return { status:'needs_approval', approvalReason: typeof approvalVerifier === 'function' ? 'approval_evidence_untrusted_or_invalid' : 'trusted_approval_verifier_required', ...metadata };
  return { status:'planned', ...metadata, requiresApproval:node.requiresApproval };
}

export function summarizeWorkflowExecution({ executionId, tenantId, status = 'completed', steps = [] } = {}) {
  if (!executionId || !tenantId || !Array.isArray(steps) || steps.length > 500) throw new Error('Execution summary input is invalid');
  const counts = { completed:0, failed:0, waiting:0, skipped:0, needs_approval:0 }; let retries = 0;
  for (const step of steps) { if (step?.status in counts) counts[step.status]++; retries += Number.isSafeInteger(step?.retryCount) ? Math.max(0, step.retryCount) : 0; }
  return { executionId, tenantId, status, counts, retries, headline: counts.failed ? (counts.failed + ' node(s) failed') : counts.needs_approval ? (counts.needs_approval + ' node(s) await approval') : (counts.completed + ' node(s) completed'), steps: steps.map(step => ({ nodeId: step.nodeId || null, status: step.status || 'unknown', durationMs: Number.isFinite(step.durationMs) ? Math.max(0, step.durationMs) : 0, reason: step.reason || null })) };
}

function calendarZone(timeZone) { const zone = text(timeZone, 'timeZone', 100); try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0); } catch { throw new Error('timeZone must be a valid IANA timezone'); } return zone; }
function localParts(epochMs, timeZone) { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, weekday:'short', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(new Date(epochMs)).map(part => [part.type, part.value])); return { weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday), year:+parts.year, month:+parts.month, day:+parts.day, hour:+parts.hour, minute:+parts.minute, second:+parts.second }; }
function wallKey(parts) { return parts.year + '-' + String(parts.month).padStart(2,'0') + '-' + String(parts.day).padStart(2,'0'); }
function nextDay(day) { const value = new Date(day + 'T00:00:00.000Z'); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString().slice(0,10); }
function boundary(calendar, day, clock, edge) {
  const [hour, minute] = clock.split(':').map(Number), wall = Date.parse(day + 'T' + clock + ':00.000Z'), offsets = new Set();
  for (let offset = -36; offset <= 36; offset += 6) { const sample = Math.floor((wall + offset * 3600000) / 60000) * 60000, parts = localParts(sample, calendar.timeZone); offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - sample); }
  const exact = [];
  for (const offset of offsets) { const candidate = wall - offset, parts = localParts(candidate, calendar.timeZone); if (wallKey(parts) === day && parts.hour === hour && parts.minute === minute) exact.push(candidate); }
  if (exact.length) return edge === 'start' ? Math.min(...exact) : Math.max(...exact);
  return null;
}
function weekly(calendar, day) { const dateValue = new Date(day + 'T00:00:00.000Z'); if (calendar.holidays.includes(day)) return []; return calendar.dateOverrides[day] || calendar.weeklyHours[String(dateValue.getUTCDay())] || []; }
function openMinutes(calendar, startMs, endMs) {
  let total = 0, day = wallKey(localParts(startMs, calendar.timeZone)), last = wallKey(localParts(endMs - 1, calendar.timeZone));
  for (let guard = 0; guard < calendar.maxDaysOut + 2 && day <= last; guard++, day = nextDay(day)) for (const window of weekly(calendar, day)) { const start = boundary(calendar, day, window.start, 'start'), end = boundary(calendar, day, window.end, 'end'); if (start != null && end != null) total += Math.max(0, Math.min(endMs, end) - Math.max(startMs, start)); }
  return total / 60000;
}

export function createBookingCalendar({ tenantId, id = crypto.randomUUID(), version = 1, timeZone = 'UTC', weeklyHours = {}, holidays = [], dateOverrides = {}, slotDurationMinutes = 30, slotIntervalMinutes = 15, minNoticeMinutes = 60, maxDaysOut = 60, bufferBeforeMinutes = 0, bufferAfterMinutes = 0, capacity = 1, hostStrategy = 'least_loaded', hosts = [] } = {}) {
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Calendar version must be positive');
  if (!Number.isSafeInteger(slotDurationMinutes) || slotDurationMinutes < 5 || slotDurationMinutes > 1440) throw new Error('slotDurationMinutes invalid');
  if (!Number.isSafeInteger(slotIntervalMinutes) || slotIntervalMinutes < 5 || slotIntervalMinutes > 1440) throw new Error('slotIntervalMinutes invalid');
  if (!Number.isSafeInteger(minNoticeMinutes) || minNoticeMinutes < 0 || minNoticeMinutes > 10080) throw new Error('minNoticeMinutes invalid');
  if (!Number.isSafeInteger(maxDaysOut) || maxDaysOut < 1 || maxDaysOut > 365) throw new Error('maxDaysOut invalid');
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100) throw new Error('capacity invalid');
  if (!['least_loaded','round_robin','fixed'].includes(hostStrategy)) throw new Error('hostStrategy invalid');
  const zone = calendarZone(timeZone);
  const normalizeWindows = windows => {
    if (!Array.isArray(windows) || windows.length > 8) throw new Error('Calendar windows must contain at most 8 entries');
    return windows.map(window => {
      if (!window || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.end)) throw new Error('Calendar window time invalid');
      if (window.start >= window.end) throw new Error('Calendar windows may not cross midnight');
      return { start: window.start, end: window.end };
    });
  };
  const weeklyHoursNormalized = Object.fromEntries(Object.entries(weeklyHours || {}).map(([day, windows]) => {
    if (!/^[0-6]$/.test(day)) throw new Error('Weekly hour keys must be 0-6');
    return [day, normalizeWindows(windows)];
  }));
  const dateValid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0,10) === value;
  if (!Array.isArray(holidays) || holidays.length > 5000 || holidays.some(day => !dateValid(day))) throw new Error('holidays must contain valid dates');
  const overrides = Object.fromEntries(Object.entries(dateOverrides || {}).map(([day, windows]) => { if (!dateValid(day)) throw new Error('dateOverrides contains an invalid date'); return [day, normalizeWindows(windows)]; }));
  if (!Array.isArray(hosts) || hosts.length > 100 || hosts.some(host => !reference(host, 'host ref'))) throw new Error('hosts must be bounded references');
  if (hostStrategy === 'fixed' && hosts.length !== 1) throw new Error('fixed hostStrategy requires one host');
  const body = { kind:'atlas_booking_calendar', tenantId:reference(tenantId,'tenantId'), id:reference(id,'calendar id'), version, timeZone:zone, weeklyHours:weeklyHoursNormalized, holidays:[...new Set(holidays)].sort(), dateOverrides:overrides, slotDurationMinutes, slotIntervalMinutes, minNoticeMinutes, maxDaysOut, bufferBeforeMinutes, bufferAfterMinutes, capacity, hostStrategy, hosts:[...new Set(hosts)].sort() };
  return freeze({ ...body, checksum:sha(body) });
}

export function verifyBookingCalendar(calendar) {
  if (!calendar || calendar.kind !== 'atlas_booking_calendar' || typeof calendar.checksum !== 'string') return false;
  const { checksum, ...body } = calendar;
  return /^[a-f0-9]{64}$/.test(checksum) && sha(body) === checksum;
}

function overlap(a,b) { return Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt); }
function validBooking(booking, tenantId) { return booking && booking.tenantId === tenantId && Number.isFinite(Date.parse(booking.startAt)) && Number.isFinite(Date.parse(booking.endAt)) && Date.parse(booking.endAt) > Date.parse(booking.startAt) && booking.status !== 'canceled'; }

export function listAvailableSlots({ calendar, startAt, endAt, existingBookings = [], requestedHostRef = null, limit = 100, now = Date.now() } = {}) {
  if (!verifyBookingCalendar(calendar)) throw new Error('Calendar checksum invalid');
  const start = timestamp(startAt, 'startAt'), end = timestamp(endAt, 'endAt'), current = timestamp(now, 'now');
  if (end <= start || start < current - 60000) throw new Error('Invalid availability range');
  if (end - current > calendar.maxDaysOut * 86400000 + 86400000) throw new Error('Availability range exceeds calendar horizon');
  if (!Array.isArray(existingBookings) || existingBookings.length > 10000) throw new Error('Booking set too large');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Slot limit must be 1-500');
  const bookings = existingBookings.filter(booking => validBooking(booking, calendar.tenantId));
  const slotMs = calendar.slotDurationMinutes * 60000, intervalMs = calendar.slotIntervalMinutes * 60000, slots = [];
  for (let cursor = start, guard = 0; cursor + slotMs <= end && guard < 600000; cursor += intervalMs, guard++) {
    if (cursor < current + calendar.minNoticeMinutes * 60000) continue;
    if (openMinutes(calendar, cursor, cursor + slotMs) < calendar.slotDurationMinutes - 0.0001) continue;
    const buffered = { startAt:new Date(cursor - calendar.bufferBeforeMinutes * 60000).toISOString(), endAt:new Date(cursor + slotMs + calendar.bufferAfterMinutes * 60000).toISOString() };
    const conflicts = bookings.filter(booking => overlap(buffered, booking));
    if (!calendar.hosts.length) {
      if (conflicts.length < calendar.capacity) slots.push({ startAt:new Date(cursor).toISOString(), endAt:new Date(cursor + slotMs).toISOString(), hostRef:null, availableCapacity:calendar.capacity-conflicts.length });
    } else {
      const candidates = calendar.hosts.map(host => ({ host, count:conflicts.filter(booking => booking.hostRef === host).length })).sort((a,b) => a.count-b.count || a.host.localeCompare(b.host));
      const selected = requestedHostRef != null ? (calendar.hosts.includes(requestedHostRef) ? requestedHostRef : null) : candidates[0]?.host || null;
      if (selected && !conflicts.some(booking => booking.hostRef === selected)) slots.push({ startAt:new Date(cursor).toISOString(), endAt:new Date(cursor + slotMs).toISOString(), hostRef:selected, availableCapacity:1 });
    }
    if (slots.length >= limit) break;
  }
  return slots;
}

export function holdBooking({ calendar, existingBookings = [], startAt, endAt, contactRef, requestedHostRef = null, holdMinutes = 10, idempotencyKey, now = Date.now() } = {}) {
  if (!verifyBookingCalendar(calendar)) throw new Error('Calendar checksum invalid');
  if (!Number.isSafeInteger(holdMinutes) || holdMinutes < 1 || holdMinutes > 60) throw new Error('holdMinutes must be 1-60');
  const slots = listAvailableSlots({ calendar, existingBookings, startAt, endAt, requestedHostRef, limit:1, now });
  if (!slots.length) return { status:'unavailable', hold:null };
  const body = { id:'hold_' + crypto.randomUUID().replaceAll('-',''), tenantId:calendar.tenantId, calendarId:calendar.id, calendarVersion:calendar.version, contactRef:reference(contactRef,'contactRef'), hostRef:slots[0].hostRef, startAt:slots[0].startAt, endAt:slots[0].endAt, status:'held', idempotencyKey:text(idempotencyKey,'idempotencyKey',200), expiresAt:new Date(now + holdMinutes * 60000).toISOString(), createdAt:new Date(now).toISOString() };
  return { status:'held', hold:freeze({ ...body, checksum:sha(body) }) };
}

export function bookAppointment({ calendar, appointments = [], hold = null, startAt, endAt, contactRef, requestedHostRef = null, idempotencyKey, now = Date.now() } = {}) {
  if (!verifyBookingCalendar(calendar)) throw new Error('Calendar checksum invalid');
  const key = text(idempotencyKey, 'idempotencyKey', 200);
  const existing = appointments.find(appointment => appointment.tenantId === calendar.tenantId && appointment.idempotencyKey === key);
  if (existing) return { status:'idempotent', appointment:existing };
  if (hold) {
    if (hold.status !== 'held' || hold.tenantId !== calendar.tenantId || hold.calendarId !== calendar.id || hold.calendarVersion !== calendar.version || Date.parse(hold.expiresAt) <= now || hold.contactRef !== contactRef) throw new Error('Appointment hold is invalid or expired');
    startAt = hold.startAt; endAt = hold.endAt; requestedHostRef = hold.hostRef;
  }
  const slots = listAvailableSlots({ calendar, existingBookings:appointments, startAt, endAt, requestedHostRef, limit:1, now });
  if (!slots.length) return { status:'unavailable', appointment:null };
  const body = { id:'appt_' + crypto.randomUUID().replaceAll('-',''), tenantId:calendar.tenantId, calendarId:calendar.id, calendarVersion:calendar.version, contactRef:reference(contactRef,'contactRef'), hostRef:slots[0].hostRef, startAt:slots[0].startAt, endAt:slots[0].endAt, status:'booked', version:1, idempotencyKey:key, createdAt:new Date(now).toISOString(), updatedAt:new Date(now).toISOString() };
  return { status:'booked', appointment:freeze({ ...body, checksum:sha(body) }) };
}

export function rescheduleAppointment({ calendar, appointment, appointments = [], newStartAt, newEndAt, expectedVersion, now = Date.now() } = {}) {
  if (!verifyBookingCalendar(calendar) || appointment?.tenantId !== calendar.tenantId) throw new Error('Appointment/calendar scope invalid');
  if (appointment.version !== expectedVersion) throw Object.assign(new Error('Appointment version conflict'), { code:'VERSION_CONFLICT' });
  const slots = listAvailableSlots({ calendar, existingBookings:appointments.filter(item => item.id !== appointment.id), startAt:newStartAt, endAt:newEndAt, requestedHostRef:appointment.hostRef, limit:1, now });
  if (!slots.length) return { status:'unavailable', appointment:null };
  const next = { ...appointment, startAt:slots[0].startAt, endAt:slots[0].endAt, version:expectedVersion + 1, updatedAt:new Date(now).toISOString() };
  const { checksum, ...body } = next;
  return { status:'rescheduled', appointment:freeze({ ...body, checksum:sha(body) }) };
}

export function cancelAppointment({ appointment, tenantId, expectedVersion, reason = 'customer_request', now = Date.now() } = {}) {
  if (!appointment || appointment.tenantId !== tenantId) throw new Error('Appointment tenant mismatch');
  if (appointment.version !== expectedVersion) throw Object.assign(new Error('Appointment version conflict'), { code:'VERSION_CONFLICT' });
  const next = { ...appointment, status:'canceled', cancellationReason:text(reason,'cancellation reason',80), version:expectedVersion + 1, updatedAt:new Date(now).toISOString() };
  const { checksum, ...body } = next;
  return freeze({ ...body, checksum:sha(body) });
}

export const AGENT_TOOL_RISKS = Object.freeze(['read','network','write','financial','destructive']);
const RISK_ORDER = Object.freeze({read:0,network:1,write:2,financial:3,destructive:4});

export function createAgentRuntimePolicy({ tenantId, agentId, releaseId, allowedTools = [], maxTurns = 12, maxToolCalls = 10, maxExecutionMs = 120000, maxResponseChars = 8000 } = {}) {
  if (!tenantId || !agentId || !releaseId) throw new Error('Agent runtime identity required');
  if (!Array.isArray(allowedTools) || allowedTools.length > 100) throw new Error('Agent tool allowlist out of bounds');
  for (const [value, min, max] of [[maxTurns,1,50],[maxToolCalls,0,100],[maxExecutionMs,1000,600000],[maxResponseChars,100,20000]]) if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Agent runtime budget out of bounds');
  return freeze({ tenantId:reference(tenantId,'tenantId'), agentId:reference(agentId,'agentId'), releaseId:reference(releaseId,'releaseId'), allowedTools:[...new Set(allowedTools.map(tool => text(tool,'tool name',120)))].sort(), maxTurns, maxToolCalls, maxExecutionMs, maxResponseChars });
}

export function defineAgentTool({ name, risk = 'read', requiresApproval = null, description = '', inputSchema = null } = {}) {
  if (!AGENT_TOOL_RISKS.includes(risk)) throw new Error('Unsupported agent tool risk');
  const body = { name:text(name,'tool name',120), risk, requiresApproval:requiresApproval == null ? RISK_ORDER[risk] > 1 : Boolean(requiresApproval), description:text(description || name,'tool description',500), inputSchema };
  return freeze({ ...body, checksum:sha(body) });
}

export function verifyAgentTool(tool) {
  if (!tool || typeof tool.checksum !== 'string') return false;
  const { checksum, ...body } = tool;
  return /^[a-f0-9]{64}$/.test(checksum) && sha(body) === checksum;
}

function boundedJson(value, depth = 0, seen = new WeakSet()) {
  if (depth > 8) throw new Error('Agent JSON nesting exceeds limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('Agent arguments must be finite JSON');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error('Agent argument list too large');
    result = value.map(item => boundedJson(item, depth + 1, seen));
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length > 100) throw new Error('Agent argument object too large');
    result = {};
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key)) throw new Error('Unsafe agent argument key');
      result[text(key,'argument key',100)] = boundedJson(child, depth + 1, seen);
    }
  }
  seen.delete(value);
  return result;
}

export function authorizeAgentToolCall({ runtime, tool, tenantId, actorId, argumentsValue = {}, approvalEvidence = null, now = Date.now() } = {}) {
  if (!runtime || runtime.tenantId !== tenantId || !verifyAgentTool(tool) || !runtime.allowedTools.includes(tool.name)) return { allowed:false, code:'TOOL_NOT_ALLOWED' };
  boundedJson(argumentsValue);
  const argumentsHash = sha(argumentsValue);
  const idempotencyKey = sha({ tenantId, agentId:runtime.agentId, releaseId:runtime.releaseId, actorId, toolName:tool.name, argumentsHash });
  const approvedAt = Date.parse(approvalEvidence?.approvedAt), expiresAt = Date.parse(approvalEvidence?.expiresAt);
  const approved = approvalEvidence?.status === 'approved' && approvalEvidence.tenantId === tenantId && approvalEvidence.agentId === runtime.agentId && approvalEvidence.releaseId === runtime.releaseId && approvalEvidence.actorId === actorId && approvalEvidence.toolName === tool.name && approvalEvidence.argumentsHash === argumentsHash && approvalEvidence.idempotencyKey === idempotencyKey && Number.isFinite(approvedAt) && Number.isFinite(expiresAt) && approvedAt <= now + 60000 && expiresAt > now && expiresAt - approvedAt <= 900000;
  if (tool.requiresApproval && !approved) return { allowed:false, code:'APPROVAL_REQUIRED', argumentsHash, idempotencyKey };
  return { allowed:true, code:'ALLOWED', argumentsHash, idempotencyKey };
}

export function createAgentSession({ runtime, tenantId, conversationId, actorId, now = Date.now(), leaseMs = 30000 } = {}) {
  if (!runtime || runtime.tenantId !== tenantId) throw new Error('Agent runtime tenant mismatch');
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) throw new Error('Agent lease out of bounds');
  const body = { id:'session_' + crypto.randomUUID().replaceAll('-',''), tenantId, agentId:runtime.agentId, releaseId:runtime.releaseId, conversationId:reference(conversationId,'conversationId'), actorId:reference(actorId,'actorId'), status:'active', turns:0, toolCalls:0, startedAt:new Date(now).toISOString(), leaseUntil:new Date(now + leaseMs).toISOString(), leaseMs, version:1 };
  return freeze({ ...body, checksum:sha(body) });
}

export function verifyAgentSession(session) {
  if (!session || typeof session.checksum !== 'string') return false;
  const { checksum, ...body } = session;
  return /^[a-f0-9]{64}$/.test(checksum) && sha(body) === checksum;
}

function sessionPatch(session, patch) {
  const { checksum, ...body } = session;
  const next = { ...body, ...patch, version:session.version + 1 };
  return freeze({ ...next, checksum:sha(next) });
}

export function consumeAgentBudget({ session, runtime, kind, now = Date.now() } = {}) {
  if (!verifyAgentSession(session) || !runtime || session.tenantId !== runtime.tenantId || session.agentId !== runtime.agentId || session.releaseId !== runtime.releaseId) throw new Error('Agent session/runtime mismatch');
  if (Date.parse(session.leaseUntil) <= now) throw Object.assign(new Error('Agent session lease expired'), { code:'LEASE_EXPIRED' });
  if (now - Date.parse(session.startedAt) > runtime.maxExecutionMs) return { ok:false, reason:'execution_budget_exhausted', session };
  if (kind === 'turn' && session.turns >= runtime.maxTurns) return { ok:false, reason:'turn_budget_exhausted', session };
  if (kind === 'tool' && session.toolCalls >= runtime.maxToolCalls) return { ok:false, reason:'tool_budget_exhausted', session };
  if (!['turn','tool'].includes(kind)) throw new Error('Unknown agent budget kind');
  return { ok:true, reason:null, session:sessionPatch(session, kind === 'turn' ? { turns:session.turns + 1 } : { toolCalls:session.toolCalls + 1 }) };
}

export function completeAgentSession({ session, tenantId, status = 'completed', now = Date.now(), summary = null } = {}) {
  if (!verifyAgentSession(session) || session.tenantId !== tenantId || !['completed','failed','handoff','needs_approval'].includes(status)) throw new Error('Invalid agent completion');
  return sessionPatch(session, { status, summary:summary == null ? null : text(summary,'summary',1000), leaseUntil:new Date(now).toISOString() });
}

export function validateAgentOutput(value, schema, { maxBytes = 16000 } = {}) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) throw new Error('Agent structured output too large');
  const visit = (candidate, rule, path = 'output') => {
    if (rule?.type === 'string' && typeof candidate !== 'string') throw new Error(path + ' must be string');
    if (rule?.type === 'number' && (typeof candidate !== 'number' || !Number.isFinite(candidate))) throw new Error(path + ' must be number');
    if (rule?.type === 'boolean' && typeof candidate !== 'boolean') throw new Error(path + ' must be boolean');
    if (rule?.enum && !rule.enum.includes(candidate)) throw new Error(path + ' must use an allowed value');
    if (rule?.type === 'object') {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error(path + ' must be object');
      for (const [key, sub] of Object.entries(rule.properties || {})) { if ((rule.required || []).includes(key) && !(key in candidate)) throw new Error(path + '.' + key + ' is required'); if (key in candidate) visit(candidate[key], sub, path + '.' + key); }
    }
    if (rule?.type === 'array') {
      if (!Array.isArray(candidate) || candidate.length > 50) throw new Error(path + ' must be a bounded array');
      if (rule.items) candidate.forEach((item, index) => visit(item, rule.items, path + '[' + index + ']'));
    }
  };
  visit(value, schema);
  return true;
}

export function summarizeAgentExecution({ session, events = [] } = {}) {
  if (!verifyAgentSession(session) || !Array.isArray(events) || events.length > 500) throw new Error('Agent execution summary invalid');
  const failed = events.filter(event => event?.status === 'failed').length, approvals = events.filter(event => event?.status === 'needs_approval').length;
  return { tenantId:session.tenantId, agentId:session.agentId, releaseId:session.releaseId, sessionId:session.id, status:session.status, turns:session.turns, toolCalls:session.toolCalls, failedSteps:failed, approvalStops:approvals, headline:failed ? ('Agent encountered ' + failed + ' failed step(s)') : approvals ? ('Agent paused for ' + approvals + ' approval(s)') : 'Agent completed within policy budget' };
}
