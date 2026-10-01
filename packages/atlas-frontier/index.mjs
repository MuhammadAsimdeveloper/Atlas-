import crypto from 'node:crypto';

export const QUEUE_STATES = Object.freeze(['queued','leased','succeeded','failed','dead_letter','canceled']);

const id = prefix => prefix + '_' + crypto.randomUUID().replaceAll('-', '');

export function createProviderAdapter({id: adapterId, provider, capabilities = [], contractVersion = '1.0'}) {
  if (!adapterId || !provider) throw new Error('id and provider are required');
  return {id: adapterId, provider, capabilities: [...new Set(capabilities.map(String))], contractVersion};
}

export function validateProviderContract(adapter, required = []) {
  const available = new Set(adapter?.capabilities || []);
  const missing = [...new Set(required.map(String))].filter(x => !available.has(x));
  return {ok: missing.length === 0, adapterId: adapter?.id ?? null, provider: adapter?.provider ?? null, missing};
}

export function createSyncCursor({tenantId, connectorId, resource, cursor = null}) {
  if (!tenantId || !connectorId || !resource) throw new Error('tenantId, connectorId and resource are required');
  return {id: id('cursor'), tenantId, connectorId, resource, cursor, state:'idle', pages:0, records:0, updatedAt:new Date().toISOString()};
}

export function advanceSyncCursor(cursor, {cursorValue = null, records = 0, pages = 1, state = 'idle'} = {}) {
  return {...cursor, cursor:cursorValue, records:cursor.records + records, pages:cursor.pages + pages, state, updatedAt:new Date().toISOString()};
}

export function createWebhookReceipt({tenantId, connectorId, eventId, eventType = 'unknown', payloadHash = null}) {
  if (!tenantId || !connectorId || !eventId) throw new Error('tenantId, connectorId and eventId are required');
  return {id:id('webhook'), tenantId, connectorId, eventId, eventType, payloadHash, receivedAt:new Date().toISOString()};
}

export function claimWebhook(store, receipt) {
  const key = receipt.tenantId + ':' + receipt.connectorId + ':' + receipt.eventId;
  if (store.has(key)) return {accepted:false, duplicate:true, key};
  store.set(key, receipt.id);
  return {accepted:true, duplicate:false, key};
}

export function createQueueJob({tenantId, queue, type, payload = {}, idempotencyKey, maxAttempts = 5}) {
  if (!tenantId || !queue || !type) throw new Error('tenantId, queue and type are required');
  return {id:id('job'), tenantId, queue, type, payload, idempotencyKey:idempotencyKey || crypto.randomUUID(), status:'queued', attempts:0, maxAttempts, availableAt:new Date().toISOString(), leasedUntil:null, workerId:null, lastError:null, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()};
}

export function leaseJob(job, {workerId, leaseMs = 30000, now = Date.now()} = {}) {
  if (job.status !== 'queued') throw new Error('Only queued jobs can be leased');
  return {...job, status:'leased', workerId, leasedUntil:new Date(now + leaseMs).toISOString(), attempts:job.attempts + 1, updatedAt:new Date(now).toISOString()};
}

export function heartbeatJob(job, {workerId, leaseMs = 30000, now = Date.now()} = {}) {
  if (job.status !== 'leased' || job.workerId !== workerId) throw new Error('Worker does not own lease');
  return {...job, leasedUntil:new Date(now + leaseMs).toISOString(), updatedAt:new Date(now).toISOString()};
}

export function completeJob(job, {success, error = null, retryAt = null, now = Date.now()} = {}) {
  if (job.status !== 'leased') throw new Error('Only leased jobs can complete');
  if (success) return {...job, status:'succeeded', leasedUntil:null, workerId:null, lastError:null, updatedAt:new Date(now).toISOString()};
  if (job.attempts >= job.maxAttempts) return {...job, status:'dead_letter', leasedUntil:null, workerId:null, lastError:String(error || 'job failed'), updatedAt:new Date(now).toISOString()};
  const delay = Math.min(30000, 500 * 2 ** Math.max(0, job.attempts - 1));
  return {...job, status:'queued', leasedUntil:null, workerId:null, lastError:String(error || 'job failed'), availableAt:retryAt || new Date(now + delay).toISOString(), updatedAt:new Date(now).toISOString()};
}

export function reclaimExpiredLease(job, {now = Date.now()} = {}) {
  if (job.status !== 'leased' || Date.parse(job.leasedUntil) > now) return job;
  return {...job, status:job.attempts >= job.maxAttempts ? 'dead_letter' : 'queued', workerId:null, leasedUntil:null, lastError:'lease expired', updatedAt:new Date(now).toISOString()};
}

export function claimQueueIdempotency(store, job) {
  const key = job.tenantId + ':' + job.queue + ':' + job.idempotencyKey;
  const existing = store.get(key);
  if (existing && existing !== job.id) return {accepted:false, existingJobId:existing, key};
  store.set(key, job.id);
  return {accepted:true, existingJobId:job.id, key};
}

