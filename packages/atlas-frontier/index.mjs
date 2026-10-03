import crypto from 'node:crypto';

export const QUEUE_STATES = Object.freeze(['queued','leased','succeeded','failed','dead_letter','canceled']);
export const SYNC_STATES = Object.freeze(['idle','running','succeeded','failed','paused']);
const id = prefix => prefix + '_' + crypto.randomUUID().replaceAll('-', '');
const SECRET_KEY = /authorization|password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|cookie/i;
const TELEMETRY_PRIVATE_KEY = /authorization|password|secret|api[_-]?key|token|credential|cookie|email|phone|message|body|prompt|content|payload/i;

function requiredText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(label + ' is required and must be bounded text');
  return value.trim();
}
function safeNow(value) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error('now must be a finite non-negative timestamp');
  return result;
}
function safeLeaseMs(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > 10 * 60 * 1000) throw new Error('leaseMs must be an integer from 1 to 600000');
  return result;
}
function requirePositiveInt(value, label, max) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(label + ' is out of range');
  return value;
}
function clonePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Queue payload must be a JSON object');
  const ancestors = new WeakSet();
  const inspect = value => {
    if (!value || typeof value !== 'object') return;
    if (ancestors.has(value)) throw new Error('Queue payload must not contain cycles');
    ancestors.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) throw new Error('Queue payload must not contain credential fields');
      inspect(child);
    }
    ancestors.delete(value);
  };
  inspect(payload);
  let serialized;
  try { serialized = JSON.stringify(payload); } catch { throw new Error('Queue payload must be JSON serializable'); }
  if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > 64 * 1024) throw new Error('Queue payload exceeds 64 KiB');
  return JSON.parse(serialized);
}
function redactTelemetryValue(key, value) {
  if (TELEMETRY_PRIVATE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    if (/Bearer\s+\S+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?:sk|gh[pousr])_[A-Za-z0-9_-]{12,}/i.test(value)) return '[REDACTED]';
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) return '[REDACTED]';
    return value.slice(0, 256);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return '[REDACTED]';
}

export function createProviderAdapter({id: adapterId, provider, capabilities = [], contractVersion = '1.0'} = {}) {
  const safeCapabilities = [...new Set((Array.isArray(capabilities) ? capabilities : []).filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean))].slice(0, 200);
  return {id:requiredText(adapterId,'id'),provider:requiredText(provider,'provider'),capabilities:safeCapabilities,contractVersion:requiredText(contractVersion,'contractVersion',40)};
}

export function validateProviderContract(adapter, required = []) {
  const available = new Set(Array.isArray(adapter?.capabilities) ? adapter.capabilities : []);
  const wanted = [...new Set((Array.isArray(required) ? required : []).filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean))];
  const missing = wanted.filter(x => !available.has(x));
  return {ok:missing.length===0,adapterId:adapter?.id??null,provider:adapter?.provider??null,missing};
}

export function createSyncCursor({tenantId, connectorId, resource, cursor = null} = {}) {
  return {id:id('cursor'),tenantId:requiredText(tenantId,'tenantId'),connectorId:requiredText(connectorId,'connectorId'),resource:requiredText(resource,'resource'),cursor,state:'idle',pages:0,records:0,updatedAt:new Date().toISOString()};
}

export function advanceSyncCursor(cursor, {cursorValue = null, records = 0, pages = 1, state = 'idle'} = {}) {
  if (!cursor || !SYNC_STATES.includes(state)) throw new Error('Invalid sync cursor state');
  if (!Number.isSafeInteger(records) || records < 0 || !Number.isSafeInteger(pages) || pages < 0) throw new Error('Sync counters must be non-negative integers');
  if (!Number.isSafeInteger(cursor.records) || cursor.records < 0 || !Number.isSafeInteger(cursor.pages) || cursor.pages < 0) throw new Error('Stored sync counters are invalid');
  if (cursorValue !== null && (typeof cursorValue !== 'string' || cursorValue.length > 2048)) throw new Error('Sync cursor value must be bounded text');
  return {...cursor,cursor:cursorValue,records:cursor.records+records,pages:cursor.pages+pages,state,updatedAt:new Date().toISOString()};
}

