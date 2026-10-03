import crypto from 'node:crypto';

export const ACTION_STATES = Object.freeze(['proposed','pending_approval','approved','running','succeeded','failed','canceled','compensating','compensated']);
export const HEALTH_STATES = Object.freeze(['unknown','healthy','degraded','unhealthy']);

export function jitteredBackoff(attempt, baseMs=500, maxMs=30000, jitter=0.2, random=Math.random) {
  if (!Number.isSafeInteger(attempt) || attempt < 0 || attempt > 100) throw new Error('attempt is out of range');
  if (!Number.isFinite(baseMs) || baseMs < 1 || !Number.isFinite(maxMs) || maxMs < baseMs) throw new Error('backoff bounds are invalid');
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1 || typeof random !== 'function') throw new Error('jitter configuration is invalid');
  const sample=random();
  if (!Number.isFinite(sample) || sample < 0 || sample > 1) throw new Error('random source must return a value from 0 to 1');
  const raw=Math.min(maxMs,baseMs*2**Math.max(0,attempt)); const spread=raw*jitter;
  return Math.max(0,Math.round(raw-spread+sample*spread*2));
}
export function assessConnectorHealth({connector, observedCapabilities=[], latencyMs=null, errorRate=0, credentialValid=true}) {
  const advertised=new Set((Array.isArray(connector?.capabilities)?connector.capabilities:[]).filter(x=>typeof x==='string'));
  const observed=new Set((Array.isArray(observedCapabilities)?observedCapabilities:[]).filter(x=>typeof x==='string'));
  const missing=[...advertised].filter(x=>!observed.has(x));
  const rate=Number(errorRate), latency=latencyMs==null?null:Number(latencyMs);
  const metricsValid=Number.isFinite(rate)&&rate>=0&&rate<=1&&(latency===null||(Number.isFinite(latency)&&latency>=0));
  let state='healthy';
  if(credentialValid!==true || !metricsValid || !connector?.id || rate>=0.5) state='unhealthy';
  else if(missing.length || rate>=0.1 || (latency!==null && latency>2000)) state='degraded';
  return {connectorId:connector?.id??null,state,missingCapabilities:missing,errorRate:metricsValid?rate:null,latencyMs:metricsValid?latency:null,credentialValid:credentialValid===true,checkedAt:new Date().toISOString()};
}
export function createHealthSnapshot(input){if(typeof input?.tenantId!=='string'||!input.tenantId.trim())throw new Error('tenantId is required');return {...assessConnectorHealth(input),id:`health_${crypto.randomUUID().replaceAll('-','')}`,tenantId:input.tenantId,provider:input.connector?.provider??input.connector?.id??'unknown'};}
export function detectCapabilityDrift(previous,current){
  const before=new Set(previous?.capabilities||[]), after=new Set(current?.capabilities||[]);
  return {added:[...after].filter(x=>!before.has(x)).sort(),removed:[...before].filter(x=>!after.has(x)).sort(),drifted:JSON.stringify([...before].sort())!==JSON.stringify([...after].sort())};
}
export function createGoldenEvaluation({id,tenantId,agentId,input,expectedTools=[],expectedOutcome}={}){for(const [value,label] of [[id,'id'],[tenantId,'tenantId'],[agentId,'agentId']])if(typeof value!=='string'||!value.trim())throw new Error(label+' is required');if(!Array.isArray(expectedTools))throw new Error('expectedTools must be a list');return {id,tenantId,agentId,input,expectedTools:[...new Set(expectedTools.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()))].sort(),expectedOutcome};}
function stableValue(value){if(Array.isArray(value))return value.map(stableValue);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stableValue(value[key])]));return value;}
export function evaluateAgentCase({golden,actualTools=[],actualOutcome,trace=[]}){
  const expected=Array.isArray(golden?.expectedTools)?golden.expectedTools:[];
  const toolsPass=JSON.stringify([...expected].sort())===JSON.stringify([...new Set((Array.isArray(actualTools)?actualTools:[]).filter(x=>typeof x==='string'))].sort());
  const outcomePass=JSON.stringify(stableValue(golden?.expectedOutcome))===JSON.stringify(stableValue(actualOutcome));
  const traceSafe=Array.isArray(trace)&&trace.length>0&&trace.every(s=>s?.tenantId===golden?.tenantId);
  return {caseId:golden?.id??null,pass:Boolean(golden?.id)&&toolsPass&&outcomePass&&traceSafe,checks:{tools:toolsPass,outcome:outcomePass,tenantIsolation:traceSafe}};
}
export function scoreEvaluation(cases){const rows=Array.isArray(cases)?cases:[];const passed=rows.filter(x=>x?.pass===true).length;return {score:rows.length?Math.round(passed/rows.length*10000)/100:0,passed,total:rows.length};}
export function releaseGate({evaluationScore,minScore=95,errorRate=0,maxErrorRate=0.02,criticalFailures=0}={}){const checks={evaluation:Number.isFinite(evaluationScore)&&Number.isFinite(minScore)&&minScore>=0&&minScore<=100&&evaluationScore>=minScore,errorRate:Number.isFinite(errorRate)&&Number.isFinite(maxErrorRate)&&errorRate>=0&&maxErrorRate>=0&&errorRate<=maxErrorRate,criticalFailures:Number.isSafeInteger(criticalFailures)&&criticalFailures===0};return {pass:Object.values(checks).every(Boolean),checks,evaluationScore,minScore,errorRate,maxErrorRate,criticalFailures};}
const TELEMETRY_PRIVATE_KEY=/authorization|password|secret|api[_-]?key|token|credential|cookie|email|phone|message|body|prompt|content|payload/i;
function safeTelemetryAttributes(attributes){
  if(!attributes||typeof attributes!=='object'||Array.isArray(attributes))return {};
  return Object.fromEntries(Object.entries(attributes).slice(0,100).map(([key,value])=>{
    const safeKey=String(key).slice(0,128);
    let safeValue=TELEMETRY_PRIVATE_KEY.test(safeKey)?'[REDACTED]':typeof value==='string'?value.slice(0,256):typeof value==='number'&&Number.isFinite(value)?value:typeof value==='boolean'?value:'[REDACTED]';
    if(typeof safeValue==='string'&&(/Bearer\s+\S+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(safeValue)))safeValue='[REDACTED]';
    return [safeKey,safeValue];
  }));
}
export function createTelemetryFacade({tracer=null,meter=null,clock=()=>Date.now()}={}){return {
  async span(name,attributes,fn){const safe=safeTelemetryAttributes(attributes),start=clock(),span=tracer?.startSpan?.(String(name).slice(0,200),{attributes:safe});try{const result=await fn();span?.setStatus?.({code:1});return result}catch(error){span?.recordException?.({type:String(error?.name||'Error').slice(0,80),message:'Operation failed'});span?.setStatus?.({code:2});throw error}finally{meter?.recordDuration?.(String(name).slice(0,200),clock()-start,safe);span?.end?.()}},
  event(name,attributes){tracer?.emitEvent?.(String(name).slice(0,200),safeTelemetryAttributes(attributes))}, metric(name,value,attributes){if(Number.isFinite(value))meter?.record?.(String(name).slice(0,200),value,safeTelemetryAttributes(attributes))}
};}
const PRIVATE_PAYLOAD_KEY=/(?:password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|credential|authorization|cookie)/i;
function safeActionPayload(value,seen=new Set()){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||seen.has(value))throw new Error('Action payload must be finite JSON data');
  seen.add(value);
  if(Array.isArray(value)){if(value.length>200)throw new Error('Action payload array is too large');const result=value.map(v=>safeActionPayload(v,seen));seen.delete(value);return result;}
  if(Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Action payload must be a plain object');
  const entries=Object.entries(value);if(entries.length>100)throw new Error('Action payload has too many fields');
  const out={};for(const [key,item] of entries){if(PRIVATE_PAYLOAD_KEY.test(key))throw new Error('Store credential references, not secret values, in action payloads');out[key.slice(0,128)]=safeActionPayload(item,seen);}seen.delete(value);return out;
}
function actionBinding(action){return {id:action.id,tenantId:action.tenantId,actorId:action.actorId,proposalId:action.proposalId,tool:action.tool,payload:action.payload,risk:action.risk};}
function canonical(value){return JSON.stringify(stableValue(value));}
function signApproval(body,secret){return crypto.createHmac('sha256',secret).update(canonical(body)).digest('hex');}
export function hashAction(action){return crypto.createHash('sha256').update(canonical(actionBinding(action))).digest('hex');}
export function createAction({tenantId,actorId,proposalId,tool,payload={},risk='write',idempotencyKey}){
  for(const [v,label] of [[tenantId,'tenantId'],[actorId,'actorId'],[proposalId,'proposalId'],[tool,'tool']])if(typeof v!=='string'||!v.trim()||v.trim().length>180)throw new Error(`${label} is required and must be under 180 characters`);
  if(!['read','low','medium','write','high','critical'].includes(risk))throw new Error('Action risk is invalid');
  const safePayload=safeActionPayload(payload);if(!safePayload||Array.isArray(safePayload))throw new Error('Action payload must be an object');
  const encoded=JSON.stringify(safePayload);if(Buffer.byteLength(encoded,'utf8')>64*1024)throw new Error('Action payload exceeds 64 KB');
  const key=idempotencyKey??crypto.randomUUID();if(typeof key!=='string'||!key.trim()||key.length>200)throw new Error('idempotencyKey must be 1 to 200 characters');
  const timestamp=new Date().toISOString();
  return {id:`act_${crypto.randomUUID().replaceAll('-','')}`,tenantId:tenantId.trim(),actorId:actorId.trim(),proposalId:proposalId.trim(),tool:tool.trim(),payload:safePayload,risk,status:'pending_approval',idempotencyKey:key,createdAt:timestamp,updatedAt:timestamp,attempts:0};
}
function validApprovalEvidence(action,evidence,secret,nowMs){
  if(!evidence||typeof secret!=='string'||Buffer.byteLength(secret)<32||evidence.actionId!==action.id||evidence.tenantId!==action.tenantId||evidence.actionHash!==hashAction(action)||evidence.decision!=='approved'||typeof evidence.reviewerId!=='string'||!evidence.reviewerId.trim())return false;
  const issued=Date.parse(evidence.issuedAt),expires=Date.parse(evidence.expiresAt);if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>nowMs+60_000||expires<=nowMs||expires-issued>15*60_000)return false;
  const {signature,...body}=evidence;if(typeof signature!=='string'||! /^[a-f0-9]{64}$/i.test(signature))return false;
  const actual=Buffer.from(signature,'hex'),expected=Buffer.from(signApproval(body,secret),'hex');return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);
}
// Call only after the API has authorized the authenticated reviewer for this tenant/action.
// Keep ATLAS_ACTION_APPROVAL_KEY stable across all API/worker replicas (32+ bytes).
export function createApprovalEvidence(action,{reviewerId,decision='approved',secret=process.env.ATLAS_ACTION_APPROVAL_KEY,nowMs=Date.now()}={}){
  if(action?.status!=='pending_approval'||typeof reviewerId!=='string'||!reviewerId.trim()||!['approved','denied'].includes(decision))throw new Error('Action and reviewer approval context are invalid');
  if(typeof secret!=='string'||Buffer.byteLength(secret)<32)throw new Error('A 32-byte ATLAS_ACTION_APPROVAL_KEY is required');
  const body={actionId:action.id,tenantId:action.tenantId,actionHash:hashAction(action),reviewerId:reviewerId.trim(),decision,issuedAt:new Date(nowMs).toISOString(),expiresAt:new Date(nowMs+15*60_000).toISOString()};
  return {...body,signature:signApproval(body,secret)};
}
export function transitionAction(action,next,{approvalEvidence=null,approvalSecret=process.env.ATLAS_ACTION_APPROVAL_KEY,nowMs=Date.now()}={}){
  const allowed={proposed:['pending_approval','canceled'],pending_approval:['approved','canceled'],approved:['running','canceled'],running:['succeeded','failed','compensating'],failed:['running','canceled','compensating'],compensating:['compensated','failed'],succeeded:[],canceled:[],compensated:[]};
  if(!action||!allowed[action.status]?.includes(next))throw new Error(`Invalid action transition ${action?.status} -> ${next}`);
  if(action.status==='pending_approval'&&next==='approved'&&!validApprovalEvidence(action,approvalEvidence,approvalSecret,nowMs))throw new Error('A valid action-bound reviewer approval is required');
  const updated={...action,status:next,updatedAt:new Date(nowMs).toISOString(),attempts:next==='running'?(Number.isSafeInteger(action.attempts)?action.attempts:0)+1:action.attempts};
  if(action.status==='pending_approval'&&next==='approved')updated.approvedBy=approvalEvidence.reviewerId;
  if(next==='failed')updated.failedAt=new Date(nowMs).toISOString();
  return updated;
}
export function claimIdempotency(store,tenantId,key,actionId){
  if(!(store instanceof Map)||typeof tenantId!=='string'||!tenantId.trim()||typeof key!=='string'||!key.trim()||typeof actionId!=='string'||!actionId.trim())throw new Error('tenantId, idempotency key and actionId are required');
  const scopedKey=`${tenantId.trim()}\u0000${key.trim()}`,existing=store.get(scopedKey);
  if(existing&&existing!==actionId)return {accepted:false,existingActionId:existing};store.set(scopedKey,actionId);return {accepted:true,existingActionId:actionId};
}
export function deriveCommandCenter({pulse,connectors=[],evaluations=[],actions=[]}={}){
  const safeConnectors=Array.isArray(connectors)?connectors.slice(0,500):[],safeActions=Array.isArray(actions)?actions.slice(0,10000):[],risks=Array.isArray(pulse?.risks)?pulse.risks.slice(0,100):[];
  const health=safeConnectors.reduce((n,c)=>n+(c?.state==='healthy'?1:0),0),value=Number(pulse?.metrics?.totalPipeline);
  const cleanRisks=risks.map(r=>({type:typeof r?.type==='string'?r.type.slice(0,80):'unclassified',severity:['low','medium','high','critical'].includes(r?.severity)?r.severity:'medium'}));
  return {generatedAt:new Date().toISOString(),health:{connectors:safeConnectors.length,healthy:health,degraded:safeConnectors.filter(c=>c?.state==='degraded').length,unhealthy:safeConnectors.filter(c=>c?.state==='unhealthy').length},evaluation:scoreEvaluation(evaluations),operations:{risks:cleanRisks.length,pipeline:Number.isFinite(value)&&value>=0?value:0,pendingApprovals:safeActions.filter(a=>a?.status==='pending_approval').length,running:safeActions.filter(a=>a?.status==='running').length,failed:safeActions.filter(a=>a?.status==='failed').length},risks:cleanRisks};
}