export function buildOtlpSpan({traceId, spanId, name, startTimeUnixNano, endTimeUnixNano, attributes = {}, status = 'OK'}) {
  return {traceId, spanId, name, startTimeUnixNano:String(startTimeUnixNano), endTimeUnixNano:String(endTimeUnixNano),
    attributes:Object.entries(attributes).map(([key,value]) => ({key, value:typeof value === 'number' ? {intValue:String(value)} : {stringValue:String(value)}})),
    status:{code:status === 'OK' ? 1 : 2}};
}

export function buildOtlpTraceRequest(spans = []) {
  return {resourceSpans:[{resource:{attributes:[{key:'service.name',value:{stringValue:'atlas'}},{key:'service.namespace',value:{stringValue:'atlas-business-os'}}]},scopeSpans:[{scope:{name:'atlas.runtime'},spans}]}]};
}

export function calculateSlo({good = 0, total = 0, target = 0.995, window = '30d'} = {}) {
  const ratio = total ? Math.max(0, Math.min(1, good / total)) : 1;
  const errorBudget = 1 - target;
  const consumed = errorBudget === 0 ? (ratio === 1 ? 0 : Infinity) : Math.max(0, (1 - ratio) / errorBudget);
  return {ratio, target, window, errorBudget, budgetConsumedRatio:consumed, burnRate:consumed, withinSlo:ratio >= target};
}

export function createCustomerGraph({tenantId, nodes = [], edges = []}) {
  if (!tenantId) throw new Error('tenantId is required');
  return {tenantId, nodes:[...nodes], edges:[...edges], generatedAt:new Date().toISOString()};
}

export function upsertGraphNode(graph, node) {
  if (!node?.id || !node?.type) throw new Error('node id and type are required');
  return {...graph, nodes:[...graph.nodes.filter(x => x.id !== node.id), {...node, tenantId:graph.tenantId}]};
}

export function upsertGraphEdge(graph, edge) {
  if (!edge?.from || !edge?.to || !edge?.type) throw new Error('edge endpoints and type are required');
  return {...graph, edges:[...graph.edges.filter(x => !(x.from === edge.from && x.to === edge.to && x.type === edge.type)), {...edge, tenantId:graph.tenantId}]};
}

export function graphPath(graph, start, goal, maxDepth = 6) {
  if (start === goal) return [start];
  const queue = [[start]], seen = new Set([start]);
  while (queue.length) {
    const path = queue.shift();
    if (path.length > maxDepth) continue;
    for (const edge of graph.edges.filter(x => x.from === path.at(-1))) {
      if (edge.to === goal) return [...path, edge.to];
      if (!seen.has(edge.to)) { seen.add(edge.to); queue.push([...path, edge.to]); }
    }
  }
  return null;
}

export function scoreCustomerHealth({engagement = 0, productUsage = 0, openIssues = 0, paymentRisk = 0} = {}) {
  const score = Math.round(Math.max(0, Math.min(100, engagement*35 + productUsage*35 + (1-openIssues)*15 + (1-paymentRisk)*15)));
  return {score, band:score >= 80 ? 'healthy' : score >= 60 ? 'watch' : 'at_risk'};
}

export function buildRevenueCockpit({deals = [], customers = [], activities = [], periodDays = 30} = {}) {
  const total = deals.reduce((n,d) => n + Number(d.amount || 0), 0);
  const weighted = deals.reduce((n,d) => n + Number(d.amount || 0) * Number(d.probability || 0), 0);
  const won = deals.filter(d => ['won','closed_won'].includes(d.status));
  const atRisk = customers.filter(c => c.healthBand === 'at_risk').length;
  const expansion = customers.filter(c => Number(c.expansionScore || 0) >= 0.7).length;
  const recent = activities.filter(a => a.createdAt && Date.now() - Date.parse(a.createdAt) <= periodDays*86400000).length;
  return {generatedAt:new Date().toISOString(), pipeline:{total, weighted, deals:deals.length, wonValue:won.reduce((n,d)=>n+Number(d.amount||0),0), winRate:deals.length ? won.length/deals.length : 0},
    customers:{active:customers.filter(c=>c.status !== 'churned').length, atRisk, expansionCandidates:expansion},
    engagement:{recentActivities:recent},
    actions:[...(atRisk?[{type:'retention',priority:'high',count:atRisk}]:[]),...(expansion?[{type:'expansion',priority:'normal',count:expansion}]:[]),...(deals.some(d=>Number(d.probability||0)>=0.8)?[{type:'close-plan',priority:'normal',count:deals.filter(d=>Number(d.probability||0)>=0.8).length}]:[])]};
}

export function deriveBusinessGraph({customerGraph, revenue}) {
  return {tenantId:customerGraph.tenantId, generatedAt:new Date().toISOString(), nodes:customerGraph.nodes, edges:customerGraph.edges, revenue};
}