export function createWebhookReceipt({tenantId, connectorId, eventId, eventType = 'unknown', payloadHash = null} = {}) {
  return {id:id('webhook'),tenantId:requiredText(tenantId,'tenantId'),connectorId:requiredText(connectorId,'connectorId'),eventId:requiredText(eventId,'eventId',512),eventType:requiredText(eventType,'eventType',200),payloadHash:payloadHash==null?null:requiredText(payloadHash,'payloadHash',256),receivedAt:new Date().toISOString()};
}

export function claimWebhook(store, receipt) {
  if (!store || typeof store.has !== 'function' || typeof store.set !== 'function') throw new Error('Webhook receipt store is required');
  const key = JSON.stringify([requiredText(receipt?.tenantId,'tenantId'),requiredText(receipt?.connectorId,'connectorId'),requiredText(receipt?.eventId,'eventId',512)]);
  if (store.has(key)) return {accepted:false,duplicate:true,key};
  store.set(key,receipt.id);
  return {accepted:true,duplicate:false,key};
}

export function createQueueJob({tenantId, queue, type, payload = {}, idempotencyKey, maxAttempts = 5} = {}) {
  const attempts = requirePositiveInt(maxAttempts,'maxAttempts',25);
  const key = idempotencyKey == null ? crypto.randomUUID() : requiredText(idempotencyKey,'idempotencyKey',512);
  const clonedPayload = clonePayload(payload);
  const now = new Date().toISOString();
  return {id:id('job'),tenantId:requiredText(tenantId,'tenantId'),queue:requiredText(queue,'queue',120),type:requiredText(type,'type',200),payload:clonedPayload,idempotencyKey:key,status:'queued',attempts:0,maxAttempts:attempts,availableAt:now,leasedUntil:null,workerId:null,lastError:null,createdAt:now,updatedAt:now};
}

export function leaseJob(job, {workerId, leaseMs = 30000, now = Date.now()} = {}) {
  const worker = requiredText(workerId,'workerId',128);
  const current = safeNow(now), duration = safeLeaseMs(leaseMs);
  if (job?.status !== 'queued') throw new Error('Only queued jobs can be leased');
  const available = Date.parse(job.availableAt);
  if (!Number.isFinite(available) || available > current) throw new Error('Job is not available to lease');
  if (!Number.isSafeInteger(job.attempts) || !Number.isSafeInteger(job.maxAttempts) || job.attempts >= job.maxAttempts) throw new Error('Job has exhausted its attempts');
  return {...job,status:'leased',workerId:worker,leasedUntil:new Date(current+duration).toISOString(),attempts:job.attempts+1,updatedAt:new Date(current).toISOString()};
}

export function heartbeatJob(job, {workerId, leaseMs = 30000, now = Date.now()} = {}) {
  const worker = requiredText(workerId,'workerId',128);
  const current = safeNow(now), duration = safeLeaseMs(leaseMs);
  if (job?.status !== 'leased' || job.workerId !== worker) throw new Error('Worker does not own lease');
  const expiry = Date.parse(job.leasedUntil);
  if (!Number.isFinite(expiry) || expiry <= current) throw new Error('Lease has expired');
  return {...job,leasedUntil:new Date(current+duration).toISOString(),updatedAt:new Date(current).toISOString()};
}

export function completeJob(job, {workerId, success, error = null, retryAt = null, now = Date.now()} = {}) {
  const worker = requiredText(workerId,'workerId',128);
  const current = safeNow(now);
  if (typeof success !== 'boolean') throw new Error('success must be boolean');
  if (job?.status !== 'leased' || job.workerId !== worker) throw new Error('Worker does not own lease');
  const expiry = Date.parse(job.leasedUntil);
  if (!Number.isFinite(expiry) || expiry <= current) throw new Error('Lease has expired');
  if (success) return {...job,status:'succeeded',leasedUntil:null,workerId:null,lastError:null,updatedAt:new Date(current).toISOString()};
  if (job.attempts >= job.maxAttempts) return {...job,status:'dead_letter',leasedUntil:null,workerId:null,lastError:String(error||'job failed').slice(0,1000),updatedAt:new Date(current).toISOString()};
  const delay = Math.min(30000,500*2**Math.max(0,job.attempts-1));
  const retryTime = retryAt == null ? current+delay : Date.parse(retryAt);
  if (!Number.isFinite(retryTime) || retryTime < 0) throw new Error('retryAt must be a valid timestamp');
  return {...job,status:'queued',leasedUntil:null,workerId:null,lastError:String(error||'job failed').slice(0,1000),availableAt:new Date(retryTime).toISOString(),updatedAt:new Date(current).toISOString()};
}

export function reclaimExpiredLease(job, {now = Date.now()} = {}) {
  const current = safeNow(now);
  if (job?.status !== 'leased') return job;
  const expiry = Date.parse(job.leasedUntil);
  if (Number.isFinite(expiry) && expiry > current) return job;
  return {...job,status:job.attempts>=job.maxAttempts?'dead_letter':'queued',workerId:null,leasedUntil:null,lastError:'lease expired or invalid',updatedAt:new Date(current).toISOString()};
}

export function claimQueueIdempotency(store, job) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') throw new Error('Queue idempotency store is required');
  const key = JSON.stringify([requiredText(job?.tenantId,'tenantId'),requiredText(job?.queue,'queue',120),requiredText(job?.idempotencyKey,'idempotencyKey',512)]);
  const jobId = requiredText(job?.id,'jobId',200);
  const existing = store.get(key);
  if (existing && existing !== jobId) return {accepted:false,existingJobId:existing,key};
  store.set(key,jobId);
  return {accepted:true,existingJobId:jobId,key};
}

export function buildOtlpSpan({traceId, spanId, name, startTimeUnixNano, endTimeUnixNano, attributes = {}, status = 'OK'} = {}) {
  const trace = requiredText(traceId,'traceId',32), span = requiredText(spanId,'spanId',16);
  if (!/^[a-f0-9]{32}$/i.test(trace) || !/^[a-f0-9]{16}$/i.test(span)) throw new Error('OTLP trace and span IDs must be valid hexadecimal IDs');
  const start = String(startTimeUnixNano), end = String(endTimeUnixNano);
  if (!/^\d+$/.test(start) || !/^\d+$/.test(end) || BigInt(end) < BigInt(start)) throw new Error('OTLP span timestamps are invalid');
  if (!['OK','ERROR','UNSET'].includes(status)) throw new Error('Invalid OTLP status');
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) throw new Error('OTLP span attributes must be an object');
  const pairs = Object.entries(attributes);
  if (pairs.length > 100) throw new Error('OTLP span has too many attributes');
  return {traceId:trace.toLowerCase(),spanId:span.toLowerCase(),name:requiredText(name,'span name',256),startTimeUnixNano:start,endTimeUnixNano:end,
    attributes:pairs.map(([key,value])=>{const safeKey=requiredText(key,'attribute key',128);const safeValue=redactTelemetryValue(safeKey,value);return {key:safeKey,value:typeof safeValue==='number'?{doubleValue:safeValue}:typeof safeValue==='boolean'?{boolValue:safeValue}:{stringValue:String(safeValue)}};}),
    status:{code:status==='OK'?1:status==='ERROR'?2:0}};
}

export function buildOtlpTraceRequest(spans = []) {
  if (!Array.isArray(spans) || spans.length > 1000) throw new Error('OTLP request must contain at most 1000 spans');
  return {resourceSpans:[{resource:{attributes:[{key:'service.name',value:{stringValue:'atlas'}},{key:'service.namespace',value:{stringValue:'atlas-business-os'}}]},scopeSpans:[{scope:{name:'atlas.runtime'},spans}]}]};
}

export function calculateSlo({good = 0, total = 0, target = 0.995, window = '30d'} = {}) {
  if (!Number.isSafeInteger(good) || !Number.isSafeInteger(total) || good < 0 || total < 0 || good > total) throw new Error('SLO good and total counts must be valid non-negative integers');
  if (!Number.isFinite(target) || target < 0 || target > 1) throw new Error('SLO target must be between 0 and 1');
  if (typeof window !== 'string' || !/^\d{1,4}(m|h|d)$/.test(window)) throw new Error('SLO window is invalid');
  const ratio = total ? good / total : 0;
  const errorBudget = 1 - target;
  const zeroBudgetBreached = errorBudget === 0 && ratio < 1;
  const consumed = errorBudget === 0 ? (zeroBudgetBreached ? null : 0) : Math.max(0,(1-ratio)/errorBudget);
  return {ratio,target,window,errorBudget,budgetConsumedRatio:consumed,burnRate:consumed,zeroBudgetBreached,withinSlo:total > 0 && ratio >= target};
}

export function createCustomerGraph({tenantId, nodes = [], edges = []} = {}) {
  const tenant = requiredText(tenantId,'tenantId');
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new Error('Graph nodes and edges must be lists');
  const safeNodes = nodes.map(node => {
    if (node?.tenantId && node.tenantId !== tenant) throw new Error('Graph node crosses tenant boundary');
    return {...node,tenantId:tenant,id:requiredText(node?.id,'node id'),type:requiredText(node?.type,'node type')};
  });
  const nodeIds = new Set(safeNodes.map(node=>node.id));
  const safeEdges = edges.map(edge => {
    if (edge?.tenantId && edge.tenantId !== tenant) throw new Error('Graph edge crosses tenant boundary');
    if (!nodeIds.has(edge?.from) || !nodeIds.has(edge?.to)) throw new Error('Graph edge endpoints must exist in this tenant');
    return {...edge,tenantId:tenant,from:requiredText(edge.from,'edge from'),to:requiredText(edge.to,'edge to'),type:requiredText(edge.type,'edge type')};
  });
  return {tenantId:tenant,nodes:safeNodes,edges:safeEdges,generatedAt:new Date().toISOString()};
}

export function upsertGraphNode(graph, node) {
  if (!graph?.tenantId || !node?.id || !node?.type) throw new Error('Graph and node identity are required');
  if (node.tenantId && node.tenantId !== graph.tenantId) throw new Error('Graph node crosses tenant boundary');
  return {...graph,nodes:[...graph.nodes.filter(x=>x.id!==node.id),{...node,tenantId:graph.tenantId}]};
}

export function upsertGraphEdge(graph, edge) {
  if (!graph?.tenantId || !edge?.from || !edge?.to || !edge?.type) throw new Error('Graph and edge identity are required');
  if (edge.tenantId && edge.tenantId !== graph.tenantId) throw new Error('Graph edge crosses tenant boundary');
  const nodeIds = new Set(graph.nodes.map(node=>node.id));
  if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error('Graph edge endpoints must exist in this tenant');
  return {...graph,edges:[...graph.edges.filter(x=>!(x.from===edge.from&&x.to===edge.to&&x.type===edge.type)),{...edge,tenantId:graph.tenantId}]};
}

export function graphPath(graph, start, goal, maxDepth = 6) {
  if (!graph?.tenantId || !Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 20) throw new Error('Invalid graph traversal request');
  const nodeIds = new Set(graph.nodes.map(node=>node.id));
  if (!nodeIds.has(start) || !nodeIds.has(goal)) return null;
  if (start === goal) return [start];
  const queue = [[start]], seen = new Set([start]);
  while (queue.length) {
    const path = queue.shift();
    if (path.length - 1 >= maxDepth) continue;
    for (const edge of graph.edges.filter(x=>x.tenantId===graph.tenantId&&x.from===path.at(-1))) {
      if (!nodeIds.has(edge.to)) continue;
      if (edge.to === goal) return [...path,edge.to];
      if (!seen.has(edge.to)) { seen.add(edge.to); queue.push([...path,edge.to]); }
    }
  }
  return null;
}

function unitInterval(value,label) {
  const number=Number(value);
  if (!Number.isFinite(number)) throw new Error(label+' must be a finite number');
  return Math.max(0,Math.min(1,number));
}

export function scoreCustomerHealth({engagement=0,productUsage=0,openIssues=0,paymentRisk=0}={}) {
  const score=Math.round(Math.max(0,Math.min(100,unitInterval(engagement,'engagement')*35+unitInterval(productUsage,'productUsage')*35+(1-unitInterval(openIssues,'openIssues'))*15+(1-unitInterval(paymentRisk,'paymentRisk'))*15)));
  return {score,band:score>=80?'healthy':score>=60?'watch':'at_risk'};
}

function nonNegativeAmount(value) {
  const number=Number(value);
  return Number.isFinite(number)&&number>0?Math.min(number,1_000_000_000_000):0;
}
function probability(value) {
  const number=Number(value);
  return Number.isFinite(number)?Math.max(0,Math.min(1,number)):0;
}

export function buildRevenueCockpit({deals=[],customers=[],activities=[],periodDays=30,now=Date.now()}={}) {
  if (!Array.isArray(deals)||!Array.isArray(customers)||!Array.isArray(activities)) throw new Error('Revenue inputs must be lists');
  if (!Number.isSafeInteger(periodDays)||periodDays<1||periodDays>3650||!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime())) throw new Error('Revenue time window is invalid');
  const dealRows=deals.filter(row=>row&&typeof row==='object'&&!Array.isArray(row));
  const customerRows=customers.filter(row=>row&&typeof row==='object'&&!Array.isArray(row));
  const activityRows=activities.filter(row=>row&&typeof row==='object'&&!Array.isArray(row));
  const total=dealRows.reduce((n,d)=>n+nonNegativeAmount(d.amount),0);
  const weighted=dealRows.reduce((n,d)=>n+nonNegativeAmount(d.amount)*probability(d.probability),0);
  const won=dealRows.filter(d=>['won','closed_won'].includes(String(d.status||'').toLowerCase()));
  const atRisk=customerRows.filter(c=>c.healthBand==='at_risk').length;
  const expansion=customerRows.filter(c=>Number.isFinite(Number(c.expansionScore))&&Number(c.expansionScore)>=0.7).length;
  const recent=activityRows.filter(a=>{const created=Date.parse(a.createdAt);return Number.isFinite(created)&&created<=now&&created>=now-periodDays*86400000;}).length;
  return {generatedAt:new Date(now).toISOString(),pipeline:{total,weighted,deals:dealRows.length,wonValue:won.reduce((n,d)=>n+nonNegativeAmount(d.amount),0),winRate:dealRows.length?won.length/dealRows.length:0},
    customers:{active:customerRows.filter(c=>c.status!=='churned').length,atRisk,expansionCandidates:expansion},
    engagement:{recentActivities:recent},
    actions:[...(atRisk?[{type:'retention',priority:'high',count:atRisk}]:[]),...(expansion?[{type:'expansion',priority:'normal',count:expansion}]:[]),...(dealRows.some(d=>probability(d.probability)>=0.8)?[{type:'close-plan',priority:'normal',count:dealRows.filter(d=>probability(d.probability)>=0.8).length}]:[])]};
}

export function deriveBusinessGraph({customerGraph,revenue}={}) {
  if (!customerGraph?.tenantId || !Array.isArray(customerGraph.nodes) || !Array.isArray(customerGraph.edges)) throw new Error('Customer graph is required');
  return {tenantId:customerGraph.tenantId,generatedAt:new Date().toISOString(),nodes:customerGraph.nodes,edges:customerGraph.edges,revenue};
}
